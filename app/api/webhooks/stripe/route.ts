import type { NextRequest } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe/client";
import { db } from "@/lib/db";
import { releaseOrder } from "@/lib/db/release";
import { sendConfirmationEmail } from "@/lib/email";
import { logEvent } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The only writer of PAID (CLAUDE.md §2.3). A client reporting
// `status === "succeeded"` never flips an order; this handler does, and only
// after Stripe's signature checks out.
//
// Not rate limited, deliberately. The signature check is the authentication and
// a limiter here would drop legitimate bursts of retries from Stripe.

export async function POST(req: NextRequest) {
  // ── 1. Raw body. App Router: req.text(), never req.json(). ─────────────────
  // The signature is computed over the exact bytes Stripe sent. Parsing first
  // and re-serialising changes key order and whitespace and the signature stops
  // matching — which fails closed, but fails on every single event.
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");
  if (!sig) return new Response("missing signature", { status: 400 });

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    // Refuse rather than skip verification. An unverified webhook endpoint is a
    // public "mark this order paid" button.
    logEvent("webhook_secret_missing");
    return new Response("webhook not configured", { status: 500 });
  }

  let event: Stripe.Event;
  try {
    // Pure local crypto — no network call, and no Stripe account needed. This
    // is why the webhook path has no simulation seam: anything holding the
    // signing secret can drive it, including a test.
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch {
    logEvent("webhook_bad_signature");
    return new Response("bad signature", { status: 400 });
  }

  // ── 2. Replay defence. ─────────────────────────────────────────────────────
  // The unique primary key does the work. Stripe retries, and it retries
  // concurrently — a `findUnique` then `create` lets two simultaneous
  // deliveries of one event both see "not processed" and both process it. Here
  // they race on the insert instead and exactly one wins.
  try {
    await db.webhookEvent.create({ data: { id: event.id, type: event.type } });
  } catch (e) {
    if (typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002") {
      logEvent("webhook_replay_ignored", { eventId: event.id });
      return new Response("already processed", { status: 200 });
    }
    throw e;
  }

  // ── 3. Dispatch. ───────────────────────────────────────────────────────────
  try {
    switch (event.type) {
      case "payment_intent.succeeded":
        await onPaid(event.data.object);
        break;
      case "payment_intent.payment_failed":
      case "payment_intent.canceled":
        await onFailed(event.data.object);
        break;
      case "charge.refunded":
        await onRefunded(event.data.object);
        break;
      default:
        logEvent("webhook_unhandled", { type: event.type });
    }
  } catch (e) {
    // Delete the dedupe row so Stripe's retry can actually reprocess. Without
    // this, one transient database error means the event is marked seen and the
    // payment is never recorded.
    await db.webhookEvent.delete({ where: { id: event.id } }).catch(() => {});
    logEvent("webhook_handler_failed", { eventId: event.id, type: event.type });
    console.error("[webhook]", event.id, e);
    // 500 tells Stripe to retry. Never 200 on a failure — a 200 is a promise
    // that the event was handled.
    return new Response("handler failed", { status: 500 });
  }

  // ── 4. Return fast. ────────────────────────────────────────────────────────
  return new Response("ok", { status: 200 });
}

async function onPaid(pi: Stripe.PaymentIntent) {
  const order = await db.order.findUnique({
    where: { stripePaymentIntentId: pi.id },
    select: { id: true, status: true, totalCents: true },
  });

  if (!order) {
    // Money moved and we cannot say for what. The intent's metadata carries
    // orderId/orderNumber, so this is recoverable by hand from the dashboard.
    logEvent("webhook_orphan_intent", { intentId: pi.id });
    return;
  }

  if (order.status !== "PENDING") {
    // Already paid, already expired, already cancelled. This is the normal
    // outcome of a retry or of the sweep racing a late payment, not an error.
    logEvent("webhook_noop", { orderId: order.id, status: order.status });
    return;
  }

  // Stripe's amount must match ours. A mismatch means tampering or a bug and
  // must never silently pass.
  if (pi.amount_received !== order.totalCents) {
    // DELTA FROM backend.md §5, which logs and returns. Returning alone leaves
    // the order PENDING with its `expiresAt` intact, so the sweep expires it a
    // few minutes later and releases the stock — for an order that has been
    // paid. The student is charged and has no order. Clearing the expiry
    // freezes the order out of the sweep's reach and parks it for a human;
    // status stays PENDING so nothing downstream treats it as good.
    await db.order.update({
      where: { id: order.id },
      data: { expiresAt: null },
    });
    logEvent("webhook_amount_mismatch", {
      orderId: order.id,
      stripe: pi.amount_received,
      db: order.totalCents,
    });
    return;
  }

  // Conditional on PENDING for the same reason releaseOrder is: two concurrent
  // deliveries that both got past the dedupe insert (different event ids for
  // the same intent, which Stripe does send) must not both act.
  const { count } = await db.order.updateMany({
    where: { id: order.id, status: "PENDING" },
    data: { status: "PAID", paidAt: new Date(), expiresAt: null },
  });
  if (count === 0) {
    logEvent("webhook_noop_raced", { orderId: order.id });
    return;
  }

  logEvent("order_paid", { orderId: order.id, totalCents: order.totalCents });
  // Not awaited: the response to Stripe must not wait on a notification.
  void sendConfirmationEmail(order.id);
}

async function onFailed(pi: Stripe.PaymentIntent) {
  const order = await db.order.findUnique({
    where: { stripePaymentIntentId: pi.id },
    select: { id: true, status: true },
  });
  if (!order || order.status !== "PENDING") return;

  // releaseOrder re-checks PENDING inside its own transaction, so the read
  // above is only an optimisation — the sweep may have expired this order
  // between the two, and that case releases nothing rather than twice.
  const { released } = await releaseOrder(order.id, "CANCELLED");
  logEvent("order_payment_failed", { orderId: order.id, released });
}

async function onRefunded(charge: Stripe.Charge) {
  const piId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id;
  if (!piId) return;

  const { count } = await db.order.updateMany({
    where: { stripePaymentIntentId: piId, status: { in: ["PAID", "PACKED"] } },
    data: { status: "REFUNDED" },
  });

  // Stock does NOT auto-return on a refund. The snack may already be packed or
  // eaten; staff adjusts inventory by hand in /admin (P4).
  logEvent("order_refunded", { intentId: piId, updated: count });
}

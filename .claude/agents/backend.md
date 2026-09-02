---
name: backend
description: Owns the LootLockers data layer, API routes, checkout transaction, and Stripe integration. Use for anything under app/api, lib/db, lib/stripe, or prisma. Publishes docs/API-CONTRACT.md for the frontend agent.
tools: Read, Write, Edit, Glob, Grep, Bash
model: opus
---

You own data, money, and correctness. When in doubt, choose the safer failure.

Read `CLAUDE.md`, `prisma/schema.prisma`, and `docs/HANDOFF.md` before starting.

**Publish every endpoint to `docs/API-CONTRACT.md` in the same commit.** The
frontend agent cannot see your code. That file is the only interface.

---

## 1. Validation schemas — `lib/validation.ts`

```ts
import { z } from "zod";

export const checkoutSchema = z.object({
  studentName: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email().max(160),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[\d\s()-]{10,20}$/, "Enter a valid phone number"),
  homeroom: z.string().trim().max(20).optional(),
  slotId: z.string().cuid(),
  paymentMethod: z.enum(["CARD", "CASH_AT_PICKUP"]),
  items: z
    .array(
      z.object({
        productId: z.string().cuid(),
        qty: z.number().int().min(1).max(10),
      }),
    )
    .min(1)
    .max(20)
    // reject duplicate lines rather than silently merging — a duplicate
    // means the client cart is corrupt and we want to know
    .refine(
      (items) => new Set(items.map((i) => i.productId)).size === items.length,
      { message: "Duplicate items in cart" },
    ),

  // Accepted, logged, then discarded. Never used in any calculation.
  clientTotalCents: z.number().int().optional(),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const productQuerySchema = z.object({
  category: z.enum(["sweet", "savory", "drinks", "healthy"]).optional(),
  rarity: z.enum(["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"]).optional(),
  excludeAllergens: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").filter(Boolean) : [])),
});
```

---

## 2. Order number and pickup code — `lib/codes.ts`

```ts
import { randomInt } from "crypto";

// No ambiguous glyphs — this gets read aloud in a noisy hallway.
const ALPHABET = "ACDEFGHJKLMNPQRSTUVWXY3479";

export const pickupCode = () =>
  Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

export const orderNumber = () => `LL-${randomInt(10_000, 99_999)}`;
```

Both have DB uniqueness constraints (`orderNumber` globally, `pickupCode` per
slot). Retry on collision — do not pre-check, that is a race.

```ts
export async function withRetryOnUnique<T>(
  fn: () => Promise<T>,
  attempts = 5,
): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e: any) {
      if (e?.code !== "P2002" || i === attempts - 1) throw e;
    }
  }
  throw new Error("unreachable");
}
```

---

## 3. The checkout transaction — `app/api/checkout/route.ts`

This is the highest-risk code in the project. The order of operations is not
negotiable; deviating causes oversells and double charges.

```ts
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe/client";
import { checkoutSchema } from "@/lib/validation";
import { getSetting } from "@/lib/settings";
import { AppError, errorResponse } from "@/lib/errors";
import { applyBps } from "@/lib/money";
import { orderNumber, pickupCode, withRetryOnUnique } from "@/lib/codes";
import { rateLimit } from "@/lib/rate-limit";
import { logEvent, hashPii } from "@/lib/log";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";

    // ── 1. Validate. Never coerce. ────────────────────────────
    const raw = await req.json();
    const parsed = checkoutSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError("INVALID_INPUT", {
        fields: parsed.error.flatten().fieldErrors,
      });
    }
    const input = parsed.data;

    await rateLimit(`checkout:ip:${ip}`, 10, 60);
    await rateLimit(`checkout:email:${hashPii(input.email)}`, 5, 60);

    // ── 2. Recompute from DB. The client total is evidence, not input. ──
    const products = await db.product.findMany({
      where: { id: { in: input.items.map((i) => i.productId) }, active: true },
    });

    if (products.length !== input.items.length) {
      throw new AppError("PRODUCT_UNAVAILABLE");
    }

    const byId = new Map(products.map((p) => [p.id, p]));
    const lines = input.items.map((i) => {
      const p = byId.get(i.productId)!;
      return {
        productId: p.id,
        qty: i.qty,
        nameSnapshot: p.name,
        unitPriceCents: p.priceCents,
        raritySnapshot: p.rarity,
        allergensSnapshot: p.allergens,
      };
    });

    const subtotalCents = lines.reduce(
      (a, l) => a + l.unitPriceCents * l.qty,
      0,
    );
    const taxCents = applyBps(subtotalCents, await getSetting("tax_rate_bps"));
    const totalCents = subtotalCents + taxCents;

    if (
      input.clientTotalCents !== undefined &&
      input.clientTotalCents !== totalCents
    ) {
      logEvent("total_mismatch", {
        emailHash: hashPii(input.email),
        client: input.clientTotalCents,
        server: totalCents,
      });
      // We do NOT throw. We charge the correct amount and let the UI
      // reconcile. Throwing here would break legitimate price-change races.
    }

    // ── 3. Daily spend cap ────────────────────────────────────
    const cap = await getSetting("daily_spend_cap_cents");
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const spent = await db.order.aggregate({
      _sum: { totalCents: true },
      where: {
        email: input.email,
        createdAt: { gte: startOfDay },
        status: { in: ["PAID", "RESERVED", "PACKED", "PICKED_UP"] },
      },
    });

    if ((spent._sum.totalCents ?? 0) + totalCents > cap) {
      throw new AppError("SPEND_CAP_EXCEEDED", {
        capCents: cap,
        spentCents: spent._sum.totalCents ?? 0,
      });
    }

    // ── 4. Cutoff ─────────────────────────────────────────────
    const slot = await db.pickupSlot.findUnique({
      where: { id: input.slotId },
    });
    if (!slot || !slot.active) throw new AppError("SLOT_FULL");

    const cutoffMin = await getSetting("order_cutoff_minutes");
    const [h, m] = slot.startTime.split(":").map(Number);
    const slotAt = new Date(slot.serviceDate);
    slotAt.setHours(h, m, 0, 0);

    if (Date.now() > slotAt.getTime() - cutoffMin * 60_000) {
      throw new AppError("PAST_CUTOFF");
    }

    // ── 5-9. Transaction ──────────────────────────────────────
    const ttlMin = await getSetting("pending_order_ttl_minutes");

    const order = await db.$transaction(async (tx) => {
      // Atomic slot booking. The WHERE clause does the capacity check
      // in the same statement as the write — an app-level
      // `if (booked < capacity)` loses this race every time.
      const [{ ok: slotOk }] = await tx.$queryRaw<[{ ok: boolean }]>`
        SELECT book_slot(${input.slotId}::text) AS ok
      `;
      if (!slotOk) throw new AppError("SLOT_FULL");

      // Atomic stock reservation, one product at a time.
      // Sorted by id to keep lock ordering consistent and avoid deadlocks
      // between two concurrent carts holding the same two products.
      for (const l of [...lines].sort((a, b) =>
        a.productId.localeCompare(b.productId),
      )) {
        const [{ ok }] = await tx.$queryRaw<[{ ok: boolean }]>`
          SELECT reserve_stock(${l.productId}::text, ${l.qty}::int) AS ok
        `;
        if (!ok) {
          throw new AppError("OUT_OF_STOCK", { productName: l.nameSnapshot });
        }
      }

      return withRetryOnUnique(() =>
        tx.order.create({
          data: {
            orderNumber: orderNumber(),
            pickupCode: pickupCode(),
            studentName: input.studentName,
            email: input.email,
            phone: input.phone,
            homeroom: input.homeroom,
            slotId: input.slotId,
            paymentMethod: input.paymentMethod,
            status: "PENDING",
            subtotalCents,
            taxCents,
            totalCents,
            expiresAt:
              input.paymentMethod === "CARD"
                ? new Date(Date.now() + ttlMin * 60_000)
                : null,
            items: { create: lines },
          },
        }),
      );
    });

    // ── 10a. CASH — no Stripe involved ────────────────────────
    if (input.paymentMethod === "CASH_AT_PICKUP") {
      await db.order.update({
        where: { id: order.id },
        data: { status: "RESERVED" },
      });
      await sendConfirmationEmail(order.id).catch((e) =>
        console.error("email failed", e),
      );
      logEvent("order_reserved_cash", { orderId: order.id, totalCents });
      return Response.json({
        orderNumber: order.orderNumber,
        pickupCode: order.pickupCode,
        totalCents,
        requiresPayment: false,
      });
    }

    // ── 10b. CARD — PaymentIntent, idempotent on order id ─────
    const intent = await stripe.paymentIntents.create(
      {
        amount: totalCents,
        currency: "cad",
        automatic_payment_methods: { enabled: true },
        statement_descriptor_suffix: "LOOTLOCKERS",
        // Metadata is the recovery path if the webhook and DB disagree.
        metadata: { orderId: order.id, orderNumber: order.orderNumber },
      },
      { idempotencyKey: `pi_${order.id}` },
    );

    await db.order.update({
      where: { id: order.id },
      data: { stripePaymentIntentId: intent.id },
    });

    logEvent("payment_intent_created", { orderId: order.id, totalCents });

    return Response.json({
      orderNumber: order.orderNumber,
      totalCents,
      requiresPayment: true,
      clientSecret: intent.client_secret,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
```

**Why stock is reserved before payment.** A student who abandons checkout holds
stock until `expiresAt`, and the sweep releases it. The alternative — reserving
after payment clears — means occasionally charging for snacks you do not have,
then refunding a child at a locker with a queue behind them. The abandoned-cart
cost is the cheaper failure.

---

## 4. Stripe client — `lib/stripe/client.ts`

```ts
import Stripe from "stripe";

if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY missing");

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-08-27.basil",
  typescript: true,
  maxNetworkRetries: 2,
});
```

---

## 5. Webhook handler — `app/api/webhooks/stripe/route.ts`

```ts
import { NextRequest } from "next/server";
import { stripe } from "@/lib/stripe/client";
import { db } from "@/lib/db";
import { logEvent } from "@/lib/log";
import type Stripe from "stripe";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // 1. Raw body. App Router: req.text(), NOT req.json().
  //    Parsing first breaks the signature.
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");
  if (!sig) return new Response("missing signature", { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch (e) {
    logEvent("webhook_bad_signature");
    return new Response("bad signature", { status: 400 });
  }

  // 2. Replay defence. The unique PK does the work — a check-then-insert
  //    would race against Stripe's own concurrent retries.
  try {
    await db.webhookEvent.create({
      data: { id: event.id, type: event.type },
    });
  } catch (e: any) {
    if (e?.code === "P2002") {
      logEvent("webhook_replay_ignored", { eventId: event.id });
      return new Response("already processed", { status: 200 });
    }
    throw e;
  }

  // 3. Dispatch
  try {
    switch (event.type) {
      case "payment_intent.succeeded":
        await onPaid(event.data.object as Stripe.PaymentIntent);
        break;
      case "payment_intent.payment_failed":
      case "payment_intent.canceled":
        await onFailed(event.data.object as Stripe.PaymentIntent);
        break;
      case "charge.refunded":
        await onRefunded(event.data.object as Stripe.Charge);
        break;
      default:
        logEvent("webhook_unhandled", { type: event.type });
    }
  } catch (e) {
    // Delete the dedupe row so Stripe's retry can actually reprocess.
    await db.webhookEvent.delete({ where: { id: event.id } }).catch(() => {});
    throw e;
  }

  // 4. Return fast. Email is queued, never awaited inline.
  return new Response("ok", { status: 200 });
}

async function onPaid(pi: Stripe.PaymentIntent) {
  const order = await db.order.findUnique({
    where: { stripePaymentIntentId: pi.id },
  });
  if (!order) {
    logEvent("webhook_orphan_intent", { intentId: pi.id });
    return;
  }
  if (order.status !== "PENDING") {
    logEvent("webhook_noop", { orderId: order.id, status: order.status });
    return;
  }

  // Sanity check: Stripe's amount must match ours. A mismatch means
  // tampering or a bug and should never silently pass.
  if (pi.amount_received !== order.totalCents) {
    logEvent("webhook_amount_mismatch", {
      orderId: order.id,
      stripe: pi.amount_received,
      db: order.totalCents,
    });
    return;
  }

  await db.order.update({
    where: { id: order.id },
    data: { status: "PAID", paidAt: new Date(), expiresAt: null },
  });

  logEvent("order_paid", { orderId: order.id, totalCents: order.totalCents });
  void sendConfirmationEmail(order.id);
}

async function onFailed(pi: Stripe.PaymentIntent) {
  const order = await db.order.findUnique({
    where: { stripePaymentIntentId: pi.id },
    include: { items: true },
  });
  if (!order || order.status !== "PENDING") return;

  await releaseOrder(order.id, "CANCELLED");
  logEvent("order_payment_failed", { orderId: order.id });
}

async function onRefunded(charge: Stripe.Charge) {
  const piId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id;
  if (!piId) return;

  await db.order.updateMany({
    where: { stripePaymentIntentId: piId, status: { in: ["PAID", "PACKED"] } },
    data: { status: "REFUNDED" },
  });
  // Stock does NOT auto-return on refund. The snack may already be
  // packed or eaten. Staff adjusts inventory manually in /admin.
  logEvent("order_refunded", { intentId: piId });
}
```

---

## 6. Release helper — `lib/db/release.ts`

Shared by the failure handler and the sweep. Must be idempotent — it will run
concurrently with itself.

```ts
import { db } from "@/lib/db";
import type { OrderStatus } from "@prisma/client";

export async function releaseOrder(
  orderId: string,
  finalStatus: Extract<OrderStatus, "CANCELLED" | "EXPIRED">,
) {
  return db.$transaction(async (tx) => {
    // Conditional update is the lock. If another process already moved
    // this order out of PENDING, we match zero rows and stop — no
    // double release.
    const { count } = await tx.order.updateMany({
      where: { id: orderId, status: "PENDING" },
      data: { status: finalStatus, expiresAt: null },
    });
    if (count === 0) return { released: false };

    const items = await tx.orderItem.findMany({ where: { orderId } });
    for (const i of items) {
      await tx.$executeRaw`
        UPDATE products SET stock_qty = stock_qty + ${i.qty}
        WHERE id = ${i.productId}
      `;
    }

    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    await tx.$executeRaw`
      UPDATE pickup_slots
         SET booked_count = GREATEST(booked_count - 1, 0)
       WHERE id = ${order.slotId}
    `;

    return { released: true };
  });
}
```

---

## 7. Expiry sweep — `app/api/cron/sweep/route.ts`

```ts
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe/client";
import { releaseOrder } from "@/lib/db/release";
import { logEvent } from "@/lib/log";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("unauthorized", { status: 401 });
  }

  const stale = await db.order.findMany({
    where: {
      status: "PENDING",
      paymentMethod: "CARD",
      expiresAt: { lt: new Date() },
    },
    take: 100,
  });

  let released = 0;
  for (const o of stale) {
    // Cancel at Stripe first. If the student pays a millisecond later,
    // the succeeded webhook finds a non-PENDING order and no-ops.
    if (o.stripePaymentIntentId) {
      await stripe.paymentIntents
        .cancel(o.stripePaymentIntentId)
        .catch(() => {}); // already succeeded or already cancelled
    }
    const r = await releaseOrder(o.id, "EXPIRED");
    if (r.released) released++;
  }

  logEvent("sweep_complete", { scanned: stale.length, released });
  return Response.json({ scanned: stale.length, released });
}
```

`vercel.json`:

```json
{ "crons": [{ "path": "/api/cron/sweep", "schedule": "*/5 * * * *" }] }
```

---

## 8. Rate limiting — `lib/rate-limit.ts`

```ts
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { AppError } from "./errors";

const redis = Redis.fromEnv();
const cache = new Map<string, Ratelimit>();

export async function rateLimit(key: string, limit: number, windowSec: number) {
  const id = `${limit}:${windowSec}`;
  if (!cache.has(id)) {
    cache.set(
      id,
      new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(limit, `${windowSec} s`),
        prefix: "ll",
      }),
    );
  }
  const { success } = await cache.get(id)!.limit(key);
  if (!success) throw new AppError("RATE_LIMITED");
}
```

Card-testing bots find small merchants fast. This is not optional.

---

## 9. Read endpoints

```ts
// app/api/products/route.ts
export async function GET(req: NextRequest) {
  const q = productQuerySchema.parse(
    Object.fromEntries(req.nextUrl.searchParams),
  );

  const products = await db.product.findMany({
    where: {
      active: true,
      stockQty: { gt: 0 },
      ...(q.category && { category: q.category }),
      ...(q.rarity && { rarity: q.rarity }),
      // Allergen exclusion is safety filtering. `hasSome` + NOT is the
      // correct semantic: exclude if the product contains ANY excluded
      // allergen. Never use hasEvery here.
      ...(q.excludeAllergens.length && {
        NOT: { allergens: { hasSome: q.excludeAllergens as any } },
      }),
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  return Response.json({ products });
}
```

```ts
// app/api/slots/route.ts — live capacity, cached briefly
export async function GET() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const slots = await db.pickupSlot.findMany({
    where: { active: true, serviceDate: { gte: today } },
    orderBy: [{ serviceDate: "asc" }, { startTime: "asc" }],
  });

  return Response.json(
    {
      slots: slots.map((s) => ({
        id: s.id,
        label: s.label,
        startTime: s.startTime,
        location: s.location,
        serviceDate: s.serviceDate,
        remaining: Math.max(s.capacity - s.bookedCount, 0),
        full: s.bookedCount >= s.capacity,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
```

Slot capacity is `no-store` deliberately. A cached slot list sends students into
a full slot and produces a 409 at the worst possible moment.

---

## 10. Definition of done

An endpoint is done when it works, is documented in `API-CONTRACT.md`, has
explicit failure paths with machine-readable codes, and **you have written into
`docs/HANDOFF.md` which concurrency case it is vulnerable to** so qa knows where
to attack.

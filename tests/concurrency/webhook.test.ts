import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetDb } from "../setup/db";
import {
  chargeRefunded,
  confirmationsSentFor,
  countLogEvent,
  paymentIntentFailed,
  paymentIntentSucceeded,
  postWebhook,
  seedPendingCardOrder,
  stripeEvent,
} from "../helpers";

describe("webhook idempotency", () => {
  beforeEach(resetDb);

  it("processes the same event three times with one effect", async () => {
    const order = await seedPendingCardOrder({ totalCents: 500 });
    const event = paymentIntentSucceeded(order.stripePaymentIntentId!, 500);

    // Sequential replay — Stripe's own retry behaviour.
    const responses = [];
    for (let i = 0; i < 3; i++) responses.push(await postWebhook(event));
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(responses.map((r) => r.text)).toEqual([
      "ok",
      "already processed",
      "already processed",
    ]);

    const after = await testDb.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe("PAID");
    expect(after.paidAt).not.toBeNull();
    expect(after.expiresAt).toBeNull();
    expect(await testDb.webhookEvent.count()).toBe(1);
    // The notification seam fired exactly once (lib/email.ts logs rather than
    // sends — HANDOFF §23 — so the log line is the spy).
    expect(confirmationsSentFor(order.id)).toBe(1);
    expect(countLogEvent("order_paid", `"orderId":"${order.id}"`)).toBe(1);
  });

  it("handles concurrent delivery of the same event", async () => {
    const order = await seedPendingCardOrder({ totalCents: 500 });
    const event = paymentIntentSucceeded(order.stripePaymentIntentId!, 500);

    // Concurrent, not sequential. A check-then-insert dedupe passes the
    // sequential test above and fails this one.
    const results = await Promise.all([
      postWebhook(event),
      postWebhook(event),
      postWebhook(event),
    ]);

    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.text === "ok")).toHaveLength(1);
    expect(await testDb.webhookEvent.count()).toBe(1);
    expect(confirmationsSentFor(order.id)).toBe(1);

    const after = await testDb.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe("PAID");
  });

  /**
   * Three deliveries with DIFFERENT event ids for one intent — which Stripe
   * genuinely does send. The dedupe insert cannot help here; only the
   * conditional `updateMany(where: status = PENDING)` in `onPaid` stops all
   * three from acting (HANDOFF §18.6).
   */
  it("acts once when three different event ids describe one payment", async () => {
    const order = await seedPendingCardOrder({ totalCents: 500 });
    const pi = order.stripePaymentIntentId!;

    const results = await Promise.all([
      postWebhook(paymentIntentSucceeded(pi, 500, "evt_distinct_a")),
      postWebhook(paymentIntentSucceeded(pi, 500, "evt_distinct_b")),
      postWebhook(paymentIntentSucceeded(pi, 500, "evt_distinct_c")),
    ]);

    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await testDb.webhookEvent.count()).toBe(3);
    expect(countLogEvent("order_paid", `"orderId":"${order.id}"`)).toBe(1);
    expect(confirmationsSentFor(order.id)).toBe(1);

    const after = await testDb.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe("PAID");
  });

  it("rejects an unsigned webhook and records nothing", async () => {
    const order = await seedPendingCardOrder({ totalCents: 500 });
    const r = await postWebhook(
      paymentIntentSucceeded(order.stripePaymentIntentId!, 500),
      { sign: false },
    );
    expect(r.status).toBe(400);
    expect(await testDb.webhookEvent.count()).toBe(0);
    const after = await testDb.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe("PENDING");
  });

  it("rejects a webhook signed with the wrong secret", async () => {
    const order = await seedPendingCardOrder({ totalCents: 500 });
    const r = await postWebhook(
      paymentIntentSucceeded(order.stripePaymentIntentId!, 500),
      { secret: "whsec_not_the_real_secret" },
    );
    expect(r.status).toBe(400);
    expect(r.text).toBe("bad signature");
    expect(await testDb.webhookEvent.count()).toBe(0);
  });

  it("rejects a garbage signature header", async () => {
    const order = await seedPendingCardOrder({ totalCents: 500 });
    const r = await postWebhook(
      paymentIntentSucceeded(order.stripePaymentIntentId!, 500),
      { signature: "t=1,v1=deadbeef" },
    );
    expect(r.status).toBe(400);
    const after = await testDb.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe("PENDING");
  });

  it("ignores an amount that disagrees with the order, and freezes it", async () => {
    const order = await seedPendingCardOrder({ totalCents: 500 });
    const r = await postWebhook(
      paymentIntentSucceeded(order.stripePaymentIntentId!, 100), // tampered
    );
    expect(r.status).toBe(200);

    const after = await testDb.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe("PENDING"); // must NOT be PAID
    expect(after.paidAt).toBeNull();
    // HANDOFF §18.5: the expiry is cleared so the sweep cannot release stock
    // for an order that has actually been paid. That combination — PENDING with
    // expiresAt null — is the "frozen, needs a human" signal in §27.
    expect(after.expiresAt).toBeNull();
    expect(countLogEvent("webhook_amount_mismatch", `"orderId":"${order.id}"`)).toBe(1);
  });

  it("is a no-op for an intent with no matching order", async () => {
    const r = await postWebhook(paymentIntentSucceeded("pi_orphan_qa_test", 500));
    expect(r.status).toBe(200);
    expect(countLogEvent("webhook_orphan_intent", "pi_orphan_qa_test")).toBe(1);
  });

  it("200s and records an unhandled event type without touching orders", async () => {
    const r = await postWebhook(
      stripeEvent("customer.created", { id: "cus_qa", object: "customer" }),
    );
    expect(r.status).toBe(200);
    expect(await testDb.webhookEvent.count()).toBe(1);
  });

  it("releases stock and the seat on payment_failed, exactly once", async () => {
    const order = await seedPendingCardOrder({ totalCents: 500, stockQty: 20 });
    const productId = order.items[0].productId;
    const before = await testDb.product.findUniqueOrThrow({ where: { id: productId } });
    expect(before.stockQty).toBe(19);

    await postWebhook(paymentIntentFailed(order.stripePaymentIntentId!, "evt_fail_1"));

    const afterFirst = await testDb.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(afterFirst.status).toBe("CANCELLED");
    expect(
      (await testDb.product.findUniqueOrThrow({ where: { id: productId } })).stockQty,
    ).toBe(20);
    expect(
      (await testDb.pickupSlot.findUniqueOrThrow({ where: { id: order.slotId } })).bookedCount,
    ).toBe(0);

    // A second failure event, different id, must restock nothing.
    await postWebhook(paymentIntentFailed(order.stripePaymentIntentId!, "evt_fail_2"));
    expect(
      (await testDb.product.findUniqueOrThrow({ where: { id: productId } })).stockQty,
    ).toBe(20);
  });

  /**
   * KNOWN HOLE — HANDOFF §21, "the worst failure mode in P3".
   *
   * The dedupe row is inserted BEFORE the handler runs and only deleted on a
   * thrown error. A process kill, an OOM or a function timeout between the
   * insert and the update leaves the row behind, and every Stripe retry then
   * answers `already processed` for a payment that was never recorded.
   *
   * Reproduced at the database level, which is exactly what a crashed handler
   * leaves behind: the dedupe row present, the order untouched. `it.fails`
   * because the assertion below is what SHOULD be true — when the two-phase
   * claim in §21 is implemented, this test starts failing as
   * "expected to fail but passed" and must be converted to a normal `it`.
   */
  it.fails(
    "KNOWN BUG: a crashed handler poisons the dedupe row and the payment is lost forever",
    async () => {
      const order = await seedPendingCardOrder({ totalCents: 500 });
      const event = paymentIntentSucceeded(order.stripePaymentIntentId!, 500, "evt_crashed");

      // Exactly what the route writes before dispatching.
      await testDb.webhookEvent.create({
        data: { id: "evt_crashed", type: "payment_intent.succeeded" },
      });

      // Stripe retries the same event id.
      const r1 = await postWebhook(event);
      const r2 = await postWebhook(event);
      expect([r1.text, r2.text]).toEqual(["already processed", "already processed"]);

      const after = await testDb.order.findUniqueOrThrow({ where: { id: order.id } });
      console.log(
        `[webhook crash window] after 2 retries of a poisoned event id: ` +
          `status=${after.status} paidAt=${after.paidAt} expiresAt=${after.expiresAt}`,
      );
      // The student was charged. This is the assertion that should hold.
      expect(after.status).toBe("PAID");
    },
  );

  /**
   * KNOWN HOLE — HANDOFF §21, out-of-order Stripe events.
   *
   * Stripe does not guarantee ordering. `charge.refunded` arriving before
   * `payment_intent.succeeded` matches nothing (the order is still PENDING),
   * and the succeeded event then marks it PAID. The order sits PAID forever for
   * money that was returned. There is no timestamp check anywhere.
   */
  it.fails(
    "KNOWN BUG: charge.refunded before payment_intent.succeeded leaves the order PAID",
    async () => {
      const order = await seedPendingCardOrder({ totalCents: 500 });
      const pi = order.stripePaymentIntentId!;

      const refundFirst = await postWebhook(chargeRefunded(pi, "evt_refund_first"));
      expect(refundFirst.status).toBe(200);

      const succeededSecond = await postWebhook(
        paymentIntentSucceeded(pi, 500, "evt_succeeded_second"),
      );
      expect(succeededSecond.status).toBe(200);

      const after = await testDb.order.findUniqueOrThrow({ where: { id: order.id } });
      console.log(
        `[out-of-order events] refunded-then-succeeded left status=${after.status} ` +
          `paidAt=${after.paidAt !== null}`,
      );
      // A refunded order must not be PAID. This is what should hold.
      expect(after.status).toBe("REFUNDED");
    },
  );

  /** The same pair in the documented order works, which is what makes the above a bug. */
  it("refund after payment does mark the order REFUNDED, without restocking", async () => {
    const order = await seedPendingCardOrder({ totalCents: 500, stockQty: 20 });
    const pi = order.stripePaymentIntentId!;
    await postWebhook(paymentIntentSucceeded(pi, 500));

    const before = await testDb.product.findUniqueOrThrow({
      where: { id: order.items[0].productId },
    });
    await postWebhook(chargeRefunded(pi));

    const after = await testDb.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe("REFUNDED");
    const stock = await testDb.product.findUniqueOrThrow({ where: { id: before.id } });
    expect(stock.stockQty).toBe(before.stockQty); // staff adjusts manually

    // Documented consequence (HANDOFF §21): the pickup seat is NOT freed.
    const slot = await testDb.pickupSlot.findUniqueOrThrow({ where: { id: order.slotId } });
    expect(slot.bookedCount).toBe(1);
  });

  /**
   * HANDOFF §21: "`onFailed` releases stock on a payment_failed event, and a
   * student can retry the same intent afterwards. Once released, the retry
   * succeeds at Stripe but the order is CANCELLED, so `onPaid` no-ops —
   * charged, no order."
   *
   * The Stripe-side half (whether an automatic-payment-methods intent really
   * permits that retry) cannot be established without a real account. The
   * database-side half is testable, and it is the half that loses the money.
   */
  it("a payment that succeeds after a failure event is silently swallowed", async () => {
    const order = await seedPendingCardOrder({ totalCents: 500 });
    const pi = order.stripePaymentIntentId!;

    await postWebhook(paymentIntentFailed(pi, "evt_declined"));
    expect(
      (await testDb.order.findUniqueOrThrow({ where: { id: order.id } })).status,
    ).toBe("CANCELLED");

    const late = await postWebhook(paymentIntentSucceeded(pi, 500, "evt_late_success"));
    expect(late.status).toBe(200);

    const after = await testDb.order.findUniqueOrThrow({ where: { id: order.id } });
    // Money would have moved at Stripe; nothing here records it.
    expect(after.status).toBe("CANCELLED");
    expect(after.paidAt).toBeNull();
    expect(countLogEvent("webhook_noop", `"orderId":"${order.id}"`)).toBeGreaterThan(0);
  });
});

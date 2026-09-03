import { createHmac } from "crypto";
import { describe, it, expect, beforeEach } from "vitest";
import type { Allergen, OrderStatus } from "@prisma/client";
import { testDb, resetDb } from "../setup/db";
import {
  checkoutPayload,
  getOrder,
  paymentIntentSucceeded,
  postCheckout,
  postWebhook,
  seedProduct,
  seedSlot,
} from "../helpers";
import {
  ORDER_SESSION_TTL_SECONDS,
  orderSessionCookieName,
  signOrderSessionToken,
} from "@/lib/order-session";

/**
 * GET /api/orders/[orderNumber] — HANDOFF §28.
 *
 * The failures here are authorisation and leakage, not races. The single most
 * important property is that every rejection is byte-identical: the natural
 * "improvement" someone makes later is a helpful distinct message, and that
 * turns a 90,000-value order-number space into an enumeration oracle.
 */

function cookieFor(orderNumber: string, token: string): string {
  return `${orderSessionCookieName(orderNumber)}=${token}`;
}

/** A structurally valid token signed with a key the server does not have. */
function tokenSignedWithWrongKey(orderId: string): string {
  const exp = Math.floor(Date.now() / 1000) + ORDER_SESSION_TTL_SECONDS;
  const payload = `v1.${orderId}.${exp}`;
  const mac = createHmac("sha256", "definitely-not-the-server-secret")
    .update(payload)
    .digest("base64url");
  return `${payload}.${mac}`;
}

async function makeCashOrder(opts: { allergens?: Allergen[] } = {}) {
  const slot = await seedSlot({ capacity: 10 });
  const product = await seedProduct({
    priceCents: 250,
    stockQty: 10,
    name: "Receipt Test Snack",
    allergens: opts.allergens ?? ["DAIRY", "GLUTEN", "SOY"],
  });
  const r = await postCheckout(
    checkoutPayload({
      slotId: slot.id,
      studentName: "Priya Testerson",
      email: "priya.testerson@school.ca",
      phone: "604-555-0199",
      homeroom: "9B",
      paymentMethod: "CASH_AT_PICKUP",
      items: [{ productId: product.id, qty: 2 }],
    }),
  );
  expect(r.status).toBe(200);
  const cookie = r.cookies.map((c) => c.split(";")[0]).join("; ");
  const row = await testDb.order.findUniqueOrThrow({
    where: { orderNumber: r.body.orderNumber },
  });
  return { checkout: r, cookie, order: row, slot, product };
}

describe("order receipt lookup", () => {
  beforeEach(resetDb);

  it("returns the receipt to the browser that placed the order", async () => {
    const { checkout, cookie, order, slot } = await makeCashOrder();

    const r = await getOrder(checkout.body.orderNumber, cookie);
    expect(r.status).toBe(200);
    expect(r.body.orderNumber).toBe(order.orderNumber);
    expect(r.body.status).toBe("RESERVED");
    expect(r.body.paymentMethod).toBe("CASH_AT_PICKUP");
    expect(r.body.totalCents).toBe(500);
    expect(r.body.pickupCode).toBe(order.pickupCode);
    expect(r.body.slot.label).toBe(slot.label);
    expect(r.headers.get("cache-control")).toContain("no-store");
    expect(r.body.items[0].allergensSnapshot.sort()).toEqual(["DAIRY", "GLUTEN", "SOY"]);
  });

  it("leaks no PII and no capacity data", async () => {
    const { checkout, cookie } = await makeCashOrder();
    const r = await getOrder(checkout.body.orderNumber, cookie);

    for (const needle of [
      "Priya",
      "priya.testerson@school.ca",
      "604-555-0199",
      "9B",
      "capacity",
      "bookedCount",
      "studentName",
      "email",
      "phone",
      "homeroom",
    ]) {
      expect(r.text, `response contained ${needle}`).not.toContain(needle);
    }
    // The order's database id is a bearer value inside the cookie; it must not
    // be echoed back.
    expect(Object.keys(r.body)).not.toContain("id");
    expect(r.text).not.toContain(
      (await testDb.order.findFirstOrThrow({ select: { id: true } })).id,
    );
  });

  it("gives one identical answer to every rejection", async () => {
    const a = await makeCashOrder();
    const b = await makeCashOrder();

    const valid = a.cookie.split("=")[1];

    const cases: Record<string, Awaited<ReturnType<typeof getOrder>>> = {
      noCookie: await getOrder(a.order.orderNumber),
      tamperedSignature: await getOrder(
        a.order.orderNumber,
        cookieFor(
          a.order.orderNumber,
          valid.slice(0, -1) + (valid.endsWith("A") ? "B" : "A"),
        ),
      ),
      wrongKey: await getOrder(
        a.order.orderNumber,
        cookieFor(a.order.orderNumber, tokenSignedWithWrongKey(a.order.id)),
      ),
      expiredToken: await getOrder(
        a.order.orderNumber,
        cookieFor(
          a.order.orderNumber,
          signOrderSessionToken(
            a.order.id,
            Date.now() - (ORDER_SESSION_TTL_SECONDS + 10) * 1000,
          ),
        ),
      ),
      // THE ONE THAT MATTERS: order B's token, renamed onto order A's cookie.
      crossOrder: await getOrder(
        a.order.orderNumber,
        cookieFor(a.order.orderNumber, b.cookie.split("=")[1]),
      ),
      unknownOrderNumber: await getOrder("LL-99999", a.cookie),
      malformedOrderNumber: await getOrder("not-an-order", a.cookie),
    };

    for (const [name, r] of Object.entries(cases)) {
      expect(r.status, `${name} status`).toBe(404);
      expect(r.body.error.code, `${name} code`).toBe("ORDER_NOT_FOUND");
      expect(r.text, `${name} body`).toBe(cases.noCookie.text);
    }

    // Control: a token this test signed itself, from the shared secret, is
    // accepted — which is what proves the route really verifies the signature
    // rather than accepting anything.
    const control = await getOrder(
      a.order.orderNumber,
      cookieFor(a.order.orderNumber, signOrderSessionToken(a.order.id)),
    );
    expect(control.status).toBe(200);
  });

  it("cannot be read with another order's cookie under its own name either", async () => {
    const a = await makeCashOrder();
    const b = await makeCashOrder();
    // B's cookie, correctly named for B, but asking for A.
    const r = await getOrder(a.order.orderNumber, b.cookie);
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe("ORDER_NOT_FOUND");
  });

  it("accepts a lower-cased order number in the URL", async () => {
    const { checkout, cookie } = await makeCashOrder();
    const r = await getOrder(checkout.body.orderNumber.toLowerCase(), cookie);
    expect(r.status).toBe(200);
  });

  it("exposes pickupCode by status, as a key and not merely a truthy value", async () => {
    const { checkout, cookie, order } = await makeCashOrder();

    const expected: Record<OrderStatus, boolean> = {
      PENDING: false,
      RESERVED: true,
      PAID: true,
      PACKED: true,
      PICKED_UP: true,
      CANCELLED: false,
      EXPIRED: false,
      REFUNDED: false,
    };

    for (const [status, shouldShow] of Object.entries(expected)) {
      await testDb.order.update({
        where: { id: order.id },
        data: { status: status as OrderStatus },
      });
      const r = await getOrder(checkout.body.orderNumber, cookie);
      expect(r.status, status).toBe(200);
      expect(Object.hasOwn(r.body, "pickupCode"), `pickupCode for ${status}`).toBe(
        shouldShow,
      );
      if (shouldShow) expect(r.body.pickupCode).toBe(order.pickupCode);
    }
  });

  it("withholds the pickup code from a PENDING card order and releases it on PAID", async () => {
    const slot = await seedSlot({ capacity: 10 });
    const product = await seedProduct({ priceCents: 400, stockQty: 5 });
    const r = await postCheckout(
      checkoutPayload({
        slotId: slot.id,
        paymentMethod: "CARD",
        items: [{ productId: product.id, qty: 1 }],
      }),
    );
    expect(r.status).toBe(200);
    expect(r.body.pickupCode).toBeUndefined(); // not in the checkout response
    const cookie = r.cookies.map((c) => c.split(";")[0]).join("; ");

    const pending = await getOrder(r.body.orderNumber, cookie);
    expect(pending.body.status).toBe("PENDING");
    expect(Object.hasOwn(pending.body, "pickupCode")).toBe(false);
    expect(pending.body.expiresAt).not.toBeNull();

    const order = await testDb.order.findUniqueOrThrow({
      where: { orderNumber: r.body.orderNumber },
    });
    await postWebhook(paymentIntentSucceeded(order.stripePaymentIntentId!, 400));

    const paid = await getOrder(r.body.orderNumber, cookie);
    expect(paid.body.status).toBe("PAID");
    expect(paid.body.pickupCode).toBe(order.pickupCode);
    expect(paid.body.expiresAt).toBeNull();
  });

  it("sets an httpOnly, Lax, path-scoped cookie and no Secure over http dev", async () => {
    const { checkout, order } = await makeCashOrder();
    const raw = checkout.cookies.find((c) =>
      c.startsWith(orderSessionCookieName(order.orderNumber) + "="),
    );
    expect(raw, "no order-session cookie on the checkout response").toBeDefined();
    expect(raw!).toContain("HttpOnly");
    expect(raw!.toLowerCase()).toContain("samesite=lax");
    expect(raw!).toContain("Path=/api/orders");
    expect(raw!).toContain("Max-Age=172800");
    // NODE_ENV=development: a Secure cookie would be dropped by a browser over
    // plain http and every receipt read would 404 (HANDOFF §28).
    expect(raw!).not.toContain("Secure");
  });

  it("keeps two receipts from one browser readable at the same time", async () => {
    const a = await makeCashOrder();
    const b = await makeCashOrder();
    const jar = `${a.cookie}; ${b.cookie}`;
    expect((await getOrder(a.order.orderNumber, jar)).status).toBe(200);
    expect((await getOrder(b.order.orderNumber, jar)).status).toBe(200);
  });

  /**
   * The poll-versus-sweep window (HANDOFF §27, §28). Between `expiresAt`
   * passing and the sweep running (up to 5 minutes on Vercel Cron), this route
   * reports an order as PENDING that is already unrecoverable. Asserted so the
   * behaviour is pinned: the route hands the UI enough to be right about it
   * (`expiresAt` in the past), and the UI, not the route, has to act on it.
   */
  it("reports a doomed order as PENDING until the sweep catches up", async () => {
    const slot = await seedSlot({ capacity: 10 });
    const product = await seedProduct({ priceCents: 400, stockQty: 5 });
    const r = await postCheckout(
      checkoutPayload({
        slotId: slot.id,
        paymentMethod: "CARD",
        items: [{ productId: product.id, qty: 1 }],
      }),
    );
    const cookie = r.cookies.map((c) => c.split(";")[0]).join("; ");
    await testDb.order.update({
      where: { orderNumber: r.body.orderNumber },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const stale = await getOrder(r.body.orderNumber, cookie);
    expect(stale.body.status).toBe("PENDING");
    expect(new Date(stale.body.expiresAt).getTime()).toBeLessThan(Date.now());
  });

  /**
   * The other §27 signal: PENDING with `expiresAt: null` is a frozen order (the
   * webhook amount-mismatch path), not a live one. If the route ever stopped
   * distinguishing them the confirmation page would spin forever.
   */
  it("reports a frozen amount-mismatch order as PENDING with a null expiry", async () => {
    const slot = await seedSlot({ capacity: 10 });
    const product = await seedProduct({ priceCents: 400, stockQty: 5 });
    const r = await postCheckout(
      checkoutPayload({
        slotId: slot.id,
        paymentMethod: "CARD",
        items: [{ productId: product.id, qty: 1 }],
      }),
    );
    const cookie = r.cookies.map((c) => c.split(";")[0]).join("; ");
    const order = await testDb.order.findUniqueOrThrow({
      where: { orderNumber: r.body.orderNumber },
    });
    await postWebhook(paymentIntentSucceeded(order.stripePaymentIntentId!, 1));

    const frozen = await getOrder(r.body.orderNumber, cookie);
    expect(frozen.body.status).toBe("PENDING");
    expect(frozen.body.expiresAt).toBeNull();
    expect(Object.hasOwn(frozen.body, "pickupCode")).toBe(false);
  });
});

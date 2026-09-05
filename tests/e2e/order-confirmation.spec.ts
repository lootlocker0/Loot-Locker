import { test, expect } from "@playwright/test";
import { e2eDb, seedProduct, seedSlot } from "./setup/db";
import {
  installReceiptCookie,
  paymentIntentSucceeded,
  placeOrder,
  postWebhook,
} from "./helpers";

/**
 * `/order/[orderNumber]`, including the three PENDING signals docs/HANDOFF.md
 * §27 says the page must not get wrong. Those three are the whole reason this
 * spec exists: they are the states a card student actually lands in, they are
 * indistinguishable from each other by `status` alone, and getting one wrong
 * means either a spinner that never resolves or a "paid" message on an order
 * nobody paid for.
 */

async function newCardOrder(totalCents = 500) {
  const slot = await seedSlot({ startsInMinutes: 200, capacity: 20 });
  const product = await seedProduct({ priceCents: totalCents, stockQty: 20 });
  return placeOrder({
    slotId: slot.id,
    items: [{ productId: product.id, qty: 1 }],
    paymentMethod: "CARD",
  });
}

test.describe("order confirmation — the three PENDING signals (HANDOFF §27)", () => {
  test("frozen (PENDING, expiresAt null) sends the student to staff and stops polling", async ({
    page,
  }) => {
    const order = await newCardOrder();
    // The webhook's amount-mismatch path parks an order exactly here: it will
    // never become PAID and the sweep will never reach it.
    await e2eDb.order.update({
      where: { id: order.id },
      data: { expiresAt: null },
    });

    await installReceiptCookie(page, order.orderNumber, order.receiptCookieHeader);

    let polls = 0;
    await page.route("**/api/orders/**", (route) => {
      polls++;
      route.continue();
    });

    await page.goto(`/order/${order.orderNumber}`);

    await expect(
      page.getByRole("heading", { name: /see staff to finish this order/i }),
    ).toBeVisible();
    await expect(page.getByText(order.orderNumber).first()).toBeVisible();

    // Must NOT claim paid, and must NOT claim expired.
    await expect(page.getByText(/confirming your payment/i)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /order secured/i })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /this order expired/i })).toHaveCount(0);

    // The poll must stop. One fetch, then silence — a page that keeps polling a
    // frozen order shows a spinner forever and hides the human problem.
    const after = polls;
    await page.waitForTimeout(6_000);
    expect(polls, "the page kept polling an order that can never resolve").toBe(after);
  });

  test("clock-expired (PENDING, expiresAt in the past) reads as expired before the sweep runs", async ({
    page,
  }) => {
    const order = await newCardOrder();
    await e2eDb.order.update({
      where: { id: order.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    await installReceiptCookie(page, order.orderNumber, order.receiptCookieHeader);
    await page.goto(`/order/${order.orderNumber}`);

    // The row still says PENDING — the sweep runs every 5 minutes. The UI, not
    // the route, has to be right about the clock (HANDOFF §27, §28).
    const row = await e2eDb.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.status).toBe("PENDING");

    await expect(page.getByRole("heading", { name: /this order expired/i })).toBeVisible();
    await expect(page.getByText(/confirming your payment/i)).toHaveCount(0);
  });

  test("actively pending polls, then resolves to PAID when the webhook lands", async ({
    page,
  }) => {
    const order = await newCardOrder(500);
    await installReceiptCookie(page, order.orderNumber, order.receiptCookieHeader);
    await page.goto(`/order/${order.orderNumber}`);

    await expect(page.getByRole("heading", { name: /confirming your payment/i })).toBeVisible();
    // The live region matters: a student who cannot see the change has to be
    // told about it.
    await expect(page.getByRole("status")).toContainText(/confirming your payment/i);

    // No pickup code while PENDING — API-CONTRACT §6 withholds it, and showing
    // one would send an unpaid student to the locker.
    await expect(page.getByText(/pickup code/i)).toHaveCount(0);

    expect(order.stripePaymentIntentId).toBeTruthy();
    const r = await postWebhook(paymentIntentSucceeded(order.stripePaymentIntentId!, 500));
    expect(r.status).toBe(200);

    // Resolves on its own inside the documented 1.5s / 20s poll budget.
    await expect(page.getByRole("heading", { name: /order secured/i })).toBeVisible({
      timeout: 25_000,
    });
    await expect(page.getByText(/payment confirmed/i)).toBeVisible();
    await expect(page.getByText(/pickup code — read this to staff/i)).toBeVisible();

    const after = await e2eDb.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe("PAID");
  });
});

test.describe("order confirmation — authorisation and PII", () => {
  test("without the receipt cookie the page says not found, never leaks the order", async ({
    page,
  }) => {
    const order = await newCardOrder();
    await page.goto(`/order/${order.orderNumber}`);

    await expect(page.getByRole("heading", { name: /order not found/i })).toBeVisible();
    const body = await page.locator("body").innerText();
    expect(body).not.toContain(order.studentName);
    expect(body).not.toContain(order.email);
    expect(body).not.toContain(order.phone);
    expect(body).not.toContain(order.pickupCode);
  });

  test("another order's receipt cookie is not an oracle", async ({ page }) => {
    const mine = await newCardOrder();
    const theirs = await newCardOrder();

    // A correctly-signed token for order B, presented on order A's request.
    // HANDOFF §28 calls this the cross-order case and it is the one that
    // matters most — a distinct message here turns the route into an
    // enumeration oracle over 5-digit order numbers.
    await installReceiptCookie(page, theirs.orderNumber, theirs.receiptCookieHeader);
    const pair = mine.receiptCookieHeader.split("=");
    await page.context().addCookies([
      {
        name: `ll_ord_${mine.orderNumber}`,
        value: theirs.receiptCookieHeader.split("=").slice(1).join("="),
        domain: "localhost",
        path: "/api/orders",
        httpOnly: true,
        secure: false,
        sameSite: "Lax",
      },
    ]);
    expect(pair.length).toBeGreaterThan(1);

    await page.goto(`/order/${mine.orderNumber}`);
    await expect(page.getByRole("heading", { name: /order not found/i })).toBeVisible();
  });

  test("the URL carries no PII, only the order number", async ({ page }) => {
    const slot = await seedSlot({ startsInMinutes: 200, capacity: 20 });
    const product = await seedProduct({ priceCents: 300, stockQty: 20 });
    const order = await placeOrder({
      slotId: slot.id,
      items: [{ productId: product.id, qty: 1 }],
      studentName: "Priya Ramanathan",
      email: "priya.ramanathan@school.ca",
      phone: "604-555-0199",
      homeroom: "8B",
    });

    await installReceiptCookie(page, order.orderNumber, order.receiptCookieHeader);
    await page.goto(`/order/${order.orderNumber}`);
    await expect(page.getByRole("heading", { name: /order secured/i })).toBeVisible();

    // CLAUDE.md §2.6. The order number is a random 5-digit token, not PII.
    const url = page.url();
    expect(url).not.toContain("priya");
    expect(url).not.toContain("%40");
    expect(url).not.toContain("604");
    expect(url).not.toContain("8B");
    expect(url).toMatch(/\/order\/LL-\d{5}$/);

    // And the rendered receipt shows the student their own order without
    // reprinting the personal data the school does not need on a screenshot.
    const body = await page.locator("body").innerText();
    expect(body).not.toContain("priya.ramanathan@school.ca");
    expect(body).not.toContain("604-555-0199");
  });
});

test.describe("order confirmation — allergen snapshots on the receipt", () => {
  test("shows the allergens as purchased, not as later corrected", async ({ page }) => {
    const slot = await seedSlot({ startsInMinutes: 200, capacity: 20 });
    const product = await seedProduct({
      priceCents: 400,
      stockQty: 20,
      allergens: ["DAIRY"],
      name: `Allergen Snapshot ${Date.now()}`,
    });
    const order = await placeOrder({
      slotId: slot.id,
      items: [{ productId: product.id, qty: 1 }],
    });

    // Staff correct the product AFTER the order is placed.
    await e2eDb.product.update({
      where: { id: product.id },
      data: { allergens: ["DAIRY", "PEANUTS"] },
    });

    await installReceiptCookie(page, order.orderNumber, order.receiptCookieHeader);
    await page.goto(`/order/${order.orderNumber}`);

    const allergens = page.getByRole("list", { name: /contains allergens/i });
    await expect(allergens.getByRole("listitem")).toHaveText(["DAIRY"]);
    await expect(page.getByText("PEANUTS")).toHaveCount(0);
  });

  test("states 'no listed allergens' explicitly rather than rendering nothing", async ({
    page,
  }) => {
    const slot = await seedSlot({ startsInMinutes: 200, capacity: 20 });
    const product = await seedProduct({ priceCents: 400, stockQty: 20, allergens: [] });
    const order = await placeOrder({
      slotId: slot.id,
      items: [{ productId: product.id, qty: 1 }],
    });

    await installReceiptCookie(page, order.orderNumber, order.receiptCookieHeader);
    await page.goto(`/order/${order.orderNumber}`);
    await expect(page.getByText("No listed allergens")).toBeVisible();
  });
});

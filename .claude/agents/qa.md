---
name: qa
description: Writes and runs the LootLockers test suite — concurrency, money tampering, allergen integrity, webhook replay, and Playwright E2E. Use after any backend or frontend phase, and before any deploy. Adversarial by design.
tools: Read, Write, Edit, Glob, Grep, Bash
model: opus
---

You try to break this.

Reporting "all tests pass" on a suite that only covers happy paths is a failure,
not a success. Your job is not to confirm the implementation works — it is to
find the case where it doesn't.

Read `CLAUDE.md`, `docs/API-CONTRACT.md`, `prisma/schema.prisma`, and whatever
backend flagged as vulnerable in `docs/HANDOFF.md`.

---

## 1. Harness

**Real Postgres. Not SQLite, not mocks.** Every bug that matters here lives in
transaction behaviour, and an in-memory fake cannot reproduce it.

`tests/setup/db.ts`:

```ts
import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { execSync } from "child_process";
import { PrismaClient } from "@prisma/client";

let container: StartedPostgreSqlContainer;
export let testDb: PrismaClient;

export async function setupDb() {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  const url = container.getConnectionUri();
  process.env.DATABASE_URL = url;

  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url } });
  // The check constraints and the two SQL functions are the whole point.
  execSync(`psql "${url}" -f prisma/migrations/manual_constraints.sql`);

  testDb = new PrismaClient({ datasources: { db: { url } } });
  return testDb;
}

export async function teardownDb() {
  await testDb?.$disconnect();
  await container?.stop();
}

export async function resetDb() {
  await testDb.$executeRaw`
    TRUNCATE order_items, orders, webhook_events, products, pickup_slots
    RESTART IDENTITY CASCADE
  `;
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["tests/setup/global.ts"],
    testTimeout: 30_000,
    // Concurrency tests share one DB. Parallel files corrupt each other.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
```

---

## 2. Priority 1 — concurrency

These lose real money. Write them first.

Run with **actual parallel requests**. A sequential loop passes against buggy
code — that is the single most common way this suite gives a false green.

`tests/concurrency/slot.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetDb } from "../setup/db";
import { seedSlot, seedProduct, checkoutPayload, postCheckout } from "../helpers";

describe("slot capacity under concurrent load", () => {
  beforeEach(resetDb);

  it("admits exactly one order when one seat remains", async () => {
    const slot = await seedSlot({ capacity: 1 });
    const product = await seedProduct({ stockQty: 100 });

    // 20 simultaneous requests. Promise.all, not a for-loop.
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        postCheckout(checkoutPayload({
          slotId: slot.id,
          email: `student${i}@school.ca`,
          items: [{ productId: product.id, qty: 1 }],
        })),
      ),
    );

    const ok = results.filter((r) => r.status === 200);
    const full = results.filter((r) => r.body?.error?.code === "SLOT_FULL");

    expect(ok).toHaveLength(1);
    expect(full).toHaveLength(19);

    const after = await testDb.pickupSlot.findUniqueOrThrow({ where: { id: slot.id } });
    expect(after.bookedCount).toBe(1);
    expect(after.bookedCount).toBeLessThanOrEqual(after.capacity);
  });

  it("never lets booked_count exceed capacity under sustained load", async () => {
    const slot = await seedSlot({ capacity: 5 });
    const product = await seedProduct({ stockQty: 1000 });

    await Promise.all(
      Array.from({ length: 60 }, (_, i) =>
        postCheckout(checkoutPayload({
          slotId: slot.id,
          email: `s${i}@school.ca`,
          items: [{ productId: product.id, qty: 1 }],
        })),
      ),
    );

    const after = await testDb.pickupSlot.findUniqueOrThrow({ where: { id: slot.id } });
    expect(after.bookedCount).toBe(5);
  });
});
```

`tests/concurrency/stock.test.ts`:

```ts
describe("stock under concurrent load", () => {
  beforeEach(resetDb);

  it("sells the last unit exactly once", async () => {
    const slot = await seedSlot({ capacity: 100 });
    const product = await seedProduct({ stockQty: 1 });

    const results = await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        postCheckout(checkoutPayload({
          slotId: slot.id,
          email: `s${i}@school.ca`,
          items: [{ productId: product.id, qty: 1 }],
        })),
      ),
    );

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);

    const after = await testDb.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(after.stockQty).toBe(0);
    expect(after.stockQty).toBeGreaterThanOrEqual(0); // constraint holds
  });

  it("rolls back the slot booking when a later line is out of stock", async () => {
    const slot = await seedSlot({ capacity: 10 });
    const inStock = await seedProduct({ stockQty: 10 });
    const soldOut = await seedProduct({ stockQty: 0 });

    const r = await postCheckout(checkoutPayload({
      slotId: slot.id,
      items: [
        { productId: inStock.id, qty: 1 },
        { productId: soldOut.id, qty: 1 },
      ],
    }));

    expect(r.body.error.code).toBe("OUT_OF_STOCK");

    // The critical assertion: partial failure must leave NOTHING behind.
    const slotAfter = await testDb.pickupSlot.findUniqueOrThrow({ where: { id: slot.id } });
    const stockAfter = await testDb.product.findUniqueOrThrow({ where: { id: inStock.id } });
    expect(slotAfter.bookedCount).toBe(0);
    expect(stockAfter.stockQty).toBe(10);
    expect(await testDb.order.count()).toBe(0);
  });

  it("does not deadlock when two carts hold the same two products in reverse order", async () => {
    const slot = await seedSlot({ capacity: 50 });
    const a = await seedProduct({ stockQty: 50 });
    const b = await seedProduct({ stockQty: 50 });

    const results = await Promise.all([
      ...Array.from({ length: 10 }, () =>
        postCheckout(checkoutPayload({ slotId: slot.id, items: [
          { productId: a.id, qty: 1 }, { productId: b.id, qty: 1 },
        ]})),
      ),
      ...Array.from({ length: 10 }, () =>
        postCheckout(checkoutPayload({ slotId: slot.id, items: [
          { productId: b.id, qty: 1 }, { productId: a.id, qty: 1 },
        ]})),
      ),
    ]);

    // Deadlock surfaces as a 500, not a clean 409.
    expect(results.filter((r) => r.status === 500)).toHaveLength(0);
  });
});
```

`tests/concurrency/webhook.test.ts`:

```ts
describe("webhook idempotency", () => {
  beforeEach(resetDb);

  it("processes the same event three times with one effect", async () => {
    const order = await seedPendingCardOrder({ totalCents: 500 });
    const event = stripeEvent("payment_intent.succeeded", {
      id: order.stripePaymentIntentId,
      amount_received: 500,
    });

    // Sequential replay — Stripe's own retry behaviour.
    for (let i = 0; i < 3; i++) {
      const r = await postWebhook(event);
      expect(r.status).toBe(200);
    }

    const after = await testDb.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe("PAID");
    expect(await testDb.webhookEvent.count()).toBe(1);
    expect(emailSpy.mock.calls).toHaveLength(1);
  });

  it("handles concurrent delivery of the same event", async () => {
    const order = await seedPendingCardOrder({ totalCents: 500 });
    const event = stripeEvent("payment_intent.succeeded", {
      id: order.stripePaymentIntentId, amount_received: 500,
    });

    // Concurrent, not sequential. A check-then-insert dedupe passes the
    // sequential test above and fails this one.
    const results = await Promise.all([
      postWebhook(event), postWebhook(event), postWebhook(event),
    ]);

    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await testDb.webhookEvent.count()).toBe(1);
    expect(emailSpy.mock.calls).toHaveLength(1);
  });

  it("rejects an unsigned webhook", async () => {
    const r = await postWebhook(stripeEvent("payment_intent.succeeded", {}), { sign: false });
    expect(r.status).toBe(400);
  });

  it("ignores an amount that disagrees with the order", async () => {
    const order = await seedPendingCardOrder({ totalCents: 500 });
    await postWebhook(stripeEvent("payment_intent.succeeded", {
      id: order.stripePaymentIntentId,
      amount_received: 100, // tampered
    }));

    const after = await testDb.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe("PENDING"); // must NOT be PAID
  });
});
```

`tests/concurrency/sweep.test.ts`:

```ts
describe("expiry sweep", () => {
  beforeEach(resetDb);

  it("is idempotent when two sweeps run concurrently", async () => {
    const order = await seedPendingCardOrder({
      totalCents: 500, expiresAt: new Date(Date.now() - 60_000),
    });
    const before = await testDb.product.findUniqueOrThrow({
      where: { id: order.items[0].productId },
    });

    await Promise.all([runSweep(), runSweep(), runSweep()]);

    const after = await testDb.product.findUniqueOrThrow({ where: { id: before.id } });
    // Released exactly once, not three times.
    expect(after.stockQty).toBe(before.stockQty + order.items[0].qty);
  });

  it("does not release an order that just succeeded", async () => {
    const order = await seedPendingCardOrder({
      totalCents: 500, expiresAt: new Date(Date.now() - 1000),
    });

    await Promise.all([
      runSweep(),
      postWebhook(stripeEvent("payment_intent.succeeded", {
        id: order.stripePaymentIntentId, amount_received: 500,
      })),
    ]);

    const after = await testDb.order.findUniqueOrThrow({ where: { id: order.id } });
    // One of PAID or EXPIRED, never a torn state, and never both effects.
    expect(["PAID", "EXPIRED"]).toContain(after.status);
    const slot = await testDb.pickupSlot.findUniqueOrThrow({ where: { id: order.slotId } });
    expect(slot.bookedCount).toBeGreaterThanOrEqual(0);
  });
});
```

---

## 3. Priority 2 — money and tampering

```ts
describe("money integrity", () => {
  beforeEach(resetDb);

  it("ignores a tampered client total", async () => {
    const p = await seedProduct({ priceCents: 500, stockQty: 10 });
    const r = await postCheckout(checkoutPayload({
      items: [{ productId: p.id, qty: 2 }],
      clientTotalCents: 1, // "one cent, please"
    }));

    expect(r.status).toBe(200);
    expect(r.body.totalCents).toBe(1000);
    const order = await testDb.order.findFirstOrThrow();
    expect(order.totalCents).toBe(1000);
  });

  it.each([
    ["negative qty", -1],
    ["zero qty", 0],
    ["absurd qty", 99999],
    ["fractional qty", 1.5],
  ])("rejects %s", async (_label, qty) => {
    const p = await seedProduct({ stockQty: 10 });
    const r = await postCheckout(checkoutPayload({
      items: [{ productId: p.id, qty: qty as number }],
    }));
    expect(r.status).toBe(400);
  });

  it("rejects an inactive product", async () => {
    const p = await seedProduct({ active: false, stockQty: 10 });
    const r = await postCheckout(checkoutPayload({ items: [{ productId: p.id, qty: 1 }] }));
    expect(r.body.error.code).toBe("PRODUCT_UNAVAILABLE");
  });

  it("rejects a slot in the past", async () => {
    const slot = await seedSlot({ serviceDate: new Date("2020-01-01") });
    const r = await postCheckout(checkoutPayload({ slotId: slot.id }));
    expect(r.body.error.code).toBe("PAST_CUTOFF");
  });

  it("enforces the cutoff to the second", async () => {
    // cutoff = 45 min. Order at 46 min out succeeds, 44 min out fails.
    const ok = await postCheckout(checkoutPayload({ slotId: (await seedSlotMinutesFromNow(46)).id }));
    const no = await postCheckout(checkoutPayload({ slotId: (await seedSlotMinutesFromNow(44)).id }));
    expect(ok.status).toBe(200);
    expect(no.body.error.code).toBe("PAST_CUTOFF");
  });

  it("enforces the daily spend cap at the boundary", async () => {
    // cap 1500. Spend 1400, then try 100 (ok), then 1 more (rejected).
    await spend("kid@school.ca", 1400);
    expect((await spendAttempt("kid@school.ca", 100)).status).toBe(200);
    expect((await spendAttempt("kid@school.ca", 1)).body.error.code)
      .toBe("SPEND_CAP_EXCEEDED");
  });

  it("charges the snapshot price when the price changes mid-cart", async () => {
    const p = await seedProduct({ priceCents: 500, stockQty: 10 });
    await testDb.product.update({ where: { id: p.id }, data: { priceCents: 900 } });

    const r = await postCheckout(checkoutPayload({ items: [{ productId: p.id, qty: 1 }] }));
    const item = await testDb.orderItem.findFirstOrThrow();

    // Charged the CURRENT price, and snapshotted what was charged.
    expect(r.body.totalCents).toBe(900);
    expect(item.unitPriceCents).toBe(900);
  });

  it("does not return stock on refund", async () => {
    const order = await seedPaidOrder();
    const before = await testDb.product.findUniqueOrThrow({
      where: { id: order.items[0].productId },
    });
    await postWebhook(stripeEvent("charge.refunded", {
      payment_intent: order.stripePaymentIntentId,
    }));
    const after = await testDb.product.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.stockQty).toBe(before.stockQty); // staff adjusts manually
  });
});
```

---

## 4. Priority 3 — allergen integrity

Treat these like a medication dosage field.

```ts
describe("allergen data", () => {
  beforeEach(resetDb);

  it("survives the full round trip", async () => {
    const p = await seedProduct({ allergens: ["DAIRY", "GLUTEN", "SOY"], stockQty: 5 });
    const r = await postCheckout(checkoutPayload({ items: [{ productId: p.id, qty: 1 }] }));
    const item = await testDb.orderItem.findFirstOrThrow();

    expect(item.allergensSnapshot.sort()).toEqual(["DAIRY", "GLUTEN", "SOY"]);

    const confirmation = await getOrder(r.body.orderNumber);
    expect(confirmation.items[0].allergens).toEqual(
      expect.arrayContaining(["DAIRY", "GLUTEN", "SOY"]),
    );
  });

  it("does not mutate historical orders when a product is corrected", async () => {
    const p = await seedProduct({ allergens: ["DAIRY"], stockQty: 5 });
    await postCheckout(checkoutPayload({ items: [{ productId: p.id, qty: 1 }] }));

    await testDb.product.update({
      where: { id: p.id }, data: { allergens: ["DAIRY", "PEANUTS"] },
    });

    const item = await testDb.orderItem.findFirstOrThrow();
    expect(item.allergensSnapshot).toEqual(["DAIRY"]);
  });

  it("excludes matching products from a filtered catalog", async () => {
    await seedProduct({ name: "Nutty", allergens: ["PEANUTS"], stockQty: 5 });
    await seedProduct({ name: "Safe", allergens: [], stockQty: 5 });

    const r = await getProducts({ excludeAllergens: "PEANUTS" });
    expect(r.products.map((p: any) => p.name)).toEqual(["Safe"]);
  });

  it("excludes on ANY match, not ALL", async () => {
    // The classic hasSome/hasEvery bug. A product with DAIRY+PEANUTS
    // must be excluded when filtering PEANUTS alone.
    await seedProduct({ name: "Both", allergens: ["DAIRY", "PEANUTS"], stockQty: 5 });
    const r = await getProducts({ excludeAllergens: "PEANUTS" });
    expect(r.products).toHaveLength(0);
  });
});
```

---

## 5. Priority 4 — E2E

`tests/e2e/purchase.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("card purchase, happy path", async ({ page }) => {
  await page.goto("/snacks");
  await page.getByRole("button", { name: /add/i }).first().click();
  await page.getByRole("link", { name: /cart/i }).click();
  await page.getByRole("button", { name: /proceed/i }).click();

  await page.getByLabel("Full name").fill("Test Student");
  await page.getByLabel("Email").fill("test@school.ca");
  await page.getByLabel("Phone").fill("604-555-0100");
  await page.getByRole("radio", { name: /12:20/ }).check();
  await page.getByRole("button", { name: /proceed to extraction/i }).click();

  const frame = page.frameLocator("iframe[title*='payment']");
  await frame.getByPlaceholder("1234 1234 1234 1234").fill("4242424242424242");
  await frame.getByPlaceholder("MM / YY").fill("12/34");
  await frame.getByPlaceholder("CVC").fill("123");
  await page.getByRole("button", { name: /pay/i }).click();

  await expect(page.getByText(/victory royale/i)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/LL-\d{5}/)).toBeVisible();
});

test("declined card releases stock", async ({ page, request }) => {
  const before = await stockOf(request, "gummy-bear-pouch");
  await purchaseWithCard(page, "4000000000000002"); // generic decline
  await expect(page.getByRole("alert")).toContainText(/declined/i);
  await waitForSweep();
  expect(await stockOf(request, "gummy-bear-pouch")).toBe(before);
});

test("cash path skips Stripe entirely", async ({ page }) => {
  await purchaseWithCash(page);
  await expect(page.getByText(/pay at pickup/i)).toBeVisible();
  await expect(page.frameLocator("iframe[title*='payment']").locator("body"))
    .toHaveCount(0);
});

test("whole flow is keyboard-only", async ({ page }) => {
  await page.goto("/snacks");
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    const tag = await page.evaluate(() => document.activeElement?.tagName);
    expect(tag).not.toBe("BODY"); // focus never escapes to nowhere
  }
});

for (const path of ["/", "/snacks", "/cart", "/checkout", "/about"]) {
  test(`axe: ${path}`, async ({ page }) => {
    await page.goto(path);
    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(violations).toEqual([]);
  });
}
```

---

## 6. Priority 5 — leaks

```ts
describe("secret and PII leakage", () => {
  it("ships no server secrets to the client", async () => {
    execSync("npm run build");
    const bundle = execSync("cat .next/static/chunks/*.js").toString();
    for (const needle of ["sk_test_", "sk_live_", "whsec_", "postgresql://", "CRON_SECRET"]) {
      expect(bundle).not.toContain(needle);
    }
  });

  it("puts no PII in URLs", async ({ page }) => {
    await completePurchase(page, { email: "student@school.ca" });
    expect(page.url()).not.toContain("student@school.ca");
    expect(page.url()).not.toContain("604");
  });

  it("does not expose orders by guessable id", async ({ request }) => {
    // orderNumber is 5 random digits; the route must also require the
    // pickup code or a session, or this is a trivial enumeration hole.
    const r = await request.get("/api/orders/LL-10001");
    expect([401, 403, 404]).toContain(r.status());
  });
});
```

---

## 7. CI — `.github/workflows/ci.yml`

```yaml
name: CI
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npm run lint
      - run: npx prisma generate
      - run: npm run test:unit
      - run: npm run test:concurrency   # never allowed to be skipped
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
      - run: npm run test:leaks
```

---

## 8. Reporting

Report as: **what broke, minimal reproduction, severity.**

Do not fix backend or frontend code. File it in `docs/HANDOFF.md` and return to
the manager.

If a phase turned up nothing, say so plainly and list what you actually tried.
Do not pad the report, and do not describe a passing happy-path test as evidence
the feature is correct.

import { test, expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { e2eDb, seedProduct, seedSlot } from "./setup/db";
import { CATALOG } from "./setup/global-setup";
import {
  installReceiptCookie,
  placeOrder,
  primeCart,
  signInAsInventory,
  signInAsStaff,
  waitForHydration,
} from "./helpers";

/**
 * axe-core on every route, signed out and signed in, at both viewports.
 *
 * Two deliberate choices:
 *
 * 1. **`nextjs-portal` is excluded.** Next's dev-mode devtools overlay is
 *    injected into every page, is not shipped in a production build, and is not
 *    ours to fix. Leaving it in would produce identical violations on every
 *    route and drown anything real.
 *
 * 2. **The scan runs after hydration**, not on first paint. Several of these
 *    pages render a `role="status"` loading state first; scanning that measures
 *    the spinner rather than the screen.
 */

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/**
 * Tags one element so axe can be pointed at it.
 *
 * `AxeBuilder.include()` is handed straight to `document.querySelectorAll`, so
 * it takes REAL CSS only — Playwright engine syntax like `article:has-text("…")`
 * throws `SyntaxError: not a valid selector` inside the page and the test dies
 * with something that looks nothing like an accessibility result.
 */
async function scopeTo(page: Page, locator: Locator): Promise<string> {
  await locator.evaluate((el) => el.setAttribute("data-axe-scope", "1"));
  return "[data-axe-scope]";
}

async function scan(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(TAGS)
    .exclude("nextjs-portal")
    .analyze();

  // A bare `toEqual([])` prints an unreadable wall of axe JSON. This prints the
  // rule, the impact and the offending selector, which is what a fix starts from.
  return violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(" ")),
  }));
}

test.describe("axe — public routes, signed out", () => {
  for (const path of ["/", "/snacks", "/cart", "/checkout", "/about"]) {
    test(`no WCAG A/AA violations on ${path}`, async ({ page }) => {
      await page.goto(path);
      await waitForHydration(page, "a");
      expect(await scan(page)).toEqual([]);
    });
  }

  test("no violations on /snacks with a filter applied", async ({ page }) => {
    await page.goto("/snacks?category=savory&rarity=LEGENDARY");
    await waitForHydration(page, "a");
    expect(await scan(page)).toEqual([]);
  });
});

test.describe("axe — the states a page only reaches with data", () => {
  test("/cart with items in it", async ({ page }) => {
    const staple = await e2eDb.product.findUniqueOrThrow({
      where: { slug: CATALOG.staple.slug },
    });
    const nutty = await e2eDb.product.findUniqueOrThrow({ where: { slug: CATALOG.nutty.slug } });
    await primeCart(page, [
      { productId: staple.id, qty: 2 },
      { productId: nutty.id, qty: 1 },
    ]);
    await page.goto("/cart");
    await expect(page.getByText(CATALOG.staple.name)).toBeVisible();
    expect(await scan(page)).toEqual([]);
  });

  test("/checkout with a full form, a slot list and the payment radios", async ({ page }) => {
    const staple = await e2eDb.product.findUniqueOrThrow({
      where: { slug: CATALOG.staple.slug },
    });
    await primeCart(page, [{ productId: staple.id, qty: 1 }]);
    await page.goto("/checkout");
    await waitForHydration(page, "form");
    await expect(page.getByLabel("Full name")).toBeVisible();
    expect(await scan(page)).toEqual([]);
  });

  test("/checkout showing validation errors", async ({ page }) => {
    const staple = await e2eDb.product.findUniqueOrThrow({
      where: { slug: CATALOG.staple.slug },
    });
    await primeCart(page, [{ productId: staple.id, qty: 1 }]);
    await page.goto("/checkout");
    await waitForHydration(page, "form");
    await page.getByRole("button", { name: /confirm pickup order/i }).click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    expect(await scan(page)).toEqual([]);
  });

  test("/order/[orderNumber] — a secured receipt", async ({ page }) => {
    const slot = await seedSlot({ startsInMinutes: 200, capacity: 20 });
    const product = await seedProduct({
      priceCents: 250,
      stockQty: 20,
      allergens: ["DAIRY", "SESAME"],
    });
    const order = await placeOrder({
      slotId: slot.id,
      items: [{ productId: product.id, qty: 2 }],
    });
    await installReceiptCookie(page, order.orderNumber, order.receiptCookieHeader);
    await page.goto(`/order/${order.orderNumber}`);
    await expect(page.getByRole("heading", { name: /order secured/i })).toBeVisible();
    expect(await scan(page)).toEqual([]);
  });

  /**
   * `OrderConfirmation.tsx` used to render each line's rarity LABEL as
   * `style={{ color: rarityMeta(...).hex }}` at 10px on an `AngledPanel`
   * `tone={3}` — RARE and EPIC both measured under the 4.5:1 AA threshold for
   * normal text (docs/HANDOFF.md #70, fixed). It now renders as a solid
   * `background: hex` badge with `text-void`, the same pattern
   * `StockAdjuster.tsx` already used safely, which keeps contrast high
   * regardless of which rarity is shown. The fixture still pins RARE and EPIC
   * deliberately — a receipt for a COMMON item alone would not have caught the
   * original bug, and must not silently stop catching a regression either.
   */
  test("/order/[orderNumber] — a receipt containing RARE and EPIC lines", async ({ page }) => {
    const slot = await seedSlot({ startsInMinutes: 200, capacity: 20 });
    const rare = await seedProduct({ priceCents: 250, stockQty: 20, rarity: "RARE" });
    const epic = await seedProduct({ priceCents: 300, stockQty: 20, rarity: "EPIC" });
    const order = await placeOrder({
      slotId: slot.id,
      items: [
        { productId: rare.id, qty: 1 },
        { productId: epic.id, qty: 1 },
      ],
    });
    await installReceiptCookie(page, order.orderNumber, order.receiptCookieHeader);
    await page.goto(`/order/${order.orderNumber}`);
    await expect(page.getByRole("heading", { name: /order secured/i })).toBeVisible();
    expect(await scan(page)).toEqual([]);
  });

  test("/order/[orderNumber] — the not-found state", async ({ page }) => {
    await page.goto("/order/LL-00000");
    await expect(page.getByRole("heading", { name: /order not found/i })).toBeVisible();
    expect(await scan(page)).toEqual([]);
  });
});

test.describe("axe — staff admin", () => {
  test("signed out", async ({ page }) => {
    await page.goto("/admin");
    await waitForHydration(page, "form");
    await expect(page.getByRole("heading", { name: /staff sign-in/i })).toBeVisible();
    expect(await scan(page)).toEqual([]);
  });

  test("signed out, showing a failed sign-in", async ({ page }) => {
    await page.goto("/admin");
    await waitForHydration(page, "form");
    await page.getByLabel("Passcode").fill("wrong-passcode");
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    expect(await scan(page)).toEqual([]);
  });

  /**
   * `OrderRow.tsx` used to render each line's PRICE as
   * `style={{ color: rarityMeta(item.raritySnapshot).hex }}` on `bg-surface-2`
   * — RARE and EPIC both measured under 4.5:1 (docs/HANDOFF.md #70, fixed). A
   * per-line price has no reason to carry rarity colour at all (every other
   * price in the app uses a plain neutral text colour), so the fix removes
   * the rarity tint from the price entirely rather than reworking it into a
   * badge. The fixture still seeds one order per rarity deliberately — the
   * original version of this test used the default COMMON (6.5:1) and passed
   * on desktop while failing on mobile purely because a RARE product from an
   * earlier spec had accumulated in the same day's pick list, i.e. it was
   * finding the real bug by luck. Pinning all five rarities catches a
   * regression every time, not just when the data happens to line up.
   */
  test("signed in, with a populated pick list covering every rarity", async ({ page }) => {
    const slot = await seedSlot({ startsInMinutes: 200, capacity: 40, label: "Axe Rarity" });
    for (const rarity of ["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"] as const) {
      const product = await seedProduct({
        priceCents: 250,
        stockQty: 20,
        rarity,
        allergens: ["PEANUTS"],
      });
      await placeOrder({
        slotId: slot.id,
        items: [{ productId: product.id, qty: 1 }],
        studentName: `Axe ${rarity}`,
        homeroom: "7A",
      });
    }

    await signInAsStaff(page);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: /pick list/i })).toBeVisible({
      timeout: 20_000,
    });
    await waitForHydration(page, "button");
    expect(await scan(page)).toEqual([]);
  });

  test("signed in, with a COMMON-only pick list (the state that does pass)", async ({ page }) => {
    const slot = await seedSlot({ startsInMinutes: 200, capacity: 20, label: "Axe Common" });
    const product = await seedProduct({
      priceCents: 250,
      stockQty: 20,
      rarity: "COMMON",
      allergens: ["PEANUTS"],
    });
    const order = await placeOrder({
      slotId: slot.id,
      items: [{ productId: product.id, qty: 1 }],
      studentName: "Axe Student",
      homeroom: "7A",
    });

    await signInAsStaff(page);
    // `?date=` is not enough to isolate one order — the pick list is a whole
    // service day — so this scans only this order's card rather than the page,
    // which keeps it green independently of what other specs seeded.
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: /pick list/i })).toBeVisible({
      timeout: 20_000,
    });
    await waitForHydration(page, "button");

    const card = page.locator("article").filter({ hasText: order.orderNumber });
    await expect(card).toBeVisible();
    const { violations } = await new AxeBuilder({ page })
      .withTags(TAGS)
      .include(await scopeTo(page, card))
      .exclude("nextjs-portal")
      .analyze();
    expect(
      violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(" ")) })),
    ).toEqual([]);
  });

  test("signed in, with the pickup and refund confirmations open", async ({ page }) => {
    const slot = await seedSlot({ startsInMinutes: 200, capacity: 20, label: "Axe Confirm" });
    // COMMON on purpose: this test is about the confirmation UI, not about the
    // rarity-price contrast bug the two tests above pin. The scan is scoped to
    // this order's card so an unrelated RARE order seeded by another spec into
    // the same service day cannot turn it red.
    const product = await seedProduct({ priceCents: 250, stockQty: 20, rarity: "COMMON" });
    const order = await placeOrder({
      slotId: slot.id,
      items: [{ productId: product.id, qty: 1 }],
    });
    await e2eDb.order.update({
      where: { id: order.id },
      data: { status: "PAID", paidAt: new Date() },
    });

    await signInAsStaff(page);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: /pick list/i })).toBeVisible({
      timeout: 20_000,
    });
    await waitForHydration(page, "button");

    const card = page.locator("article").filter({ hasText: order.orderNumber });
    await card.getByRole("button", { name: /mark picked up/i }).click();
    await card.getByRole("button", { name: /^refund$/i }).click();
    await expect(card.getByRole("checkbox")).toBeVisible();

    const { violations } = await new AxeBuilder({ page })
      .withTags(TAGS)
      .include(await scopeTo(page, card))
      .exclude("nextjs-portal")
      .analyze();
    expect(
      violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(" ")) })),
    ).toEqual([]);
  });
});

test.describe("axe — inventory editor", () => {
  test("signed out", async ({ page }) => {
    await page.goto("/inventory");
    await waitForHydration(page, "form");
    await expect(page.getByRole("heading", { name: /catalog sign-in/i })).toBeVisible();
    expect(await scan(page)).toEqual([]);
  });

  test("signed in, with the product list", async ({ page }) => {
    await seedProduct({ name: `Axe Inv ${Date.now()}`, allergens: ["SOY"], stockQty: 3 });
    await signInAsInventory(page);
    await page.goto("/inventory");
    await expect(page.getByRole("heading", { name: /catalog editor/i })).toBeVisible({
      timeout: 20_000,
    });
    await waitForHydration(page, "button");
    expect(await scan(page)).toEqual([]);
  });

  test("signed in, with the create form and the allergen checklist open", async ({ page }) => {
    await signInAsInventory(page);
    await page.goto("/inventory");
    await expect(page.getByRole("heading", { name: /catalog editor/i })).toBeVisible({
      timeout: 20_000,
    });
    await waitForHydration(page, "button");
    await page.getByRole("button", { name: /add a new product/i }).click();
    await expect(page.locator("#create-allergens-reviewed")).toBeVisible();
    expect(await scan(page)).toEqual([]);
  });

  test("signed in, with the stock adjuster open", async ({ page }) => {
    const p = await seedProduct({ name: `Axe Inv Stock ${Date.now()}`, stockQty: 5 });
    await signInAsInventory(page);
    await page.goto("/inventory");
    await expect(page.getByRole("heading", { name: /catalog editor/i })).toBeVisible({
      timeout: 20_000,
    });
    await waitForHydration(page, "button");
    const row = page.locator("li").filter({ hasText: p.name }).first();
    await row.getByRole("button", { name: /adjust stock/i }).click();
    await expect(row.getByRole("button", { name: /apply/i })).toBeVisible();
    expect(await scan(page)).toEqual([]);
  });
});

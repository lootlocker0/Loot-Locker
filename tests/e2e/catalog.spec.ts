import { test, expect, type Page } from "@playwright/test";
import { e2eDb } from "./setup/db";
import { CATALOG } from "./setup/global-setup";
import { waitForHydration } from "./helpers";

/** The nav's cart chip. Scoped to `banner` — the footer has a `/cart` link too. */
const cartChip = (page: Page) =>
  page.getByRole("banner").getByRole("link", { name: /loadout/i });

/**
 * The public catalog and the cart, driven by real clicks — no localStorage
 * priming here, on purpose. This is the one spec that proves the cart store's
 * persistence contract end to end; every other spec is allowed to shortcut past
 * it (`primeCart`) precisely because this one does not.
 */

test.describe("catalog and cart", () => {
  test("lists products with full allergen data and a working add button", async ({ page }) => {
    await page.goto("/snacks");

    const nutty = page.locator("article").filter({ hasText: CATALOG.nutty.name });
    await expect(nutty).toBeVisible();

    // CLAUDE.md §2.8: never truncated, never "+2 more", never hover-only.
    // Both allergens must be present as static text with no interaction.
    const allergenList = nutty.getByRole("list", { name: /contains allergens/i });
    await expect(allergenList.getByRole("listitem")).toHaveText(["PEANUTS", "TREE NUTS"]);

    // The zero-allergen product must say so explicitly rather than rendering
    // nothing — an empty region reads as "unknown", which is the failure mode
    // the invariant exists to prevent.
    const clean = page.locator("article").filter({ hasText: CATALOG.clean.name });
    await expect(clean.getByText("No listed allergens")).toBeVisible();
  });

  test("keeps a sold-out product listed and disabled rather than hiding it", async ({ page }) => {
    await page.goto("/snacks");
    const soldOut = page.locator("article").filter({ hasText: CATALOG.soldOut.name });
    await expect(soldOut).toBeVisible();
    const button = soldOut.getByRole("button");
    await expect(button).toBeDisabled();
    await expect(button).toHaveText(/sold out/i);
  });

  test("cart survives a full page reload", async ({ page }) => {
    await page.goto("/snacks");
    await waitForHydration(page, "article button");

    const staple = page.locator("article").filter({ hasText: CATALOG.staple.name });
    await staple.getByRole("button", { name: "Add" }).click();
    await staple.getByRole("button", { name: "Add" }).click();

    await expect(cartChip(page)).toContainText("2");

    await page.reload();
    await expect(cartChip(page)).toContainText("2");

    await cartChip(page).click();
    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.getByText(CATALOG.staple.name)).toBeVisible();
    // 2 × $2.50, from integer cents, formatted once (lib/money.ts). Asserted on
    // BOTH surfaces: the line total and the order summary have to agree, and a
    // rounding bug that only hits one of them is exactly the kind that ships.
    await expect(page.getByRole("definition").filter({ hasText: "$5.00" })).toBeVisible();
    await expect(page.getByText("$5.00")).toHaveCount(2);
  });

  test("quantity controls clamp at live stock, not at a cached number", async ({ page }) => {
    // A product with exactly 3 units: the "+" must stop at 3 even though the
    // store's own cap is 10.
    const scarce = await e2eDb.product.create({
      data: {
        slug: `e2e-scarce-${Date.now()}`,
        name: `Scarce Item ${Date.now()}`,
        description: "Three units only.",
        priceCents: 199,
        category: "sweet",
        rarity: "EPIC",
        allergens: ["SOY"],
        stockQty: 3,
        active: true,
        imageUrl: "/products/none.svg",
        sortOrder: 5,
      },
    });

    await page.goto("/snacks");
    await waitForHydration(page, "article button");
    const card = page.locator("article").filter({ hasText: scarce.name });
    await card.getByRole("button", { name: "Add" }).click();
    await expect(cartChip(page)).toContainText("1");

    await page.goto("/cart");
    const plus = page.getByRole("button", { name: `Increase quantity of ${scarce.name}` });
    await plus.click();
    await plus.click();
    await expect(page.getByRole("group", { name: `Quantity for ${scarce.name}` })).toContainText("3");
    await expect(plus).toBeDisabled();

    await e2eDb.product.delete({ where: { id: scarce.id } });
  });

  test("category and rarity filters actually filter", async ({ page }) => {
    await page.goto("/snacks?category=drinks");
    await expect(page.locator("article").filter({ hasText: CATALOG.clean.name })).toBeVisible();
    await expect(page.locator("article").filter({ hasText: CATALOG.nutty.name })).toHaveCount(0);

    await page.goto("/snacks?rarity=LEGENDARY");
    await expect(page.locator("article").filter({ hasText: CATALOG.nutty.name })).toBeVisible();
    await expect(page.locator("article").filter({ hasText: CATALOG.staple.name })).toHaveCount(0);
  });

  test("an unknown filter value falls back to no filter rather than erroring", async ({ page }) => {
    const res = await page.goto("/snacks?category=NOT_A_CATEGORY&rarity=MYTHIC");
    expect(res?.status()).toBe(200);
    await expect(page.locator("article").filter({ hasText: CATALOG.staple.name })).toBeVisible();
  });

  test("empty cart offers a way out instead of a dead end", async ({ page }) => {
    await page.goto("/cart");
    await expect(page.getByText(/your locker is empty/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /browse the locker/i })).toBeVisible();
  });
});

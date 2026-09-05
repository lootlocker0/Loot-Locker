import { test, expect, type Page } from "@playwright/test";
import { e2eDb, seedProduct, seedSlot } from "./setup/db";
import { CATALOG } from "./setup/global-setup";
import { installReceiptCookie, placeOrder, primeCart, waitForHydration } from "./helpers";

/**
 * What a browser ACTUALLY downloads, per route.
 *
 * `tests/leaks/bundle.test.ts` greps the built artifact on disk, which cannot
 * answer "does a student loading `/snacks` receive the staff data model" —
 * Turbopack emits no per-route chunk manifest, so route-to-chunk attribution
 * only exists at request time. This spec answers it by watching the network.
 *
 * It runs against `next dev`, so the chunk NAMES differ from a production
 * build; the module content that matters (whose code is in which route's graph)
 * does not.
 */

async function scriptsFor(page: Page, path: string): Promise<string[]> {
  const bodies: Promise<string>[] = [];
  page.on("response", (res) => {
    const url = res.url();
    if (!url.includes("/_next/") || !/\.js(\?|$)/.test(url)) return;
    bodies.push(res.text().catch(() => ""));
  });
  await page.goto(path);
  await waitForHydration(page, "a, button, form");
  await page.waitForTimeout(1_000);
  return Promise.all(bodies);
}

test.describe("what the public shop downloads", () => {
  for (const path of ["/", "/snacks", "/cart", "/about"]) {
    test(`${path} ships no staff or inventory code to a student`, async ({ page }) => {
      const scripts = await scriptsFor(page, path);
      expect(scripts.length, `${path} loaded no JS at all — nothing was measured`).toBeGreaterThan(
        0,
      );
      const all = scripts.join("\n");

      // Staff-only surfaces. A student's browser has no reason to hold the
      // pick-list data model, the refund flow, or either passcode screen.
      for (const needle of [
        "studentName",
        "homeroom",
        "pickupCode",
        "/api/admin/",
        "/api/inventory/",
        "manages the deployment that",
        "Mark picked up",
        "Confirm refund",
        "allergensReviewed",
      ]) {
        expect(all, `${path} shipped "${needle}" to the public bundle`).not.toContain(needle);
      }
    });
  }

  test("no server secret reaches the browser on any public route", async ({ page }) => {
    for (const path of ["/", "/snacks", "/cart", "/checkout", "/about"]) {
      const all = (await scriptsFor(page, path)).join("\n");
      for (const needle of [
        "sk_test_",
        "sk_live_",
        "whsec_",
        "postgresql://",
        "postgres://",
        "CRON_SECRET",
        "ORDER_SESSION_SECRET",
        "STRIPE_SECRET_KEY",
        "RESEND_API_KEY",
      ]) {
        expect(all, `${path} shipped "${needle}"`).not.toContain(needle);
      }
    }
  });

  test("/checkout ships the checkout schema but still no staff surface", async ({ page }) => {
    const staple = await e2eDb.product.findUniqueOrThrow({
      where: { slug: CATALOG.staple.slug },
    });
    await primeCart(page, [{ productId: staple.id, qty: 1 }]);
    const all = (await scriptsFor(page, "/checkout")).join("\n");

    // The checkout form legitimately builds `{studentName, email, phone}` in
    // the browser — that is the request body, not a leak.
    expect(all).toContain("studentName");
    // What it must not carry is the staff/inventory half of the app.
    for (const needle of ["/api/admin/", "Confirm refund", "Mark packed"]) {
      expect(all, `/checkout shipped "${needle}"`).not.toContain(needle);
    }
  });
});

test.describe("no PII in URLs (CLAUDE.md §2.6)", () => {
  test("nothing personal survives a full purchase into the address bar", async ({ page }) => {
    const staple = await e2eDb.product.findUniqueOrThrow({
      where: { slug: CATALOG.staple.slug },
    });
    await primeCart(page, [{ productId: staple.id, qty: 1 }]);

    const urls: string[] = [];
    page.on("framenavigated", (f) => urls.push(f.url()));
    // Query strings on API calls count too — a GET with an email in it lands in
    // every proxy and access log between the school and the server.
    page.on("request", (r) => urls.push(r.url()));

    await page.goto("/checkout");
    await waitForHydration(page, "form");
    await page.getByLabel("Full name").fill("Wren Castellanos");
    await page.getByLabel("Email", { exact: true }).fill("wren.castellanos@school.ca");
    await page.getByLabel("Phone").fill("604-555-0123");
    await page
      .getByRole("radio", { name: /^\d{2}:\d{2}/ })
      .first()
      .check({ force: true });
    await page.getByRole("button", { name: /confirm pickup order/i }).click();
    await expect(page).toHaveURL(/\/order\/LL-\d{5}$/, { timeout: 20_000 });

    for (const url of urls) {
      const decoded = decodeURIComponent(url).toLowerCase();
      expect(decoded, `PII in a URL: ${url}`).not.toContain("wren");
      expect(decoded, `PII in a URL: ${url}`).not.toContain("castellanos");
      expect(decoded, `PII in a URL: ${url}`).not.toContain("@school.ca");
      expect(decoded, `PII in a URL: ${url}`).not.toContain("604-555-0123");
    }
  });
});

test.describe("page metadata that reaches a student, a parent, or a link preview", () => {
  const EXPECTED_TITLES: [string, RegExp][] = [
    ["/", /LootLockers/],
    ["/snacks", /LootLockers/],
    ["/cart", /LootLockers/],
    ["/checkout", /LootLockers/],
    ["/about", /LootLockers/],
  ];

  for (const [path, pattern] of EXPECTED_TITLES) {
    test(`${path} has a real title`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveTitle(pattern);
      expect(await page.title()).not.toMatch(/create next app/i);
    });
  }

  /**
   * `/order/[orderNumber]` is a Client Component by necessity (the receipt
   * cookie is `Path=/api/orders`, so a Server Component could not read the
   * order — the file says so itself). A Client Component cannot export
   * `metadata`, so it falls back to the ROOT layout's default. That default
   * was create-next-app's boilerplate (docs/HANDOFF.md #73, fixed) and is now
   * a real LootLockers title — this test guards the fallback itself, not just
   * this one route, since any future Client Component page inherits it too.
   */
  test("the confirmation page does not fall back to create-next-app boilerplate", async ({
    page,
  }) => {
    const slot = await seedSlot({ startsInMinutes: 200, capacity: 20 });
    const product = await seedProduct({ priceCents: 250, stockQty: 20 });
    const order = await placeOrder({
      slotId: slot.id,
      items: [{ productId: product.id, qty: 1 }],
    });
    await installReceiptCookie(page, order.orderNumber, order.receiptCookieHeader);
    await page.goto(`/order/${order.orderNumber}`);
    await expect(page.getByRole("heading", { name: /order secured/i })).toBeVisible();

    expect(await page.title()).not.toMatch(/create next app/i);
  });

  test("staff and inventory screens are marked noindex", async ({ page }) => {
    for (const path of ["/admin", "/inventory"]) {
      await page.goto(path);
      const robots = await page.locator('meta[name="robots"]').getAttribute("content");
      expect(robots, `${path} is not marked noindex`).toMatch(/noindex/);
    }
  });
});

import { test, expect, type Page } from "@playwright/test";
import { e2eDb, seedProduct, seedSlot } from "./setup/db";
import { CATALOG } from "./setup/global-setup";
import {
  describeFocus,
  focusIsVisible,
  installReceiptCookie,
  placeOrder,
  primeCart,
  signInAsInventory,
  signInAsStaff,
  waitForHydration,
} from "./helpers";

/**
 * Keyboard-only. No mouse, anywhere in this file — every interaction is Tab,
 * Shift+Tab, arrow keys, Space or Enter.
 *
 * Two different things are being checked and they fail independently:
 *
 *   OPERABILITY (WCAG 2.1.1) — can the task be completed at all without a
 *   pointer. A `<div onClick>` fails this.
 *   FOCUS VISIBILITY (WCAG 2.4.7) — can a sighted keyboard user SEE where they
 *   are. A control hidden with `sr-only` inside a styled label passes
 *   operability and fails this, because Chromium draws the focus ring on the
 *   1×1 clipped input rather than on the thing the user can see.
 */

/**
 * Tabs until any element matching `target` holds focus. Returns the stop count.
 *
 * `locator.evaluate` is deliberately not used here: it runs in strict mode, so
 * a selector matching more than one element (three pickup windows, the `/snacks`
 * link in both the nav and the footer) throws instead of matching — and a
 * `.catch(() => false)` around it turns that into a silent "never reached",
 * which reads as a keyboard-accessibility bug in the product. `$$eval` over all
 * matches has no such trap.
 */
async function tabTo(page: Page, target: string, max = 80): Promise<number> {
  for (let i = 1; i <= max; i++) {
    await page.keyboard.press("Tab");
    const hit = await page.$$eval(
      target,
      (els) => els.some((el) => el === document.activeElement),
    );
    if (hit) return i;
  }
  throw new Error(`never reached ${target} within ${max} tab stops`);
}

test.describe("keyboard — the public shop", () => {
  // `/snacks` is filtered to one category on purpose: the catalog accumulates
  // every product seeded by every other spec during a run, and an unfiltered
  // grid turns this into hundreds of round-trips without testing anything the
  // filtered grid does not.
  for (const path of ["/", "/snacks?category=drinks", "/cart", "/about"]) {
    test(`every interactive control on ${path} is reachable by Tab, with no trap`, async ({
      page,
    }) => {
      await page.goto(path);
      await waitForHydration(page, "a");

      /*
       * The naive version of this test — "press Tab 40 times, assert focus is
       * never on BODY" — is wrong and would fail on a correct page. Tabbing past
       * the last control moves focus into the browser's own chrome, which
       * surfaces as `document.activeElement === body`; that is the browser
       * working, not a stranded user. It also counts Next's dev-only
       * `<nextjs-portal>` devtools overlay as an app control.
       *
       * The properties actually worth asserting are:
       *   - COVERAGE: every visible link/button/field can be reached by Tab
       *     alone (a mouse-only control is a WCAG 2.1.1 failure), and
       *   - NO TRAP (WCAG 2.1.2): focus never sticks on one element forever.
       */
      // `document.querySelectorAll` deliberately, not Playwright's `$$eval`
      // selector engine: the latter pierces open shadow roots, which drags in
      // Next's dev-only "Open Next.js Dev Tools" button from inside
      // `<nextjs-portal>`'s shadow DOM and reports it as an unreachable app
      // control on every single page.
      const interactive = await page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLElement>(
            "a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex='-1'])",
          ),
        ]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            return cs.visibility !== "hidden" && cs.display !== "none" && r.width + r.height > 0;
          })
          .map((el, i) => {
            el.setAttribute("data-kb-probe", String(i));
            return String(i);
          }),
      );
      expect(interactive.length, `${path} has no interactive controls at all`).toBeGreaterThan(0);

      const reached = new Set<string>();
      let previous: string | null = null;
      let stuck = 0;

      const budget = Math.min(interactive.length * 3 + 20, 400);
      for (let i = 0; i < budget; i++) {
        await page.keyboard.press("Tab");
        // Identity comes from the probe attribute, never from tag+class: the
        // catalog's filter chips are a row of links with byte-identical
        // classNames and no id, so a class-based key reports "focus stuck" on
        // a tab order that is in fact advancing normally.
        const probe = await page.evaluate(
          () => (document.activeElement as HTMLElement | null)?.getAttribute?.("data-kb-probe") ?? null,
        );

        if (probe !== null) {
          reached.add(probe);
          if (probe === previous) {
            if (++stuck >= 3) {
              throw new Error(`keyboard trap on ${path}: focus stuck on probe ${probe}`);
            }
          } else {
            stuck = 0;
          }
        } else {
          stuck = 0;
        }
        previous = probe;
      }

      const unreachable = interactive.filter((i) => !reached.has(i));
      const described =
        unreachable.length === 0
          ? []
          : await page.$$eval(
              unreachable.map((i) => `[data-kb-probe="${i}"]`).join(","),
              (els) =>
                els.map(
                  (el) =>
                    `<${el.tagName.toLowerCase()}> ${
                      el.getAttribute("aria-label") ?? (el.textContent ?? "").trim().slice(0, 50)
                    }`,
                ),
            );
      expect(
        described.join(" | "),
        `these visible controls on ${path} cannot be reached with the keyboard`,
      ).toBe("");
    });
  }

  test("a product can be added to the cart with the keyboard alone", async ({ page }) => {
    // Filtered to the one fixture product. Unfiltered, `/snacks` accumulates
    // every product every other spec has seeded during the run, so "tab until
    // you reach Staple Bar" needs an unbounded number of stops and fails for a
    // reason that has nothing to do with the keyboard.
    await page.goto(`/snacks?category=drinks&rarity=UNCOMMON`);
    await waitForHydration(page, "article button");

    const addButton = `article:has(h3:text-is("${CATALOG.clean.name}")) button`;
    await tabTo(page, addButton);
    expect(
      await focusIsVisible(page),
      "the Add button has no visible focus indicator",
    ).toBe(true);

    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("banner").getByRole("link", { name: /loadout/i }),
    ).toContainText("1");
  });

  test("cart quantity and removal are reachable and operable by keyboard", async ({ page }) => {
    const staple = await e2eDb.product.findUniqueOrThrow({
      where: { slug: CATALOG.staple.slug },
    });
    await primeCart(page, [{ productId: staple.id, qty: 2 }]);
    await page.goto("/cart");
    await waitForHydration(page, "button");

    const dec = `button[aria-label="Decrease quantity of ${CATALOG.staple.name}"]`;
    await tabTo(page, dec);
    expect(await focusIsVisible(page)).toBe(true);
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("group", { name: `Quantity for ${CATALOG.staple.name}` }),
    ).toContainText("1");

    // Remove is a real <button>, so Enter must work on it too.
    await tabTo(page, 'button:text-is("Remove")');
    await page.keyboard.press("Enter");
    await expect(page.getByText(/your locker is empty/i)).toBeVisible();
  });
});

test.describe("keyboard — checkout, including the payment-method radio group", () => {
  test("a whole cash order can be placed without a mouse", async ({ page }) => {
    const staple = await e2eDb.product.findUniqueOrThrow({
      where: { slug: CATALOG.staple.slug },
    });
    await primeCart(page, [{ productId: staple.id, qty: 1 }]);
    await page.goto("/checkout");
    await waitForHydration(page, "form");

    await tabTo(page, "#studentName");
    await page.keyboard.type("Keyboard Student");
    await page.keyboard.press("Tab");
    await page.keyboard.type(`kb-${Date.now()}@school.ca`);
    await page.keyboard.press("Tab");
    await page.keyboard.type("604-555-0100");

    // Pickup window: a radio group, so Tab reaches the group and the arrow keys
    // move within it. This is the interaction the `sr-only` inputs exist for.
    await tabTo(page, 'input[name="slot"]:not([disabled])');
    await page.keyboard.press("Space");
    await expect(page.locator('input[name="slot"]:checked')).toHaveCount(1);

    // Payment method: same shape, and the default must already be a real
    // selection so a student who never reaches it still gets a valid order.
    await expect(page.locator('input[name="paymentMethod"]:checked')).toHaveCount(1);
    await tabTo(page, 'input[name="paymentMethod"]');
    await page.keyboard.press("ArrowDown");
    await expect(page.locator('input[name="paymentMethod"][value="CARD"]')).toBeChecked();
    await page.keyboard.press("ArrowUp");
    await expect(
      page.locator('input[name="paymentMethod"][value="CASH_AT_PICKUP"]'),
    ).toBeChecked();

    await tabTo(page, 'button[type="submit"]');
    expect(
      await focusIsVisible(page),
      "the submit button has no visible focus indicator",
    ).toBe(true);
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/order\/LL-\d{5}$/, { timeout: 20_000 });
  });

  /**
   * `SlotPicker` and the payment-method group render their radios with
   * Tailwind's `sr-only`, which is `position:absolute; width:1px; height:1px;
   * clip-path:inset(50%)`. `app/globals.css`'s `:focus-visible` outline did
   * apply, but to that 1×1 clipped box — invisible. Fixed (docs/HANDOFF.md
   * #72) by adding `focus-within:outline` to the wrapping `<label>`, so the
   * visible indicator moves to the element a sighted user can actually see
   * when the hidden radio inside it takes focus.
   */
  test("WCAG 2.4.7 — every focusable control shows a visible focus indicator", async ({
    page,
  }) => {
    const staple = await e2eDb.product.findUniqueOrThrow({
      where: { slug: CATALOG.staple.slug },
    });
    await primeCart(page, [{ productId: staple.id, qty: 1 }]);
    await page.goto("/checkout");
    await waitForHydration(page, "form");

    const invisible: string[] = [];
    for (let i = 0; i < 45; i++) {
      await page.keyboard.press("Tab");
      const tag = await page.evaluate(() => document.activeElement?.tagName ?? "NONE");
      if (tag === "BODY" || tag === "NONE") break;
      // Real Tab presses use the browser's native focus order, which — unlike
      // `document.querySelectorAll` above — does reach the host element of
      // Next's dev-only `<nextjs-portal>` devtools overlay. That is dev-mode
      // tooling, not part of the app under test, and does not exist in a
      // production build; skip it rather than holding this app to a visible-
      // focus standard for a control it does not render.
      if (tag === "NEXTJS-PORTAL") continue;
      if (!(await focusIsVisible(page))) invisible.push(await describeFocus(page));
    }

    expect(
      invisible,
      "these controls take keyboard focus with no indicator a sighted user can see:\n  " +
        invisible.join("\n  "),
    ).toEqual([]);
  });

  /**
   * The fix's mechanism, pinned so a regression reads as a number and not
   * just "axe said so": the radio itself stays a focusable 1×1 clipped box
   * (removing `sr-only` was not the fix), but its wrapping `<label>` now
   * draws a solid outline the moment that hidden radio takes focus.
   */
  test("the checkout radios are focusable but clipped to 1×1, with the label carrying the visible focus ring", async ({
    page,
  }) => {
    const staple = await e2eDb.product.findUniqueOrThrow({
      where: { slug: CATALOG.staple.slug },
    });
    await primeCart(page, [{ productId: staple.id, qty: 1 }]);
    await page.goto("/checkout");
    await waitForHydration(page, "form");

    for (const selector of ['input[name="slot"]', 'input[name="paymentMethod"]']) {
      const measured = await page.locator(selector).first().evaluate((el) => {
        el.focus();
        const cs = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const label = el.closest("label");
        const lcs = label ? getComputedStyle(label) : null;
        return {
          focused: document.activeElement === el,
          width: rect.width,
          height: rect.height,
          clipPath: cs.clipPath,
          labelOutlineStyle: lcs?.outlineStyle ?? "n/a",
        };
      });

      expect(measured.focused, `${selector} could not take focus`).toBe(true);
      expect(measured.width).toBeLessThanOrEqual(1);
      expect(measured.height).toBeLessThanOrEqual(1);
      expect(measured.clipPath).not.toBe("none");
      // The visible signal now lives on the label, not the clipped input.
      expect(measured.labelOutlineStyle).toBe("solid");
    }
  });
});

test.describe("keyboard — staff admin action buttons", () => {
  test("pack, pickup, cash and refund are all operable without a mouse", async ({ page }) => {
    const slot = await seedSlot({ startsInMinutes: 200, capacity: 20, label: "Keyboard Service" });
    const product = await seedProduct({ priceCents: 175, stockQty: 20 });
    const order = await placeOrder({
      slotId: slot.id,
      items: [{ productId: product.id, qty: 1 }],
      paymentMethod: "CASH_AT_PICKUP",
      studentName: "Keyboard Cash",
    });

    await signInAsStaff(page);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: /pick list/i })).toBeVisible({
      timeout: 20_000,
    });
    await waitForHydration(page, "button");

    const card = page.locator("article").filter({ hasText: order.orderNumber });

    // Pack
    const packButton = card.getByRole("button", { name: /mark packed/i });
    await packButton.focus();
    expect(await focusIsVisible(page), "Mark packed has no visible focus ring").toBe(true);
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => (await e2eDb.order.findUniqueOrThrow({ where: { id: order.id } })).status)
      .toBe("PACKED");

    // Record cash
    const cashButton = page
      .locator("article")
      .filter({ hasText: order.orderNumber })
      .getByRole("button", { name: /record cash/i });
    await cashButton.focus();
    await page.keyboard.press("Enter");
    await expect
      .poll(
        async () =>
          (await e2eDb.order.findUniqueOrThrow({ where: { id: order.id } })).paidAt !== null,
      )
      .toBe(true);

    // Pickup — opens a form; the code field must take focus and Enter must
    // submit it, because a staff member at a locker is holding a bag in one
    // hand.
    const pickupButton = page
      .locator("article")
      .filter({ hasText: order.orderNumber })
      .getByRole("button", { name: /mark picked up/i });
    await pickupButton.focus();
    await page.keyboard.press("Enter");

    const codeField = page
      .locator("article")
      .filter({ hasText: order.orderNumber })
      .getByLabel(/pickup code/i);
    await expect(codeField).toBeFocused();
    await page.keyboard.type(order.pickupCode);
    await page.keyboard.press("Enter");

    await expect
      .poll(async () => (await e2eDb.order.findUniqueOrThrow({ where: { id: order.id } })).status)
      .toBe("PICKED_UP");
  });

  test("the refund confirmation, its seat checkbox and its buttons are keyboard-operable", async ({
    page,
  }) => {
    const slot = await seedSlot({ startsInMinutes: 200, capacity: 20, label: "KB Refund" });
    const product = await seedProduct({ priceCents: 300, stockQty: 20 });
    const order = await placeOrder({
      slotId: slot.id,
      items: [{ productId: product.id, qty: 1 }],
      paymentMethod: "CASH_AT_PICKUP",
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
    await card.getByRole("button", { name: /^refund$/i }).focus();
    await page.keyboard.press("Enter");

    const seatBox = card.getByRole("checkbox");
    await seatBox.focus();
    expect(await focusIsVisible(page), "the seat-release checkbox has no focus ring").toBe(true);
    await page.keyboard.press("Space");
    await expect(seatBox).toBeChecked();

    await card.getByRole("button", { name: /confirm refund/i }).focus();
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => (await e2eDb.order.findUniqueOrThrow({ where: { id: order.id } })).status)
      .toBe("REFUNDED");
  });

  test("the stock adjuster is reachable and submits on Enter", async ({ page }) => {
    const slot = await seedSlot({ startsInMinutes: 200, capacity: 20, label: "KB Stock" });
    const product = await seedProduct({
      priceCents: 250,
      stockQty: 15,
      name: `KB Adjustable ${Date.now()}`,
    });
    await placeOrder({ slotId: slot.id, items: [{ productId: product.id, qty: 1 }] });

    await signInAsStaff(page);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: /pick list/i })).toBeVisible({
      timeout: 20_000,
    });
    await waitForHydration(page, "button");

    const row = page.locator("#stock-adjustment li").filter({ hasText: product.name });
    await row.getByRole("textbox").focus();
    expect(await focusIsVisible(page)).toBe(true);
    await page.keyboard.type("+3");
    // Enter inside a single-line form field must submit — not do nothing.
    await page.keyboard.press("Enter");

    await expect
      .poll(async () => (await e2eDb.product.findUniqueOrThrow({ where: { id: product.id } })).stockQty)
      .toBe(17);
  });
});

test.describe("keyboard — inventory editor", () => {
  test("the allergen checklist and its affirmation are fully keyboard-operable", async ({
    page,
  }) => {
    await signInAsInventory(page);
    await page.goto("/inventory");
    await expect(page.getByRole("heading", { name: /catalog editor/i })).toBeVisible({
      timeout: 20_000,
    });
    await waitForHydration(page, "button");

    await page.getByRole("button", { name: /add a new product/i }).focus();
    await page.keyboard.press("Enter");

    const peanuts = page.locator("#create-allergen-PEANUTS");
    await peanuts.focus();
    expect(
      await focusIsVisible(page),
      "an allergen checkbox has no visible focus indicator — this is the safety checklist",
    ).toBe(true);
    await page.keyboard.press("Space");
    await expect(peanuts).toBeChecked();

    const affirm = page.locator("#create-allergens-reviewed");
    await affirm.focus();
    expect(await focusIsVisible(page)).toBe(true);
    await page.keyboard.press("Space");
    await expect(affirm).toBeChecked();

    // …and the reset-on-edit rule still fires from a keyboard toggle.
    await peanuts.focus();
    await page.keyboard.press("Space");
    await expect(affirm).not.toBeChecked();
  });

  test("the inventory stock adjuster submits on Enter", async ({ page }) => {
    const p = await seedProduct({ name: `KB Inv Stock ${Date.now()}`, stockQty: 6 });
    await signInAsInventory(page);
    await page.goto("/inventory");
    await expect(page.getByRole("heading", { name: /catalog editor/i })).toBeVisible({
      timeout: 20_000,
    });
    await waitForHydration(page, "button");

    const row = page.locator("li").filter({ hasText: p.name }).first();
    await row.getByRole("button", { name: /adjust stock/i }).focus();
    await page.keyboard.press("Enter");
    await row.getByLabel(new RegExp(`adjust stock for ${p.name}`, "i")).focus();
    await page.keyboard.type("-2");
    await page.keyboard.press("Enter");

    await expect
      .poll(async () => (await e2eDb.product.findUniqueOrThrow({ where: { id: p.id } })).stockQty)
      .toBe(4);
  });
});

test.describe("keyboard — order confirmation", () => {
  test("the receipt page traps nobody and its actions are reachable", async ({ page }) => {
    const slot = await seedSlot({ startsInMinutes: 200, capacity: 20 });
    const product = await seedProduct({ priceCents: 250, stockQty: 20 });
    const order = await placeOrder({
      slotId: slot.id,
      items: [{ productId: product.id, qty: 1 }],
    });
    await installReceiptCookie(page, order.orderNumber, order.receiptCookieHeader);
    await page.goto(`/order/${order.orderNumber}`);
    await expect(page.getByRole("heading", { name: /order secured/i })).toBeVisible();

    await tabTo(page, 'a[href="/snacks"]:below(:text("Manifest"))', 40).catch(async () => {
      // Fall back to any link back into the shop; the point is that one is
      // reachable by keyboard, not which one.
      await tabTo(page, 'a[href="/snacks"]', 40);
    });
    expect(await focusIsVisible(page)).toBe(true);
  });
});

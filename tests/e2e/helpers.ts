/* eslint-disable @typescript-eslint/no-explicit-any --
 * API responses are asserted as untyped JSON on purpose, same reasoning as
 * tests/helpers.ts: typing them against a hand-written interface would test
 * the interface rather than the bytes the route returned.
 */
import { randomBytes } from "crypto";
import Stripe from "stripe";
import type { Page, APIRequestContext } from "@playwright/test";
import { e2eDb, uniq } from "./setup/db";
import {
  ADMIN_PASSCODE,
  E2E_BASE_URL,
  INVENTORY_PASSCODE,
  STRIPE_WEBHOOK_SECRET,
} from "./setup/env";

// ─────────────────────────────────────────────────────────────────────────────
// Cart seeding without clicking
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `stores/cart.ts` is a zustand store persisted to localStorage. Writing it
 * directly is how a spec that is testing the CHECKOUT page starts on the
 * checkout page instead of re-walking the catalog for the twentieth time.
 *
 * Specs that are testing the catalog itself click the real buttons — see
 * `catalog.spec.ts`. This helper exists so the other specs' failures point at
 * the thing they are actually about.
 */
export async function primeCart(
  page: Page,
  lines: { productId: string; qty: number }[],
) {
  await page.addInitScript(
    ([storageKey, value]) => {
      window.localStorage.setItem(storageKey as string, value as string);
    },
    [
      CART_STORAGE_KEY,
      JSON.stringify({ state: { lines }, version: CART_STORE_VERSION }),
    ],
  );
}

/**
 * Mirrors `stores/cart.ts`'s `persist` config (`name`, `version`). Frontend
 * owns that file; if it bumps SCHEMA_VERSION these constants go stale and
 * `primeCart` silently seeds a cart zustand then discards as incompatible —
 * which would look like "the checkout page thinks the cart is empty". The
 * round-trip assertion in `catalog.spec.ts` ("cart survives a reload", driven
 * by real clicks) is what catches that, so the drift cannot pass unnoticed.
 */
export const CART_STORAGE_KEY = "ll-cart";
export const CART_STORE_VERSION = 2;

/**
 * Waits until React has actually hydrated `selector`.
 *
 * This is NOT harness ceremony. `/snacks` is a Server Component that renders
 * the "Add" button in the HTML; the button is visible, enabled and clickable
 * to Playwright (and to a student) before `ProductGrid`'s client bundle has
 * attached its `onClick`. A click in that window is silently discarded — the
 * cart badge stays at 0 and nothing tells the user anything happened.
 *
 * The probe is React's own fiber key, which only appears on a DOM node once
 * that node has been hydrated. Recorded as a real finding in docs/HANDOFF.md;
 * the wait is here so the rest of this spec measures what it is about.
 */
export async function waitForHydration(page: Page, selector: string) {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    return Object.keys(el).some((k) => k.startsWith("__reactFiber$"));
  }, selector);
}

// ─────────────────────────────────────────────────────────────────────────────
// Stripe webhook forgery — local HMAC, no Stripe account (HANDOFF §20)
// ─────────────────────────────────────────────────────────────────────────────

const stripeSdk = new Stripe("sk_test_placeholder");

export function stripeEvent(type: string, object: Record<string, unknown>) {
  return {
    id: `evt_${randomBytes(12).toString("hex")}`,
    object: "event",
    api_version: "2026-08-26.dahlia",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    type,
    data: { object },
  };
}

export function paymentIntentSucceeded(intentId: string, amountReceived: number) {
  return stripeEvent("payment_intent.succeeded", {
    id: intentId,
    object: "payment_intent",
    amount: amountReceived,
    amount_received: amountReceived,
    currency: "cad",
    status: "succeeded",
  });
}

/** Posts a correctly-signed webhook straight at the route, no browser. */
export async function postWebhook(event: Record<string, unknown>) {
  const payload = JSON.stringify(event);
  const res = await fetch(`${E2E_BASE_URL}/api/webhooks/stripe`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": stripeSdk.webhooks.generateTestHeaderString({
        payload,
        secret: STRIPE_WEBHOOK_SECRET,
      }),
    },
    body: payload,
  });
  return { status: res.status, text: await res.text() };
}

// ─────────────────────────────────────────────────────────────────────────────
// Orders placed through the real route, not inserted
// ─────────────────────────────────────────────────────────────────────────────

export interface PlaceOrderOpts {
  slotId: string;
  items: { productId: string; qty: number }[];
  paymentMethod?: "CARD" | "CASH_AT_PICKUP";
  studentName?: string;
  email?: string;
  phone?: string;
  homeroom?: string;
}

/**
 * Drives `POST /api/checkout` directly. Used to build the fixtures the ADMIN
 * specs act on — a hand-inserted order row cannot reproduce the stock and seat
 * holds the release path is supposed to give back, and
 * `order_total_consistent` / `booked_within_capacity` reject sloppy inserts
 * anyway.
 *
 * Returns the receipt cookie too: `GET /api/orders/[orderNumber]` is authorised
 * by it and by nothing else (API-CONTRACT §6).
 */
export async function placeOrder(opts: PlaceOrderOpts) {
  const res = await fetch(`${E2E_BASE_URL}/api/checkout`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
    },
    body: JSON.stringify({
      studentName: opts.studentName ?? `E2E Student ${uniq()}`,
      email: opts.email ?? `e2e-${uniq()}@school.ca`,
      phone: opts.phone ?? "604-555-0100",
      ...(opts.homeroom ? { homeroom: opts.homeroom } : {}),
      slotId: opts.slotId,
      paymentMethod: opts.paymentMethod ?? "CASH_AT_PICKUP",
      items: opts.items,
    }),
  });
  const body: any = await res.json();
  if (res.status !== 200) {
    throw new Error(`placeOrder failed ${res.status}: ${JSON.stringify(body)}`);
  }
  const cookies = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]);
  const order = await e2eDb.order.findUniqueOrThrow({
    where: { orderNumber: body.orderNumber },
    include: { items: true },
  });
  return { ...order, response: body, receiptCookieHeader: cookies.join("; ") };
}

/**
 * Installs the per-order receipt cookie into the browser context so the
 * confirmation page can read the order. The cookie is `Path=/api/orders`
 * (API-CONTRACT §6 / HANDOFF §28) — set it on that path, not on `/`, or the
 * poll gets `ORDER_NOT_FOUND` and the page renders "Order not found" for an
 * environmental reason.
 */
export async function installReceiptCookie(
  page: Page,
  orderNumber: string,
  cookieHeader: string,
) {
  const pair = cookieHeader
    .split("; ")
    .find((c) => c.startsWith(`ll_ord_${orderNumber}=`));
  if (!pair) throw new Error(`no receipt cookie for ${orderNumber} in: ${cookieHeader}`);
  const [name, ...rest] = pair.split("=");
  await page.context().addCookies([
    {
      name,
      value: rest.join("="),
      domain: "localhost",
      path: "/api/orders",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Sign-in, via the real login routes
// ─────────────────────────────────────────────────────────────────────────────

/** Signs the browser context into `/admin` without retyping the passcode. */
export async function signInAsStaff(page: Page) {
  const res = await page.request.post("/api/admin/login", {
    data: { passcode: ADMIN_PASSCODE },
  });
  if (!res.ok()) {
    throw new Error(`staff sign-in failed ${res.status()}: ${await res.text()}`);
  }
}

/** Signs the browser context into `/inventory`. Its OWN passcode (§6b). */
export async function signInAsInventory(page: Page) {
  const res = await page.request.post("/api/inventory/login", {
    data: { passcode: INVENTORY_PASSCODE },
  });
  if (!res.ok()) {
    throw new Error(`inventory sign-in failed ${res.status()}: ${await res.text()}`);
  }
}

export async function inventoryApiToken(request: APIRequestContext) {
  const res = await request.post("/api/inventory/login", {
    data: { passcode: INVENTORY_PASSCODE },
  });
  if (!res.ok()) throw new Error(`inventory login ${res.status()}`);
}

export async function adminApiToken(request: APIRequestContext) {
  const res = await request.post("/api/admin/login", {
    data: { passcode: ADMIN_PASSCODE },
  });
  if (!res.ok()) throw new Error(`admin login ${res.status()}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Focus / keyboard
// ─────────────────────────────────────────────────────────────────────────────

/** A short, stable description of whatever currently holds focus. */
export async function describeFocus(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return "<null>";
    const label =
      el.getAttribute("aria-label") ??
      (el as HTMLInputElement).name ??
      el.id ??
      (el.textContent ?? "").trim().slice(0, 40);
    return `${el.tagName.toLowerCase()}[${(el as HTMLInputElement).type ?? ""}]:${label}`;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Contrast
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The WCAG 2.x contrast ratio between an element's rendered text colour and its
 * nearest opaque background, measured in the page rather than computed from
 * hexes in a spreadsheet.
 *
 * Worth having alongside axe: axe reports "this node fails", the number is what
 * tells you whether a fix moved it from 4.1 to 4.6 or to 4.49.
 */
export async function contrastOf(page: Page, selector: string): Promise<number> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`no element for ${sel}`);

    const parse = (c: string): [number, number, number, number] => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return [0, 0, 0, 0];
      const p = m[1].split(",").map((n) => parseFloat(n));
      return [p[0], p[1], p[2], p[3] ?? 1];
    };
    const lin = (v: number) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const lum = ([r, g, b]: number[]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

    const fg = parse(getComputedStyle(el).color);

    // Walk up until something paints an opaque background.
    let node: Element | null = el;
    let bg: [number, number, number, number] = [255, 255, 255, 1];
    while (node) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c[3] === 1) {
        bg = c;
        break;
      }
      node = node.parentElement;
    }

    const l1 = lum(fg);
    const l2 = lum(bg);
    const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
    return (hi + 0.05) / (lo + 0.05);
  }, selector);
}

/**
 * True when the focused element renders a focus indicator that a sighted
 * keyboard user can actually see (WCAG 2.4.7).
 *
 * Chromium draws its default focus ring via `outline` on the element that has
 * `:focus-visible`. An element hidden with the `sr-only` clip pattern is
 * focusable and gets that outline, but the outline is clipped to a 1×1 box —
 * i.e. invisible — so the CHECK is deliberately not "does an outline exist" but
 * "is the outline on something with a real box, or does an ancestor visibly
 * react to `:focus-within`".
 */
export async function focusIsVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return false;

    const box = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const hasOwnRing =
      cs.outlineStyle !== "none" &&
      parseFloat(cs.outlineWidth) > 0 &&
      box.width > 4 &&
      box.height > 4;
    if (hasOwnRing) return true;

    // Visually-hidden control (the `sr-only` pattern): the indicator, if any,
    // has to come from an ancestor styled on :focus-within.
    let node: HTMLElement | null = el.parentElement;
    for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
      const acs = getComputedStyle(node);
      if (acs.outlineStyle !== "none" && parseFloat(acs.outlineWidth) > 0) return true;
      // A ring drawn as a box-shadow (Tailwind's `focus-within:ring-*`).
      if (acs.boxShadow && acs.boxShadow !== "none") return true;
    }
    return false;
  });
}

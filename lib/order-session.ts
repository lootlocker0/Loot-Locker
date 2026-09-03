import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { logEvent } from "./log";

// Proof that the browser in front of us is the one that placed a given order.
//
// WHY THIS EXISTS (docs/HANDOFF.md §22). `GET /api/orders/[orderNumber]` has to
// exist — a card order is PENDING when checkout returns and only the Stripe
// webhook flips it to PAID, so the confirmation page must poll. But an order
// number is `LL-#####`: 90,000 values, trivially enumerated. It must not by
// itself be enough to read a child's pickup code, let alone their name or
// address (CLAUDE.md §2.6). So checkout hands back a signed, httpOnly cookie
// scoped to the one order it just created, and the read route trusts the cookie
// rather than the URL.
//
// Chosen over the alternatives because it needs no PII round-trip: nothing has
// to be re-typed, nothing has to survive the Stripe redirect in sessionStorage
// or a query string, and it works identically for cash and card.
//
// WHAT THIS IS NOT. It is a signature, not encryption, and not a login. Anyone
// holding the cookie can read that one order and no other. It expires on its own
// in 48 hours — long enough for a same-day pickup problem to be sorted out, far
// short of a durable bearer credential. The order's cuid is readable inside the
// token by anyone who can already read the browser's cookie jar; that is not a
// second secret (no route accepts an order id) and encrypting it would buy
// nothing but a key-rotation problem.

const TOKEN_VERSION = "v1";

/// 48 hours. A student who cannot find their snack at Tuesday lunch can still
/// pull up the receipt on Wednesday; by Thursday the order is history and the
/// cookie is worthless.
export const ORDER_SESSION_TTL_SECONDS = 48 * 60 * 60;

/// Scoped to the read route and nothing else, so it is not attached to page
/// loads, static assets, or any future endpoint that has its own auth.
export const ORDER_SESSION_COOKIE_PATH = "/api/orders";

const COOKIE_PREFIX = "ll_ord_";

const IS_PROD = process.env.NODE_ENV === "production";

// ─────────────────────────────────────────────────────────────────────────────
// Key resolution — once per process, same shape as lib/rate-limit.ts
// ─────────────────────────────────────────────────────────────────────────────
//
//   configured     ORDER_SESSION_SECRET is set. The real thing.
//   ephemeral-dev  Not set, not production. A random per-process key, so dev and
//                  CI work out of the box; cookies stop verifying when the
//                  server restarts, which is a dev annoyance and nothing more.
//   unconfigured   Not set, in production. Fail closed — see below.
//
// The neither-prefix note: `__Host-`/`__Secure-` cookie prefixes are not used
// because `__Host-` forbids a Path other than `/` (we want `/api/orders`) and
// both require `Secure`, which local http dev cannot set. The httpOnly +
// SameSite + signature properties are what actually carry the weight here.

type KeyMode = "configured" | "ephemeral-dev" | "unconfigured-production";

function resolveKey(): { mode: KeyMode; key: Buffer | null } {
  const secret = process.env.ORDER_SESSION_SECRET;
  if (secret && secret.length > 0) {
    return { mode: "configured", key: Buffer.from(secret, "utf8") };
  }
  if (!IS_PROD) {
    return { mode: "ephemeral-dev", key: randomBytes(32) };
  }
  return { mode: "unconfigured-production", key: null };
}

const resolved = resolveKey();

export const orderSessionMode: KeyMode = resolved.mode;

logEvent("order_session_mode", { mode: orderSessionMode });

/// Call this at the TOP of any handler that will need to issue a cookie, before
/// anything is created or charged.
///
/// Fail-closed in production is deliberate, and the reasoning is the same as the
/// rate limiter's: a production deployment with no signing secret can still take
/// a student's money but can never show them their pickup code, and the only
/// symptom is a confirmation page that says "not found" for an order that really
/// exists. Refusing the checkout instead is loud, costs nobody any money, and is
/// fixed by setting one environment variable.
export function assertOrderSessionConfigured(): void {
  if (!resolved.key) {
    throw new Error(
      "ORDER_SESSION_SECRET is not set. Order confirmation cookies cannot be " +
        "signed, so checkout refuses rather than creating orders nobody can read.",
    );
  }
}

function key(): Buffer {
  assertOrderSessionConfigured();
  return resolved.key!;
}

// ─────────────────────────────────────────────────────────────────────────────
// Token
// ─────────────────────────────────────────────────────────────────────────────
//
//   v1.<orderId>.<expiryUnixSeconds>.<base64url HMAC-SHA256 of the first three>
//
// The order id is a cuid and the expiry is digits, so neither can contain the
// separator and the split is unambiguous. The token binds the *database id*, not
// the human-facing order number: the read route resolves the id and then checks
// that the row it found carries the order number in the URL, so a valid cookie
// for order A cannot read order B by editing the address bar.

const b64url = (b: Buffer) => b.toString("base64url");

function mac(payload: string): string {
  return b64url(createHmac("sha256", key()).update(payload).digest());
}

export function signOrderSessionToken(
  orderId: string,
  nowMs: number = Date.now(),
): string {
  const exp = Math.floor(nowMs / 1000) + ORDER_SESSION_TTL_SECONDS;
  const payload = `${TOKEN_VERSION}.${orderId}.${exp}`;
  return `${payload}.${mac(payload)}`;
}

/// Returns the order id the token was issued for, or `null` for anything wrong:
/// wrong version, malformed, forged, tampered, or expired.
///
/// Callers must not distinguish between those cases in a response. A student
/// with a broken cookie and an attacker probing order numbers get the same
/// answer (same reasoning as SLOT_FULL in checkout: an error that explains
/// itself is an oracle).
export function verifyOrderSessionToken(
  token: string | undefined | null,
  nowMs: number = Date.now(),
): string | null {
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 4) return null;

  const [version, orderId, expRaw, providedMac] = parts;
  if (version !== TOKEN_VERSION) return null;
  if (!orderId || !expRaw || !providedMac) return null;
  if (!/^\d{1,15}$/.test(expRaw)) return null;

  // Verify the signature BEFORE trusting the expiry — the expiry is part of the
  // signed payload, so an unverified one is just an attacker's number.
  const expected = Buffer.from(mac(`${version}.${orderId}.${expRaw}`), "utf8");
  const provided = Buffer.from(providedMac, "utf8");
  // Length-checked first because timingSafeEqual throws on a mismatch. Constant
  // time so the comparison cannot be walked one byte at a time.
  if (expected.length !== provided.length) return null;
  if (!timingSafeEqual(expected, provided)) return null;

  if (Number(expRaw) * 1000 <= nowMs) return null;

  return orderId;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cookie
// ─────────────────────────────────────────────────────────────────────────────
//
// One cookie per order, named after the order number, rather than a single
// `ll_order` that each checkout overwrites. A student who places two orders in
// one sitting (cash for today, card for tomorrow) can then open either receipt;
// with one shared cookie the first order becomes unreadable the moment the
// second is placed. The name is not a credential and the value still binds the
// id — renaming a cookie to another order's number changes nothing, because the
// signature covers the id and the route re-checks it against the URL.

export function orderSessionCookieName(orderNumber: string): string {
  return `${COOKIE_PREFIX}${orderNumber}`;
}

export type OrderSessionCookie = {
  name: string;
  value: string;
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
};

export function orderSessionCookie(order: {
  id: string;
  orderNumber: string;
}): OrderSessionCookie {
  return {
    name: orderSessionCookieName(order.orderNumber),
    value: signOrderSessionToken(order.id),
    // No script ever needs to read this, and a receipt token in `document.cookie`
    // is one XSS away from being someone else's.
    httpOnly: true,
    // http on localhost cannot set a Secure cookie; every real deployment is
    // https, and NODE_ENV is the only thing that decides this.
    secure: IS_PROD,
    // Lax, not Strict: the student comes back from Stripe by top-level
    // navigation and the cookie must survive that. Not None — nothing
    // cross-site has any business reading a receipt.
    sameSite: "lax",
    path: ORDER_SESSION_COOKIE_PATH,
    maxAge: ORDER_SESSION_TTL_SECONDS,
  };
}

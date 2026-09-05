import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";
import { AppError } from "./errors";
import { logEvent } from "./log";

// Inventory-editor authentication for app/api/inventory/**.
//
// THE POINT OF THIS FILE IS THAT IT IS A SEPARATE FILE.
//
// The people who hold this credential are two thirteen-year-old family members
// doing catalog upkeep. The requirement (BUILDPLAN.md §P4b) is not "show them a
// smaller screen" — it is that orders, student names, emails, phones,
// homerooms, payment status, refunds, Stripe and settings are unreachable **at
// the route and auth level** through anything this session can present.
//
// So this is deliberately NOT a role flag inside lib/admin-session.ts. A role
// flag means one verification function, one cookie, one code path and one
// `if (session.role === "admin")` standing between a catalog editor and every
// child's name — and a bug in that branch is a total loss of the boundary.
// Three separate modules, three separate secrets, three separate cookie names:
//
//   ll_ord_<orderNumber>   a student, one order, read-only, 48 hours
//   ll_admin               staff, every order, writes money and stock, 8 hours
//   ll_inventory           catalog editor, Product rows only, 8 hours
//
// A token minted by any one of them verifies under neither of the others' keys
// nor under their cookie names. There is no shared state below this line except
// the crypto primitives themselves.
//
// WHAT THIS IS NOT. Same limitation as the staff passcode: one shared value, no
// roster, no per-person account. `sessionId` identifies a *sign-in*, not a
// person, so the log can say "the same browser created these four products" and
// can never say which of the two editors was holding it. Flagged in
// docs/HANDOFF.md; with two people rather than a whole staff room it is a much
// smaller problem, but it is the same problem.

const TOKEN_VERSION = "v1";

/// Eight hours, matching the staff session. Long enough for an evening of
/// catalog entry, short enough that a session opened on a family laptop is not
/// still live next week.
export const INVENTORY_SESSION_TTL_SECONDS = 8 * 60 * 60;

export const INVENTORY_SESSION_COOKIE = "ll_inventory";

/// Path `/` rather than `/api/inventory`, so a future `/inventory` page can
/// decide whether to draw a sign-in form without a round-trip — the same
/// rendering convenience the staff cookie has, and the same caveat: it is NOT
/// the authorisation boundary. Every handler under app/api/inventory/** calls
/// `requireInventorySession` itself.
export const INVENTORY_SESSION_COOKIE_PATH = "/";

/// Same floor as the staff passcode. This credential cannot read a child's name
/// or move money directly, but it CAN set the price a student is charged, so it
/// is not a low-value credential and it is not given a weaker minimum.
const MIN_PASSCODE_LENGTH = 8;

const IS_PROD = process.env.NODE_ENV === "production";

// ─────────────────────────────────────────────────────────────────────────────
// Signing key
// ─────────────────────────────────────────────────────────────────────────────
//
//   configured                INVENTORY_SESSION_SECRET is set. The real thing.
//   ephemeral-dev             Not set, not production. Random per-process key,
//                             so dev and CI work; sessions stop verifying on
//                             restart, which is an annoyance and nothing more.
//   unconfigured-production   Not set, in production. Nobody can sign in.

type KeyMode = "configured" | "ephemeral-dev" | "unconfigured-production";

function resolveKey(): { mode: KeyMode; key: Buffer | null } {
  const secret = process.env.INVENTORY_SESSION_SECRET;
  if (secret && secret.length > 0) {
    return { mode: "configured", key: Buffer.from(secret, "utf8") };
  }
  if (!IS_PROD) return { mode: "ephemeral-dev", key: randomBytes(32) };
  return { mode: "unconfigured-production", key: null };
}

const resolvedKey = resolveKey();

export const inventorySessionKeyMode: KeyMode = resolvedKey.mode;

// ─────────────────────────────────────────────────────────────────────────────
// Passcode
// ─────────────────────────────────────────────────────────────────────────────
//
// INVENTORY_PASSCODE is a DIFFERENT value from ADMIN_PASSCODE, and that
// separation is the requirement, not a convenience: the two editors must not
// hold the credential that opens the staff screen. If an operator sets them to
// the same string the two systems still stay apart — different secrets mean the
// cookies remain non-interchangeable — but the staff screen is then one
// remembered passcode away, so `.env.example` says so in capitals.
//
// No default, no dev fallback, in any environment.

type PasscodeMode = "configured" | "unset" | "too-short";

function resolvePasscode(): { mode: PasscodeMode; digest: Buffer | null } {
  const raw = process.env.INVENTORY_PASSCODE ?? "";
  if (raw.length === 0) return { mode: "unset", digest: null };
  if (raw.length < MIN_PASSCODE_LENGTH) return { mode: "too-short", digest: null };
  return { mode: "configured", digest: sha256(raw) };
}

function sha256(v: string): Buffer {
  return createHash("sha256").update(v, "utf8").digest();
}

const resolvedPasscode = resolvePasscode();

export const inventoryPasscodeMode: PasscodeMode = resolvedPasscode.mode;

/// Reported once per process so an operator can see, in the boot log, that the
/// inventory credential is separately configured from the staff one. Never
/// carries either value.
logEvent("inventory_session_mode", {
  key: inventorySessionKeyMode,
  passcode: inventoryPasscodeMode,
  ...(inventoryPasscodeMode === "too-short"
    ? { minPasscodeLength: MIN_PASSCODE_LENGTH }
    : {}),
});

/// Throws `INVENTORY_NOT_CONFIGURED` (503) when this server cannot authenticate
/// an inventory editor at all. Called by the login route before anything else,
/// and by `requireInventorySession`, so removing the secret cannot leave
/// existing cookies working.
export function assertInventoryConfigured(): void {
  if (!resolvedKey.key || !resolvedPasscode.digest) {
    logEvent("inventory_not_configured", {
      key: inventorySessionKeyMode,
      passcode: inventoryPasscodeMode,
    });
    throw new AppError("INVENTORY_NOT_CONFIGURED");
  }
}

/// Constant-time passcode check. Both sides are digested first because
/// `timingSafeEqual` throws on a length mismatch, and length-checking the raw
/// input first leaks the passcode's length to anyone who can measure a response.
export function verifyInventoryPasscode(candidate: string): boolean {
  const expected = resolvedPasscode.digest;
  if (!expected) return false;
  return timingSafeEqual(sha256(candidate), expected);
}

// ─────────────────────────────────────────────────────────────────────────────
// Token — v1.<sessionId>.<expiryUnixSeconds>.<base64url HMAC-SHA256>
// ─────────────────────────────────────────────────────────────────────────────

function key(): Buffer {
  assertInventoryConfigured();
  return resolvedKey.key!;
}

function mac(payload: string): string {
  return createHmac("sha256", key()).update(payload).digest("base64url");
}

/// Random per sign-in, so a run of catalog edits can be correlated in the logs
/// without identifying a child. Not a user id; no route treats it as an
/// authorisation input.
export const newInventorySessionId = () => randomBytes(6).toString("hex");

export interface InventorySession {
  sessionId: string;
}

export function signInventorySessionToken(
  sessionId: string,
  nowMs: number = Date.now(),
): string {
  const exp = Math.floor(nowMs / 1000) + INVENTORY_SESSION_TTL_SECONDS;
  const payload = `${TOKEN_VERSION}.${sessionId}.${exp}`;
  return `${payload}.${mac(payload)}`;
}

/// Returns the session id, or `null` for anything wrong — malformed, wrong
/// version, forged, tampered, expired, or signed with a different key (which is
/// exactly what a staff or receipt token renamed onto this cookie is). Callers
/// must not distinguish the cases.
export function verifyInventorySessionToken(
  token: string | undefined | null,
  nowMs: number = Date.now(),
): string | null {
  if (!token) return null;
  if (!resolvedKey.key || !resolvedPasscode.digest) return null;

  const parts = token.split(".");
  if (parts.length !== 4) return null;

  const [version, sessionId, expRaw, providedMac] = parts;
  if (version !== TOKEN_VERSION) return null;
  if (!sessionId || !expRaw || !providedMac) return null;
  if (!/^[0-9a-f]{4,64}$/.test(sessionId)) return null;
  if (!/^\d{1,15}$/.test(expRaw)) return null;

  // Signature before expiry: the expiry is inside the signed payload, so an
  // unverified one is just an attacker's number.
  const expected = Buffer.from(mac(`${version}.${sessionId}.${expRaw}`), "utf8");
  const provided = Buffer.from(providedMac, "utf8");
  if (expected.length !== provided.length) return null;
  if (!timingSafeEqual(expected, provided)) return null;

  if (Number(expRaw) * 1000 <= nowMs) return null;

  return sessionId;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cookie
// ─────────────────────────────────────────────────────────────────────────────

export interface InventorySessionCookie {
  name: string;
  value: string;
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
}

export function inventorySessionCookie(sessionId: string): InventorySessionCookie {
  return {
    name: INVENTORY_SESSION_COOKIE,
    value: signInventorySessionToken(sessionId),
    httpOnly: true,
    secure: IS_PROD,
    // ── THIS IS THE CSRF DEFENCE. ────────────────────────────────────────────
    // SameSite=Lax withholds the cookie from every cross-site POST/PATCH, so a
    // page on another origin cannot make an editor's browser deactivate the
    // whole catalog or reprice it.
    //
    // It holds only while this invariant holds, and it is on every route in the
    // namespace: NO INVENTORY ROUTE MAY EVER PERFORM A SIDE EFFECT ON A GET.
    // Lax *does* send this cookie on a cross-site top-level GET navigation. The
    // GET routes here are JSON reads that cross-origin script cannot read back
    // (no CORS headers), which is harmless — the moment a GET writes something,
    // this cookie becomes a CSRF hole.
    sameSite: "lax",
    path: INVENTORY_SESSION_COOKIE_PATH,
    maxAge: INVENTORY_SESSION_TTL_SECONDS,
  };
}

/// Same name and path, empty and already expired. The path must match the one
/// the cookie was set with or the browser silently keeps the original.
export function clearedInventorySessionCookie(): InventorySessionCookie {
  return {
    name: INVENTORY_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: IS_PROD,
    sameSite: "lax",
    path: INVENTORY_SESSION_COOKIE_PATH,
    maxAge: 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

/// The gate. First statement of every handler under app/api/inventory/**.
///
/// Throws `INVENTORY_NOT_CONFIGURED` (503) if this server cannot authenticate an
/// editor at all, and `INVENTORY_UNAUTHORIZED` (401) otherwise. Never returns a
/// partially trusted state, and never consults the staff cookie: presenting a
/// valid `ll_admin` token here is exactly as unauthorised as presenting nothing.
export function requireInventorySession(req: NextRequest): InventorySession {
  assertInventoryConfigured();
  const token = req.cookies.get(INVENTORY_SESSION_COOKIE)?.value;
  const sessionId = verifyInventorySessionToken(token);
  if (!sessionId) {
    logEvent("inventory_auth_denied", {
      reason: token ? "invalid_token" : "no_cookie",
    });
    throw new AppError("INVENTORY_UNAUTHORIZED");
  }
  return { sessionId };
}

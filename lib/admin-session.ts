import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";
import { AppError } from "./errors";
import { logEvent } from "./log";

// Staff authentication for app/api/admin/**.
//
// Same construction as lib/order-session.ts — HMAC-SHA256 over a versioned
// payload, timing-safe comparison, httpOnly cookie, fail closed in production —
// but a DELIBERATELY SEPARATE secret, cookie name and code path. The two must
// not overlap:
//
//   ll_ord_<orderNumber>   a student, one order, read-only, 48 hours
//   ll_admin               staff, every order, writes money and stock, 8 hours
//
// Sharing a secret between them would mean a bug or a leak in the student-facing
// receipt path becomes staff access to every child's name and every refund
// button. They are signed with different keys so that cannot happen: a token
// minted by one verifies under neither the other's key nor the other's cookie
// name.
//
// WHAT THIS IS NOT. There is no staff roster and no per-person account — this is
// a single shared passcode, recorded as a placeholder in docs/HANDOFF.md and
// awaiting a human decision. The consequence to know: `sessionId` below
// identifies a *sign-in*, not a person, so the audit log can say "the same
// browser packed these six orders" and can never say who was holding it.

const TOKEN_VERSION = "v1";

/// Eight hours: one school day. A staff session should not outlive the service
/// it was opened for, and a shared-device sign-in that persists into the evening
/// is exactly the failure a shared passcode makes easy.
export const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;

export const ADMIN_SESSION_COOKIE = "ll_admin";

/// Path `/` rather than `/api/admin`, so the `/admin` page itself can decide
/// whether to render a sign-in form or the pick list without a round-trip.
///
/// This is a rendering convenience and NOT the authorisation boundary. Every
/// route handler under app/api/admin/** calls `requireAdminSession` itself; a
/// page that reads this cookie is deciding what to draw, never what data exists.
export const ADMIN_SESSION_COOKIE_PATH = "/";

/// A 6-digit PIN is ~10^6 guesses; a distributed attacker with a botnet walks
/// that in an afternoon regardless of per-IP limiting, and this passcode opens
/// every child's name and a refund button. Anything shorter than this is
/// treated as unset rather than quietly accepted.
const MIN_PASSCODE_LENGTH = 8;

const IS_PROD = process.env.NODE_ENV === "production";

// ─────────────────────────────────────────────────────────────────────────────
// Signing key — resolved once per process, same shape as lib/order-session.ts
// ─────────────────────────────────────────────────────────────────────────────
//
//   configured                ADMIN_SESSION_SECRET is set. The real thing.
//   ephemeral-dev             Not set, not production. Random per-process key,
//                             so dev and CI work out of the box; sessions stop
//                             verifying on restart, which is an annoyance and
//                             nothing more.
//   unconfigured-production   Not set, in production. Nobody can sign in.

type KeyMode = "configured" | "ephemeral-dev" | "unconfigured-production";

function resolveKey(): { mode: KeyMode; key: Buffer | null } {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (secret && secret.length > 0) {
    return { mode: "configured", key: Buffer.from(secret, "utf8") };
  }
  if (!IS_PROD) return { mode: "ephemeral-dev", key: randomBytes(32) };
  return { mode: "unconfigured-production", key: null };
}

const resolvedKey = resolveKey();

export const adminSessionKeyMode: KeyMode = resolvedKey.mode;

// ─────────────────────────────────────────────────────────────────────────────
// Passcode
// ─────────────────────────────────────────────────────────────────────────────
//
// There is NO development fallback and no default value, in any environment. A
// checked-in or well-known default staff password is how a school ops screen
// ends up open to the whole student body; an unset passcode means nobody can
// sign in anywhere, which is loud, harmless and fixed by one variable.

type PasscodeMode = "configured" | "unset" | "too-short";

function resolvePasscode(): { mode: PasscodeMode; digest: Buffer | null } {
  const raw = process.env.ADMIN_PASSCODE ?? "";
  if (raw.length === 0) return { mode: "unset", digest: null };
  if (raw.length < MIN_PASSCODE_LENGTH) {
    return { mode: "too-short", digest: null };
  }
  return { mode: "configured", digest: sha256(raw) };
}

function sha256(v: string): Buffer {
  return createHash("sha256").update(v, "utf8").digest();
}

const resolvedPasscode = resolvePasscode();

export const adminPasscodeMode: PasscodeMode = resolvedPasscode.mode;

logEvent("admin_session_mode", {
  key: adminSessionKeyMode,
  passcode: adminPasscodeMode,
  ...(adminPasscodeMode === "too-short"
    ? { minPasscodeLength: MIN_PASSCODE_LENGTH }
    : {}),
});

/// Throws `ADMIN_NOT_CONFIGURED` (503) when this server cannot authenticate
/// anybody. Called first by the login route, and by `requireAdminSession` so an
/// operator who removes the secret cannot leave existing cookies working.
export function assertAdminConfigured(): void {
  if (!resolvedKey.key || !resolvedPasscode.digest) {
    logEvent("admin_not_configured", {
      key: adminSessionKeyMode,
      passcode: adminPasscodeMode,
    });
    throw new AppError("ADMIN_NOT_CONFIGURED");
  }
}

/// Constant-time passcode check.
///
/// Both sides are SHA-256 digested first — not to protect the passcode at rest
/// (it is in the environment in clear), but because `timingSafeEqual` throws on
/// a length mismatch, and length-checking the raw input first would leak the
/// passcode's length to anyone who can measure a response.
export function verifyAdminPasscode(candidate: string): boolean {
  const expected = resolvedPasscode.digest;
  if (!expected) return false;
  return timingSafeEqual(sha256(candidate), expected);
}

// ─────────────────────────────────────────────────────────────────────────────
// Token — v1.<sessionId>.<expiryUnixSeconds>.<base64url HMAC-SHA256>
// ─────────────────────────────────────────────────────────────────────────────

function key(): Buffer {
  assertAdminConfigured();
  return resolvedKey.key!;
}

function mac(payload: string): string {
  return createHmac("sha256", key()).update(payload).digest("base64url");
}

/// Random per sign-in. Carried in the token purely so log lines from one
/// session can be correlated with each other (`admin_order_packed`, then
/// `admin_refund_recorded`, …) without anything identifying a human being in
/// them. It is not a user id, and no route treats it as an authorisation input.
export const newAdminSessionId = () => randomBytes(6).toString("hex");

export interface AdminSession {
  sessionId: string;
}

export function signAdminSessionToken(
  sessionId: string,
  nowMs: number = Date.now(),
): string {
  const exp = Math.floor(nowMs / 1000) + ADMIN_SESSION_TTL_SECONDS;
  const payload = `${TOKEN_VERSION}.${sessionId}.${exp}`;
  return `${payload}.${mac(payload)}`;
}

/// Returns the session id, or `null` for anything wrong — malformed, wrong
/// version, forged, tampered, or expired. Callers must not distinguish.
export function verifyAdminSessionToken(
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

export interface AdminSessionCookie {
  name: string;
  value: string;
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
}

export function adminSessionCookie(sessionId: string): AdminSessionCookie {
  return {
    name: ADMIN_SESSION_COOKIE,
    value: signAdminSessionToken(sessionId),
    httpOnly: true,
    secure: IS_PROD,
    // ── THIS IS THE CSRF DEFENCE. ────────────────────────────────────────────
    // SameSite=Lax withholds the cookie from every cross-site POST, so a page
    // on another origin cannot make a staff browser issue a refund. It is
    // deliberately not `Strict` only because Strict also drops the cookie on a
    // top-level link into /admin, which reads as "signed out" until the staff
    // member reloads.
    //
    // The invariant that keeps Lax sufficient, and it is on every admin route:
    // NO ADMIN ROUTE MAY EVER PERFORM A SIDE EFFECT ON A GET. Lax *does* send
    // this cookie on a cross-site top-level GET navigation. The GET routes here
    // are JSON reads that cross-origin script cannot read back (no CORS
    // headers), so that is harmless — but the moment a GET writes something,
    // this cookie becomes a CSRF hole.
    sameSite: "lax",
    path: ADMIN_SESSION_COOKIE_PATH,
    maxAge: ADMIN_SESSION_TTL_SECONDS,
  };
}

/// Same name and path, empty and already expired. The path must match the one
/// the cookie was set with or the browser silently keeps the original.
export function clearedAdminSessionCookie(): AdminSessionCookie {
  return {
    name: ADMIN_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: IS_PROD,
    sameSite: "lax",
    path: ADMIN_SESSION_COOKIE_PATH,
    maxAge: 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

/// The gate. First statement of every handler under app/api/admin/**.
///
/// Throws `ADMIN_NOT_CONFIGURED` (503) if this server cannot authenticate at
/// all, and `ADMIN_UNAUTHORIZED` (401) otherwise. Never returns a partially
/// trusted state.
export function requireAdminSession(req: NextRequest): AdminSession {
  assertAdminConfigured();
  const token = req.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const sessionId = verifyAdminSessionToken(token);
  if (!sessionId) {
    logEvent("admin_auth_denied", { reason: token ? "invalid_token" : "no_cookie" });
    throw new AppError("ADMIN_UNAUTHORIZED");
  }
  return { sessionId };
}

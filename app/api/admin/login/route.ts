import { NextResponse, type NextRequest } from "next/server";
import { AppError, errorResponse } from "@/lib/errors";
import { logEvent } from "@/lib/log";
import { rateLimit } from "@/lib/rate-limit";
import { adminLoginSchema } from "@/lib/validation";
import {
  ADMIN_SESSION_TTL_SECONDS,
  adminSessionCookie,
  assertAdminConfigured,
  newAdminSessionId,
  verifyAdminPasscode,
} from "@/lib/admin-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Staff sign-in. Exchanges the shared passcode for an 8-hour signed session
// cookie (lib/admin-session.ts).
//
// PLACEHOLDER, flagged in docs/HANDOFF.md and awaiting a human decision: one
// shared passcode, no staff roster, no per-person accounts. That is a real
// limitation and it is written down rather than designed around — the audit log
// can say "one browser did these six things" and can never say who was holding
// it, and revoking one person's access means changing the passcode for
// everybody.

export async function POST(req: NextRequest) {
  try {
    // Before anything else, including the rate limiter: a server that cannot
    // authenticate anybody should say so rather than burning a staff member's
    // login budget on a passcode that could never have worked.
    assertAdminConfigured();

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

    // ── Rate limit BEFORE parsing the body. ──────────────────────────────────
    // A deliberate divergence from POST /api/checkout, which validates first
    // and therefore never limits malformed bodies (docs/HANDOFF.md §21). That
    // is defensible for checkout, where the body is a cart; it is not defensible
    // here, where the body is a guess at a credential and an attacker controls
    // whether it parses.
    //
    // Two dimensions, and the second one is the important one:
    //
    //   per IP      catches one machine walking the passcode space.
    //   global      catches a botnet doing the same thing from ten thousand
    //               addresses, which the per-IP limit does not even slow down.
    //               There is exactly ONE credential on this system, so a
    //               distributed guess against it is the realistic attack and a
    //               per-IP limit alone is decoration.
    //
    // The global bucket is a denial-of-service surface — an attacker who burns
    // it locks staff out mid-service. It is set high enough (60 attempts per 5
    // minutes across the whole school) that real staff never approach it, and
    // the trade is deliberate: a lockout is visible and recoverable in minutes,
    // a guessed passcode is neither. Flagged in docs/HANDOFF.md.
    await rateLimit(`admin:login:ip:${ip}`, 10, 300);
    await rateLimit("admin:login:global", 60, 300);

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new AppError("INVALID_INPUT", {
        fields: { _body: ["Request body must be JSON."] },
      });
    }

    const parsed = adminLoginSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError("INVALID_INPUT", {
        fields: parsed.error.flatten().fieldErrors,
      });
    }

    if (!verifyAdminPasscode(parsed.data.passcode)) {
      // No IP, no passcode, no length, no prefix. The only thing this line says
      // is that somebody tried, which is the thing worth alerting on.
      logEvent("admin_login_failed");
      throw new AppError("ADMIN_UNAUTHORIZED");
    }

    const sessionId = newAdminSessionId();
    logEvent("admin_login_ok", { sessionId });

    const res = NextResponse.json(
      {
        ok: true,
        // So the screen can warn before it happens rather than dropping a staff
        // member out mid-handover with an unexplained 401.
        expiresAt: new Date(
          Date.now() + ADMIN_SESSION_TTL_SECONDS * 1000,
        ).toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
    res.cookies.set(adminSessionCookie(sessionId));
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}

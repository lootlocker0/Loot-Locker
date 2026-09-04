import { NextResponse, type NextRequest } from "next/server";
import { errorResponse } from "@/lib/errors";
import { logEvent } from "@/lib/log";
import {
  clearedAdminSessionCookie,
  verifyAdminSessionToken,
  ADMIN_SESSION_COOKIE,
} from "@/lib/admin-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ends a staff session by clearing the cookie.
//
// Deliberately does NOT require a valid session. An expired or corrupted cookie
// is exactly the state a staff member most needs to be able to clear, and
// refusing to clear it would leave them stuck on a screen that 401s with no way
// out but developer tools. Nothing is revealed and nothing is written.
//
// There is no server-side session store, so this cannot revoke a token that has
// already been copied elsewhere — the token stays valid until its 8-hour expiry.
// The way to revoke everything at once is to rotate ADMIN_SESSION_SECRET, which
// invalidates every outstanding staff session immediately. Recorded in
// docs/HANDOFF.md, because on a shared staff device that distinction matters.

export async function POST(req: NextRequest) {
  try {
    const sessionId = verifyAdminSessionToken(
      req.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    );
    if (sessionId) logEvent("admin_logout", { sessionId });

    const res = NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
    // Same name AND same path as the cookie was set with; a mismatched path
    // leaves the browser holding the original silently.
    res.cookies.set(clearedAdminSessionCookie());
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}

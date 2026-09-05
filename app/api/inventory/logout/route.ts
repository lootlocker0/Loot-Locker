import { NextResponse, type NextRequest } from "next/server";
import { errorResponse } from "@/lib/errors";
import { logEvent } from "@/lib/log";
import {
  INVENTORY_SESSION_COOKIE,
  clearedInventorySessionCookie,
  verifyInventorySessionToken,
} from "@/lib/inventory-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ends an inventory session by clearing the cookie.
//
// Deliberately does NOT require a valid session: an expired or corrupted cookie
// is exactly the state someone most needs to be able to clear, and refusing
// would leave them on a screen that 401s with no way out but developer tools.
// Nothing is revealed and nothing is written.
//
// There is no server-side session store, so this cannot revoke a token that has
// already been copied elsewhere — it stays valid until its 8-hour expiry. The
// global revoke is rotating INVENTORY_SESSION_SECRET, which invalidates every
// outstanding inventory session and, because the secrets are separate, leaves
// staff sessions untouched.

export async function POST(req: NextRequest) {
  try {
    const sessionId = verifyInventorySessionToken(
      req.cookies.get(INVENTORY_SESSION_COOKIE)?.value,
    );
    if (sessionId) logEvent("inventory_logout", { sessionId });

    const res = NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
    // Same name AND same path as the cookie was set with; a mismatched path
    // leaves the browser holding the original silently.
    res.cookies.set(clearedInventorySessionCookie());
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}

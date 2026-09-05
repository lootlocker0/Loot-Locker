import type { NextRequest } from "next/server";
import { errorResponse } from "@/lib/errors";
import { requireInventorySession } from "@/lib/inventory-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Am I signed in as an inventory editor?" — so a screen can draw a sign-in form
// or the catalog editor without first firing a data request and reading a 401
// out of it.
//
// A pure read with no side effect, which is what keeps the SameSite=Lax cookie
// an adequate CSRF defence for the write routes (lib/inventory-session.ts). If
// any GET under /api/inventory ever writes, that reasoning is void.
//
// Returns a boolean and a session id. No capabilities list, no passcode hint,
// and — like every route in this namespace — no order, student or settings data
// of any kind. A 200 here is not permission to render anything that has not
// actually been fetched.
//
// A valid staff `ll_admin` cookie does NOT authenticate here, and this route is
// the cheapest place to observe that: different cookie name, different secret,
// different verifier.

export async function GET(req: NextRequest) {
  try {
    const { sessionId } = requireInventorySession(req);
    return Response.json(
      { authenticated: true, sessionId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    // INVENTORY_UNAUTHORIZED (401) or INVENTORY_NOT_CONFIGURED (503). Both are
    // the honest answer to "am I signed in" and both tell the screen what to do.
    return errorResponse(e);
  }
}

import type { NextRequest } from "next/server";
import { errorResponse } from "@/lib/errors";
import { requireAdminSession } from "@/lib/admin-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Am I signed in?" — so the /admin screen can render a sign-in form or the
// pick list without first firing a data request and reading a 401 out of it.
//
// A pure read with no side effect, which is what keeps the SameSite=Lax cookie
// an adequate CSRF defence for the POST routes (see lib/admin-session.ts). If a
// GET under /api/admin ever writes anything, that reasoning is void.
//
// Returns nothing but a boolean and the session id — no capabilities, no
// passcode hint, no order data. A frontend must not treat a 200 here as
// permission to render anything it has not actually fetched.

export async function GET(req: NextRequest) {
  try {
    const { sessionId } = requireAdminSession(req);
    return Response.json(
      { authenticated: true, sessionId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    // ADMIN_UNAUTHORIZED (401) or ADMIN_NOT_CONFIGURED (503). Both are the
    // honest answer to "am I signed in" and both tell the screen what to draw.
    return errorResponse(e);
  }
}

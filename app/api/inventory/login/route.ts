import { NextResponse, type NextRequest } from "next/server";
import { AppError, errorResponse } from "@/lib/errors";
import { logEvent } from "@/lib/log";
import { rateLimit } from "@/lib/rate-limit";
import { inventoryLoginSchema } from "@/lib/validation";
import {
  INVENTORY_SESSION_TTL_SECONDS,
  assertInventoryConfigured,
  inventorySessionCookie,
  newInventorySessionId,
  verifyInventoryPasscode,
} from "@/lib/inventory-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Inventory-editor sign-in. Exchanges INVENTORY_PASSCODE for an 8-hour signed
// `ll_inventory` cookie.
//
// Same hardening as the staff login and none of the staff scope: the session
// this mints opens Product rows and nothing else. It cannot read an order, a
// student, a payment or a setting — not because the screen hides them, but
// because no route in this namespace queries them (docs/API-CONTRACT.md §6b).
//
// PLACEHOLDER, same shape as the staff one: a single shared value held by two
// people, no roster, no per-person account. With two known editors that is a
// much smaller problem than a staff room's worth of volunteers, but the log
// still cannot say which of them made a change. Flagged in docs/HANDOFF.md.

export async function POST(req: NextRequest) {
  try {
    // Before the rate limiter: a server that cannot authenticate anybody should
    // say so rather than burning an editor's login budget on a passcode that
    // could never have worked.
    assertInventoryConfigured();

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

    // ── Rate limit BEFORE parsing the body ───────────────────────────────────
    // The body here IS the guess at a credential, and an attacker controls
    // whether it parses, so malformed bodies are counted too.
    //
    // The two dimensions, and the second is the one that matters: there is
    // exactly ONE inventory credential, so a distributed guess is the realistic
    // attack and a per-IP limit alone is decoration.
    //
    // Deliberately its own key space (`inventory:login:*`), NOT shared with
    // `admin:login:*`. Sharing the global bucket would mean anyone hammering the
    // inventory passcode locks staff out of the locker screen mid-service —
    // coupling the availability of the money-and-PII system to abuse of the
    // catalog one, which is precisely the leak this whole phase exists to
    // prevent.
    //
    // Budgets are half the staff route's. Two known people signing in from a
    // kitchen table do not need ten attempts a minute, and unlike a lunch
    // service there is no queue of children waiting if they are briefly locked
    // out — the cheaper failure here is the stricter one.
    await rateLimit(`inventory:login:ip:${ip}`, 5, 300);
    await rateLimit("inventory:login:global", 30, 300);

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new AppError("INVALID_INPUT", {
        fields: { _body: ["Request body must be JSON."] },
      });
    }

    const parsed = inventoryLoginSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError("INVALID_INPUT", {
        fields: parsed.error.flatten().fieldErrors,
      });
    }

    if (!verifyInventoryPasscode(parsed.data.passcode)) {
      // No IP, no passcode, no length, no prefix. The only thing this line says
      // is that somebody tried.
      logEvent("inventory_login_failed");
      throw new AppError("INVENTORY_UNAUTHORIZED");
    }

    const sessionId = newInventorySessionId();
    logEvent("inventory_login_ok", { sessionId });

    const res = NextResponse.json(
      {
        ok: true,
        expiresAt: new Date(
          Date.now() + INVENTORY_SESSION_TTL_SECONDS * 1000,
        ).toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
    res.cookies.set(inventorySessionCookie(sessionId));
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}

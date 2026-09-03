import { db } from "@/lib/db";
import { errorResponse } from "@/lib/errors";
import { serviceDateFloorForToday } from "@/lib/timezone";

export const runtime = "nodejs";

// This handler takes no request input, so without this Next is entitled to
// prerender it at build time — which would freeze both "today" and every
// booked_count into the deployment. Nothing about this response is static.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // FIXED IN P3 (docs/HANDOFF.md §3, §13). This used to be `new Date()` with
    // `setHours(0,0,0,0)` — server-local midnight, i.e. UTC on Vercel, so
    // between 00:00 and 07:00 UTC the server's "today" was already the school's
    // tomorrow and that evening's windows dropped off the list early.
    //
    // `serviceDateFloorForToday` returns the school's current calendar day as
    // midnight UTC, which is the convention `serviceDate` is stored in — a date
    // key compared against a date key. Note it is deliberately NOT the real
    // instant of Vancouver midnight (07:00Z); comparing that against a
    // `2026-09-03T00:00:00.000Z` service date would hide the current day's slots
    // every morning.
    const today = serviceDateFloorForToday();

    const slots = await db.pickupSlot.findMany({
      where: { active: true, serviceDate: { gte: today } },
      orderBy: [{ serviceDate: "asc" }, { startTime: "asc" }],
    });

    return Response.json(
      {
        slots: slots.map((s) => ({
          id: s.id,
          label: s.label,
          startTime: s.startTime,
          location: s.location,
          serviceDate: s.serviceDate,
          // `capacity` and `bookedCount` never leave the server. The client gets
          // the derived numbers only, so nothing downstream can be tempted to
          // do its own `booked < capacity` check — that read-then-write is
          // exactly what book_slot() exists to prevent (CLAUDE.md §2.4).
          remaining: Math.max(s.capacity - s.bookedCount, 0),
          full: s.bookedCount >= s.capacity,
        })),
      },
      // Deliberate, and not a performance trade-off. A cached slot list sends a
      // student into a window that filled up thirty seconds ago and turns into
      // a SLOT_FULL 409 at the worst possible moment — mid-checkout, at lunch.
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}

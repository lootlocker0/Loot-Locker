import { db } from "@/lib/db";
import { errorResponse } from "@/lib/errors";

export const runtime = "nodejs";

// This handler takes no request input, so without this Next is entitled to
// prerender it at build time — which would freeze both "today" and every
// booked_count into the deployment. Nothing about this response is static.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Server-local midnight. Vercel runs UTC and the school is in
    // America/Vancouver, so between 00:00 and 07:00 UTC this "today" is already
    // the school's tomorrow and that evening's remaining windows drop off the
    // list. Harmless for a lunch service (it is after 5pm locally by then) but
    // it is the same latent bug as the cutoff arithmetic — docs/HANDOFF.md §3,
    // fix scoped to P3 along with lib/timezone.ts.
    const today = new Date();
    today.setHours(0, 0, 0, 0);

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

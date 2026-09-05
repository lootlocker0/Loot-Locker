import type { NextRequest } from "next/server";
import type { Allergen, OrderStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError, errorResponse } from "@/lib/errors";
import { requireAdminSession } from "@/lib/admin-session";
import { adminOrdersQuerySchema } from "@/lib/validation";
import { serviceDateFloorForToday } from "@/lib/timezone";
import { cashDueCents, unionAllergens } from "@/lib/db/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// THE PICK LIST. One service day, grouped by pickup window, in the order staff
// physically work: window by window, student by student, allergens on every
// line.
//
// This is the screen someone is holding at 12:15 with a queue forming, and the
// P4 gate is "a staff member can run a full lunch service from it" — including
// the offline fallback of printing it before service starts. So it returns
// everything needed to pack and hand out bags in ONE request: no per-order
// round trip, no lazy loading, nothing that needs a network at the locker.
//
// PII: `studentName` and `homeroom` only. No email and no phone appear in this
// response at any nesting level (lib/db/admin.ts holds the projection). Staff
// need to identify a person standing in front of them, not contact them; a
// printed sheet of children's phone numbers left on a cafeteria table is a
// worse failure than an unclaimed bag (CLAUDE.md §2.6).

/// What staff are working on. Deliberately EXCLUDES `PENDING`.
///
/// A `PENDING` card order is holding a seat and stock but nobody has paid for
/// it and it may evaporate when the sweep runs. This response is what gets
/// printed, and a printed pick list containing unpaid orders is a bag packed
/// and handed to a student who never paid. It is still visible on request
/// (`?status=PENDING`) — hidden by default, not unreachable — and the seat
/// arithmetic below explains where it went.
///
/// `CANCELLED` and `EXPIRED` are excluded because they released everything they
/// held and are pure noise on a working screen. `REFUNDED` IS included: it
/// still holds its stock and its seat (see the refund route) and staff need to
/// see it to reconcile the shelf.
const DEFAULT_STATUSES: readonly OrderStatus[] = [
  "RESERVED",
  "PAID",
  "PACKED",
  "PICKED_UP",
  "REFUNDED",
];

/// Which orders are counted into the "pull this off the shelf" totals: money is
/// committed and a bag either exists or has to. `PICKED_UP` is out (already
/// gone) and so is `REFUNDED` (not being handed to anyone).
const PACKABLE: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  "RESERVED",
  "PAID",
  "PACKED",
]);

/// `YYYY-MM-DD` -> the midnight-UTC date key `PickupSlot.serviceDate` is stored
/// as. The round-trip check rejects `2026-02-31`, which `new Date` would
/// silently roll forward to March — a staff member typing a date that does not
/// exist should be told, not shown the wrong day's orders.
function parseServiceDate(ymd: string): Date {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== ymd) {
    throw new AppError("INVALID_INPUT", {
      fields: { date: ["Not a real calendar date."] },
    });
  }
  return d;
}

export async function GET(req: NextRequest) {
  try {
    requireAdminSession(req);

    const parsed = adminOrdersQuerySchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams),
    );
    if (!parsed.success) {
      throw new AppError("INVALID_INPUT", {
        fields: parsed.error.flatten().fieldErrors,
      });
    }
    const q = parsed.data;

    const visible = new Set<OrderStatus>(
      q.status.length > 0 ? q.status : DEFAULT_STATUSES,
    );

    // "Today" is the school's calendar day, not the server's (lib/timezone.ts).
    // On a UTC host, server-local midnight is 17:00 the previous afternoon in
    // Vancouver, so a naive default would hand staff yesterday's list for the
    // first seven hours of every UTC day.
    const serviceDate = q.date
      ? parseServiceDate(q.date)
      : serviceDateFloorForToday();

    // When a specific window is named, the date filter is dropped rather than
    // intersected. Staff at a locker have one slot id and no reason to also
    // know its calendar day; intersecting would answer a mistyped date with an
    // empty screen mid-service. The `serviceDate` in the response says which
    // day was actually returned.
    const where = q.slotId
      ? { id: q.slotId }
      : { serviceDate };

    const slots = await db.pickupSlot.findMany({
      where,
      // Inactive windows are included on purpose: deactivating a slot does not
      // cancel the orders already in it, and those bags still have to be handed
      // out by somebody.
      orderBy: [
        { serviceDate: "asc" },
        { startTime: "asc" },
        { location: "asc" },
      ],
      select: {
        id: true,
        label: true,
        startTime: true,
        location: true,
        serviceDate: true,
        capacity: true,
        bookedCount: true,
        active: true,
        orders: {
          // Every order in the window is fetched, including the statuses that
          // will not be listed, so the per-status counts below can explain the
          // seat arithmetic. One lunch service is tens of rows.
          orderBy: [{ studentName: "asc" }, { pickupCode: "asc" }],
          select: {
            orderNumber: true,
            pickupCode: true,
            studentName: true,
            homeroom: true,
            status: true,
            paymentMethod: true,
            subtotalCents: true,
            taxCents: true,
            totalCents: true,
            paidAt: true,
            expiresAt: true,
            createdAt: true,
            items: {
              orderBy: { nameSnapshot: "asc" },
              select: {
                productId: true,
                qty: true,
                nameSnapshot: true,
                unitPriceCents: true,
                raritySnapshot: true,
                allergensSnapshot: true,
              },
            },
          },
        },
      },
    });

    const payload = slots.map((slot) => {
      const byStatus: Partial<Record<OrderStatus, number>> = {};
      for (const o of slot.orders) {
        byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
      }

      const listed = slot.orders.filter((o) => visible.has(o.status));

      // Everything that must physically exist in this window, summed across the
      // orders that still need a bag. Built from the LINE SNAPSHOTS, never from
      // the live product (CLAUDE.md §2.5) — a product renamed or re-priced this
      // morning must not change what a bag packed against yesterday's order
      // says it contains.
      const totals = new Map<
        string,
        { productId: string; nameSnapshot: string; qty: number; allergens: Set<Allergen> }
      >();
      for (const o of slot.orders) {
        if (!PACKABLE.has(o.status)) continue;
        for (const line of o.items) {
          const t = totals.get(line.productId) ?? {
            productId: line.productId,
            nameSnapshot: line.nameSnapshot,
            qty: 0,
            allergens: new Set<Allergen>(),
          };
          t.qty += line.qty;
          for (const a of line.allergensSnapshot) t.allergens.add(a);
          totals.set(line.productId, t);
        }
      }

      const orders = listed.map((o) => ({
        orderNumber: o.orderNumber,
        // Staff read this aloud and type it back into the pickup route. It is
        // present for every listed order regardless of status — unlike the
        // student-facing receipt, which withholds it until the order is
        // claimable, because staff are the ones who verify it.
        pickupCode: o.pickupCode,
        studentName: o.studentName,
        homeroom: o.homeroom,
        status: o.status,
        paymentMethod: o.paymentMethod,
        subtotalCents: o.subtotalCents,
        taxCents: o.taxCents,
        totalCents: o.totalCents,
        /// Integer cents still to collect at the locker. 0 for every card
        /// order and for any cash order already recorded as paid.
        cashDueCents: cashDueCents(o),
        paidAt: o.paidAt,
        expiresAt: o.expiresAt,
        placedAt: o.createdAt,
        /// The union across this order's lines, in canonical enum order. A
        /// bag-label warning, NOT a replacement for the per-line lists below —
        /// it cannot say which item carries the peanuts. Render both, in full
        /// (CLAUDE.md §2.8).
        allergens: unionAllergens(o.items),
        items: o.items,
      }));

      return {
        id: slot.id,
        label: slot.label,
        startTime: slot.startTime,
        location: slot.location,
        serviceDate: slot.serviceDate,
        active: slot.active,
        // Staff get the raw numbers students do not (GET /api/slots projects
        // these away). This is the screen where "why is the window full when I
        // only see 22 bags" has to be answerable.
        capacity: slot.capacity,
        bookedCount: slot.bookedCount,
        remaining: Math.max(slot.capacity - slot.bookedCount, 0),
        counts: {
          /// Over EVERY order in the window, including statuses excluded from
          /// `orders` below. This is what reconciles `bookedCount` against a
          /// list that is shorter than it.
          total: slot.orders.length,
          listed: orders.length,
          byStatus,
        },
        /// Total cash to collect in this window, integer cents.
        cashDueCents: orders.reduce((a, o) => a + o.cashDueCents, 0),
        productTotals: [...totals.values()]
          .map((t) => ({
            productId: t.productId,
            nameSnapshot: t.nameSnapshot,
            qty: t.qty,
            allergens: unionAllergens([
              { allergensSnapshot: [...t.allergens] },
            ]),
          }))
          .sort((a, b) => a.nameSnapshot.localeCompare(b.nameSnapshot)),
        orders,
      };
    });

    return Response.json(
      {
        serviceDate: q.slotId ? (payload[0]?.serviceDate ?? null) : serviceDate,
        statuses: [...visible],
        slots: payload,
      },
      // Never cached. This is live operational state behind a staff cookie:
      // a shared cache keyed on the URL would serve one school's pick list —
      // children's names and live pickup codes — to whoever asked next.
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}

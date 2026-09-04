import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { AppError, errorResponse } from "@/lib/errors";
import { logEvent } from "@/lib/log";
import { requireAdminSession } from "@/lib/admin-session";
import { adminCashSchema } from "@/lib/validation";
import { assertPickupCodeMatches, loadAdminOrder } from "@/lib/db/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// MONEY CHANGES HANDS. A student puts coins on the table and this is the only
// record that it happened.
//
// ── Why this does not violate CLAUDE.md §2.3 ─────────────────────────────────
// "Stripe webhooks are the only source of truth for payment" is about CARD
// orders: no client, and no staff member, may assert that Stripe took money.
// A cash order has no payment gateway to be the source of truth, so an
// authenticated staff member at the locker IS the source of truth, and there is
// nowhere else the fact could possibly come from.
//
// The invariant is kept intact structurally rather than by convention: every
// write below carries `paymentMethod: "CASH_AT_PICKUP"` in its WHERE clause, so
// this route cannot mark a card order paid even if it is called with one. A
// card order sent here is refused with PAYMENT_METHOD_MISMATCH before any
// write is attempted, and the WHERE clause is the belt behind that brace.
//
// ── Why `paidAt` and `status` are written separately ─────────────────────────
// `OrderStatus` has one slot and two facts to hold: has the money arrived, and
// has the bag been made. Cash can be taken before the bag is packed or after
// it, and both are normal.
//
//   RESERVED + cash  ->  PAID, paidAt set        (money in, bag not yet made)
//   PACKED   + cash  ->  PACKED, paidAt set      (bag already made; PACKED is
//                                                 further along than PAID and
//                                                 must not be walked backwards)
//
// So `paidAt` is the money fact and `status` is the fulfilment fact. Anything
// reading "was this paid" must read `paidAt`, not `status === "PAID"` — a
// PACKED cash order can be fully paid.

const FROM_STATUSES = ["RESERVED", "PACKED", "PICKED_UP"] as const;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ orderNumber: string }> },
) {
  try {
    const { sessionId } = requireAdminSession(req);
    const { orderNumber } = await ctx.params;

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new AppError("INVALID_INPUT", {
        fields: { _body: ["Request body must be JSON."] },
      });
    }
    const parsed = adminCashSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError("INVALID_INPUT", {
        fields: parsed.error.flatten().fieldErrors,
      });
    }

    const order = await loadAdminOrder(orderNumber);

    if (order.paymentMethod !== "CASH_AT_PICKUP") {
      throw new AppError("PAYMENT_METHOD_MISMATCH", {
        paymentMethod: order.paymentMethod,
      });
    }
    if (parsed.data.pickupCode) {
      assertPickupCodeMatches(order, parsed.data.pickupCode);
    }

    const paidAt = new Date();

    // ── Exactly-once, by the WHERE clause. ───────────────────────────────────
    // `paidAt: null` is what makes this idempotent: a double-pressed button, or
    // two staff phones, produce one UPDATE that matches a row and one that
    // matches none. Without it, the second press silently overwrites the
    // timestamp and the record of when the money actually arrived is lost.
    //
    // Two statements rather than one because the two transitions write
    // different things (see the header). They are mutually exclusive on
    // `status`, so no transaction is needed to keep them from both firing —
    // and the second only runs if the first matched nothing.
    const promoted = await db.order.updateMany({
      where: {
        id: order.id,
        paymentMethod: "CASH_AT_PICKUP",
        paidAt: null,
        status: "RESERVED",
      },
      data: { status: "PAID", paidAt },
    });

    let changed = promoted.count === 1;

    if (!changed) {
      // Already packed or already handed over: record the money, leave the
      // fulfilment state where it is.
      const stamped = await db.order.updateMany({
        where: {
          id: order.id,
          paymentMethod: "CASH_AT_PICKUP",
          paidAt: null,
          status: { in: ["PACKED", "PICKED_UP"] },
        },
        data: { paidAt },
      });
      changed = stamped.count === 1;
    }

    // One authoritative re-read, so the response reports what the database
    // actually holds rather than what this handler intended.
    const now = await db.order.findUnique({
      where: { id: order.id },
      select: { status: true, paidAt: true, totalCents: true },
    });
    if (!now) throw new AppError("ORDER_NOT_FOUND");

    if (!changed && !now.paidAt) {
      // Nothing was written and the money is still not recorded, so the order
      // is somewhere this action cannot apply from — CANCELLED, EXPIRED,
      // REFUNDED, or a PENDING row that should not exist for cash at all.
      throw new AppError("INVALID_STATUS_TRANSITION", {
        status: now.status,
        expected: [...FROM_STATUSES],
      });
    }

    if (changed) {
      // The amount is logged because it is money and it is not PII; the payer
      // is identified only by the order's cuid.
      logEvent("admin_cash_collected", {
        orderId: order.id,
        sessionId,
        totalCents: now.totalCents,
      });
    }

    return Response.json(
      {
        orderNumber: order.orderNumber,
        status: now.status,
        /// The money fact. Read THIS, not `status`, to decide whether a cash
        /// order has been paid.
        paidAt: now.paidAt,
        /// false = the money was already recorded and nothing was written.
        changed,
        /// Always 0 on a successful response: there is nothing left to collect.
        cashDueCents: 0,
        collectedCents: now.totalCents,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}

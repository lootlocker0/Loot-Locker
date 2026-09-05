import type { NextRequest } from "next/server";
import { errorResponse } from "@/lib/errors";
import { logEvent } from "@/lib/log";
import { requireAdminSession } from "@/lib/admin-session";
import {
  cashDueCents,
  loadAdminOrder,
  transitionOrderStatus,
  unionAllergens,
} from "@/lib/db/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "The bag is packed." No student is present and no money moves, so this route
// asks for nothing but the order number.
//
// Allowed from RESERVED (cash, money due at the locker) and PAID (card, the
// webhook has confirmed it). NOT from PENDING: an unpaid card order can still
// expire and hand its stock back, and packing a bag against it means a snack
// off the shelf for an order that is about to stop existing.

const FROM = ["RESERVED", "PAID"] as const;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ orderNumber: string }> },
) {
  try {
    const { sessionId } = requireAdminSession(req);
    const { orderNumber } = await ctx.params;

    const order = await loadAdminOrder(orderNumber);

    // Idempotent by construction: two staff phones pressing "packed" resolve to
    // one conditional UPDATE that matches a row and one that matches none, and
    // the second is reported as an unchanged success rather than a conflict.
    // The alternative — a read, an `if`, then a write — lets both through.
    const outcome = await transitionOrderStatus({
      orderId: order.id,
      from: FROM,
      to: "PACKED",
    });

    if (outcome === "changed") {
      // orderId, never studentName or the order number's owner. The session id
      // makes a sequence of actions correlatable without naming a person
      // (CLAUDE.md §2.6).
      logEvent("admin_order_packed", { orderId: order.id, sessionId });
    }

    return Response.json(
      {
        orderNumber: order.orderNumber,
        status: "PACKED",
        changed: outcome === "changed",
        /// Repeated here so the confirmation the staff member sees carries the
        /// warning, not just the list they came from. Never truncated.
        allergens: unionAllergens(order.items),
        /// What still has to be collected when the student arrives. Surfaced on
        /// the pack response so it is on screen before the handover, not
        /// discovered at it.
        cashDueCents: cashDueCents(order),
        pickupCode: order.pickupCode,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}

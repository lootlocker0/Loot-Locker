import type { NextRequest } from "next/server";
import { AppError, errorResponse } from "@/lib/errors";
import { logEvent } from "@/lib/log";
import { requireAdminSession } from "@/lib/admin-session";
import { adminPickupSchema } from "@/lib/validation";
import {
  assertPickupCodeMatches,
  cashDueCents,
  loadAdminOrder,
  transitionOrderStatus,
  unionAllergens,
} from "@/lib/db/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// THE HANDOVER. The bag leaves the locker and goes to a person.
//
// Two guards, and both of them refuse rather than warn:
//
//   1. The pickup code must match. This is the only moment the person in front
//      of staff is tied to the bag, and the bag may contain the one snack in
//      the building that a different student cannot eat.
//   2. A cash order with no recorded payment is refused (CASH_NOT_COLLECTED).
//      Handing over food and collecting the money are one action in the real
//      world and two writes here; refusing the second until the first is
//      recorded is what stops "I'll ring it in after lunch" from becoming a
//      missing $4.75 nobody can reconstruct. The remedy is one tap on the cash
//      route, which is the thing staff should be doing anyway.
//
// There is deliberately no override. A comped or free order is a policy
// question (who may give away stock, and does it still count against a
// student's daily cap), not a button — flagged in docs/HANDOFF.md.

const FROM = ["RESERVED", "PAID", "PACKED"] as const;

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
    const parsed = adminPickupSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError("INVALID_INPUT", {
        fields: parsed.error.flatten().fieldErrors,
      });
    }

    const order = await loadAdminOrder(orderNumber);

    // Identity first, before status and before money. A mismatched code must
    // fail the same way whatever state the order is in, so a wrong code can
    // never be used to probe what is in the locker.
    assertPickupCodeMatches(order, parsed.data.pickupCode);

    const due = cashDueCents(order);

    if (order.status === "PICKED_UP") {
      // Already handed over. Refusing on the cash guard here would be noise —
      // the bag is gone and nothing this route does can un-hand it — so report
      // the unchanged state and keep `cashDueCents` in the response so the
      // screen can still chase the money.
      return Response.json(
        {
          orderNumber: order.orderNumber,
          status: "PICKED_UP",
          changed: false,
          cashDueCents: due,
          allergens: unionAllergens(order.items),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (due > 0) {
      throw new AppError("CASH_NOT_COLLECTED", { totalCents: due });
    }

    const outcome = await transitionOrderStatus({
      orderId: order.id,
      from: FROM,
      to: "PICKED_UP",
    });

    if (outcome === "changed") {
      logEvent("admin_order_picked_up", { orderId: order.id, sessionId });
    }

    return Response.json(
      {
        orderNumber: order.orderNumber,
        status: "PICKED_UP",
        changed: outcome === "changed",
        cashDueCents: 0,
        allergens: unionAllergens(order.items),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}

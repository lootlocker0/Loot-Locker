import type { OrderStatus } from "@prisma/client";
import { formatCents } from "@/lib/money";
import { OrderActions } from "./OrderActions";
import type { AdminOrder } from "./types";

const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: "Pending payment",
  RESERVED: "Reserved (cash)",
  PAID: "Paid",
  PACKED: "Packed",
  PICKED_UP: "Picked up",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
  REFUNDED: "Refunded",
};

// Colour is never the only signal — the label text above is always rendered
// too, and the allergen box below uses a border + bold + the word itself,
// never colour alone.
const STATUS_TONE: Record<OrderStatus, string> = {
  PENDING: "text-text-faint",
  RESERVED: "text-brand",
  PAID: "text-rarity-uncommon",
  PACKED: "text-gold",
  PICKED_UP: "text-text-dim",
  CANCELLED: "text-text-faint",
  EXPIRED: "text-text-faint",
  REFUNDED: "text-danger",
};

/**
 * One order line on the pick list. Everything a staff member needs to pack
 * and hand over a bag is rendered directly, in full — allergens (both the
 * order-level union AND the per-item snapshot, per §6a's "render both"
 * instruction), pickup code, payment method, and what's still owed.
 */
export function OrderRow({
  order,
  onChanged,
  onUnauthorized,
}: {
  order: AdminOrder;
  onChanged: () => void;
  onUnauthorized: () => void;
}) {
  return (
    <article className="admin-page-break clip-panel border-2 border-white/10 bg-surface-2 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-display text-lg uppercase text-text">
            {order.studentName}{" "}
            {order.homeroom && (
              <span className="font-mono text-xs font-normal normal-case text-text-faint">
                ({order.homeroom})
              </span>
            )}
          </p>
          <p className="font-mono text-xs text-text-faint">
            {order.orderNumber} · code{" "}
            <span className="font-bold tracking-widest text-text">{order.pickupCode}</span>
          </p>
        </div>
        <div className="text-right">
          <p className={`font-mono text-sm uppercase ${STATUS_TONE[order.status]}`}>
            {STATUS_LABEL[order.status]}
          </p>
          <p className="font-mono text-xs text-text-dim">
            {order.paymentMethod === "CARD" ? "Card" : "Cash"}
            {order.paymentMethod === "CASH_AT_PICKUP" && (order.paidAt ? " · paid" : " · NOT paid")}
          </p>
        </div>
      </div>

      {order.allergens.length > 0 && (
        <p
          role="note"
          className="mt-2 border-2 border-danger px-2 py-1 font-mono text-xs font-bold uppercase tracking-wide text-danger"
        >
          Contains: {order.allergens.join(", ")}
        </p>
      )}

      <ul className="mt-3 flex flex-col gap-1 font-mono text-xs text-text-dim">
        {order.items.map((item) => (
          <li key={item.productId} className="flex items-baseline justify-between gap-2">
            <span>
              {item.qty}× {item.nameSnapshot}
              {item.allergensSnapshot.length > 0 && (
                <span className="ml-2 font-bold text-danger">
                  [{item.allergensSnapshot.join(", ")}]
                </span>
              )}
            </span>
            <span className="shrink-0 text-text">
              {formatCents(item.unitPriceCents * item.qty)}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-2 font-mono text-sm">
        <span className="text-text-dim">Total {formatCents(order.totalCents)}</span>
        {order.cashDueCents > 0 && (
          <span className="font-bold text-gold">Cash due {formatCents(order.cashDueCents)}</span>
        )}
      </div>

      <div className="admin-no-print mt-3 border-t border-white/10 pt-3">
        <OrderActions order={order} onChanged={onChanged} onUnauthorized={onUnauthorized} />
      </div>
    </article>
  );
}

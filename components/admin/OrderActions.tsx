"use client";

import { useState } from "react";
import { ShardButton } from "@/components/ui/ShardButton";
import { formatCents } from "@/lib/money";
import { adminFetch } from "./adminApi";
import type { AdminApiError, AdminOrder } from "./types";

type Action = "pack" | "pickup" | "cash" | "refund" | null;

type RefundResponse = {
  itemsToAdjust: { productId: string; nameSnapshot: string; suggestedDelta: number }[];
};

function formatActionError(error: AdminApiError): string {
  switch (error.code) {
    case "INVALID_STATUS_TRANSITION": {
      const expected = Array.isArray(error.expected) ? error.expected.join(", ") : null;
      return `This order is ${String(error.status ?? "in a different state")}.${
        expected ? ` This only works from ${expected}.` : ""
      }`;
    }
    case "PICKUP_CODE_MISMATCH":
      return "That code doesn't match this order. Re-read it from the student and try again.";
    case "CASH_NOT_COLLECTED":
      return `Cash hasn't been recorded for this order yet${
        typeof error.totalCents === "number" ? ` — collect ${formatCents(error.totalCents)}` : ""
      } first, then try again.`;
    case "PAYMENT_METHOD_MISMATCH":
      return `That action doesn't apply to a ${String(error.paymentMethod ?? "this")} order.`;
    case "REFUND_FAILED":
      return error.reason === "NO_PAYMENT_INTENT"
        ? "No payment on file for this order at the payment provider — nothing was refunded."
        : "The payment provider couldn't complete the refund. Nothing was changed — safe to retry.";
    case "ORDER_NOT_FOUND":
      return "This order couldn't be found. Refresh the pick list.";
    default:
      return error.message;
  }
}

/**
 * The four staff actions from a single order row. Pack and cash are one
 * click (both are idempotent server-side, per §6a — a double press is a
 * no-op, not a double effect). Pickup always requires re-entering the
 * pickup code, deliberately never pre-filled — that keystroke IS the
 * identity check, not a formality. Refund requires an explicit second
 * confirmation because it moves money and cannot be partially undone here.
 */
export function OrderActions({
  order,
  onChanged,
  onUnauthorized,
}: {
  order: AdminOrder;
  onChanged: () => void;
  onUnauthorized: () => void;
}) {
  const [busy, setBusy] = useState<Action>(null);
  const [error, setError] = useState<AdminApiError | null>(null);

  const [showPickupConfirm, setShowPickupConfirm] = useState(false);
  const [pickupCodeInput, setPickupCodeInput] = useState("");

  const [showRefundConfirm, setShowRefundConfirm] = useState(false);
  const [releaseSlotSeat, setReleaseSlotSeat] = useState(false);
  const [refundResult, setRefundResult] = useState<RefundResponse | null>(null);

  const canPack = order.status === "RESERVED" || order.status === "PAID";
  const canPickup =
    order.status === "RESERVED" || order.status === "PAID" || order.status === "PACKED";
  const canCash =
    order.paymentMethod === "CASH_AT_PICKUP" &&
    !order.paidAt &&
    (order.status === "RESERVED" || order.status === "PACKED" || order.status === "PICKED_UP");
  const canRefund =
    order.status === "PAID" || order.status === "PACKED" || order.status === "PICKED_UP";

  const locked = busy !== null;

  async function run<T>(action: Exclude<Action, null>, path: string, body?: unknown): Promise<T | null> {
    setBusy(action);
    setError(null);
    const res = await adminFetch<T>(path, {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    });
    setBusy(null);
    if (!res.ok) {
      if (res.status === 401) {
        onUnauthorized();
        return null;
      }
      setError(res.error);
      return null;
    }
    return res.data;
  }

  async function doPack() {
    const data = await run("pack", `/api/admin/orders/${order.orderNumber}/pack`);
    if (data) onChanged();
  }

  async function doPickup(e: React.FormEvent) {
    e.preventDefault();
    const pickupCode = pickupCodeInput.trim().toUpperCase();
    if (!pickupCode) return;
    const data = await run("pickup", `/api/admin/orders/${order.orderNumber}/pickup`, { pickupCode });
    if (data) {
      setShowPickupConfirm(false);
      setPickupCodeInput("");
      onChanged();
    }
  }

  async function doCash() {
    const data = await run("cash", `/api/admin/orders/${order.orderNumber}/cash`);
    if (data) onChanged();
  }

  async function doRefund() {
    const data = await run<RefundResponse>(
      "refund",
      `/api/admin/orders/${order.orderNumber}/refund`,
      { releaseSlotSeat },
    );
    if (data) {
      setShowRefundConfirm(false);
      setRefundResult(data);
      onChanged();
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <ShardButton
          size="sm"
          disabled={!canPack || locked}
          loading={busy === "pack"}
          onClick={doPack}
        >
          Mark packed
        </ShardButton>

        <ShardButton
          size="sm"
          intent="ghost"
          disabled={!canPickup || locked}
          loading={busy === "pickup"}
          onClick={() => setShowPickupConfirm((v) => !v)}
        >
          Mark picked up
        </ShardButton>

        {order.paymentMethod === "CASH_AT_PICKUP" && (
          <ShardButton
            size="sm"
            intent="ghost"
            disabled={!canCash || locked}
            loading={busy === "cash"}
            onClick={doCash}
          >
            {order.paidAt ? "Cash recorded" : "Record cash"}
          </ShardButton>
        )}

        <ShardButton
          size="sm"
          intent="ghost"
          disabled={!canRefund || locked}
          loading={busy === "refund"}
          onClick={() => setShowRefundConfirm((v) => !v)}
          className="border-danger text-danger hover:bg-danger/10"
        >
          Refund
        </ShardButton>
      </div>

      {showPickupConfirm && (
        <form
          onSubmit={doPickup}
          className="flex flex-wrap items-end gap-2 border-2 border-brand/40 bg-surface-3 p-3"
        >
          <div className="flex flex-col gap-1">
            <label
              htmlFor={`pickup-code-${order.orderNumber}`}
              className="font-mono text-[11px] uppercase text-text-faint"
            >
              Have the student read their pickup code aloud
            </label>
            <input
              id={`pickup-code-${order.orderNumber}`}
              value={pickupCodeInput}
              onChange={(e) => setPickupCodeInput(e.target.value)}
              autoFocus
              maxLength={8}
              placeholder="Code"
              aria-describedby={`pickup-code-hint-${order.orderNumber}`}
              className="w-28 border-2 border-white/10 bg-surface-2 px-3 py-2 font-mono uppercase tracking-widest text-text focus:border-brand"
            />
            <span id={`pickup-code-hint-${order.orderNumber}`} className="sr-only">
              Not pre-filled on purpose — type what the student tells you.
            </span>
          </div>
          <ShardButton type="submit" size="sm" loading={busy === "pickup"} disabled={!pickupCodeInput.trim()}>
            Confirm pickup
          </ShardButton>
          <ShardButton
            type="button"
            size="sm"
            intent="ghost"
            onClick={() => {
              setShowPickupConfirm(false);
              setPickupCodeInput("");
              setError(null);
            }}
          >
            Cancel
          </ShardButton>
        </form>
      )}

      {showRefundConfirm && (
        <div className="flex flex-col gap-2 border-2 border-danger/50 bg-surface-3 p-3">
          <p className="text-sm text-text">
            Refund <span className="font-mono font-bold text-gold">{formatCents(order.totalCents)}</span> to
            this family? This is always the full order total — there is no partial refund — and it cannot
            be undone from this screen.
          </p>
          <label className="flex items-center gap-2 font-mono text-xs text-text-dim">
            <input
              type="checkbox"
              checked={releaseSlotSeat}
              onChange={(e) => setReleaseSlotSeat(e.target.checked)}
            />
            Also release this order&rsquo;s pickup-window seat (only if there&rsquo;s real time left to hand out
            one more bag)
          </label>
          <div className="flex gap-2">
            <ShardButton
              size="sm"
              loading={busy === "refund"}
              onClick={doRefund}
              className="border-2 border-danger bg-danger text-void hover:brightness-110"
            >
              Confirm refund
            </ShardButton>
            <ShardButton
              size="sm"
              intent="ghost"
              onClick={() => {
                setShowRefundConfirm(false);
                setError(null);
              }}
            >
              Cancel
            </ShardButton>
          </div>
        </div>
      )}

      {refundResult && refundResult.itemsToAdjust.length > 0 && (
        <RestockPrompt
          items={refundResult.itemsToAdjust}
          onDismiss={() => setRefundResult(null)}
          onUnauthorized={onUnauthorized}
        />
      )}

      {error && (
        <p role="alert" className="border-2 border-danger bg-surface-3 p-2 text-xs text-danger">
          {formatActionError(error)}
        </p>
      )}
    </div>
  );
}

/**
 * Shown after a successful refund. `stockStillHeld` is always true from this
 * route (§6a) — a refund never restocks automatically, since the snack may
 * already be packed, damaged, or eaten. Each button here is the explicit
 * staff click that stands in for "I physically checked the shelf", exactly
 * as the contract asks: "render this as a prompt, never as a completed
 * action."
 */
function RestockPrompt({
  items,
  onDismiss,
  onUnauthorized,
}: {
  items: { productId: string; nameSnapshot: string; suggestedDelta: number }[];
  onDismiss: () => void;
  onUnauthorized: () => void;
}) {
  const [applied, setApplied] = useState<Record<string, number>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function apply(productId: string, delta: number) {
    setBusyId(productId);
    setErr(null);
    const res = await adminFetch<{ stockQty: number }>(`/api/admin/products/${productId}/stock`, {
      method: "POST",
      body: JSON.stringify({ delta }),
    });
    setBusyId(null);
    if (!res.ok) {
      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      setErr(res.error.message);
      return;
    }
    setApplied((a) => ({ ...a, [productId]: res.data.stockQty }));
  }

  return (
    <div className="border-2 border-gold/50 bg-surface-3 p-3">
      <p className="font-mono text-xs font-bold uppercase text-gold">
        Refunded — stock was not returned automatically
      </p>
      <p className="mt-1 text-xs text-text-dim">
        Only press these if the item is physically back on the shelf right now.
      </p>
      <ul className="mt-2 flex flex-col gap-2">
        {items.map((item) => (
          <li
            key={item.productId}
            className="flex flex-wrap items-center justify-between gap-2 font-mono text-xs text-text"
          >
            <span>
              {item.nameSnapshot} ({item.suggestedDelta > 0 ? "+" : ""}
              {item.suggestedDelta})
            </span>
            {applied[item.productId] !== undefined ? (
              <span className="text-rarity-uncommon">Applied — now {applied[item.productId]}</span>
            ) : (
              <ShardButton
                size="sm"
                intent="ghost"
                loading={busyId === item.productId}
                onClick={() => apply(item.productId, item.suggestedDelta)}
              >
                It&rsquo;s back on the shelf — apply
              </ShardButton>
            )}
          </li>
        ))}
      </ul>
      {err && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {err}
        </p>
      )}
      <ShardButton size="sm" intent="ghost" className="mt-2" onClick={onDismiss}>
        Dismiss
      </ShardButton>
    </div>
  );
}

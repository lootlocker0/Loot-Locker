"use client";

import { useEffect, useMemo, useState } from "react";
import type { Allergen, Rarity } from "@prisma/client";
import { ShardButton } from "@/components/ui/ShardButton";
import { rarityMeta } from "@/lib/rarity";
import { adminFetch } from "./adminApi";
import type { AdminApiError, AdminOrdersResponse } from "./types";

type CatalogProduct = {
  id: string;
  name: string;
  priceCents: number;
  category: string;
  rarity: Rarity;
  allergens: Allergen[];
  stockQty: number;
};

type AdjustRow = {
  productId: string;
  name: string;
  rarity: Rarity | null;
  allergens: Allergen[];
  /** null = not present in the live catalog read below — see the coverage
   * note in the component body. */
  knownStock: number | null;
};

/**
 * Per-product signed stock delta, matching `POST
 * /api/admin/products/[productId]/stock` exactly (§6a): the input is always
 * relative, never an absolute "set to N" — the API has no such field, on
 * purpose, because a read-then-write from a human counting a shelf can lose
 * a concurrent checkout's reservation.
 *
 * KNOWN GAP (see docs/HANDOFF.md): there is no `GET /api/admin/products`.
 * The product list below is built from two real, documented endpoints —
 * `GET /api/products` (active, in-stock catalog) unioned with the current
 * pick list's `productTotals` (covers items that sold out or were
 * deactivated but still had orders today) — which is real data, not a stub,
 * but does not cover a product that is both inactive and had zero orders
 * today. That product is simply invisible here until the endpoint exists.
 */
export function StockAdjuster({
  ordersData,
  onUnauthorized,
}: {
  ordersData: AdminOrdersResponse;
  onUnauthorized: () => void;
}) {
  const [catalog, setCatalog] = useState<CatalogProduct[] | null>(null);
  const [catalogError, setCatalogError] = useState(false);

  useEffect(() => {
    let ignore = false;
    fetch("/api/products", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { products: CatalogProduct[] }) => {
        if (!ignore) setCatalog(d.products);
      })
      .catch(() => {
        if (!ignore) setCatalogError(true);
      });
    return () => {
      ignore = true;
    };
  }, []);

  const rows = useMemo<AdjustRow[]>(() => {
    const byId = new Map<string, AdjustRow>();
    for (const p of catalog ?? []) {
      byId.set(p.id, {
        productId: p.id,
        name: p.name,
        rarity: p.rarity,
        allergens: p.allergens,
        knownStock: p.stockQty,
      });
    }
    for (const slot of ordersData.slots) {
      for (const pt of slot.productTotals) {
        if (!byId.has(pt.productId)) {
          byId.set(pt.productId, {
            productId: pt.productId,
            name: pt.nameSnapshot,
            rarity: null,
            allergens: pt.allergens,
            knownStock: null,
          });
        }
      }
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [catalog, ordersData]);

  return (
    <div>
      <h2 className="font-display text-headline-lg uppercase text-text">Stock adjustment</h2>
      <p className="mt-2 max-w-2xl text-sm text-text-dim">
        Corrects a delivery or a miscount. Enter what changed — staff counted 7 more than the screen
        shows: enter <span className="font-mono text-text">+7</span>. This is always relative, never an
        absolute count, so it composes correctly with a checkout that reserves stock while you&rsquo;re
        mid-count.
      </p>
      <p className="mt-2 max-w-2xl border-2 border-white/10 bg-surface-2 p-3 text-xs text-text-faint">
        This list is products currently for sale, plus anything ordered today that has since sold out or
        been deactivated. A product that is both inactive and had no orders today won&rsquo;t appear here
        yet — a dedicated staff catalog endpoint is requested in{" "}
        <span className="font-mono">docs/HANDOFF.md</span>.
      </p>

      {catalogError && (
        <p role="alert" className="mt-4 border-2 border-danger p-3 text-sm text-danger">
          Couldn&rsquo;t load the live catalog. Items ordered today are still listed below.
        </p>
      )}

      {catalog === null && !catalogError && (
        <p role="status" className="mt-4 text-sm text-text-dim">
          Loading catalog…
        </p>
      )}

      {rows.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {rows.map((row) => (
            <StockRow key={row.productId} row={row} onUnauthorized={onUnauthorized} />
          ))}
        </ul>
      )}
    </div>
  );
}

function StockRow({
  row,
  onUnauthorized,
}: {
  row: AdjustRow;
  onUnauthorized: () => void;
}) {
  const [delta, setDelta] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AdminApiError | null>(null);
  const [result, setResult] = useState<{ previous: number; next: number } | null>(null);

  async function apply(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = delta.trim();
    const n = Number(trimmed);
    if (trimmed === "" || !Number.isInteger(n) || n === 0) {
      setError({ code: "INVALID_INPUT", message: "Enter a non-zero whole number, e.g. +7 or -2." });
      return;
    }
    setBusy(true);
    setError(null);
    const res = await adminFetch<{ stockQty: number; previousStockQty: number }>(
      `/api/admin/products/${row.productId}/stock`,
      { method: "POST", body: JSON.stringify({ delta: n }) },
    );
    setBusy(false);
    if (!res.ok) {
      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      setError(res.error);
      return;
    }
    setResult({ previous: res.data.previousStockQty, next: res.data.stockQty });
    setDelta("");
  }

  return (
    // .clip-shard-tight's bevel is a left/right edge slant meant for a
    // short, centered chip label (SlotPicker, ShardButton) - on a wide,
    // left-aligned, dense-text row like this one it cuts straight through
    // the product name at the top-left corner. .clip-panel only nicks the
    // far corners (same shape OrderRow's cards already use safely), so the
    // full-height left edge stays intact for left-aligned text.
    <li className="clip-panel border-2 border-white/10 bg-surface-2 p-3">
      <form onSubmit={apply} className="flex flex-wrap items-center gap-3">
        <div className="min-w-[12rem] flex-1">
          <p className="font-mono text-sm text-text">{row.name}</p>
          <p className="font-mono text-[11px] text-text-faint">
            {result
              ? `Currently ${result.next}`
              : row.knownStock === null
                ? "Stock unknown — not in the live catalog read"
                : `Currently ${row.knownStock}`}
            {row.allergens.length > 0 && (
              <span className="font-bold text-danger"> · {row.allergens.join(", ")}</span>
            )}
          </p>
        </div>
        {row.rarity && (
          // Solid rarity background + void text, not colored text on the
          // dark surface: docs/DESIGN.md's contrast audit is explicit that
          // several rarity hexes fail WCAG AA as small regular-weight text
          // directly on a mid-tone panel (confirmed here by an axe run —
          // this is the fix, not a judgment call). This is the same
          // badge pattern RarityCard already uses, which the audit confirms
          // passes at 6.6-15:1.
          <span
            className="w-fit px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-void"
            style={{ background: rarityMeta(row.rarity).hex }}
          >
            {rarityMeta(row.rarity).label}
          </span>
        )}
        <label className="sr-only" htmlFor={`delta-${row.productId}`}>
          Stock delta for {row.name}
        </label>
        <input
          id={`delta-${row.productId}`}
          type="text"
          inputMode="numeric"
          value={delta}
          onChange={(e) => setDelta(e.target.value)}
          placeholder="+7 or -2"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `delta-error-${row.productId}` : undefined}
          className="w-24 border-2 border-white/10 bg-surface-3 px-2 py-1 font-mono text-text focus:border-brand"
        />
        <ShardButton type="submit" size="sm" loading={busy}>
          Apply
        </ShardButton>
        {result && (
          <span className="font-mono text-xs text-rarity-uncommon">
            {result.previous} → {result.next}
          </span>
        )}
      </form>
      {error && (
        <p id={`delta-error-${row.productId}`} role="alert" className="mt-1 font-mono text-xs text-danger">
          {error.code === "STOCK_ADJUSTMENT_REJECTED"
            ? `That would leave stock negative (currently ${String(error.stockQty ?? "?")}, requested ${String(error.delta ?? "?")}).`
            : error.code === "PRODUCT_UNAVAILABLE"
              ? "That product no longer exists."
              : error.message}
        </p>
      )}
    </li>
  );
}

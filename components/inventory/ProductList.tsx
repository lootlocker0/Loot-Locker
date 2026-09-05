"use client";

import { useState } from "react";
import { rarityMeta } from "@/lib/rarity";
import { formatCents } from "@/lib/money";
import { ShardButton } from "@/components/ui/ShardButton";
import { ProductForm } from "./ProductForm";
import { StockAdjuster } from "./StockAdjuster";
import type { InventoryProduct } from "./types";

/**
 * Every product, active and inactive, sold-out and in-stock alike — per
 * docs/API-CONTRACT.md §6b this is the deliberate opposite of the public
 * catalog's filtering. Nothing here is hidden or disabled-out-of-view; a
 * deactivated or sold-out row renders with a plain status label instead.
 */
export function ProductList({
  products,
  onProductSaved,
  onStockAdjusted,
  onUnauthorized,
}: {
  products: InventoryProduct[];
  onProductSaved: (product: InventoryProduct) => void;
  onStockAdjusted: (productId: string, stockQty: number) => void;
  onUnauthorized: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adjustingId, setAdjustingId] = useState<string | null>(null);

  if (products.length === 0) {
    return <p className="text-sm text-text-dim">No products yet. Create the first one above.</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {products.map((p) => (
        <li key={p.id} className="clip-panel border-2 border-white/10 bg-surface-2 p-4">
          {editingId === p.id ? (
            <>
              <h3 className="mb-4 font-display text-lg uppercase text-text">Editing {p.name}</h3>
              <ProductForm
                mode="edit"
                initial={p}
                onSaved={(saved) => {
                  onProductSaved(saved);
                  setEditingId(null);
                }}
                onCancel={() => setEditingId(null)}
                onUnauthorized={onUnauthorized}
              />
            </>
          ) : (
            <>
              <ProductRow
                product={p}
                onEdit={() => setEditingId(p.id)}
                onToggleAdjust={() => setAdjustingId(adjustingId === p.id ? null : p.id)}
                adjustOpen={adjustingId === p.id}
              />
              {adjustingId === p.id && (
                <div className="mt-3">
                  <StockAdjuster
                    productId={p.id}
                    name={p.name}
                    currentStock={p.stockQty}
                    onAdjusted={(next) => onStockAdjusted(p.id, next)}
                    onUnauthorized={onUnauthorized}
                  />
                </div>
              )}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

function ProductRow({
  product,
  onEdit,
  onToggleAdjust,
  adjustOpen,
}: {
  product: InventoryProduct;
  onEdit: () => void;
  onToggleAdjust: () => void;
  adjustOpen: boolean;
}) {
  const meta = rarityMeta(product.rarity);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-lg uppercase leading-none text-text">{product.name}</h3>
            <span
              className="px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-void"
              style={{ background: meta.hex }}
            >
              {meta.label}
            </span>
            {!product.active && (
              <span className="border border-text-faint/60 px-1.5 py-0.5 font-mono text-[10px] uppercase text-text-faint">
                Draft (inactive)
              </span>
            )}
            {product.stockQty === 0 && (
              <span className="border border-gold px-1.5 py-0.5 font-mono text-[10px] uppercase text-gold">
                Out of stock
              </span>
            )}
          </div>
          <p className="mt-1 font-mono text-xs text-text-faint">
            {product.slug} · {product.category}
          </p>
        </div>
        <div className="text-right">
          <p className="font-display text-xl text-gold">{formatCents(product.priceCents)}</p>
          <p className="font-mono text-xs text-text-dim">Stock {product.stockQty}</p>
        </div>
      </div>

      <p className="text-sm text-text-dim">{product.description}</p>

      {/* Safety UI. Never truncated, never hover-only, never "+2 more". */}
      {product.allergens.length > 0 ? (
        <ul className="flex flex-wrap gap-1" aria-label="Contains allergens">
          {product.allergens.map((a) => (
            <li key={a} className="border border-danger/60 px-2 py-0.5 font-mono text-[11px] text-danger">
              {a.replace(/_/g, " ")}
            </li>
          ))}
        </ul>
      ) : (
        <p className="font-mono text-[11px] text-rarity-uncommon">
          No allergens listed — not the same as confirmed safe; re-check before trusting this.
        </p>
      )}

      <p className="font-mono text-[11px] text-text-faint">
        Updated {new Date(product.updatedAt).toLocaleString()}
      </p>

      <div className="flex flex-wrap gap-2">
        <ShardButton size="sm" intent="ghost" onClick={onEdit}>
          Edit
        </ShardButton>
        <ShardButton size="sm" intent="ghost" onClick={onToggleAdjust}>
          {adjustOpen ? "Close stock adjuster" : "Adjust stock"}
        </ShardButton>
      </div>
    </div>
  );
}

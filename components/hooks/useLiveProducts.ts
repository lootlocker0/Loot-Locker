"use client";

import { useEffect, useState } from "react";
import type { Allergen, Rarity } from "@prisma/client";

/**
 * Live product read shared by the cart and checkout pages. The cart store
 * only ever holds `{ productId, qty }` (stores/cart.ts) — anything that needs
 * a current price, stock count or allergen list reads it from
 * `GET /api/products` here rather than trusting anything cached in
 * localStorage (CLAUDE.md §6). Extracted from `CartView`'s original inline
 * effect so `CheckoutForm` doesn't grow a second copy of the same
 * fetch/refetch-on-focus logic (docs/HANDOFF.md's "reuse that pattern, don't
 * invent a second one").
 */
export type LiveProduct = {
  id: string;
  name: string;
  priceCents: number;
  rarity: Rarity;
  allergens: Allergen[];
  stockQty: number;
  imageUrl: string;
};

export type LiveProductsState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; products: Map<string, LiveProduct> };

async function fetchLiveProducts(): Promise<Map<string, LiveProduct>> {
  const res = await fetch("/api/products", { cache: "no-store" });
  if (!res.ok) throw new Error(`GET /api/products -> ${res.status}`);
  const data: { products: LiveProduct[] } = await res.json();
  return new Map(data.products.map((p) => [p.id, p]));
}

export function useLiveProducts() {
  const [state, setState] = useState<LiveProductsState>({ status: "loading" });

  // The fetch/setState pair lives inline in the effect body (not behind a
  // `useCallback`-memoized function invoked from the effect), using the
  // standard "ignore" cleanup flag — the shape react-hooks/set-state-in-effect
  // expects for a legitimate mount-time fetch, not the cascading-render
  // pattern it actually flags.
  useEffect(() => {
    let ignore = false;

    async function run() {
      try {
        const products = await fetchLiveProducts();
        if (!ignore) setState({ status: "ready", products });
      } catch {
        if (!ignore) setState({ status: "error" });
      }
    }

    run();
    window.addEventListener("focus", run);
    return () => {
      ignore = true;
      window.removeEventListener("focus", run);
    };
  }, []);

  // User-initiated retry — the normal "respond to a click" case, not the
  // mount-fetch case above.
  async function retry() {
    try {
      const products = await fetchLiveProducts();
      setState({ status: "ready", products });
    } catch {
      setState({ status: "error" });
    }
  }

  return { state, retry };
}

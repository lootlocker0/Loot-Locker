"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Allergen, Rarity } from "@prisma/client";
import { useCart } from "@/stores/cart";
import { rarityMeta } from "@/lib/rarity";
import { formatCents, sumLines } from "@/lib/money";
import { AngledPanel } from "@/components/ui/AngledPanel";
import { ShardButton } from "@/components/ui/ShardButton";
import { ProductImage } from "@/components/ui/ProductImage";

/**
 * The cart store only holds `{ productId, qty }` — this page needs current
 * price/stock/allergens to render an honest line, so it fetches
 * `GET /api/products` (no filters) client-side rather than trusting anything
 * cached in localStorage. See frontend.md §4 / CLAUDE.md §6.
 */
type LiveProduct = {
  id: string;
  name: string;
  priceCents: number;
  rarity: Rarity;
  allergens: Allergen[];
  stockQty: number;
  imageUrl: string;
};

type FetchState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; products: Map<string, LiveProduct> };

async function fetchLiveProducts(): Promise<Map<string, LiveProduct>> {
  const res = await fetch("/api/products", { cache: "no-store" });
  if (!res.ok) throw new Error(`GET /api/products -> ${res.status}`);
  const data: { products: LiveProduct[] } = await res.json();
  return new Map(data.products.map((p) => [p.id, p]));
}

export function CartView() {
  const lines = useCart((s) => s.lines);
  const setQty = useCart((s) => s.setQty);
  const removeLine = useCart((s) => s.remove);
  const [state, setState] = useState<FetchState>({ status: "loading" });

  // GET /api/products filters to active + in-stock (docs/API-CONTRACT.md §6),
  // so stock that sold out since a line was added simply won't come back —
  // that line renders as unavailable below rather than crashing on a missing
  // lookup. Refetch on focus so a student who parked on this tab for a while
  // sees current prices/stock, same reasoning as the checkout slot refresh
  // in frontend.md §5.
  //
  // The fetch/setState pair lives inline in the effect (not behind a
  // `useCallback`-memoized function called from the effect body) and uses
  // the standard "ignore" cleanup flag — that's the shape
  // react-hooks/set-state-in-effect expects for a legitimate mount-time
  // fetch, as opposed to a `useCallback` ref invoked synchronously from the
  // effect, which is the cascading-render pattern it actually flags.
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

  // Retry is a user-initiated event handler, not effect-driven — setState
  // here is the normal "respond to a click" case, not the mount-fetch case
  // above.
  async function retry() {
    try {
      const products = await fetchLiveProducts();
      setState({ status: "ready", products });
    } catch {
      setState({ status: "error" });
    }
  }

  if (lines.length === 0) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-20 text-center sm:px-8">
        <h1 className="font-display text-headline-lg uppercase text-text">Loadout</h1>
        <p className="mt-4 text-text-dim">
          Your locker is empty. Head to The Locker to build your loadout.
        </p>
        <Link
          href="/snacks"
          className="clip-shard mx-auto mt-8 inline-flex items-center justify-center bg-gold px-8 py-3 font-display uppercase tracking-wide text-void transition-transform hover:brightness-110 active:scale-[.97]"
        >
          Browse The Locker
        </Link>
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div className="mx-auto max-w-6xl px-4 py-20 text-center sm:px-8">
        <h1 className="font-display text-headline-lg uppercase text-text">Loadout</h1>
        <p role="status" className="mt-4 text-text-dim">
          Loading your loadout…
        </p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="mx-auto max-w-6xl px-4 py-20 text-center sm:px-8">
        <h1 className="font-display text-headline-lg uppercase text-text">Loadout</h1>
        <p role="alert" className="mx-auto mt-4 max-w-md border-2 border-danger p-4 text-danger">
          Couldn&rsquo;t load your loadout. Check your connection and try again.
        </p>
        <ShardButton className="mt-6" onClick={retry}>
          Retry
        </ShardButton>
      </div>
    );
  }

  const products = state.products;
  const known = lines.flatMap((line) => {
    const product = products.get(line.productId);
    return product ? [{ line, product }] : [];
  });
  const unavailable = lines.filter((l) => !products.has(l.productId));

  const subtotalCents = sumLines(
    known.map(({ line, product }) => ({
      unitPriceCents: product.priceCents,
      qty: line.qty,
    })),
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-8">
      <h1 className="font-display text-headline-lg uppercase text-text">Loadout</h1>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          {known.map(({ line, product }) => {
            const meta = rarityMeta(product.rarity);
            const atMax = line.qty >= product.stockQty;
            return (
              <div
                key={product.id}
                className="clip-shard-tight flex flex-wrap items-center gap-4 border-l-4 bg-surface-2 p-4"
                style={{ borderLeftColor: meta.hex }}
              >
                <div className="h-16 w-16 shrink-0 overflow-hidden bg-surface-lowest">
                  <ProductImage
                    src={product.imageUrl}
                    alt=""
                    rarity={product.rarity}
                    width={64}
                    height={64}
                    className="h-full w-full object-contain"
                  />
                </div>

                <div className="min-w-[10rem] flex-1">
                  <p className="font-display uppercase text-text">{product.name}</p>
                  {product.allergens.length > 0 ? (
                    <ul className="mt-1 flex flex-wrap gap-1" aria-label="Contains allergens">
                      {product.allergens.map((a) => (
                        <li
                          key={a}
                          className="border border-danger/60 px-1.5 py-0.5 font-mono text-[10px] text-danger"
                        >
                          {a.replace(/_/g, " ")}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 font-mono text-[10px] text-rarity-uncommon">
                      No listed allergens
                    </p>
                  )}
                  <p className="mt-1 font-mono text-sm text-gold">
                    {formatCents(product.priceCents)}
                    {atMax && (
                      <span className="ml-2 text-text-faint">
                        {product.stockQty} in stock
                      </span>
                    )}
                  </p>
                </div>

                <div
                  className="flex items-center gap-2"
                  role="group"
                  aria-label={`Quantity for ${product.name}`}
                >
                  <button
                    type="button"
                    className="clip-hex flex h-8 w-8 items-center justify-center bg-surface-4 font-display text-lg text-text"
                    onClick={() => setQty(product.id, line.qty - 1, product.stockQty)}
                    aria-label={`Decrease quantity of ${product.name}`}
                  >
                    −
                  </button>
                  <span className="w-6 text-center font-mono text-text" aria-live="polite">
                    {line.qty}
                  </span>
                  <button
                    type="button"
                    className="clip-hex flex h-8 w-8 items-center justify-center bg-surface-4 font-display text-lg text-text disabled:opacity-30"
                    onClick={() => setQty(product.id, line.qty + 1, product.stockQty)}
                    disabled={atMax}
                    aria-label={`Increase quantity of ${product.name}`}
                  >
                    +
                  </button>
                </div>

                <p className="w-20 text-right font-mono text-text">
                  {formatCents(product.priceCents * line.qty)}
                </p>

                <button
                  type="button"
                  onClick={() => removeLine(product.id)}
                  className="font-mono text-xs uppercase text-text-faint underline-offset-2 hover:text-danger hover:underline"
                >
                  Remove
                </button>
              </div>
            );
          })}

          {unavailable.map((l) => (
            <div
              key={l.productId}
              className="clip-shard-tight flex flex-wrap items-center justify-between gap-4 border-l-4 border-danger bg-surface-2 p-4"
            >
              <p role="alert" className="text-sm text-danger">
                An item in your loadout is no longer available and isn&rsquo;t
                included in your total.
              </p>
              <button
                type="button"
                onClick={() => removeLine(l.productId)}
                className="font-mono text-xs uppercase text-text-faint underline-offset-2 hover:text-danger hover:underline"
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <AngledPanel
          as="aside"
          variant="panel-reverse"
          tone="lowest"
          border="gold"
          glow
          className="h-fit lg:sticky lg:top-24"
        >
          <h2 className="font-display text-lg uppercase text-text">Order summary</h2>
          <dl className="mt-4 flex items-center justify-between border-t border-white/10 pt-4 font-mono text-sm">
            <dt className="text-text-dim">Subtotal</dt>
            <dd className="text-text">{formatCents(subtotalCents)}</dd>
          </dl>
          <p className="mt-2 font-mono text-[11px] text-text-faint">
            Tax and the final total are calculated at checkout.
          </p>
          <ShardButton size="lg" disabled className="mt-6 w-full">
            Checkout — coming soon
          </ShardButton>
        </AngledPanel>
      </div>
    </div>
  );
}

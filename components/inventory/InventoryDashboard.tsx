"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ShardButton } from "@/components/ui/ShardButton";
import { CountsPanel } from "./CountsPanel";
import { ProductForm } from "./ProductForm";
import { ProductList } from "./ProductList";
import { inventoryFetch, type InventoryResult } from "./inventoryApi";
import type { InventoryProductsResponse } from "./types";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: InventoryProductsResponse };

function fetchProducts(): Promise<InventoryResult<InventoryProductsResponse>> {
  return inventoryFetch<InventoryProductsResponse>("/api/inventory/products");
}

/**
 * Signed-in shell for `/inventory`: the "what needs attention" counts
 * dashboard, the create form, and the full product list (active, inactive,
 * every stock level — §6b). Any authenticated fetch that comes back 401
 * (session expired, secret rotated, another editor's session logged out)
 * calls `onUnauthorized`, which drops the whole tree back to sign-in — that
 * is the actual authorization boundary here, not the Server Component's
 * cookie check.
 */
export function InventoryDashboard({ onUnauthorized }: { onUnauthorized: () => void }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "loading" });
  const [creating, setCreating] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let ignore = false;

    async function run() {
      setState((s) => (s.status === "ready" ? s : { status: "loading" }));
      const res = await fetchProducts();
      if (ignore) return;
      if (!res.ok) {
        if (res.status === 401) {
          onUnauthorized();
          return;
        }
        setState({ status: "error", message: res.error.message });
        return;
      }
      setState({ status: "ready", data: res.data });
    }

    run();
    return () => {
      ignore = true;
    };
  }, [onUnauthorized]);

  const load = useCallback(async () => {
    const res = await fetchProducts();
    if (!res.ok) {
      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      setState({ status: "error", message: res.error.message });
      return;
    }
    setState({ status: "ready", data: res.data });
  }, [onUnauthorized]);

  async function signOut() {
    setSigningOut(true);
    await inventoryFetch("/api/inventory/logout", { method: "POST" });
    setSigningOut(false);
    onUnauthorized();
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-void">
      <header className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-4 border-b border-white/5 bg-surface px-4 py-4 sm:px-8">
        <h1 className="font-display text-headline-md uppercase text-brand">Catalog editor</h1>
        <div className="flex flex-wrap items-center gap-3">
          <ShardButton size="sm" intent="ghost" onClick={load}>
            Refresh
          </ShardButton>
          <ShardButton size="sm" intent="ghost" loading={signingOut} onClick={signOut}>
            Sign out
          </ShardButton>
        </div>
      </header>

      <main className="px-4 py-8 sm:px-8">
        {state.status === "loading" && (
          <p role="status" className="text-text-dim">
            Loading products…
          </p>
        )}

        {state.status === "error" && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-4 border-2 border-danger bg-surface-2 p-4 text-danger"
          >
            {state.message}
            <ShardButton size="sm" onClick={load}>
              Retry
            </ShardButton>
          </div>
        )}

        {state.status === "ready" && (
          <>
            <section aria-label="What needs attention">
              <CountsPanel counts={state.data.counts} />
            </section>

            <section className="mt-8">
              {!creating ? (
                <ShardButton onClick={() => setCreating(true)}>+ Add a new product</ShardButton>
              ) : (
                <div className="clip-panel border-2 border-brand/50 bg-surface-2 p-4">
                  <h2 className="mb-4 font-display text-headline-md uppercase text-text">
                    New product
                  </h2>
                  <ProductForm
                    mode="create"
                    onSaved={() => {
                      setCreating(false);
                      load();
                    }}
                    onCancel={() => setCreating(false)}
                    onUnauthorized={onUnauthorized}
                  />
                </div>
              )}
            </section>

            <section className="mt-8">
              <h2 className="mb-4 font-display text-headline-md uppercase text-text">
                All products ({state.data.products.length})
              </h2>
              <ProductList
                products={state.data.products}
                onProductSaved={(saved) => {
                  setState((s) =>
                    s.status === "ready"
                      ? {
                          status: "ready",
                          data: {
                            ...s.data,
                            products: s.data.products.map((p) => (p.id === saved.id ? saved : p)),
                          },
                        }
                      : s,
                  );
                  // Counts (active/inactive/outOfStock/withEmptyAllergenList)
                  // depend on fields this save may have changed — re-derive
                  // from the server rather than trying to patch them by hand.
                  load();
                }}
                onStockAdjusted={(productId, stockQty) => {
                  setState((s) =>
                    s.status === "ready"
                      ? {
                          status: "ready",
                          data: {
                            ...s.data,
                            products: s.data.products.map((p) =>
                              p.id === productId ? { ...p, stockQty } : p,
                            ),
                          },
                        }
                      : s,
                  );
                  load();
                }}
                onUnauthorized={onUnauthorized}
              />
            </section>
          </>
        )}
      </main>
    </div>
  );
}

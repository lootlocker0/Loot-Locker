import { create } from "zustand";
import { persist } from "zustand/middleware";

// Per frontend.md §3 (verbatim shape). Bump SCHEMA_VERSION to auto-clear
// stale carts on deploy — a persisted cart from a prior schema is worse than
// an empty one.
const SCHEMA_VERSION = 2;

const MAX_LINE_QTY = 10;

type Line = { productId: string; qty: number };

type CartState = {
  lines: Line[];
  /**
   * True once `persist` has finished reading `localStorage` on the client.
   * The server (and the client's very first render, before hydration) always
   * sees `false` with `lines: []` — components that render cart-derived UI
   * (the nav's cart-count badge) gate on this instead of an `isMounted`
   * `useState`/`useEffect` pair, so the count flips to its real value via
   * zustand's own store update rather than a React setState call made
   * synchronously inside an effect body.
   */
  hasHydrated: boolean;
  setHasHydrated: (v: boolean) => void;
  /**
   * Adds one unit of `productId`, or increments an existing line.
   * `maxStock` must come from a live read (a server component render or a
   * fresh `GET /api/products` response) — never from a value already sitting
   * in this store, and never trusted from localStorage. See CLAUDE.md §6.
   */
  add: (productId: string, maxStock: number) => void;
  /** Sets the exact quantity for a line, clamped to `[0, maxStock, 10]`. `qty <= 0` removes the line. */
  setQty: (productId: string, qty: number, maxStock: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
  count: () => number;
};

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      lines: [],
      hasHydrated: false,
      setHasHydrated: (v) => set({ hasHydrated: v }),

      add: (productId, maxStock) =>
        set((s) => {
          const existing = s.lines.find((l) => l.productId === productId);
          if (!existing) {
            if (maxStock <= 0) return s;
            return { lines: [...s.lines, { productId, qty: 1 }] };
          }
          return {
            lines: s.lines.map((l) =>
              l.productId === productId
                ? { ...l, qty: Math.min(l.qty + 1, maxStock, MAX_LINE_QTY) }
                : l,
            ),
          };
        }),

      setQty: (productId, qty, maxStock) =>
        set((s) => ({
          lines:
            qty <= 0
              ? s.lines.filter((l) => l.productId !== productId)
              : s.lines.map((l) =>
                  l.productId === productId
                    ? { ...l, qty: Math.min(qty, maxStock, MAX_LINE_QTY) }
                    : l,
                ),
        })),

      remove: (productId) =>
        set((s) => ({ lines: s.lines.filter((l) => l.productId !== productId) })),

      clear: () => set({ lines: [] }),
      count: () => get().lines.reduce((a, l) => a + l.qty, 0),
    }),
    {
      name: "ll-cart",
      version: SCHEMA_VERSION,
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);

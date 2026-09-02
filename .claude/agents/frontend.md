---
name: frontend
description: Extracts the design system from Google Stitch, then builds all LootLockers UI — pages, components, cart state, Stripe Elements. Use for anything under app/(shop), components, or stores. Never writes API routes or touches Prisma.
tools: mcp__stitch__*, Read, Write, Edit, Glob, Grep, Bash
model: sonnet
---

You build the LootLockers interface.

Read `CLAUDE.md`, `docs/DESIGN.md`, and `docs/API-CONTRACT.md` before every task.

**If an endpoint you need is absent from API-CONTRACT.md, append the request to
`docs/HANDOFF.md` and return to the manager.** Do not write the route. Do not
stub it and continue.

---

## P0 · Design extraction (run once, first)

1. List Stitch projects, find LootLockers. Several matches → stop and ask.
2. Fetch every screen: home, snacks, cart, checkout, confirmation, about.
3. Write `docs/DESIGN.md`: every hex named semantically (`--rarity-epic`, not
   `--purple-2`), font stacks, type scale in rem, spacing scale, radii, shadows,
   the `clip-path` polygons behind every angled edge, and per-screen grid notes.
4. Land the tokens in Tailwind and build the primitives. Nothing else.

**Stitch exports raw HTML/CSS. Do not paste it into the repo.** It is
non-semantic and inaccessible. Read it, extract the system, rebuild as React.

Report in DESIGN.md: any text/background pair failing WCAG AA (purple on
near-black often does at small sizes), and any third-party IP under "Must
replace before launch."

---

## 1. Tokens — `app/globals.css`

Tailwind v4 uses `@theme`, not a JS config for colors.

```css
@import "tailwindcss";

@theme {
  --color-void:        #07070F;
  --color-surface:     #10101C;
  --color-surface-2:   #191929;
  --color-shard:       #1B7FE8;
  --color-shard-lite:  #29A8F5;
  --color-epic:        #A855F7;
  --color-gold:        #F5C518;

  --color-rarity-common:    #9BA0A8;
  --color-rarity-uncommon:  #38D64B;
  --color-rarity-rare:      #1B7FE8;
  --color-rarity-epic:      #A855F7;
  --color-rarity-legendary: #F5C518;

  --color-text:      #F4F4F8;
  --color-text-dim:  #A0A0B4;
  --color-danger:    #FF4D4D;

  --font-display: "Bungee", system-ui, sans-serif;
  --font-body:    "Inter", system-ui, sans-serif;

  --text-hero:  clamp(2.5rem, 7vw, 5rem);
  --text-h1:    clamp(2rem, 5vw, 3.5rem);
  --text-h2:    clamp(1.5rem, 3.5vw, 2.25rem);

  --radius-card: 0.75rem;
  --shadow-glow: 0 0 24px -4px var(--glow-color, transparent);
}

@layer utilities {
  /* The beveled parallelogram from the Stitch design */
  .clip-shard {
    clip-path: polygon(14px 0, 100% 0, calc(100% - 14px) 100%, 0 100%);
  }
  .clip-panel {
    clip-path: polygon(0 0, 100% 0, 100% calc(100% - 22px), calc(100% - 22px) 100%, 0 100%);
  }
}

/* Focus is not decorative. The rarity glow is not a focus ring. */
:where(a, button, input, select, [tabindex]):focus-visible {
  outline: 3px solid var(--color-gold);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .01ms !important;
    transition-duration: .01ms !important;
  }
}
```

---

## 2. Primitives — `components/ui/`

### `ShardButton.tsx`

```tsx
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const shard = cva(
  "clip-shard inline-flex items-center justify-center font-display uppercase " +
    "tracking-wide transition-transform active:scale-[.97] " +
    "disabled:opacity-40 disabled:pointer-events-none",
  {
    variants: {
      intent: {
        gold:  "bg-gold text-void hover:brightness-110",
        epic:  "bg-epic text-white hover:brightness-110",
        ghost: "bg-transparent text-text border-2 border-shard hover:bg-shard/15",
      },
      size: {
        sm: "px-5 py-2 text-sm",
        md: "px-8 py-3 text-base",
        lg: "px-12 py-4 text-lg w-full sm:w-auto",
      },
    },
    defaultVariants: { intent: "gold", size: "md" },
  },
);

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof shard> & { loading?: boolean };

export function ShardButton({
  intent, size, loading, children, className, disabled, ...rest
}: Props) {
  return (
    <button
      className={cn(shard({ intent, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? "Working…" : children}
    </button>
  );
}
```

Real `<button>`. Not a styled `<div>` with an onClick — that loses keyboard
access, focus, and screen-reader semantics all at once.

### `RarityCard.tsx`

```tsx
import Image from "next/image";
import { rarityMeta } from "@/lib/rarity";
import type { Rarity, Allergen } from "@prisma/client";

export function RarityCard({
  name, description, priceCents, imageUrl, rarity, allergens, stockQty, onAdd,
}: {
  name: string; description: string; priceCents: number; imageUrl: string;
  rarity: Rarity; allergens: Allergen[]; stockQty: number;
  onAdd: () => void;
}) {
  const meta = rarityMeta(rarity);

  return (
    <article
      className="clip-panel relative flex flex-col gap-3 border-2 bg-surface p-4"
      style={{
        borderColor: meta.hex,
        // Glow is decoration; the tier is also stated as text below.
        boxShadow: `0 0 22px -6px ${meta.glow}`,
      }}
    >
      <span
        className="absolute right-3 top-3 px-2 py-0.5 text-[11px] font-bold uppercase text-void"
        style={{ background: meta.hex }}
      >
        {meta.label}
      </span>

      <Image
        src={imageUrl} alt="" width={320} height={320}
        className="aspect-square w-full object-contain"
      />

      <h3 className="font-display text-lg uppercase text-text">{name}</h3>
      <p className="text-sm text-text-dim">{description}</p>

      {/* Safety UI. Never truncated, never hover-only, never "+2 more". */}
      {allergens.length > 0 ? (
        <ul className="flex flex-wrap gap-1" aria-label="Contains allergens">
          {allergens.map((a) => (
            <li key={a} className="border border-danger/60 px-2 py-0.5 text-[11px] text-danger">
              {a.replace("_", " ")}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-rarity-uncommon">No listed allergens</p>
      )}

      <div className="mt-auto flex items-center justify-between pt-2">
        <span className="font-display text-xl text-gold">
          ${(priceCents / 100).toFixed(2)}
        </span>
        <ShardButton size="sm" onClick={onAdd} disabled={stockQty === 0}>
          {stockQty === 0 ? "Sold out" : "Add"}
        </ShardButton>
      </div>

      {stockQty > 0 && stockQty <= 5 && (
        <p className="text-[11px] text-gold">Only {stockQty} left</p>
      )}
    </article>
  );
}
```

### `SlotChip.tsx`

Radio-group semantics so keyboard arrows work. Full slots render disabled with a
reason, never hidden — a disappearing option looks like a bug.

```tsx
export function SlotPicker({
  slots, value, onChange,
}: {
  slots: { id: string; label: string; startTime: string; remaining: number; full: boolean }[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <fieldset>
      <legend className="font-display uppercase text-text">Extraction window</legend>
      <div role="radiogroup" className="mt-3 flex flex-wrap gap-2">
        {slots.map((s) => (
          <label
            key={s.id}
            className={`clip-shard cursor-pointer border-2 px-4 py-2 text-sm
              ${s.full ? "cursor-not-allowed border-white/10 text-text-dim opacity-50"
                       : value === s.id ? "border-gold bg-gold text-void"
                                        : "border-shard text-text hover:bg-shard/15"}`}
          >
            <input
              type="radio" name="slot" value={s.id} className="sr-only"
              checked={value === s.id} disabled={s.full}
              onChange={() => onChange(s.id)}
            />
            {s.startTime} · {s.label}
            {s.full ? " — Full" : s.remaining <= 5 ? ` — ${s.remaining} left` : ""}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
```

---

## 3. Cart store — `stores/cart.ts`

```ts
import { create } from "zustand";
import { persist } from "zustand/middleware";

const SCHEMA_VERSION = 2; // bump to auto-clear stale carts on deploy

type Line = { productId: string; qty: number };

type CartState = {
  lines: Line[];
  add: (productId: string, maxStock: number) => void;
  setQty: (productId: string, qty: number, maxStock: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
  count: () => number;
};

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      lines: [],

      add: (productId, maxStock) =>
        set((s) => {
          const existing = s.lines.find((l) => l.productId === productId);
          if (!existing) return { lines: [...s.lines, { productId, qty: 1 }] };
          // Bounded by live stock passed in from the server component.
          // Never trust a stored quantity.
          return {
            lines: s.lines.map((l) =>
              l.productId === productId
                ? { ...l, qty: Math.min(l.qty + 1, maxStock, 10) }
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
                    ? { ...l, qty: Math.min(qty, maxStock, 10) }
                    : l,
                ),
        })),

      remove: (productId) =>
        set((s) => ({ lines: s.lines.filter((l) => l.productId !== productId) })),

      clear: () => set({ lines: [] }),
      count: () => get().lines.reduce((a, l) => a + l.qty, 0),
    }),
    { name: "ll-cart", version: SCHEMA_VERSION },
  ),
);
```

---

## 4. Catalog — `app/(shop)/snacks/page.tsx`

Server Component reading straight from the DB. No client fetch waterfall.

```tsx
import { db } from "@/lib/db";
import { ProductGrid } from "@/components/ProductGrid";

export const revalidate = 30;

export default async function SnacksPage({
  searchParams,
}: { searchParams: Promise<{ category?: string; exclude?: string }> }) {
  const sp = await searchParams;
  const exclude = sp.exclude?.split(",").filter(Boolean) ?? [];

  const products = await db.product.findMany({
    where: {
      active: true,
      ...(sp.category && { category: sp.category }),
      ...(exclude.length && { NOT: { allergens: { hasSome: exclude as any } } }),
    },
    orderBy: [{ sortOrder: "asc" }],
  });

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="font-display text-h1 uppercase text-epic">The Locker</h1>
      <ProductGrid products={products} />
    </main>
  );
}
```

---

## 5. Checkout — `app/(shop)/checkout/CheckoutForm.tsx`

```tsx
"use client";

import { useEffect, useState } from "react";
import {
  Elements, PaymentElement, useStripe, useElements,
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useRouter } from "next/navigation";
import { useCart } from "@/stores/cart";

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!,
);

export function CheckoutForm({ serverTotalCents }: { serverTotalCents: number }) {
  const { lines, clear } = useCart();
  const router = useRouter();
  const [slots, setSlots] = useState<any[]>([]);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [form, setForm] = useState({
    studentName: "", email: "", phone: "", homeroom: "",
    slotId: "", paymentMethod: "CARD" as "CARD" | "CASH_AT_PICKUP",
  });

  // Slot capacity goes stale fast. Re-fetch whenever the tab regains
  // focus — a student sitting here for ten minutes would otherwise
  // submit straight into a full slot.
  useEffect(() => {
    const load = () =>
      fetch("/api/slots").then((r) => r.json()).then((d) => setSlots(d.slots));
    load();
    window.addEventListener("focus", load);
    const t = setInterval(load, 30_000);
    return () => {
      window.removeEventListener("focus", load);
      clearInterval(t);
    };
  }, []);

  async function submit() {
    setError(null);
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        items: lines,
        clientTotalCents: serverTotalCents, // sent for reconciliation only
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      setError(data.error);
      // Slot filled or stock ran out while they typed — refresh the
      // options so the error is actionable, not just a dead end.
      if (data.error.code === "SLOT_FULL" || data.error.code === "OUT_OF_STOCK") {
        fetch("/api/slots").then((r) => r.json()).then((d) => setSlots(d.slots));
        router.refresh();
      }
      return;
    }

    if (!data.requiresPayment) {
      clear();
      router.push(`/order/${data.orderNumber}`);
      return;
    }
    setClientSecret(data.clientSecret);
  }

  if (clientSecret) {
    return (
      <Elements
        stripe={stripePromise}
        options={{ clientSecret, appearance: { theme: "night" } }}
      >
        <PaymentStep orderTotal={serverTotalCents} />
      </Elements>
    );
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
      {/* fields — every input has an associated <label> and
          aria-describedby wired to its error text */}
      {error && (
        <p role="alert" className="border-2 border-danger p-3 text-danger">
          {error.message}
        </p>
      )}
      <ShardButton size="lg" type="submit">Proceed to extraction</ShardButton>
    </form>
  );
}

function PaymentStep({ orderTotal }: { orderTotal: number }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function pay() {
    if (!stripe || !elements) return;
    setBusy(true);
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/order/processing`,
      },
    });
    // We land here only on immediate failure. Success redirects, and the
    // order is marked PAID by the webhook — never by this callback.
    if (error) setMsg(error.message ?? "Payment failed.");
    setBusy(false);
  }

  return (
    <div>
      <PaymentElement />
      {msg && <p role="alert" className="mt-3 text-danger">{msg}</p>}
      <ShardButton size="lg" loading={busy} onClick={pay}>
        Pay ${(orderTotal / 100).toFixed(2)}
      </ShardButton>
    </div>
  );
}
```

**The confirmation page must poll, not assume.** After redirect, the order may
still be `PENDING` for a second or two while the webhook lands. Poll
`/api/orders/[orderNumber]` every 1.5s for up to 20s, then show "we're confirming
your payment" rather than a false success.

---

## 6. Rules

**Never treat a client-computed total as authoritative.** Show an optimistic
subtotal for feel, but render the server's figure before payment. If they
disagree, show the server's and surface the difference.

**Allergen badges appear on the card, in the cart line, and on the
confirmation.** Never truncated, never hover-only, never collapsed.

**Cart quantity is bounded by live stock**, passed down from the server
component — not by a number stored in localStorage.

**Accessibility:** real `<button>`/`<a>`, labelled inputs, `aria-describedby` on
errors, `role="alert"` on error regions, rarity glow `aria-hidden`. The whole
purchase flow must complete keyboard-only.

**Performance:** `next/image` with explicit dimensions, AVIF/WebP. Ship the shop
under 150KB of JS. `"use client"` only for cart, forms, and Stripe Elements.

---

## 7. Definition of done

Matches DESIGN.md, works keyboard-only, handles loading/empty/error states,
consumes only endpoints present in API-CONTRACT.md, and passes an axe scan.

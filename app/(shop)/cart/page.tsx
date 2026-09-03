import type { Metadata } from "next";
import { CartView } from "@/components/cart/CartView";

// CartView reacts to client-side cart state and a live product fetch, so it
// has to be a Client Component (frontend.md §4) — this file stays a Server
// Component purely so the route can export real per-page metadata.
export const metadata: Metadata = {
  title: "Loadout | LootLockers",
  description: "Review your cart before heading to pickup.",
};

export default function CartPage() {
  return <CartView />;
}

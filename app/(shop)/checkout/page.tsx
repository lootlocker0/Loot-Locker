import type { Metadata } from "next";
import { CheckoutForm } from "@/components/checkout/CheckoutForm";

// CheckoutForm reads live cart/product/slot state and calls POST
// /api/checkout, so it has to be a Client Component (same reasoning as
// CartPage/CartView) — this file stays a Server Component purely so the
// route can export real per-page metadata.
export const metadata: Metadata = {
  title: "Extraction Point | LootLockers",
  description: "Confirm pickup and payment for your loadout.",
};

export default function CheckoutPage() {
  return <CheckoutForm />;
}

"use client";

import { use } from "react";
import { OrderConfirmation } from "@/components/order/OrderConfirmation";

// This whole route has to be a Client Component. GET /api/orders/[orderNumber]
// is authorised by a cookie scoped to `Path=/api/orders` — it is never sent on
// the navigation to this page itself, only on a client `fetch` made from it
// (docs/API-CONTRACT.md §6). A Server Component's server-side `fetch` would
// not carry it either way. Because the page is a Client Component, it cannot
// also export `generateMetadata`/`metadata` (server-only) — the confirmation
// page falls back to the root layout's default title.
export default function OrderConfirmationPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}) {
  const { orderNumber } = use(params);
  return <OrderConfirmation orderNumber={orderNumber} />;
}

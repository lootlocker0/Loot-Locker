import type { Metadata } from "next";
import { cookies } from "next/headers";
import { InventoryApp } from "@/components/inventory/InventoryApp";

// Never indexed — this is a data-entry tool, not a page search engines
// should ever surface.
export const metadata: Metadata = {
  title: "Catalog | LootLockers",
  robots: { index: false, follow: false },
};

export default async function InventoryPage() {
  const jar = await cookies();
  // Rendering convenience ONLY, per docs/API-CONTRACT.md §6b: presence of
  // the `ll_inventory` cookie decides which first paint to show (sign-in
  // form vs. dashboard shell) so a signed-in editor doesn't see a flash of
  // the sign-in form on every reload. It is never treated as permission to
  // display data — InventoryApp still makes its own authenticated fetch and
  // falls back to the sign-in form on any 401. This cookie is structurally
  // independent of the staff `ll_admin` cookie checked by app/admin/page.tsx.
  const hasSessionCookieHint = jar.has("ll_inventory");
  return <InventoryApp hasSessionCookieHint={hasSessionCookieHint} />;
}

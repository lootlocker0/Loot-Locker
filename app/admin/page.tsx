import type { Metadata } from "next";
import { cookies } from "next/headers";
import { AdminApp } from "@/components/admin/AdminApp";

// Never indexed — this is a staff tool with children's names and pickup
// codes behind it, not a page search engines should ever surface.
export const metadata: Metadata = {
  title: "Staff | LootLockers",
  robots: { index: false, follow: false },
};

export default async function AdminPage() {
  const jar = await cookies();
  // Rendering convenience ONLY, per docs/API-CONTRACT.md §6a: presence of
  // the `ll_admin` cookie decides which first paint to show (sign-in form
  // vs. dashboard shell) so a signed-in staff member doesn't see a flash of
  // the sign-in form on every reload. It is never treated as permission to
  // display data — AdminApp still makes its own authenticated fetch and
  // falls back to the sign-in form on any 401.
  const hasSessionCookieHint = jar.has("ll_admin");
  return <AdminApp hasSessionCookieHint={hasSessionCookieHint} />;
}

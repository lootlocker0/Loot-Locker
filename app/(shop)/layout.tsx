import type { ReactNode } from "react";
import { Nav } from "@/components/layout/Nav";
import { Footer } from "@/components/layout/Footer";

/**
 * Shared chrome for every route in the (shop) group (`/snacks`, `/cart`,
 * `/about`). Route groups don't affect the URL, so this doesn't touch
 * `app/layout.tsx` (root, not owned by frontend — see docs/HANDOFF.md for
 * the next/font request). `/` renders the same Nav/Footer directly from
 * `app/page.tsx` since it sits outside this group.
 */
export default function ShopLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Nav />
      <main className="flex-1">{children}</main>
      <Footer />
    </>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { InventorySignIn } from "./InventorySignIn";
import { InventoryDashboard } from "./InventoryDashboard";
import { inventoryFetch } from "./inventoryApi";

type AuthState = "checking" | "signed_out" | "signed_in";

/**
 * Top-level client boundary for `/inventory`. `hasSessionCookieHint` comes
 * from the Server Component reading `cookies()` — per
 * docs/API-CONTRACT.md §6b that is a rendering convenience only ("decide
 * whether to render a sign-in form"), never permission to show data. So a
 * cookie hint of `true` still goes through a real `GET /api/inventory/session`
 * call before anything renders; a hint of `false` skips straight to the
 * sign-in form without waiting on a request that would just 401 anyway.
 *
 * Mirrors components/admin/AdminApp.tsx's pattern deliberately, but does not
 * import from it — different cookie, different secret, and per §6b this
 * separation is meant to hold at the frontend-code level too, not just in
 * the route tree.
 */
export function InventoryApp({ hasSessionCookieHint }: { hasSessionCookieHint: boolean }) {
  const router = useRouter();
  const [auth, setAuth] = useState<AuthState>(hasSessionCookieHint ? "checking" : "signed_out");

  useEffect(() => {
    if (!hasSessionCookieHint) return;
    let ignore = false;

    async function verify() {
      const res = await inventoryFetch<{ authenticated: boolean; sessionId: string }>(
        "/api/inventory/session",
      );
      if (!ignore) setAuth(res.ok ? "signed_in" : "signed_out");
    }

    verify();
    return () => {
      ignore = true;
    };
    // hasSessionCookieHint is the server-captured value this effect exists
    // to verify against; it's not expected to change during this
    // component's lifetime (a new value means a fresh navigation, which
    // remounts the tree from app/inventory/page.tsx).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSignedIn() {
    setAuth("signed_in");
    // Re-derive the server-rendered cookie hint too, so a hard refresh of
    // this page starts from the same state this soft transition just
    // reached, instead of the two ever disagreeing.
    router.refresh();
  }

  function handleUnauthorized() {
    setAuth("signed_out");
  }

  if (auth === "checking") {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p role="status" className="text-text-dim">
          Checking catalog session…
        </p>
      </main>
    );
  }

  if (auth === "signed_out") {
    return <InventorySignIn onSignedIn={handleSignedIn} />;
  }

  return <InventoryDashboard onUnauthorized={handleUnauthorized} />;
}

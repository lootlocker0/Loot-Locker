"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminSignIn } from "./AdminSignIn";
import { Dashboard } from "./Dashboard";
import { adminFetch } from "./adminApi";

type AuthState = "checking" | "signed_out" | "signed_in";

/**
 * Top-level client boundary for `/admin`. `hasSessionCookieHint` comes from
 * the Server Component reading `cookies()` — per docs/API-CONTRACT.md §6a
 * that is a rendering convenience only ("decide whether to render a sign-in
 * form"), never permission to show data. So a cookie hint of `true` still
 * goes through a real `GET /api/admin/session` call before anything renders;
 * a hint of `false` skips straight to the sign-in form without waiting on a
 * request that would just 401 anyway.
 */
export function AdminApp({ hasSessionCookieHint }: { hasSessionCookieHint: boolean }) {
  const router = useRouter();
  const [auth, setAuth] = useState<AuthState>(hasSessionCookieHint ? "checking" : "signed_out");

  // Mount-once verification, only when there's a cookie worth checking. The
  // fetch/setState pair lives inline in the effect body with the standard
  // "ignore" cleanup flag — same shape as
  // components/hooks/useLiveProducts.ts, for the same reason (see that
  // file's comment): this is the pattern react-hooks/set-state-in-effect
  // expects from a legitimate mount-time check, not the cascading-render
  // pattern it actually flags.
  useEffect(() => {
    if (!hasSessionCookieHint) return;
    let ignore = false;

    async function verify() {
      const res = await adminFetch<{ authenticated: boolean; sessionId: string }>(
        "/api/admin/session",
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
    // remounts the tree from app/admin/page.tsx).
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
          Checking staff session…
        </p>
      </main>
    );
  }

  if (auth === "signed_out") {
    return <AdminSignIn onSignedIn={handleSignedIn} />;
  }

  return <Dashboard onUnauthorized={handleUnauthorized} />;
}

"use client";

import { useState } from "react";
import { AngledPanel } from "@/components/ui/AngledPanel";
import { ShardButton } from "@/components/ui/ShardButton";
import { adminFetch } from "./adminApi";
import type { AdminApiError } from "./types";

/**
 * `POST /api/admin/login`. Per docs/API-CONTRACT.md §6a: `ADMIN_UNAUTHORIZED`
 * (wrong passcode, 401) is a normal retry; `ADMIN_NOT_CONFIGURED` (503) means
 * the server has no `ADMIN_PASSCODE`/`ADMIN_SESSION_SECRET` set at all — no
 * amount of retyping fixes that, so it gets a visibly different message
 * rather than being folded into "wrong passcode".
 */
export function AdminSignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [passcode, setPasscode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<AdminApiError | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    const res = await adminFetch<{ ok: true; expiresAt: string }>("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ passcode }),
    });

    setSubmitting(false);

    if (!res.ok) {
      setError(res.error);
      // A wrong passcode is retyped, not silently reused — but don't clear a
      // rate-limited or not-configured attempt, since the passcode itself
      // wasn't the problem and re-typing loses nothing by staying filled in.
      if (res.error.code === "ADMIN_UNAUTHORIZED") setPasscode("");
      return;
    }

    onSignedIn();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-16">
      <AngledPanel as="section" variant="panel" tone={3} border="gold" glow>
        <h1 className="font-display text-headline-md uppercase text-text">
          Staff sign-in
        </h1>
        <p className="mt-2 text-sm text-text-dim">
          Enter the shared staff passcode to open today&rsquo;s pick list.
        </p>

        <form onSubmit={submit} noValidate className="mt-6 flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="admin-passcode" className="font-mono text-xs uppercase text-text-faint">
              Passcode
            </label>
            <input
              id="admin-passcode"
              name="passcode"
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "admin-passcode-error" : undefined}
              className="border-2 border-white/10 bg-surface-2 px-3 py-2 text-text focus:border-brand"
            />
          </div>

          {error && (
            <p
              id="admin-passcode-error"
              role="alert"
              className="border-2 border-danger bg-surface-2 p-3 text-sm text-danger"
            >
              {error.code === "ADMIN_NOT_CONFIGURED"
                ? "Staff sign-in isn't set up on this server. That's an ops problem, not a wrong passcode — retyping it won't help. Tell whoever manages the deployment that ADMIN_PASSCODE or ADMIN_SESSION_SECRET is missing."
                : error.code === "RATE_LIMITED"
                  ? "Too many attempts. Wait a minute, then try once more."
                  : error.message}
            </p>
          )}

          <ShardButton type="submit" size="lg" loading={submitting}>
            Sign in
          </ShardButton>
        </form>
      </AngledPanel>
    </main>
  );
}

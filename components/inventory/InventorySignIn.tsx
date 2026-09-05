"use client";

import { useState } from "react";
import { AngledPanel } from "@/components/ui/AngledPanel";
import { ShardButton } from "@/components/ui/ShardButton";
import { inventoryFetch } from "./inventoryApi";
import type { InventoryApiError } from "./types";

/**
 * `POST /api/inventory/login`. Per docs/API-CONTRACT.md §6b:
 * `INVENTORY_UNAUTHORIZED` (wrong passcode, 401) is a normal retry;
 * `INVENTORY_NOT_CONFIGURED` (503) means the server has no
 * `INVENTORY_PASSCODE`/`INVENTORY_SESSION_SECRET` set (or the passcode is
 * under 8 characters) — no amount of retyping fixes that, so it gets a
 * visibly different message rather than being folded into "wrong passcode".
 *
 * This is a separate credential from the staff `/admin` passcode by design
 * (§6b: "these two people must not hold the staff credential") — this form
 * never falls back to, or mentions, the staff sign-in.
 */
export function InventorySignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [passcode, setPasscode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<InventoryApiError | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    const res = await inventoryFetch<{ ok: true; expiresAt: string }>(
      "/api/inventory/login",
      { method: "POST", body: JSON.stringify({ passcode }) },
    );

    setSubmitting(false);

    if (!res.ok) {
      setError(res.error);
      // A wrong passcode is retyped, not silently reused — but don't clear a
      // rate-limited or not-configured attempt, since the passcode itself
      // wasn't the problem and re-typing loses nothing by staying filled in.
      if (res.error.code === "INVENTORY_UNAUTHORIZED") setPasscode("");
      return;
    }

    onSignedIn();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-16">
      <AngledPanel as="section" variant="panel" tone={3} border="gold" glow>
        <h1 className="font-display text-headline-md uppercase text-text">
          Catalog sign-in
        </h1>
        <p className="mt-2 text-sm text-text-dim">
          Enter the inventory-editor passcode to update products, photos and
          stock. This is a different passcode from the staff pick-list
          screen — if you only have that one, ask whoever set this up for the
          catalog-editor passcode instead.
        </p>

        <form onSubmit={submit} noValidate className="mt-6 flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="inventory-passcode" className="font-mono text-xs uppercase text-text-faint">
              Passcode
            </label>
            <input
              id="inventory-passcode"
              name="passcode"
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "inventory-passcode-error" : undefined}
              className="border-2 border-white/10 bg-surface-2 px-3 py-2 text-text focus:border-brand"
            />
          </div>

          {error && (
            <p
              id="inventory-passcode-error"
              role="alert"
              className="border-2 border-danger bg-surface-2 p-3 text-sm text-danger"
            >
              {error.code === "INVENTORY_NOT_CONFIGURED"
                ? "Catalog sign-in isn't set up on this server. That's an ops problem, not a wrong passcode — retyping it won't help. Tell whoever manages the deployment that INVENTORY_PASSCODE or INVENTORY_SESSION_SECRET is missing."
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

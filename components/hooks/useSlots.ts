"use client";

import { useEffect, useState } from "react";

/**
 * Pickup-window capacity from `GET /api/slots`. Deliberately re-fetched on
 * mount, on tab focus, and every 30s while checkout is open: per
 * docs/API-CONTRACT.md §6, "a cached slot list sends a student into a window
 * that filled thirty seconds ago and turns into a SLOT_FULL 409 mid-checkout,
 * at lunch, with a queue behind them."
 */
export type LiveSlot = {
  id: string;
  label: string;
  startTime: string;
  location: string;
  serviceDate: string;
  remaining: number;
  full: boolean;
};

export type SlotsState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; slots: LiveSlot[] };

async function fetchSlots(): Promise<LiveSlot[]> {
  const res = await fetch("/api/slots", { cache: "no-store" });
  if (!res.ok) throw new Error(`GET /api/slots -> ${res.status}`);
  const data: { slots: LiveSlot[] } = await res.json();
  return data.slots;
}

export function useSlots() {
  const [state, setState] = useState<SlotsState>({ status: "loading" });

  useEffect(() => {
    let ignore = false;

    async function run() {
      try {
        const slots = await fetchSlots();
        if (!ignore) setState({ status: "ready", slots });
      } catch {
        if (!ignore) setState({ status: "error" });
      }
    }

    run();
    window.addEventListener("focus", run);
    const t = setInterval(run, 30_000);
    return () => {
      ignore = true;
      window.removeEventListener("focus", run);
      clearInterval(t);
    };
  }, []);

  // Called explicitly after a SLOT_FULL response so the picker updates
  // immediately rather than waiting for the next 30s tick or a focus event.
  async function reload() {
    try {
      const slots = await fetchSlots();
      setState({ status: "ready", slots });
    } catch {
      setState({ status: "error" });
    }
  }

  return { state, reload };
}

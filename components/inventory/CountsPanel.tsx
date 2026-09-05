import { AngledPanel } from "@/components/ui/AngledPanel";
import type { InventoryCounts } from "./types";

/**
 * The "what needs attention" dashboard docs/API-CONTRACT.md §6b asks for —
 * surfaced above the product list, not buried in it. `outOfStock` and
 * `withEmptyAllergenList` get the gold/danger treatment because they're
 * worklists (things to go check), not just totals; `total`/`active`/
 * `inactive` are plain counts.
 */
export function CountsPanel({ counts }: { counts: InventoryCounts }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
      <Stat label="Total products" value={counts.total} tone="neutral" />
      <Stat label="Active (visible)" value={counts.active} tone="neutral" />
      <Stat label="Inactive (drafts)" value={counts.inactive} tone="neutral" />
      <Stat
        label="Out of stock"
        value={counts.outOfStock}
        tone="warn"
        hint="Stock is 0 — check the shelf."
      />
      <Stat
        label="Empty allergen list"
        value={counts.withEmptyAllergenList}
        tone="danger"
        hint={'Not a safety claim — "never reviewed" and "confirmed none" look identical here. Worth re-checking each one.'}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number;
  tone: "neutral" | "warn" | "danger";
  hint?: string;
}) {
  const border = tone === "danger" ? "gold" : tone === "warn" ? "gold" : "none";
  return (
    <AngledPanel as="div" variant="card" tone={tone === "neutral" ? 2 : 3} border={border} glow={false}>
      <p className="font-mono text-3xl font-bold text-text">{value}</p>
      <p className="mt-1 font-mono text-xs uppercase text-text-faint">{label}</p>
      {hint && <p className="mt-2 text-xs text-text-dim">{hint}</p>}
    </AngledPanel>
  );
}

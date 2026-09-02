/**
 * Temporary local rarity lookup, scoped to components/ui.
 *
 * CLAUDE.md assigns the canonical `lib/rarity.ts` (one lookup object, hex +
 * glow rgba per tier) to backend as part of P1. That file does not exist yet
 * at P0, and frontend does not own lib/**, so this module exists only so
 * RarityCard can render standalone before P1 lands.
 *
 * TODO(P1 handoff): once backend publishes lib/rarity.ts, swap every import
 * of this file for `@/lib/rarity` and delete this one. Do not let the two
 * drift - the hexes below are copied verbatim from CLAUDE.md section 4 /
 * docs/DESIGN.md so the swap is a no-op if backend follows the same contract.
 */

export type Rarity = "COMMON" | "UNCOMMON" | "RARE" | "EPIC" | "LEGENDARY";

/**
 * Placeholder allergen union. Backend's prisma/schema.prisma is the source of
 * truth for the real enum (P1) - this is a best-guess shape wide enough to
 * exercise the "never truncated" allergen-badge UI in RarityCard before that
 * schema exists. String-literal unions are structurally compatible with a
 * Prisma string enum of the same members, so swapping the import later is
 * safe.
 */
export type Allergen =
  | "PEANUT"
  | "TREE_NUT"
  | "DAIRY"
  | "EGG"
  | "GLUTEN"
  | "SOY"
  | "SESAME"
  | "SHELLFISH"
  | "FISH";

export const RARITY = {
  COMMON:    { label: "Common",    hex: "#9BA0A8", glow: "rgba(155,160,168,.35)", order: 0 },
  UNCOMMON:  { label: "Uncommon",  hex: "#38D64B", glow: "rgba(56,214,75,.40)",   order: 1 },
  RARE:      { label: "Rare",      hex: "#1B7FE8", glow: "rgba(27,127,232,.45)",  order: 2 },
  EPIC:      { label: "Epic",      hex: "#A855F7", glow: "rgba(168,85,247,.50)",  order: 3 },
  LEGENDARY: { label: "Legendary", hex: "#F5C518", glow: "rgba(245,197,24,.55)",  order: 4 },
} as const satisfies Record<Rarity, { label: string; hex: string; glow: string; order: number }>;

export type RarityMeta = (typeof RARITY)[Rarity];
export const rarityMeta = (r: Rarity): RarityMeta => RARITY[r];

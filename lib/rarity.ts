import { Rarity } from "@prisma/client";

export const RARITY = {
  COMMON: {
    label: "Common",
    hex: "#9BA0A8",
    glow: "rgba(155,160,168,.35)",
    order: 0,
  },
  UNCOMMON: {
    label: "Uncommon",
    hex: "#38D64B",
    glow: "rgba(56,214,75,.40)",
    order: 1,
  },
  RARE: {
    label: "Rare",
    hex: "#1B7FE8",
    glow: "rgba(27,127,232,.45)",
    order: 2,
  },
  EPIC: {
    label: "Epic",
    hex: "#A855F7",
    glow: "rgba(168,85,247,.50)",
    order: 3,
  },
  LEGENDARY: {
    label: "Legendary",
    hex: "#F5C518",
    glow: "rgba(245,197,24,.55)",
    order: 4,
  },
} as const satisfies Record<
  Rarity,
  { label: string; hex: string; glow: string; order: number }
>;

export type RarityMeta = (typeof RARITY)[Rarity];
export const rarityMeta = (r: Rarity): RarityMeta => RARITY[r];

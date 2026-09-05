import type { Allergen, Rarity } from "@prisma/client";

/**
 * Shapes copied 1:1 from docs/API-CONTRACT.md §6b ("Product shape (this
 * section only)"). This file has no runtime behaviour — it exists so every
 * inventory component imports the same field names instead of re-declaring
 * `InventoryProduct` several slightly different ways.
 *
 * This is a deliberately separate type module from components/admin/types.ts
 * even though `InventoryProduct` and the staff route's product fields
 * overlap — the two auth systems are structurally independent per §6b, and
 * that separation is meant to hold in the frontend code too, not just the
 * backend route tree.
 */

export type InventoryProduct = {
  id: string;
  slug: string;
  name: string;
  description: string;
  priceCents: number;
  /** Free string at the API layer; see lib/validation.ts's PRODUCT_CATEGORIES
   * for the four values the UI actually offers. Kept as `string` here (not
   * `ProductCategory`) because this type mirrors the wire shape exactly, and
   * the wire shape is a plain string per §6b. */
  category: string;
  rarity: Rarity;
  allergens: Allergen[];
  stockQty: number;
  active: boolean;
  imageUrl: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type InventoryCounts = {
  total: number;
  active: number;
  inactive: number;
  outOfStock: number;
  /** Not a safety claim (docs/API-CONTRACT.md §6b) — the DB can't tell
   * "checked, contains none" from "never filled in". A worklist, not a
   * verdict. */
  withEmptyAllergenList: number;
};

export type InventoryProductsResponse = {
  products: InventoryProduct[];
  counts: InventoryCounts;
};

export type InventoryErrorCode =
  | "INVENTORY_UNAUTHORIZED"
  | "INVENTORY_NOT_CONFIGURED"
  | "INVALID_INPUT"
  | "ALLERGENS_NOT_REVIEWED"
  | "PRODUCT_SLUG_TAKEN"
  | "PRODUCT_UNAVAILABLE"
  | "STOCK_ADJUSTMENT_REJECTED"
  | "RATE_LIMITED"
  | "INTERNAL";

/** The error envelope from docs/API-CONTRACT.md §2, with code-specific detail
 * fields left as `unknown` — each call site narrows the ones it expects. */
export type InventoryApiError = {
  code: InventoryErrorCode;
  message: string;
  [detail: string]: unknown;
};

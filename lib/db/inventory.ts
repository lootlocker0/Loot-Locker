import { db } from "@/lib/db";

// Shared pieces of the P4b inventory-editor routes.
//
// SCOPE OF THIS MODULE, and it is the whole point of it existing separately
// from lib/db/admin.ts: it touches `db.product` and nothing else. There is no
// `db.order`, no `db.orderItem`, no `db.setting`, no Stripe import, and no
// `getSetting` call anywhere in this file or in any route that imports it.
// `scripts/verify-inventory-isolation.mjs` asserts that mechanically over the
// whole namespace and is meant to be run in CI, because a boundary that is only
// true because everyone remembered is not a boundary.

/// Every Product column an inventory route may return.
///
/// An explicit projection, not the whole row, for the same reason
/// `ADMIN_ORDER_SELECT` is one: a column added in a later phase must not appear
/// in a response just by existing. `createdAt`/`updatedAt` ARE included here,
/// unlike the public catalog projection — an editor asking "did my change save,
/// and when" is exactly the question `updatedAt` answers, and neither timestamp
/// is anybody's personal data.
export const INVENTORY_PRODUCT_SELECT = {
  id: true,
  slug: true,
  name: true,
  description: true,
  priceCents: true,
  category: true,
  rarity: true,
  allergens: true,
  stockQty: true,
  active: true,
  imageUrl: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type InventoryProduct = NonNullable<
  Awaited<ReturnType<typeof findInventoryProduct>>
>;

/// Name → slug, used only when a create request does not supply one.
///
/// Deliberately NOT clever: no transliteration, no de-duplication suffix. If the
/// derived slug collides the route answers `PRODUCT_SLUG_TAKEN` and the editor
/// picks a different name, because two products called "Chips" that differ only
/// by a `-2` is a catalog mistake worth stopping rather than a naming problem
/// worth solving automatically. A slug that comes out empty (a name made
/// entirely of punctuation) returns "" and the caller turns that into a 400,
/// rather than inventing a key.
export function slugifyProductName(name: string): string {
  return name
    .normalize("NFKD")
    // Strip combining marks so "Jalapeño" becomes "jalapeno" rather than
    // losing the letter entirely.
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
}

/// Fetch one product for an inventory route, or `null`.
export function findInventoryProduct(productId: string) {
  return db.product.findUnique({
    where: { id: productId },
    select: INVENTORY_PRODUCT_SELECT,
  });
}

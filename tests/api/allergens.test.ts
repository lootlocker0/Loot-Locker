import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetDb } from "../setup/db";
import {
  checkoutPayload,
  getOrder,
  getProducts,
  postCheckout,
  seedProduct,
  seedSlot,
} from "../helpers";

/**
 * Allergen data is safety-critical (CLAUDE.md §2.8). Treated here like a
 * medication dosage field: never inferred, never defaulted, never truncated,
 * and never retroactively rewritten on an order somebody was already handed.
 */
interface CatalogProduct {
  id: string;
  name: string;
  allergens: string[];
}

describe("allergen integrity", () => {
  beforeEach(resetDb);

  it("survives the full round trip from catalog to receipt", async () => {
    const slot = await seedSlot({ capacity: 5 });
    const p = await seedProduct({
      allergens: ["DAIRY", "GLUTEN", "SOY"],
      stockQty: 5,
      priceCents: 200,
    });

    const catalog = await getProducts();
    expect(
      catalog.body.products.find((x: CatalogProduct) => x.id === p.id).allergens.sort(),
    ).toEqual(["DAIRY", "GLUTEN", "SOY"]);

    const r = await postCheckout(
      checkoutPayload({ slotId: slot.id, items: [{ productId: p.id, qty: 1 }] }),
    );
    const item = await testDb.orderItem.findFirstOrThrow();
    expect([...item.allergensSnapshot].sort()).toEqual(["DAIRY", "GLUTEN", "SOY"]);

    const cookie = r.cookies.map((c) => c.split(";")[0]).join("; ");
    const receipt = await getOrder(r.body.orderNumber, cookie);
    expect(receipt.body.items[0].allergensSnapshot).toEqual(
      expect.arrayContaining(["DAIRY", "GLUTEN", "SOY"]),
    );
    // Untruncated: the count on the receipt equals the count on the product.
    expect(receipt.body.items[0].allergensSnapshot).toHaveLength(3);
  });

  it("does not mutate historical orders when a product is corrected", async () => {
    const slot = await seedSlot({ capacity: 5 });
    const p = await seedProduct({ allergens: ["DAIRY"], stockQty: 5, priceCents: 200 });
    await postCheckout(
      checkoutPayload({ slotId: slot.id, items: [{ productId: p.id, qty: 1 }] }),
    );

    await testDb.product.update({
      where: { id: p.id },
      data: { allergens: ["DAIRY", "PEANUTS"] },
    });

    const item = await testDb.orderItem.findFirstOrThrow();
    expect(item.allergensSnapshot).toEqual(["DAIRY"]);
  });

  it("keeps an empty list meaning 'reviewed, none present' rather than dropping the field", async () => {
    const slot = await seedSlot({ capacity: 5 });
    const p = await seedProduct({ allergens: [], stockQty: 5, priceCents: 200 });
    const r = await postCheckout(
      checkoutPayload({ slotId: slot.id, items: [{ productId: p.id, qty: 1 }] }),
    );
    const cookie = r.cookies.map((c) => c.split(";")[0]).join("; ");
    const receipt = await getOrder(r.body.orderNumber, cookie);
    expect(Object.hasOwn(receipt.body.items[0], "allergensSnapshot")).toBe(true);
    expect(receipt.body.items[0].allergensSnapshot).toEqual([]);
  });

  it("excludes matching products from a filtered catalog", async () => {
    await seedProduct({ name: "Nutty", allergens: ["PEANUTS"], stockQty: 5 });
    await seedProduct({ name: "Safe", allergens: [], stockQty: 5 });

    const r = await getProducts({ excludeAllergens: "PEANUTS" });
    expect(r.body.products.map((p: CatalogProduct) => p.name)).toEqual(["Safe"]);
  });

  it("excludes on ANY match, not ALL", async () => {
    // The classic hasSome/hasEvery bug. A product with DAIRY+PEANUTS must be
    // excluded when filtering PEANUTS alone.
    await seedProduct({ name: "Both", allergens: ["DAIRY", "PEANUTS"], stockQty: 5 });
    const r = await getProducts({ excludeAllergens: "PEANUTS" });
    expect(r.body.products).toHaveLength(0);
  });

  it("excludes on ANY of several tokens, not on carrying all of them", async () => {
    await seedProduct({ name: "OnlyDairy", allergens: ["DAIRY"], stockQty: 5 });
    await seedProduct({ name: "OnlyGluten", allergens: ["GLUTEN"], stockQty: 5 });
    await seedProduct({ name: "Clean", allergens: [], stockQty: 5 });

    const r = await getProducts({ excludeAllergens: "DAIRY,PEANUTS,GLUTEN" });
    expect(r.body.products.map((p: CatalogProduct) => p.name)).toEqual(["Clean"]);
  });

  it("rejects an unrecognised allergen token instead of filtering nothing", async () => {
    await seedProduct({ name: "Milky", allergens: ["DAIRY"], stockQty: 5 });
    // MILK is not the enum value; DAIRY is. A pass-through would return a full
    // catalog with a 200 and look like it filtered.
    const r = await getProducts({ excludeAllergens: "MILK" });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("INVALID_INPUT");
  });

  it("rejects a lower-cased allergen token rather than normalising it", async () => {
    await seedProduct({ name: "Milky", allergens: ["DAIRY"], stockQty: 5 });
    const r = await getProducts({ excludeAllergens: "dairy" });
    expect(r.status).toBe(400);
  });

  it("still applies the filter when other filters are present", async () => {
    await seedProduct({
      name: "SweetNutty",
      category: "sweet",
      allergens: ["PEANUTS"],
      stockQty: 5,
    });
    await seedProduct({ name: "SweetSafe", category: "sweet", allergens: [], stockQty: 5 });
    await seedProduct({ name: "SavorySafe", category: "savory", allergens: [], stockQty: 5 });

    const r = await getProducts({ category: "sweet", excludeAllergens: "PEANUTS" });
    expect(r.body.products.map((p: CatalogProduct) => p.name)).toEqual(["SweetSafe"]);
  });
});

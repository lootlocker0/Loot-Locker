import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetDb } from "../setup/db";
import { seedSlot, seedProduct, checkoutPayload, postCheckout } from "../helpers";

/**
 * Slot capacity under concurrent load.
 *
 * `Promise.all`, never a for-loop. A sequential loop passes against a
 * read-then-write `if (booked < capacity)` implementation, which is the single
 * most common way a suite like this reports a false green.
 */
describe("slot capacity under concurrent load", () => {
  beforeEach(resetDb);

  it("admits exactly one order when one seat remains", async () => {
    const slot = await seedSlot({ capacity: 1 });
    const product = await seedProduct({ stockQty: 100 });

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        postCheckout(
          checkoutPayload({
            slotId: slot.id,
            email: `student${i}@school.ca`,
            items: [{ productId: product.id, qty: 1 }],
          }),
        ),
      ),
    );

    const ok = results.filter((r) => r.status === 200);
    const full = results.filter((r) => r.body?.error?.code === "SLOT_FULL");

    expect(ok).toHaveLength(1);
    expect(full).toHaveLength(19);
    // Nobody may get a 500: SLOT_FULL is the expected answer for 19 of these,
    // and an unhandled error here means a deadlock or a pool timeout.
    expect(results.filter((r) => r.status === 500)).toHaveLength(0);

    const after = await testDb.pickupSlot.findUniqueOrThrow({ where: { id: slot.id } });
    expect(after.bookedCount).toBe(1);
    expect(after.bookedCount).toBeLessThanOrEqual(after.capacity);

    // The 19 losers' stock reservations must have rolled back with their seats.
    const p = await testDb.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(p.stockQty).toBe(99);
    expect(await testDb.order.count()).toBe(1);
  });

  it("never lets booked_count exceed capacity under sustained load", async () => {
    const slot = await seedSlot({ capacity: 5 });
    const product = await seedProduct({ stockQty: 1000 });

    const results = await Promise.all(
      Array.from({ length: 60 }, (_, i) =>
        postCheckout(
          checkoutPayload({
            slotId: slot.id,
            email: `s${i}@school.ca`,
            items: [{ productId: product.id, qty: 1 }],
          }),
        ),
      ),
    );

    const after = await testDb.pickupSlot.findUniqueOrThrow({ where: { id: slot.id } });
    expect(after.bookedCount).toBe(5);
    expect(results.filter((r) => r.status === 200)).toHaveLength(5);
    expect(await testDb.order.count()).toBe(5);

    // Stock moved exactly as many times as a seat did.
    const p = await testDb.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(p.stockQty).toBe(995);
  });

  it("returns SLOT_FULL, not a 404 oracle, for a slot that does not exist", async () => {
    const product = await seedProduct({ stockQty: 5 });
    const r = await postCheckout(
      checkoutPayload({
        // Well-formed cuid, no such row. API-CONTRACT §6: missing, deactivated
        // and full must be indistinguishable.
        slotId: "cmtkqayye000q5p7dxg1ygkzz",
        items: [{ productId: product.id, qty: 1 }],
      }),
    );
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("SLOT_FULL");
    expect(await testDb.order.count()).toBe(0);
  });

  it("returns SLOT_FULL for a deactivated slot and holds no stock", async () => {
    const slot = await seedSlot({ capacity: 5, active: false });
    const product = await seedProduct({ stockQty: 5 });
    const r = await postCheckout(
      checkoutPayload({ slotId: slot.id, items: [{ productId: product.id, qty: 1 }] }),
    );
    expect(r.body.error.code).toBe("SLOT_FULL");
    const p = await testDb.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(p.stockQty).toBe(5);
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetDb } from "../setup/db";
import {
  checkoutPayload,
  paymentIntentSucceeded,
  postCheckout,
  postWebhook,
  seedProduct,
  seedSlot,
  spend,
  spendAttempt,
} from "../helpers";
import { schoolDayStartInstant } from "@/lib/timezone";

const CAP = 1500; // lib/settings.ts default; the settings table is left empty.

/**
 * The daily spend cap. HANDOFF §21 calls the race here "the single most
 * exploitable hole in the route" and explicitly did not test it.
 */
describe("daily spend cap", () => {
  beforeEach(resetDb);

  it("enforces the cap at the boundary, sequentially", async () => {
    const slot = await seedSlot({ capacity: 20 });
    const email = "kid@school.ca";

    await spend(email, 1400, slot.id);
    expect((await spendAttempt(email, 100, slot.id)).status).toBe(200);

    const over = await spendAttempt(email, 1, slot.id);
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe("SPEND_CAP_EXCEEDED");
    expect(over.body.error.capCents).toBe(CAP);
    expect(over.body.error.spentCents).toBe(1500);

    const sum = await testDb.order.aggregate({
      _sum: { totalCents: true },
      where: { email },
    });
    expect(sum._sum.totalCents).toBe(1500);
  });

  it("cannot be sidestepped by changing the capitalisation of the email", async () => {
    const slot = await seedSlot({ capacity: 20 });
    await spend("kid@school.ca", 1400, slot.id);

    const r = await spendAttempt("  KID@School.CA  ", 200, slot.id);
    expect(r.body?.error?.code).toBe("SPEND_CAP_EXCEEDED");
  });

  /**
   * KNOWN BUG — HANDOFF §21.
   *
   * The cap is a read-then-write with no lock and no database constraint behind
   * it: every concurrent checkout aggregates the same `spent` value, every one
   * of them passes the check, and every one of them commits. There is no
   * `reserve_spend()` the way there is a `reserve_stock()`.
   *
   * Six simultaneous 300c orders for one address. Each is individually well
   * under the 1500c cap; together they are 1800c.
   */
  it.fails("KNOWN BUG: the cap is bypassed entirely by concurrent checkouts", async () => {
    const slot = await seedSlot({ capacity: 50 });
    const email = "racer@school.ca";
    const products = await Promise.all(
      Array.from({ length: 6 }, () => seedProduct({ priceCents: 300, stockQty: 10 })),
    );

    const results = await Promise.all(
      products.map((p) =>
        postCheckout(
          checkoutPayload({
            slotId: slot.id,
            email,
            paymentMethod: "CASH_AT_PICKUP",
            items: [{ productId: p.id, qty: 1 }],
          }),
        ),
      ),
    );

    const accepted = results.filter((r) => r.status === 200).length;
    const capped = results.filter(
      (r) => r.body?.error?.code === "SPEND_CAP_EXCEEDED",
    ).length;
    const committed =
      (
        await testDb.order.aggregate({
          _sum: { totalCents: true },
          where: { email, status: { in: ["RESERVED", "PAID", "PACKED", "PICKED_UP"] } },
        })
      )._sum.totalCents ?? 0;

    // Evidence for docs/HANDOFF.md, printed on every run.
    console.log(
      `[spend-cap race] 6×300c concurrent for one email: accepted=${accepted} ` +
        `capped=${capped} committedCents=${committed} capCents=${CAP}`,
    );

    // What must hold: a student can never commit more than the cap in a day.
    expect(committed).toBeLessThanOrEqual(CAP);
  });

  /**
   * The same money, one request at a time, is correctly refused — which is what
   * makes the concurrent case a race rather than a misconfiguration.
   */
  it("refuses the same six orders when they arrive sequentially", async () => {
    const slot = await seedSlot({ capacity: 50 });
    const email = "sequential@school.ca";
    let accepted = 0;
    for (let i = 0; i < 6; i++) {
      const r = await spendAttempt(email, 300, slot.id);
      if (r.status === 200) accepted++;
    }
    expect(accepted).toBe(5);
    const committed = (
      await testDb.order.aggregate({ _sum: { totalCents: true }, where: { email } })
    )._sum.totalCents;
    expect(committed).toBe(1500);
  });

  /**
   * Documented-by-design, and HANDOFF §21 asks for it to be tested and then put
   * in front of the human: `PENDING` is excluded from the cap aggregate, so a
   * student can hold an unlimited number of unpaid card orders, each under the
   * cap, and pay all of them. The cap only ever constrains money already
   * committed.
   *
   * CLAUDE.md §7 puts changes to the spend cap on the human escalation list,
   * and this is effectively a cap change.
   */
  it("does not count PENDING card orders, so four 1400c holds can all be paid", async () => {
    const slot = await seedSlot({ capacity: 20 });
    const email = "holder@school.ca";

    const orders = [];
    for (let i = 0; i < 4; i++) {
      const p = await seedProduct({ priceCents: 1400, stockQty: 5 });
      const r = await postCheckout(
        checkoutPayload({
          slotId: slot.id,
          email,
          paymentMethod: "CARD",
          items: [{ productId: p.id, qty: 1 }],
        }),
      );
      expect(r.status).toBe(200); // never capped, however many are outstanding
      orders.push(r.body.orderNumber as string);
    }

    const rows = await testDb.order.findMany({
      where: { email },
      select: { id: true, stripePaymentIntentId: true, totalCents: true },
    });
    for (const row of rows) {
      const w = await postWebhook(
        paymentIntentSucceeded(row.stripePaymentIntentId!, row.totalCents),
      );
      expect(w.status).toBe(200);
    }

    const paid = await testDb.order.aggregate({
      _sum: { totalCents: true },
      where: { email, status: "PAID" },
    });
    expect(paid._sum.totalCents).toBe(5600); // 3.7× the daily cap, all paid
  });

  /**
   * The cap window is the SCHOOL's day (`schoolDayStartInstant`), not the
   * server's. The test process runs in Pacific/Kiritimati and the server in
   * Asia/Tokyo, so a server-local implementation would draw the boundary in a
   * different place than this assertion does.
   */
  it("counts only orders placed since the school day began", async () => {
    const slot = await seedSlot({ capacity: 20 });
    const email = "yesterday@school.ca";
    const dayStart = schoolDayStartInstant();

    await spend(email, 1400, slot.id);

    // One second before the school's midnight: yesterday's money.
    await testDb.order.updateMany({
      where: { email },
      data: { createdAt: new Date(dayStart.getTime() - 1000) },
    });
    const fresh = await spendAttempt(email, 1400, slot.id);
    expect(fresh.status).toBe(200);

    // One second after the school's midnight: today's money, and it counts.
    await testDb.order.updateMany({
      where: { email },
      data: { createdAt: new Date(dayStart.getTime() + 1000) },
    });
    const blocked = await spendAttempt(email, 200, slot.id);
    expect(blocked.body?.error?.code).toBe("SPEND_CAP_EXCEEDED");
  });
});

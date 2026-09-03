import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { resetDb } from "../setup/db";
import { RATE_LIMIT_ON } from "../setup/env";
import { readServerLog } from "../setup/server";
import {
  checkoutPayload,
  postCheckout,
  seedProduct,
  seedSlot,
  type ApiResponse,
} from "../helpers";

/**
 * The 429 branch, end to end.
 *
 * Run separately — `QA_RATE_LIMIT=on npx vitest run tests/ratelimit` — because
 * Next refuses to start a second dev server for the same project, so the
 * limits-disabled server the concurrency suite needs and the limits-enabled
 * server this needs cannot coexist in one run.
 *
 * HANDOFF §19 asked for exactly this: without it, the `RATE_LIMITED` path ships
 * having never executed. What it does NOT tell you is anything about
 * production — `memory` mode is per process and Vercel runs many (§19, §21).
 */
describe("checkout rate limiting", () => {
  beforeAll(() => {
    if (!RATE_LIMIT_ON) {
      throw new Error(
        "This suite requires QA_RATE_LIMIT=on so the server runs with the " +
          "limiter in memory mode. Run: QA_RATE_LIMIT=on npx vitest run tests/ratelimit",
      );
    }
  });

  beforeEach(resetDb);

  it("boots the server in memory mode, not disabled", async () => {
    // The mode is logged when `lib/rate-limit.ts` is first imported, and
    // `next dev` compiles a route on its first request — so touch the route
    // before reading the log.
    await postCheckout("{}", { ip: "192.0.2.1" });
    const modes = readServerLog().match(/{"event":"rate_limit_mode"[^}]*}/g) ?? [];
    expect(modes.length).toBeGreaterThan(0);
    expect(modes[modes.length - 1]).toContain('"mode":"memory"');
  });

  it("429s the 11th checkout from one IP inside a minute", async () => {
    const slot = await seedSlot({ capacity: 50 });
    const product = await seedProduct({ priceCents: 100, stockQty: 100 });
    const ip = "203.0.113.7";

    const statuses: number[] = [];
    let limited: ApiResponse | null = null;
    for (let i = 0; i < 12; i++) {
      const r = await postCheckout(
        checkoutPayload({
          slotId: slot.id,
          // Distinct emails, so the 5/min email limit cannot be what fires.
          email: `ip-limit-${i}@school.ca`,
          items: [{ productId: product.id, qty: 1 }],
        }),
        { ip },
      );
      statuses.push(r.status);
      if (r.status === 429 && !limited) limited = r;
    }

    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
    expect(limited?.body.error.code).toBe("RATE_LIMITED");
  });

  it("429s the 6th checkout for one email even from fresh IPs", async () => {
    const slot = await seedSlot({ capacity: 50 });
    const product = await seedProduct({ priceCents: 100, stockQty: 100 });

    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      const r = await postCheckout(
        checkoutPayload({
          slotId: slot.id,
          email: "one.address@school.ca",
          items: [{ productId: product.id, qty: 1 }],
        }),
        { ip: `198.51.100.${i}` },
      );
      statuses.push(r.status);
    }

    expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });

  /**
   * HANDOFF §21: "The IP key trusts `x-forwarded-for`." Vercel overwrites it at
   * the edge, so it is trustworthy there and only there. Behind any other proxy
   * — or none — rotating the header defeats the IP limit completely. Asserted
   * so the deployment assumption is a tested fact rather than a comment.
   */
  it("is defeated entirely by rotating x-forwarded-for", async () => {
    const slot = await seedSlot({ capacity: 60 });
    const product = await seedProduct({ priceCents: 100, stockQty: 100 });

    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) {
      const r = await postCheckout(
        checkoutPayload({
          slotId: slot.id,
          email: `spoof${i}@school.ca`,
          items: [{ productId: product.id, qty: 1 }],
        }),
        // A range no other test in this file has touched: the in-memory
        // limiter lives in the server process and survives resetDb().
        { ip: `198.18.${i}.5` },
      );
      statuses.push(r.status);
    }
    // 25 checkouts, 2.5× the per-IP budget, zero 429s.
    expect(statuses.filter((s) => s === 429)).toHaveLength(0);
    expect(statuses.filter((s) => s === 200)).toHaveLength(25);
  });

  /**
   * HANDOFF §21: "Malformed bodies are not rate limited" — both `rateLimit`
   * calls run after validation, so a flood of garbage bodies is never counted.
   * Asserted as current behaviour so the amplification vector is on the record
   * rather than assumed.
   */
  it("does not rate limit malformed bodies at all", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 30; i++) {
      const r = await postCheckout("{not json", { ip: "192.0.2.99" });
      statuses.push(r.status);
    }
    expect(new Set(statuses)).toEqual(new Set([400]));
  });
});

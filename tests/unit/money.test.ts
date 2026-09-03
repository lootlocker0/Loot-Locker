import { describe, it, expect } from "vitest";
import { applyBps, assertCents, formatCents, sumLines } from "@/lib/money";
import { orderNumber, pickupCode } from "@/lib/codes";

describe("money is integer cents", () => {
  it("sums lines without floating point", () => {
    expect(
      sumLines([
        { unitPriceCents: 133, qty: 3 },
        { unitPriceCents: 299, qty: 2 },
      ]),
    ).toBe(997);
  });

  it("rounds basis points to whole cents", () => {
    expect(applyBps(1000, 500)).toBe(50);
    expect(applyBps(0, 500)).toBe(0);
    expect(applyBps(999, 500)).toBe(50); // 49.95 -> 50, not 49.95
    expect(Number.isInteger(applyBps(12345, 1234))).toBe(true);
  });

  it("guards the trust boundary", () => {
    expect(() => assertCents(1.5, "total")).toThrow();
    expect(() => assertCents(-1, "total")).toThrow();
    expect(() => assertCents("500" as unknown, "total")).toThrow();
    expect(() => assertCents(NaN, "total")).toThrow();
    expect(() => assertCents(0, "total")).not.toThrow();
  });

  it("formats CAD without ever parsing a float back", () => {
    expect(formatCents(475).replace(/ /g, " ")).toContain("4.75");
  });
});

describe("human-facing codes", () => {
  it("emits pickup codes from the unambiguous alphabet only", () => {
    for (let i = 0; i < 500; i++) {
      const c = pickupCode();
      expect(c).toHaveLength(4);
      expect(c).toMatch(/^[ACDEFGHJKLMNPQRSTUVWXY3479]{4}$/);
    }
  });

  it("emits LL- order numbers inside the documented space", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const n = orderNumber();
      expect(n).toMatch(/^LL-\d{5}$/);
      seen.add(n);
    }
    // 90,000 values (HANDOFF §21). 2,000 draws collide routinely — this is the
    // birthday problem that item is about, asserted rather than argued.
    expect(seen.size).toBeLessThan(2000);
  });
});

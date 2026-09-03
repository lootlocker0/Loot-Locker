import { describe, it, expect } from "vitest";
import {
  SCHOOL_TZ,
  schoolDayStartInstant,
  schoolParts,
  schoolWallClockToInstant,
  serviceDateFloorForToday,
  slotStartInstant,
} from "@/lib/timezone";

/**
 * The whole point of `lib/timezone.ts` is that none of this depends on the
 * process's `TZ`. This suite runs with `TZ=Pacific/Kiritimati` (UTC+14, and
 * therefore on the *next* calendar day relative to Vancouver for most of the
 * UTC day), which is what makes these assertions worth anything — under
 * `TZ=UTC` a `setHours`-based implementation passes several of them.
 */
describe("school clock", () => {
  it("is pinned to America/Vancouver", () => {
    expect(SCHOOL_TZ).toBe("America/Vancouver");
  });

  it("resolves a summer lunch window to PDT (UTC-7) regardless of process TZ", () => {
    expect(process.env.TZ).not.toBe("UTC"); // the test is only meaningful off UTC
    const at = slotStartInstant(new Date("2026-09-03T00:00:00.000Z"), "11:50");
    expect(at.toISOString()).toBe("2026-09-03T18:50:00.000Z");
  });

  it("resolves a winter lunch window to PST (UTC-8)", () => {
    const at = slotStartInstant(new Date("2026-01-15T00:00:00.000Z"), "11:50");
    expect(at.toISOString()).toBe("2026-01-15T19:50:00.000Z");
  });

  it("reads the service-date key with UTC getters, so it cannot slip a day", () => {
    // 00:00Z on the 3rd is the 2nd in Vancouver. A local-getter implementation
    // would build the window on the 2nd.
    const at = slotStartInstant(new Date("2026-09-03T00:00:00.000Z"), "12:20");
    expect(schoolParts(at)).toMatchObject({ year: 2026, month: 9, day: 3, hour: 12, minute: 20 });
  });

  it("rejects a malformed startTime instead of coercing it", () => {
    for (const bad of ["9:5", "24:00", "12:60", "", "noon", "1220"]) {
      expect(() => slotStartInstant(new Date("2026-09-03T00:00:00.000Z"), bad)).toThrow();
    }
  });

  it("puts the school day boundary at local midnight, not the server's", () => {
    const start = schoolDayStartInstant(new Date("2026-09-03T05:00:00.000Z"));
    // 05:00Z on the 3rd is 22:00 on the 2nd in Vancouver, so the school day
    // that is currently running began at 07:00Z on the 2nd (PDT).
    expect(start.toISOString()).toBe("2026-09-02T07:00:00.000Z");
  });

  it("floors the service date as a UTC date key, not as a real instant", () => {
    const floor = serviceDateFloorForToday(new Date("2026-09-03T05:00:00.000Z"));
    expect(floor.toISOString()).toBe("2026-09-02T00:00:00.000Z");
  });

  it("round-trips a wall clock through the offset correction", () => {
    const instant = schoolWallClockToInstant(2026, 3, 8, 12, 20); // day after DST start
    expect(schoolParts(instant)).toMatchObject({ hour: 12, minute: 20 });
  });
});

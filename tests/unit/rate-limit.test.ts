import { describe, it, expect, beforeEach } from "vitest";
import { AppError } from "@/lib/errors";
import { rateLimit, rateLimitMode, resetInMemoryRateLimit } from "@/lib/rate-limit";

/**
 * The limiter module itself, in `memory` mode. The route-level 429 is proved
 * separately in `tests/ratelimit/` against a server started WITHOUT
 * `RATE_LIMIT_DISABLED=1` — Next refuses to run two dev servers for one
 * project, so that has to be its own vitest invocation.
 */
describe("rate limiter", () => {
  beforeEach(resetInMemoryRateLimit);

  it("runs in memory mode here, not disabled", () => {
    expect(rateLimitMode).toBe("memory");
  });

  it("allows the budget and then throws RATE_LIMITED", async () => {
    for (let i = 0; i < 10; i++) await rateLimit("qa:key", 10, 60);
    await expect(rateLimit("qa:key", 10, 60)).rejects.toBeInstanceOf(AppError);
    await expect(rateLimit("qa:key", 10, 60)).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });

  it("keys are independent", async () => {
    for (let i = 0; i < 10; i++) await rateLimit("qa:a", 10, 60);
    await expect(rateLimit("qa:b", 10, 60)).resolves.toBeUndefined();
  });

  it("counts concurrent calls too", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 25 }, () => rateLimit("qa:burst", 10, 60)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(10);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(15);
  });
});

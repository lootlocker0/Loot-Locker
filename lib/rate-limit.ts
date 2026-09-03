import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { AppError } from "./errors";
import { logEvent } from "./log";

// Card-testing bots find small merchants fast, and this one accepts a card on a
// public unauthenticated route. Rate limiting is not optional.
//
// backend.md §8 calls `Redis.fromEnv()` at module scope, which throws when
// Upstash is not configured — that takes the entire checkout route down in
// local dev and in CI, where there is no Redis and never will be. So the limiter
// picks a mode at startup instead. The rule the modes are built around:
//
//     it must be impossible to end up in production with rate limiting
//     quietly switched off.
//
// Modes, resolved once per process, in this order:
//
//   disabled     RATE_LIMIT_DISABLED=1 and NOT production. Pass-through. This is
//                the switch qa's concurrency suite wants: 50 simultaneous
//                checkouts from one IP are the test, not the abuse. Ignored with
//                a loud log in production, so it cannot ship as an oversight.
//   upstash      UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN present. The
//                real thing, shared across instances. This is what production
//                must run (BUILDPLAN.md P5: "Upstash Redis provisioned; rate
//                limiting confirmed live").
//   memory       No Redis and not production. A real per-process sliding window,
//                not a stub — dev and CI can actually observe a 429, which is
//                the only way the RATE_LIMITED path ever gets tested.
//   fail-closed  Production, no Redis, no explicit opt-in. Every call throws
//                RATE_LIMITED. Checkout stops.
//
// That last mode is the deliberate one. Deploying without Redis and silently
// serving an unlimited card endpoint is the failure that costs money and cannot
// be noticed from the outside; a checkout that returns 429 to everyone is
// noticed in about ninety seconds and fixed by provisioning Upstash. If someone
// genuinely wants production without Redis they say so with
// RATE_LIMIT_ALLOW_INSECURE=1 and get a warning line per request forever.

type Mode = "disabled" | "upstash" | "memory" | "fail-closed";

const IS_PROD = process.env.NODE_ENV === "production";

function resolveMode(): Mode {
  if (process.env.RATE_LIMIT_DISABLED === "1") {
    if (!IS_PROD) return "disabled";
    logEvent("rate_limit_disable_flag_ignored_in_production");
  }
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
    return "upstash";
  if (!IS_PROD) return "memory";
  if (process.env.RATE_LIMIT_ALLOW_INSECURE === "1") return "memory";
  return "fail-closed";
}

export const rateLimitMode: Mode = resolveMode();

logEvent("rate_limit_mode", { mode: rateLimitMode });

// ─────────────────────────────────────────────────────────────────────────────
// Upstash
// ─────────────────────────────────────────────────────────────────────────────

let redis: Redis | null = null;
const limiters = new Map<string, Ratelimit>();

function upstashLimiter(limit: number, windowSec: number): Ratelimit {
  const id = `${limit}:${windowSec}`;
  let existing = limiters.get(id);
  if (!existing) {
    redis ??= Redis.fromEnv();
    existing = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, `${windowSec} s`),
      prefix: "ll",
    });
    limiters.set(id, existing);
  }
  return existing;
}

// ─────────────────────────────────────────────────────────────────────────────
// In-process fallback
// ─────────────────────────────────────────────────────────────────────────────

/// Serverless runs many instances, so this is worth strictly less than the
/// nominal limit — N instances means N × limit. It is a dev and CI convenience
/// and is never the production answer; that is why it is not reachable in
/// production without an explicit flag.
const hits = new Map<string, number[]>();
const MAX_TRACKED_KEYS = 20_000;
const PRUNE_HORIZON_MS = 3_600_000;

function prune(now: number): void {
  for (const [k, times] of hits) {
    if (times.length === 0 || times[times.length - 1] < now - PRUNE_HORIZON_MS) {
      hits.delete(k);
    }
  }
  // Still unbounded after pruning (a flood of distinct keys inside the horizon).
  // Drop oldest-inserted first rather than growing without limit; Map preserves
  // insertion order. Evicting a key resets its counter, which is the permissive
  // direction — acceptable for a fallback that is already advisory.
  if (hits.size > MAX_TRACKED_KEYS) {
    const excess = hits.size - MAX_TRACKED_KEYS;
    let i = 0;
    for (const k of hits.keys()) {
      if (i++ >= excess) break;
      hits.delete(k);
    }
  }
}

function memoryAllow(key: string, limit: number, windowSec: number): boolean {
  const now = Date.now();
  const cutoff = now - windowSec * 1000;
  const times = (hits.get(key) ?? []).filter((t) => t > cutoff);

  if (times.length >= limit) {
    hits.set(key, times);
    return false;
  }
  times.push(now);
  hits.set(key, times);
  if (hits.size > MAX_TRACKED_KEYS) prune(now);
  return true;
}

/// For test setup/teardown only. Clears the in-process window so one test's
/// requests do not exhaust the next test's budget. A no-op in `upstash` mode —
/// tests against a real Redis have to use distinct keys.
export function resetInMemoryRateLimit(): void {
  hits.clear();
}

// ─────────────────────────────────────────────────────────────────────────────

/// Throws `AppError("RATE_LIMITED")` (429) when the caller is over budget.
///
/// `key` may embed an IP or a hashed email and is never logged — CLAUDE.md §2.6,
/// and an IP is PII for a child on a school network.
export async function rateLimit(
  key: string,
  limit: number,
  windowSec: number,
): Promise<void> {
  switch (rateLimitMode) {
    case "disabled":
      return;

    case "fail-closed":
      logEvent("rate_limit_misconfigured", { limit, windowSec });
      throw new AppError("RATE_LIMITED");

    case "upstash": {
      const { success } = await upstashLimiter(limit, windowSec).limit(key);
      if (!success) throw new AppError("RATE_LIMITED");
      return;
    }

    case "memory": {
      if (IS_PROD) {
        // Per call, not once at startup. An operator scanning production logs
        // should trip over this constantly until Upstash is provisioned.
        logEvent("rate_limit_degraded_in_production", { limit, windowSec });
      }
      if (!memoryAllow(key, limit, windowSec)) throw new AppError("RATE_LIMITED");
      return;
    }
  }
}

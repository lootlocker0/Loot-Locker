import { execSync } from "child_process";
import { randomBytes } from "crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type { Allergen, Rarity } from "@prisma/client";
import { E2E_DATABASE_URL } from "./env";
import { schoolParts } from "@/lib/timezone";

/**
 * Real Postgres, its own database. Prisma 7 removed the `datasources`
 * constructor option, so the driver adapter is the only way to point a client
 * at a URL (docs/HANDOFF.md §2).
 */
export const e2eDb: PrismaClient = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: E2E_DATABASE_URL,
    allowExitOnIdle: true,
    idleTimeoutMillis: 1_000,
  }),
});

/**
 * Idempotent. `manual_constraints.sql` is not optional: without it there is no
 * `book_slot()`, no `reserve_stock()` and no `adjust_stock()`, so every
 * checkout and every stock adjustment in this suite would 500 for a reason
 * that has nothing to do with the browser.
 */
export function prepareSchema(): void {
  const env = {
    ...process.env,
    DATABASE_URL: E2E_DATABASE_URL,
    DIRECT_URL: E2E_DATABASE_URL,
  };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  execSync(
    `psql "${E2E_DATABASE_URL}" -v ON_ERROR_STOP=1 -f prisma/migrations/manual_constraints.sql`,
    { env, stdio: "pipe" },
  );
}

/**
 * `settings` is deliberately never written, exactly as in the vitest harness:
 * `lib/settings.ts` caches per process for 60s, so a suite that writes a
 * setting and immediately drives a page is unreliable by construction. An
 * empty table means every route reads the documented defaults — cap 1500,
 * cutoff 45 min, tax 0 bps, TTL 15 min.
 */
export async function truncateAll(): Promise<void> {
  await e2eDb.$executeRawUnsafe(
    `TRUNCATE order_items, orders, webhook_events, products, pickup_slots RESTART IDENTITY CASCADE`,
  );
}

let seq = 0;
export const uniq = () =>
  `${Date.now().toString(36)}${(seq++).toString(36)}${randomBytes(3).toString("hex")}`;

export interface SeedProductOpts {
  name?: string;
  slug?: string;
  description?: string;
  priceCents?: number;
  stockQty?: number;
  active?: boolean;
  allergens?: Allergen[];
  rarity?: Rarity;
  category?: string;
  sortOrder?: number;
}

export async function seedProduct(opts: SeedProductOpts = {}) {
  const id = uniq();
  return e2eDb.product.create({
    data: {
      slug: opts.slug ?? `e2e-${id}`,
      name: opts.name ?? `E2E Product ${id}`,
      description: opts.description ?? "Seeded by the E2E suite.",
      priceCents: opts.priceCents ?? 500,
      category: opts.category ?? "sweet",
      rarity: opts.rarity ?? "COMMON",
      allergens: opts.allergens ?? [],
      stockQty: opts.stockQty ?? 25,
      active: opts.active ?? true,
      imageUrl: `/products/e2e-${id}.svg`,
      sortOrder: opts.sortOrder ?? 0,
    },
  });
}

export interface SeedSlotOpts {
  capacity?: number;
  /** Minutes from now on the SCHOOL's clock (America/Vancouver). Default 180. */
  startsInMinutes?: number;
  serviceDate?: Date;
  startTime?: string;
  active?: boolean;
  label?: string;
  location?: string;
}

/**
 * Builds a pickup window `startsInMinutes` from now **in America/Vancouver**,
 * not in the server's or the browser's timezone (docs/HANDOFF.md §17). Both
 * processes deliberately run on other zones, so a fixture computed from the
 * local `Date` getters would agree with a broken server-local cutoff and
 * disagree with a correct one.
 */
export async function seedSlot(opts: SeedSlotOpts = {}) {
  const startsIn = opts.startsInMinutes ?? 180;
  const target = new Date(Date.now() + startsIn * 60_000);
  const p = schoolParts(target);

  const serviceDate =
    opts.serviceDate ?? new Date(Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0, 0));
  const startTime =
    opts.startTime ??
    `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;

  return e2eDb.pickupSlot.create({
    data: {
      label: opts.label ?? `E2E Window ${uniq()}`,
      startTime,
      location: opts.location ?? `Locker bank ${uniq()}`,
      serviceDate,
      capacity: opts.capacity ?? 20,
      bookedCount: 0,
      active: opts.active ?? true,
    },
  });
}

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { prepareSchema, truncateAll, seedProduct, seedSlot } from "./db";
import { E2E_BASE_URL, E2E_DATABASE_URL } from "./env";

/**
 * Runs once, before the first browser opens, after Playwright's `webServer`
 * has answered its readiness probe.
 *
 * The self-check at the end is the same one the vitest harness runs and for the
 * same reason: if `next dev` picked `DATABASE_URL` out of the repo's `.env`
 * instead of the value Playwright passed it, every spec would drive the DEV
 * database while asserting against the E2E database — and a spec that clicks
 * "Refund" would then be refunding real dev data. Proving the server can see a
 * row that only exists in the E2E database is the cheapest way to rule that out.
 */

/** Fixtures every spec can rely on existing. Slugs are stable; ids are not. */
export const CATALOG = {
  /** Sweet, COMMON, plenty of stock, DAIRY + GLUTEN. The default "add to cart". */
  staple: { slug: "e2e-staple-bar", name: "Staple Bar", priceCents: 250 },
  /** LEGENDARY, PEANUTS + TREE_NUTS. Exercises allergen rendering and filters. */
  nutty: { slug: "e2e-nutty-brick", name: "Nutty Brick", priceCents: 475 },
  /** Zero allergens. The "No listed allergens" branch. */
  clean: { slug: "e2e-spring-water", name: "Spring Water", priceCents: 125 },
  /** stockQty 0 — must render listed and disabled, never hidden (P2 gate). */
  soldOut: { slug: "e2e-sold-out-chips", name: "Sold Out Chips", priceCents: 300 },
} as const;

export default async function globalSetup() {
  prepareSchema();
  await truncateAll();

  await seedProduct({
    slug: CATALOG.staple.slug,
    name: CATALOG.staple.name,
    description: "A dependable bar. Seeded for the E2E suite.",
    priceCents: CATALOG.staple.priceCents,
    stockQty: 200,
    rarity: "COMMON",
    category: "sweet",
    allergens: ["DAIRY", "GLUTEN"],
    sortOrder: 10,
  });

  await seedProduct({
    slug: CATALOG.nutty.slug,
    name: CATALOG.nutty.name,
    description: "Dense, nutty, and loud about it.",
    priceCents: CATALOG.nutty.priceCents,
    stockQty: 60,
    rarity: "LEGENDARY",
    category: "savory",
    allergens: ["PEANUTS", "TREE_NUTS"],
    sortOrder: 20,
  });

  await seedProduct({
    slug: CATALOG.clean.slug,
    name: CATALOG.clean.name,
    description: "Water. Reviewed, contains nothing on the list.",
    priceCents: CATALOG.clean.priceCents,
    stockQty: 100,
    rarity: "UNCOMMON",
    category: "drinks",
    allergens: [],
    sortOrder: 30,
  });

  await seedProduct({
    slug: CATALOG.soldOut.slug,
    name: CATALOG.soldOut.name,
    description: "Listed on purpose while sold out.",
    priceCents: CATALOG.soldOut.priceCents,
    stockQty: 0,
    rarity: "RARE",
    category: "savory",
    allergens: ["GLUTEN"],
    sortOrder: 40,
  });

  // Three windows comfortably past the 45-minute cutoff, so `/checkout`
  // always has something selectable regardless of when the suite runs.
  await seedSlot({ startsInMinutes: 150, capacity: 40, label: "Lunch A" });
  await seedSlot({ startsInMinutes: 180, capacity: 40, label: "Lunch B" });
  await seedSlot({ startsInMinutes: 210, capacity: 40, label: "Lunch C" });

  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: E2E_DATABASE_URL }),
  });
  const sentinel = await db.product.create({
    data: {
      slug: `e2e-sentinel-${Date.now()}`,
      name: "E2E Harness Sentinel",
      description: "Written by tests/e2e/setup/global-setup.ts; deleted immediately.",
      priceCents: 1,
      category: "sweet",
      rarity: "COMMON",
      allergens: [],
      stockQty: 1,
      active: true,
      imageUrl: "/products/none.svg",
      sortOrder: 9999,
    },
  });

  const res = await fetch(`${E2E_BASE_URL}/api/products`);
  const body = (await res.json()) as { products?: { id: string }[] };
  const sawSentinel = body.products?.some((p) => p.id === sentinel.id) ?? false;

  await db.product.delete({ where: { id: sentinel.id } });
  await db.$disconnect();

  if (!sawSentinel) {
    throw new Error(
      "E2E harness self-check failed: the dev server did not return a product that " +
        "only exists in the E2E database. It is talking to a different DATABASE_URL. " +
        "Refusing to run — these specs place orders and issue refunds.",
    );
  }
}

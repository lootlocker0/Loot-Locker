/**
 * LootLockers seed — idempotent by construction.
 *
 *   npx prisma db seed        # or: npx tsx prisma/seed.ts
 *
 * Running it twice must produce zero duplicate rows and zero unique-constraint
 * errors. Every write below is an upsert on a real unique key:
 *
 *   products      → slug
 *   pickup_slots  → (serviceDate, startTime, location)
 *   settings      → key
 *
 * Three deliberate non-overwrites, because a seed re-run must never destroy
 * operational state:
 *
 *   · Product.stockQty is set on create only. Stock belongs to reserve_stock()
 *     and the release path; a seed that resets it can un-sell snacks that have
 *     already been paid for. Pass SEED_RESET_STOCK=1 to opt in for local dev.
 *   · PickupSlot.capacity and bookedCount are set on create only, for the same
 *     reason plus the booked_within_capacity CHECK constraint.
 *   · Setting values are written on create only. Changing the spend cap or the
 *     tax rate is a human decision (CLAUDE.md §7), and a seed run must not
 *     silently revert one.
 *
 * Product naming: most items are generic descriptions of real snacks. A subset
 * (Doritos, Kool-Aid Jammers, Lay's, Cheetos, Ruffles) uses real brand names by
 * the manager's explicit decision, because the catalog is physically stocking
 * those exact products — see docs/DESIGN.md "Third-party IP" §3 for the
 * nominative-use reasoning. None of them carry invented stat/rarity flavor
 * text; descriptions stay factual (name, flavor) per that same decision.
 * CLAUDE.md §2.7 ("no third-party IP") reads as about invented copy wrapped
 * around a trademark, not about naming what's actually on the shelf.
 *
 * Allergen lists are placeholders authored by an agent and MUST be reviewed by
 * whoever is accountable for allergens at the school before launch — see
 * docs/HANDOFF.md §4. This applies equally to the real-branded items above;
 * an agent guessing at a Doritos ingredient list is not a substitute for
 * reading the actual bag.
 */
import "dotenv/config";

import type { Allergen, Rarity } from "@prisma/client";

import { db } from "../lib/db";

const RESET_STOCK = process.env.SEED_RESET_STOCK === "1";

// ─────────────────────────────────────────────────────────────────────────────
// Catalog
// ─────────────────────────────────────────────────────────────────────────────

type SeedProduct = {
  slug: string;
  name: string;
  description: string;
  priceCents: number;
  category: "sweet" | "savory" | "drinks" | "healthy";
  rarity: Rarity;
  allergens: Allergen[];
  stockQty: number;
  active?: boolean;
};

const PRODUCTS: SeedProduct[] = [
  {
    slug: "gummy-bear-pouch",
    name: "Gummy Bear Pouch",
    description: "A fistful of fruit-flavoured gummy bears in a resealable pouch.",
    priceCents: 150,
    category: "sweet",
    rarity: "COMMON",
    allergens: [],
    stockQty: 40,
  },
  {
    slug: "sour-rainbow-belts",
    name: "Sour Rainbow Belts",
    description: "Long sour candy belts, five colours, aggressively tangy.",
    priceCents: 175,
    category: "sweet",
    rarity: "COMMON",
    allergens: ["SULPHITES"],
    stockQty: 35,
  },
  {
    slug: "milk-chocolate-bar",
    name: "Milk Chocolate Bar",
    description: "Standard 45 g milk chocolate bar. Melts in a warm backpack.",
    priceCents: 250,
    category: "sweet",
    rarity: "UNCOMMON",
    allergens: ["DAIRY", "SOY"],
    stockQty: 24,
  },
  {
    slug: "peanut-butter-cups",
    name: "Peanut Butter Cups",
    description: "Two chocolate cups filled with sweetened peanut butter.",
    priceCents: 275,
    category: "sweet",
    rarity: "RARE",
    allergens: ["PEANUTS", "DAIRY", "SOY"],
    stockQty: 18,
  },
  {
    slug: "golden-cookie-crate",
    name: "Golden Cookie Crate",
    description:
      "Six bakery-style chocolate chunk cookies in a share box. One per lunch service.",
    priceCents: 500,
    category: "sweet",
    rarity: "LEGENDARY",
    allergens: ["GLUTEN", "DAIRY", "EGGS", "SOY"],
    stockQty: 6,
  },
  {
    slug: "salted-pretzel-twists",
    name: "Salted Pretzel Twists",
    description: "Crunchy salted pretzel twists, single-serve bag.",
    priceCents: 200,
    category: "savory",
    rarity: "COMMON",
    allergens: ["GLUTEN"],
    stockQty: 30,
  },
  // Real physical stock: individual bags from a Costco Doritos variety
  // multibox (Frito-Lay Classic Mix, 30ct — costco.com/100383609), sold as
  // separate flavors so students pick one. Allergen lists here follow the
  // same rule as every other product in this file: plausible from the
  // published flavor profile, NOT sourced from an actual ingredient label —
  // see the file header and docs/HANDOFF.md §4. These must be checked
  // against real packaging before launch like everything else here.
  {
    slug: "doritos-nacho-cheese",
    name: "Doritos Nacho Cheese",
    description: "Classic nacho cheese tortilla chips.",
    priceCents: 200,
    category: "savory",
    rarity: "COMMON",
    allergens: ["DAIRY"],
    stockQty: 40,
  },
  {
    slug: "doritos-cool-ranch",
    name: "Doritos Cool Ranch",
    description: "Tangy, herby ranch-seasoned tortilla chips.",
    priceCents: 200,
    category: "savory",
    rarity: "COMMON",
    allergens: ["DAIRY"],
    stockQty: 36,
  },
  {
    slug: "doritos-flamin-hot-nacho",
    name: "Doritos Flamin' Hot Nacho",
    description: "Nacho cheese tortilla chips with a hot chili kick.",
    priceCents: 200,
    category: "savory",
    rarity: "UNCOMMON",
    allergens: ["DAIRY"],
    stockQty: 26,
  },
  {
    slug: "doritos-spicy-nacho",
    name: "Doritos Spicy Nacho",
    description: "Nacho cheese tortilla chips with extra spice.",
    priceCents: 200,
    category: "savory",
    rarity: "UNCOMMON",
    allergens: ["DAIRY"],
    stockQty: 24,
  },
  {
    slug: "doritos-spicy-sweet-chili",
    name: "Doritos Spicy Sweet Chili",
    description: "Sweet and spicy chili-seasoned tortilla chips.",
    priceCents: 200,
    category: "savory",
    rarity: "RARE",
    allergens: ["DAIRY", "SOY"],
    stockQty: 18,
  },
  // Chip assortment (non-Doritos), same "just pick real, common snacks" brief.
  {
    slug: "lays-classic",
    name: "Lay's Classic",
    description: "Original potato chips, lightly salted.",
    priceCents: 200,
    category: "savory",
    rarity: "COMMON",
    allergens: [],
    stockQty: 30,
  },
  {
    slug: "cheetos-crunchy",
    name: "Cheetos Crunchy",
    description: "Crunchy cheese-flavoured corn puffs.",
    priceCents: 200,
    category: "savory",
    rarity: "UNCOMMON",
    allergens: ["DAIRY"],
    stockQty: 22,
  },
  {
    slug: "ruffles-original",
    name: "Ruffles Original",
    description: "Ridged potato chips, lightly salted.",
    priceCents: 200,
    category: "savory",
    rarity: "COMMON",
    allergens: [],
    stockQty: 28,
  },
  {
    // Deliberately sold out so the catalog's disabled "Sold out" state has
    // something to render against.
    slug: "loaded-nacho-box",
    name: "Loaded Nacho Box",
    description: "Tortilla chips, warm cheese sauce, jalapeños. Made to order.",
    priceCents: 450,
    category: "savory",
    rarity: "EPIC",
    allergens: ["DAIRY", "GLUTEN"],
    stockQty: 0,
  },
  {
    slug: "sparkling-berry-water",
    name: "Sparkling Berry Water",
    description: "Unsweetened sparkling water with natural mixed berry flavour.",
    priceCents: 200,
    category: "drinks",
    rarity: "COMMON",
    allergens: [],
    stockQty: 48,
  },
  {
    slug: "chocolate-milk-carton",
    name: "Chocolate Milk Carton",
    description: "Cold 250 ml carton of chocolate milk.",
    priceCents: 225,
    category: "drinks",
    rarity: "UNCOMMON",
    allergens: ["DAIRY"],
    stockQty: 26,
  },
  // Real ready-to-drink pouches, one per requested color. Jammers (not the
  // powder packets) — a resealable-straw pouch is what's actually practical
  // to resell at a locker pickup, and Kraft Heinz markets this exact line
  // for school lunches. Allergen lists here are the same file-wide caveat:
  // plausible from the published flavor, not sourced — see file header.
  {
    slug: "kool-aid-jammers-grape",
    name: "Kool-Aid Jammers Grape",
    description: "Grape-flavoured drink pouch, 6 fl oz.",
    priceCents: 175,
    category: "drinks",
    rarity: "COMMON",
    allergens: [],
    stockQty: 32,
  },
  {
    slug: "kool-aid-jammers-cherry",
    name: "Kool-Aid Jammers Cherry",
    description: "Cherry-flavoured drink pouch, 6 fl oz.",
    priceCents: 175,
    category: "drinks",
    rarity: "COMMON",
    allergens: [],
    stockQty: 32,
  },
  {
    slug: "kool-aid-jammers-blue-raspberry",
    name: "Kool-Aid Jammers Blue Raspberry",
    description: "Blue raspberry-flavoured drink pouch, 6 fl oz.",
    priceCents: 175,
    category: "drinks",
    rarity: "UNCOMMON",
    allergens: [],
    stockQty: 28,
  },
  {
    slug: "apple-slices-cup",
    name: "Apple Slices Cup",
    description: "Fresh-cut apple slices, cut the morning of service.",
    priceCents: 175,
    category: "healthy",
    rarity: "COMMON",
    allergens: [],
    stockQty: 30,
  },
  {
    slug: "trail-mix-bag",
    name: "Trail Mix Bag",
    description: "Peanuts, almonds, raisins and chocolate chunks.",
    priceCents: 300,
    category: "healthy",
    rarity: "RARE",
    allergens: ["PEANUTS", "TREE_NUTS", "SOY"],
    stockQty: 14,
  },
  {
    slug: "greek-yogurt-parfait",
    name: "Greek Yogurt Parfait",
    description: "Greek yogurt layered with granola and berry compote.",
    priceCents: 400,
    category: "healthy",
    rarity: "EPIC",
    allergens: ["DAIRY", "GLUTEN"],
    stockQty: 10,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Pickup slots
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Placeholder bell schedule. The real one, and the real per-slot handout
 * throughput, are school sign-off items (CLAUDE.md §7).
 */
const SLOT_TEMPLATE = [
  { label: "Lunch A", startTime: "11:50", location: "Locker bank C", capacity: 24 },
  { label: "Lunch B", startTime: "12:20", location: "Locker bank C", capacity: 24 },
  { label: "Lunch C", startTime: "12:50", location: "Main hall table", capacity: 18 },
];

/** How many days forward to seed, starting today. */
const SLOT_DAYS = 7;

/**
 * Local midnight of today + offset. Local, not UTC: the cutoff check builds the
 * slot's real instant with `new Date(serviceDate).setHours(h, m)`, which is
 * local-time arithmetic. See docs/HANDOFF.md — timezone handling is open.
 */
function serviceDay(offset: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings — defaults mirror lib/settings.ts
// ─────────────────────────────────────────────────────────────────────────────

const SETTINGS: Record<string, string> = {
  daily_spend_cap_cents: "1500",
  order_cutoff_minutes: "45",
  // Placeholder. Tax treatment of snack foods is a human decision (CLAUDE.md §7).
  tax_rate_bps: "0",
  pending_order_ttl_minutes: "15",
};

async function main() {
  // ── Products ──────────────────────────────────────────────────────────────
  for (const [i, p] of PRODUCTS.entries()) {
    const sortOrder = (i + 1) * 10;
    await db.product.upsert({
      where: { slug: p.slug },
      create: {
        slug: p.slug,
        name: p.name,
        description: p.description,
        priceCents: p.priceCents,
        category: p.category,
        rarity: p.rarity,
        allergens: p.allergens,
        stockQty: p.stockQty,
        active: p.active ?? true,
        imageUrl: `/products/${p.slug}.svg`,
        sortOrder,
      },
      update: {
        // Descriptive fields are safe to refresh. stockQty is not — see the
        // file header.
        name: p.name,
        description: p.description,
        priceCents: p.priceCents,
        category: p.category,
        rarity: p.rarity,
        allergens: p.allergens,
        active: p.active ?? true,
        imageUrl: `/products/${p.slug}.svg`,
        sortOrder,
        ...(RESET_STOCK ? { stockQty: p.stockQty } : {}),
      },
    });
  }

  // ── Pickup slots ──────────────────────────────────────────────────────────
  for (let day = 0; day < SLOT_DAYS; day++) {
    const serviceDate = serviceDay(day);

    for (const s of SLOT_TEMPLATE) {
      await db.pickupSlot.upsert({
        where: {
          serviceDate_startTime_location: {
            serviceDate,
            startTime: s.startTime,
            location: s.location,
          },
        },
        create: {
          label: s.label,
          startTime: s.startTime,
          location: s.location,
          serviceDate,
          capacity: s.capacity,
          active: true,
        },
        update: {
          // capacity and bookedCount are intentionally left alone.
          label: s.label,
          active: true,
        },
      });
    }
  }

  // ── Settings ──────────────────────────────────────────────────────────────
  for (const [key, value] of Object.entries(SETTINGS)) {
    await db.setting.upsert({
      where: { key },
      create: { key, value },
      // Never stomp a human's change.
      update: {},
    });
  }

  const [products, slots, settings, soldOut, futureSlots] = await Promise.all([
    db.product.count(),
    db.pickupSlot.count(),
    db.setting.count(),
    db.product.count({ where: { stockQty: 0 } }),
    db.pickupSlot.count({ where: { serviceDate: { gte: serviceDay(0) } } }),
  ]);

  console.log(
    [
      "seed complete",
      `  products      ${products} (${soldOut} sold out)`,
      `  pickup slots  ${slots} (${futureSlots} today or later)`,
      `  settings      ${settings}`,
      `  stock reset   ${RESET_STOCK ? "yes (SEED_RESET_STOCK=1)" : "no"}`,
    ].join("\n"),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });

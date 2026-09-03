import { z } from "zod";
import { Allergen, Rarity } from "@prisma/client";

// Request-boundary validation. Every route parses its input through a schema in
// this file before it touches the database — nothing downstream re-checks.
//
// P2 published productQuerySchema. P3 adds checkoutSchema below.

/// `Product.category` is a plain String column, not a Postgres enum
/// (docs/HANDOFF.md §8). These four values are the whole accepted set and this
/// schema is the only thing enforcing that, so anything not listed here reaches
/// Prisma as an unmatchable string and silently returns an empty catalog. Reject
/// it at the boundary instead.
export const PRODUCT_CATEGORIES = [
  "sweet",
  "savory",
  "drinks",
  "healthy",
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export const productQuerySchema = z.object({
  category: z.enum(PRODUCT_CATEGORIES).optional(),

  rarity: z.enum(Rarity).optional(),

  /// Comma-separated allergen tokens to exclude. Validated against the Allergen
  /// enum rather than passed through as free strings (backend.md §9 casts these
  /// `as any`).
  ///
  /// This is the safety-critical difference: `NOT hasSome ["MILK"]` excludes
  /// nothing, because the enum value is `DAIRY`. A typo, a stale client, or an
  /// allergen name from some other list would then quietly serve dairy to a
  /// student who asked for it to be filtered out — the request appears to have
  /// worked. CLAUDE.md §2.8 says allergen data is never inferred and never
  /// defaulted; an unrecognised token is therefore a 400, never a no-op.
  ///
  /// Tokens are trimmed and de-duplicated. Matching is exact and case-sensitive:
  /// callers build these from the `Allergen` enum, and accepting near-misses is
  /// how a wrong value gets normalised into a right-looking one.
  excludeAllergens: z
    .string()
    .optional()
    .transform((s) =>
      s
        ? s
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : [],
    )
    .pipe(z.array(z.enum(Allergen)))
    .transform((list) => [...new Set(list)]),
});

export type ProductQuery = z.infer<typeof productQuerySchema>;

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/checkout
// ─────────────────────────────────────────────────────────────────────────────

/// Everything a student submits. This is the only trust boundary the checkout
/// route has: past this point every value is either from here or from the
/// database, and nothing downstream re-validates.
///
/// Note what is *not* here: no prices, no totals that matter, no order status,
/// no pickup code. The server derives all of those. `clientTotalCents` is the
/// single exception and it is evidence, not input (see below).
export const checkoutSchema = z.object({
  studentName: z.string().trim().min(2).max(80),

  /// Lower-cased at the boundary so the daily spend cap cannot be sidestepped
  /// by capitalising a letter — the cap aggregates on exact string equality.
  ///
  /// `.trim().toLowerCase().pipe(z.email())` and not backend.md's
  /// `z.string().trim().toLowerCase().email()`: in zod 4 the format check on
  /// `z.email()` runs before any transform in the same chain, so the sketch's
  /// order rejects `"  Student@example.com "` — a value a browser autofill
  /// produces routinely. Piping runs the normalisation first, then validates.
  email: z.string().trim().toLowerCase().pipe(z.email().max(160)),

  /// Deliberately loose. A stricter Canadian-format regex rejects legitimate
  /// numbers (extensions, an international parent) and the phone is only ever
  /// used by a human calling about a bagged order.
  phone: z
    .string()
    .trim()
    .regex(/^\+?[\d\s()-]{10,20}$/, "Enter a valid phone number"),

  homeroom: z.string().trim().max(20).optional(),

  slotId: z.cuid(),

  paymentMethod: z.enum(["CARD", "CASH_AT_PICKUP"]),

  items: z
    .array(
      z.object({
        productId: z.cuid(),
        /// Per-line cap. The daily spend cap is the real limit; this stops a
        /// single fat-fingered line from reserving a product's whole shelf.
        qty: z.number().int().min(1).max(10),
      }),
    )
    .min(1)
    .max(20)
    // Reject duplicate lines rather than silently merging them — a duplicate
    // means the client cart is corrupt and we want to know. The database says
    // the same thing with @@unique([orderId, productId]) on OrderItem.
    .refine(
      (items) => new Set(items.map((i) => i.productId)).size === items.length,
      { message: "Duplicate items in cart" },
    ),

  /// Accepted, logged when it disagrees, then discarded. Never used in any
  /// calculation and never charged (CLAUDE.md §2.2). It exists so a
  /// client/server price disagreement shows up in the logs instead of only in
  /// a confused student.
  clientTotalCents: z.number().int().optional(),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;

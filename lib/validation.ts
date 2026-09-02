import { z } from "zod";
import { Allergen, Rarity } from "@prisma/client";

// Request-boundary validation. Every route parses its input through a schema in
// this file before it touches the database — nothing downstream re-checks.
//
// P2 publishes productQuerySchema only. checkoutSchema (backend.md §1) lands
// with POST /api/checkout in P3; it is deliberately not stubbed here, because a
// half-written schema that something imports is worse than an absent one.

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

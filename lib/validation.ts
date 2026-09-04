import { z } from "zod";
import { Allergen, OrderStatus, Rarity } from "@prisma/client";

// Request-boundary validation. Every route parses its input through a schema in
// this file before it touches the database — nothing downstream re-checks.
//
// P2 published productQuerySchema. P3 added checkoutSchema. P4 adds the staff
// admin schemas at the bottom.

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

// ─────────────────────────────────────────────────────────────────────────────
// P4 — staff admin (app/api/admin/**)
// ─────────────────────────────────────────────────────────────────────────────
//
// Note what is absent from every schema below, deliberately: no amounts, no
// statuses to write, no prices. Staff say *which* order and *what happened*;
// the server decides what that means and what it costs. A refund body carrying
// an amount would be a client-supplied money value, which CLAUDE.md §2.2 does
// not allow from any client, including an authenticated one.

/// `POST /api/admin/login`. A single shared passcode — see lib/admin-session.ts
/// and the placeholder flagged in docs/HANDOFF.md.
export const adminLoginSchema = z.object({
  /// Not trimmed. A passcode may legitimately contain leading or trailing
  /// spaces, and silently editing a credential before comparing it means the
  /// value that works is not the value that was configured.
  passcode: z.string().min(1).max(200),
});

/// `GET /api/admin/orders`. The pick list.
export const adminOrdersQuerySchema = z.object({
  /// The school's calendar day, `YYYY-MM-DD`. Defaults to today in the school's
  /// timezone (lib/timezone.ts). Matched against `PickupSlot.serviceDate`, which
  /// is a date key stored at midnight UTC — not an instant.
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .optional(),

  /// Narrow to one pickup window, for the screen staff have open at the locker.
  slotId: z.cuid().optional(),

  /// Comma-separated `OrderStatus` values. Omitted means the default working
  /// set (see the route). Validated against the enum for the same reason
  /// `excludeAllergens` is: an unmatched status string filters nothing in a
  /// Prisma `in`, so a request that looked filtered would silently list orders
  /// staff asked not to see.
  status: z
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
    .pipe(z.array(z.enum(OrderStatus)))
    .transform((list) => [...new Set(list)]),
});

export type AdminOrdersQuery = z.infer<typeof adminOrdersQuerySchema>;

/// The pickup code as read aloud at the locker. Upper-cased and trimmed because
/// a phone keyboard will capitalise inconsistently and staff retype it in a
/// hurry; the alphabet in lib/codes.ts is upper-case only, so this normalisation
/// cannot turn one valid code into a different valid code.
const pickupCodeInput = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{4}$/, "Pickup codes are four characters");

/// `POST /api/admin/orders/[orderNumber]/pickup`. The handover.
export const adminPickupSchema = z.object({
  /// Required, always. This is the one moment where the person in front of
  /// staff is matched to the bag, and a handover route that accepts "trust me,
  /// it's them" is a route that hands a peanut-allergic student someone else's
  /// order.
  pickupCode: pickupCodeInput,
});

/// `POST /api/admin/orders/[orderNumber]/cash`. Money changing hands.
export const adminCashSchema = z.object({
  /// Optional here, unlike the handover: staff may take the money while the bag
  /// is still on the bench, before the student is standing there. When it *is*
  /// supplied it is checked, so a scanner-driven UI gets the same protection.
  pickupCode: pickupCodeInput.optional(),
});

/// `POST /api/admin/orders/[orderNumber]/refund`.
export const adminRefundSchema = z.object({
  // There is deliberately no `reason` / free-text note field here or on the
  // stock route. There is nowhere safe to put one yet: no audit table exists
  // (docs/HANDOFF.md), and a staff note is exactly where a child's name ends up
  // — "returned by Jamie in 9B" — which then has to be logged or stored, and
  // CLAUDE.md §2.6 says no. Accepting the field and silently discarding it
  // would be worse: staff would believe the note was kept. When an audit log
  // lands with a retention decision behind it, the field lands with it.

  /// Give the pickup window's seat back as well as the money.
  ///
  /// Default `false`, deliberately. `booked_count` is physical handout
  /// throughput, and a refund late in a service does not create the staff-time
  /// to hand out one more bag — over-booking a window that is already packed is
  /// a worse failure than under-reporting a free seat. Staff who know the
  /// window still has room tick this; docs/HANDOFF.md §21 asked P4 for the
  /// control and this is it.
  releaseSlotSeat: z.boolean().optional().default(false),
});

/// `POST /api/admin/products/[productId]/stock`.
export const adminStockAdjustSchema = z.object({
  /// A RELATIVE change, never an absolute quantity. This is not a UI
  /// preference: "set stock to 7" is a read-then-write with a human in the
  /// middle, and a checkout that reserved a unit between the shelf count and
  /// the submit gets silently un-reserved (CLAUDE.md §2.4). A delta composes
  /// with concurrent reservations; an absolute value clobbers them.
  delta: z
    .number()
    .int()
    .refine((n) => n !== 0, { message: "Adjustment cannot be zero" })
    .refine((n) => Math.abs(n) <= 10_000, {
      message: "Adjustment is too large",
    }),
  // No `reason` field. See the note in adminRefundSchema.
});

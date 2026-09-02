# LootLockers — API Contract

**Owner:** backend agent. **Consumers:** frontend, qa.

This file is the only view either of them has of the API surface. Code they
cannot read does not exist; an endpoint that is not documented here must not be
called. If frontend needs something that is not on this page, it appends the
request to `docs/HANDOFF.md` and stops — it does not write the route and it does
not stub it.

**Rule for backend:** an endpoint ships to `main` and to this file in the same
commit. No exceptions, including "temporary" internal routes.

**Status:** P1 (schema + seed) complete. **No HTTP endpoints exist yet.** The
sections below define the conventions every future endpoint follows, plus the
data types and enum values that are already fixed by the database. Later phases
append to §6 without restructuring anything above it.

---

## 1. Conventions

| | |
|---|---|
| Base URL | `NEXT_PUBLIC_SITE_URL` (dev: `http://localhost:3000`) |
| Transport | JSON over HTTPS. `Content-Type: application/json` on every request with a body |
| Runtime | All routes are `runtime = "nodejs"` (Prisma and Stripe signature verification both need it) |
| Money | **Integer cents, always.** Field names end in `Cents`. There are no decimal amounts anywhere in this API |
| Currency | CAD. Not configurable |
| Dates | ISO 8601 strings in responses |
| Auth | Public routes are unauthenticated. `/api/cron/*` requires `Authorization: Bearer $CRON_SECRET`. Admin routes (P4) require an admin session |
| PII | Never in a path, query string, or redirect. Student name, email, phone and homeroom travel in POST bodies only |

### Totals

The server recomputes every total from database prices. A client-supplied
`clientTotalCents` is accepted for reconciliation, logged when it disagrees, and
then discarded. It never affects what is charged. Render the server's figure
before payment.

---

## 2. Error envelope

Every non-2xx response from a documented endpoint has this exact shape:

```json
{
  "error": {
    "code": "SLOT_FULL",
    "message": "That pickup time just filled up.",
    "...": "zero or more code-specific detail fields"
  }
}
```

Branch on `code`, never on `message` — messages are copy and will change.

| `code` | HTTP | Message | Detail fields |
|---|---|---|---|
| `INVALID_INPUT` | 400 | Check the highlighted fields. | `fields`: `{ [fieldName]: string[] }` |
| `PAYMENT_FAILED` | 402 | Payment was declined. | — |
| `PAST_CUTOFF` | 409 | Ordering closed for that pickup time. | — |
| `SLOT_FULL` | 409 | That pickup time just filled up. | — |
| `OUT_OF_STOCK` | 409 | An item just sold out. | `productName`: string |
| `SPEND_CAP_EXCEEDED` | 409 | Daily spending limit reached. | `capCents`, `spentCents` |
| `PRODUCT_UNAVAILABLE` | 409 | An item is no longer available. | — |
| `RATE_LIMITED` | 429 | Too many attempts. Wait a minute. | — |
| `INTERNAL` | 500 | Something broke on our end. | — |

Source of truth: `lib/errors.ts`. Codes are added there first.

`SLOT_FULL` and `OUT_OF_STOCK` are recoverable: refetch slots and the catalog
and let the student retry. The rest are terminal for that attempt.

---

## 3. Shared types

Generated from `prisma/schema.prisma`. Server code imports these from
`@prisma/client`; client components may import the types with
`import type { Rarity, Allergen } from "@prisma/client"`.

### `Rarity`

`COMMON` · `UNCOMMON` · `RARE` · `EPIC` · `LEGENDARY`

Display metadata (label, hex, glow, sort order) lives in `lib/rarity.ts` and
nowhere else. Do not re-declare rarity colours in a component.

### `Allergen`

`PEANUTS` · `TREE_NUTS` · `DAIRY` · `EGGS` · `GLUTEN` · `SOY` · `SESAME` ·
`FISH` · `SHELLFISH` · `MUSTARD` · `SULPHITES`

Safety-critical (CLAUDE.md §2.8). An empty array means "reviewed, none present",
never "unknown". Render every entry, never truncated, never hover-only, never
"+2 more".

> Resolved: `components/ui/rarity.ts` (P0 placeholder) has been deleted.
> `RarityCard` now imports `Allergen`/`Rarity` from `@prisma/client` and
> `rarityMeta` from `@/lib/rarity` directly. See `docs/HANDOFF.md` §5.

### `PaymentMethod`

`CARD` · `CASH_AT_PICKUP`

### `OrderStatus`

| Value | Meaning |
|---|---|
| `PENDING` | Created. Stock and one slot seat are held. Card orders carry `expiresAt` |
| `RESERVED` | Cash order awaiting pickup. Counts against the daily spend cap |
| `PAID` | Stripe webhook confirmed payment. **Only the webhook sets this** |
| `PACKED` | Staff bagged it |
| `PICKED_UP` | Handed over. Terminal |
| `CANCELLED` | Payment failed or staff cancelled. Stock and seat released |
| `EXPIRED` | TTL elapsed before payment. Stock and seat released by the sweep |
| `REFUNDED` | Money returned. Stock is **not** returned automatically |

### `category`

A plain string on `Product`, but only four values are accepted or documented:

`sweet` · `savory` · `drinks` · `healthy`

Anything else is rejected at the request boundary (`INVALID_INPUT`).

---

## 4. Object shapes

These are the field names the API will use. They match the Prisma models.

### Product

```jsonc
{
  "id": "cmtkq00k7000ewf7d8vvzz2no",  // cuid
  "slug": "gummy-bear-pouch",          // stable key, not shown to students
  "name": "Gummy Bear Pouch",
  "description": "A fistful of fruit-flavoured gummy bears in a resealable pouch.",
  "priceCents": 150,
  "category": "sweet",
  "rarity": "COMMON",
  "allergens": ["DAIRY", "SOY"],
  "stockQty": 40,
  "active": true,
  "imageUrl": "/products/gummy-bear-pouch.svg",
  "sortOrder": 10
}
```

### PickupSlot (as returned to students)

```jsonc
{
  "id": "cmtkq00ka000fwf7dsn6icbmt",
  "label": "Lunch B",
  "startTime": "12:20",                       // local wall clock, 24h
  "location": "Locker bank C",
  "serviceDate": "2026-09-02T00:00:00.000Z",
  "remaining": 17,                            // capacity - bookedCount, floored at 0
  "full": false
}
```

`capacity` and `bookedCount` are internal; students see `remaining` and `full`.

### Order / OrderItem

Order lines are **snapshots**. `nameSnapshot`, `unitPriceCents`,
`raritySnapshot` and `allergensSnapshot` are written once at purchase time and
are never refreshed from the product afterwards, so correcting a product's
allergens today does not rewrite what a student was handed last week. Every
display surface — cart line, confirmation, admin pick list — reads the snapshot.

---

## 5. Database setup

The two atomic mutators and every CHECK constraint live in
`prisma/migrations/manual_constraints.sql`, which Prisma cannot express and
therefore does **not** apply. Both steps are required, in this order:

```bash
npx prisma migrate deploy                 # or: migrate dev, in local dev
psql "$DATABASE_URL" -f prisma/migrations/manual_constraints.sql
npx prisma db seed                         # idempotent; safe to re-run
```

The SQL file is idempotent, so the qa harness can re-run it against every fresh
test container.

| Object | Contract |
|---|---|
| `book_slot(text) -> boolean` | Claims one seat. `true` = claimed, `false` = full, inactive, or missing |
| `reserve_stock(text, int) -> boolean` | Reserves N units. `true` = reserved, `false` = insufficient stock, inactive, or missing. A non-positive quantity returns `false` |
| `stock_non_negative` | `products.stock_qty >= 0` |
| `product_price_non_negative` | `products.price_cents >= 0` |
| `booked_count_non_negative` | `pickup_slots.booked_count >= 0` |
| `slot_capacity_non_negative` | `pickup_slots.capacity >= 0` |
| `booked_within_capacity` | `pickup_slots.booked_count <= capacity` |
| `order_amounts_non_negative` | all three order amounts `>= 0` |
| `order_total_consistent` | `total_cents = subtotal_cents + tax_cents` |
| `order_item_qty_positive` | `order_items.qty > 0` |
| `order_item_price_non_negative` | `order_items.unit_price_cents >= 0` |

**For test fixtures:** any helper that inserts an order directly must satisfy
`order_total_consistent`, and any helper that writes `booked_count` must satisfy
`booked_within_capacity`. Both fail the write rather than accepting a torn row.

Stock and slot capacity move **only** through those two functions plus the
release path in `lib/db/release.ts` (CLAUDE.md §2.4). There is no sanctioned
read-then-write anywhere.

---

## 6. Endpoints

*Nothing published yet.* Each endpoint below gets its own subsection here as it
lands, in this format:

> ### `METHOD /api/path`
> One line on what it is for.
> **Request** — query params or body schema, with types and limits.
> **Response 200** — a real example payload.
> **Errors** — the exact `code` values this route can return and what the client
> should do about each.
> **Caching** — the `Cache-Control` header it sets, and why.
> **Notes** — concurrency behaviour, idempotency, rate limits.

Planned, in build order:

| Phase | Endpoint | Purpose |
|---|---|---|
| P2 | `GET /api/products` | Catalog with category, rarity and allergen-exclusion filtering |
| P2 | `GET /api/slots` | Pickup windows with live remaining capacity |
| P3 | `POST /api/checkout` | Validate, reprice, hold stock and a seat, create the order, open a PaymentIntent |
| P3 | `POST /api/webhooks/stripe` | The only writer of `PAID`. Replay-protected |
| P3 | `GET /api/orders/[orderNumber]` | Confirmation page polling |
| P3 | `GET /api/cron/sweep` | Expire unpaid card orders and release what they held |
| P4 | `/api/admin/*` | Pick list, mark packed, mark picked up, record cash, refund, stock adjustment |

---

## 7. Changelog

| Date | Phase | Change |
|---|---|---|
| 2026-09-02 | P1 | Schema, constraints, atomic functions, seed and shared libs landed. Conventions, error codes and shared types published. No endpoints yet |
| 2026-09-02 | P1 | Manager review: real branded catalog items added to `prisma/seed.ts` (Doritos ×5, Kool-Aid Jammers ×3, chip assortment ×3), `components/ui/rarity.ts` P0 placeholder deleted and `RarityCard` swapped onto the canonical `@prisma/client`/`lib/rarity.ts` types (HANDOFF §5, resolved). Independently re-verified: fresh migrate + constraints + double seed, `tsc --noEmit`, full `eslint .` |

# LootLockers — API Contract

**Owner:** backend agent. **Consumers:** frontend, qa.

This file is the only view either of them has of the API surface. Code they
cannot read does not exist; an endpoint that is not documented here must not be
called. If frontend needs something that is not on this page, it appends the
request to `docs/HANDOFF.md` and stops — it does not write the route and it does
not stub it.

**Rule for backend:** an endpoint ships to `main` and to this file in the same
commit. No exceptions, including "temporary" internal routes.

**Status:** P3 step 1 (checkout, Stripe webhook, expiry sweep) complete.
`GET /api/products`, `GET /api/slots`, `POST /api/checkout`,
`POST /api/webhooks/stripe` and `GET /api/cron/sweep` are live and documented in
§6. `GET /api/orders/[orderNumber]` is **not** shipped — the confirmation page
is blocked on it (`docs/HANDOFF.md` §22). Everything else in the §6 table is
still planned and must not be called. The sections below define the conventions every endpoint
follows, plus the data types and enum values fixed by the database. Later phases
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

Each endpoint gets its own subsection here as it lands, in this format:

> ### `METHOD /api/path`
> One line on what it is for.
> **Request** — query params or body schema, with types and limits.
> **Response 200** — a real example payload.
> **Errors** — the exact `code` values this route can return and what the client
> should do about each.
> **Caching** — the `Cache-Control` header it sets, and why.
> **Notes** — concurrency behaviour, idempotency, rate limits.

### `GET /api/products`

The catalog. Active, in-stock products with optional category, rarity and
allergen-exclusion filtering.

**Request** — query string only. No body, no auth.

| Param | Type | Required | Notes |
|---|---|---|---|
| `category` | `sweet` \| `savory` \| `drinks` \| `healthy` | no | Exact match. Any other value is `INVALID_INPUT`, not an empty result |
| `rarity` | `COMMON` \| `UNCOMMON` \| `RARE` \| `EPIC` \| `LEGENDARY` | no | Exact match |
| `excludeAllergens` | comma-separated `Allergen` values | no | Drops any product carrying **at least one** of them. Tokens are trimmed and de-duplicated; surrounding spaces and empty segments are tolerated |

`excludeAllergens` values are **case-sensitive and validated against the
`Allergen` enum** (§3). `?excludeAllergens=dairy` and `?excludeAllergens=MILK`
are both `400 INVALID_INPUT` — they are not silently ignored. This is
deliberate: an unrecognised token in a `NOT hasSome` filter excludes nothing, so
a request that looks like it filtered dairy would serve dairy. Build these
values from the enum, never from user free text or display copy. Unknown query
params (`utm_*`, etc.) are ignored.

Filters combine with AND. `?category=drinks&rarity=COMMON` returns common
drinks.

**Response 200** — real output from `GET /api/products?category=healthy`:

```json
{
  "products": [
    {
      "id": "cmtkqayy1000k5p7dqcdtzx0i",
      "slug": "apple-slices-cup",
      "name": "Apple Slices Cup",
      "description": "Fresh-cut apple slices, cut the morning of service.",
      "priceCents": 175,
      "category": "healthy",
      "rarity": "COMMON",
      "allergens": [],
      "stockQty": 30,
      "active": true,
      "imageUrl": "/products/apple-slices-cup.svg",
      "sortOrder": 210
    },
    {
      "id": "cmtkqayy4000l5p7dej65rfg0",
      "slug": "trail-mix-bag",
      "name": "Trail Mix Bag",
      "description": "Peanuts, almonds, raisins and chocolate chunks.",
      "priceCents": 300,
      "category": "healthy",
      "rarity": "RARE",
      "allergens": ["PEANUTS", "TREE_NUTS", "SOY"],
      "stockQty": 14,
      "active": true,
      "imageUrl": "/products/trail-mix-bag.svg",
      "sortOrder": 220
    },
    {
      "id": "cmtkqayy6000m5p7donlxspaz",
      "slug": "greek-yogurt-parfait",
      "name": "Greek Yogurt Parfait",
      "description": "Greek yogurt layered with granola and berry compote.",
      "priceCents": 400,
      "category": "healthy",
      "rarity": "EPIC",
      "allergens": ["DAIRY", "GLUTEN"],
      "stockQty": 10,
      "active": true,
      "imageUrl": "/products/greek-yogurt-parfait.svg",
      "sortOrder": 230
    }
  ]
}
```

Always `{ "products": [...] }`, possibly empty. Fields are exactly the Product
shape in §4 — `createdAt`/`updatedAt` are internal and not returned. Ordered by
`sortOrder` ascending, then `name` ascending.

`allergens: []` means **reviewed, none present**. It never means unknown. Render
every entry; never truncate, never hide behind a hover (CLAUDE.md §2.8).

**Errors**

| `code` | HTTP | Cause | Client action |
|---|---|---|---|
| `INVALID_INPUT` | 400 | Unknown `category`, `rarity` or allergen token. `fields` names the offending param | Fix the filter. Do not retry unchanged, and do not fall back to an unfiltered catalog — that shows a student the items they filtered out |
| `INTERNAL` | 500 | Database unreachable | Retry once, then show the failure. Never render a partial catalog as if it were complete |

**Caching** — `Cache-Control: no-store`, and the route is `force-dynamic`.
`stockQty` and `active` change during a lunch service; a cached body advertises
stock that is already gone. That failure is recoverable (`OUT_OF_STOCK` at
checkout) but there is no edge-cache win worth it at one school's volume.

**Notes**

- **Sold-out items are not in this response.** The filter is `active = true AND
  stockQty > 0`. There is no opt-out param. The catalog page renders sold-out
  cards disabled rather than hidden by reading the database directly in its
  Server Component (`active` only, no stock filter) — the two read paths apply
  different where-clauses on purpose. If a *client-side* surface needs sold-out
  items, request the param in `HANDOFF.md`; do not infer them from a stock count
  of zero, because zero-stock products are simply absent here.
- Stock counts are a snapshot of the instant the query ran. Nothing is reserved
  by reading this endpoint; `stockQty: 3` is not a promise of three. Only the
  checkout transaction holds stock (P3).
- Not rate limited. It is a public read with no side effects.

---

### `GET /api/slots`

Bookable pickup windows from today forward, with live remaining capacity.

**Request** — no params, no body, no auth.

**Response 200** — real output, truncated to the first three of 21:

```json
{
  "slots": [
    {
      "id": "cmtkqayy9000n5p7dr9r6f8nd",
      "label": "Lunch A",
      "startTime": "11:50",
      "location": "Locker bank C",
      "serviceDate": "2026-09-02T00:00:00.000Z",
      "remaining": 21,
      "full": false
    },
    {
      "id": "cmtkqayyc000o5p7d35etrkwu",
      "label": "Lunch B",
      "startTime": "12:20",
      "location": "Locker bank C",
      "serviceDate": "2026-09-02T00:00:00.000Z",
      "remaining": 24,
      "full": false
    },
    {
      "id": "cmtkqayyd000p5p7dqaz9xn8q",
      "label": "Lunch C",
      "startTime": "12:50",
      "location": "Main hall table",
      "serviceDate": "2026-09-02T00:00:00.000Z",
      "remaining": 0,
      "full": true
    }
  ]
}
```

Ordered by `serviceDate` ascending, then `startTime` ascending. Inactive slots
and slots whose service date has passed are omitted entirely.

`capacity` and `bookedCount` are **not** in the payload and will not be added.
The client gets `remaining` (`capacity - bookedCount`, floored at 0) and `full`.
Anything that needs to know whether a seat is available asks for the seat —
`book_slot()` inside the checkout transaction — rather than comparing two
numbers it read earlier (CLAUDE.md §2.4).

`startTime` is a local wall clock (`"HH:MM"`, 24h), not a timestamp. Render it
as-is. `serviceDate` is midnight of the service day; show the date from it, and
do not derive a pickup instant by combining the two on the client.

**Errors**

| `code` | HTTP | Cause | Client action |
|---|---|---|---|
| `INTERNAL` | 500 | Database unreachable | Retry once. Never let checkout proceed with a slot list you could not load |

An empty `slots` array is a valid 200 and means no upcoming windows are open —
say so in the UI rather than showing an empty picker.

**Caching** — `Cache-Control: no-store`, and the route is `force-dynamic`.
Deliberate, and not a performance trade-off: a cached slot list sends a student
into a window that filled thirty seconds ago and turns into a `SLOT_FULL` 409
mid-checkout, at lunch, with a queue behind them. Refetch this list on mount,
and again after any `SLOT_FULL` response.

**Notes**

- `remaining` is a read of a value that concurrent checkouts are moving. It is
  advisory. Two students can both see `remaining: 1` and one of them will get
  `SLOT_FULL` — that is the design, and the client must handle it rather than
  trying to prevent it by polling.
- `full: true` slots are still returned, so the picker can show them disabled
  rather than silently dropping a window the student was looking for. Disable
  them; do not filter them out.
- "Today forward" is computed from server-local midnight, which on Vercel is
  UTC. See `docs/HANDOFF.md` §3 — the timezone fix (`America/Vancouver`) lands
  in P3 with the cutoff check.
- Not rate limited.

---

### `POST /api/checkout`

Turns a cart into an order. Validates, reprices from the database, checks the
daily cap and the ordering cutoff, atomically claims a seat in the pickup window
and the stock for every line, creates the order, and — for card orders — opens a
Stripe PaymentIntent.

**Request** — JSON body. No auth.

| Field | Type | Required | Notes |
|---|---|---|---|
| `studentName` | string | yes | Trimmed. 2–80 chars |
| `email` | string | yes | Trimmed and **lower-cased server-side** before anything uses it. Max 160. Must be a valid address |
| `phone` | string | yes | Trimmed. `^\+?[\d\s()-]{10,20}$` — digits, spaces, brackets, dashes, optional leading `+` |
| `homeroom` | string | no | Trimmed. Max 20 |
| `slotId` | cuid | yes | From `GET /api/slots` |
| `paymentMethod` | `CARD` \| `CASH_AT_PICKUP` | yes | Both are live |
| `items` | array | yes | 1–20 lines |
| `items[].productId` | cuid | yes | From `GET /api/products` |
| `items[].qty` | int | yes | 1–10 per line |
| `clientTotalCents` | int | no | Reconciliation only. See below |

```jsonc
{
  "studentName": "Cash Tester",
  "email": "cash.tester@example.com",
  "phone": "(604) 555-0134",
  "homeroom": "9B",
  "slotId": "cmtkqayye000q5p7dxg1ygklo",
  "paymentMethod": "CASH_AT_PICKUP",
  "items": [
    { "productId": "cmtkqayvk00005p7dl2izvtyt", "qty": 2 },
    { "productId": "cmtkqayy1000k5p7dqcdtzx0i", "qty": 1 }
  ],
  "clientTotalCents": 475
}
```

**Two cart lines for the same `productId` are a 400**, not a merge. A duplicate
means the client cart is corrupt and we would rather hear about it than quietly
guess the intent. De-duplicate in the cart store, not here.

`clientTotalCents` is **evidence, not input**. The server reprices every line
from the database, applies `tax_rate_bps`, and charges its own figure. If the
two disagree the server logs `total_mismatch` and proceeds at the server price —
it does not fail the order, because a staff reprice while a cart was open is a
legitimate race. Render the `totalCents` from the response, not your own, before
sending anyone to a payment form.

**Response 200 — cash**

```json
{
  "orderNumber": "LL-38759",
  "pickupCode": "7GKA",
  "totalCents": 475,
  "requiresPayment": false
}
```

The order is `RESERVED` immediately. There is nothing else to do; show the
pickup code.

**Response 200 — card**

```json
{
  "orderNumber": "LL-56477",
  "totalCents": 400,
  "requiresPayment": true,
  "clientSecret": "pi_3SxK2mABCD1234_secret_9f4b5ed415c4f630f65bacf5"
}
```

Branch on `requiresPayment`, never on the presence of a field.

**There is no `pickupCode` in the card response, and that is deliberate.** A
card order is `PENDING` until Stripe confirms payment. Handing over the locker
code first would let a student present a code for an order that then expired
unpaid. The code becomes available on the confirmation page once the order is
`PAID`.

Confirm the `clientSecret` with Stripe Elements. **A client-side
`status === "succeeded"` never means the order is paid** — only the webhook
writes `PAID` (CLAUDE.md §2.3). After a successful confirmation, poll the order
until its status flips.

**Errors**

| `code` | HTTP | Cause | Client action |
|---|---|---|---|
| `INVALID_INPUT` | 400 | Any field failed validation, a duplicate cart line, or a body that is not JSON. `fields` maps field name → messages (`_body` for an unparseable body) | Highlight the fields. Do not retry unchanged |
| `RATE_LIMITED` | 429 | More than 10 attempts/min from one IP, or 5/min for one email | Wait, then allow one retry. Do not auto-retry in a loop |
| `PRODUCT_UNAVAILABLE` | 409 | A `productId` does not exist or the product was deactivated | Refetch the catalog and rebuild the cart |
| `SPEND_CAP_EXCEEDED` | 409 | This order would push the address past the daily cap. `capCents`, `spentCents` | Terminal for today. Show both numbers |
| `SLOT_FULL` | 409 | The window filled, was deactivated, or does not exist | Refetch `GET /api/slots` and pick again. **Recoverable** |
| `PAST_CUTOFF` | 409 | Now is later than `slotStart - order_cutoff_minutes` | Refetch slots; that window is closed. Another may not be |
| `OUT_OF_STOCK` | 409 | A line could not be reserved. `productName` names it | Refetch the catalog, drop or reduce that line. **Recoverable** |
| `INTERNAL` | 500 | Database or payment provider failure | Retry **once**. Nothing was charged |

A missing, deactivated, or non-existent slot all return `SLOT_FULL` rather than
a 404. The student's next move is identical in every case, and not
distinguishing them means id-probing tells a scraper nothing.

**Caching** — `Cache-Control: no-store`, route is `force-dynamic`.

**Notes**

- **Nothing partial is ever left behind.** The seat and every line's stock are
  claimed inside one transaction. If line three is sold out, the seat and lines
  one and two are rolled back with it — verified: a two-line cart whose second
  line was sold out left `booked_count` and the first product's `stock_qty`
  byte-identical.
- **Stock is held before payment, not after.** A card order holds its stock and
  its seat for `pending_order_ttl_minutes` (default 15) and the sweep gives them
  back if payment never lands. This is a deliberate trade: an abandoned cart
  briefly hiding a snack is cheaper than charging a student for a snack that is
  not on the shelf.
- **`SLOT_FULL` and `OUT_OF_STOCK` are normal, not exceptional.** Under load
  they are the *expected* answer for everyone but the winner. Verified: 20
  simultaneous checkouts against a capacity-1 window produced exactly one 200
  and nineteen 409s, `booked_count = 1`, and stock down by exactly one unit.
  Design the UI around them; do not try to prevent them by polling capacity.
- **The cutoff is the school's clock, not the server's.** `America/Vancouver`,
  pinned in `lib/timezone.ts`. Do not compute a cutoff on the client by
  combining `serviceDate` and `startTime` — you will get a different answer than
  the server in every timezone but one.
- **No confirmation email is sent.** Delivery is not built (`lib/email.ts`, and
  `docs/HANDOFF.md`). Do not tell a student to check their inbox. The
  confirmation screen is the receipt.
- Rate limits are per IP (10/min) and per hashed email (5/min).

---

### `POST /api/webhooks/stripe`

Stripe's callback. **The only writer of `PAID`** (CLAUDE.md §2.3). Not for
client use — it is documented here because qa drives it and because frontend
must understand that this, and not Stripe.js, is what confirms an order.

**Request** — the raw Stripe event body, with a `stripe-signature` header.
Verified against `STRIPE_WEBHOOK_SECRET`. The body is read with `req.text()`
and never re-serialised; anything that mutates the bytes breaks the signature.

Handled event types:

| Event | Effect |
|---|---|
| `payment_intent.succeeded` | `PENDING` → `PAID`, sets `paidAt`, clears `expiresAt` |
| `payment_intent.payment_failed` | `PENDING` → `CANCELLED`, releases the stock and the seat |
| `payment_intent.canceled` | Same as above |
| `charge.refunded` | `PAID`/`PACKED` → `REFUNDED`. **Does not** return stock or the slot seat |

Anything else is logged as `webhook_unhandled` and 200s.

**Responses**

| Status | Body | Meaning |
|---|---|---|
| 200 | `ok` | Processed, or intentionally a no-op |
| 200 | `already processed` | Replay. The event id was already recorded |
| 400 | `missing signature` | No `stripe-signature` header |
| 400 | `bad signature` | Signature did not verify. Nothing was recorded |
| 500 | `webhook not configured` | `STRIPE_WEBHOOK_SECRET` unset. Refuses rather than skipping verification |
| 500 | `handler failed` | The dedupe row was deleted so Stripe's retry can reprocess |

**Notes**

- **Replay defence is the primary-key insert on `webhook_events`**, not a
  check-then-insert. Verified: three simultaneous deliveries of one event id
  produced one `ok` and two `already processed`, and three simultaneous
  deliveries with *different* ids for the same intent produced exactly one
  `order_paid`.
- **A payment whose amount disagrees with the order is refused**, logged as
  `webhook_amount_mismatch`, and the order is frozen out of the sweep
  (`expiresAt` cleared) but left `PENDING` for a human. It never becomes `PAID`.
- A refund does **not** restock and does **not** free the pickup seat. Staff
  adjusts inventory by hand (P4).
- Signature verification is local HMAC. Tests can drive this route with
  `stripe.webhooks.generateTestHeaderString({ payload, secret })` and no Stripe
  account — see `docs/HANDOFF.md`.

---

### `GET /api/cron/sweep`

Expires unpaid card orders and gives back what they were holding. Called by
Vercel Cron every 5 minutes (`vercel.json`), not by any client.

**Request** — `Authorization: Bearer $CRON_SECRET`. Compared in constant time.
No secret configured means nobody is authorised.

**Response 200**

```json
{ "scanned": 1, "released": 1, "failed": 0 }
```

`scanned` is how many stale orders were found (max 100 per run), `released` how
many this run actually moved to `EXPIRED` — a lower number is normal and means
another process got there first. `failed` is per-order errors; one bad order
does not abort the run.

**Errors** — `401 unauthorized` (plain text, no error envelope: this route has
no client to branch on codes).

**Notes**

- Selects `status = PENDING AND paymentMethod = CARD AND expiresAt < now()`.
  Cash orders are never swept — they are `RESERVED` from creation and nothing
  expires them.
- Cancels at Stripe **before** releasing. If payment lands a millisecond later,
  the succeeded webhook finds a non-`PENDING` order and no-ops, so the money is
  never taken for stock that has already been given back.
- Idempotent. Verified: a second run immediately after returns
  `{"scanned":0,"released":0,"failed":0}` and stock is unchanged.
- Worst case an abandoned cart holds stock for `pending_order_ttl_minutes` + 5.

---

Planned, in build order (shipped rows marked):

| Phase | Endpoint | Purpose | Status |
|---|---|---|---|
| P2 | `GET /api/products` | Catalog with category, rarity and allergen-exclusion filtering | **Shipped** — §6 above |
| P2 | `GET /api/slots` | Pickup windows with live remaining capacity | **Shipped** — §6 above |
| P3 | `POST /api/checkout` | Validate, reprice, hold stock and a seat, create the order, open a PaymentIntent | **Shipped** — §6 above |
| P3 | `POST /api/webhooks/stripe` | The only writer of `PAID`. Replay-protected | **Shipped** — §6 above |
| P3 | `GET /api/orders/[orderNumber]` | Confirmation page polling | Planned — **not shipped, and `/order/[orderNumber]` cannot be built without it.** See `docs/HANDOFF.md` §22 |
| P3 | `GET /api/cron/sweep` | Expire unpaid card orders and release what they held | **Shipped** — §6 above |
| P4 | `/api/admin/*` | Pick list, mark packed, mark picked up, record cash, refund, stock adjustment | Planned |

---

## 7. Changelog

| Date | Phase | Change |
|---|---|---|
| 2026-09-02 | P1 | Schema, constraints, atomic functions, seed and shared libs landed. Conventions, error codes and shared types published. No endpoints yet |
| 2026-09-02 | P1 | Manager review: real branded catalog items added to `prisma/seed.ts` (Doritos ×5, Kool-Aid Jammers ×3, chip assortment ×3), `components/ui/rarity.ts` P0 placeholder deleted and `RarityCard` swapped onto the canonical `@prisma/client`/`lib/rarity.ts` types (HANDOFF §5, resolved). Independently re-verified: fresh migrate + constraints + double seed, `tsc --noEmit`, full `eslint .` |
| 2026-09-03 | P3 | `POST /api/checkout`, `POST /api/webhooks/stripe` and `GET /api/cron/sweep` shipped and documented in §6, plus `lib/codes.ts`, `lib/rate-limit.ts`, `lib/timezone.ts`, `lib/stripe/{client,payments}.ts`, `lib/db/release.ts`, `lib/email.ts`, `checkoutSchema` in `lib/validation.ts`, and `vercel.json`. **Card and cash are both live** (manager decision, resolving BUILDPLAN.md's open item). The timezone bug from HANDOFF §3/§13 is fixed at both call sites: `lib/timezone.ts` pins `America/Vancouver`, the cutoff derives the slot's real instant from it, and `GET /api/slots` now floors "today" on the school's calendar day — at 00:25 UTC the old code returned 18 slots and dropped the school's current afternoon; it returns 21. Deviations from backend.md, all hardenings, are listed in `HANDOFF.md` §18. Verified against the seeded dev database: cash order lands `RESERVED` with stock and `booked_count` decremented, partial-failure rollback leaves nothing behind, 20-way slot and stock races produce exactly one winner, signed webhook flips the order to `PAID`, replay and concurrent triple replay are no-ops, a tampered `amount_received` is refused, a decline releases stock and seat, and the sweep expires and restocks an aged order and is a no-op on the second run |
| 2026-09-02 | P2 | `GET /api/products` and `GET /api/slots` shipped and documented in §6. `lib/validation.ts` added with `productQuerySchema` (`checkoutSchema` follows in P3, deliberately not stubbed). Two hardenings over the spec sketch, both noted in `HANDOFF.md` §P2: `excludeAllergens` tokens are validated against the `Allergen` enum instead of passed through as free strings, and a bad query param returns `INVALID_INPUT` instead of an unhandled `ZodError`. Verified against the seeded dev database with curl in both `next dev` and `next build && next start` — allergen exclusion confirmed to drop a product on ANY match (`PEANUTS` removes Trail Mix Bag, whose list is `PEANUTS`/`TREE_NUTS`/`SOY`), `remaining`/`full` confirmed against `book_slot()`-modified counts, `Cache-Control: no-store` confirmed on both, both routes confirmed `ƒ` (dynamic) in the production build |

# LootLockers — Handoff

Append-only. Any agent writes here; the manager resolves. Newest phase at the
bottom. Do not delete an entry — strike it through and add the resolution.

Format: **[phase] [owner needed] title** → what, why it matters, what to do.

---

## P1 — backend (schema and seed) · 2026-09-02

### ~~1. [manager] Prisma tooling was broken on arrival — CLI downgraded 8.0.0-rc → 7.10.0~~ RESOLVED

`package.json` pinned `prisma@^8.0.0-rc.12` against `@prisma/client@^7.10.0`.
Prisma 8's CLI is the new Developer Platform tool: it has no `migrate`,
`generate` or `db seed` commands at all (`prisma --help` lists `deploy`,
`contract`, `migration plan`, …). Every command in BUILDPLAN.md §P1 and in the
qa harness (`npx prisma migrate deploy`) is Prisma ≤7 syntax and simply does not
exist there.

**Done:** pinned `prisma` to `7.10.0`, exactly matching the installed client.

**Resolution (manager):** staying on Prisma 7. It's the current stable release
(8 was an RC when this was written) and every doc — CLAUDE.md, BUILDPLAN.md,
qa.md — already assumes v7's `migrate`/`generate`/`db seed` workflow. There
was never a deliberate decision to be on the 8 platform; the RC pin was just
whatever `npm install` resolved to before this schema existed. No rewrite
needed. Re-evaluate this once Prisma 8 is stable and actually adds something
this project needs, not before.

### 2. [qa, frontend] Prisma 7 deltas from the code in CLAUDE.md §4 and qa.md §1

Prisma 7 removed `url`/`directUrl` from `schema.prisma` and removed the
`datasources` constructor option. A direct database connection now requires a
driver adapter. Consequences already handled:

- `prisma.config.ts` (new file, repo root) holds the migration connection string
  and the seed command. Prisma 7 ignores the `prisma` key in `package.json`, so
  the `"prisma": { "seed": ... }` block there is now dead config — harmless, but
  it is not what runs the seed.
- Prisma 7 does not auto-load `.env` once a config file exists. `prisma.config.ts`
  and `prisma/seed.ts` both `import "dotenv/config"`. `dotenv` was added as an
  explicit devDependency rather than relied on transitively.
- `lib/db.ts` differs from CLAUDE.md §4: it constructs
  `new PrismaClient({ adapter: new PrismaPg({ connectionString }), log })`.
  The export, the dev-only global, and the log levels are unchanged. `@prisma/adapter-pg`
  and `pg` were added as dependencies.

**qa, this affects your harness directly:** `new PrismaClient({ datasources: { db: { url } } })`
in qa.md §1 will not compile on v7. Use the adapter instead:

```ts
import { PrismaPg } from "@prisma/adapter-pg";
testDb = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
```

`npx prisma migrate deploy` still works, but it reads its URL from
`prisma.config.ts`, which reads `process.env.DIRECT_URL ?? process.env.DATABASE_URL`
— so set `DIRECT_URL` (or `DATABASE_URL`) in the env you pass to `execSync`, as
you already do.

### ~~3. [human, escalation] Slot cutoff arithmetic has no timezone — this can close ordering on the wrong day~~ RESOLVED (zone confirmed, fix still due in P3)

`PickupSlot.serviceDate` is stored as local midnight of the service day and
`startTime` as a `"HH:MM"` wall clock. The cutoff check in backend.md §3 does:

```ts
const slotAt = new Date(slot.serviceDate);
slotAt.setHours(h, m, 0, 0);
```

`setHours` is **server-local**. Vercel runs UTC; the school is not in UTC. In
`America/Vancouver` the stored instant comes back as 16:00 the previous day
local, and `setHours(12, 20)` then lands on the wrong calendar day — ordering
either closes early or stays open past the bell.

This is not fixable in the schema alone. Before P3 ships:

- ~~confirm the school's IANA timezone (`America/Vancouver`? `America/Toronto`?)~~
  — **confirmed by the manager: `America/Vancouver`.**
- pin it as a constant (e.g. `lib/timezone.ts` exporting `SCHOOL_TZ = "America/Vancouver"`)
  and compute `slotAt` in that zone explicitly (e.g. via `Intl.DateTimeFormat`'s
  offset for the zone, or a small library) rather than relying on `TZ` or
  server-local `setHours` — still P3 backend's job, not done yet.
- have qa's cutoff test run under a non-UTC `TZ` — a UTC-only test passes against
  this bug.

Related human sign-off already on the P5 list: the real bell schedule.

### 4. [human, blocking publication] Seeded allergen data is agent-authored placeholder

CLAUDE.md §2.8: allergen data is never inferred and missing data blocks
publication. Every allergen list in `prisma/seed.ts` was written by an agent
from the product name. It is plausible, not sourced. Before any real student
orders anything, someone accountable at the school reviews the list against
actual packaging, and any product whose allergens have not been reviewed is set
`active = false` rather than shipped with an empty array.

The empty array is semantically "reviewed, none present". There is no "unknown"
value on purpose — the schema forces the question to be answered.

### ~~5. [frontend] Allergen enum drift with the P0 placeholder~~ RESOLVED

`components/ui/rarity.ts` (P0, explicitly temporary) guesses the allergen union
as `PEANUT`, `TREE_NUT`, `EGG`, singular. The canonical enum is plural:
`PEANUTS`, `TREE_NUTS`, `EGGS`. The other members match.

When frontend swaps `components/ui/rarity.ts` for `@/lib/rarity` and
`import type { Allergen } from "@prisma/client"`, those three values change.
`lib/rarity.ts` itself is a byte-for-byte match of the placeholder's `RARITY`
object, so the rarity half of the swap is a no-op as intended.

**Resolution (manager):** did the swap — `components/ui/rarity.ts` deleted,
`RarityCard.tsx` now imports `Rarity`/`Allergen` from `@prisma/client` and
`rarityMeta` from `@/lib/rarity`. `tsc --noEmit` and a full `eslint .` are
clean after the change. No other file referenced the placeholder.

### 6. [frontend/manager] Product images do not exist

Seeded `imageUrl` values are `/products/<slug>.svg` and `public/products/` is
empty. `next/image` will 404 on every catalog card in P2. Either drop real
assets in `public/products/`, or frontend renders a rarity-coloured placeholder
when the image fails. Backend does not own `public/`, so this is not something
P1 could fix.

### 7. [qa] Where to attack what P1 landed

Per the backend definition of done, the concurrency surfaces and their known
weak points:

- **`book_slot()` / `reserve_stock()`** — both do check and write in one
  `UPDATE … WHERE`, so they are safe individually. Verified locally: 30
  simultaneous connections against a capacity-1 slot produced exactly 1 `true`
  and `booked_count = 1`; same shape for a stock-1 product. **But** they are only
  atomic *individually*. A multi-line cart is atomic only because the checkout
  route wraps them in one `db.$transaction`. Attack the case where the
  transaction is not held: a partial failure must leave `booked_count` and every
  `stock_qty` untouched.
- **Deadlocks.** The functions take row locks in whatever order the caller asks
  for. The checkout route sorts lines by `productId` before reserving, which is
  the only thing preventing an ABBA deadlock between two carts holding the same
  two products in opposite order. If that sort is ever removed, this deadlocks
  under load and surfaces as a 500, not a clean 409. qa.md already has this test
  — keep it.
- **`booked_within_capacity` vs. P4 admin.** Lowering a slot's capacity below
  its current `booked_count` will be rejected by the constraint. That is the
  correct failure (it prevents pretending the seats do not exist) but the admin
  route must catch it and show something better than a 500.
- **`reserve_stock` checks `active = true`.** Deactivating a product while a
  student is mid-checkout produces `OUT_OF_STOCK`, not `PRODUCT_UNAVAILABLE`.
  Cosmetically wrong code for that race; noted rather than fixed, because the
  alternative is a second round-trip inside the transaction.
- **Restock on release is unbounded.** `release.ts` adds the quantity back with
  no ceiling. If staff has already adjusted stock manually for the same order,
  the release double-counts. Nothing in the DB prevents it.
- **`order_total_consistent` and `booked_within_capacity` will fail your
  fixtures** if a helper inserts an order with only `totalCents` set, or writes
  `booked_count` past `capacity`. That is intentional; set all three amounts.

### 8. [manager] Judgement calls made in the schema, flagged rather than buried

- **`Product.category` is `String`, not a Postgres enum.** The four accepted
  values (`sweet`, `savory`, `drinks`, `healthy`) are enforced at the request
  boundary by `productQuerySchema`, not by the database. Reason: both the catalog
  Server Component in frontend.md §4 and the products route in backend.md §9
  pass a plain string straight into a Prisma `where`, which does not typecheck
  against an enum. A DB-level CHECK was considered and rejected because it would
  turn an unexpected category in a test fixture into an opaque constraint error.
  Allergens and rarity, which are the values that actually matter, *are* enums.
- **`Order.pickupCode` is unique per slot, not globally.** Four characters from
  a 26-glyph alphabet collide constantly at global scope; per-slot it is the
  uniqueness that the physical handout actually needs.
- **`Product.slug`** was added (not in the original field list) so the seed can
  upsert on a stable key. Without it, "idempotent seed" means hardcoding cuids.
  qa.md's E2E already refers to a product as `"gummy-bear-pouch"`, which now
  resolves to a real slug.
- **`OrderItem` has `@@unique([orderId, productId])`**, matching
  `checkoutSchema`'s rejection of duplicate cart lines. A duplicate line means a
  corrupt client cart, and the pick list should never show one product twice.
- **`onDelete: Restrict` on `Order.slot` and `OrderItem.product`.** Deleting a
  product or a slot must not erase purchase history or the snapshots on it.
  Deactivate instead of deleting. `OrderItem.order` cascades, since an order and
  its lines are one object.
- **The seed does not reset `stockQty`, slot `capacity`/`bookedCount`, or
  existing `Setting` values on re-run.** A seed that resets stock can un-sell a
  snack somebody already paid for, and CLAUDE.md §7 makes the spend cap and tax
  rate human decisions that a re-seed must not silently revert. `SEED_RESET_STOCK=1`
  opts into resetting stock for local dev.
- **The seeded schedule is a placeholder** — three lunch windows a day for the
  next seven calendar days (including weekends, so a Saturday dev session has
  something to test against), capacities 24/24/18 invented. Real bell schedule
  and real handout throughput are on the P5 human sign-off list.

### 9. [manager, FYI] `npx tsc --noEmit` needs Next's generated types

On a clean checkout, `app/layout.tsx` fails with `Cannot find name 'LayoutProps'`
until `.next/types` exists. Run `npx next typegen` (or any `next dev` / `next build`)
first. Worth adding to the CI job before the `tsc --noEmit` step, otherwise CI
fails on a pre-existing P0 file for reasons that have nothing to do with the
change under test.

---

## P2 — backend (catalog read endpoints) · 2026-09-02

Shipped: `GET /api/products`, `GET /api/slots`, `lib/validation.ts`
(`productQuerySchema` only — `checkoutSchema` is P3 and was deliberately not
stubbed). Both endpoints are published in `docs/API-CONTRACT.md` §6.

### 10. [qa] Where to attack what P2 landed

Per the backend definition of done. Both routes are reads with no writes and no
transaction, so the interesting failures are staleness and filter semantics, not
races.

- **`/api/products` allergen filter is the safety-critical surface.** It uses
  `NOT: { allergens: { hasSome: [...] } }`. The bug to hunt is `hasEvery`, which
  would only exclude products carrying the *entire* excluded set — a product
  with `["PEANUTS","TREE_NUTS","SOY"]` would survive `?excludeAllergens=PEANUTS`
  and be shown to a peanut-allergic student. Verified by hand against the seed
  (`?excludeAllergens=PEANUTS` returns 20 of 22 in-stock products, dropping
  `Peanut Butter Cups` and `Trail Mix Bag`), and qa.md §4 already has both
  cases. Keep them, and keep the multi-token case
  (`?excludeAllergens=DAIRY,PEANUTS,GLUTEN` = exclude on any of three, not all
  three) which is where an accidental `AND` between tokens would hide.
- **Unknown allergen tokens are a 400, not a no-op.** `?excludeAllergens=MILK`
  or `=dairy` returns `INVALID_INPUT`. This is a deliberate divergence from
  backend.md §9, which casts the raw strings `as any` — see item 11. A
  regression here is silent and dangerous: an unrecognised token in a
  `NOT hasSome` filter excludes nothing, so the request *looks* like it
  filtered. Worth a test asserting the 400 explicitly.
- **`remaining` in `/api/slots` is advisory and racy by design.** It is read
  outside any transaction, so two students can both see `remaining: 1`. That is
  correct — `book_slot()` is what actually decides, and one of them gets
  `SLOT_FULL` at checkout. Do not "fix" this by pre-checking. What *is* worth
  testing: that the response never contains `capacity` or `bookedCount` (the
  route projects explicitly), and that `full: true` slots are still returned so
  the picker can disable rather than drop them.
- **Both routes are `force-dynamic`.** Without it Next can prerender a
  no-argument `GET` at build time and serve a frozen catalog and a frozen
  "today" for the life of the deployment. Confirmed `ƒ` (Dynamic) in the
  production build output. A test that only ever runs `next dev` will not catch
  a regression here — check the build manifest or assert `Cache-Control:
  no-store` against a `next start` server, not a dev one.
- **`/api/products` projects an explicit field list**, so `createdAt` /
  `updatedAt` are not returned and a column added later (P4b's photo/inventory
  fields) cannot leak by default. If a future field *should* be public it has to
  be added in two places, which is the intent.
- **Not rate limited.** Both are public reads with no side effects and no PII.
  If scraping ever matters, that is an infrastructure decision, not a code one.

### 11. [manager, FYI] Two deliberate divergences from backend.md §9

Both are hardenings, not preference:

1. **Allergen tokens are validated against the `Allergen` enum** instead of
   `q.excludeAllergens as any`. The `as any` cast lets any string through to
   Prisma, where an unmatched value in `NOT hasSome` filters nothing and returns
   a full catalog with a 200. Given the enum uses `DAIRY`/`GLUTEN` where the
   Canadian priority list says *milk*/*wheat*, a plausible client typo (`MILK`)
   is exactly the value that fails silently. CLAUDE.md §2.8 says allergen data
   is never inferred and never defaulted, so an unrecognised token is now a 400.
   Matching is exact and case-sensitive — callers build these from the enum, and
   normalising `dairy` → `DAIRY` is the first step toward normalising something
   that should have been rejected.
2. **`safeParse` + `AppError("INVALID_INPUT")` instead of `.parse()`.** The
   sketch throws a raw `ZodError`, which surfaces as a bare 500 with no code —
   against API-CONTRACT §2 and CLAUDE.md's "never bare 500s".

### 12. [frontend, manager] The catalog has two read paths with different filters

`GET /api/products` filters `active = true AND stockQty > 0`. The catalog Server
Component sketched in frontend.md §4 reads the database directly and filters on
`active` only. Both are intentional and they are not interchangeable:

- The P2 gate requires **sold-out cards disabled, not hidden**, which only the
  Server Component path can satisfy — sold-out products are absent from the API
  response entirely, so a client rendering from the API cannot distinguish
  "sold out" from "does not exist".
- I did not add an `includeSoldOut` param. It is not in the spec, and inventing
  public API surface to paper over a path difference seemed worse than naming
  the difference. **If frontend needs sold-out items over HTTP** (a client-side
  filter on `/snacks`, say, rather than a server round-trip), append the request
  here and I will add it in P3 — do not infer them from a zero stock count,
  because they are simply not in the payload.
- One consequence worth knowing: the same `?category=…&exclude=…` filters can
  yield different product sets on the two paths. If that ever becomes visible to
  a student (server-rendered grid vs. client-filtered grid disagreeing), the
  answer is to pick one path, not to loosen the API filter.

### 13. [manager] `/api/slots` inherits the timezone bug from item 3

"Today forward" is `new Date()` with `setHours(0,0,0,0)` — server-local, i.e.
UTC on Vercel. Between 00:00 and 07:00 UTC the server's "today" is already the
school's tomorrow in `America/Vancouver`, so that evening's windows drop off the
list early. Practically harmless (it is after 5pm locally and lunch is long
over) and *safer* than the opposite error, but it is the same missing-timezone
root cause as the cutoff arithmetic and should be fixed by the same
`lib/timezone.ts` constant in P3 rather than left as a second copy of the bug.
Flagging it so the P3 fix covers both call sites, not just the cutoff.

### 14. [manager] `next dev` / `next build` rewrites CLAUDE.md, which backend does not own

Next 16.3.4 appends a `<!-- BEGIN:nextjs-agent-rules -->` block to `CLAUDE.md`
on every `next dev` and `next build`
(`node_modules/next/dist/server/lib/generate-agent-files.js`). CLAUDE.md is
manager-only per the ownership map, so I reverted it with `git checkout --` and
left it untouched in this change — but it will come back for every agent that
runs the dev server, it will show up in unrelated diffs, and it will fail any CI
step that asserts a clean tree.

The generated text itself suggests committing it "to keep the tree clean". That
is a decision for whoever owns the file, not something an agent should action on
the file's own say-so. Two clean options, both manager calls:

- set `agentRules: false` in `next.config.ts` (unowned in the ownership map, so
  I did not touch it), or
- commit the block once, deliberately, and note in CLAUDE.md that it is
  tool-generated.

### 15. [human, blocking launch] Branded product names conflict with CLAUDE.md §2.7

Not P2 work and not mine to revert, but it is in the data my endpoint now
serves, so it should not go unrecorded. `prisma/seed.ts` contains real
third-party trademarks — Doritos ×5, Cheetos, Lay's, Ruffles, Kool-Aid Jammers
×3 — added during the P1 manager review (API-CONTRACT changelog, 2026-09-02).
CLAUDE.md §2.7 says no third-party IP in copy, assets, or product names, and
frontend's P0 report was asked for exactly this list under "Must replace before
launch".

If the school is genuinely reselling packaged brand-name product, using the
brand name is ordinary retail description and the invariant probably means
"don't invent branded-looking fictional IP" — but that reading is a human
decision, not an agent's, and it also implies real product photography with its
own licensing question (P4b's uploader). Either the invariant gets amended or
the names do. Also note `public/products/` is still empty (item 6), so nothing
is rendering these yet.

### 16. [human, blocking launch] Item 4 is now serving over HTTP — 8 products assert "no allergens" without review

Sharpening the open item rather than restating it. `GET /api/products` now
publishes `allergens` publicly, and per the schema an empty array means
"reviewed, none present", never "unknown". Eight of the 23 seeded products
currently return `"allergens": []` — including all three Kool-Aid Jammers, Lay's
Classic, Ruffles Original and Apple Slices Cup — and every one of the 23 is
`active = true`.

Item 4 asked for the opposite: anything not reviewed against actual packaging is
`active = false` until it is. So the API is, right now, making an affirmative
safety claim about eight products on the strength of an agent's guess from the
product name. That is fine for a dev database and is not fine the first time a
student loads the page. The gate is human review, not code: either the review
happens, or those rows go `active = false` before anything is deployed.

---

## P3 step 1 — backend (checkout, Stripe webhook, release, sweep) · 2026-09-03

Shipped: `POST /api/checkout`, `POST /api/webhooks/stripe`, `GET /api/cron/sweep`,
`lib/codes.ts`, `lib/rate-limit.ts`, `lib/timezone.ts`, `lib/stripe/client.ts`,
`lib/stripe/payments.ts`, `lib/db/release.ts`, `lib/email.ts`, `checkoutSchema`
in `lib/validation.ts`, `vercel.json`. All three routes are published in
`docs/API-CONTRACT.md` §6. **Card and cash are both live**, per the manager's
decision resolving BUILDPLAN.md's open item.

### 17. [manager] The timezone bug from items 3 and 13 is fixed, at both call sites

`lib/timezone.ts` pins `SCHOOL_TZ = "America/Vancouver"` and derives everything
from `Intl.DateTimeFormat` (no new dependency, and it tracks the PST/PDT switch,
which a fixed offset constant would not). Nothing else in the codebase may read
a wall clock via `setHours`/`getHours`.

Two functions, because the two call sites need two different things and
conflating them is how this bug comes back:

- `schoolDayStartInstant()` — the real instant the school's day began
  (`2026-09-03T07:00:00.000Z` for the 3rd, in PDT). Used for the daily spend cap,
  which filters the real timestamp `Order.createdAt`. Previously server-local
  midnight, i.e. 17:00 the previous afternoon in Vancouver — a child's daily
  limit reset in the middle of the school day.
- `serviceDateFloorForToday()` — the school's calendar day expressed as midnight
  **UTC**, matching how `PickupSlot.serviceDate` is *stored*. Used by
  `GET /api/slots`. Using the real instant here would have been the opposite
  bug: `2026-09-03T07:00Z > 2026-09-03T00:00Z` would hide the current day's
  windows every single morning.
- `slotStartInstant(serviceDate, startTime)` — the real instant a window opens.
  Reads the calendar day off `serviceDate` with **UTC** getters (it is a date key
  stored at midnight UTC; local getters shift it a day west of Greenwich) and
  interprets `"HH:MM"` in the school zone.

Verified TZ-independent: with the process `TZ` set to `UTC`, `Asia/Tokyo`,
`America/Toronto` and `Pacific/Kiritimati`, `slotStartInstant` for the
2026-09-03 11:50 window returns `2026-09-03T18:50:00.000Z` in all four. Winter
dates correctly return UTC-8 (`2026-01-15T19:50Z`). The observable fix on
`/api/slots`: at 00:25 UTC (17:25 the previous afternoon in Vancouver) the old
filter returned 18 slots and had already dropped the school's current day; it
now returns 21.

**qa: run the cutoff test under a non-UTC `TZ`.** A UTC-only test passes against
the original bug and would have passed against it here too. `TZ=Asia/Tokyo` and
`TZ=Pacific/Kiritimati` are the useful ones — they are on the wrong calendar day
relative to Vancouver for most of the UTC day.

**Known and accepted:** a malformed `startTime` (`"9:5"`, `"24:00"`) throws
rather than coercing, which surfaces as a 500. That is deliberate — the correct
loudness for "the bell schedule in the database is not a time" — but it means
bad seed data breaks checkout for that window rather than degrading. DST
ambiguity (02:00–02:59 on spring-forward, 01:00–01:59 twice on fall-back) is
documented in the module and not defended against, because no lunch service can
fall in those windows.

### 18. [manager] Deliberate deviations from backend.md, each one a hardening

Recorded rather than buried. Nothing about the mandated *transaction order*
changed — validate → reprice → cap → cutoff → `book_slot` → `reserve_stock`
(sorted) → create → pay is exactly as specified.

1. **`withRetryOnUnique` wraps the whole `$transaction`, not the insert inside
   it.** backend.md §2/§3 retries `tx.order.create` in place. That cannot work:
   Postgres aborts a transaction on its first failed statement and every
   subsequent statement returns 25P02 until rollback, and Prisma does not wrap
   individual queries in savepoints. The retry would fail on a different error
   every time, so a pickup-code collision would have surfaced as a 500 rather
   than being retried. Retrying the transaction is correct rather than merely
   tolerable: the failed attempt rolled back, releasing the seat and stock it
   claimed, and the retry re-claims from a clean state.
2. **Cash orders are created `RESERVED` inside the transaction**, instead of
   created `PENDING` and updated to `RESERVED` after the commit. The spec's
   version has a crash window that produces an unrecoverable row: a cash order
   stuck `PENDING` with `expiresAt = null` is invisible to the sweep (which only
   looks at `CARD` orders with an expiry) and holds its stock and its seat
   forever with no process that will ever release them. Writing the status
   atomically with the hold it describes removes the window.
3. **`lib/db/release.ts` takes the slot lock before the product locks, and sorts
   products by id.** backend.md §6 does the reverse order and does not sort.
   That is two separate ABBA deadlocks: release-vs-checkout on the same slot and
   product (checkout takes slot then products), and release-vs-release for two
   orders sharing two products. Postgres resolves a deadlock by killing one
   side, so both would have surfaced as 500s mid-service. The global lock order
   is now: order row → slot row → product rows ascending, everywhere.
4. **PaymentIntent creation failure releases the order** (`CANCELLED`) instead of
   leaving it `PENDING` to be swept 15 minutes later, for a payment the student
   was never able to attempt. Safe even if Stripe did create the intent before
   the error: the client secret never left the handler, so nothing can confirm
   it. Returns `INTERNAL`, not `PAYMENT_FAILED` — nothing was declined, and
   "Payment was declined" is a lie to tell a child.
5. **A webhook amount mismatch clears `expiresAt`.** backend.md §5 logs and
   returns, which leaves the order `PENDING` with its expiry intact — so the
   sweep expires it minutes later and releases the stock for an order that has
   been paid. The student is charged and has no order. Status stays `PENDING`
   (nothing downstream may treat it as good) but it is now out of the sweep's
   reach, parked for a human.
6. **`onPaid` writes with a conditional `updateMany` on `status = 'PENDING'`,**
   not a bare `update` after a read. Two concurrent deliveries with *different*
   event ids for the same intent both clear the dedupe insert; only the
   conditional write stops both from acting. Verified below.
7. **The webhook returns 500 on handler failure**, not a rethrow into whatever
   Next does with it. A 200 is a promise to Stripe that the event was handled.
8. **The sweep wraps each order in try/catch** and reports `failed` in the
   response body. One poisoned order must not strand the other 99.
9. **`CRON_SECRET` is compared in constant time**, and an unset secret means
   nobody is authorised rather than everybody. `!==` on a secret leaks it a byte
   at a time to anything that can measure the response.
10. **`email` is `.trim().toLowerCase().pipe(z.email())`**, not
    `z.string().trim().toLowerCase().email()`. In zod 4 the format check runs
    before transforms in the same chain, so the spec's order rejects
    `"  Student@example.com "` — a value browser autofill produces routinely.
11. **`apiVersion: "2026-08-26.dahlia"`**, not `"2025-08-27.basil"`. The
    installed stripe-node (22.6.1) only types the version it was generated
    against; the spec's literal is a compile error.
12. **A non-JSON request body is `INVALID_INPUT` with `fields._body`**, not an
    unhandled 500. Same hardening as P2 item 11.

### 19. [P5, manager] Rate limiting: what runs where, and the one mode that will bite you

backend.md §8 calls `Redis.fromEnv()` at module scope, which throws when Upstash
is not configured — that takes checkout down entirely in local dev and in CI,
where there is no Redis and never will be. `lib/rate-limit.ts` picks a mode once
per process instead. The rule it is built around: **it must be impossible to end
up in production with rate limiting quietly switched off.**

| Mode | When | Behaviour |
|---|---|---|
| `disabled` | `RATE_LIMIT_DISABLED=1` **and** not production | Pass-through |
| `upstash` | `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` present | The real sliding window, shared across instances |
| `memory` | No Redis, not production | Real per-process sliding window |
| `memory` | Production **and** `RATE_LIMIT_ALLOW_INSECURE=1` | Same, plus a `rate_limit_degraded_in_production` log line **per request** |
| `fail-closed` | Production, no Redis, no opt-in | Every call throws `RATE_LIMITED`. Checkout stops |

`fail-closed` is the deliberate one, and it is a judgment call worth challenging
if you disagree: deploying without Redis and silently serving an unlimited card
endpoint is the failure that costs money and cannot be seen from the outside,
whereas a checkout that 429s everybody is noticed in ninety seconds and fixed by
provisioning Upstash. The safer failure is the loud one. `RATE_LIMIT_DISABLED=1`
is ignored in production with a log line, so it cannot ship as an oversight.

**P5, "Upstash Redis provisioned":** set exactly `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN` in the Vercel environment. Nothing else changes. Then
confirm the deployed logs emit `{"event":"rate_limit_mode","mode":"upstash"}` at
boot — that assertion is the whole verification, and BUILDPLAN's "rate limiting
confirmed live" checkbox should mean that line and not a guess. Neither variable
is in `.env.example` yet; add them there when they exist.

**qa, this affects your suite directly.** The limits are 10/min per IP and 5/min
per hashed email. In `memory` mode (which is what `next dev` and CI get) they are
real, so 50 simultaneous checkouts from one address get 429s instead of testing
the transaction. Two options, and pick deliberately:

- `RATE_LIMIT_DISABLED=1` for the concurrency suite, or
- vary `x-forwarded-for` and `email` per request, which is what I did to verify
  by hand.

Either way, **write at least one test that asserts a 429**, in `memory` mode with
the flag off — otherwise the `RATE_LIMITED` branch ships having never executed.
`resetInMemoryRateLimit()` is exported for test teardown.

### 20. [qa, P5] The Stripe seam: how to drive checkout without a Stripe account

`STRIPE_SECRET_KEY` in this environment is `sk_test_placeholder`. There is no
Stripe account, so `paymentIntents.create` is the one part of P3 that cannot run
for real here. It is isolated in `lib/stripe/payments.ts`, which arms a
simulator only when **both**:

1. `NODE_ENV !== "production"`, **and**
2. the key contains `"placeholder"`, or `STRIPE_SIMULATE=1` is set.

Condition 1 alone makes it inert in a production build regardless of every other
variable. Condition 2 means the moment a real `sk_test_…` key is present, even in
dev, the real API is used — nobody develops against a simulator while believing
they are talking to Stripe. The mode is logged at boot as
`{"event":"stripe_mode","mode":"simulated"|"live"}`; assert on it.

A simulated intent gets id `pi_sim_<24 hex>` derived deterministically from the
order id, which reproduces the property the real call gets from
`idempotencyKey: pi_<orderId>`: calling twice for one order yields one intent.
The prefix makes it unmistakable in the database and in a support ticket, and
`cancelOrderPaymentIntent` refuses to send a `pi_sim_` id to Stripe even in live
mode (dev data reaching a live database would only earn a 404).

**The webhook route has no seam and needs none.** `constructEvent` is local HMAC
over the raw body. Any test holding `STRIPE_WEBHOOK_SECRET` can forge a valid
delivery:

```ts
const payload = JSON.stringify({ id: "evt_x", type: "payment_intent.succeeded", /* … */ });
const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
await fetch(url, { method: "POST", headers: { "stripe-signature": header }, body: payload });
```

That is exactly how every webhook case below was verified. **Do not** reach for
`stripe listen` in CI.

**P5, "swap in the live key":** set a real `STRIPE_SECRET_KEY` and deploy with
`NODE_ENV=production`. No flag needs clearing and no code changes. Confirm
`"mode":"live"` in the boot logs, then place and refund the one real transaction.

### 21. [qa] WHERE TO ATTACK WHAT P3 LANDED

Per the backend definition of done. This is the adversarial list — everything
below is a real hole in code I wrote, not a hypothetical.

#### `POST /api/checkout`

- **The daily spend cap is a read-then-write with no lock, and no database
  constraint behind it.** Two concurrent checkouts for one email both aggregate
  `spent = 0`, both pass, and both commit — a student spends 2× the cap.
  Unlike stock and slots there is no `reserve_spend()` to make it atomic. This
  is the single most exploitable hole in the route. Fire N simultaneous
  checkouts for one email, each just under the cap, and count what lands.
  Fixing it properly needs either a per-email advisory lock or a spend ledger
  row updated conditionally; both are bigger than P3 step 1 and neither is in
  the spec, so it is flagged rather than fixed.
- **`PENDING` is excluded from the cap aggregate** (spec, deliberate: an
  abandoned cart should not block re-ordering for 15 minutes). Consequence: a
  student can hold *unlimited* unpaid card orders, each individually under the
  cap, and pay them all. The cap only constrains money already committed. Test
  it, then decide with the human whether that is acceptable — CLAUDE.md §7 puts
  cap changes on the escalation list, and this is effectively a cap change.
- **The cap matches `email` exactly.** `a.b+lunch@gmail.com` and `ab@gmail.com`
  are the same mailbox and two different cap buckets. Not fixable without
  provider-specific normalisation, which is its own trap.
- **Prices are read at step 3 and stock is reserved at step 6, in different
  transactions.** A staff reprice in that window means the order is created,
  charged and snapshotted at the old price. Small money, real, and the snapshot
  makes it invisible afterwards. Try it: hold a checkout with a slow client and
  `UPDATE products SET price_cents` mid-flight.
- **Interactive-transaction starvation.** Each checkout holds a pooled
  connection for the whole transaction. The pg adapter's default pool is small;
  under enough concurrency `maxWait` (5s) is exceeded and Prisma throws P2028,
  which becomes a bare `INTERNAL` 500 — not the clean 409 the client knows how
  to recover from. Push concurrency until you find that number and report it.
  That is the load ceiling for one instance.
- **Deadlock regression.** The `.sort((a,b) => a.productId.localeCompare(b.productId))`
  before `reserve_stock` is the only thing preventing an ABBA deadlock between
  two carts holding the same two products in opposite order. Delete the sort
  locally and prove your test goes red; if it stays green the test is not
  actually concurrent. Same for the slot-before-products order in
  `lib/db/release.ts` (item 18.3).
- **Malformed bodies are not rate limited.** Per the spec, both `rateLimit`
  calls run *after* validation, so a flood of garbage bodies is never limited.
  It costs only a zod parse and touches no database, but it is a free
  amplification vector and I kept the spec order rather than deviating.
- **The IP key trusts `x-forwarded-for`.** Vercel overwrites it at the edge, so
  it is trustworthy there — but behind any other proxy, or none, an attacker
  rotates the header freely and the IP limit is decoration. The email limit is
  the one that still bites.
- **`getSetting` caches for 60 seconds per process.** Changing the cutoff, the
  cap or the TTL takes up to a minute to take effect, and different instances
  disagree during that minute. A cap lowered at 12:00 is not enforced at 12:00.
- **Deactivating a product mid-checkout returns `OUT_OF_STOCK`, not
  `PRODUCT_UNAVAILABLE`** — `reserve_stock` checks `active` and cannot say why
  it failed. Inherited from P1 item 7, still true, still cosmetic.
- **`orderNumber` has only 90,000 values.** Five retries covers collisions today;
  by a few thousand orders birthday collisions are routine, and every collision
  now costs a whole retried transaction (item 18.1). Widen the space before this
  matters, not after.
- **A code collision retries the transaction, which re-runs `book_slot`.** If the
  window filled in the microseconds between attempts, the student gets
  `SLOT_FULL` for what was really a code collision. Astronomically rare,
  correct-but-confusing, and now written down.
- **Narrow but real: the PaymentIntent is created before the order row records
  its id.** If the order is expired in that gap the client still receives a
  usable `clientSecret`, pays, and the succeeded webhook finds a non-`PENDING`
  order and no-ops — money taken, no order. Needs a Stripe call slower than the
  TTL, so it is unreachable at TTL 15. Force it: set
  `pending_order_ttl_minutes = 0` and run the sweep against an in-flight card
  checkout.

#### `POST /api/webhooks/stripe`

- **The dedupe row is inserted before the handler runs, so a hard crash mid-handler
  is unrecoverable.** The `catch` deletes the row on a thrown error, but a process
  kill, an OOM or a function timeout leaves the row behind — and every Stripe
  retry then returns `already processed` while the payment was never recorded.
  The student is charged and the order expires. The fix is a two-phase claim (a
  `processedAt` column, and reprocessing a claimed-but-unfinished row older than
  N minutes), which needs a schema change I did not make mid-phase. **This is
  the worst failure mode in P3.** Reproduce it by killing the process between the
  insert and the update.
- **Stripe does not guarantee event ordering.** `charge.refunded` arriving before
  `payment_intent.succeeded` leaves an order that was refunded sitting at `PAID`
  forever: the refund `updateMany` matches nothing (the order is still
  `PENDING`), and the succeeded event then marks it `PAID`. Deliver the two
  events out of order and watch it happen. There is no timestamp check.
- **`webhook_orphan_intent`** — a succeeded payment with no matching order is
  logged and dropped. Recoverable by hand from the intent's metadata, but
  nothing alerts. Same for `webhook_amount_mismatch`: both are silent money
  problems whose only trace is a log line nobody is watching. P4 should surface
  them in `/admin`.
- **`onFailed` releases stock on a `payment_failed` event**, and a student can
  retry the same intent afterwards. Once released, the retry succeeds at Stripe
  but the order is `CANCELLED`, so `onPaid` no-ops — charged, no order. Whether
  Stripe actually permits that on an automatic-payment-methods intent is worth
  establishing empirically before deciding it is theoretical.
- Verified working, do not let it regress: exact-id replay, **concurrent triple**
  replay, three simultaneous deliveries with *different* ids for one intent
  (exactly one `order_paid`), bad signature, missing signature.

#### `lib/db/release.ts`

- **Idempotent by conditional `updateMany`, and that is load-bearing.** The
  `WHERE status = 'PENDING'` is evaluated after the row lock, so a second
  concurrent release matches zero rows. Verified: a second failure event for an
  already-released order restocked nothing. Attack it by racing the sweep
  against a `payment_intent.canceled` for the same order.
- **Restock is unbounded** (inherited, P1 item 7). If staff already adjusted
  stock by hand for this order, the release double-counts. Nothing in the
  database prevents it.
- **`GREATEST(booked_count - 1, 0)`** means a double-release cannot go negative —
  it also means a double-release is *silent*. The floor hides the bug it exists
  to survive.
- **A refund does not free the pickup seat**, only stock is discussed in the
  spec. Confirmed in the dev database: a slot showed `booked_count = 3` with
  only 2 orders still holding, the third being `REFUNDED`. Consistent with the
  stock rule, but it means refunded orders permanently consume pickup capacity
  until staff adjusts. P4 needs a control for this; the pick list will otherwise
  slowly under-report available seats across a term.

#### `GET /api/cron/sweep`

- **Two concurrent invocations both scan the same 100 rows.** Safe — `releaseOrder`
  lets exactly one win — but both call `paymentIntents.cancel` and the loser
  swallows the error. Worth a test, because Vercel Cron can double-fire.
- **`take: 100` per run, every 5 minutes.** More than 100 abandoned card orders
  per 5-minute window and the backlog grows without bound. Irrelevant at one
  school's volume; still the actual throughput ceiling, and nothing alerts if it
  is hit.
- **Cancel-then-release ordering is the safety property.** Reverse it and a
  payment landing mid-sweep gets a `PAID` order whose stock was already given
  back. Test that the ordering holds: pay an intent between the cancel and the
  release.
- The sweep never touches cash orders. If item 18.2 were ever reverted, cash
  orders stuck `PENDING` would be invisible to it forever.

#### Cross-cutting

- **The rate limiter is per-process in `memory` mode**, so anything you assert
  about limits in CI does not describe production (item 19).
- **`lib/settings.ts`'s 60-second cache** means no test that changes a setting
  and immediately calls a route is reliable. Restart the server, or wait it out.

### ~~22. [manager, frontend — BLOCKING] `GET /api/orders/[orderNumber]` is not shipped~~ RESOLVED — option 3, shipped

BUILDPLAN P3's next step is frontend building `/checkout` and
`/order/[orderNumber]`, and the confirmation page cannot exist without this
endpoint: a card order is `PENDING` when checkout returns, and the *only* thing
that flips it to `PAID` is the webhook, so the page must poll. It is in the
API-CONTRACT table as P3 and it was not in my task list, so I did not build it —
and it needs a decision I should not make alone rather than a route:

**an order number alone must not be enough to read a child's name, email, phone,
homeroom and pickup code.** `LL-#####` is a 90,000-value space; enumerating it is
trivial and CLAUDE.md §2.6 is explicit about PII. Options, roughly in order of
my preference:

1. Return a **minimal projection** — status, total, items, and the pickup code
   only once `status` is in a paid/reserved state. No name, no email, no phone.
   Enumeration then leaks "an order exists and is paid", which is close to
   harmless.
2. Require the email in the request and match it against the order.
3. Set a short-lived signed cookie at checkout scoped to that order.

Say which and I will build it. It is small once the shape is settled.

**Resolution (manager): option 3 — a short-lived signed httpOnly cookie, scoped
to the one order — and it is now built.** Chosen because it needs no PII
round-trip: nothing is re-typed, nothing has to survive the Stripe redirect in
`sessionStorage` or a query string, it works identically for cash and card, and
it expires on its own.

**Done (backend, 2026-09-03).** `GET /api/orders/[orderNumber]` is live and
documented in `API-CONTRACT.md` §6. **Frontend is unblocked** — the polling
recipe, the exact response shape, and the one integration rule that will bite
(poll from a *client* component; a Server Component's `fetch` does not carry the
browser's cookie) are all in that section.

- `POST /api/checkout` sets `ll_ord_<orderNumber>` on both the cash and the card
  response: `HttpOnly`, `SameSite=Lax`, `Secure` in production, `Path=/api/orders`,
  `Max-Age` 48 h. Value is `v1.<orderId>.<expiryUnixSeconds>.<base64url
  HMAC-SHA256 of the first three>`, signed with the new `ORDER_SESSION_SECRET`
  (`lib/order-session.ts`, added to `.env.example` and to the local `.env`).
- The token binds the **database id**, never the human-facing order number, and
  the route re-checks that the row it resolved carries the order number in the
  URL. A cookie for order A therefore cannot read order B — not by editing the
  address bar and not by being renamed to B's cookie name. Both verified.
- **One cookie per order**, rather than a single `ll_order` that each checkout
  overwrites. That was the "use your judgement" edge in the decision: naming the
  cookie after the order number keeps every receipt from one sitting readable,
  and costs nothing, because the name is not trusted for anything. Verified: two
  orders from one browser, both still readable afterwards.
- Response carries `status`, `paymentMethod`, the three amounts, `expiresAt`,
  `placedAt`, the slot's `label`/`startTime`/`location`/`serviceDate`, the line
  snapshots with **full un-truncated `allergensSnapshot`** (CLAUDE.md §2.8 — this
  is the surface that invariant is written about), and `pickupCode` **only** when
  the status is `RESERVED` or `PAID`. It carries **no** `studentName`, `email`,
  `phone` or `homeroom`, and no slot `capacity`/`bookedCount`.
- Every rejection — unknown order number, no cookie, expired cookie, forged
  cookie, another order's cookie — is the same `ORDER_NOT_FOUND` 404 with an
  identical body. New code in `lib/errors.ts`. Nothing distinguishes them, so the
  route is not an enumeration oracle.
- Open sub-questions I did not decide alone are in item 25 below.

### 23. [human, P4/P5] No confirmation email is sent, deliberately

`lib/email.ts` exists and both call sites (checkout for cash, webhook for card)
invoke it, so turning delivery on is one module rather than an archaeology
exercise. It logs `confirmation_email_not_sent` and resolves. It never throws —
no notification failure may break a checkout that already holds stock or already
took money.

Delivery is unbuilt because it is a §7 escalation, not because it is hard:
mailing a student's name, pickup code, pickup location and allergen list to an
address typed into a public form is squarely "school data policy and PII
retention", and Resend retains message content. Needed before it ships: a
verified from-domain, a reviewed template, a retention answer, and a decision on
whether the parent rather than the student is the recipient.

`API-CONTRACT.md` §6 states plainly that no email is sent, so the UI must not
tell a student to check an inbox that stays empty. **frontend: the confirmation
screen is the receipt.**

### 24. [manager] Verification actually run, so you can judge what is untested

Against the seeded dev Postgres, `next dev`, real HTTP:

- Cash checkout → `RESERVED`, `stock_qty` 40→38 and 30→29, `booked_count` 0→1,
  snapshots written (`Trail Mix Bag` carried `{PEANUTS,TREE_NUTS,SOY}` intact),
  `expiresAt` null, email trimmed and lower-cased.
- Card checkout → `PENDING`, `expiresAt` +15m, simulated intent id stored,
  `clientSecret` returned, **no `pickupCode`** in the response, and
  `clientTotalCents: 399` against a real total of 400 logged `total_mismatch`
  with a hashed email while charging 400.
- Every error path exercised: `INVALID_INPUT` (multi-field, duplicate lines,
  non-JSON body), `PAST_CUTOFF`, `OUT_OF_STOCK`, `PRODUCT_UNAVAILABLE`,
  `SPEND_CAP_EXCEEDED`, `SLOT_FULL`.
- Partial-failure rollback: a two-line cart whose second line was sold out left
  `booked_count` and the first product's stock byte-identical.
- 20 simultaneous checkouts, capacity-1 slot → exactly 1×200, 19×409,
  `booked_count = 1`, stock −1.
- 20 simultaneous checkouts for the last unit of one product → exactly 1×200,
  19×409, stock 1→0, `booked_count` +1 (the 19 losers' seats all rolled back).
- Webhook: signed `payment_intent.succeeded` → `PAID` + `paidAt` + `expiresAt`
  cleared; exact replay → `already processed`; **concurrent** triple replay → one
  `ok`, two `already processed`; three simultaneous deliveries with different ids
  for one intent → exactly one `order_paid`; bad signature → 400 with no dedupe
  row written; missing signature → 400; tampered `amount_received: 1` against a
  150c order → refused, order stays `PENDING`, `expiresAt` cleared.
- `payment_failed` → `CANCELLED`, stock 10→12, seat 1→0; a second failure event
  for the same order changed nothing.
- `charge.refunded` → `REFUNDED`, stock unchanged (correct).
- Sweep: 401 unauthenticated, 401 wrong secret, and with the correct secret an
  aged order → `EXPIRED`, stock 9→12, seat released; immediate second run
  `{"scanned":0,"released":0,"failed":0}`.
- `npx tsc --noEmit` and a full `npx eslint .` both clean.

**Not tested, and this is qa's job, not a gap I am hiding:** everything in item
21. In particular the spend-cap race, the crash-mid-webhook window, out-of-order
Stripe events, and the connection-pool ceiling are all untested by me. Nothing
has run against a real Stripe account.

---

## P3 step 1b — backend (order receipt endpoint) · 2026-09-03

Shipped: `GET /api/orders/[orderNumber]`, `lib/order-session.ts`, the
`ORDER_NOT_FOUND` error code, the `ORDER_SESSION_SECRET` variable, and the
per-order cookie on both `POST /api/checkout` responses. Item 22 above is
resolved and carries the shape and the reasoning; this item is what is left open
and where to attack it.

### 25. [manager] Two calls I did not make alone

1. ~~**The pickup code is withheld for `PACKED` and `PICKED_UP`.**~~ RESOLVED
   (manager) — added both to `CODE_VISIBLE_STATUSES`. Agreed with the
   recommendation; no reason to wait for P4 since it's a genuine bug (a
   receipt that stops showing the code exactly when staff asks the student
   to read it aloud), not a policy question. `tsc`/`eslint` re-verified
   clean after the change.
2. **Checkout now refuses in production when `ORDER_SESSION_SECRET` is unset.**
   `assertOrderSessionConfigured()` is the first statement in the handler, before
   validation, before any money or stock moves. The alternative — set no cookie
   and carry on — means a deployment that takes payment normally and shows every
   student a confirmation page that says their order does not exist, with no
   symptom visible from the outside. Same reasoning as the rate limiter's
   fail-closed mode (item 19). In dev and CI, an unset secret falls back to a
   random per-process key, so nothing breaks without it. Challenge this if you
   disagree; it is one `if`.

### 26. [human, school data policy] The receipt cookie on a shared device

Not a bug and not something I should decide (CLAUDE.md §7). The cookie is a
48-hour bearer token sitting in one browser profile. On a personal phone that is
exactly right. On a shared library machine or a class set of iPads, the next
student to open the site can pull up the previous student's receipt — order
total, snack list, pickup window, and the pickup code that opens the locker — for
two days.

It contains no name, email, phone or homeroom, which is the reason the projection
is that narrow. But a live pickup code is a physical credential. Options, none of
them built: a shorter TTL (a receipt is mostly consumed within an hour of the
bell), an explicit "done — forget this order" control that clears the cookie, or
accepting it because students bring their own phones. **A decision about what
school-owned shared devices actually look like is required before launch**, and
it belongs on the same list as the email-delivery question in item 23.

### 27. [frontend] Two response signals the confirmation page must not get wrong

- **`status: "PENDING"` with `expiresAt: null` is a frozen order, not a live
  one.** That combination is only produced by the webhook's amount-mismatch path
  (item 18.5): the payment did not match the order, so it will never become
  `PAID`, and it has been deliberately parked out of the sweep's reach for a
  human. Polling it forever shows a spinner that never resolves. Stop polling and
  say something that sends the student to staff — do not say "paid" and do not
  say "expired".
- **Every other `PENDING` carries a real `expiresAt`.** Once it is in the past
  the order is doomed but may not be swept for up to five more minutes, so a poll
  can legitimately return a `PENDING` order that is already dead. Treat
  `expiresAt` in the past as expired in the UI rather than waiting for the status
  to catch up.

### 28. [qa] WHERE TO ATTACK `GET /api/orders/[orderNumber]`

The route is a read with no transaction and no writes, so the failures are
authorisation and staleness rather than races. Per the definition of done, the
concurrency case it is genuinely vulnerable to is the **poll-versus-sweep window
in item 27**: between `expiresAt` passing and the sweep running, this endpoint
reports an order as `PENDING` that is already unrecoverable. It is a stale read
by design (`no-store` gets you freshness at the database, not at the clock), and
the UI, not the route, is what has to be right about it.

Everything below is a real hole or a real trap in code I just wrote:

- **The five rejection cases must stay indistinguishable.** No cookie, tampered
  signature, token signed with the wrong key, correctly-signed-but-expired token,
  and a valid cookie for a *different* real order must all return byte-identical
  `ORDER_NOT_FOUND` bodies with the same status. I verified all five by hand;
  make them a test, because the natural "improvement" someone makes later is a
  helpful distinct message, and that turns the route into an enumeration oracle.
  The cross-order case is the one that matters most: sign a token for order B,
  put it in a cookie named for order A, request order A.
- **`pickupCode` presence across the whole status machine.** The rule is a `Set`
  in the route, not a status comparison, so a regression is silent. Drive an
  order through `PENDING`, `RESERVED`, `PAID`, `PACKED`, `PICKED_UP`,
  `CANCELLED`, `EXPIRED`, `REFUNDED` with direct database writes and assert on
  the presence of the **key**, not its truthiness. Note items 25.1 — `PACKED` and
  `PICKED_UP` currently withhold it, and that may deliberately change.
- **The projection is the PII boundary.** Assert that no response ever contains
  `studentName`, `email`, `phone`, `homeroom`, `capacity`, `bookedCount` or the
  order's `id`. It is an explicit `select`, so a column added in P4 cannot leak
  by default — but only a test keeps it that way.
- **The dev key is per-process.** With `ORDER_SESSION_SECRET` unset, the module
  generates a random key at boot, so any test that restarts the server between
  the checkout and the read gets a 404 that looks like a logic bug. **Set
  `ORDER_SESSION_SECRET` explicitly in the CI environment** and assert
  `{"event":"order_session_mode","mode":"configured"}` at boot, the same way you
  assert the rate-limit and Stripe modes.
- **`Secure` follows `NODE_ENV`, not the URL scheme.** A suite that runs
  `next build && next start` with `NODE_ENV=production` over plain http will have
  the browser silently drop the cookie and every read will 404. Playwright over
  http needs a non-production build, or an https origin.
- **The cookie is `Path=/api/orders`.** It is not sent to `/order/[orderNumber]`
  itself, which is intentional (item 22) but means a Server Component render of
  the confirmation page cannot read the order. If the E2E ever starts asserting
  server-rendered receipt content, that is why it fails.
- **Not rate limited, deliberately** — no database query happens until a
  signature verifies, and a per-IP limit on a 1.5 s poll behind a school's single
  NAT address would break the page for everyone. If a write is ever added to this
  route, that reasoning expires with it.
- **Signature comparison is `timingSafeEqual`, but the cheap structural checks
  (part count, version prefix, expiry format) return early.** An attacker can
  distinguish "malformed" from "bad signature" by timing. It leaks nothing they
  do not already know about their own token, and fixing it would mean HMAC-ing
  garbage; noted rather than defended.
- **Rotating `ORDER_SESSION_SECRET` invalidates every outstanding receipt.**
  There is no key-id in the token and no second-key grace path. Rotate outside
  service hours, or accept that every order placed in the previous 48 hours
  becomes unreadable. If rotation ever needs to be routine, the token version
  prefix (`v1.`) is the hook to hang a key id on.

### 29. [manager] Verification actually run for this endpoint

Against the seeded dev Postgres, `next dev`, real HTTP, real cookie jars:

- **Cash checkout** → `Set-Cookie: ll_ord_LL-46154=v1.<cuid>.<exp>.<mac>;
  Path=/api/orders; Max-Age=172800; HttpOnly; SameSite=lax` (no `Secure`, correct
  for http dev). `GET /api/orders/LL-46154` with that jar → 200, `RESERVED`,
  `pickupCode` present, `Trail Mix Bag` carrying `["PEANUTS","TREE_NUTS","SOY"]`
  intact, slot `Lunch A / 11:50 / Locker bank C`, no PII field anywhere in the
  body.
- **Card checkout** → cookie set the same way. Read while `PENDING`: **no
  `pickupCode` key**, `expiresAt` +15 m. Then a signed
  `payment_intent.succeeded` (`generateTestHeaderString`, item 20) → the same
  request now returns `PAID` with `pickupCode` and `expiresAt: null`.
- **Expired order** → force `expires_at` into the past, run the sweep
  (`{"scanned":1,"released":1,"failed":0}`), read again → `EXPIRED`, no
  `pickupCode`. The page can stop polling on the status alone.
- **Rejections, all identical 404 `ORDER_NOT_FOUND`:** no cookie; last character
  of the signature flipped; a token signed with a different key; a correctly
  signed token whose expiry is one second in the past; the cash order's cookie
  renamed onto the card order's cookie name; a correctly signed token for the
  *card* order presented at the *cash* order's URL; an order number that does not
  exist, both with and without a valid cookie for a real order; a malformed
  `not-an-order` path segment. A control request with a token I signed
  independently from the `.env` secret returned 200, which is what proves the
  route is really verifying against that secret and not accepting anything.
- **Two orders, one browser** → both cookies coexist in one jar and both receipts
  stay readable.
- **Key modes** → `unconfigured-production` refuses to sign,
  `ephemeral-dev` signs and verifies, `configured` signs and verifies. The dev
  server logs `{"event":"order_session_mode","mode":"configured"}` at boot.
- **Logs** → the only new line is
  `{"event":"order_lookup_denied","reason":"no_cookie"|"invalid_token"|"order_mismatch"|"malformed_order_number"|"order_row_missing"}`.
  Grepped the whole dev log for the test student's name, email and phone: zero
  hits (CLAUDE.md §2.6). The reason is in the log and never in the response.
- `npx tsc --noEmit` and a full `npx eslint .` both clean.

**Not tested by me:** a production build (so `Secure` on the cookie and the
production fail-closed path in checkout are reasoned, not observed), a real
browser's cookie handling across the actual Stripe redirect, and everything in
item 28.

---

## P3 step 2 — qa (concurrency, money, allergen and receipt suites) · 2026-09-03

Shipped: `vitest.config.ts`, `tests/setup/{env,db,server,global-setup,global}.ts`,
`tests/helpers.ts`, `tests/concurrency/{slot,stock,webhook,sweep,spendcap}.test.ts`,
`tests/api/{money,orders,allergens}.test.ts`,
`tests/unit/{timezone,order-session,money,rate-limit}.test.ts`,
`tests/ratelimit/checkout-limit.test.ts`, `.github/workflows/ci.yml`.

**108 tests. 105 pass, 3 are `it.fails` documenting confirmed bugs** (items 32,
33, 35 below). `npx tsc --noEmit` and a full `npx eslint .` are clean. No
application code was changed — the two lock-ordering experiments below were run
in the working copy and reverted with `git checkout --`; `git status` is clean
apart from the new test files.

### 30. [manager] How the harness differs from qa.md §1, and why

- **No testcontainers.** Docker-in-docker does not work in this sandbox (the
  daemon cannot start under the available privileges). `tests/setup/db.ts`
  points at a real system Postgres 16 and a dedicated `looplockers_test`
  database instead, with the same idempotent `migrate deploy` +
  `manual_constraints.sql` + `TRUNCATE`-per-test cycle. Override with
  `QA_DATABASE_URL`; CI uses a `postgres:16-alpine` service container, which is
  the same thing by another name. The requirement that matters — **real
  Postgres, real row locks, real READ COMMITTED** — is met. Nothing is mocked.
- **Prisma 7 adapter**, per item 2, not qa.md's `datasources` option.
- **Routes are driven over real HTTP against `next dev`**, spawned once per run
  by the vitest `globalSetup`. `next build && next start` was rejected: with
  `NODE_ENV=production` the receipt cookie becomes `Secure` and is dropped over
  http (item 28), the rate limiter goes `fail-closed` (item 19), and the Stripe
  simulator disarms (item 20) — the suite would be testing something other than
  the code.
- **A harness self-check runs before any test.** It writes a sentinel product to
  the test database and refuses to start unless `GET /api/products` on the
  spawned server returns it. Without that, a server that picked up `.env`'s
  `DATABASE_URL` would silently drive the **dev** database while the suite
  asserted against the test one — including the 600-way load tests.
- **Two non-UTC timezones on purpose.** The server runs `TZ=Asia/Tokyo` (+9),
  the test process `TZ=Pacific/Kiritimati` (+14), the school is
  `America/Vancouver` (−7). For most of the UTC day all three are on different
  calendar days, so the cutoff and spend-cap tests only pass if both sides go
  through `lib/timezone.ts` (item 17's request, honoured).
- **`vitest.config.ts` deviates from qa.md's snippet** because Vitest 4 removed
  `poolOptions.forks.singleFork`. The equivalent is `pool: "forks"`,
  `maxWorkers: 1`, `isolate: false`, `fileParallelism: false`,
  `sequence.concurrent: false` — one process, one pool, one database, no two
  files ever mid-TRUNCATE together.
- **Two vitest invocations are required.** `lib/rate-limit.ts` resolves its mode
  once per process, and Next refuses to start a second dev server for the same
  project, so the 429 tests need their own run:
  `QA_RATE_LIMIT=on npx vitest run tests/ratelimit`.

Run everything locally:

```bash
QA_NO_SERVER=1 npx vitest run tests/unit
npx vitest run tests/concurrency tests/api
QA_RATE_LIMIT=on npx vitest run tests/ratelimit
```

### ~~31. [backend — CRITICAL, confirmed] The daily spend cap does not exist under concurrency~~ RESOLVED (backend, 2026-09-03)

**Fixed (backend, 2026-09-03).** The cap check moved out of step 4 and into the checkout transaction in
`app/api/checkout/route.ts`, as its **first** statement:

```sql
SELECT pg_advisory_xact_lock(hashtextextended($1, 0))   -- $1 = "<email>:<school day ISO>"
```

then the `spent` aggregate is re-read under that lock, and
`SPEND_CAP_EXCEEDED` rolls back a transaction that is holding nothing else.
There is still no `reserve_spend()` because there cannot be one — the cap is a
sum over rows that do not exist yet, which no single `UPDATE ... WHERE` can
express. The lock is what makes the read-then-write safe. It is released by
Postgres at commit *or* rollback (and the commit is recorded before the release,
so the next holder's fresh READ COMMITTED snapshot sees it), so nothing unlocks
by hand and nothing leaks if a process dies mid-checkout.

Taken before `book_slot`, deliberately, for two reasons: the cap is the cheapest
failure and should not cost a seat and a stock decrement to discover, and taking
it before any row lock keeps one global lock order — mailbox, then slot, then
products ascending — which cannot deadlock against `lib/db/release.ts`.

**Verified** (dedicated `looplockers_verify` database, real HTTP against
`next dev`, rate limiting off):

```
[spend-cap race] 6x300c concurrent for one email: accepted=5 capped=1 committedCents=1500 capCents=1500 in 499ms
[spend-cap sequential] accepted=5 committedCents=1500 lastError={"code":"SPEND_CAP_EXCEEDED",...,"capCents":1500,"spentCents":1500}
[spend-cap boundary] 1400=200 100=200 1=409 committedCents=1500
[different emails] 12 concurrent 1400c across 12 mailboxes: accepted=12/12 in 219ms
[one mailbox]      12 concurrent 1400c on ONE mailbox: accepted=1/12 capped=11 committedCents=1400
```

The measured number qa reported (6 accepted, 1800c) is now 5 accepted, 1500c.
Only the same mailbox serialises: twelve different students checking out
simultaneously all succeeded, so this is not a lunch-rush bottleneck.
qa's `it.fails` in `tests/concurrency/spendcap.test.ts` now reports **"expected
to fail but passed"** and should be converted to a normal `it`.

**Still true, unchanged, and NOT part of this fix** (all pre-existing item 21
notes): `PENDING` is still excluded from the aggregate (item 39, human decision);
the cap still matches `email` exactly, so `a.b+lunch@` and `ab@` are two buckets
*and two different advisory-lock keys*; `getSetting` still caches the cap for 60
seconds per process, so a lowered cap takes up to a minute to bite.

**New attack surface, for qa.** The lock is held for the whole transaction, so
one mailbox's checkouts are now strictly serial. Fire 50 concurrent checkouts
for one address and confirm they queue rather than time out — if the per-mailbox
queue ever exceeds the 5s `maxWait`, the tail returns `INTERNAL` 500 instead of a
coded 409. Under the per-email rate limit (5/min) this is unreachable in
production, but the concurrency suite runs with limiting off and can reach it.

qa's original report, kept for the record:

**What broke.** Item 21's prediction is exactly right, and it is worse than "a
student spends 2× the cap": the cap is not a cap at all against a client that
fires in parallel.

**Minimal reproduction** (`tests/concurrency/spendcap.test.ts`, printed on every
run): six simultaneous 300c cash checkouts for one email address, cap 1500c.

```
[spend-cap race] 6×300c concurrent for one email: accepted=6 capped=0 committedCents=1800 capCents=1500
```

Six of six accepted, zero refused, 1800c committed against a 1500c cap. The same
six requests **sequentially** produce five accepted and one `SPEND_CAP_EXCEEDED`
(also asserted), which is what makes this a race and not a misconfiguration.
Nothing bounds it: N parallel requests each just under the cap all commit,
because every one of them aggregates the same `spent` and no database constraint
exists behind the check.

**Severity: critical.** It is a money control on a product used by children,
it is trivially exploitable from a browser console with `Promise.all`, and there
is no `reserve_spend()` the way there is a `reserve_stock()`. The test is
`it.fails` asserting the invariant that *should* hold
(`committed <= cap`); when a fix lands it will report "expected to fail but
passed" and must be converted to a normal `it`.

### ~~32. [backend — CRITICAL, confirmed] A crashed webhook handler loses the payment permanently~~ RESOLVED (backend, 2026-09-03)

**What broke.** Item 21's "worst failure mode in P3", reproduced. The dedupe row
is inserted before dispatch and only deleted on a *thrown* error, so a kill, an
OOM or a function timeout leaves it behind and every Stripe retry answers
`already processed`.

**Minimal reproduction** (`tests/concurrency/webhook.test.ts`): insert the row
the route would have written, then deliver the event twice.

```ts
await testDb.webhookEvent.create({ data: { id: "evt_crashed", type: "payment_intent.succeeded" } });
await postWebhook(event); // -> 200 "already processed"
await postWebhook(event); // -> 200 "already processed"
```

```
[webhook crash window] after 2 retries of a poisoned event id: status=PENDING paidAt=null expiresAt=<future>
```

The order stays `PENDING` with a live `expiresAt`, so the sweep then expires it
and gives the stock back. **The student is charged and has no order, and the only
trace is that no `order_paid` line was ever written.** Nothing alerts.

**Severity: critical.** Needs the two-phase claim item 21 describes (a
`processedAt` column, and reprocessing a claimed-but-unfinished row older than
N minutes) — a schema change, so it is a backend + manager decision, not a
test-side workaround.

**Fixed (backend, 2026-09-03).** The two-phase claim, as described.

- **Schema.** `WebhookEvent.processedAt DateTime?` (`processed_at`), migration
  `20260903055030_webhook_event_processed_at`, applied to the dev database and
  verified as a plain nullable column. `manual_constraints.sql` needed no change:
  there is no new constraint, because the protocol is enforced by a conditional
  `UPDATE`, not by the database. **Every existing database — including
  `looplockers_test` and CI — needs `prisma migrate deploy` before the webhook
  route will run.**
- **Route** (`app/api/webhooks/stripe/route.ts`, `claimWebhookEvent`). Insert
  with `processedAt = null` = "I am handling this now". On `P2002`: read the row;
  `processedAt` set → genuine replay, `already processed`; `processedAt` null and
  `createdAt` newer than the staleness window → somebody is plausibly mid-flight,
  `already processed`, trust them; `processedAt` null and older → reclaim with
  `updateMany({ where: { id, processedAt: null, createdAt: { lt: staleBefore } },
  data: { createdAt: now } })` and dispatch if and only if `count === 1`. The
  conditional update is the lock, exactly as in `releaseOrder`. After a
  successful dispatch, `processedAt = now()`. A thrown handler still deletes the
  row, so an ordinary failure is retried immediately rather than waiting out the
  window. One narrow extra case is handled: if the row vanishes between the
  failed insert and the read (a failing handler deleted it), the insert is
  attempted once more instead of being reported as a duplicate.
- **The staleness window is 3 minutes** (`WEBHOOK_CLAIM_STALE_MS`). Lower bound:
  it must exceed anything this handler can take, whose slowest path is
  `releaseOrder` at `maxWait` 5s + `timeout` 15s, plus a cold start — so 3
  minutes is ~6× the worst case and a live request is never mistaken for a
  corpse. Upper bound: Stripe's retry cadence backs off from minutes to hours, so
  the first retry after a crash lands outside the window and recovery costs one
  retry, not a day of them. It sits nearer the lower bound because the two
  failure directions are asymmetric: too long only delays recovery, too short
  risks two processes dispatching one event. Every handler is idempotent, so even
  that is survivable — but "survivable" is not the bar for money.

**Verified** (dedicated `looplockers_verify` database, real signed webhooks over
HTTP; the crash is reproduced exactly as qa did it, by writing the row a killed
process would have left behind):

```
[A normal]            response=200 "ok" order=PAID processed_at=set
[B replay x3]         ["ok","already processed","already processed"] paid=true
[C stale claim]       before=PENDING response=200 "ok" after=PAID paid_at=set expires_at=NULL processed_at=set
[C retry after recovery] "already processed" order=PAID
[D fresh claim]       response=200 "already processed" order=PENDING
[E concurrent x3]     ["already processed","already processed","ok"] rows=1 order=PAID
[F reclaim race]      ["already processed","already processed","ok"] order=PAID
```

C is the bug: a row inserted with `created_at = now() - interval '10 minutes'`
and `processed_at = NULL` is now reclaimed and the payment is recorded, where it
previously answered `already processed` forever. D is the case that must not
regress and did not. F races three deliveries at one stale row and exactly one
wins (`webhook_claim_reclaimed` once, `webhook_reclaim_lost` once).

**qa: your `it.fails` for this one still fails, and correctly so.**
`tests/concurrency/webhook.test.ts` creates the poisoned row with a **default
`createdAt`**, i.e. `now()`, which is by design indistinguishable from a delivery
that is still in flight — reclaiming that would break the concurrent-duplicate
case in the same file. To assert the fix, backdate the fixture past the window:

```ts
await testDb.webhookEvent.create({
  data: {
    id: "evt_crashed",
    type: "payment_intent.succeeded",
    createdAt: new Date(Date.now() - 10 * 60_000), // older than WEBHOOK_CLAIM_STALE_MS
  },
});
```

With that one line the assertion `expect(after.status).toBe("PAID")` holds — it
is the C row above. Worth keeping the un-backdated version too, asserting
`already processed` and `PENDING`: that is the D row, and it is the property
protecting concurrent delivery.

**New log lines to watch (P4 `/admin`):** `webhook_claim_reclaimed` means a
handler died mid-payment and we recovered; it should be rare and it is the
signal that something is killing the function. `webhook_reclaim_lost` and
`webhook_claim_in_flight` are normal contention. `webhook_mark_processed_failed`
means the work was applied but the row was not marked finished — harmless (the
next retry reprocesses idempotently) but worth seeing.

**Residual 1, for qa.** The window is time-based, so a handler that hangs for
more than 3 minutes without dying *can* be double-dispatched by a Stripe retry.
Both dispatch paths are guarded by conditional updates (`onPaid`'s
`WHERE status = 'PENDING'`, `releaseOrder`'s), so the second one no-ops rather
than double-acting — but that is the seam to attack.

**Residual 2 — NARROWED, not eliminated (manager, 2026-09-03; corrected
2026-09-03 after qa's re-run caught this paragraph misdescribing its own fix —
see §49).** Closed *most* of the gap with the move backend outlined:
`claimWebhookEvent` now returns a third outcome, `"ambiguous"`, for a claim
that is unfinished and has aged past `WEBHOOK_CLAIM_TRUST_MS` (10s) but not
yet past `WEBHOOK_CLAIM_STALE_MS` (3min). The route answers that band with
**409** ("claim ambiguous, retry"), never 200 — so Stripe is never told an
event is handled while there is real doubt in that band.

**What this paragraph got wrong the first time:** it isn't true that "a
same-second retry gets 409." A claim younger than `WEBHOOK_CLAIM_TRUST_MS`
(10s) — same-second absolutely included — is still trusted with a plain
**200** `already processed`, exactly as before this fix. That trust band is
what keeps genuinely concurrent duplicate delivery idempotent without relying
on timing luck (real dispatch finishes in low milliseconds, so 10s is a wide,
safe margin for that), but it means the original §32 failure is *narrowed*,
not closed: a handler killed at t=0 whose first Stripe retry lands before
t=10s is still told "handled" and that payment is still lost — worse, per
qa's test, the order is left `PENDING` with a live `expiresAt`, so the sweep
later hands its stock back too. §49 has the pinned test proving this exact
behavior on purpose so it stays visible.

**Accepted as a proportionate residual, not fixed further right now.**
Eliminating the trust band entirely (answer 409 for *any* unfinished claim,
regardless of age) would close this completely, but real dispatch latency is
not literally zero — under load, a legitimate concurrent duplicate's "loser"
could occasionally check the claim before the "winner" finishes and get a
409 instead of the deterministic 200 qa's concurrent-triple-replay test
currently asserts, trading a rare-but-real recovery gap for an
occasionally-flaky correctness test. Given qa rated this LOW severity, it
needs both a genuine process crash *and* a retry landing inside a 10-second
window (Stripe's real webhook retry cadence is not sub-second), and it is now
honestly documented and pinned by a test rather than silently assumed away —
this is being accepted the same way this project has accepted other narrow,
low-probability distributed-systems edges (the DST transition window in
`lib/timezone.ts`, the deactivate-mid-checkout race in HANDOFF §7). Revisit if
real-world webhook volume or Stripe's retry behavior ever makes this a
plausible, not just theoretical, path to a lost payment.

`npx tsc --noEmit` and full `npx eslint .` re-verified clean after the change.

### ~~33. [backend — HIGH, confirmed] Out-of-order Stripe events strand a refunded order at PAID~~ RESOLVED (backend, 2026-09-03)

**What broke.** Item 21's prediction, confirmed exactly.

**Minimal reproduction** (`tests/concurrency/webhook.test.ts`): deliver
`charge.refunded` for an intent, then `payment_intent.succeeded` for the same
intent.

```
[out-of-order events] refunded-then-succeeded left status=PAID paidAt=true
```

The refund's `updateMany` matches nothing (the order is still `PENDING` when it
arrives), and the succeeded event then writes `PAID`. The order is `PAID`
forever for money that has been returned; the pick list will hand out a snack
that was refunded. The reverse order works correctly (also asserted), so this is
purely an ordering assumption. There is no timestamp or event-sequence check
anywhere.

**Severity: high.** Stripe explicitly does not guarantee ordering.

**Fixed (backend, 2026-09-03).** `onRefunded`'s match widened from
`status: { in: ["PAID", "PACKED"] }` to `status: { notIn: ["REFUNDED"] }`, and
it clears `expiresAt` on the way. No new mechanism: this is the same idempotent
conditional-update pattern as `releaseOrder` and `onPaid`. A second refund event
for an already-`REFUNDED` order still matches zero rows and no-ops, and
`onPaid`'s existing `WHERE status = 'PENDING'` guard makes the late succeeded
event a no-op by itself.

The reasoning that makes the collapse `PENDING` → `REFUNDED` correct rather than
merely convenient: Stripe cannot refund money it never took, so a real
`charge.refunded` proves the payment happened *first in real time*, whatever
order we are told about it in. `REFUNDED` is the right end state either way, so
we can go there directly instead of waiting for an event that may arrive minutes
later or (if it is the delivery that crashed) not at all.

**`paidAt` decision: left null in the reversed case, deliberately.** It is
written by exactly one path — `onPaid`, after the amount check — and stamping it
in the refund handler would put the instant the *refund* was processed into a
field that means "when the payment was confirmed". Nothing downstream reads
`paidAt` (grepped: no route, no lib, no component — only the webhook writes it
and only tests read it), so nothing needs the value; a null that is honest beats
a timestamp that is wrong, and Stripe remains the record of when the charge
happened. The consequence to know about: **for a `REFUNDED` order, `paidAt` is
no longer a reliable "was this ever paid"** — it is null exactly when the refund
outran the confirmation. Each occurrence writes a dedicated
`order_refunded_before_payment` log line, which is what P4's admin screen should
surface. (The alternative, reading `charge.created`, was rejected: it is not
present on every refund payload and it would make one field mean two things.)

Stock and the pickup seat are still **not** returned, including on the new
`PENDING` → `REFUNDED` transition. That is the existing refund rule, and erring
towards holding stock can never oversell.

**Verified** (dedicated `looplockers_verify` database, real signed webhooks):

```
[G refund-then-succeeded]  refund=200"ok" after-refund=REFUNDED expires_at=NULL | succeeded=200"ok" FINAL=REFUNDED paid_at=NULL stock=19 seat=1
[H succeeded-then-refund]  after-paid=PAID paid_at=set FINAL=REFUNDED paid_at=set stock=19 seat=1
[I double refund]          second refund=200"ok" FINAL=REFUNDED
[J expired then refunded]  FINAL=REFUNDED
```

G is qa's exact scenario and now ends `REFUNDED`, not `PAID`; the late succeeded
event logged `webhook_noop … "status":"REFUNDED"`. H is the forward order, still
correct. J is a bonus case the widened match now handles: an order the sweep
already expired, whose payment turned out to have landed and been refunded, no
longer stays `EXPIRED` while the money round-tripped.

qa's `it.fails` in `tests/concurrency/webhook.test.ts` now reports **"expected to
fail but passed"** (`[out-of-order events] refunded-then-succeeded left
status=REFUNDED paidAt=false`) and should be converted to a normal `it`.

**New, for qa.** `charge.refunded` for an intent with no order now logs
`webhook_orphan_refund` instead of silently updating zero rows — same class of
silent-money problem as `webhook_orphan_intent`, and P4 should alert on both.

### 34. [qa/backend — HIGH, new] The deadlock test everyone has been writing is a false green

**What broke.** Nothing in the product — but qa.md's own reverse-cart test, and
the one item 21 asks to be kept, **passes with the `.sort()` deleted**. I
deleted it and measured:

- 20 carts on **one** slot, same two products in opposite order, sort removed:
  **20/20 succeeded, zero deadlocks.**

The reason: `book_slot` takes the slot row lock *first*, so two carts in the same
pickup window are serialised before they ever touch a product. An ABBA deadlock
between them is impossible, and the sort is unreachable as a defence in that
scenario. The test proves nothing.

The case that does exercise it is **two different pickup windows** holding the
same two products — Lunch A and Lunch B both selling the same chips and the same
juice, which is the normal shape of a school day. With that fixture, 60 carts
(30 per window, reversed):

- sort removed → **6 of 60 returned `INTERNAL` 500**, server log recorded
  `deadlock detected` / `40P01`.
- sort restored → **60/60 succeeded, zero deadlock lines.**

`tests/concurrency/stock.test.ts` now uses the two-slot fixture and carries that
measurement in a comment.

**Severity: high (as a test defect).** Anyone "simplifying" this test back to one
slot silently removes the only coverage of the lock ordering, and item 21's
instruction to prove it goes red is the reason it was caught.

### 35. [backend — HIGH, new] The `release.ts` lock order is load-bearing, and half of it is currently guarded by an index rather than by code

Item 18.3's fix was verified by the same delete-and-measure method, and it splits
into two separate claims:

1. **release-versus-checkout on the same slot and products (real, reproduces).**
   Reversing `lib/db/release.ts` to backend.md §6's order — products first, then
   the slot — and running 24 releases (2 sweeps + 24 `payment_failed` events)
   concurrently with 24 fresh checkouts on the same window and products:
   **18 `INTERNAL` 500s and 28 `deadlock detected` lines.** Restored: **8/8
   sweep tests pass, zero deadlock lines.** Now covered by
   "does not deadlock when releases and fresh checkouts share a slot and its
   products".
2. **release-versus-release for two orders sharing two products (did NOT
   reproduce).** Deleting `orderBy: { productId: "asc" }` from `release.ts`
   changed nothing: eight concurrent releases stayed green. The reason is that
   `OrderItem` carries `@@unique([orderId, productId])`, so an unordered
   `findMany` on `orderId` comes back from that index in `productId` ascending
   order anyway. **The sort is currently redundant because of an index, not
   because the risk is absent.** Leave it in: if that unique constraint is ever
   dropped or the query plan changes (a sequential scan returns physical order),
   the sort is the only thing left. Worth a one-line comment in `release.ts`
   saying so.

### 36. [manager — MEDIUM] The connection-pool ceiling, measured

Item 21 asked for the number. Against one `next dev` instance and a local
Postgres, all simultaneous cash checkouts on one slot:

| Concurrency | Result |
|---|---|
| 120 | 120 × 200, 1.8 s |
| 400 | 400 × 200, 6.0 s |
| 500 | 500 × 200, 7.6 s |
| 600 | 600 × 200, 8.9 s |
| **800** | **766 × 200, 34 × 500 (4.3 %), 12.8 s** |

The 800-way failures are exactly the predicted `P2028` (transaction timeout /
`maxWait` exceeded) surfacing as a bare `INTERNAL` 500 rather than a coded 409 a
client can recover from. **The books stayed correct at every level** — stock
down by exactly the number of orders created, `booked_count` equal to it, no
oversell — so the failure is availability, not correctness.

So: the prediction is confirmed, and the ceiling is between 600 and 800
in-flight checkouts per instance, which is far beyond one school's lunch rush.
`tests/concurrency/stock.test.ts` keeps a 120-way regression test that asserts
zero 500s; the 800-way probe was temporary and is not committed (it would be a
flaky test on shared CI hardware).

### 37. [backend — HIGH, confirmed] Payment lands after the sweep: money taken, no order

Item 21's "narrow but real" hole, forced rather than waited for
(`tests/concurrency/sweep.test.ts`): expire a card order, run the sweep, then
deliver a valid signed `payment_intent.succeeded` for its intent.

Result: order `EXPIRED`, `paidAt` null, stock already given back, webhook logs
`webhook_noop` and returns 200. The `clientSecret` handed to the browser stays
usable, so this is reachable any time Stripe or a student's phone is slower than
the TTL — no setting change needed to make it possible, only to make it likely.

Related, and better than feared: the sweep-versus-late-payment **race** is safe.
Running `runSweep()` and the succeeded webhook in parallel resolved to `EXPIRED`
in every observed run, never to a torn state, and the test asserts the full
invariant for both branches (PAID ⇒ stock still held and seat still booked;
EXPIRED ⇒ stock and seat returned exactly once and `paidAt` null).

**Not verifiable here:** that `cancelOrderPaymentIntent` runs *before* the
release in a way that actually prevents the charge — `cancel` is a no-op in
simulated mode (`pi_sim_` ids never reach Stripe), so only the code order is
confirmed, not its effect. That needs the P5 live-key transaction.

### 38. [backend — MEDIUM, confirmed (database half)] A retry after a decline is swallowed

`payment_intent.payment_failed` → order `CANCELLED`, stock and seat released
(verified: 19 → 20, seat 1 → 0, and a second failure event changes nothing).
A later `payment_intent.succeeded` on the same intent then finds a non-`PENDING`
order and no-ops: `CANCELLED`, `paidAt` null, `webhook_noop` logged.

Whether Stripe permits confirming an automatic-payment-methods intent after a
`payment_failed` cannot be established without a real account — that half stays
open and belongs on the P5 live-transaction checklist.

### ~~39. [human, escalation — CLAUDE.md §7] Unpaid holds make the daily cap ~unbounded even without the race~~ RESOLVED

Item 21 asked for this to be tested and put in front of a human. Four sequential
1400c **card** checkouts for one email are all accepted (`PENDING` is excluded
from the cap aggregate by design), and paying all four with valid webhooks
leaves **5600c paid for one address against a 1500c cap — 3.7×**. Asserted in
`tests/concurrency/spendcap.test.ts`.

This is behaving as specified. It is also effectively a change to the spend cap,
which CLAUDE.md §7 puts on the human escalation list, so the decision is: is the
cap a limit on *committed* money (today's behaviour) or on *money in flight*?

**Decision (human): keep as-is — committed money only.** `PENDING` stays
excluded from the cap aggregate. No code change. The real-world exposure is
bounded by how many card checkouts one student can plausibly start and pay
inside the ~15-minute PENDING window, and counting PENDING would mean a
student mid-checkout on one order could get `SPEND_CAP_EXCEEDED` on a second
cart for money that was never actually charged — a worse everyday experience
for a rare edge case. This is a separate question from item 31 (the
*concurrent* race, which bypasses even the committed-money cap entirely and
is being fixed, not accepted).

### 40. [manager — LOW/INFO] Rate limiting: what is actually true

`tests/ratelimit/checkout-limit.test.ts`, server started in `memory` mode:

- The 429 branch executes: the 11th checkout from one IP inside a minute returns
  429 `RATE_LIMITED`, and the 6th for one email does too. Item 19's request is
  satisfied — that branch no longer ships unexecuted.
- **Rotating `x-forwarded-for` defeats the IP limit completely**: 25 checkouts at
  2.5× the budget, **zero 429s**. Only correct on Vercel, where the edge
  overwrites the header. If this ever runs behind anything else, the IP limit is
  decoration and the email limit is the only real one (item 21, confirmed).
- **Malformed bodies are never counted**: 30 consecutive non-JSON bodies from one
  IP, 30 × 400, no limiting at any point (item 21, confirmed).

### 41. [manager] Two small requests I could not action myself

1. **`package.json` scripts** (not qa-owned). `test:unit` and `test:concurrency`
   still work; the new directories have no script. Please add:
   `"test:api": "vitest run tests/api"`,
   `"test:ratelimit": "QA_RATE_LIMIT=on vitest run tests/ratelimit"`, and
   `QA_NO_SERVER=1` in front of `test:unit` so it skips the dev-server boot.
   `.github/workflows/ci.yml` calls `npx vitest run …` directly so CI does not
   depend on this.
2. **One comment in `lib/db/release.ts`** recording finding 35.2 — that the
   product sort is currently redundant only because of
   `@@unique([orderId, productId])`, and must not be removed on the evidence of
   a passing test.

### 42. [manager] What was NOT written, deliberately

- **Playwright E2E (qa.md §5).** `/checkout` and `/order/[orderNumber]` do not
  exist — frontend is gated on this suite per BUILDPLAN P3 step 2. A spec
  written against absent pages is either skipped or lying, so there is no
  `playwright.config.ts` yet. The card/cash confirmation paths *are* covered at
  the API level (`tests/api/orders.test.ts`): cash reaches `RESERVED` with its
  pickup code, card reaches `PENDING` without one and flips to `PAID` with one
  after a signed webhook.
- **The bundle secret-leak grep (qa.md §6).** Needs `next build`; it belongs with
  the E2E job and is the next QA task after frontend lands, not part of the P3
  checkout gate.

### 43. [manager] Tried and found nothing — stated plainly so "green" means something

These were attacked and did **not** break. Listing them so the green is
auditable rather than asserted:

- Slot capacity: 20 simultaneous checkouts on a capacity-1 window → exactly 1 ×
  200, 19 × `SLOT_FULL`, `booked_count = 1`, and the 19 losers' stock
  reservations all rolled back (stock 100 → 99). 60 simultaneous on capacity 5 →
  exactly 5 orders, `booked_count = 5`, stock −5.
- Stock: 15 simultaneous for the last unit → exactly 1 × 200, 14 ×
  `OUT_OF_STOCK`, stock 0, seat 1 (the 14 losers' seats rolled back).
- Partial-failure rollback: asserted twice, including the case where the failing
  line is *first in the request* and only sorts second, so a reservation is
  definitely already on the books when the failure throws. `booked_count`,
  stock, `orders` and `order_items` all untouched.
- Webhook: exact-id replay ×3 → one `ok`, two `already processed`, one
  `order_paid`, one notification, one `webhook_events` row. **Concurrent** triple
  replay → same. Three *different* event ids for one intent → three dedupe rows,
  exactly one `order_paid`. Missing signature, wrong secret, and a garbage
  `stripe-signature` header → 400 with **no** dedupe row and the order untouched.
  Tampered `amount_received` → stays `PENDING`, `paidAt` null, `expiresAt`
  cleared (item 18.5 behaving as designed). Orphan intent → 200 + log. Unhandled
  type → 200.
- Sweep: 401 with no secret, a wrong secret, and a wrong secret of the *same
  length* (the constant-time compare). Three concurrent sweeps → exactly one
  release, stock back once, `{scanned:0,released:0,failed:0}` on the next run.
  Cash orders with a forced `expiresAt` are never touched. The documented
  `take: 100` ceiling behaves as documented: 105 stale orders → `scanned:100`
  then `scanned:5`, all stock recovered.
- Money: tampered `clientTotalCents` (1 and −99999) ignored, server price
  charged, `total_mismatch` logged. Negative / zero / fractional / absurd /
  string / NaN quantities → 400 with nothing moved. Duplicate cart lines → 400.
  Non-JSON body → 400 with `fields._body`. Inactive product and unknown product
  id → `PRODUCT_UNAVAILABLE`. Price change mid-cart → charged and snapshotted at
  the current price, and a later reprice does not rewrite it. Name and rarity
  snapshots likewise. `total = subtotal + tax` and integer cents held across a
  10× line. No PII in the checkout response body.
- Cutoff: a 2020 slot → `PAST_CUTOFF`; 46 minutes out → 200; 44 minutes out →
  `PAST_CUTOFF` — with the fixture's absolute instant asserted first, across
  three timezones (item 30). `lib/timezone.ts` unit tests pin PDT/PST, the
  UTC-getter service-date read, malformed `startTime` throwing, and the school
  day boundary.
- Spend cap: the 1400 → 100 → 1 boundary; `KID@School.CA` with whitespace
  correctly hitting the same bucket as `kid@school.ca`; and the cap window
  tracking `schoolDayStartInstant` (an order backdated one second before the
  school's midnight stops counting, one second after it still counts).
- Receipt endpoint: all seven rejection shapes — no cookie, tampered signature,
  wrong signing key, correctly-signed-but-expired, **another order's token
  renamed onto this order's cookie**, another order's cookie under its own name,
  unknown order number, malformed path segment — return byte-identical
  `ORDER_NOT_FOUND` 404s, with a control request proving the route really does
  accept a correctly signed token. `pickupCode` presence asserted as a **key**
  across all eight statuses. No `studentName` / `email` / `phone` / `homeroom` /
  `capacity` / `bookedCount` / order id in any response. Cookie flags asserted
  (`HttpOnly`, `SameSite=Lax`, `Path=/api/orders`, `Max-Age=172800`, no `Secure`
  in dev). Two receipts from one jar stay readable. Both §27 signals — a stale
  `PENDING` with a past `expiresAt`, and a frozen `PENDING` with a null one —
  behave as documented.
- Allergens: full round trip catalog → snapshot → receipt with the list
  untruncated; a later product correction does not rewrite history; empty array
  survives as `[]` and not as a missing key; exclusion on ANY match (single and
  three-token); exclusion combined with `category`; `MILK` and `dairy` both
  rejected with 400 rather than silently filtering nothing.
- Concurrency shape: a 40-way checkout burst interleaved with 25 price updates
  never produced an order whose `subtotal_cents` disagreed with the sum of its
  own line snapshots.

### 44. [manager] Not tested, and why — so nobody mistakes this for full coverage

- **Anything against a real Stripe account.** `paymentIntents.create` and
  `cancel` are simulated (item 20). The webhook path is fully exercised because
  it is local HMAC, but "does Stripe let a declined intent be retried" (item 38)
  and "does cancel-before-release actually stop the charge" (item 37) both need
  the P5 live transaction.
- **`lib/settings.ts`'s 60-second cache.** Every test relies on the documented
  defaults with an empty `settings` table, precisely because a test that writes
  a setting and immediately calls a route is unreliable (item 21). The
  `pending_order_ttl_minutes = 0` experiment item 21 suggests was not run for the
  same reason; finding 37 forces the same state directly instead.
- **The deactivate-mid-checkout race** (product deactivated between the price
  read and `reserve_stock`, giving `OUT_OF_STOCK` instead of
  `PRODUCT_UNAVAILABLE`). Cosmetic, and not reachable deterministically without
  a hook inside the transaction. Still true, still unproven.
- **A production build.** So the `Secure` cookie, checkout's production
  fail-closed path, `rate_limit_mode: fail-closed`, and `stripe_mode: live` are
  reasoned, not observed — same gap backend recorded in item 29.
- **`upstash` rate-limit mode.** No Redis in this environment; only `memory` and
  `disabled` have executed.
- **A real browser.** No cookie handling across an actual Stripe redirect, no
  keyboard/axe passes, no client bundle grep (item 42).
- **Order-number collision retry under a real collision.** 600 orders in one slot
  produced no observed collision, so `withRetryOnUnique`'s retry path is
  exercised by nothing but its unit-level reasoning. Item 21's warning about the
  90,000-value space stands; the unit test does assert that 2,000 draws collide.

---

## P3 step 3 — backend (three confirmed concurrency bugs fixed) · 2026-09-03

Items 31, 32 and 33 are struck through above with the fix, the reasoning and the
measured verification each. Summary, so nobody has to reconstruct it:

`app/api/checkout/route.ts` · `app/api/webhooks/stripe/route.ts` ·
`prisma/schema.prisma` + migration `20260903055030_webhook_event_processed_at`.
No test file, component, store or shop page was touched. `npx tsc --noEmit` and
a full `npx eslint .` are clean.

### 45. [qa] What to re-run, and the one marker that will NOT flip

`npx vitest run tests/concurrency tests/api` after `prisma migrate deploy`
against `looplockers_test` (the new column is required):

- **§31 spend cap** — `it.fails` now reports "expected to fail but passed"
  (`accepted=5 capped=1 committedCents=1500`). Convert to a normal `it`.
- **§33 out-of-order refund** — same, `status=REFUNDED paidAt=false`. Convert.
- **§32 crashed handler** — **still an expected failure, and that is correct.**
  The fixture inserts the poisoned row with a default `createdAt`, which the fix
  deliberately reads as "a delivery that is still in flight" rather than as a
  corpse; reclaiming it would break the concurrent-duplicate-delivery test three
  cases above it in the same file. Backdate the fixture's `createdAt` by ten
  minutes and the assertion holds — the exact patch is in item 32. Keeping both
  variants is the better coverage: one asserts recovery, one asserts restraint.

Everything else: 75 passed, 0 regressions, plus 25 unit and 5 rate-limit.

### 46. [qa] Where to attack what this pass landed

- **The advisory lock is held for the whole checkout transaction**, so one
  mailbox is now strictly serial. Push concurrency on a *single* address until
  the queue exceeds `maxWait` (5s) and see whether the tail degrades to
  `INTERNAL` 500 instead of a coded 409. The per-email rate limit (5/min) hides
  this in production; the suite runs with limiting off and can reach it.
- **Lock order is now mailbox → slot → products ascending.** Item 34's method
  applies: two pickup windows, the same two products, reversed carts, plus two
  emails crossed over. If a future change takes the advisory lock anywhere but
  first, that is an ABBA deadlock against `lib/db/release.ts`.
- **The 3-minute staleness window is time-based.** A handler that hangs without
  dying for longer than that can be dispatched twice. Both paths are guarded by
  conditional updates, so the second should no-op — prove it rather than
  assuming it.
- **`charge.refunded` now beats everything except `REFUNDED`.** Deliver it
  against each status (`RESERVED`, `PACKED`, `PICKED_UP`, `CANCELLED`,
  `EXPIRED`) and confirm the end state is `REFUNDED` and that stock and
  `booked_count` are untouched in every one of them. A refunded order still
  permanently consumes its pickup seat (item 21) — unchanged, and now reachable
  from more statuses than before.

---

## P3 step 4 — qa (re-run and extension after the three fixes) · 2026-09-03

### 47. [manager — THE P3 GATE VERDICT] Suite is fully green, no markers standing in for unfixed bugs

Numbers, three consecutive runs, no flakes:

```
QA_NO_SERVER=1 npx vitest run tests/unit        25 passed  (4 files)
npx vitest run tests/concurrency tests/api     106 passed  (9 files)
QA_RATE_LIMIT=on npx vitest run tests/ratelimit  5 passed  (1 file)
npx tsc --noEmit                                 clean
npx eslint .                                     clean
```

`106 passed | 0 failed | 0 skipped | 0 it.fails | 0 expected-fail`. Grep for
`it.fails`, `it.skip`, `describe.skip`, `todo` across `tests/**` returns only
comments describing markers that were removed. **Nothing in this suite is a
placeholder for an unfixed bug any more.**

Per file (before → after):

| File | Before | After |
|---|---|---|
| `tests/concurrency/slot.test.ts` | 4 | 4 |
| `tests/concurrency/stock.test.ts` | 6 | 6 |
| `tests/concurrency/spendcap.test.ts` | 6 (1 `it.fails`) | 10 |
| `tests/concurrency/sweep.test.ts` | 8 | 10 |
| `tests/concurrency/webhook.test.ts` | 14 (2 `it.fails`) | 22 |
| `tests/concurrency/webhook-claim.test.ts` | — | 14 (new file) |
| `tests/api/*` | 40 | 40 |

Baseline before any edit, for the record — the two markers flipped exactly as
§45 predicted and the third did not:

```
Tests  2 failed | 75 passed | 1 expected fail (78)
FAIL  spendcap > KNOWN BUG: the cap is bypassed entirely by concurrent checkouts
FAIL  webhook  > KNOWN BUG: charge.refunded before payment_intent.succeeded leaves the order PAID
      (both: "Expect test to fail")
[spend-cap race] accepted=5 capped=1 committedCents=1500 capCents=1500
[out-of-order events] refunded-then-succeeded left status=REFUNDED paidAt=false
```

Nothing in `app/**`, `lib/**`, `prisma/**`, `components/**` or `stores/**` was
touched. Changes are `tests/concurrency/*`, the new
`tests/concurrency/webhook-claim.test.ts`, and one harness fix in
`tests/setup/server.ts` (item 51). CI needed no change: `.github/workflows/ci.yml`
runs `npx vitest run tests/concurrency`, which picks the new file up by glob.

**From qa's side, P3 is passable.** Four things below are worth reading before
frontend starts on `/checkout` — none of them blocks it, and one is a doc
correction rather than a code defect.

### 48. [manager] What was converted, and what was added

**Converted (2 markers, both now normal `it` with stronger assertions):**

- §31 `spendcap.test.ts` — "KNOWN BUG: the cap is bypassed entirely by
  concurrent checkouts" → **"holds the cap under six concurrent checkouts for
  one address"**. The old assertion was only `committed <= cap`; it now asserts
  the exact split (`accepted=5, capped=1, committed=1500`) and that no request
  degraded to a 500.
- §33 `webhook.test.ts` — "KNOWN BUG: charge.refunded before
  payment_intent.succeeded leaves the order PAID" → **"ends REFUNDED when
  charge.refunded arrives before payment_intent.succeeded"**. Also asserts the
  intermediate state (`REFUNDED` with `expiresAt` cleared), `paidAt` staying
  null, one `order_refunded_before_payment` line, and zero `order_paid` /
  zero notifications from the late succeeded event.

**§32's marker, per that item's own note, was split rather than converted:**

- **"trusts a seconds-old unfinished claim and leaves the order alone"** — the
  original fixture, `createdAt` untouched, now asserting what it always
  actually did (200 `already processed`, order still `PENDING`, claim not
  stolen). This is verification row D and it is the property that protects
  concurrent delivery.
- **"reclaims a claim abandoned by a crashed handler and records the payment"** —
  the same fixture backdated ten minutes. This is the real §32 fix, end to end:
  `200 "ok"`, order `PAID`, `paidAt` set, `expiresAt` cleared, one
  `webhook_claim_reclaimed`, one notification, and the next retry back to an
  ordinary `already processed` replay.

**Added — spend cap (`spendcap.test.ts`, +4):**

- **"admits exactly three of twenty concurrent 400c checkouts against a 1500c
  cap"** — §46's "exactly, not approximately". 20 × 400c against 1500c has one
  arithmetically forced answer whatever order the lock grants in, so this is an
  equality assertion (`accepted=3, capped=17, committed=1200`), not a bound.
- **"serialises one mailbox only: other students never wait on it"** — the
  lock's *scope*, proved structurally rather than by wall clock. A separate
  session takes the exact key the route derives
  (`<lowercased email>:<school day ISO>`) and holds it; while it is held a
  checkout for that mailbox cannot make progress and twelve other mailboxes all
  commit anyway (`accepted=12/12 in ~200ms, victimSettled=false`), then
  releasing lets the blocked one through. This is the manager's measurement
  from §31, now committed as a test.
- **"cannot be raced by spelling the same address eight different ways"** —
  adversarial. Eight concurrent 300c checkouts writing one address eight ways
  (case, leading/trailing whitespace, tab) across two pickup windows. If the
  lock key were ever derived before `checkoutSchema`'s `.trim().toLowerCase()`,
  §31's race would reopen to anyone who can hold shift. `accepted=5,
  committed=1500, total orders=5` — one bucket, one lock.
- **"queues rather than fails when 60 checkouts hit one mailbox at once"** —
  §46's availability half: strictly-serial mailbox must queue, not 500.

**Added — webhook claim bands (`webhook-claim.test.ts`, new, 14):** covered in
item 49.

**Added — refunds (`webhook.test.ts`, +6):**

- **"does NOT release stock or the seat when a refund lands on a PENDING
  order"** — the resource-holding behaviour the manager checked by hand, now a
  named test: `REFUNDED`, stock still 19/20, `booked_count` still 1, and a
  subsequent sweep changes none of it (the refund cleared `expiresAt`, so the
  order is out of the sweep's reach permanently). Intentional per §33, but it is
  a real leak only `/admin` can undo, so it is asserted rather than assumed.
- **`it.each` over `RESERVED`, `PACKED`, `PICKED_UP`, `CANCELLED`, `EXPIRED`**
  (§46's request) — each ends `REFUNDED` with `expiresAt` cleared, stock and
  `booked_count` unmoved, and a second refund event for the same charge is a
  no-op.
- **"overwrites an already-released CANCELLED order with REFUNDED, stock still
  released"** — see item 50.

**Added — cross-lock deadlock and sweep races (`sweep.test.ts`, +2):**

- **"does not deadlock when two mailboxes cross two windows and two products"** —
  §46's ABBA ask. The existing ABBA test never contends the advisory lock (every
  request uses a distinct email). This one crosses every dimension at once — two
  mailboxes, two windows, two products in reversed cart order, 40 fresh
  checkouts against 2 sweeps and 16 releases on the same rows. `reserved=40/40,
  500s=0, stock=360/360`, seats equal to orders. A change that ever took the
  advisory lock after `book_slot` would fail here.
- **"cannot release twice when a refund and the sweep race one expiring
  order"** — a new interaction created by §33, since `onRefunded` now matches
  `PENDING`. End state is always `REFUNDED`; stock released exactly once or not
  at all (never 21/20), and the seat and the stock always agree with each other.

### 49. [qa] The three-band claim, attacked — `tests/concurrency/webhook-claim.test.ts`

New file, 14 tests, all against logic no test had touched before. Everything
here plants the row a crashed handler leaves behind and backdates `createdAt`
into a specific band, because the clock is the only input the branch has.

- **409 middle band (new coverage, as asked):** a 30-second-old unfinished claim
  → `409 "claim ambiguous, retry"`, order untouched (`PENDING`, `paidAt` null,
  `expiresAt` unchanged), no notification, stock unmoved, one
  `webhook_claim_ambiguous` line — **and the claim row's `createdAt` is
  unchanged**, which is load-bearing: bumping it on a 409 would reset the
  staleness clock on every retry and the row could never age into the reclaim
  window, i.e. an infinite 409 loop for a payment that is already lost.
- **All three bands in one table** (`TRUST_MS/5` → 200 `already processed`;
  `TRUST_MS*3` and `STALE_MS-80s` → 409; `STALE_MS+7min` → 200 `ok` and `PAID`),
  written against the constants so a change to either one fails here first. Ages
  are deliberately far from the boundaries — a fixture planted at 9.9s would be
  a clock-skew flake, not a test.
- **The Residual-2 story end to end:** crash → retry lands in the ambiguous band
  → 409, nothing happens → the claim ages past three minutes → next retry
  reclaims and pays. `first=409 second=200 "ok"`, one `order_paid`.
- **Ambiguity resolving the other way:** once the original (slow, not dead)
  claim marks itself finished, the retry that was getting 409 gets a plain
  `already processed` — not a reclaim, not a second dispatch.
- **Reclaim race, proved not assumed:** five simultaneous deliveries against one
  stale claim → exactly one `ok`, four `already processed`, one
  `webhook_claim_reclaimed`, one `order_paid`, one notification, one
  `webhook_events` row with `processedAt` set, order `PAID`. Five and not two,
  because a two-way race can be won by luck.
- **Residual 1 (a hung handler double-dispatched):** the work applied, the claim
  left unfinished and aged out, event redelivered → it genuinely reclaims and
  dispatches a second time, and the conditional updates make it a no-op — same
  `paidAt`, one notification, one `order_paid`, one `webhook_noop`, stock
  unchanged.
- **The expensive double dispatch:** the same thing for
  `payment_intent.payment_failed`, whose handler *releases* stock and the seat.
  A second dispatch would create phantom inventory that oversells at the locker.
  Stock stays 20/20 (not 21) and `booked_count` stays 0 (not negative).
- **The bands are a property of the claim, not the event type:**
  `charge.refunded` against an ambiguous claim is also held at 409 and the order
  is not refunded.
- **409 is unreachable for an unclaimed event id** (a first delivery must never
  enter a retry loop).

**Re-verified explicitly, not assumed unaffected:** the pre-existing
"handles concurrent delivery of the same event" test now also asserts *zero*
409s, exactly two `already processed`, and **zero `webhook_claim_ambiguous` log
lines for that event id**. Genuinely simultaneous duplicates land inside the 10s
trust window; a regression that shortened it would turn Stripe's normal
duplicate delivery into a retry storm, and that would now fail here rather than
pass quietly.

### 50. [backend/manager — LOW, new] Four things the new logic does that are worth knowing

None of these blocks P3. Each has a named test pinning the current behaviour, so
if any of them is judged wrong later, the test is the place to change it.

**(a) `docs/HANDOFF.md` §32 "Residual 2" describes the trust band incorrectly,
and the behaviour it describes would be the safer one.** The resolution text
says "a same-second retry gets 409 and tries again later". It does not: a retry
inside `WEBHOOK_CLAIM_TRUST_MS` is answered `200 "already processed"` — the
`existing.createdAt >= trustBefore` branch, which is exactly the branch that
keeps concurrent duplicate delivery idempotent, so it is not a bug in the code.
`docs/API-CONTRACT.md` documents it correctly; only the HANDOFF prose is wrong.

Why it is worth a line anyway: a 2xx is Stripe's signal that an event was
delivered and it stops retrying that event. So a handler killed at t=0 whose
only retry lands at t < 10s still loses that payment permanently — §32's
original failure, narrowed from "forever" to a ten-second window. Minimal
reproduction (`webhook-claim.test.ts`, "still answers 200 to a retry inside the
trust window, leaving that payment unrecorded"):

```ts
await testDb.webhookEvent.create({                     // what a killed handler leaves
  data: { id: "evt_fast_retry", type: "payment_intent.succeeded",
          createdAt: new Date(Date.now() - 1_000) },
});
const r = await postWebhook(paymentIntentSucceeded(pi, 500, "evt_fast_retry"));
// r.status === 200, r.text === "already processed"
// order stays PENDING, paidAt null, expiresAt still set → the sweep will
// hand the stock back for a payment that was taken.
```

**Severity: low.** Stripe's first retry is minutes away, not seconds, so
reaching this needs a duplicate delivery or a dashboard resend landing in the
same ten seconds as a crash. Fixing it properly is not a smaller trust window
(that breaks concurrent delivery) but distinguishing "another request is alive"
from "a row exists" — a liveness signal rather than a timestamp, which is a
design decision, not a test change. **Recommend: correct the §32 prose either
way, so nobody later reads the doc and believes this window is closed.**

**(b) The bands trust an unvalidated timestamp, so clock skew re-opens §32 for
the duration of the skew.** A claim stamped in the future is inside every
window forever: it can never age into the ambiguous band, let alone the reclaim
band. Test: "trusts a claim timestamped in the future, so clock skew re-opens
the crash window" — a claim five minutes ahead is answered `already processed`
and never reclaimed. Not reproducible on a single host except by planting the
row, which is what the test does. **Severity: low/informational**, and it is a
deployment property (instance clocks, and `created_at`'s `DEFAULT
CURRENT_TIMESTAMP` vs the app-generated `new Date()` a reclaim writes) rather
than a defect. Worth knowing before anyone widens the reliance on these
timestamps in P4.

**(c) `CANCELLED`/`EXPIRED` → `REFUNDED` erases the fact that stock was already
returned — a P4 hazard, not a bug.** The widened match means a declined order
that already released its stock and seat gets overwritten with `REFUNDED`, and
nothing in the row records that the release happened. The rule staff are given
is "a refund does not restock; adjust inventory by hand" — applied to this row,
by hand, it restocks a second time and oversells. Test: "overwrites an
already-released CANCELLED order with REFUNDED, stock still released"
(`status=REFUNDED stock=20/20 (already released by the decline)`).
**For P4:** the admin refund screen needs to distinguish "refunded, stock still
held" (the `PENDING`/`PAID` path) from "refunded, stock already returned" (the
`CANCELLED`/`EXPIRED` path) before it tells anyone to adjust inventory.

**(d) The per-mailbox lock queue, measured — §46's prediction is real but far
out of reach.** Single mailbox, all-cash, full transactions (1c items so nothing
short-circuits on the cap):

| Concurrent, one mailbox | Result |
|---|---|
| 40 | 40 × 200, 1.0 s |
| 80 | 80 × 200, 1.4 s |
| 150 | 150 × 200, 2.4 s |
| 500 | 500 × 200, 7.6 s |
| **800** | **711 × 200, 89 × 500 (11.1 %), 13.1 s** |

The books were exact at every level (`committed` equal to `accepted`, seats
equal to orders). So serialising a mailbox costs ~16 ms per queued checkout and
the degradation is the same `maxWait`/`timeout` → bare `INTERNAL` 500 as item
36, arriving at a similar concurrency (800) despite the added serialisation —
availability, not correctness, and roughly 800× one student's plausible burst.
The committed regression test is pinned at 60, well clear of the ceiling; the
800-way probe is not committed, for the same reason item 36 gives.

### 51. [manager] One harness fix, in qa-owned code

`tests/setup/server.ts` now probes the port before spawning. A run that is
killed rather than finished (a `| head` closing the pipe, a cancelled CI job,
^C) never reaches `stopServer`, and the detached `next dev` survives holding
3111; the next run then spawned a server that died instantly with `EADDRINUSE` and
sat out the full ready-timeout before reporting anything useful. It now fails in
two seconds with the `pkill` command to run. This cost real time during this
pass. No product code involved.

### 52. [qa] Tried and found nothing — stated plainly so "green" means something

- **Spend cap vs. the webhook path.** The advisory lock is taken only by
  `POST /api/checkout`, so a `payment_intent.succeeded` committing a `PAID`
  order for the same mailbox is not serialised against an in-flight cash
  checkout. Chased, and it is not a new hole: it is item 39's accepted design
  (PENDING is excluded from the aggregate, so paid card holds already exceed the
  cap without any race — the existing test "does not count PENDING card orders,
  so four 1400c holds can all be paid" asserts 5600c paid against a 1500c cap).
  No test was added, because a race that can only be observed by timing would be
  a flake, and the deterministic version of the same statement is already there.
- **Advisory-lock hash collisions.** `hashtextextended` is 64-bit; two colliding
  mailboxes would serialise against each other but the cap itself is checked by
  `email` equality, so a collision costs latency and never money. Not tested.
- **Reclaim losers taking the 409 path.** Whichever way a loser's read
  interleaves (before or after the winner bumps `createdAt`), it answers 200 —
  observed 5/5 across repeated runs. The assertion permits 200 or 409 so that a
  legitimate interleaving cannot flake the suite; the printed line records what
  actually happened.
- **Flakiness.** `tests/concurrency` + `tests/api` run three consecutive times:
  106/106 each time. The two timing-shaped new tests (lock scope, 60-way queue)
  were run repeatedly on their own as well.
- **Not covered, unchanged from item 44:** no E2E, no bundle secret grep, no
  real Stripe account, no multi-instance deployment. The sweep's behaviour under
  two *processes* (as opposed to two concurrent requests) is still untested.

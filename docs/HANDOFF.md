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

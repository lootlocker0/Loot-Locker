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

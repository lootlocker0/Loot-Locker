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

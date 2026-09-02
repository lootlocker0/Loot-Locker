# LootLockers — Design System (P0 extraction)

Source: `design/stitch-export/` (Path C manual export — Stitch MCP could not
authenticate this session; see `.mcp.json`/`CLAUDE.md` §3 for the retry path).
Six screens + one token/style-guide export:

| Export folder | Screen name in Stitch | What it actually shows | Maps to route |
|---|---|---|---|
| `loot_drop_home` | Loot Drop — Home | Landing page, daily drop strip, "deployment protocol" steps | `/` |
| `loot_drop_the_locker` | The Locker | Product grid with rarity filters | `/snacks` |
| `loot_drop_loadout` | Loadout Review | Cart: line items, qty stepper, voucher, order totals | `/cart` |
| `loot_drop_extraction_point` | Extraction Point | **Checkout form**: student info, pickup-window picker, payment method, progress tracker, order summary | `/checkout` |
| `loot_drop_mission_briefing` | Mission Briefing | Marketing/about page: mission statement, "core objectives", stats, footer | `/about` |
| `loot_drop_victory_royale` | Victory Royale | Order confirmation: pickup bay, QR/locker code, receipt actions | `/order/[orderNumber]` |
| `battle_royale_loot_drop` | — | Token/style-guide export (YAML frontmatter + prose), not a screen | — |

**Correction to the brief that handed me this task:** it described
`loot_drop_mission_briefing` as the checkout screen and
`loot_drop_extraction_point` as "pickup/slot screen." Having read both
`code.html` files, that's backwards — `mission_briefing` has no form fields at
all (it's an about/marketing page: hero, mission copy, three feature cards,
a stats bar, a footer), and `extraction_point` is the actual checkout: squad
info fields, a pickup-window chip picker, a payment-method chooser with a
mocked Stripe card-entry panel, a sticky order-summary aside, and a 3-node
progress tracker (LOADOUT → PICKUP → VICTORY). The table above reflects what's
actually in the files, and lines up cleanly with `BUILDPLAN.md`'s P2/P3 route
list (`/`, `/snacks`, `/about`, `/cart`, then `/checkout` and
`/order/[orderNumber]`). Flagging this because whoever dispatches P2/P3 should
know the export filenames don't mean what the phase briefs assumed.

---

## Reconciliation notes — read this before changing a token

`battle_royale_loot_drop/DESIGN.md`'s YAML frontmatter (`colors:`,
`typography:`, `spacing:`) is reproduced **verbatim, byte-for-byte identical**
inside the inline `tailwind.config` `<script>` block of all six screens. That
part of the export is fully self-consistent — there is one real token set, not
six divergent ones.

The one place the export contradicts itself is the frontmatter's/prose's
**"Colors" narrative paragraph**, which names `Epic Purple (#A855F7)` and
`Legendary Gold (#F5C518)` as the rarity accents. Those two hex codes do not
appear anywhere in the frontmatter `colors:` block or in any screen's actual
rendered token set — every screen instead uses `primary-container: #b76dff`
for Epic-tier styling and `secondary: #ffd65b` for gold/legendary. `#A855F7`
and `#F5C518` are, not coincidentally, the *exact* values CLAUDE.md §4 hands
to backend for `lib/rarity.ts`. My read: the prose paragraph is quoting the
canonical system spec, and the M3-generated `primary/secondary/tertiary`
swatches baked into each screen are Stitch's theme-builder scaffolding, not a
second deliberate rarity spec — `the_locker` even has to bolt on a separate
`rarity-common/uncommon/rare/epic/legendary` Tailwind config extension on top
of the generic M3 roles to make rarity styling semantic at all, which is a
tell that the M3 palette was never the "real" rarity token set.

**Decision:** rarity tokens use the canonical CLAUDE.md/prose hexes
(`#9BA0A8` / `#38D64B` / `#1B7FE8` / `#A855F7` / `#F5C518`), not the
M3-generated swatches. This is also the pragmatic choice: backend's P1
`lib/rarity.ts` is handed to them in CLAUDE.md §4 as ready-to-use code with
these exact values, and `RarityCard`'s border/glow are driven by an inline
style pulled from that lookup (not from a Tailwind class), so picking anything
else here guarantees a visible mismatch the first time backend lands P1. If
the manager disagrees, the fix is a one-line hex swap in five places in
`app/globals.css` — flag it and I'll redo it, don't silently patch around it
downstream.

Everything else (surfaces, fonts, type scale, spacing, clip-path geometry) is
taken directly from the consistent, non-contradictory part of the export.

---

## Colors

### Surfaces (Level 0–5, from the export's M3 surface ladder)

| Token | Hex | Export role | Used for |
|---|---|---|---|
| `--color-void` | `#07070F` | `background` (screen-level override) | Page canvas |
| `--color-surface` | `#13131B` | `surface` | Nav/footer chrome |
| `--color-surface-2` | `#1B1B24` | `surface-container-low` | Idle card background |
| `--color-surface-3` | `#1F1F28` | `surface-container` | Section bg, card hover state |
| `--color-surface-4` | `#292932` | `surface-container-high` | Elevated chrome, active nav pill |
| `--color-surface-5` | `#34343E` | `surface-container-highest` | Brightest chrome (credits pill bg) |
| `--color-surface-lowest` | `#0D0D16` | `surface-container-lowest` | Inset panels (hero banners, summary asides) |

### Brand accent (non-rarity UI color)

| Token | Hex | Used for |
|---|---|---|
| `--color-brand` | `#DDB7FF` | Nav logo, active link state, borders, focus glow, hero heading |
| `--color-brand-container` | `#B76DFF` | Hover/active accents on brand-colored chrome |
| `--color-gold` | `#F5C518` | Primary CTAs, price highlights, dividers, section rules |

### Rarity tiers (canonical — see Reconciliation notes above)

| Token | Hex | Glow (rgba, matches CLAUDE.md `lib/rarity.ts`) |
|---|---|---|
| `--color-rarity-common` | `#9BA0A8` | `rgba(155,160,168,.35)` |
| `--color-rarity-uncommon` | `#38D64B` | `rgba(56,214,75,.40)` |
| `--color-rarity-rare` | `#1B7FE8` | `rgba(27,127,232,.45)` |
| `--color-rarity-epic` | `#A855F7` | `rgba(168,85,247,.50)` |
| `--color-rarity-legendary` | `#F5C518` | `rgba(245,197,24,.55)` |

### Text

| Token | Hex | Export role | Notes |
|---|---|---|---|
| `--color-text` | `#E4E1EE` | `on-surface` / `on-background` | Primary reading text |
| `--color-text-dim` | `#CFC2D6` | `on-surface-variant` | Secondary copy, descriptions |
| `--color-text-faint` | `#988D9F` | `outline` | Meta/timestamp text only |
| `--color-danger` | `#FF4D4D` | not in export; added per CLAUDE.md invariant #8 (allergen UI is safety-critical and not optional) | Allergen badges, error text |

**Never use `outline-variant` (`#4D4354`) as a text color.** It only appears
in the export as a *border* color; when Stitch's own generated markup used it
for text (see contrast audit below) it failed AA outright.

---

## Typography

Fonts, from the export's own `typography:` block — **not** the
`Bungee`/`Inter` pairing in the illustrative `@theme` example in the frontend
agent spec, which does not match what Stitch actually generated:

```
--font-display: "Bebas Neue", system-ui, sans-serif;   /* headlines, hero, display numerals */
--font-body:    "Archivo Narrow", system-ui, sans-serif; /* body copy */
--font-mono:    "JetBrains Mono", ui-monospace, monospace; /* labels, prices, timers, technical data */
```

`next/font/google` should load these in `app/layout.tsx` (a file I don't
own — flagging so whoever touches it next wires this up instead of the raw
Google Fonts `<link>` tags the export uses).

### Type scale (rem, converted from the export's px values)

| Token | Value | Source (px / line-height / weight) |
|---|---|---|
| `--text-display` | `clamp(2.5rem, 2rem + 3vw, 4.5rem)` | `display-xl`: 72px/72px/700 desktop, 32–40px mobile |
| `--text-headline-lg` | `clamp(2rem, 1.75rem + 1.5vw, 3rem)` | `headline-lg`: 48px/48px/700 desktop, `headline-lg-mobile` 32px/32px/700 |
| `--text-headline-md` | `1.5rem` | `headline-md`: 24px/28px/700 |
| `--text-body-lg` | `1.125rem` | `body-lg`: 18px/24px/700 |
| `--text-body-md` | `1rem` | `body-md`: 16px/22px/600 |
| `--text-label-sm` | `0.75rem` | `label-sm`: 12px/16px/700, always `--font-mono` |

Headlines are always rendered uppercase in the export (`text-transform`
applied at the component level, not baked into the token) — primitives that
use `--text-headline-*` add `uppercase` explicitly rather than assuming it.

---

## Spacing

From the export's frontmatter `spacing:` block, unchanged:

| Token | Value | Source |
|---|---|---|
| `--spacing-unit` | `0.25rem` (4px) | atomic spacing unit |
| `--spacing-gutter` | `1rem` (16px) | grid gutter |
| `--spacing-margin-mobile` | `1rem` (16px) | mobile page margin |
| `--spacing-margin-desktop` | `2rem` (32px) | desktop page margin |

---

## Radii

The export's prose is explicit: *"The shape language is strictly Sharp (0).
There are no rounded corners in this design system."* In practice a handful of
circular/pill chrome elements break that rule (the credits counter pill, the
victory-screen rank badge circle, the QR-code container's `rounded-lg`), so
the token set keeps two values rather than pretending radius doesn't exist:

```
--radius-none: 0px;   /* default — cards/buttons use clip-path, not radius */
--radius-pill: 9999px; /* credits counter, avatar/badge circles */
```

Everything else gets its angled look from `clip-path`, not `border-radius`.

---

## Shadows / glow

```
--shadow-glow-common:    0 0 22px -6px rgba(155,160,168,.35);
--shadow-glow-uncommon:  0 0 22px -6px rgba(56,214,75,.40);
--shadow-glow-rare:      0 0 22px -6px rgba(27,127,232,.45);
--shadow-glow-epic:      0 0 22px -6px rgba(168,85,247,.50);
--shadow-glow-legendary: 0 0 22px -6px rgba(245,197,24,.55);
--shadow-panel:          0 20px 50px -12px rgba(0,0,0,.6); /* aside/summary-card elevation, from Loadout's sticky panel */
```

Rarity glows always pair with the equivalent solid border color — the export
never uses a glow alone to signal tier, and neither should we (glow is
`aria-hidden`, the rarity label text is not).

---

## Shard geometry — clip-path catalog

Every angled edge across all six screens reduces to one of nine polygons.
Landed as utility classes in `app/globals.css`:

| Utility | Polygon | Where it's used in the export |
|---|---|---|
| `.clip-shard` | `polygon(10% 0%, 100% 0%, 90% 100%, 0% 100%)` | Wide CTAs ("ENTER THE LOCKER", "PROCEED TO EXTRACTION", "CONFIRM PICKUP") |
| `.clip-shard-tight` | `polygon(5% 0%, 100% 0%, 95% 100%, 0% 100%)` | Chips, manifest/cart line rows, rarity filter pills |
| `.clip-panel` | `polygon(0% 0%, 95% 0%, 100% 5%, 100% 100%, 5% 100%, 0% 95%)` | Checkout accordion sections, payment-method cards, zone-status strip |
| `.clip-panel-reverse` | `polygon(0% 0%, 96% 0%, 100% 100%, 4% 100%)` | Loadout's sticky order-summary aside (bevel cut the opposite direction) |
| `.clip-card` | `polygon(0 0, 92% 0, 100% 8%, 100% 100%, 8% 100%, 0 92%)` | Victory Royale summary card (all four corners nicked) |
| `.clip-corner-badge` | `polygon(100% 0, 0 0, 100% 100%)` | Triangular tier/level badge, top-right corner of product cards |
| `.clip-header` | `polygon(0% 0%, 100% 0%, 100% 90%, 50% 100%, 0% 90%)` | Sticky top nav (chevron notch at bottom center) |
| `.clip-bottom-nav` | `polygon(5% 0%, 95% 0%, 100% 100%, 0% 100%)` | Mobile bottom tab bar |
| `.clip-hero` | `polygon(0% 0%, 100% 0%, 100% 85%, 0% 100%)` | Diagonal hero-banner bottom edge (Mission Briefing) |
| `.clip-hex` | `polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)` | Hexagon icon frames ("Deployment Protocol" steps, checkout section-number chips, progress-tracker nodes) |

`AngledPanel` (see Primitives) exposes `shard`, `shard-tight`, `panel`,
`panel-reverse`, `card`, `hero` as its `variant` prop, mapped 1:1 to the table
above (`clip-corner-badge`, `clip-header`, `clip-bottom-nav`, `clip-hex` are
used directly inside `RarityCard`/`ProgressTracker`/future nav components
rather than exposed generically, since they're single-purpose shapes).

---

## Per-screen notes

### Home (`/`)
- Hero: centered stack, outline-stroke display headline + "SEASON 01" corner
  tag (`clip-shard`, rotated) + subhead + gold `clip-shard` CTA.
- "Today's Drop" strip: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`, gap
  `--spacing-gutter`. Each card = rarity-bordered `clip-panel` (`RarityCard`
  shape), triangular level badge (`clip-corner-badge`) top-right.
  Rarity-glow box-shadow matches the card's tier.
  **Note:** the mock data here uses real branded snacks (Doritos, Gatorade,
  Lay's, Kool-Aid) with invented RPG stat lines ("+50 Focus / 30m") — see IP
  section below, this needs a product/legal decision, not a silent fix.
- "Deployment Protocol" 3-step row: `clip-hex` icon frames, numbered badge,
  connector line on desktop (`hidden md:block`), stacks on mobile.
- Sticky header uses `clip-header`; mobile bottom nav uses `clip-bottom-nav`.

### The Locker (`/snacks`)
- Rarity filter row (desktop only in export — needs a mobile treatment,
  currently absent from the mockup): five pills, one per rarity, `bg-rarity-*/20`
  with matching border.
- Product grid: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`,
  gap `--spacing-gutter`. Card = `RarityCard`: `clip-panel`-shaped border in
  the item's rarity color, `clip-corner-badge` triangle (level, becomes
  something else once we're not scoring RPG levels — likely omitted or
  repurposed as a stock/rarity indicator), rarity chip, image
  (`object-contain`, gradient-tinted background), name, price, "ADD TO
  LOCKER" `clip-shard` button.
- Sold-out treatment isn't shown in this export at all — `RarityCard` here
  adds a disabled state + "Sold out" label per CLAUDE.md's "disabled not
  hidden" rule, since the mockup doesn't cover it.

### Loadout / cart (`/cart`)
- Two-column desktop (`lg:grid-cols-3`: 2 cols items + 1 sticky aside),
  stacks on mobile.
- Line item row: `clip-shard-tight` bevel, `border-l-4` in rarity color,
  thumbnail (`clip-shard-tight` mini-frame), hexagon qty stepper buttons
  (`clip-hex`), price in gold mono.
- Order summary aside: `clip-panel-reverse`, `surface-lowest` bg, voucher
  input, subtotal/tax/total breakdown, full-width `clip-shard` gold CTA.
- **Currency-naming inconsistency in the mock copy:** this screen labels the
  totals "LU" / "Luken Credits", while Home/The Locker use "CR" / "credits"
  for what's presumably the same in-app unit. Not an IP issue — just needs
  the two names to converge before this ships; flagging so it isn't copied
  verbatim into two different components.

### Checkout (`/checkout`, export folder `loot_drop_extraction_point`)
- `ProgressTracker` at the top: 3 nodes (complete / active / pending),
  connector line, `clip-hex` node shape. Export labels: LOADOUT (complete) →
  PICKUP (active) → VICTORY (pending). The third label is generic enough to
  keep as-is (see IP note — "victory" alone isn't the trademarked phrase,
  "Victory Royale" together is), but I'd lean toward "CONFIRMED" or "DONE" to
  fully sever any association; not a hard requirement.
- Form: `<details>`-based accordion, three sections (`clip-panel`,
  `border-l-4` in a distinct accent color per section), each with a
  `clip-hex` numbered chip. Section 1 = contact/pickup-note fields, Section 2
  = pickup-window chips (`SlotPicker`; export shows one slot pre-selected and
  one disabled "(FULL)" chip at reduced opacity — exactly the "disabled, not
  hidden" pattern CLAUDE.md requires), Section 3 = payment method radio
  cards + a **mocked** Stripe card-entry panel.
- Order summary: sticky `clip-panel` aside, item rows, subtotal/tax/total,
  full-width gold `clip-shard` CTA, small-print disclaimer line.
- **Do not port the payment-method mock literally.** It hardcodes four
  options (Cash / Card / Apple Pay / Google Pay) with static Visa/Mastercard
  `<img>` placeholders sourced from Stitch's asset CDN — see IP section.
  CLAUDE.md's actual checkout is Card + Cash only (P3, still open per
  `BUILDPLAN.md`'s "Still open, and it blocks P3" section) — build against
  whatever `API-CONTRACT.md` publishes when that's decided, not this mock.

### About (`/about`, export folder `loot_drop_mission_briefing`)
- Marketing page: `clip-hero` banner, two-column mission split panel, 3-card
  bento ("Core Objectives" — fast extraction / allergy intel / school
  approved), stats bar (outline-stroke numerals), footer with link columns.
- This is the one screen with no cart/checkout/rarity UI at all — lowest
  priority for the primitive set, highest priority for plain accessible
  semantic HTML (headings, landmarks) since it's almost entirely static copy.

### Order confirmation (`/order/[orderNumber]`, export folder `loot_drop_victory_royale`)
- Centered single-column card stack, confetti/particle background
  (`prefers-reduced-motion` must disable this — see Rules).
- Badge circle (rank/medal icon) → headline → subhead → match-ID chip →
  `clip-card` summary panel (pickup bay number, lock status, QR code) →
  two `clip-shard` action buttons ("home" / "email receipt").
- **Headline and page `<title>` say "VICTORY ROYALE" — this is the P0 IP
  blocker, see below.** Everything else on this screen (rank badge, "Match
  ID", QR code, bay/lock status) is generic and fine to keep.
- This screen must be built to poll `/api/orders/[orderNumber]` per the
  frontend agent spec's confirmation-polling rule, not to assume success from
  a redirect — the export is a static mock and shows no loading/pending
  state, so that state needs to be designed fresh, not lifted from here.

---

## WCAG AA contrast audit

Computed against the real hex pairs the export renders (sRGB relative
luminance, standard WCAG formula — script used for this audit is not part of
the repo, values below are the output). AA thresholds: 4.5:1 for normal text,
3:1 for large text (≥24px regular or ≥18.66px bold).

### Confirmed failures in the export

| Pair | Where | Ratio | Verdict |
|---|---|---|---|
| `outline-variant` (`#4D4354`) text on `background` (`#07070F`) | Home screen, "DEPLOYMENT PROTOCOL" eyebrow label (`text-outline-variant`, 12px) | **2.15:1** | FAIL (needs 4.5:1) |
| `outline-variant` (`#4D4354`) placeholder text on `surface` (`#13131B`) | Loadout voucher-code input placeholder | **1.98:1** | FAIL |

Both come from the same root cause: the export's Tailwind config defines
`outline-variant` as a *border* color, and two components mistakenly used it
as a *text* color instead of `outline` (`#988D9F`, which passes at 5.85–6.35:1
in the same spots). **Fix landed:** `--color-text-faint` in
`app/globals.css` maps to `#988D9F` (the passing value), not `#4D4354` — any
primitive using `text-text-faint` is safe by construction. Nothing in
`components/ui/` uses the failing value; this is here so nobody reintroduces
it by pattern-matching the raw export.

### Borderline — passes on paper, too fragile to rely on

| Pair | Where | Ratio | Note |
|---|---|---|---|
| `on-primary-container` (`#400071`) on `primary-container` (`#b76dff`) | Home/Locker "EPIC" tier corner badges, 10px mono | 4.56:1 | Clears 4.5 by a hair at a size (10px) nowhere near the "large text" exemption. Recommend solid black text instead, matching every other rarity badge (legendary/rare/uncommon/common all use black-on-color and score 6.6–15:1). |
| Canonical epic purple (`#A855F7`) as *regular-weight* text directly on elevated panels (`#1F1F28` / `#292932`) | Not present verbatim in the export, but a real risk if this color is reused for body/label text rather than borders/large headlines | 3.6–4.1:1 | Fails normal-text AA, only legal at large/bold sizes. `RarityCard`'s `group-hover:text-rarity-epic`-style pattern is fine because it's applied to `headline-md` (24px/700 = large text, 3:1 threshold), but this color must never be used for a price, a label, or body copy directly on a mid-tone surface. |
| White/off-white button text (`#E4E1EE`) on an Epic-purple button background (`#A855F7`) | Would occur if `ShardButton`'s `epic` intent used the same light text as its other intents | **3.07:1** | Fails normal AA; button labels aren't reliably "large text" at `sm`/`md` sizes. **Fixed in the primitive:** `ShardButton`'s `epic` variant uses `text-void` (near-black) instead, matching `gold`'s pattern — `#07070F` on `#A855F7` measures 5.07:1, a clean pass. This is exactly the "purple on near-black often fails at small sizes" case flagged in the frontend agent spec, just inverted (light-on-purple rather than purple-on-dark) — found and fixed while building the button, not shipped and left for QA to catch. |

### Decorative outline/stroke text — flag regardless of ratio math

Home's hero headline (`.hero-outline-text`) and Victory Royale's headline
(`.victory-outline`) both render as a 2px stroke with a **transparent fill**
(`-webkit-text-stroke`, no `color`). Standard contrast-ratio math doesn't
really apply to a glyph with no fill, and that's exactly the problem: at
small sizes or with any zoom/scaling, thin unfilled strokes disappear for
low-vision users well before a solid-fill equivalent would. Recommend never
shipping stroke-only text in production — use a solid fill plus the existing
drop-shadow/glow for the same visual effect, reserved for hero-scale headings
only (never body or label text).

### Things that pass comfortably (spot-checked, not exhaustive)

`--color-text` / `--color-text-dim` / `--color-text-faint` on `void` and all
five surface levels; `--color-gold` and `--color-rarity-legendary` on `void`
and every surface level (12–15:1, this palette's best performer by a wide
margin); all four rarity badge combinations that use solid black text
(6.6–15:1); `--color-brand` on `void` (11.75:1); `--color-danger` on `void`
(6.14:1).

---

## Third-party IP

### Must replace before launch

1. **"VICTORY ROYALE"** — `design/stitch-export/loot_drop_victory_royale/code.html`
   uses this as both the page `<title>` (`LOOPLOCKERS | VICTORY ROYALE`) and
   the confirmation screen's h1. This is Fortnite's (Epic Games) trademarked
   win-screen phrase, not generic gaming vocabulary — it's a specific,
   widely-recognized two-word phrase tied to one franchise, unlike genre-level
   terms ("loot drop", "battle royale", "extraction point", "shard", "season")
   which are fine per the brief's own guidance and are used throughout this
   export without issue. **Suggested replacement:** "ORDER SECURED" or
   "EXTRACTION COMPLETE" — both fit the existing extraction/locker vocabulary
   already used elsewhere in this same screen (pickup "bay", "LOCKED" status,
   "drop point") and sidestep the trademark entirely. I did not build this
   screen's component yet (P0 is primitives only), so nothing in the repo
   currently contains the phrase — flagging so whoever builds `/order/[id]`
   in a later phase doesn't lift it from the export folder.

   **Status: still open, not resolved.** The manager proposed "To Victory
   Royal" as the replacement copy. That doesn't actually clear the trademark
   concern — it's the same two distinctive words in the same order with one
   letter dropped and a word prepended, which is exactly the kind of minimal
   edit that courts and brand-enforcement teams read as the same phrase for
   trademark purposes (the legal test is overall commercial impression, not
   character-for-character match). It also still reads, to a player who
   recognizes the reference, as the exact same wink at Fortnite the original
   text was. If the goal is genuinely severing the association per CLAUDE.md
   invariant #7, this doesn't do it — "ORDER SECURED" / "EXTRACTION COMPLETE"
   (or something else built from LootLockers' own vocabulary) still stands
   as the actual fix. Whoever builds this screen should get an explicit
   final call from the manager before writing either string into a
   component.

2. **Stripe/Visa/Mastercard logo images in the checkout mock** —
   `loot_drop_extraction_point/code.html`'s payment-method reveal panel
   embeds `<img alt="Visa">` / `<img alt="Mastercard">` raster images pulled
   from Stitch's own asset CDN (`lh3.googleusercontent.com/aida-public/...`),
   plus a "Powered by stripe" wordmark rendered as plain styled text. These
   are not the real, licensed brand assets and must never be copied into the
   repo as static files (this is also just a restatement of the general "do
   not paste the export" rule, but worth calling out specifically since it's
   the one place the export embeds actual third-party logos rather than
   just words). Once Stripe Elements is wired up for real (P3), Stripe's own
   `PaymentElement` renders the correct, currently-licensed card-brand icons
   itself — we should never source or host those logos ourselves.

### Needs a product/legal decision — flagging, not deciding

3. **Real branded snack products used as example catalog content.** Home's
   "Today's Drop" strip uses actual trademarked product names — Doritos Nacho
   Cheese, Gatorade Glacier Freeze, Lay's Classic, Kool-Aid Jammers — each
   with invented RPG "stat" flavor text bolted directly onto the brand name
   ("+50 Focus / 30m", "+100 Energy / Inst.", assigned a fictional rarity
   tier like "LEGENDARY" or "EPIC"). Two different things are tangled
   together here and they carry different risk:
   - Naming a real product accurately when you're literally reselling it
     (a school tuck shop calling a bag of Doritos "Doritos") is ordinary,
     legal nominative use — no different from a grocery store's shelf label
     or menu board. If the catalog is genuinely going to stock real branded
     snacks, keeping their real names is *correct*, not a violation, and
     scrubbing them to generic names would actually make the allergen/safety
     copy less accurate.
   - Attaching invented gamified stats and a "rarity tier" directly to a
     specific real trademark is a different, additional risk — it can read
     as implying a sponsorship or endorsement relationship with that brand
     that hasn't been granted, independent of whether the product itself is
     real. This is the part that concerns me, not the product names
     themselves.

   **Status: (a) resolved by the manager — yes, the real catalog stocks real
   branded products, physically sourced (a Costco Doritos variety multibox,
   Kool-Aid packets in specific colors, plus an assorted chip lineup).
   (b) still open** — the manager hasn't ruled on whether invented
   RPG stat copy ("+50 Focus") stays attached to these specific real
   products or gets reserved for store-created bundles only. Real seed data
   for (a) is landing in `prisma/seed.ts` (P1) using factual descriptions —
   name, price, allergens — with no invented stat text, which is the
   conservative reading of (b) until the manager says otherwise:
   - **Doritos** (Costco 30-count variety multibox — [Frito-Lay Classic
     Mix / Doritos Mix Variety Pack](https://www.costco.com/p/-/frito-lay-classic-mix-variety-pack-30-count/100383609)):
     Nacho Cheese, Cool Ranch, Flamin' Hot Nacho, Spicy Nacho, Spicy Sweet
     Chili.
   - **Kool-Aid**, one flavor per requested color: Grape (purple), Cherry
     (red), Blue Raspberry Lemonade (blue) — current, actively-sold
     unsweetened drink-mix packet flavors, not a discontinued/novelty flavor
     picked for the color alone.
   - **Chips (assortment, unspecified brand mix):** Lay's Classic, Cheetos
     Crunchy, Ruffles Original — a plain generic-but-real assortment
     alongside the Doritos lineup, factual naming only, same treatment as
     above.

   CLAUDE.md invariant #7 ("No third-party IP in copy, assets, or product
   names") is about invented copy wrapped around a trademark, not about
   naming what's actually on the shelf — nominative use for products
   genuinely being resold stays fine under that reading.

### Reviewed and fine — generic genre vocabulary, not a specific trademark

"Loot drop", "battle royale" (as a used-across-many-games genre descriptor,
not the Fortnite phrase specifically), "extraction point", "shard",
"Season 01"/"season" (standard across Fortnite, Apex, Valorant, Overwatch,
etc. — not exclusive to one), "RANK #1", "Match ID", generic Material
Symbols icon names (`workspace_premium`, `military_tech`, `school`, etc. —
Apache-licensed, and not being embedded as a font dependency anyway; see
below), "Deployment Protocol", "Squad Info", "Manifest Summary". All fine to
keep as-is.

### Own-brand naming defect (not third-party IP, but worth a line)

Every screen spells the product "LOOPLOCKERS" (with a P) in page titles, nav
logo, footer copyright, and the sample email placeholder
(`operator@looplockers.net`) — this is the app's own name, just consistently
misspelled by Stitch relative to "LootLockers." Not an IP issue, just needs
correcting wherever real copy gets written.

### Dependency note

The export loads Google Fonts and Material Symbols via `<link>`/CDN
`<script>` tags, and the Material Symbols icon set for every icon glyph.
Primitives built for P0 do not embed any of that — `ProgressTracker`'s check
icon is an inline SVG, and no component currently depends on an icon font.
Fonts (Bebas Neue / Archivo Narrow / JetBrains Mono) are open, SIL-licensed
Google Fonts and are fine to self-host via `next/font/google` in
`app/layout.tsx` (which I don't own — noted above under Typography).

---

## Tokens landed

`app/globals.css` — full `@theme` block (surfaces, brand, rarity, text, danger,
fonts, type scale, spacing, radii, shadows/glows) plus the ten `clip-*`
utility classes, `:focus-visible` styling (gold outline, never the rarity
glow), and a `prefers-reduced-motion` block disabling all animation/transition
duration. `grep -rE "#[0-9a-fA-F]{6}" components/ui` returns only
`rarity.ts` — the one file whose entire job *is* to be the literal
hex/glow lookup table (mirroring `app/globals.css`'s rarity tokens and the
future `lib/rarity.ts`), consumed by `RarityCard`/`AngledPanel` as inline
style values rather than Tailwind classes, exactly as CLAUDE.md's own
`lib/rarity.ts` example does it. No component reaches for a raw hex outside
that one lookup table — every other color goes through a token, per
`BUILDPLAN.md`'s design-drift check.

## Primitives landed — `components/ui/`

- **`ShardButton.tsx`** — `gold` / `epic` / `ghost` intents × `sm`/`md`/`lg`
  sizes, `clip-shard` bevel, real `<button>`, `aria-busy` while loading.
  `epic` intent uses `text-void` (not light text) — see contrast audit.
- **`RarityCard.tsx`** — `clip-panel` card, rarity border + glow (glow is
  `aria-hidden`), `clip-corner-badge` tier triangle, allergen list (never
  truncated, `aria-label="Contains allergens"`, empty state states
  "No listed allergens" rather than showing nothing), sold-out state disables
  rather than hides the add button, low-stock nudge at ≤5 units.
- **`SlotPicker.tsx`** — `fieldset`/`legend`/`radiogroup`, real radio inputs
  (`sr-only`, not `display:none`, so they stay in the accessibility tree),
  full slots render disabled with "— Full" text rather than disappearing,
  `clip-shard-tight` chip shape matching the checkout export.
- **`AngledPanel.tsx`** *(new — not in the frontend agent spec's worked
  examples, built from the shard/panel/elevation language in the export)* —
  generic angled container: `variant` picks one of six clip-path shapes,
  `tone` picks a surface level, `border` takes `"brand" | "gold" | "none"` or
  a literal `{ hex }` for rarity-colored panels, `glow` toggles the matching
  outer shadow. Backs the checkout accordion sections, sticky summary asides,
  the zone-status strip, and the confirmation summary card without those
  screens needing bespoke one-off components.
- **`ProgressTracker.tsx`** *(new, same rationale)* — horizontal step list
  generalized from the checkout screen's LOADOUT/PICKUP/VICTORY node row.
  `complete` / `active` / `pending` status is conveyed by color **and** icon
  **and** a screen-reader-only status word per step (never color alone),
  `aria-current="step"` on the active node, connector line width driven by
  completed-step fraction.
- **`cn.ts`** — local `clsx` + `tailwind-merge` wrapper. Frontend doesn't own
  `lib/**`, so this lives in `components/ui/` instead of `lib/cn.ts`.
- **`rarity.ts`** — temporary local rarity lookup (hex/glow/label per tier),
  scoped to `components/ui/`, because backend's canonical `lib/rarity.ts`
  (CLAUDE.md §4) doesn't exist until P1. Hexes are copied verbatim from the
  same source so swapping the import later is a no-op — see the TODO comment
  in the file. Also defines a placeholder `Allergen` union (backend's
  `prisma/schema.prisma` is the real source of truth once P1 lands).

All five primitives type-check (`tsc --noEmit`), lint clean (`eslint`), and
render in a production `next build` with a temporary smoke page exercising
every prop combination (page removed after verifying — not part of this
commit).

## Not done in P0 (by design — spec says primitives only)

No pages, no routes, no cart store, no API calls. `app/page.tsx` is still the
`create-next-app` default. That's P2 (`BUILDPLAN.md`) — this pass is tokens
and primitives only, per the frontend agent spec's "land the tokens... and
build the primitives. Nothing else."

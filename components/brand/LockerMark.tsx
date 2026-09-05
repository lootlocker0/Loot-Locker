import { RARITY } from "@/lib/rarity";

/**
 * LootLockers' own mark — geometric, mascot-free, built entirely from
 * design tokens already in the app (gold CTA color, the rarity ramp, the
 * `.clip-hex`/`.clip-shard`/`.clip-panel` angle language from
 * docs/DESIGN.md's "Shard geometry" catalog). No photographic or
 * illustrated character, no third-party asset — see docs/HANDOFF.md for
 * why that's a hard requirement here, not a style preference.
 *
 * Every solid fill/stroke below is a Tailwind `fill-*`/`stroke-*` utility
 * (backed by the same `@theme` tokens as the rest of the app) rather than a
 * literal hex, so this file passes the same
 * `grep -rE "#[0-9a-fA-F]{6}" components/` drift check as every other
 * primitive. The one place a real hex value is read is the rarity-ramp
 * gradient below, and even that comes from `lib/rarity.ts`'s `RARITY`
 * lookup, not a literal string typed into this file.
 *
 * Three directions, one component (`variant` prop) so they can be compared
 * side by side just by changing a prop, rather than living in three
 * one-off files:
 *
 * - `monogram` — a bold angular "L" built from two beveled shard bars
 *   (the same slant as `.clip-shard`). Reads cleanly at 16-32px, which is
 *   the actual constraint a favicon has to survive — this is the default
 *   for `app/icon.svg`.
 * - `shield`   — the monogram centered inside a `.clip-hex`-style hexagon
 *   frame with a thin five-color rarity-ramp ring and a legendary-gold
 *   outer glow (the exact `boxShadow` pattern `RarityCard`/`AngledPanel`
 *   already use). Reads as "secured/trusted", which is the right register
 *   for a page that is about to take payment details. Default for the
 *   landing hero.
 * - `locker`   — the most literal option: a beveled door panel (the
 *   `.clip-panel` two-corner nick) with vent slits and a small gold
 *   latch/keyhole notch. Most on-the-nose brand tie-in, best at larger
 *   sizes (hero, marketing), not recommended below ~64px.
 *
 * Pure SVG, no external requests, no icon font. `title` gives it an
 * accessible name when it's the meaningful content (e.g. a future nav
 * wordmark); omit it for the common case of a decorative hero graphic,
 * which sets `aria-hidden` instead so it never becomes a screen-reader
 * pause with nothing to say.
 */
export function LockerMark({
  variant = "monogram",
  size = 32,
  title,
  className,
  glow = false,
}: {
  variant?: "monogram" | "shield" | "locker";
  size?: number;
  title?: string;
  className?: string;
  glow?: boolean;
}) {
  const a11yProps = title
    ? { role: "img" as const, "aria-label": title }
    : { "aria-hidden": true as const };

  const gradientId = "lm-rarity-ramp";
  const rarityStops = [
    RARITY.COMMON.hex,
    RARITY.UNCOMMON.hex,
    RARITY.RARE.hex,
    RARITY.EPIC.hex,
    RARITY.LEGENDARY.hex,
  ];

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      style={glow ? { filter: `drop-shadow(0 0 10px ${RARITY.LEGENDARY.glow})` } : undefined}
      {...a11yProps}
    >
      <defs>
        {/* The only place this component reads a raw hex — and it's the
            imported RARITY lookup, not a literal typed into this file (see
            docs/DESIGN.md / lib/rarity.ts, the sanctioned single source for
            these five values). <linearGradient><stop> has no Tailwind
            utility equivalent. */}
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
          {rarityStops.map((hex, i) => (
            <stop key={hex} offset={`${(i / (rarityStops.length - 1)) * 100}%`} stopColor={hex} />
          ))}
        </linearGradient>
      </defs>

      {variant === "monogram" && <Monogram />}

      {variant === "shield" && (
        <>
          {/* .clip-hex, scaled to the full viewBox */}
          <polygon
            points="25,4 75,4 96,50 75,96 25,96 4,50"
            className="fill-void"
            stroke={`url(#${gradientId})`}
            strokeWidth={3}
          />
          <g transform="translate(18 12) scale(0.64)">
            <Monogram />
          </g>
        </>
      )}

      {variant === "locker" && <LockerDoor gradientId={gradientId} />}
    </svg>
  );
}

/** Two beveled bars sharing a corner — the slant matches `.clip-shard`'s
 * `polygon(10% 0%, 100% 0%, 90% 100%, 0% 100%)` applied vertically. */
function Monogram() {
  return (
    <path className="fill-gold" d="M26 8L44 8L36 80L18 80Z M18 80L88 80L80 94L10 94Z" />
  );
}

function LockerDoor({ gradientId }: { gradientId: string }) {
  return (
    <>
      {/* .clip-panel: two corners nicked, scaled onto an (8,6)-(92,94) door */}
      <polygon
        points="8,6 87.8,6 92,10.4 92,94 12.2,94 8,89.6"
        className="fill-surface-2 stroke-brand-container"
        strokeWidth={3}
      />
      {/* nameplate stripe */}
      <rect x={16} y={14} width={68} height={8} fill={`url(#${gradientId})`} />
      {/* vent slits */}
      <rect x={22} y={34} width={6} height={38} className="fill-brand" opacity={0.5} />
      <rect x={38} y={34} width={6} height={38} className="fill-brand" opacity={0.5} />
      <rect x={54} y={34} width={6} height={38} className="fill-brand" opacity={0.5} />
      {/* latch */}
      <rect x={70} y={40} width={14} height={14} className="fill-gold" />
    </>
  );
}

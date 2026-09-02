import type { ElementType, HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

/**
 * Generic angled/shard container. Every non-card angled surface in the
 * export - checkout accordion sections, sticky order-summary asides, the
 * zone-status strip, hero banners, the confirmation summary card - reduces
 * to one of the clip-path polygons below plus a surface tone and an
 * optional rarity/brand border+glow. See docs/DESIGN.md "Shard geometry".
 */

const VARIANT_CLIP = {
  shard: "clip-shard",
  "shard-tight": "clip-shard-tight",
  panel: "clip-panel",
  "panel-reverse": "clip-panel-reverse",
  card: "clip-card",
  hero: "clip-hero",
} as const;

const TONE_BG = {
  1: "bg-surface",
  2: "bg-surface-2",
  3: "bg-surface-3",
  4: "bg-surface-4",
  lowest: "bg-surface-lowest",
} as const;

type Variant = keyof typeof VARIANT_CLIP;
type Tone = keyof typeof TONE_BG;
type BorderTone = "brand" | "gold" | "none";

type Props = {
  as?: "div" | "section" | "aside" | "article";
  variant?: Variant;
  tone?: Tone;
  /** Fixed brand/gold border, or a literal rarity hex (e.g. from rarityMeta().hex). */
  border?: BorderTone | { hex: string };
  /** Outer glow. Only meaningful when `border` is set to something other than "none". */
  glow?: boolean;
  className?: string;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "className" | "children">;

export function AngledPanel({
  as = "div",
  variant = "panel",
  tone = 3,
  border = "none",
  glow = false,
  className,
  children,
  ...rest
}: Props) {
  const Comp = as as ElementType;
  const isCustomBorder = typeof border === "object";

  const borderClass = !isCustomBorder
    ? {
        brand: "border-2 border-brand/50",
        gold: "border-2 border-gold/50",
        none: "",
      }[border]
    : "";

  const style = isCustomBorder
    ? {
        borderWidth: 2,
        borderStyle: "solid" as const,
        borderColor: border.hex,
        boxShadow: glow ? `0 0 22px -6px ${border.hex}` : undefined,
      }
    : undefined;

  return (
    <Comp
      className={cn(
        VARIANT_CLIP[variant],
        TONE_BG[tone],
        "relative p-6",
        borderClass,
        !isCustomBorder && glow && border !== "none" ? "shadow-panel" : "",
        className,
      )}
      style={style}
      {...rest}
    >
      {children}
    </Comp>
  );
}

---
name: Battle Royale Loot Drop
colors:
  surface: '#13131b'
  surface-dim: '#13131b'
  surface-bright: '#393842'
  surface-container-lowest: '#0d0d16'
  surface-container-low: '#1b1b24'
  surface-container: '#1f1f28'
  surface-container-high: '#292932'
  surface-container-highest: '#34343e'
  on-surface: '#e4e1ee'
  on-surface-variant: '#cfc2d6'
  inverse-surface: '#e4e1ee'
  inverse-on-surface: '#302f39'
  outline: '#988d9f'
  outline-variant: '#4d4354'
  surface-tint: '#ddb7ff'
  primary: '#ddb7ff'
  on-primary: '#490080'
  primary-container: '#b76dff'
  on-primary-container: '#400071'
  inverse-primary: '#842bd2'
  secondary: '#ffd65b'
  on-secondary: '#3d2f00'
  secondary-container: '#e7b900'
  on-secondary-container: '#5f4a00'
  tertiary: '#a7c8ff'
  on-tertiary: '#003061'
  tertiary-container: '#3a91fb'
  on-tertiary-container: '#002a55'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#f0dbff'
  primary-fixed-dim: '#ddb7ff'
  on-primary-fixed: '#2c0051'
  on-primary-fixed-variant: '#6900b3'
  secondary-fixed: '#ffe08b'
  secondary-fixed-dim: '#f0c110'
  on-secondary-fixed: '#241a00'
  on-secondary-fixed-variant: '#584400'
  tertiary-fixed: '#d5e3ff'
  tertiary-fixed-dim: '#a7c8ff'
  on-tertiary-fixed: '#001b3c'
  on-tertiary-fixed-variant: '#004689'
  background: '#13131b'
  on-background: '#e4e1ee'
  surface-variant: '#34343e'
typography:
  display-xl:
    fontFamily: Bebas Neue
    fontSize: 72px
    fontWeight: '700'
    lineHeight: 72px
    letterSpacing: 0.05em
  headline-lg:
    fontFamily: Bebas Neue
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 48px
  headline-lg-mobile:
    fontFamily: Bebas Neue
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 32px
  headline-md:
    fontFamily: Bebas Neue
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 28px
  body-lg:
    fontFamily: Archivo Narrow
    fontSize: 18px
    fontWeight: '700'
    lineHeight: 24px
  body-md:
    fontFamily: Archivo Narrow
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 22px
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '700'
    lineHeight: 16px
spacing:
  unit: 4px
  gutter: 16px
  margin-mobile: 16px
  margin-desktop: 32px
  shard-angle: 15deg
---

## Brand & Style
The design system captures the high-stakes adrenaline of a battle royale loot drop. The aesthetic is a fusion of **Tactile/Skeuomorphic** gaming HUDs and **High-Contrast** arcade visuals. It evokes a sense of urgency, rarity, and digital physicality. 

The UI relies on "shard" geometry—diagonal cuts, slanted containers, and beveled edges—to mimic armored plating and futuristic tech interfaces. Visuals are glossy and high-octane, utilizing intense outer glows and hard shadows to create a layered, "floating" interface that feels like an advanced tactical overlay.

## Colors
The palette is rooted in a "Near-Black" deep navy base to provide maximum contrast for the vibrant energy colors. 

- **Backgrounds:** Use `#07070F` for the primary canvas. Layer with semi-transparent `#1B7FE8` overlays at 5-10% opacity for tactical paneling.
- **Accents:** Epic Purple (`#A855F7`) is the primary driver for high-value interactions. Legendary Gold (`#F5C518`) is reserved for headers, rewards, and critical highlights.
- **Rarity Tiering:** This system uses a strict color hierarchy for itemization. All item cards, glows, and border strokes must strictly adhere to the defined Rarity hex codes to signify value instantly.

## Typography
Headlines utilize **Bebas Neue** for an impactful, condensed, and authoritative look. To achieve the "Arcade HUD" feel, all display and headline text must be rendered in uppercase. Apply a 2px dark navy outline and a 4px hard (0% blur) drop shadow at a 135-degree angle to headlines to ensure legibility against complex backgrounds.

Body text uses **Archivo Narrow** for its high density and clarity, maintaining the condensed aesthetic while ensuring long-form readability. Labels and technical data (like ammunition counts or item stats) use **JetBrains Mono** to reinforce the technical, "scanned" nature of the UI.

## Layout & Spacing
The layout follows a **Fluid Grid** model but is defined by diagonal cuts and shard-like divisions. While the underlying structure is a 12-column grid, visual containers should utilize a `15-degree` slant on their vertical edges to maintain the "Battle Royale" theme.

Spacing is tight and dense (multiples of 4px), reflecting the data-heavy nature of a gaming dashboard. Use large horizontal margins on desktop to center the "Locker" or "Inventory" focus, while mobile transitions to a stacked vertical "Shard" view where each item occupies a slanted horizontal row.

## Elevation & Depth
Depth is achieved through **Tonal Layers** and high-intensity **Outer Glows** rather than realistic shadows.

- **Level 0 (Background):** Deepest Navy (#07070F).
- **Level 1 (Panels):** Semi-transparent Cyan/Blue shards with 20% opacity.
- **Level 2 (Active Elements):** Opaque containers with 2px solid borders in the Rarity color.
- **Level 3 (Focus/Hover):** Intense 15px outer glow matching the element's Rarity color, combined with a 1px white inner "shine" on the top edge to create a beveled glass effect.

## Shapes
The shape language is strictly **Sharp (0)**. There are no rounded corners in this design system. Every corner is a precise 90-degree angle or an acute/obtuse angle resulting from diagonal "shard" cuts. This reinforces the aggressive, metallic, and digital nature of the interface. Use `clip-path` heavily to create parallelograms and irregular polygons for buttons and badges.

## Components

### Buttons
Buttons are wide, beveled parallelograms. They use a `clip-path: polygon(10% 0%, 100% 0%, 90% 100%, 0% 100%)` to create slanted edges. The default state is a solid Epic Purple with a glossy top-down gradient. On hover, the button should trigger a white "scanning" light sweep animation across its surface.

### Loot Cards
Cards are angled panels with a 2px border corresponding to the item's Rarity. The background of the card is a dark gradient (`#07070F` to a darker shade of the Rarity color). The card's top-right corner should be "clipped" to display a small triangular badge containing the item's level or tier.

### Rarity Chips
Small rectangular tags used to label items. They feature a solid background of the Rarity color with black `JetBrains Mono` text for maximum contrast.

### Input Fields
Strictly rectangular with a 1px Cyan border. When focused, the border glows Electric Blue and the background shifts from transparent to 10% Cyan.

### Health/Shield Bars
Segmented bars using slanted rectangles. The "Health" bar uses a bright green-to-yellow gradient, while "Shield" uses the Cyan-to-Electric Blue gradient. Each segment is separated by a 2px gap of the background color.
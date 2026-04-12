# Design System Inspired by PlayStation

## 1. Visual Theme & Atmosphere

PlayStation's website is built on a three-surface channel architecture: near-black hero sections (#0c0c0c) that immerse players in cinematic worlds, pure white editorial sections for community content and news, and deep cobalt blue footer zones (#003c71) that anchor the brand identity. This surface triptych creates clear visual zones — darkness for product immersion, lightness for editorial content, blue for brand permanence.

The typography system uses SST at weight 300 for display headlines — an unusually light touch for tech brands that favor bold. The result is what might be called "silent authority" — confident without shouting. Headlines from 22px to 54px use this light weight with tight 1.10–1.20 line-heights, creating dense, editorial text blocks that feel premium.

**Key Characteristics:**
- Three-surface channel layout: near-black hero, white editorial, cobalt blue footer
- SST weight 300 for large display headlines — "silent authority" aesthetic
- PlayStation Blue (#0070cc) as brand anchor, Cyan (#1eaedb) for hover states only
- 1.2× scale transform on all interactive hovers — "power-on" signature animation
- Commerce Orange (#d53b00) reserved exclusively for Buy CTA
- Generous spacing between sections, minimal use of shadows

## 2. Color Palette & Roles

### Primary Brand
- **PlayStation Blue** (`#0070cc`): Brand anchor, footer backgrounds, key UI elements
- **Absolute Black** (`#0c0c0c`): Hero backgrounds, cinematic product zones
- **Pure White** (`#ffffff`): Editorial sections, primary surface

### Interactive
- **Cyan Accent** (`#1eaedb`): Hover states only — never visible in default state
- **Commerce Orange** (`#d53b00`): Buy buttons only — conversion-focused accent

### Neutral Scale
- **Charcoal** (`#1f1f1f`): Secondary dark text, dark surface elevation
- **Warm Gray** (`#707070`): Secondary text, descriptions
- **Light Gray** (`#f2f2f2`): Subtle surface tints, borders

## 3. Typography Rules

### Font Family
- **Display**: `SST`, fallback: `sans-serif` — proprietary PlayStation font
- **Body**: `SST` — same font family, different weights

### Hierarchy
| Role | Size | Weight | Line Height | Notes |
|------|------|--------|-------------|-------|
| Display Hero | 54px | 300 | 1.10 | Light weight for silent authority |
| Section Heading | 36px | 300 | 1.10 | Consistent light treatment |
| Card Title | 22px | 300 | 1.20 | Dense editorial blocks |
| Body | 16px | 400 | 1.50 | Standard reading |
| Button | 14px | 500 | 1.00 | Semibold for actions |

### Principles
- **Weight 300 for display**: Unusually light for tech — creates premium, confident feel
- **Tight line-heights**: 1.10–1.20 for headlines creates dense text blocks
- **No uppercase transformation**: Headlines stay sentence case

## 4. Component Stylings

### Buttons
**Primary Blue**
- Background: `#0070cc`
- Hover: fill shifts to Cyan (`#1eaedb`) + white border + blue outer ring + scale(1.2)
- Full hover signature: cyan fill, white 2px border, blue 3px ring, 1.2× scale

**Commerce Orange**
- Background: `#d53b00`
- Text: white
- Hover: opacity reduction or similar multi-layer effect

**Ghost**
- Background: transparent
- Border: 1px solid white (on dark) or blue (on light)

### Cards
- Background: white or near-black depending on section
- Border-radius: 8px
- Minimal shadow elevation

## 5. Layout Principles

### Spacing System
- Base unit: 8px
- Generous section padding (80px+ vertical)

### Border Radius Scale
- Standard: 8px (cards, containers)
- Large: 12px (feature sections)

## 6. Depth & Elevation

**Shadow Philosophy**: Minimal shadows — depth comes from surface color contrast (black/white/blue triptych) rather than traditional elevation.

### Decorative Depth
- Hover signature: Multi-layer effect combining fill, border, ring, and scale transform

## 7. Do's and Don'ts

### Do
- Use SST weight 300 for all display headlines
- Apply 1.2× scale transform on interactive hovers
- Reserve Commerce Orange exclusively for Buy CTAs
- Use Cyan only in hover states — never default

### Don't
- Don't use bold weights for headlines — weight 300 is the identity
- Don't apply Cyan to static elements
- Don't add heavy shadow elevation

## 8. Responsive Behavior

### Breakpoints
| Name | Width |
|------|-------|
| Mobile | <768px |
| Tablet | 768–1024px |
| Desktop | 1024–1920px |
- 4K TV optimization for living room browsing

# Design System Inspired by Renault

## 1. Visual Theme & Atmosphere

Renault's website is a vibrant digital showroom that balances French automotive elegance with bold, forward-leaning energy — a departure from the monochromatic austerity of German or Italian luxury brands. The page opens with a full-screen hero that washes the viewport in a sweeping aurora gradient — ribbons of magenta, violet, and teal bleeding across the frame behind a dramatically lit vehicle. This chromatic expressiveness is the site's signature: while the interface structure is disciplined (NouvelR typography, black-and-white CTA framework, zero-radius buttons), the content is alive with color — gradient washes on hero slides, saturated vehicle photography, and splashes of Renault Yellow (`#EFDF00`) on accent CTAs. The effect is a showroom that feels energized rather than hushed.

The layout follows a card-based editorial rhythm. Below the hero carousel, content is organized into a grid of PromoCards — each a full-bleed photographic panel with a dark gradient overlay at top (fading from `rgba(0,0,0,0.6)` to transparent) to ensure white heading text remains legible over vivid imagery. These cards alternate between light and dark modes: white editorial panels with black text sit beside black `is-alternative-mode` sections with white text, creating a chessboard-like visual cadence.

**Key Characteristics:**
- Full-screen hero carousel with vivid aurora gradient backgrounds (magenta/violet/teal) behind vehicle imagery
- NouvelR proprietary typeface with 28-degree "radical r" cut matching the diamond logo geometry
- Renault Yellow (`#EFDF00`) as the super-primary accent — used sparingly for highest-priority CTAs
- Zero border-radius on all buttons — sharp rectangular forms expressing precision engineering
- Card-based editorial grid with full-bleed photography and dark gradient overlays
- Binary black/white CTA system: primary (black bg/white text) and ghost (transparent/white border)
- PromoCard dark-mode alternation creating a chessboard rhythm between light and dark sections

## 2. Color Palette & Roles

### Primary
- **Renault Yellow** (`#EFDF00`): The brand's signature Pantone — a vivid, saturated yellow used for super-primary CTAs and the highest-priority action buttons.
- **Absolute Black** (`#000000`): Primary button background, heading text on light surfaces, and the dominant dark section surface.
- **Pure White** (`#FFFFFF`): Primary surface for editorial content, inverted button backgrounds, hero text color.

### Secondary & Accent
- **Soft Yellow** (`#F8EB4C`): Lighter, warmer variant of Renault Yellow — used for hover/pressed states on yellow CTAs.
- **Renault Blue** (`#1883FD`): Link hover color across all link variants — a bright, confident blue that signals interactivity.
- **Warm Gray** (`#D9D9D6`): Subtle warm neutral used for disabled states, inactive UI elements.

### Surface & Background
- **Pure White** (`#FFFFFF`): Page background, light editorial sections, navigation bar.
- **Absolute Black** (`#000000`): Hero backgrounds, PromoCard dark-mode sections (`is-alternative-mode`), E-Tech showcase areas.
- **Charcoal** (`#222222`): Secondary dark surface for text-heavy dark sections.

### Neutrals & Text
- **Absolute Black** (`#000000`): Primary heading and body text on light surfaces.
- **Pure White** (`#FFFFFF`): Primary text on dark surfaces — hero headlines, dark-section headings.

### Semantic & Accent
- **Success Green** (`#8DC572`): Positive status indicators.
- **Error Rose** (`#BE6464`): Form validation errors.
- **Warning Amber** (`#F0AD4E`): Cautionary alerts.

### Gradient System
- **Hero Aurora**: Sweeping multi-color gradients (magenta → violet → teal) applied to hero slide backgrounds.
- **PromoCard Overlay**: `linear-gradient(rgba(0,0,0,0.6) 0%, rgba(0,0,0,0) 40%)` — applied to card tops for heading text legibility.

## 3. Typography Rules

### Font Family
- **NouvelR**: The sole typeface. A proprietary geometric sans-serif designed by Black[Foundry] for Renault's 2021+ rebrand. Features a distinctive "radical r" with a 28-degree terminal cut matching the diamond logo angle.

### Hierarchy

| Role | Size | Weight | Line Height | Notes |
|------|------|--------|-------------|-------|
| Hero Title | 56px | 700 | 0.95 | NouvelR, white on dark hero |
| Section Heading | 40px | 700 | 0.95 | PromoCard headings |
| Card Heading | 32px | 700 | 0.95 | Medium-scale card headings |
| Subheading | 24px | 700 | 0.95 | Section sub-titles |
| Body Text | 14px | 400 | 1.40 | Paragraph and descriptive content |
| Button Label | 14.4px | 700 | 1.00 | Primary button text |
| Nav Link | 13px | 700 | 1.50 | Navigation and footer links |
| Caption | 12.8px | 400 | 1.10 | Small descriptive text |

### Principles
- **Single-family discipline**: NouvelR handles everything from 56px hero headlines to 8.5px legal captions.
- **Bold-default headings**: Weight 700 dominates the heading hierarchy.
- **Ultra-tight display line-heights**: 0.95 line-height on hero and section headings — the lines nearly collide.

## 4. Component Stylings

### Buttons

**Super Primary (Yellow)** — The highest-emphasis CTA:
- Default: bg `#EFDF00`, text `#000000`, borderRadius 0px, padding 10px 15px
- fontSize 16px (NouvelR), fontWeight 700, minHeight 46px
- Used for: Primary conversion actions

**Primary (Black)** — The default action button:
- Default: bg `#000000`, text `#FFFFFF`, borderRadius 0px
- Inverted: bg `#FFFFFF`, text `#000000`

**Ghost** — Transparent outline button:
- Default (on dark): bg transparent, text `#FFFFFF`, border 1px solid `#FFFFFF`
- Default (on light): bg transparent, text `#000000`, border 1px solid `#000000`

**Text Link** — Inline navigation:
- Default: text `#000000` or `#FFFFFF`
- Hover: color shifts to `#1883FD` (Renault Blue)

### Cards & Containers

**PromoCard (Light)** — Editorial content card:
- Background: white
- Full-bleed photography with gradient overlay
- Border-radius: 0px

**PromoCard (Dark)** — Cinematic card:
- Background: `#000000` (Absolute Black)
- CTA buttons: inverted primary (white bg) or ghost (white border)

### Navigation
- Renault diamond logo centered/left
- Links: NouvelR, 13px, weight 700, black text
- Hover: color shifts to `#1883FD`
- CTA in nav: Primary black button

## 5. Layout Principles

### Spacing System
- Base unit: 8px
- Scale: 1px, 4px, 5px, 6px, 8px, 10px, 12px, 13px, 15px, 16px, 20px, 24px, 32px, 40px
- Button padding: 10px 15px — consistent across all variants

### Border Radius Scale
| Value | Context |
|-------|---------|
| 0px | All buttons, PromoCards — the zero-radius default |
| 4px | Labels, tags |
| 46px | Pill-shaped search input |

## 6. Depth & Elevation

| Level | Treatment | Use |
|-------|-----------|-----|
| Flat | No shadow | Default for PromoCards, buttons |
| Soft | `rgba(0,0,0,0.2) 0px 4px 8px` | Card hover states |
- Rich shadow system with seven distinct levels for layered, dimensional interfaces.

## 7. Do's and Don'ts

### Do
- Use Renault Yellow (`#EFDF00`) exclusively for super-primary CTAs
- Maintain zero border-radius on all buttons
- Use NouvelR Bold (700) as the default heading weight
- Apply the dark gradient overlay on PromoCards for text legibility

### Don't
- Apply Renault Yellow as a background color for sections
- Add border-radius to buttons
- Use any typeface besides NouvelR

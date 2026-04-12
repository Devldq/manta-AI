# Design System Inspired by Expo

## 1. Visual Theme & Atmosphere

Expo's interface is a luminous, confidence-radiating developer platform built on the premise that tools for building apps should feel as polished as the apps themselves. The entire experience lives on a bright, airy canvas — a cool-tinted off-white (`#f0f0f3`) that gives the page a subtle technological coolness.

The design language is decisively monochromatic — pure black (`#000000`) headlines against the lightest possible backgrounds. Color is almost entirely absent from the interface itself; when it appears, it's reserved for product screenshots.

**Key Characteristics:**
- Luminous cool-white canvas (`#f0f0f3`) with gallery-like vertical spacing
- Strictly monochromatic: pure black headlines, cool blue-gray body text
- Pill-shaped geometry everywhere — buttons, tabs, containers, images (24px–9999px radius)
- Massive display headlines (64px) with extreme negative letter-spacing (-1.6px to -3px)
- Inter as the sole typeface, weights 400–900
- Whisper-soft shadows that barely lift elements from the surface
- Product screenshots as the only source of color

## 2. Color Palette & Roles

### Primary
- **Expo Black** (`#000000`): Primary headlines, CTA buttons, brand identity
- **Near Black** (`#1c2024`): Primary body text — softer than pure #000

### Secondary & Accent
- **Link Cobalt** (`#0d74ce`): Standard link color
- **Widget Sky** (`#47c2ff`): Widget branding elements
- **Preview Purple** (`#8145b5`): Beta feature indicators

### Surface & Background
- **Cloud Gray** (`#f0f0f3`): Primary page background — cool off-white
- **Pure White** (`#ffffff`): Card surfaces, button backgrounds
- **Widget Dark** (`#1a1a1a`): Dark surface for widgets

### Neutrals & Text
- **Slate Gray** (`#60646c`): Secondary text color
- **Silver** (`#b0b4ba`): Tertiary text, placeholders
- **Border Lavender** (`#e0e1e6`): Standard card borders
- **Input Border** (`#d9d9e0`): Button and form borders

## 3. Typography Rules

### Font Family
- **Primary**: `Inter`, fallbacks: `-apple-system, system-ui`
- **Monospace**: `JetBrains Mono`

### Hierarchy
| Role | Size | Weight | Line Height | Letter Spacing |
|------|------|--------|-------------|----------------|
| Display Hero | 64px | 700–900 | 1.10 | -1.6px to -3px |
| Section Heading | 48px | 600 | 1.10 | -2px |
| Sub-heading | 20px | 600 | 1.20 | -0.25px |
| Body Large | 18px | 400–500 | 1.40 | normal |
| Body | 16px | 400–700 | 1.25–1.40 | normal |
| Caption | 14px | 400–600 | 1.00–1.40 | normal |

### Principles
- **One typeface, full expression**: Inter handles everything from 400 (regular) through 900 (black)
- **Extreme negative tracking at scale**: Headlines at 64px use -1.6px to -3px letter-spacing
- **Weight as hierarchy**: 700–900 for display, 600 for headings, 400 for body
- **Consistent 1.40 body line-height**: Creates rhythmic vertical consistency

## 4. Component Stylings

### Buttons
**Primary Pill**
- Background: Expo Black (`#000000`)
- Text: Pure White (`#ffffff`)
- Radius: 9999px
- Padding: 10px

**White/Outlined**
- Background: Pure White (`#ffffff`)
- Border: `1px solid #d9d9e0`
- Radius: 6px (standard) or 9999px (pill)

### Cards
- Background: Pure White (`#ffffff`)
- Border: `1px solid #e0e1e6`
- Radius: 8px (standard), 16–24px (featured)
- Shadow Level 1: Whisper — barely perceptible lift
- Shadow Level 2: Standard — clear floating elevation

### Navigation
- Sticky top nav on transparent/blurred background
- Logo: Expo wordmark in black
- Links: Near Black or Slate Gray at 14–16px Inter weight 500
- CTA: Black pill button on the right

## 5. Layout Principles

### Spacing System
- Base unit: 8px
- Section padding: Enormous (96–144px vertical)

### Border Radius Scale
- 6px: Buttons, form inputs
- 8px: Standard content cards
- 16px: Feature tabs, panels
- 24px: Video/image containers
- 32–36px: Hero CTAs, status badges
- 9999px: Primary action buttons, tags, avatars

### Whitespace Philosophy
- **Gallery-like pacing**: Each section feels like its own exhibit
- **Content islands**: Sections float as isolated "islands" in white space
- **Breathing room IS the design**: Generous whitespace is the primary design element

## 6. Depth & Elevation

| Level | Treatment | Use |
|-------|-----------|-----|
| Flat | No shadow | Cloud Gray page background |
- Surface | White bg, no shadow | Standard white cards
- Whisper | `rgba(0,0,0,0.08) 0px 3px 6px + rgba(0,0,0,0.07) 0px 2px 4px` | Subtle card lift
- Elevated | `rgba(0,0,0,0.1) 0px 10px 20px + rgba(0,0,0,0.05) 0px 3px 6px` | Feature showcases

**Shadow Philosophy**: Shadows as gentle whispers rather than architectural statements. Primary depth via background color contrast.

## 7. Do's and Don'ts

### Do
- Use Cloud Gray (`#f0f0f3`) as page background and Pure White (`#ffffff`) for elevated cards
- Keep display headlines at extreme negative letter-spacing (-1.6px to -3px)
- Use pill-shaped (9999px) radius for primary CTA buttons
- Reserve black (`#000000`) for headlines and primary CTAs
- Use Slate Gray (`#60646c`) for secondary text
- Maintain enormous vertical spacing between sections (96px+)
- Use product screenshots as primary visual content

### Don't
- Don't introduce decorative colors into the interface chrome
- Don't use sharp corners on interactive elements
- Don't reduce section spacing below 64px
- Don't use heavy drop shadows — depth from background contrast
- Don't mix in additional typefaces — Inter handles everything

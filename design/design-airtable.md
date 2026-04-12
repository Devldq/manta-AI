# Design System Inspired by Airtable

## 1. Visual Theme & Atmosphere

Airtable's website is a clean, enterprise-friendly platform that communicates "sophisticated simplicity" through a white canvas with deep navy text (#181d26) and Airtable Blue (#1b61c9) as the primary interactive accent. The Haas font family (display + text variants) creates a Swiss-precision typography system with positive letter-spacing throughout.

What makes Airtable distinctive is its blue-tinted shadow system. Instead of neutral gray shadows, Airtable uses multi-layer shadows tinted with the brand blue: `rgba(45,127,249,0.28) 0px 1px 3px`. This creates a subtle color glow around elevated elements that reinforces brand identity even in structural depth. Combined with the `--theme_*` semantic token naming convention (e.g., `--theme-barBackgroundColor`), Airtable demonstrates a mature design system with comprehensive state management.

**Key Characteristics:**
- Pure white canvas with deep navy text (#181d26)
- Airtable Blue (#1b61c9) as primary CTA and link color
- Haas + Haas Groot Disp dual font system
- Positive letter-spacing on body text (0.08px–0.28px)
- 12px radius buttons, 16px–32px for cards
- Multi-layer blue-tinted shadow: `rgba(45,127,249,0.28) 0px 1px 3px`
- Semantic theme tokens: `--theme_*` CSS variable naming
- Comprehensive state colors: success (#229f59), warning (#f7a501), danger (#cf1e41)

## 2. Color Palette & Roles

### Primary Brand
- **Airtable Blue** (`#1b61c9`): Primary CTA, links, interactive elements
- **Deep Navy** (`#181d26`): Primary text, dark backgrounds
- **White** (`#ffffff`): Page canvas, card surfaces

### Semantic
- **Success Green** (`#229f59`): Positive states, availability
- **Warning Amber** (`#f7a501`): Caution states
- **Danger Red** (`#cf1e41`): Error states, destructive actions

### Neutral Scale
- **Dark Charcoal** (`#2b2b2b`): Secondary text
- **Medium Gray** (`#787878`): Tertiary text, muted content
- **Light Gray** (`#e0e0e0`): Borders, dividers
- **Silver** (`#f5f5f5`): Surface tints, hover backgrounds

### Shadows
- **Blue Shadow** (`rgba(45,127,249,0.28) 0px 1px 3px`): Primary elevation — blue-tinted
- **Card Shadow** (`rgba(45,127,249,0.2) 0px 2px 8px`): Elevated cards

## 3. Typography Rules

### Font Families
- **Display**: `Haas Groot Disp Web`, fallback: `BlinkMacSystemFont, sans-serif`
- **Body / UI**: `Haas`, fallbacks: `ui-sans-serif, system-ui, -apple-system`

### Hierarchy
| Role | Font | Size | Weight | Line Height | Letter Spacing |
|------|------|------|--------|-------------|----------------|
| Display Hero | Haas Groot Disp | 56px | 500 | 1.10 | -0.28px |
| Section Heading | Haas | 40px | 500 | 1.15 | 0.28px |
| Sub-heading | Haas | 24px | 500 | 1.25 | 0.18px |
| Body | Haas | 16px | 400 | 1.50 | 0.08px |
| Caption | Haas | 14px | 400 | 1.43 | normal |
| Button | Haas | 14px | 500 | 1.43 | normal |

### Principles
- **Positive tracking on body**: Unlike most tech sites, Airtable uses positive letter-spacing (0.08px–0.28px) for more airy, readable text
- **Swiss precision**: The Haas font family provides clean, geometric letterforms
- **Weight 500 as UI default**: Semibold for navigation and buttons
- **Blue-tinted shadows**: Structural depth carries brand color

## 4. Component Stylings

### Buttons
**Primary Blue**
- Background: `#1b61c9`
- Text: `#ffffff`
- Padding: 8px 16px
- Radius: 12px
- Shadow: blue-tinted elevation
- Hover: background darkens slightly

**Secondary**
- Background: `#f5f5f5`
- Text: `#181d26`
- Radius: 12px

**Outlined**
- Background: transparent
- Border: `1px solid #2d7ff9`
- Text: `#1b61c9`

### Cards
- Background: `#ffffff`
- Shadow: `rgba(45,127,249,0.2) 0px 2px 8px`
- Radius: 16px–32px
- Blue-tinted elevation glow

### Inputs
- Background: `#ffffff`
- Border: `1px solid #e0e0e0`
- Radius: 8px
- Focus: blue border, shadow

### Navigation
- Clean white header
- Haas 14px weight 500 for nav links
- Blue CTA right-aligned

## 5. Layout Principles

### Spacing System
- Base unit: 8px
- Scale: 4px, 8px, 12px, 16px, 20px, 24px, 32px, 40px, 48px

### Border Radius Scale
- Input (8px): Form inputs
- Button (12px): All buttons
- Card (16px): Standard cards
- Large (24px): Feature cards
- Section (32px): Large containers

## 6. Depth & Elevation

| Level | Treatment | Use |
|-------|-----------|-----|
| Flat | No shadow | Default text, backgrounds |
| Elevated | `rgba(45,127,249,0.28) 0px 1px 3px` | Buttons, interactive elements |
- Card | `rgba(45,127,249,0.2) 0px 2px 8px` | Cards, panels |

**Shadow Philosophy**: Airtable's unique contribution is blue-tinted shadows. Instead of neutral gray shadows, elevation carries a subtle blue glow that reinforces brand identity even in structural elements. This creates cohesive depth that feels premium and considered.

## 7. Do's and Don'ts

### Do
- Use Airtable Blue (#1b61c9) for primary interactive elements
- Apply positive letter-spacing on body text
- Use blue-tinted shadows for elevation
- Keep Haas font family throughout

### Don't
- Don't use neutral gray shadows — all shadows should carry blue tint
- Don't use tight letter-spacing — Airtable uses positive spacing
- Don't mix font families — Haas system only

## 8. Responsive Behavior

### Breakpoints
| Name | Width |
|------|-------|
| Mobile | <640px |
| Tablet | 640–1024px |
| Desktop | >1024px |

### Collapsing Strategy
- Display: 56px → 40px → 28px
- Cards: grid → stacked
- Navigation: full → hamburger

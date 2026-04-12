# Design System Inspired by Mintlify

## 1. Visual Theme & Atmosphere

Mintlify's website is a study in documentation-as-product design — a white, airy, information-rich surface that treats clarity as its highest aesthetic value. The page opens with a luminous white (`#ffffff`) background, near-black (`#0d0d0d`) text, and a signature green brand accent (`#18E299`).

**Key Characteristics:**
- Inter with tight negative tracking at display sizes (-0.8px to -1.28px)
- Geist Mono for code labels: uppercase, 12px, tracked-out
- Brand green (`#18E299`) used sparingly — CTAs, hover states, focus rings
- Atmospheric gradient hero with cloud-like green-white wash
- Ultra-round corners: 16px for containers, full-round (9999px) for buttons

## 2. Color Palette & Roles

### Primary
- **Near Black** (`#0d0d0d`): Primary text
- **Pure White** (`#ffffff`): Page background
- **Brand Green** (`#18E299`): Signature accent for CTAs

### Secondary
- **Brand Green Light** (`#d4fae8`): Badge backgrounds
- **Warm Amber** (`#c37d0d`): Warning states
- **Soft Blue** (`#3772cf`): Tag backgrounds

### Neutral
- **Gray 700** (`#333333`): Secondary text
- **Gray 400** (`#888888`): Placeholder text
- **Gray 200** (`#e5e5e5`): Borders

## 3. Typography Rules

### Font Families
- **Primary**: `Inter` — all content
- **Monospace**: `Geist Mono` — code and technical labels

### Hierarchy
| Role | Size | Weight | Letter Spacing |
|------|------|--------|----------------|
| Display Hero | 64px | 600 | -1.28px |
| Section Heading | 40px | 600 | -0.8px |
| Body | 16px | 400 | normal |
| Label Uppercase | 13px | 500 | 0.65px |

## 4. Component Stylings

### Buttons
**Primary Brand (Full-round)**
- Background: `#0d0d0d`
- Text: `#ffffff`
- Radius: 9999px

**Secondary / Ghost**
- Background: `#ffffff`
- Border: `1px solid rgba(0,0,0,0.08)`

### Cards
- Background: `#ffffff`
- Border: `1px solid rgba(0,0,0,0.05)`
- Radius: 16px
- Shadow: `rgba(0,0,0,0.03) 0px 2px 4px`

## 5. Layout Principles

### Border Radius Scale
- Small (4px): Inline code
- Standard (16px): Cards
- Full Pill (9999px): Buttons, inputs

## 6. Depth & Elevation

- Subtle Border: `1px solid rgba(0,0,0,0.05)`
- Ambient Shadow: `rgba(0,0,0,0.03) 0px 2px 4px`

## 7. Do's and Don'ts

### Do
- Use tight negative tracking on display headlines
- Use full-pill (9999px) radius for CTAs

### Don't
- Don't use heavy shadows — depth through borders

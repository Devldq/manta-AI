# Design System Inspired by Lovable

## 1. Visual Theme & Atmosphere

Lovable's website radiates warmth through restraint. The entire page sits on a creamy, parchment-toned background (#f7f4ed) that immediately separates it from the cold-white conventions of most developer tool sites. This isn't minimalism for minimalism's sake — it's a deliberate choice to feel approachable, almost analog, like a well-crafted notebook. The near-black text (#1c1c1c) against this warm cream creates a contrast ratio that's easy on the eyes while maintaining sharp readability.

The custom Camera Plain Variable typeface is the system's secret weapon. Unlike geometric sans-serifs that signal "tech company," Camera Plain has a humanist warmth — slightly rounded terminals, organic curves, and a comfortable reading rhythm. At display sizes (48px–60px), weight 600 with aggressive negative letter-spacing (-0.9px to -1.5px) compresses headlines into confident, editorial statements. The font uses ui-sans-serif, system-ui as fallbacks, acknowledging that the custom typeface carries the brand personality.

**Key Characteristics:**
- Creamy parchment background (#f7f4ed) — warm, analog feel unlike cold white
- Near-black text (#1c1c1c) with human warmth
- Camera Plain Variable typeface — humanist, slightly rounded
- Negative letter-spacing on display (-0.9px to -1.5px)
- Weight 600 for display headlines
- Minimal border radius: 8px standard, 12px for cards
- No shadows detected — border-forward design
- Coral/orange accent (#f56428) for primary CTAs

## 2. Color Palette & Roles

### Primary
- **Warm Black** (`#1c1c1c`): Primary text, dark button fills, nav text
- **Cream** (`#f7f4ed`): Page background, card surfaces
- **Coral** (`#f56428`): Primary CTA buttons, brand accent

### Interactive
- **Hover Dark** (`#dd5620`): Primary button hover
- **Gray Muted** (`#78787a`): Secondary text, muted descriptions

### Neutral
- **Border** (`#e8e5dc`): Light warm border, structural containment
- **Surface Light** (`#ffffff`): White overlays, modals

## 3. Typography Rules

### Font Family
- **Display / Body**: `Camera Plain Variable`, fallbacks: `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif`
- **Mono**: `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New`

### Hierarchy
| Role | Size | Weight | Line Height | Letter Spacing |
|------|------|--------|-------------|----------------|
| Display Hero | 60px | 600 | 1.00 | -1.5px |
| Section Heading | 48px | 600 | 1.00 | -0.9px |
| Card Title | 30px | 500 | 1.30 | -0.54px |
| Body Large | 20px | 500 | 1.30 | -0.3px |
| Body | 16px | 400 | 1.60 | normal |
| Caption | 14px | 400 | 1.50 | normal |

### Principles
- **Negative tracking for display**: -0.9px to -1.5px compression on headlines creates editorial density
- **Weight 600 as display default**: Medium-bold for confident headlines
- **Weight 500 for UI**: Semibold for navigation and buttons
- **No uppercase transformation**: Headlines stay sentence case

## 4. Component Stylings

### Buttons
**Primary Coral**
- Background: `#f56428`
- Text: `#ffffff`
- Padding: 10px 16px
- Radius: 8px
- Hover: background `#dd5620`

**Secondary Dark**
- Background: `#1c1c1c`
- Text: `#f7f4ed`
- Padding: 10px 16px
- Radius: 8px

**Ghost**
- Background: transparent
- Text: `#1c1c1c`
- Radius: 8px
- Hover: subtle background tint

### Cards
- Background: `#f7f4ed` (inherits page)
- Border: `1px solid #e8e5dc`
- Radius: 12px
- No shadow elevation

### Inputs
- Background: `#ffffff`
- Border: `1px solid #e8e5dc`
- Radius: 8px
- Focus: border darkens

## 5. Layout Principles

### Spacing System
- Base unit: 8px
- Scale: 4px, 8px, 10px, 12px, 16px, 20px, 24px, 30px, 32px, 40px, 48px, 60px, 80px

### Border Radius Scale
- Minimal (8px): Buttons, inputs, tags
- Standard (12px): Cards, containers
- Large (16px–24px): Feature sections

## 6. Depth & Elevation

| Level | Treatment | Use |
|-------|-----------|-----|
| Flat | No shadow | Default — cream canvas |
| Bordered | `1px solid #e8e5dc` | Cards, containers |

**Shadow Philosophy**: No traditional shadows detected. Structure comes from warm-toned borders and the cream-to-white surface distinction.

## 7. Do's and Don'ts

### Do
- Use cream (`#f7f4ed`) as the background — warmth is the identity
- Use Camera Plain with negative tracking on display headlines
- Keep border radius minimal (8px–12px)
- Use coral (`#f56428`) only for primary CTAs

### Don't
- Don't use cold white (`#ffffff`) as page background
- Don't add shadows — Lovable is border-forward
- Don't use geometric sans-serifs — Camera Plain's humanism matters
- Don't relax the negative tracking on display — compression is intentional

## 8. Responsive Behavior

### Breakpoints
| Name | Width |
|------|-------|
| Mobile | <768px |
| Tablet | 768–1024px |
| Desktop | >1024px |

### Collapsing Strategy
- Display: 60px → 48px → 36px
- Navigation: horizontal → hamburger
- Cards: grid → stacked

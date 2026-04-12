# Design System Inspired by Binance

## 1. Visual Theme & Atmosphere

Binance.US's website is a dark, high-stakes trading environment designed for crypto enthusiasts and investors. The design operates on a deep charcoal canvas (#222126) with white text and the signature Binance Yellow (#F0B90B) as the singular brand accent. This isn't the friendly blue of traditional finance — it's the urgent energy of digital assets, designed to feel like a trading floor dashboard.

The typography system uses BinancePlex, a proprietary typeface available in multiple weights. At display sizes, the font maintains weight 500–700 for headlines with standard line-heights. The trading UI aesthetic permeates the entire site — even marketing pages feel like they could transform into live charts at any moment.

**Key Characteristics:**
- Dark charcoal background (#222126) — high-stakes trading environment
- Binance Yellow (#F0B90B) as singular brand accent — urgent energy
- BinancePlex proprietary typeface — financial precision
- Pill-shaped CTA buttons (50px radius) — modern fintech
- Card shadows at 5% opacity — subtle depth on dark surfaces
- Trading UI aesthetic throughout — charts and data visualization

## 2. Color Palette & Roles

### Primary Brand
- **Binance Yellow** (`#F0B90B`): Primary CTA, brand accent, trading buttons
- **Dark Surface** (`#222126`): Primary background, deep charcoal
- **White** (`#FFFFFF`): Primary text on dark, card fills on dark

### Interactive
- **Yellow Hover** (`#FCD535`): Primary button hover state
- **Green Success** (`#0ECB81`): Positive price movement, success states
- **Red Danger** (`#F6465D`): Negative price movement, error states
- **Link Blue** (`#1784FF`): Hyperlinks, information links

### Neutral Scale
- **Light Border** (`#2B3139`): Card borders, dividers
- **Muted Text** (`#848E9C`): Secondary text, descriptions
- **Medium Gray** (`#474D57`): Tertiary text

### Surface
- **Card Dark** (`#1E2329`): Elevated card surfaces
- **Input Dark** (`#2B3139`): Form input backgrounds

## 3. Typography Rules

### Font Family
- **Display / Body**: `BinancePlex`, fallback: `sans-serif`
- **Mono**: `BinancePlex Mono` for code and trading data

### Hierarchy
| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Display Hero | 48px | 700 | 1.20 |
| Section Heading | 32px | 600 | 1.25 |
| Card Title | 24px | 600 | 1.30 |
| Body | 16px | 400 | 1.50 |
| Caption | 14px | 400 | 1.43 |
| Button | 16px | 600 | 1.00 |

### Principles
- **BinancePlex throughout**: One font family for all text
- **Weight 600–700 for emphasis**: Headlines and CTAs use semibold/bold
- **Standard line-heights**: No extreme compression

## 4. Component Stylings

### Buttons
**Primary Yellow Pill**
- Background: `#F0B90B`
- Text: `#0B0E11` (near black)
- Radius: 50px (pill)
- Padding: 12px 24px
- Hover: `#FCD535`

**Secondary Dark**
- Background: `#222126`
- Text: `#FFFFFF`
- Border: `1px solid #474D57`
- Radius: 50px

**Ghost**
- Background: transparent
- Text: `#F0B90B`
- Hover: subtle yellow tint

### Cards
- Background: `#1E2329`
- Border: `1px solid #2B3139`
- Radius: 12px
- Shadow: `rgba(0,0,0,0.05)` — subtle depth

### Inputs
- Background: `#2B3139`
- Text: `#FFFFFF`
- Border: `1px solid #474D57`
- Radius: 8px

## 5. Layout Principles

### Spacing System
- Base unit: 8px
- Scale: 8px, 12px, 16px, 20px, 24px, 32px, 40px, 48px

### Border Radius Scale
- Standard: 8px (inputs, small elements)
- Card: 12px (cards, containers)
- Button: 50px (pill-shaped CTAs)

## 6. Depth & Elevation

| Level | Treatment | Use |
|-------|-----------|-----|
| Flat | No shadow | Default dark surface |
- Card | `rgba(0,0,0,0.05)` shadow | Elevated cards, containers |

**Shadow Philosophy**: Minimal shadows on dark surfaces — depth comes from surface color variation and borders rather than traditional elevation.

## 7. Do's and Don'ts

### Do
- Use Binance Yellow (#F0B90B) for primary CTAs
- Maintain dark charcoal background
- Use pill-shaped buttons (50px radius) for CTAs
- Keep shadows subtle (5% opacity)

### Don't
- Don't use light backgrounds — Binance is dark by default
- Don't add multiple accent colors — yellow is the brand
- Don't use sharp corners on CTA buttons — pills are the pattern

## 8. Responsive Behavior

### Breakpoints
| Name | Width |
|------|-------|
| Mobile | <768px |
| Tablet | 768–1024px |
| Desktop | >1024px |

### Collapsing Strategy
- Hero: 48px → 32px → 24px
- Navigation: full → hamburger
- Cards: grid → stacked

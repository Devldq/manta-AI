# Design System Inspired by MongoDB

## 1. Visual Theme & Atmosphere

MongoDB's website is a dark forest experience — a website that stages its developer data platform like a digital woodland, with deep teal-green surfaces that feel both natural and technological. The background isn't cold corporate navy or sterile black; it's a warm, organic dark (`#001e2b`, `#023430`) that grounds every page in an earthy, approachable atmosphere. This darkness serves as a stage for MongoDB's signature brand green (`#00ed64`) to glow like bioluminescence through the forest.

The typography system is the visual storyteller: MongoDB Value Serif appears on hero headlines, bringing editorial gravitas to technical content — an unusual choice for a developer tool that immediately signals MongoDB's differentiator. Euclid Circular A handles all body and UI text with geometric precision, creating a clear voice separation between brand moments (Serif) and functional moments (Sans). The result is a system that feels like reading a premium magazine about databases.

**Key Characteristics:**
- Dark forest background (`#001e2b`) with warm teal undertones — not cold navy or sterile black
- MongoDB Green (`#00ed64`) as bioluminescent accent against dark surfaces
- MongoDB Value Serif for hero headlines — editorial elegance on a developer platform
- Euclid Circular A for body/UI — geometric, approachable, highly legible
- Generous whitespace creating "page" rhythm within dark surfaces
- Tinted surface system using green at 5-20% opacity for subtle depth
- Pill-shaped CTAs with green glow on hover
- Gradient backgrounds combining brand colors for feature showcases

## 2. Color Palette & Roles

### Primary Brand
- **MongoDB Green** (`#00ed64`): Primary brand accent — CTAs, links, active states, brand highlights
- **Forest Dark** (`#001e2b`): Primary dark background surface
- **Forest Mid** (`#023430`): Secondary dark surface, elevated dark cards
- **Forest Light** (`#061604`): Tertiary dark surface, section differentiation

### Secondary & Accent
- **Green Dark** (`#00684a`): Hover states, pressed buttons, deemphasized interactive
- **Green Glow** (`rgba(0, 237, 100, 0.2)`): Hover glow effect on buttons and links
- **Teal Accent** (`#116d6e`): Secondary accent, product category highlights
- **Coral Accent** (`#f26a5b`): Error states, alerts, attention highlights
- **Gold Accent** (`#fbb034`): Warning states, premium features

### Surface & Background
- **Pure White** (`#ffffff`): Light section backgrounds, card surfaces
- **Off White** (`#f7fbf9`): Alternate light surface with green undertone
- **Green Tint 5%** (`rgba(0, 237, 100, 0.05)`): Subtle surface tint
- **Green Tint 10%** (`rgba(0, 237, 100, 0.10)`): Card backgrounds on dark surfaces
- **Green Tint 20%** (`rgba(0, 237, 100, 0.20)`): Elevated card backgrounds

### Neutrals & Text
- **Pure White** (`#ffffff`): Primary text on dark backgrounds
- **Light Gray** (`#e8eaed`): Secondary text on dark, muted content
- **Medium Gray** (`#9aa0a6`): Tertiary text, placeholder on dark
- **Dark Charcoal** (`#1f1f1f`): Primary text on light surfaces
- **Charcoal** (`#5f6368`): Secondary text on light

## 3. Typography Rules

### Font Family
- **Display / Hero**: `MongoDB Value Serif`, fallbacks: `Georgia, serif`
- **Body / UI**: `Euclid Circular A`, fallbacks: `Inter, -apple-system, sans-serif`

### Hierarchy
| Role | Font | Size | Weight | Line Height | Letter Spacing |
|------|------|------|--------|-------------|----------------|
| Display Hero | MongoDB Value Serif | 72px | 400 | 1.10 | normal |
| Section Heading | MongoDB Value Serif | 48px | 400 | 1.20 | normal |
| Card Title | Euclid Circular A | 32px | 500 | 1.25 | normal |
| Sub-heading | Euclid Circular A | 24px | 500 | 1.33 | normal |
| Body Large | Euclid Circular A | 20px | 400 | 1.50 | normal |
| Body | Euclid Circular A | 16px | 400 | 1.50 | normal |
| Button | Euclid Circular A | 16px | 500 | 1.25 | normal |
| Caption | Euclid Circular A | 14px | 400 | 1.43 | normal |

## 4. Component Stylings

### Buttons
- **Primary Green Pill**: Background `#00ed64`, Text `#001e2b`, Radius 999px, Padding 12px 24px
- **Secondary Outline**: Border `1px solid #00ed64`, Background transparent, Text `#00ed64`
- **Tertiary Dark**: Background `rgba(0, 237, 100, 0.10)`, Text `#00ed64`
- **Hover**: Glow effect `0 0 20px rgba(0, 237, 100, 0.4)`

### Cards & Containers
- Background: `rgba(0, 237, 100, 0.05)` on dark, `#ffffff` on light
- Radius: 12px for standard cards, 16px for featured
- Border: subtle green tint border or none
- Shadow: subtle ambient shadow for elevated cards

## 5. Layout Principles

### Spacing System
- Base unit: 8px
- Scale: 4px, 8px, 12px, 16px, 24px, 32px, 48px, 64px, 96px

### Border Radius Scale
- Small (4px): Badges, small tags
- Standard (8px): Buttons, inputs
- Comfortable (12px): Cards
- Large (16px): Featured cards
- Pill (999px): Primary CTAs

## 6. Depth & Elevation
| Level | Treatment | Use |
|--------|-----------|-----|
| Flat | No shadow | Default surfaces |
| Subtle | Green tint background | Card differentiation |
| Elevated | Ambient shadow + tint | Featured cards |
| Glow | Green glow effect | Interactive hover states |

## 7. Do's and Don'ts

### Do
- Use MongoDB Value Serif for hero headlines only
- Keep dark forest background on product pages
- Apply green glow on interactive hover
- Use pill-shaped CTAs for primary actions
- Maintain generous whitespace within dark surfaces

### Don't
- Don't use Serif font for body text
- Don't introduce competing accent colors
- Don't use cold navy or pure black backgrounds
- Don't apply heavy shadows — green tint creates depth

# Design System Inspired by Replicate

## 1. Visual Theme & Atmosphere

Replicate's website radiates developer community energy through an orange-red-magenta gradient hero that bleeds into clean white editorial sections. The signature brand orange (#ea2804) anchors the gradient, creating a warm, energetic welcome that feels more like a creative community than a cold developer tool.

Typography is bold and expansive — display headlines reach 128px at maximum, using rb-freigeist-neue with ultra-tight 0.9 line-height. Every interactive element is pill-shaped with 9999px border-radius, creating a cohesive "capsule" language throughout the interface.

**Key Characteristics:**
- Orange-red-magenta gradient hero (#ea2804 anchor)
- Extra-large display typography (up to 128px)
- Pill-shaped everything (9999px radius)
- Model galleries and code examples as primary visual content
- basier-square body + JetBrains Mono code font
- Dot-underline links — unique developer signature

## 2. Color Palette & Roles

### Primary Brand
- **Replicate Orange** (`#ea2804`): Brand anchor, CTA buttons, gradient start
- **White** (`#ffffff`): Editorial sections, primary surface
- **Magenta** (`#ff00aa`): Gradient end point

### Gradient System
- **Hero Gradient**: `linear-gradient(135deg, #ea2804 0%, #ff6b00 50%, #ff00aa 100%)`

### Semantic
- **Status Green** (`#2b9a66`): Success badges, model running states
- **Dark** (`#0d0d0d`): Text, dark surfaces

## 3. Typography Rules

### Font Families
- **Display**: `rb-freigeist-neue` — custom geometric display font
- **Body**: `basier-square` — clean geometric sans
- **Mono**: `JetBrains Mono` — code and technical content

### Hierarchy
| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Display Mega | 128px | 500 | 0.90 |
| Display Hero | 72px | 500 | 0.95 |
| Section Heading | 48px | 500 | 1.00 |
| Card Title | 24px | 500 | 1.20 |
| Body | 16px | 400 | 1.50 |

### Principles
- **Ultra-large display**: Headlines reach extreme sizes
- **Tight line-heights**: 0.9–1.0 for display creates dense blocks
- **Pill language**: Every interactive element uses 9999px radius

## 4. Component Stylings

### Buttons
**Primary Orange Pill**
- Background: gradient or solid `#ea2804`
- Radius: 9999px (full pill)
- Padding: 12px 24px

**Secondary/White Pill**
- Background: white with subtle shadow
- Text: dark
- Radius: 9999px

### Cards
- Background: white
- Border-radius: 12px
- Shadow: subtle elevation

### Links
- Dot-underline decoration — unique developer signature
- Color: brand orange or blue

## 5. Layout Principles

### Border Radius Scale
- Pill: 9999px (all buttons, badges, tags)
- Card: 12px (containers, model cards)

## 6. Depth & Elevation

**Shadow Philosophy**: Subtle shadows on white surfaces; gradient creates primary depth in hero.

## 7. Do's and Don'ts

### Do
- Use pill shapes (9999px radius) for all interactive elements
- Apply dot-underline to links
- Use gradient hero for landing pages

### Don't
- Don't use sharp corners on interactive elements
- Don't add heavy shadows — keep surfaces clean

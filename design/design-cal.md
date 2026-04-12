# Design System Inspired by Cal.com

## 1. Visual Theme & Atmosphere

Cal.com's website is a masterclass in monochromatic restraint — a grayscale world where boldness comes not from color but from the sheer confidence of black text on white space. Inspired by Uber's minimal aesthetic, the palette is deliberately stripped of hue: near-black headings (`#242424`), mid-gray secondary text (`#898989`), and pure white surfaces. Color is treated as a foreign substance — when it appears (a rare blue link, a green trust badge), it feels like a controlled accent in an otherwise black-and-white photograph.

Cal Sans, the brand's custom geometric display typeface designed by Mark Davis, is the visual centerpiece. Letters are intentionally spaced extremely close at large sizes, creating dense, architectural headlines that feel like they're carved into the page. At 64px and 48px, Cal Sans headings sit at weight 600 with a tight 1.10 line-height — confident, compressed, and immediately recognizable. For body text, the system switches to Inter, providing "rock-solid" readability.

**Key Characteristics:**
- Purely grayscale brand palette — no brand colors, boldness through monochrome
- Cal Sans custom geometric display font with extremely tight default letter-spacing
- Multi-layered shadow system (11 definitions) with ring borders + diffused shadows + inset highlights
- Cal Sans for headings, Inter for body — clean typographic division
- Wide border-radius scale from 2px to 9999px (pill) — versatile rounding
- White canvas with near-black (#242424) text — maximum contrast, zero decoration

## 2. Color Palette & Roles

### Primary
- **Charcoal** (`#242424`): Primary heading and button text — Cal.com's signature near-black
- **Midnight** (`#111111`): Deepest text/overlay color — used at 50% opacity for overlays
- **White** (`#ffffff`): Primary background and surface — the dominant canvas

### Secondary & Accent
- **Link Blue** (`#0099ff`): In-text links with underline decoration — the only blue in the system
- **Focus Ring** (`#3b82f6` at 50% opacity): Keyboard focus indicator — accessibility-only

### Surface & Background
- **Pure White** (`#ffffff`): Primary page background and card surfaces
- **Light Gray** (approx `#f5f5f5`): Subtle section differentiation
- **Mid Gray** (`#898989`): Secondary text, descriptions, and muted labels

### Neutrals & Text
- **Charcoal** (`#242424`): Headlines, buttons, primary UI text
- **Midnight** (`#111111`): Deep black for high-contrast links
- **Mid Gray** (`#898989`): Descriptions, secondary labels, muted content

## 3. Typography Rules

### Font Family
- **Display**: `Cal Sans` — custom geometric sans-serif by Mark Davis. Open-source.
- **Body**: `Inter` — "rock-solid" standard body font.
- **Mono**: `Roboto Mono` — for code blocks and technical content.

### Hierarchy

| Role | Font | Size | Weight | Line Height | Letter Spacing |
|------|------|------|--------|-------------|----------------|
| Display Hero | Cal Sans | 64px | 600 | 1.10 | 0px |
| Section Heading | Cal Sans | 48px | 600 | 1.10 | 0px |
| Feature Heading | Cal Sans | 24px | 600 | 1.30 | 0px |
| Sub-heading | Cal Sans | 20px | 600 | 1.20 | +0.2px |
| Card Title | Cal Sans | 16px | 600 | 1.10 | 0px |
| Body | Inter | 16px | 400 | 1.50 | normal |
| UI Label | Inter | 16px | 600 | 1.00 | 0px |
| Caption | Inter | 14px | 500 | 1.14 | 0px |
| Micro | Inter | 12px | 500 | 1.00 | 0px |
| Code | Roboto Mono | 14px | 600 | 1.00 | 0px |

### Principles
- **Cal Sans at large, Inter at small**: Cal Sans is exclusively for headings and display — never for body text.
- **Tight by default, space when small**: Cal Sans letters are "intentionally spaced to be extremely close" at large sizes.
- **Weight 600 dominance**: Nearly all Cal Sans usage is at weight 600 (semi-bold).

## 4. Component Stylings

### Buttons
- **Dark Primary**: `#242424` background, white text, 6–8px radius. Hover: opacity 0.7.
- **White/Ghost**: White background with shadow-ring border, dark text.
- **Pill**: 9999px radius for rounded pill-shaped actions.

### Cards & Containers
- **Shadow Card**: White background, multi-layered shadow — ring shadow + diffused shadow + contact shadow.
- **Radius**: 8px for standard cards, 12px for larger containers, 16px for prominent sections.

### Navigation
- **Top nav**: White/transparent background, Cal Sans links at near-black
- **CTA button**: Dark Primary in the nav

## 5. Layout Principles

### Spacing System
- **Base unit**: 8px
- **Scale**: 1px, 2px, 3px, 4px, 6px, 8px, 12px, 16px, 20px, 24px, 28px, 80px, 96px
- **Section padding**: 80px–96px vertical between major sections

### Border Radius Scale
- **2px**: Subtle rounding on inline elements
- **6px–8px**: Buttons, small cards, images
- **12px**: Medium containers
- **9999px**: Full pill shape — badges, links

## 6. Depth & Elevation

| Level | Treatment | Use |
|-------|-----------|-----|
| Flat | No shadow | Page canvas, basic text containers |
- Ring + Soft: Multi-layered shadow stack for cards and containers
- Inset Highlight: `rgba(255,255,255,0.15) 0px 2px 0px inset` for button inner highlight

**Shadow Philosophy**: Cal.com's shadow system uses multi-layered compositing technique:
- Ring borders via `0px 0px 0px 1px` shadows act as hairline containment
- Diffused soft shadows add gentle ambient depth
- Inset highlights create subtle 3D bevel effects

## 7. Do's and Don'ts

### Do
- Use Cal Sans exclusively for headings (24px+) and never for body text
- Apply positive letter-spacing (+0.2px) when using Cal Sans below 24px
- Maintain the grayscale palette — boldness comes from contrast, not color
- Use the multi-layered shadow system for card elevation

### Don't
- Use Cal Sans for body text or text below 16px
- Add brand colors — Cal.com is intentionally grayscale
- Use CSS borders when shadows can achieve containment
- Mix Cal Sans weights — weight 600 is the intended character

## 8. Responsive Behavior

### Breakpoints

| Name | Width |
|------|-------|
| Mobile | <640px |
| Tablet | 640–1024px |
| Desktop | >1024px |

### Collapsing Strategy
- **Hero**: 64px Cal Sans → ~36px on mobile
- **Navigation**: full horizontal → hamburger
- **Feature grids**: multi-column → single stacked
- **Section spacing**: 80px–96px → ~48px on mobile

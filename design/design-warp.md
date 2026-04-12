# Design System Inspired by Warp

## 1. Visual Theme & Atmosphere

Warp's website feels like sitting at a campfire in a deep forest — warm, dark, and alive with quiet confidence. Unlike the cold, blue-tinted blacks favored by most developer tools, Warp wraps everything in a warm near-black that feels like charred wood or dark earth. The text isn't pure white either — it's Warm Parchment (`#faf9f6`), a barely-perceptible cream that softens every headline.

The typography is the secret weapon: Matter, a geometric sans-serif with distinctive character, deployed at Regular weight across virtually all text. The font choice is unusual for a developer tool — Matter has a softness and humanity that signals "this terminal is for everyone."

**Key Characteristics:**
- Warm dark background — not cold black, but earthy near-black with warm gray undertones
- Warm Parchment (`#faf9f6`) text instead of pure white — subtle cream warmth
- Matter font family (Regular weight) — geometric but approachable
- Nature photography interleaved with product screenshots — lifestyle meets developer tool
- Almost monochromatic warm gray palette — no bold accent colors
- Uppercase labels with wide letter-spacing (2.4px) for categorization
- Pill-shaped dark buttons (`#353534`, 50px radius) — restrained, muted CTAs

## 2. Color Palette & Roles

### Primary
- **Warm Parchment** (`#faf9f6`): Primary text color — a barely-cream off-white
- **Earth Gray** (`#353534`): Button backgrounds, dark interactive surfaces
- **Deep Void** (near-black, page background): The warm dark canvas

### Secondary & Accent
- **Stone Gray** (`#868584`): Secondary text, muted descriptions
- **Ash Gray** (`#afaeac`): Body text, button text
- **Purple-Tint Gray** (`#666469`): Link text with subtle purple undertone

### Surface & Background
- **Frosted Veil** (`rgba(255, 255, 255, 0.04)`): Ultra-subtle white overlay
- **Mist Border** (`rgba(226, 226, 226, 0.35)`): Semi-transparent borders

## 3. Typography Rules

### Font Family
- **Display & Body**: `Matter Regular` — geometric sans-serif with soft character
- **Medium**: `Matter Medium` — weight 500 variant for emphasis
- **Mono**: `Geist Mono` — for code/terminal display

### Hierarchy
| Role | Size | Weight | Line Height | Letter Spacing |
|------|------|--------|-------------|----------------|
| Display Hero | 80px | 400 | 1.00 | -2.4px |
| Section Heading | 56px | 400 | 1.20 | -0.56px |
| Feature Heading | 40px | 400 | 1.10 | -0.4px |
| Body Large | 20px | 400 | 1.40 | -0.2px |
| Body | 18px | 400 | 1.30 | -0.18px |
| Caption | 12px | 400 | 1.35 | 2.4px (uppercase) |

### Principles
- **Regular weight dominance**: Nearly all text uses weight 400 — even headlines
- **Uppercase as editorial signal**: Small labels use uppercase with wide letter-spacing (1.4px–2.4px)
- **Warm legibility**: Matter's geometric softness + warm text colors creates effortless readability

## 4. Component Stylings

### Buttons
- **Dark Pill**: `#353534` background, Ash Gray text, 50px radius, 10px padding
- **Ghost**: No visible background, text-only with underline on hover

### Cards
- **Photography Cards**: Full-bleed nature imagery with overlay text, 8px–12px radius
- **Terminal Screenshot Cards**: Product UI in dark containers with rounded corners (8px–12px)
- **Bordered Cards**: Semi-transparent border for containment, 12px–14px radius

## 5. Layout Principles

### Spacing System
- Base unit: 8px
- Section padding: 80px–120px vertical

### Border Radius Scale
- 4px: Small interactive elements
- 8px–12px: Images, video containers, cards
- 50px: Pill buttons

## 6. Depth & Elevation

**Shadow Philosophy**: Minimal shadow usage — depth comes from:
- Semi-transparent borders instead of shadows
- Photography layering creating natural depth
- Surface opacity shifts for barely-perceptible layer differences

## 7. Do's and Don'ts

### Do
- Use warm off-white (`#faf9f6`) for text — never pure white
- Keep buttons restrained and muted — no bright CTAs
- Apply Matter Regular (400) for nearly everything
- Interleave nature photography with product screenshots

### Don't
- Use pure white (`#ffffff`) for text — it's always warm parchment
- Add bold accent colors — the system is deliberately monochromatic
- Apply bold weight (700+) to any text — never above Medium (500)

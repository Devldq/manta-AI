# Design System Inspired by Sentry

## 1. Visual Theme & Atmosphere

Sentry's website is a dark-mode-first developer tool interface that speaks the language of code editors and terminal windows. The entire aesthetic is rooted in deep purple-black backgrounds (`#1f1633`, `#150f23`) that evoke the late-night debugging sessions Sentry was built for. Against this inky canvas, a carefully curated set of purples, pinks, and a distinctive lime-green accent (`#c2ef4e`) create a visual system that feels simultaneously technical and vibrant.

The typography pairing is deliberate: "Dammit Sans" appears at hero scale (88px, weight 700) as a display font with personality and attitude that matches Sentry's irreverent brand voice ("Code breaks. Fix it faster."), while Rubik serves as the workhorse UI font across all functional text — headings, body, buttons, captions, and navigation. Monaco provides the monospace layer for code snippets and technical content, completing the developer-tool trinity.

**Key Characteristics:**
- Dark purple-black backgrounds (`#1f1633`, `#150f23`) — never pure black
- Warm purple accent spectrum: from deep (`#362d59`) through mid (`#79628c`, `#6a5fc1`) to vibrant (`#422082`)
- Lime-green accent (`#c2ef4e`) for high-visibility CTAs and highlights
- Pink/coral accents (`#ffb287`, `#fa7faa`) for focus states and secondary highlights
- "Dammit Sans" display font for brand personality at hero scale
- Rubik as primary UI font with uppercase letter-spaced labels
- Monaco monospace for code elements
- Inset shadows on buttons creating tactile depth
- Frosted glass effects with `blur(18px) saturate(180%)`

## 2. Color Palette & Roles

### Primary Brand
- **Deep Purple** (`#1f1633`): Primary background, the defining color of the brand
- **Darker Purple** (`#150f23`): Deeper sections, footer, secondary backgrounds
- **Border Purple** (`#362d59`): Borders, dividers, subtle structural lines

### Accent Colors
- **Sentry Purple** (`#6a5fc1`): Primary interactive color — links, hover states, focus rings
- **Muted Purple** (`#79628c`): Button backgrounds, secondary interactive elements
- **Deep Violet** (`#422082`): Select dropdowns, active states, high-emphasis surfaces
- **Lime Green** (`#c2ef4e`): High-visibility accent, special links, badge highlights
- **Coral** (`#ffb287`): Focus state backgrounds, warm accent
- **Pink** (`#fa7faa`): Focus outlines, decorative accents

### Text Colors
- **Pure White** (`#ffffff`): Primary text on dark backgrounds
- **Light Gray** (`#e5e7eb`): Secondary text, muted content
- **Code Yellow** (`#dcdcaa`): Syntax highlighting, code tokens

### Surface & Overlay
- **Glass White** (`rgba(255, 255, 255, 0.18)`): Frosted glass button backgrounds
- **Glass Dark** (`rgba(54, 22, 107, 0.14)`): Hover overlay on glass elements
- **Input White** (`#ffffff`): Form input backgrounds (light context)
- **Input Border** (`#cfcfdb`): Form field borders

## 3. Typography Rules

### Font Families
- **Display**: `Dammit Sans` — brand personality font for hero headings
- **Primary UI**: `Rubik`, with fallbacks: `-apple-system, system-ui, Segoe UI, Helvetica, Arial`
- **Monospace**: `Monaco`, with fallbacks: `Menlo, Ubuntu Mono`

### Hierarchy
| Role | Font | Size | Weight | Line Height | Letter Spacing |
|------|------|------|--------|-------------|----------------|
| Display Hero | Dammit Sans | 88px | 700 | 1.20 | normal |
| Display Secondary | Dammit Sans | 60px | 500 | 1.10 | normal |
| Section Heading | Rubik | 30px | 400 | 1.20 | normal |
| Sub-heading | Rubik | 27px | 500 | 1.25 | normal |
| Card Title | Rubik | 24px | 500 | 1.25 | normal |
| Body | Rubik | 16px | 400 | 1.50 | normal |
| Button Text | Rubik | 14px | 500–700 | 1.14 | 0.2px, uppercase |
| Caption | Rubik | 14px | 500–700 | 1.43 | 0.2px |
| Code | Monaco | 16px | 400–700 | 1.50 | normal |

## 4. Component Stylings

### Buttons
- **Primary Muted Purple**: Background `#79628c`, Text `#ffffff`, uppercase, 14px, Radius 13px, Inset shadow for tactile feel
- **Glass White**: Background `rgba(255, 255, 255, 0.18)`, Radius 12px
- **White Solid**: Background `#ffffff`, Text `#1f1633`, Hover transitions to `#6a5fc1`

### Inputs
- Background: `#ffffff`
- Text: `#1f1633`
- Border: `1px solid #cfcfdb`
- Radius: 6px
- Focus: inset shadow

### Cards & Containers
- Background: semi-transparent or dark purple surfaces
- Radius: 8px–12px
- Backdrop filter: `blur(18px) saturate(180%)` for glass effects

## 5. Layout Principles

### Spacing System
- Base unit: 8px
- Scale: 1px, 2px, 4px, 5px, 6px, 8px, 12px, 16px, 24px, 32px, 40px, 44px, 45px, 47px

### Border Radius Scale
- Minimal (6px): Form inputs, small interactive elements
- Standard (8px): Buttons, cards, containers
- Comfortable (10px–12px): Larger containers, glass panels
- Rounded (13px): Primary muted buttons
- Pill (18px): Image containers, badges

## 6. Depth & Elevation
| Level | Treatment | Use |
|--------|-----------|-----|
| Sunken (-1) | Inset shadow | Primary buttons (tactile pressed feel) |
| Flat (0) | No shadow | Default surfaces, dark backgrounds |
| Surface (1) | `rgba(0,0,0,0.08) 0px 2px 8px` | Glass buttons, subtle cards |
| Elevated (2) | `rgba(0,0,0,0.1) 0px 10px 15px -3px` | Cards, floating panels |
| Prominent (3) | `rgba(0,0,0,0.18) 0px 0.5rem 1.5rem` | Hover states, modals |
| Ambient (4) | Deep purple ambient glow | Around hero sections |

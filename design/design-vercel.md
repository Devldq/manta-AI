# Design System Inspired by Vercel

## 1. Visual Theme & Atmosphere

Vercel's website is the visual thesis of developer infrastructure made invisible — a design system so restrained it borders on philosophical. The page is overwhelmingly white (`#ffffff`) with near-black (`#171717`) text, creating a gallery-like emptiness where every element earns its pixel. This isn't minimalism as decoration; it's minimalism as engineering principle. The Geist design system treats the interface like a compiler treats code — every unnecessary token is stripped away until only structure remains.

The custom Geist font family is the crown jewel. Geist Sans uses aggressive negative letter-spacing (-2.4px to -2.88px at display sizes), creating headlines that feel compressed, urgent, and engineered — like code that's been minified for production. At body sizes, the tracking relaxes but the geometric precision persists. Geist Mono completes the system as the monospace companion for code, terminal output, and technical labels.

**Key Characteristics:**
- Geist Sans with extreme negative letter-spacing (-2.4px to -2.88px at display) — text as compressed infrastructure
- Geist Mono for code and technical labels with OpenType `"liga"` globally
- Shadow-as-border technique: `box-shadow 0px 0px 0px 1px` replaces traditional borders throughout
- Multi-layer shadow stacks for nuanced depth (border + elevation + ambient in single declarations)
- Near-pure white canvas with `#171717` text — not quite black, creating micro-contrast softness
- Workflow-specific accent colors: Ship Red (`#ff5b4f`), Preview Pink (`#de1d8d`), Develop Blue (`#0a72ef`)
- Focus ring system using `hsla(212, 100%, 48%, 1)` — a saturated blue for accessibility
- Pill badges (9999px) with tinted backgrounds for status indicators

## 2. Color Palette & Roles

### Primary
- **Vercel Black** (`#171717`): Primary text, headings, dark surface backgrounds
- **Pure White** (`#ffffff`): Page background, card surfaces, button text on dark
- **True Black** (`#000000`): Console/code contexts

### Workflow Accent Colors
- **Ship Red** (`#ff5b4f`): Ship to production workflow step
- **Preview Pink** (`#de1d8d`): Preview deployment workflow
- **Develop Blue** (`#0a72ef`): Development workflow

### Interactive
- **Link Blue** (`#0072f5`): Primary link color with underline decoration
- **Focus Blue** (`hsla(212, 100%, 48%, 1)`): Focus ring on interactive elements

### Neutral Scale
- **Gray 600** (`#4d4d4d`): Secondary text
- **Gray 500** (`#666666`): Tertiary text
- **Gray 400** (`#808080`): Placeholder text
- **Gray 100** (`#ebebeb`): Borders, dividers
- **Gray 50** (`#fafafa`): Subtle surface tint

## 3. Typography Rules

### Font Family
- **Primary**: `Geist`, fallbacks: `Arial, Apple Color Emoji, Segoe UI Emoji`
- **Monospace**: `Geist Mono`
- OpenType Features: `"liga"` enabled globally; `"tnum"` for tabular numbers

### Hierarchy
| Role | Size | Weight | Line Height | Letter Spacing |
|------|------|--------|-------------|----------------|
| Display Hero | 48px | 600 | 1.00–1.17 | -2.4px to -2.88px |
| Section Heading | 40px | 600 | 1.20 | -2.4px |
| Sub-heading Large | 32px | 600 | 1.25 | -1.28px |
| Card Title | 24px | 600 | 1.33 | -0.96px |
| Body Large | 20px | 400 | 1.80 | normal |
| Body | 16px | 400 | 1.50 | normal |
| Button/Link | 14px | 500 | 1.43 | normal |
| Caption | 12px | 400–500 | 1.33 | normal |

### Principles
- Compression as identity: Geist Sans at display sizes uses -2.4px to -2.88px letter-spacing — the most aggressive negative tracking of any major design system
- Ligatures everywhere: Every Geist text element enables OpenType `"liga"`
- Three weights, strict roles: 400 (body), 500 (UI), 600 (headings). No bold (700) except for tiny micro-badges

## 4. Component Stylings

### Buttons
- **Primary White (Shadow-bordered)**: Background `#ffffff`, Text `#171717`, Radius 6px, Shadow: `rgb(235, 235, 235) 0px 0px 0px 1px`
- **Primary Dark**: Background `#171717`, Text `#ffffff`, Radius 6px
- **Pill Badge**: Background `#ebf5ff`, Text `#0068d6`, Radius 9999px

### Cards & Containers
- Background: `#ffffff`
- Border: via shadow — `rgba(0, 0, 0, 0.08) 0px 0px 0px 1px`
- Radius: 8px (standard), 12px (featured/image cards)
- Shadow stack: multiple layers for nuanced depth

## 5. Layout Principles

### Spacing System
- Base unit: 8px
- Scale: 1px, 2px, 3px, 4px, 5px, 6px, 8px, 10px, 12px, 14px, 16px, 32px, 36px, 40px

### Border Radius Scale
- Micro (2px): Inline code snippets
- Subtle (4px): Small containers
- Standard (6px): Buttons, links
- Comfortable (8px): Cards, list items
- Image (12px): Featured cards
- Full Pill (9999px): Badges, status pills
- Circle (50%): Menu toggle, avatars

## 6. Depth & Elevation
| Level | Treatment | Use |
|--------|-----------|-----|
| Flat (0) | No shadow | Page background, text blocks |
| Ring (1) | `rgba(0,0,0,0.08) 0px 0px 0px 1px` | Shadow-as-border for most elements |
| Subtle Card (2) | Ring + soft lift | Standard cards with minimal lift |
| Full Card (3) | Full shadow stack + inner ring | Featured cards, highlighted panels |
| Focus | `2px solid hsla(212, 100%, 48%, 1)` | Keyboard focus on all interactive elements |

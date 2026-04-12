# Design System Inspired by IBM

## 1. Visual Theme & Atmosphere

IBM's Carbon Design System is the most rigorously engineered design system in existence — an industrial-grade interface language that treats every pixel like a component in a mainframe. The aesthetic is deliberately restrained: IBM Blue (`#0f62fe`) is the sole chromatic accent in a universe of whites, grays, and near-blacks. This isn't minimalism as style; it's minimalism as engineering philosophy, where decoration is inefficiency.

The typography system is monolithic: IBM Plex Sans, IBM Plex Mono, and IBM Plex Serif cover every text context from billboard to terminal. The fonts are open-source, designed by IBM itself, with optical sizes and extensive language support. Weight 450 (Regular) handles body text with slightly more heft than standard 400, improving legibility on data-dense enterprise interfaces.

**Key Characteristics:**
- IBM Blue 60 (`#0f62fe`) as the singular interactive color — never decorative
- IBM Plex font family covering all contexts (Sans, Mono, Serif)
- 8px spacing grid with mathematical precision
- 0px border-radius on buttons — sharp, engineered corners
- Input fields with bottom-border-only styling (no surrounding boxes)
- Mono-weight UI — most text is Regular (400), with Bold (600) reserved for emphasis
- White, Gray 10 (`#f4f4f4`), and Gray 100 (`#161616`) surface hierarchy
- Carbon grid system: 16-column max, responsive breakpoints at 320px increments

## 2. Color Palette & Roles

### Primary
- **IBM Blue 60** (`#0f62fe`): Primary interactive color — links, buttons, icons, focus
- **IBM Blue 70** (`#0043ce`): Hover state on primary interactive
- **IBM Blue 80** (`#002d9c`): Active/pressed state
- **IBM Blue 50** (`#4589ff`): Light variant for dark backgrounds
- **IBM Blue 40** (`#78a9ff`): Deemphasized links on dark
- **IBM Blue 20** (`#d0e2ff`): Subtle tint backgrounds
- **IBM Blue 10** (`#edf5ff`): Lightest tint

### Grayscale
- **White** (`#ffffff`): Primary light surface
- **Gray 10** (`#f4f4f4`): Secondary light surface, hover backgrounds
- **Gray 20** (`#e0e0e0`): Tertiary light, disabled borders
- **Gray 30** (`#c6c6c6`): Disabled backgrounds, placeholder text
- **Gray 50** (`#8d8d8d`): Tertiary text
- **Gray 70** (`#525252`): Secondary text
- **Gray 90** (`#393939`): Primary text on light
- **Gray 100** (`#161616`): Dark surfaces, text on light
- **Black** (`#000000`): Console/code contexts

### Semantic
- **Red 60** (`#da1e28`): Error, destructive actions
- **Green 60** (`#198038`): Success, positive states
- **Yellow 30** (`#f1c21b`): Warning, attention states

### Backgrounds
- **Layer 0** (`#f4f4f4`): Page background
- **Layer 1** (`#ffffff`): Primary surfaces, cards
- **Layer 2** (`#ffffff`): Elevated surfaces with shadow
- **Layer 3** (`#e0e0e0`): Modal overlays

## 3. Typography Rules

### Font Family
- **Primary**: `IBM Plex Sans`, weights: 300 (Light), 400 (Regular), 450 (Regular+), 600 (Semi-Bold)
- **Monospace**: `IBM Plex Mono`
- **Serif**: `IBM Plex Serif`

### Hierarchy
| Role | Font | Size | Weight | Line Height | Letter Spacing |
|------|------|------|--------|-------------|----------------|
| Display | IBM Plex Sans | 64px | 300 | 1.10 | -0.64px |
| Heading 1 | IBM Plex Sans | 48px | 400 | 1.17 | -0.48px |
| Heading 2 | IBM Plex Sans | 32px | 400 | 1.25 | -0.32px |
| Heading 3 | IBM Plex Sans | 24px | 400 | 1.33 | normal |
| Heading 4 | IBM Plex Sans | 20px | 400 | 1.40 | normal |
| Body | IBM Plex Sans | 16px | 400 | 1.50 | normal |
| Body Small | IBM Plex Sans | 14px | 400 | 1.43 | normal |
| Caption | IBM Plex Sans | 12px | 400 | 1.33 | normal |
| Label | IBM Plex Sans | 12px | 400 | 1.33 | 0.32px |
| Code | IBM Plex Mono | 14px | 400 | 1.43 | normal |

## 4. Component Stylings

### Buttons
- **Primary**: Background `#0f62fe`, Text `#ffffff`, Radius 0px (sharp corners), Padding 16px 64px
- **Secondary**: Border `1px solid #0f62fe`, Background transparent, Text `#0f62fe`
- **Tertiary**: No border, Background transparent, Text `#0f62fe`, underline on hover
- **Disabled**: Background `#c6c6c6`, Text `#8d8d8d`

### Inputs
- Background: transparent
- Border: bottom-only `1px solid #8d8d8d`
- Focus: border color to `#0f62fe`
- Error: border color to `#da1e28`
- No surrounding box

### Cards & Containers
- Background: `#ffffff`
- Border: `1px solid #e0e0e0`
- Radius: 4px
- Shadow: minimal elevation system

## 5. Layout Principles

### Spacing System
- Base unit: 8px
- Scale: 2px, 4px, 8px, 12px, 16px, 24px, 32px, 40px, 48px, 64px

### Grid System
- 16-column grid max
- Gutters: 16px
- Margins: responsive by breakpoint

### Border Radius Scale
- 0px: Buttons (sharp, engineered)
- 4px: Cards, inputs
- 50%: Avatars, circular elements

## 6. Depth & Elevation
| Level | Treatment | Use |
|--------|-----------|-----|
| Flat | No shadow | Default surfaces |
| Subtle | Minimal shadow | Elevated cards |
- Carbon uses minimal shadow; depth from layer colors, not shadow

## 7. Do's and Don'ts

### Do
- Use IBM Blue 60 (`#0f62fe`) exclusively for interactive elements
- Apply 0px radius on all buttons — sharp corners are IBM identity
- Use IBM Plex font family exclusively
- Keep inputs bottom-border-only style
- Follow 8px spacing grid strictly

### Don't
- Don't introduce additional chromatic colors — blue is absolute
- Don't round buttons — 0px radius is non-negotiable
- Don't use competing typefaces — IBM Plex covers all contexts
- Don't add decorative shadows — elevation from layer colors

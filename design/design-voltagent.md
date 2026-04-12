# Design System Inspired by VoltAgent

## 1. Visual Theme & Atmosphere

VoltAgent's interface is a deep-space command terminal for the AI age — a developer-facing darkness built on near-pure-black surfaces (`#050507`) where the only interruption is the electric pulse of emerald green energy. The entire experience evokes the feeling of staring into a high-powered IDE at 2am: dark, focused, and alive with purpose.

The green accent (`#00d992`) is used with surgical precision — it glows from headlines, borders, and interactive elements like a circuit board carrying a signal. Against the carbon-black canvas, this green reads as "power on" — a deliberate visual metaphor for an AI agent engineering platform.

**Key Characteristics:**
- Carbon-black canvas (`#050507`) with warm-gray border containment
- Single-accent identity: Emerald Signal Green (`#00d992`) as the sole chromatic energy source
- System-ui for authoritative headings, Inter for precise UI/body text
- Ultra-tight heading line-heights (1.0–1.11) creating dense, compressed power blocks
- Developer-terminal aesthetic where code snippets ARE the hero content
- Green glow effects that make UI elements feel electrically alive

## 2. Color Palette & Roles

### Primary
- **Emerald Signal Green** (`#00d992`): Core brand energy — accent borders, glow effects
- **VoltAgent Mint** (`#2fd6a1`): Button-text variant — more readable than pure Signal Green
- **Abyss Black** (`#050507`): Landing page canvas — near-pure black
- **Carbon Surface** (`#101010`): Card and button background

### Secondary & Accent
- **Soft Purple** (`#818cf8`): Secondary categorization, code syntax
- **Ring Blue** (`#3b82f6`): Keyboard focus indicator

### Surface & Background
- **Warm Charcoal Border** (`#3d3a39`): Signature containment color — warm, not cold

### Neutrals & Text
- **Snow White** (`#f2f2f2`): Primary text color — softened off-white
- **Pure White** (`#ffffff`): Highest-emphasis moments
- **Warm Parchment** (`#b8b3b0`): Secondary body text
- **Steel Slate** (`#8b949e`): Tertiary text, metadata

## 3. Typography Rules

### Font Families
- **Primary (Headings)**: `system-ui` — native operating system font
- **Secondary (Body/UI)**: `Inter` — geometric precision
- **Monospace (Code)**: `SFMono-Regular` — developer credibility

### Hierarchy
| Role | Font | Size | Weight | Line Height | Letter Spacing |
|------|------|------|--------|-------------|----------------|
| Display Hero | system-ui | 60px | 400 | 1.00 | -0.65px |
| Section Heading | system-ui | 36px | 400 | 1.11 | -0.9px |
| Sub-heading | system-ui | 24px | 700 | 1.33 | -0.6px |
| Body | Inter | 16px | 400–600 | 1.50 | normal |
| Code | SFMono-Regular | 14px | 400 | 1.43 | normal |

### Principles
- **System-native authority**: Display headings use system-ui — renders instantly with native personality
- **Tight compression creates density**: Hero line-heights extremely compressed (1.0) with negative letter-spacing
- **Weight gradient, not contrast**: Gentle 300→700 weight progression

## 4. Component Stylings

### Buttons
**Ghost / Outline**
- Background: transparent
- Text: Pure White (`#ffffff`)
- Border: `1px solid #3d3a39`
- Radius: 6px
- Hover: background darkens, opacity 0.4

**Primary Green CTA**
- Background: Carbon Surface (`#101010`)
- Text: VoltAgent Mint (`#2fd6a1`)

### Cards
- Background: Carbon Surface (`#101010`)
- Border: `1px solid #3d3a39` for standard; `2px solid #00d992` for highlighted
- Radius: 8px (content cards); 4–6px (small containers)
- Shadow: Warm Ambient Haze for elevated cards

## 5. Layout Principles

### Spacing System
- Base unit: 8px
- Section padding: 64–96px vertical

### Border Radius Scale
- 4px: Nearly squared — technical precision
- 6px: Buttons, links — workhorse radius
- 8px: Content cards
- 9999px: Pill-shaped — tags, badges

## 6. Depth & Elevation

| Level | Treatment | Use |
|-------|-----------|-----|
| Flat | No shadow, no border | Page background |
| Contained | `1px solid #3d3a39` | Standard cards |
- Accent | `2px solid #00d992` | Highlighted/active cards
- Ambient Glow | `rgba(92, 88, 85, 0.2) 0px 0px 15px` | Elevated cards

**Shadow Philosophy**: Depth primarily through border weight and color — the Warm Charcoal border IS the elevation.

## 7. Do's and Don'ts

### Do
- Use Abyss Black (`#050507`) as landing page background
- Reserve Emerald Signal Green exclusively for high-signal moments
- Use VoltAgent Mint for button text on dark surfaces
- Keep heading line-heights compressed (1.0–1.11)

### Don't
- Don't use bright or light backgrounds — the identity lives on near-black
- Don't use Emerald Signal Green on large surfaces — it's an accent, never a surface
- Don't use pure white as default body text — Snow White (`#f2f2f2`) is the standard

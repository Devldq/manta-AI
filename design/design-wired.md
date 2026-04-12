# Design System Inspired by WIRED

## 1. Visual Theme & Atmosphere

WIRED's website is built on newstand density editorial grids — lines and whitespace, never cards or shadows. The design philosophy is strictly print-inspired: a custom serif display font paired with a technical monospace for bylines, creating a clear division between editorial voice and meta information.

All images, containers, and structural elements are strictly rectilinear (0px border-radius) — only icon buttons are circular. This creates a stark, authoritative visual language that feels like a printed page rather than a web experience.

**Key Characteristics:**
- Newstand density editorial grid: lines and whitespace, never cards or shadows
- Custom serif display font + technical monospace bylines
- All images, containers strictly rectilinear (0px radius)
- 2px hard black border buttons — print-style not web-style
- Single ink-blue link color (#057dbc); everything else grayscale
- Monospace uppercase bylines with wide letter-spacing (0.9-1.2px)
- No shadows, no rounded corners, no gradients

## 2. Color Palette & Roles

### Primary
- **Ink Blue** (`#057dbc`): Links — the only chromatic color in content
- **Absolute Black** (`#000000`): Headlines, borders, primary text
- **Pure White** (`#ffffff`): Primary surface

### Neutral Scale
- **Dark Gray** (`#333333`): Secondary text
- **Medium Gray** (`#666666`): Tertiary text
- **Light Gray** (`#e5e5e5`): Borders, dividers

## 3. Typography Rules

### Font Families
- **Display**: Custom serif display font
- **Byline/Meta**: Monospace font for technical bylines
- **Body**: Standard sans-serif

### Hierarchy
| Role | Size | Weight | Letter Spacing | Transform |
|------|------|--------|----------------|-----------|
| Display Hero | 56px | 400 | normal | none |
| Byline | 12px | 400 | 0.9-1.2px | uppercase |
| Body | 16px | 400 | normal | none |

### Principles
- **Serif for headlines**: Creates editorial authority
- **Monospace uppercase bylines**: Wide letter-spacing creates technical contrast
- **No shadows or rounded corners**: Strict print aesthetic

## 4. Component Stylings

### Buttons
**Standard (Print-Style)**
- Background: transparent or white
- Border: 2px solid black
- Radius: 0px (rectilinear)
- Text: uppercase or sentence case

**Icon Button**
- Radius: 50% (circular) — the only rounded element type

### Cards
- Background: transparent
- Border: 1px solid light gray
- Radius: 0px (strictly rectilinear)
- No shadow elevation

### Links
- Color: `#057dbc` (ink-blue)
- Decoration: underline on hover

## 5. Layout Principles

### Grid System
- Editorial newstand density
- Lines and whitespace separation
- Never cards or heavy shadows

### Border Radius Scale
- All containers: 0px (rectilinear)
- Icon buttons: 50% (circular)

## 6. Depth & Elevation

**Shadow Philosophy**: Zero shadows — depth comes from line weight and whitespace, not elevation.

## 7. Do's and Don'ts

### Do
- Use 0px border-radius on all containers and images
- Apply 2px hard black borders to buttons
- Use monospace uppercase for bylines with wide letter-spacing
- Keep palette to grayscale + single link blue

### Don't
- Don't add rounded corners to containers or images
- Don't use card-style shadows or elevation
- Don't use multiple accent colors
- Don't apply gradients to surfaces

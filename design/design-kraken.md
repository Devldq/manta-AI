# Design System Inspired by Kraken

## 1. Visual Theme & Atmosphere

Kraken's website is a clean, trustworthy crypto exchange that uses purple as its commanding brand color. The design operates on white backgrounds with Kraken Purple (`#7132f5`) creating a distinctive, professional crypto identity.

**Key Characteristics:**
- Kraken Purple (`#7132f5`) as primary brand with darker variants
- Kraken-Brand (display) + Kraken-Product (UI) dual font system
- Near-black (`#101114`) text with cool blue-gray neutral scale
- 12px radius buttons (rounded but not pill)
- Subtle shadows — whisper-level
- Green accent (`#149e61`) for positive/success states

## 2. Color Palette & Roles

### Primary
- **Kraken Purple** (`#7132f5`): Primary CTA, brand accent
- **Purple Dark** (`#5741d8`): Button borders, outlined variants
- **Near Black** (`#101114`): Primary text

### Neutral
- **Cool Gray** (`#686b82`): Primary neutral
- **Silver Blue** (`#9497a9`): Secondary text

### Semantic
- **Green** (`#149e61`): Success states

## 3. Typography Rules

### Font Families
- **Display**: `Kraken-Brand`, fallback: `IBM Plex Sans`
- **UI / Body**: `Kraken-Product`, fallback: `Helvetica Neue`

### Hierarchy
| Role | Size | Weight |
|------|------|--------|
| Display Hero | 48px | 700 |
| Section Heading | 36px | 700 |
| Body | 16px | 400 |

## 4. Component Stylings

### Buttons
**Primary Purple**
- Background: `#7132f5`
- Radius: 12px

**Purple Outlined**
- Background: `#ffffff`
- Border: `1px solid #5741d8`

## 5. Layout Principles

- Border Radius: 12px for buttons, 9999px for pills
- Subtle shadows at 3% opacity

## 6. Depth & Elevation

- Subtle: `rgba(0,0,0,0.03) 0px 4px 24px`

## 7. Do's and Don'ts

### Do
- Use Kraken Purple for CTAs
- Apply 12px radius on buttons

### Don't
- Don't use pill buttons — 12px is the max radius

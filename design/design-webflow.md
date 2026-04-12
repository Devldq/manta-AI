# Design System Inspired by Webflow

## 1. Visual Theme & Atmosphere

Webflow's website is a visually rich, tool-forward platform that communicates "design without code" through clean white surfaces, the signature Webflow Blue (`#146ef5`), and a rich secondary color palette (purple, pink, green, orange, yellow, red). The custom WF Visual Sans Variable font creates a confident, precise typographic system with weight 600 for display and 500 for body.

The design feels like a professional design tool — precise, systematic, with carefully crafted hover animations and generous whitespace. The approach signals "we understand designers" through every typographic choice, color relationship, and interaction pattern.

**Key Characteristics:**
- White canvas with near-black (`#080808`) text
- Webflow Blue (`#146ef5`) as primary brand + interactive color
- WF Visual Sans Variable – custom variable font with weight 500–600
- Rich secondary palette: purple `#7a3dff`, pink `#ed52cb`, green `#00d722`, orange `#ff6b00`, yellow `#ffae13`, red `#ee1d36`
- Conservative 4px–8px border-radius – sharp, not rounded
- Multi-layer shadow stacks (5-layer cascading shadows)
- Uppercase labels: 10px–15px, weight 500–600, wide letter-spacing (0.6px–1.5px)
- translate(6px) hover animation on buttons

## 2. Color Palette & Roles

### Primary
- **Near Black** (`#080808`): Primary text
- **Webflow Blue** (`#146ef5`): `--_color---primary--webflow-blue`, primary CTA and links
- **Blue 400** (`#3b89ff`): `--_color---primary--blue-400`, lighter interactive blue
- **Blue 300** (`#006acc`): `--_color---blue-300`, darker blue variant
- **Button Hover Blue** (`#0055d4`): `--mkto-embed-color-button-hover`

### Secondary Accents
- **Purple** (`#7a3dff`): `--_color---secondary--purple`
- **Pink** (`#ed52cb`): `--_color---secondary--pink`
- **Green** (`#00d722`): `--_color---secondary--green`
- **Orange** (`#ff6b00`): `--_color---secondary--orange`
- **Yellow** (`#ffae13`): `--_color---secondary--yellow`
- **Red** (`#ee1d36`): `--_color---secondary--red`

### Neutral
- **Gray 800** (`#222222`): Dark secondary text
- **Gray 700** (`#363636`): Mid text
- **Gray 300** (`#ababab`): Muted text, placeholder
- **Mid Gray** (`#5a5a5a`): Link text
- **Border Gray** (`#d8d8d8`): Borders, dividers
- **Border Hover** (`#898989`): Hover border

### Shadows
- **5-layer cascade**: `rgba(0,0,0,0) 0px 84px 24px, rgba(0,0,0,0.01) 0px 54px 22px, rgba(0,0,0,0.04) 0px 30px 18px, rgba(0,0,0,0.08) 0px 13px 13px, rgba(0,0,0,0.09) 0px 3px 7px`

## 3. Typography Rules

### Font: `WF Visual Sans Variable`, fallback: `Arial`

| Role | Size | Weight | Line Height | Letter Spacing | Notes |
|------|------|--------|-------------|----------------|-------|
| Display Hero | 80px | 600 | 1.04 | -0.8px | |
| Section Heading | 56px | 600 | 1.04 | normal | |
| Sub-heading | 32px | 500 | 1.30 | normal | |
| Feature Title | 24px | 500–600 | 1.30 | normal | |
| Body | 20px | 400–500 | 1.40–1.50 | normal | |
| Body Standard | 16px | 400–500 | 1.60 | -0.16px | |
| Button | 16px | 500 | 1.60 | -0.16px | |
| Uppercase Label | 15px | 500 | 1.30 | 1.5px | uppercase |
| Caption | 14px | 400–500 | 1.40–1.60 | normal | |
| Badge Uppercase | 12.8px | 550 | 1.20 | normal | uppercase |
| Micro Uppercase | 10px | 500–600 | 1.30 | 1px | uppercase |

### Code: Inconsolata (companion monospace font)

### Principles
- **Display confidence**: Weight 600 for display creates bold, confident headlines
- **Uppercase system labels**: Wide letter-spacing (1px–1.5px) on uppercase labels creates systematic voice
- **Conservative radius**: 4px–8px keeps things sharp and professional

## 4. Component Stylings

### Buttons
- **Transparent**: text `#080808`, translate(6px) on hover with arrow icon
- **White circle**: 50% radius, white bg
- **Blue badge**: `#146ef5` bg, 4px radius, weight 550
- **Hover animation**: translate(6px) with fade

### Cards
- **Standard**: `1px solid #d8d8d8`, 4px–8px radius
- **Elevation**: 5-layer shadow cascade

### Badges
- Blue-tinted bg at 10% opacity, 4px radius
- Uppercase text with weight 550

## 5. Layout Principles

### Spacing System
- **Fractional scale**: 1px, 2.4px, 3.2px, 4px, 5.6px, 6px, 7.2px, 8px, 9.6px, 12px, 16px, 24px
- **Section padding**: 80px–120px vertical between sections

### Border Radius Scale
- **2px**: Micro elements
- **4px**: Primary UI components — buttons, badges, inputs
- **8px**: Cards, larger containers
- **50%**: Circular elements

### Grid & Container
- **Max width**: ~1200px container
- **Breakpoints**: 479px, 768px, 992px

### Whitespace Philosophy
- **Tool-like density**: Generous but not lavish — designed for scanning feature lists and pricing tables
- **Color sections as differentiation**: Secondary colors create visual sections rather than heavy shadows

## 6. Depth & Elevation

| Level | Treatment | Use |
|-------|-----------|-----|
| Level 0 (Flat) | No shadow | Page background, text |
| Level 1 (Border) | `1px solid #d8d8d8` | Card containment |
| Level 2 (Shallow) | `rgba(0,0,0,0.09) 0px 3px 7px` | Minimal lift |
| Level 3 (Medium) | 5-layer cascade | Elevated cards, floating elements |
| Level 4 (Deep) | Full shadow stack | Modals, dropdowns |

### Shadow Philosophy
Webflow's signature is the 5-layer cascading shadow system that creates extremely smooth, professional elevation. Each layer transitions from zero opacity at the far edge to slightly higher opacity closer to the element, creating an impossibly smooth gradient from element to void.

## 7. Do's and Don'ts

### Do
- Use WF Visual Sans Variable at weight 500–600
- Webflow Blue (`#146ef5`) for all primary CTAs and links
- 4px border-radius for most UI elements
- translate(6px) hover animation on buttons
- Uppercase labels with 1px–1.5px letter-spacing

### Don't
- Don't round beyond 8px for functional elements — the brand is sharp, not rounded
- Don't use secondary colors on primary CTAs
- Don't skip the translate hover animation — it's signature Webflow
- Don't use non-Webflow fonts

## 8. Responsive Behavior

### Breakpoints

| Name | Width | Key Changes |
|------|-------|-------------|
| Mobile | <479px | Single column, stacked cards, hamburger nav |
| Tablet | 479px–768px | 2-column layouts begin, nav visible |
| Desktop | 768px–992px | Full layout, horizontal nav |
| Large | >992px | Max-width container centered |

### Collapsing Strategy
- **Navigation**: horizontal → hamburger at mobile
- **Feature grids**: 3-column → 2-column → single column
- **Typography**: Display sizes scale down proportionally
- **Shadows**: Remain consistent across breakpoints

## 9. Agent Prompt Guide

### Quick Color Reference
- Text: Near Black (`#080808`)
- CTA: Webflow Blue (`#146ef5`)
- Background: White (`#ffffff`)
- Border: `#d8d8d8`
- Secondary: Purple `#7a3dff`, Pink `#ed52cb`, Green `#00d722`

### Example Component Prompts
- "Create a hero with 80px WF Visual Sans heading at weight 600, line-height 1.04, near-black text (#080808), and Webflow Blue CTA button (#146ef5, 4px radius, translate(6px) hover)"
- "Design a feature card with 1px #d8d8d8 border, 8px radius, 24px WF Visual Sans title at weight 600, and 16px body text"
- "Build a pricing table with 5-layer cascading shadow, uppercase section labels at 10px weight 600 letter-spacing 1px"
- "Create a badge with blue-tinted background at 10% opacity, 4px radius, uppercase text at 12.8px weight 550"

### Iteration Guide
1. Verify font is WF Visual Sans Variable — never Arial, never Inter
2. Check border-radius is 4px–8px — Webflow is sharp, not rounded
3. Ensure translate(6px) hover animation on all buttons
4. Confirm Webflow Blue (#146ef5) is the only primary CTA color
5. Shadows should use the 5-layer cascade system, not single shadows

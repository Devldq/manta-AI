# Design System Inspired by Meta (Store)

## 1. Visual Theme & Atmosphere

The Meta Store is a product-forward retail experience built to sell hardware — Quest VR headsets, Ray-Ban Meta smart glasses, and accessories. The design walks a tightrope between consumer electronics showroom and lifestyle editorial, deploying cinematic product photography against expansive white canvas to create a gallery-like sense of aspiration. Every design decision serves the merchandise: generous negative space frames hero product shots like museum pieces, while alternating light and dark surface sections create a visual rhythm that mimics the experience of walking through a physical retail space.

The "Dolly" design system (Meta's internal name for the store layer) sits atop the broader FDS (Facebook Design System) foundation, inheriting its gray scale and semantic tokens while overlaying its own product-focused palette. The result is a system that feels distinctly Meta — the custom Optimistic typeface brings warmth and approachability to what could otherwise be cold tech retail — yet flexible enough to showcase wildly different product lines (from VR headsets to fashion eyewear) without feeling disjointed. The surface strategy is binary: pure white for browsing and information, rich dark for immersive product moments.

The store's visual hierarchy is ruthlessly simple. Photography does the heavy lifting, supported by short, punchy headlines in Optimistic Medium and body text that stays brief and scannable. Calls to action are pill-shaped, unmistakable, and always Meta Blue. There is no visual noise, no decoration for decoration's sake — every element either sells or navigates.

**Key Characteristics:**
- Photography-first retail design where products are the visual heroes, not UI
- Binary surface strategy: pure white for information, deep dark for immersive product moments
- Pill-shaped CTAs in saturated blue create unmistakable action points
- Optimistic VF typeface with OpenType ss01/ss02 features brings geometric warmth
- Generous whitespace frames products like gallery exhibits
- 8px spacing grid with disciplined vertical rhythm
- Alternating light/dark sections create a "walkthrough" retail cadence

## 2. Color Palette & Roles

### Primary
- **Meta Blue** (`#0064E0`): Primary CTA background, interactive links, action-driving elements throughout the store
- **Meta Blue Hover** (`#0143B5`): Darkened blue for hover states on primary buttons
- **Meta Blue Pressed** (`#004BB9`): Deepest blue for active/pressed button states
- **Meta Blue Light** (`#47A5FA`): Lighter blue variant used on dark backgrounds for CTAs
- **Facebook Blue** (`#1877F2`): Legacy accent inherited from FDS, used for deemphasized button text and badges

### Secondary & Accent
- **Ray-Ban Red** (`#D6311F`): Product-specific accent for Ray-Ban Meta smart glasses sections
- **Oculus Purple** (`#A121CE`): Quest/Oculus product accent for VR content
- **Work Purple** (`#6441D2`): Accent for Meta for Work/enterprise content
- **Portal Blue** (`#1B365D`): Deep navy accent for Portal product line
- **Portal Hero Blue** (`#C8E4E8`): Soft teal-blue for Portal hero backgrounds
- **Portal Light Blue** (`#ADD4E0`): Secondary Portal surface tint

### Surface & Background
- **White** (`#FFFFFF`): Primary page canvas, nav bar background, card surfaces
- **Soft Gray** (`#F1F4F7`): Secondary background for content sections (--dolly-bg-grey)
- **Warm Gray** (`#F7F8FA`): Flat card background, subtle surface differentiation
- **Web Wash** (`#F0F2F5`): Deemphasized background areas, attachment footers
- **Linen** (`#F2F0E6`): Warm off-white for lifestyle-adjacent sections
- **Baby Blue** (`#E8F3FF`): Highlight background, subtle blue tint for informational areas
- **Near Black** (`#1C1E21`): Dark section backgrounds, immersive product showcase areas
- **Oculus Light** (`#181A1B`): Slightly warm dark surface for Quest product sections
- **Oculus Dark** (`#000000`): Pure black for maximum contrast product displays
- **Overlay** (`rgba(0, 0, 0, 0.6)`): Modal/lightbox backdrop

### Neutrals & Text
- **Primary Text** (`#050505`): Main body and heading text on light surfaces
- **Dark Charcoal** (`#1C2B33`): Dolly system primary text, slightly warmer than pure black (--dolly-text-primary)
- **Icon Secondary** (`#465A69`): Secondary icon fills, subdued UI elements
- **Secondary Text** (`#65676B`): Supporting copy, labels, timestamps (--secondary-text)
- **Slate Gray** (`#5D6C7B`): Meta Store secondary text, product descriptions (--dolly-text-secondary)
- **Section Header** (`#4B4C4F`): Mid-gray for section titles
- **Button Text Gray** (`#444950`): FDS button text default (--fds-button-text)
- **Disabled Text** (`#BCC0C4`): Inactive button labels, placeholder text
- **CTA Disabled Text** (`#8595A4`): Muted blue-gray for disabled interactive labels
- **Divider** (`#CED0D4`): Content separators, input borders
- **Divider Gray** (`#DEE3E9`): Lighter divider for Dolly sections
- **CTA Gray Border** (`#CBD2D9`): Outline button borders
- **Dark Gray Border** (`#909396`): Stronger outline for emphasis

### Semantic & Accent
- **Success Green** (`#31A24C`): Badge success background, positive indicators
- **Store Success** (`#007D1E`): Darker success green for Dolly store confirmations
- **Error Red** (`#E41E3F`): Critical badge background, notification badges
- **Store Error** (`#C80A28`): Darker error red for Dolly store error states
- **Warning Amber** (`#F7B928`): Attention badges, caution indicators
- **Positive BG** (`rgba(36, 228, 0, 0.15)`): Subtle success background tint
- **Error BG** (`rgba(255, 123, 145, 0.15)`): Subtle error background tint
- **Warning BG** (`rgba(255, 226, 0, 0.15)`): Subtle warning background tint
- **Info BG** (`rgba(0, 145, 255, 0.15)`): Subtle informational blue tint

### Base Color Spectrum (FDS)
- **Cherry** (`#F3425F`): Expressive accent
- **Grape** (`#9360F7`): Purple accent
- **Lime** (`#45BD62`): Green accent
- **Seafoam** (`#54C7EC`): Cyan accent
- **Teal** (`#2ABBA7`): Teal accent
- **Tomato** (`#FB724B`): Orange accent
- **Pink** (`#FF66BF`): Pink accent

## 3. Typography Rules

### Font Family
- **Primary:** Optimistic VF (variable font by Dalton Maag, commissioned by Meta)
- Fallbacks: Montserrat, Helvetica, Arial, Noto Sans
- OpenType features: `"ss01", "ss02"` — stylistic sets that activate Meta-specific alternate glyphs
- Variable font with continuous weight axis (observed: 300, 400, 500, 700)

### Hierarchy
| Role | Size | Weight | Line Height | Letter Spacing | Notes |
|------|------|--------|-------------|----------------|-------|
| Display 1 | 64px | 500 (Medium) | 1.16 | — | Hero headlines on desktop, ss01+ss02 |
| Display 2 | 48px | 500 (Medium) | 1.17 | — | Section heroes, product titles |
| Heading 1 | 36px | 500 (Medium) | 1.28 | — | Major section headings |
| Heading 2 | 28px | 300 (Light) | 1.21 | — | Subheadings, lighter feel |
| Heading 3 | 18px | 700 (Bold) | 1.44 | — | Card titles, bold callouts, ss01+ss02 |
| Body | 18px | 400 (Regular) | 1.44 | — | Product descriptions, body copy |
| Body Compact | 16px | 500 (Medium) | 1.50 | -0.16px | Nav links, UI labels |
| Caption Bold | 14px | 700 (Bold) | 1.43 | — | Price text, emphasis |
| Caption | 14px | 400 (Regular) | 1.43 | -0.14px | Secondary labels |
| Small | 12px | 400 (Regular) | 1.33 | — | Footer links, legal text |
| Button | 14px | 400 (Regular) | 1.43 | -0.14px | Button label text |

### Principles
Optimistic VF is the cornerstone of Meta's typographic identity — a humanist sans-serif with geometric underpinnings that strikes a balance between Silicon Valley precision and consumer warmth. The "ss01" and "ss02" stylistic sets introduce alternate glyphs that give headlines a distinctive Meta character. Weight 500 (Medium) dominates headlines, creating a presence that commands without shouting, while the unexpected use of weight 300 (Light) at 28px adds an airy, editorial quality to subheadings. Negative letter-spacing at smaller sizes (-0.14px to -0.16px) tightens the optical rhythm for UI elements, keeping the reading experience crisp and efficient.

## 4. Component Stylings

### Buttons
- **Primary (Pill)**: Background Meta Blue (`#0064E0`), Text White (`#FFFFFF`), Border: none, Radius: fully rounded pill (100px), Padding: 10px 22px, Font: Optimistic VF, 14px, regular, -0.14px tracking
- **Secondary (Outlined Pill)**: Background: transparent, Text: Dark Charcoal (`#1C2B33`) at 50% opacity, Border: 2px solid `rgba(10, 19, 23, 0.12)`
- **Ghost/Link Button**: Background: transparent, Text: Link Blue (`#385898`), Radius: 24px, Padding: 4px 12px
- **Disabled**: Background: `#DEE3E9`, Text: `#8595A4`

### Cards & Containers
- Background: White (`#FFFFFF`) or Flat Gray (`#F7F8FA`)
- Corner radius: 20px for standard cards, 24px for product feature cards
- Shadow: `0 12px 28px 0 rgba(0,0,0,0.2), 0 2px 4px 0 rgba(0,0,0,0.1)` for elevated cards
- Product cards use full-bleed imagery with text overlay on dark gradient

### Inputs & Forms
- Background: White (`#FFFFFF`)
- Border: 1px solid `#CED0D4`
- Border radius: 8px
- Focus: border color shifts to accent blue `hsl(214, 89%, 52%)`, 3px outer ring
- Error: border and label color `hsl(350, 87%, 55%)`
- Placeholder: `#65676B`

### Navigation
- Background: White (`#FFFFFF`), sticky at top
- Frosted glass effect: `rgba(241, 244, 247, 0.8)` with backdrop-filter blur
- Links: Optimistic VF, 16px/500, Dark Charcoal (`#1C2B33`)
- CTA: Blue pill button, right-aligned

## 5. Layout Principles

### Spacing System
- Base unit: 8px
- Scale: 1px, 4px, 8px, 10px, 12px, 14px, 16px, 18px, 24px, 32px, 40px, 48px, 64px, 80px

### Grid & Container
- Max container width: ~1440px, centered with auto margins
- Product grid: 3-column desktop, 2-column tablet, 1-column mobile

### Border Radius Scale
| Value | Context |
|-------|---------|
| 8px | Inputs, small UI elements |
| 20px | Cards |
| 24px | Feature cards |
| 100px | Pill buttons, badges |

## 6. Depth & Elevation
| Level | Treatment | Use |
|--------|-----------|-----|
| Flat | No shadow | Default cards, sections |
| Level 1 | `0 2px 4px rgba(0,0,0,0.1)` | Subtle lift for interactive cards |
| Level 2 | Dual shadow: ambient + direct | Elevated cards, dropdowns |
| Overlay | `rgba(0,0,0,0.6)` full-screen | Modal/lightbox backdrop |
| Inset | `rgba(255,255,255,0.5) inset` | Inner glow on glass-effect surfaces |

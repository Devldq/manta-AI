# Design System Inspired by HashiCorp

## 1. Visual Theme & Atmosphere

HashiCorp's website operates on a deliberate surface duality: vast expanses of pure white for information and navigation, punctuated by deep dark surfaces for hero moments and product showcases. The design philosophy mirrors their infrastructure-as-code mission — clean surfaces where every element is declarative, purposeful, and positioned with precision.

The typography tells a story of enterprise-grade capability: custom HashiCorp Sans handles all functional text, eschewing mainstream typefaces in favor of a proprietary voice. Weight 400 (Regular) dominates body text, while 600 (Semi-Bold) signals headers and emphasis. The fonts render with exceptional clarity, optimized for documentation-heavy contexts where engineers spend hours reading.

**Key Characteristics:**
- Dual-surface system: white information zones + dark hero zones
- HashiCorp Sans as proprietary typeface — no fallback to mainstream fonts
- Multi-product color system — each tool has its accent (Terraform Purple, Vault Blue, etc.)
- MDS (Modern Design System) CSS variables prefixed with `mds-`
- Extreme shadow restraint — 0.05 opacity maximum
- Zero border radius on buttons in dark contexts
- Sidebar navigation pattern for documentation
- Gradient backgrounds combining brand colors for dark hero sections

## 2. Color Palette & Roles

### Primary
- **HashiCorp Red** (`#000000` in practice): Brand identity — used on logo and hero moments
- **Pure White** (`#ffffff`): Primary light surface, navigation, content zones
- **Deep Black** (`#000000`): Dark hero surfaces, footer

### Product Accent Colors
- **Terraform Purple** (`#7b42bc`): Infrastructure-as-code accent
- **Vault Blue** (`#00a1c9`): Secrets management accent
- **Consul Green** (`#00a890`): Service mesh accent
- **Nomad Teal** (`#0067b3`): Workload orchestration accent
- **Packer Blue** (`#02a8ef`): Machine image accent
- **Boundary Orange** (`#ff4f00`): Secure access accent
- **Waypoint Gray** (`#606060`): Application deployment accent

### Interactive
- **Link Blue** (`#1563ff`): Primary link color, interactive elements
- **Hover State**: Darkened brand color

### Surface & Background
- **White** (`#ffffff`): Primary light surface
- **Off White** (`#fafafa`): Alternate light surface
- **Light Gray** (`#f6f6f6`): Tertiary surface
- **Dark Gray** (`#1f1f1f`): Dark surfaces
- **Gradient Dark**: Combines product colors for dark hero backgrounds

### Neutrals & Text
- **Primary Text** (`#000000`): On light surfaces
- **White Text** (`#ffffff`): On dark surfaces
- **Gray 700** (`#4a4a4a`): Secondary text
- **Gray 500** (`#6e6e6e`): Tertiary text

## 3. Typography Rules

### Font Family
- **Primary**: `HashiCorp Sans`, fallbacks: `system-ui, sans-serif`
- No alternative fonts used — HashiCorp Sans covers all contexts

### Hierarchy
| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Display | 56px | 600 | 1.10 |
| Section Heading | 40px | 600 | 1.20 |
| Heading | 28px | 600 | 1.25 |
| Sub-heading | 20px | 600 | 1.30 |
| Body | 16px | 400 | 1.50 |
| Caption | 14px | 400 | 1.43 |

## 4. Component Stylings

### Buttons
- **Primary Dark**: Background `#1f1f1f`, Text `#ffffff`, Radius 0px
- **Primary Light**: Background `#ffffff`, Border `1px solid #000000`
- **Outlined**: Border `1px solid #1563ff`, Background transparent

### Inputs
- Background: `#ffffff`
- Border: `1px solid #e0e0e0`
- Focus: border to `#1563ff`

### Cards & Containers
- Background: white or dark surface
- Radius: 4px
- Shadow: extreme restraint (0.05 opacity)

## 5. Layout Principles

### Spacing System
- Base unit: 8px
- Scale: 4px, 8px, 12px, 16px, 24px, 32px, 48px

### Border Radius Scale
- 0px: Buttons in dark contexts
- 4px: Cards, inputs

## 6. Depth & Elevation
| Level | Treatment | Use |
|--------|-----------|-----|
| Flat | No shadow | Default surfaces |
- Extreme shadow restraint; depth from surface color contrast

# Design System Inspired by Miro

## 1. Visual Theme & Atmosphere

Miro's website is an infinite whiteboard brought to life — a digital canvas where collaboration, creativity, and visual thinking converge. The design is built on a pure white foundation (`#ffffff`) that serves as a literal blank canvas, inviting users to imagine what they might create. This whiteness isn't sterile; it's aspirational — the design language constantly reinforces the idea that Miro is a space for unlimited visual expression.

The typography tells a dual story: Roobert PRO Medium appears as the display face for headlines, bringing a geometric warmth that feels hand-crafted yet digital — perfect for a visual collaboration tool. Noto Sans handles all body and UI text with reliable, international character support. The type system stays small (rarely above 30px) because the real visual heroes are the colorful illustrations and product screenshots that dominate every section.

Color is used with joyful restraint. Blue 450 (`#5b76fe`) serves as the primary interactive color, but the palette includes a rainbow of soft pastels and vivid accents (Yellow, Pink, Green, Coral, Purple) that appear in illustrations, badge highlights, and category indicators. The result is a system that feels like a well-stocked art supply cabinet — organized, inviting, and ready for creation.

**Key Characteristics:**
- Pure white canvas background (`#ffffff`) as infinite creative space
- Roobert PRO Medium for display headlines — geometric warmth
- Noto Sans for body/UI — international, reliable, clean
- Blue 450 (`#5b76fe`) as primary interactive color
- Rainbow accent palette for illustrations and category indicators
- Generous whitespace creating gallery-like product showcases
- Framer-built with smooth scroll-triggered animations
- Pill-shaped buttons and badges for tactile approachability
- Colorful illustrations with hand-drawn, human aesthetic

## 2. Color Palette & Roles

### Primary Interactive
- **Blue 450** (`#5b76fe`): Primary links, buttons, active states
- **Blue 350** (`#7b8cff`): Hover states, softer interactive
- **Blue 550** (`#4b5cff`): Pressed states, stronger emphasis

### Accent Spectrum
- **Yellow 450** (`#ffd700`): Highlight, attention, energy
- **Pink 450** (`#ff6ec7`): Creative, playful accent
- **Green 450** (`#00c875`): Success, positive indicators
- **Coral 450** (`#ff6b6b`): Warm accent, notifications
- **Purple 450** (`#9b7cff`): Innovation, special features

### Surface & Background
- **Pure White** (`#ffffff`): Primary canvas background
- **Soft Gray** (`#f5f5f7`): Alternate surface, card backgrounds
- **Light Tint** (`rgba(91, 118, 254, 0.05)`): Subtle blue tint surface

### Text
- **Dark** (`#1f1f1f`): Primary text on light
- **Gray** (`#5e5e5e`): Secondary text, descriptions
- **Light Gray** (`#8e8e8e`): Tertiary text, muted content

## 3. Typography Rules

### Font Family
- **Display**: `Roobert PRO Medium` — geometric display face with warmth
- **Body / UI**: `Noto Sans`, fallbacks: `-apple-system, system-ui, sans-serif`

### Hierarchy
| Role | Font | Size | Weight | Line Height | Notes |
|------|------|------|--------|-------------|-------|
| Display Hero | Roobert PRO | 48px | 500 | 1.10 | Maximum impact |
| Section Heading | Roobert PRO | 32px | 500 | 1.20 | Feature sections |
| Card Title | Roobert PRO | 24px | 500 | 1.25 | Card and feature headings |
| Body Large | Noto Sans | 20px | 400 | 1.50 | Lead paragraphs |
| Body | Noto Sans | 16px | 400 | 1.50 | Standard reading |
| Caption | Noto Sans | 14px | 400 | 1.43 | Secondary text |
| Button | Noto Sans | 14px | 500 | 1.43 | Primary CTAs |

## 4. Component Stylings

### Buttons
- **Primary Blue Pill**: Background `#5b76fe`, Text `#ffffff`, Radius 999px, Padding 12px 24px
- **Secondary White**: Background `#ffffff`, Border `1px solid #e0e0e0`
- **Pill Badge**: Background tints of accent colors, Radius 999px

### Cards & Containers
- Background: `#ffffff` with subtle shadow or `#f5f5f7`
- Radius: 12px for standard cards, 16px for featured
- Border: subtle gray or none

## 5. Layout Principles

### Spacing System
- Base unit: 8px
- Scale: 8px, 12px, 16px, 24px, 32px, 48px, 64px, 80px

### Border Radius Scale
- Small (4px): Tags, small elements
- Standard (8px): Inputs
- Comfortable (12px): Cards
- Large (16px): Featured cards
- Pill (999px): Buttons, badges

## 6. Depth & Elevation
| Level | Treatment | Use |
|--------|-----------|-----|
| Flat | No shadow | Default surfaces |
- Minimal shadow system; depth from layer colors

## 7. Do's and Don'ts

### Do
- Keep white background on main content
- Use colorful accents in illustrations
- Apply pill-shaped buttons and badges
- Include hand-drawn aesthetic illustrations

### Don't
- Don't overuse color — white is the canvas
- Don't make typography too large — illustrations dominate

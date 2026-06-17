---
name: Manta
description: AI Native 智能体应用平台 — 精准、并行、掌控
colors:
  warm-stone-bg: "#f8f6f0"
  deep-abyss-bg: "#0a0a14"
  emerald-accent: "#2d8a4e"
  emerald-accent-hover: "#256f3e"
  emerald-accent-subtle: "#e8f5e9"
  warm-stone-text: "#1a1a1a"
  warm-stone-text-secondary: "#5a5a5a"
  warm-stone-text-muted: "#8a8a8a"
  warm-stone-border: "#e0ddd5"
  warm-stone-border-subtle: "#ece9e1"
  warm-stone-surface: "#ffffff"
  warm-stone-surface-elevated: "#ffffff"
  deep-abyss-text: "#e8e8e8"
  deep-abyss-text-secondary: "#a0a0a0"
  deep-abyss-text-muted: "#707070"
  deep-abyss-border: "#2a2a3a"
  deep-abyss-border-subtle: "#1a1a2a"
  deep-abyss-surface: "#141420"
  deep-abyss-surface-elevated: "#1e1e2e"
typography:
  display:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "clamp(2rem, 5vw, 3.5rem)"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "normal"
  body:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.01em"
  mono:
    fontFamily: "JetBrains Mono, Fira Code, Cascadia Code, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
  xl: "16px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
  3xl: "48px"
  4xl: "64px"
components:
  button-primary:
    backgroundColor: "{colors.emerald-accent}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "10px 20px"
  button-primary-hover:
    backgroundColor: "{colors.emerald-accent-hover}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.warm-stone-text}"
    rounded: "{rounded.md}"
    padding: "10px 20px"
  card:
    backgroundColor: "{colors.warm-stone-surface}"
    textColor: "{colors.warm-stone-text}"
    rounded: "{rounded.lg}"
    padding: "16px"
  input:
    backgroundColor: "{colors.warm-stone-surface}"
    textColor: "{colors.warm-stone-text}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
---

# Design System: Manta

## 1. Overview

**Creative North Star: "The Task Commander"**

Manta 的设计系统以「任务指挥官」为核心隐喻——用户是指挥官，界面是指挥中心。每个 UI 元素都服务于并行任务管理：紧凑但可区分，状态一目了然，信息密度高但无冗余。

这套系统拒绝通用 AI 生成界面的陈词滥调：不用 Inter 字体，不用青紫渐变，不用毛玻璃效果，不用发光点缀。它追求的是精密工具感——像手术器械或航空仪表盘，每条数据都有其位置，每个交互都有其目的。

**Key Characteristics:**
- **Parallel-first**: 每个组件都考虑「同时有 N 个实例在运行」
- **Content-first**: 界面服务于信息，不反向
- **Tinted neutrals**: 绝不用纯黑/纯白/纯灰，所有中性色带 subtle 色调
- **Named easing**: 所有过渡使用命名缓动曲线（ease-out-quart/expo）
- **Focus for all**: 所有可交互元素必须有 focus-visible 指示器
- **Space with rhythm**: 分组紧凑（4-8px），区间慷慨（24-48px）

## 2. Colors: The Command Palette

Manta 的颜色系统采用双主题策略：亮色主题（Warm Stone + Emerald）和暗色主题（Deep Abyss + Emerald）。绿色是唯一的强调色，避免多色干扰并行任务时的注意力。

### Primary
- **Emerald Accent** (#2d8a4e): 行动确认、运行状态、交互反馈。用于按钮、链接、状态指示器、选中状态。这是系统中唯一的强调色，其稀有性是重点。

### Neutral (Light Theme)
- **Warm Stone Background** (#f8f6f0): 主背景色，带轻微暖色调，避免纯白的刺眼感。
- **Warm Stone Surface** (#ffffff): 卡片、面板、输入框背景。
- **Warm Stone Text** (#1a1a1a): 主要文本，高对比度确保可读性。
- **Warm Stone Text Secondary** (#5a5a5a): 次要文本，用于描述、标签。
- **Warm Stone Text Muted** (#8a8a8a): 弱化文本，用于时间戳、辅助信息。
- **Warm Stone Border** (#e0ddd5): 主要边框，用于分隔区域。
- **Warm Stone Border Subtle** (#ece9e1): 次要边框，用于内部分隔。

### Neutral (Dark Theme)
- **Deep Abyss Background** (#0a0a14): 主背景色，冷黑色调，避免纯黑的沉闷感。
- **Deep Abyss Surface** (#141420): 卡片、面板背景。
- **Deep Abyss Surface Elevated** (#1e1e2e): 提升的表面，用于弹窗、下拉菜单。
- **Deep Abyss Text** (#e8e8e8): 主要文本。
- **Deep Abyss Text Secondary** (#a0a0a0): 次要文本。
- **Deep Abyss Text Muted** (#707070): 弱化文本。
- **Deep Abyss Border** (#2a2a3a): 主要边框。
- **Deep Abyss Border Subtle** (#1a1a2a): 次要边框。

### Status Colors
- **Pending** (#d97706): 等待状态，橙色调。
- **Running** (#3b82f6): 运行状态，蓝色调。
- **Done** (#2d8a4e): 完成状态，与主强调色一致。
- **Failed** (#dc2626): 失败状态，红色调。
- **Archived** (#6b7280): 归档状态，中性灰。
- **Planning** (#8b5cf6): 规划状态，紫色调。

### Named Rules
**The One Voice Rule.** 主强调色（Emerald）仅用于 ≤10% 的屏幕面积。其稀有性是重点——它只出现在需要用户注意的关键交互点。

**The Tinted Neutral Rule.** 绝不用纯黑（#000）、纯白（#fff）或纯灰（#808080）。所有中性色必须带 subtle 色调（chroma ≥ 0.003），亮色主题偏暖（hue 95），暗色主题偏冷（hue 260）。

## 3. Typography

**Display Font:** system-ui, -apple-system, sans-serif（系统字体栈，避免从外部加载）
**Body Font:** system-ui, -apple-system, sans-serif（与 Display 一致，通过字重区分层级）
**Mono Font:** JetBrains Mono, Fira Code, Cascadia Code, monospace（代码、数据、精确信息）

**Character:** 系统字体栈提供最佳的跨平台一致性和加载速度。通过字重（400/500/600）和大小（0.875rem/1rem/1.25rem/1.75rem/clamp）建立清晰的视觉层级。等宽字体用于代码和数据，传递精准感。

### Hierarchy
- **Display** (600, clamp(2rem, 5vw, 3.5rem), 1.1): 仅用于页面主标题，最大不超过 3.5rem。
- **Headline** (600, 1.75rem, 1.2): 区域标题，用于主要章节。
- **Title** (600, 1.25rem, 1.3): 卡片标题、面板标题。
- **Body** (400, 1rem, 1.6): 正文内容，最大行宽 65-75ch。
- **Label** (500, 0.875rem, 1.4): 标签、按钮文本、表单标签。
- **Mono** (400, 0.875rem, 1.5): 代码、数据、时间戳、精确信息。

### Named Rules
**The System Font Rule.** 不使用外部字体服务（Google Fonts、Adobe Fonts）。系统字体栈提供最佳性能和跨平台一致性，同时避免 FOUT（Flash of Unstyled Text）。

**The Mono Precision Rule.** 等宽字体仅用于代码、数据和需要精确对齐的信息。不要用于普通文本，那会破坏阅读节奏。

## 4. Elevation

Manta 采用平面设计（flat design）为主，通过色调和微妙的边框变化来传达层级，而非阴影。这符合「精密工具感」的定位——像航空仪表盘，信息通过颜色和间距区分，而非浮起效果。

在暗色主题中，使用 `surface-elevated`（#1e1e2e）来表示提升的层级（弹窗、下拉菜单），而非阴影。在亮色主题中，`surface-elevated` 与 `surface` 相同（#ffffff），通过边框区分。

### Shadow Vocabulary
Manta 不使用传统阴影。如果需要阴影效果（如模态框），使用极淡的边框 + 背景色差异来模拟。

### Named Rules
**The Flat-By-Default Rule.** 表面默认是平坦的。层级差异通过色调（surface vs surface-elevated）和边框（border vs border-subtle）传达，而非阴影。

## 5. Components

### Buttons
- **Shape:** 圆角矩形（8px radius），紧凑但可点击。
- **Primary:** 背景 `emerald-accent`（#2d8a4e），文本白色，padding 10px 20px。用于主要操作（确认、提交、运行）。
- **Hover:** 背景 `emerald-accent-hover`（#256f3e），transition 100ms ease-out-quart。
- **Ghost:** 背景透明，文本 `text-primary`，边框 `border-subtle`。用于次要操作（取消、返回）。
- **Focus:** 2px solid `emerald-accent`，offset 2px，仅在 :focus-visible 时显示。

### Cards / Containers
- **Corner Style:** 圆角 12px（lg）。
- **Background:** `surface`（亮色 #ffffff，暗色 #141420）。
- **Border:** 1px solid `border-subtle`。
- **Internal Padding:** 16px。
- **Hover:** 边框变为 `emerald-accent`，transition 100ms ease-out-quart。

### Inputs / Fields
- **Style:** 背景 `surface`，边框 `border`，圆角 8px（md），padding 10px 12px。
- **Focus:** 边框变为 `emerald-accent`，transition 100ms ease-out-quart。
- **Placeholder:** 文本 `text-muted`，对比度 ≥ 4.5:1。

### Navigation (Sidebar)
- **Background:** `sidebar-bg`（亮色 #ece9e1，暗色 #0a0a14）。
- **Text:** `sidebar-text`（亮色 #1a1a1a，暗色 #e8e8e8）。
- **Active Item:** 背景 `accent-subtle`，文本 `accent`。
- **Hover:** 背景 `border-subtle`。
- **Width:** 240px（展开），64px（折叠）。

### Task Cards (Signature Component)
- **Shape:** 圆角 12px，紧凑布局（gap 8px，padding 12px 16px）。
- **Layout:** Flex 行布局，左侧状态指示器，中间内容，右侧操作。
- **Status Indicator:** 小圆点（3px），颜色随状态变化（pending/running/done/failed）。
- **Hover:** 边框变为 `emerald-accent`，显示停止按钮（opacity 0→1）。
- **Active:** 边框 `emerald-accent`，背景 `accent-subtle`。
- **Animation:** 卡片进入动画（card-enter），300ms ease-out-quart。

### Thinking Indicator (Signature Component)
- **Shape:** 三个小圆点（3px），水平排列。
- **Animation:** 呼吸动画（dot-breathe），1.4s ease-in-out-quart infinite，交错延迟 180ms。
- **Color:** `emerald-accent`。

## 6. Do's and Don'ts

### Do:
- **Do** 使用命名缓动曲线（ease-out-quart/expo），不用 CSS 默认 ease。
- **Do** 为所有可交互元素添加 focus-visible 指示器（2px solid accent，offset 2px）。
- **Do** 使用 4pt 间距系统（4/8/12/16/24/32/48/64px），保持节奏感。
- **Do** 使用系统字体栈，避免外部字体加载。
- **Do** 使用 OKLCH 色彩空间进行颜色变换，确保感知均匀。
- **Do** 支持 reduced-motion，所有动画在 `prefers-reduced-motion: reduce` 时禁用。
- **Do** 使用 `text-wrap: balance` 优化标题换行，`text-wrap: pretty` 优化长文本。

### Don't:
- **Don't** 使用 Inter 字体——这是 2024-2025 年 AI 生成界面的头号特征。
- **Don't** 使用青紫渐变（purple-to-blue gradients）——这是 AI 生成界面的典型套路。
- **Don't** 使用毛玻璃效果（glassmorphism）作为默认装饰——罕见且有目的时才用。
- **Don't** 使用发光点缀（glowing dots、neon accents）——这是 AI 生成界面的陈词滥调。
- **Don't** 使用 hero metrics 模板（大数字 + 小标签 + 渐变强调）——SaaS  cliché。
- **Don't** 使用嵌套卡片（cards nested inside cards）——总是错误的。
- **Don't** 使用弹跳/弹性缓动（bounce/elastic easing）——感觉过时。
- **Don't** 使用纯黑（#000）、纯白（#fff）或纯灰（#808080）——所有中性色必须带色调。
- **Don't** 在彩色背景上使用灰色文本——看起来褪色，使用背景色自身的深色变体。
- **Don't** 使用侧边条纹边框（border-left/right > 1px 作为彩色强调）——总是无意的。
- **Don't** 使用渐变文本（background-clip: text + gradient）——装饰性，无意义。

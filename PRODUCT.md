# Product

## Register

product

## Users

**Target audience**: 软件工程师与高级开发者，需要 AI 协作完成大规模、多线程的工程任务

**Context**: 桌面端优先（Electron + Web），支持亮/暗双模式，以**任务看板 + 会话**为核心交互模型

**Job to be done**: 同时追踪和管理多个 AI 子任务的进展，快速切换上下文，高效决策

**Mental model**: 像「任务指挥官」— 分发指令，并行监控，按需介入

## Product Purpose

**Manta** 是一个 **AI Native 智能体应用平台**，核心能力是**并行处理多项任务**。用户可同时启动多个子任务（编码、搜索、分析、部署等），Agent 在后台并发执行，用户通过统一面板监控进展、查看结果。

核心理念是 **Agent as Application**：每个智能体应用都是一个独立的产品，拥有自己的知识库、工具能力、工作流和运行空间。

与传统 AI 助手的本质区别：
- **形态**: 持久化应用，持续迭代（vs 聊天框，用完即弃）
- **知识**: 独立 RAG 知识库，可喂养专属领域知识（vs 依赖模型预训练）
- **能力**: 可插拔工具 + 自定义工作流（vs 固定工具集）
- **运行**: 独立工作空间，支持记忆和上下文（vs 单次对话）
- **质量**: RAGAs + Agent 双维度评估（vs 靠感觉用）
- **可观测**: 全链路日志、会话回放（vs 黑盒）

## Brand Personality

**3-word**: Precise, Parallel, Commanding（精准、并行、掌控）

**Metaphor**: Manta（蝠鲼）— 幽灵般滑行于深海，双鳍如翼，无声而精准地覆盖大片海域（并行视野）

**Emotional goals**: 掌控感、效率感、专业信赖 — 用户感觉自己在「指挥」而非「等待」

## Anti-references

- 通用 AI 生成界面（Inter 字体、青紫渐变、毛玻璃、发光点缀、hero metrics 模板、单线程聊天窗口）
- 传统 SaaS 仪表板（信息密度过低，卡片嵌套，状态不清晰）
- 消费级应用（过度简化，缺乏专业感）

## Design Principles

1. **Parallel-first**: 每个 UI 组件都应考虑「同时有 N 个实例在运行」— 紧凑但可区分，状态一目了然
2. **Content-first**: 界面服务于信息，不反向
3. **Tinted neutrals**: 绝不用纯黑/纯白/纯灰 — 所有中性色必须带 subtle 色调（chroma ≥ 0.003）
4. **Easing must be named**: 不用 CSS 默认 ease，所有过渡使用命名缓动曲线（ease-out-quart/expo）
5. **Focus for all**: 所有可交互元素必须有 focus-visible 指示器，支持 reduced-motion
6. **Space with rhythm**: 分组的紧凑（4-8px）、区间慷慨（24-48px），用间距区分并行任务的边界

## Accessibility & Inclusion

- **WCAG Level**: AA 级标准
- **Reduced motion**: 所有动画必须支持 `prefers-reduced-motion: reduce`
- **Focus visibility**: 所有可交互元素必须有清晰的 focus-visible 指示器
- **Color contrast**: 文本与背景对比度 ≥ 4.5:1（大文本 ≥ 3:1）
- **Keyboard navigation**: 完整的键盘导航支持

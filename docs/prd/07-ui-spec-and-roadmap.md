# PRD 07 — UI 规范与实施路线图 / UI Spec & Roadmap

---

## 中文版

### 1. UI 设计原则

| 原则 | 说明 |
|------|------|
| **一致性** | 沿用现有 Manta 65 套主题体系，新页面完全兼容主题切换 |
| **渐进增强** | 现有页面零改动，新页面在 sidebar 添加导航入口 |
| **信息层级** | 列表 → 详情 → 编辑，三层级逐步深入 |
| **即时反馈** | 所有异步操作提供 loading 状态 + 成功/失败 toast |
| **防误操作** | 删除操作二次确认，未保存离开提示 |

### 2. 导航扩展

现有 sidebar 导航结构扩展：

```
侧边导航栏
├── 📋 任务 (已有 /tasks)
├── 💬 对话 (已有 /conversations)
├── 📦 应用 (升级 /apps)          ← 从占位页升级为完整功能
├── 🧠 知识库 (新增 /rag)          ← 新导航项
├── 📊 评估中心 (新增 /evaluation)  ← 新导航项
├── 🔌 MCP 管理 (已有 /mcp)
├── 🎨 主题 (已有 /themes)
├── ⚙️ 设置 (已有 /settings)
```

### 3. 页面路由规划

| 路由 | 页面 | 状态 | 组件 |
|------|------|------|------|
| `/apps` | 应用列表页 | 升级 | `AppListPage` |
| `/apps/[id]` | 应用详情页 | 新增 | `AppDetailPage` |
| `/apps/[id]/builder` | 应用搭建器 | 新增 | `AppBuilderPage` |
| `/apps/[id]/chat` | 应用对话页 | 新增 | `AppChatPage` |
| `/rag` | 知识库列表 | 新增 | `RagListPage` |
| `/rag/[id]` | 知识库详情 | 新增 | `RagDetailPage` |
| `/evaluation` | 评估列表 | 新增 | `EvalListPage` |
| `/evaluation/[id]` | 评估报告 | 新增 | `EvalReportPage` |
| `/evaluation/datasets` | 数据集管理 | 新增 | `DatasetListPage` |

### 4. 组件树规划

```
src/app/
├── apps/
│   ├── page.tsx                    # 应用列表 (升级现有占位)
│   ├── [id]/
│   │   ├── page.tsx                # 应用详情 (新增)
│   │   ├── builder/
│   │   │   └── page.tsx            # 应用搭建器 (新增)
│   │   └── chat/
│   │       └── page.tsx            # 应用对话 (新增)
├── rag/
│   ├── page.tsx                    # 知识库列表 (新增)
│   └── [id]/
│       └── page.tsx                # 知识库详情 (新增)
├── evaluation/
│   ├── page.tsx                    # 评估列表 (新增)
│   ├── [id]/
│   │   └── page.tsx                # 评估报告 (新增)
│   └── datasets/
│       ├── page.tsx                # 数据集列表 (新增)
│       └── [id]/
│           └── page.tsx            # 数据集详情 (新增)
├── components/
│   ├── app/                        # 应用相关组件 (新增)
│   │   ├── AppCard.tsx             # 应用卡片
│   │   ├── AppForm.tsx             # 应用表单
│   │   ├── AppStatusBadge.tsx      # 状态徽章
│   │   ├── BuilderTabs.tsx         # 搭建器标签导航
│   │   ├── AgentSelector.tsx       # Agent 选择器
│   │   ├── ToolSelector.tsx        # 工具选择器
│   │   ├── PreviewPanel.tsx        # 实时预览
│   │   └── AutomationForm.tsx      # 自动化配置表单
│   ├── rag/                        # 知识库相关组件 (新增)
│   │   ├── KbCard.tsx              # 知识库卡片
│   │   ├── DocumentList.tsx        # 文档列表
│   │   ├── DocumentUploader.tsx    # 文档上传器
│   │   ├── ChunkPreview.tsx        # 分块预览
│   │   ├── SearchTestPanel.tsx     # 检索测试面板
│   │   └── ProviderSelector.tsx    # Provider 选择器
│   ├── evaluation/                 # 评估相关组件 (新增)
│   │   ├── EvalCard.tsx            # 评估卡片
│   │   ├── EvalConfigForm.tsx      # 评估配置表单
│   │   ├── EvalProgress.tsx        # 评估进度
│   │   ├── ScoreRadar.tsx          # 雷达图
│   │   ├── ScoreBar.tsx            # 评分条
│   │   └── DatasetForm.tsx         # 数据集表单
│   └── shared/                     # 共享组件 (新增)
│       ├── ConfirmDialog.tsx       # 确认弹窗
│       ├── EmptyState.tsx          # 空状态
│       ├── SearchInput.tsx         # 搜索框
│       ├── StatusBadge.tsx         # 通用状态徽章
│       └── LoadingOverlay.tsx      # 加载遮罩
```

### 5. 状态管理规划

使用 Zustand 新增以下 Store：

```typescript
// stores/app-store.ts
interface AppStore {
  apps: App[];
  selectedApp: App | null;
  loading: boolean;
  error: string | null;
  
  fetchApps: (filter?: AppFilter) => Promise<void>;
  createApp: (data: CreateAppInput) => Promise<App>;
  updateApp: (id: string, data: UpdateAppInput) => Promise<void>;
  deleteApp: (id: string) => Promise<void>;
  cloneApp: (id: string, name?: string) => Promise<App>;
}

// stores/rag-store.ts
interface RagStore {
  knowledgeBases: KnowledgeBase[];
  selectedKb: KnowledgeBase | null;
  documents: KbDocument[];
  providers: RagProviderInfo[];
  
  fetchKBs: () => Promise<void>;
  createKB: (data: CreateKBInput) => Promise<KnowledgeBase>;
  uploadDocument: (kbId: string, file: File) => Promise<void>;
  processDocument: (kbId: string, docId: string) => Promise<void>;
  searchTest: (kbId: string, query: string, opts: SearchOptions) => Promise<SearchResult[]>;
}

// stores/eval-store.ts
interface EvalStore {
  evaluations: Evaluation[];
  selectedEval: Evaluation | null;
  datasets: Dataset[];
  progress: EvalProgress | null;
  
  startEval: (config: EvalConfig) => Promise<string>;
  cancelEval: (evalId: string) => Promise<void>;
  subscribeProgress: (evalId: string) => void;
  fetchDatasets: () => Promise<void>;
}
```

### 6. 样式规范

- **框架**：Tailwind CSS（沿用现有）
- **主题**：完全兼容 `theme.config.json` 的 65 套主题
- **动画**：使用 Tailwind 内置 transition + Framer Motion 处理复杂动画
- **响应式**：桌面端优先，支持窗口最小宽度 800px
- **加载状态**：骨架屏 (Skeleton) 用于列表/卡片，Spinner 用于按钮/操作
- **空状态**：统一使用插画 + 引导文案 + CTA 按钮

### 7. 实施路线图

#### Phase 1: 基础设施 (Sprint 1-2, 2 周)

| 任务 | 描述 | 优先级 |
|------|------|--------|
| 存储层扩展 | 实现 `~/.manta-data/apps/` 目录结构和文件 IO | P0 |
| AppManager 模块 | 应用 CRUD 核心逻辑，状态管理 | P0 |
| 应用列表页升级 | 从占位页升级为完整的应用列表（卡片、搜索、筛选） | P0 |
| 导航扩展 | sidebar 添加「知识库」「评估中心」入口 | P1 |
| 应用 API | 实现 `/api/apps` 全部 7 个端点 | P0 |

#### Phase 2: 应用搭建器 (Sprint 3-5, 3 周)

| 任务 | 描述 | 优先级 |
|------|------|--------|
| 应用详情页 | Tab 式布局，概览面板 | P0 |
| 基础信息配置 | 名称、描述、图标、标签表单 | P0 |
| Agent 配置面板 | Agent 选择器 + 参数覆盖 | P0 |
| 工具选择面板 | 多选列表 + 搜索过滤 | P1 |
| 自动化配置面板 | Cron/Webhook/Manual 配置 | P1 |
| 实时预览面板 | 配置效果实时预览 | P1 |
| 应用对话页 | 在应用空间内发起对话 | P0 |

#### Phase 3: RAG 知识库 (Sprint 6-8, 3 周)

| 任务 | 描述 | 优先级 |
|------|------|--------|
| IRagProvider 接口 | 定义 + SQLiteVec 实现 | P0 |
| 知识库 CRUD | 创建、管理知识库 | P0 |
| 文档上传流水线 | 上传 → 解析 → 分块预览 → 向量化 | P0 |
| 分块预览界面 | 可视化分块参数调整 + 结果预览 | P0 |
| 检索测试面板 | 查询输入 → 检索结果展示 → 参数调试 | P0 |
| ChromaDB Provider | 第二个 Provider 实现 | P1 |
| BM25 Provider | 关键词检索实现 | P2 |
| 文档列表管理 | 搜索、排序、批量操作 | P1 |

#### Phase 4: 评估流水线 (Sprint 9-11, 3 周)

| 任务 | 描述 | 优先级 |
|------|------|--------|
| RAGAs 集成 | RAGAs 框架适配 + 7 大维度 | P0 |
| 数据集管理 | CRUD + JSON/CSV 导入导出 | P0 |
| 评估流水线引擎 | 任务调度 + 并行执行 + SSE 进度 | P0 |
| Agent 评估实现 | 6 维度 Agent 行为评估 | P1 |
| 评估报告页 | 综合得分 + 维度详情 + 逐条钻取 | P0 |
| 报告导出 | JSON/HTML 格式导出 | P2 |
| Milvus Provider | 第三个 Provider 实现 | P2 |

#### Phase 5: 打磨与发布 (Sprint 12-13, 2 周)

| 任务 | 描述 | 优先级 |
|------|------|--------|
| E2E 测试 | 核心流程端到端测试 | P0 |
| 性能优化 | 首屏加载、大列表虚拟化、索引优化 | P0 |
| 国际化 | 中英文界面切换 | P1 |
| 文档 | 用户手册 + 开发者文档 | P1 |
| 错误处理完善 | 全链路错误状态覆盖 | P0 |
| UI 打磨 | 交互动效、空状态、加载态优化 | P1 |

### 8. 里程碑与交付物

| 里程碑 | 日期 (目标) | 交付物 |
|--------|-----------|--------|
| M1: 基础设施完成 | Sprint 2 结束 | 应用列表页可用，CRUD API ready |
| M2: 搭建器 MVP | Sprint 5 结束 | 应用搭建器完整可用（Agent + 工具 + 对话） |
| M3: RAG 知识库 MVP | Sprint 8 结束 | 文档处理流水线 + SQLiteVecProvider + 检索测试 |
| M4: 评估 MVP | Sprint 11 结束 | RAGAs 7 维度评估 + 数据集管理 + 报告 |
| M5: 正式发布 | Sprint 13 结束 | 全功能可用，文档齐全，测试覆盖 |

### 9. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| RAGAs 框架 API 不稳定 | 高 | 封装适配层，隔离框架变更 |
| Embedding API 成本 | 中 | 支持本地 Embedding 模型 (Ollama) |
| 向量数据库性能瓶颈 | 中 | 多 Provider 支持，按需切换 |
| 评估 LLM Judge 稳定性 | 中 | 支持重试 + 降级跳过 + 人工复核 |
| Electron 兼容性 | 低 | 所有功能在浏览器端开发，适配层最小化 |

### 10. 成功指标

| 指标 | 目标值 | 衡量方式 |
|------|--------|---------|
| 应用创建成功率 | > 95% | API 日志统计 |
| 文档处理成功率 | > 90% | 知识库日志统计 |
| 应用列表首屏加载 | < 1.5s | Performance API |
| 单次检索响应时间 | < 2s | 知识库 API 延迟监控 |
| 评估完成率 | > 85% | 评估流水线日志 |
| 用户 NPS | > 40 | 内置反馈问卷 |

---

## English Version

### 1. UI Design Principles

| Principle | Description |
|-----------|-------------|
| **Consistency** | Full compatibility with existing 65-theme system |
| **Progressive Enhancement** | Zero changes to existing pages; new pages added via sidebar |
| **Information Hierarchy** | List → Detail → Edit three-level navigation |
| **Instant Feedback** | Loading states + success/error toasts for all async operations |
| **Error Prevention** | Double confirmation for deletions, unsaved-changes warnings |

### 2. Navigation Extension

New sidebar entries: Apps (upgraded), Knowledge Base (new), Evaluation Center (new).

### 3. Route Planning

9 new/upgraded routes: `/apps`, `/apps/[id]`, `/apps/[id]/builder`, `/apps/[id]/chat`, `/rag`, `/rag/[id]`, `/evaluation`, `/evaluation/[id]`, `/evaluation/datasets`.

### 4. Component Architecture

New component directories: `app/` (8 components), `rag/` (6 components), `evaluation/` (6 components), `shared/` (5 components).

### 5. State Management

Three new Zustand stores: `app-store`, `rag-store`, `eval-store`.

### 6. Implementation Roadmap

| Phase | Duration | Key Deliverables |
|-------|----------|-----------------|
| Phase 1: Infrastructure | 2 weeks | Storage layer, AppManager, App list page, App APIs |
| Phase 2: App Builder | 3 weeks | Detail page, agent config, tool selector, automation, preview, chat |
| Phase 3: RAG Knowledge | 3 weeks | IRagProvider + SQLiteVec, document pipeline, chunk preview, search test, ChromaDB |
| Phase 4: Evaluation | 3 weeks | RAGAs integration, dataset management, eval pipeline, agent eval, reports |
| Phase 5: Polish & Release | 2 weeks | E2E tests, performance, i18n, docs, error handling |

### 7. Milestones

| Milestone | After | Deliverable |
|-----------|-------|-------------|
| M1 | Sprint 2 | App list + CRUD API |
| M2 | Sprint 5 | App Builder (agent + tools + chat) |
| M3 | Sprint 8 | Document pipeline + SQLiteVec + search test |
| M4 | Sprint 11 | RAGAs 7 dims + datasets + reports |
| M5 | Sprint 13 | Full release with docs and test coverage |

### 8. Risks & Mitigations

- RAGAs API instability → adapter layer
- Embedding API cost → local Ollama embedding support
- Vector DB performance → multi-provider support
- LLM Judge reliability → retry + skip + manual review

### 9. Success Metrics

| Metric | Target |
|--------|--------|
| App creation success rate | > 95% |
| Document processing success rate | > 90% |
| App list first paint | < 1.5s |
| Single search latency | < 2s |
| Evaluation completion rate | > 85% |
| User NPS | > 40 |

---

## 变更记录 / Changelog

| 日期 | 版本 | 变更说明 |
|------|------|---------|
| 2026-06-12 | v1.0 | 初始版本 |

---

> 上一篇：[PRD 06 — 数据模型与 API 设计](./06-data-model.md)
> 本篇为 PRD 系列最后一篇。

# Manta 项目记忆

## 项目架构
- Manta 是 LLM Agent 系统，Next.js + AI SDK
- `core/` 为核心逻辑层，`app/` 为 Next.js API 路由和前端
- 2025-05-25 重组了 `core/` 目录，按职责划分模块：
  - `core/chat/` — Agent Loop（循环执行、循环检测、流式处理）
  - `core/context/` — Prompt 与上下文管理（system-prompt、agent-soul）
  - `core/tools/` — 工具实现（file-tools、shell-tools、conversation-tools）
  - `core/tool-registry/` — 工具注册与发现
  - `core/conversation/` — 会话持久化（store + types）
  - `core/llm/` — LLM 配置与 AI SDK 集成（factory.ts 已废弃）
  - `core/log/` — 日志系统
  - `core/config/`、`core/fs/` — 配置与文件系统

## 用户偏好
- 使用简体中文沟通，要求简洁、行动导向
- 目录结构重组时保留现有目录名，不照搬外部参考
- 文件移动必须保证 import 路径正确、TypeScript 编译通过

## RAG 模块关键路径
- `packages/rag/` — RAG 核心包，`main` 指向 `./dist/index.js`，改 `.ts` 后必须 `pnpm --filter @manta/rag build`
- `packages/frontend/src/stores/rag-detail-store.ts` — RAG 详情页 Zustand store
- `packages/frontend/src/stores/lib/staged-files-db.ts` — IndexedDB 持久化暂存文件队列
- `packages/backend/src/routes/rag.ts` — RAG REST API 路由
- `packages/rag/src/sqlite-vec-provider.ts` — SQLite 向量存储 provider
- 批量上传并行数配置在 `ChunkingConfig.batchConcurrency`（1-5），UI 在 ChunkingConfigPanel
- 刷新恢复：IndexedDB 存 File 对象 + BatchMeta，`restoreBatchSession()` 在页面加载时恢复

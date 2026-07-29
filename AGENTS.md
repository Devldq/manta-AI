# Manta AI：本地优先的个人 AI 知识库与 Agent 调度桌面系统

TypeScript monorepo，使用 pnpm + Turborepo；Desktop 基于 Electron，前端基于 React 19 + Vite，本地 Service 通过 Fastify、REST/SSE、SDK、CLI、MCP 和 A2A 提供知识与任务能力。

## 常用命令

- `corepack pnpm install`：使用仓库锁定的 pnpm 安装依赖
- `corepack pnpm dev:desktop`：构建依赖并启动 Electron Desktop
- `corepack pnpm --filter @manta/frontend exec vitest run src/xxx.test.tsx`：运行单个前端测试文件，不要默认跑全量测试
- `corepack pnpm --filter @manta/backend exec vitest run src/xxx.test.ts`：运行单个后端测试文件，不要默认跑全量测试
- `corepack pnpm --filter @manta/frontend typecheck`：检查单个受影响包；把包名替换为实际修改的 `@manta/*` 包
- `corepack pnpm typecheck`：跨包改动或交付前运行全仓类型检查
- `corepack pnpm --filter @manta/frontend build`：构建单个受影响包；需要验证完整产物时再运行 `corepack pnpm build`
- `git diff --check`：交付前检查空白错误

## 项目结构

- `/packages/frontend` - React/Vite 渲染层、页面、组件、状态和 API 客户端
- `/packages/desktop` - Electron 主进程、preload、启动流程和桌面打包
- `/packages/backend` - Fastify API、Agent 引擎、业务服务和本地持久化兼容运行时
- `/packages/service` - 独立本地 Service 入口和后台 Worker 生命周期
- `/packages/contracts` - 公共 Zod Schema 与 TypeScript 类型，是跨包契约的事实源
- `/packages/rag`、`/packages/task-runtime`、`/packages/storage-hub` - RAG、持久化任务和本地存储核心能力
- `/packages/sdk`、`/packages/cli`、`/packages/mcp-server`、`/packages/a2a-server` - 对外访问入口，只通过公共契约和 Service 使用能力
- `/docs` - 产品、架构、开发、验证和故障排查文档
- `/scripts` - 开发启动、构建、发布、安全审计和验证脚本

## 重要约定

- 开发新功能的时候使用worktree在单独的分支开发，开发完完成合并到本地的main分支。
- 使用 Node.js 22+ 和仓库声明的 `pnpm@10.30.3`；保留 `pnpm-lock.yaml`，不要生成或提交其他根锁文件
- 任务执行、恢复和持久化属于 Backend/Service；Frontend 只负责订阅、重连和展示，不把长任务生命周期放进页面组件
- `@manta/contracts` 是公共契约源；修改 contracts 或 RAG 类型后，先构建上游包，再检查 Backend
- 原始资料始终是事实源；Embedding、Chunk、摘要、索引、`dist`、`coverage` 和缓存都是派生数据，不要手动维护生成物
- SDK、CLI、MCP 和 A2A 必须通过 Service/公共接口访问数据，不要直接读取内部数据库
- `.env`、`.env.*`、API Key、Token、Git 凭据和本地运行数据不得提交；存储、迁移、Secret 或备份改动前先读 `@docs/guides/agent-storage-hub.md`
- 保留用户已有的未提交改动；未经明确要求不要 commit、push 或 deploy
- 不要使用 `git push --force`；确需覆盖远端时使用 `git push --force-with-lease`
- Desktop/UI 改动不能只以进程存在、typecheck 或 build 通过作为验收；还要验证真实窗口、Renderer、Service 健康状态和用户可见流程

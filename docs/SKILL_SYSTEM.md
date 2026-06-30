# Manta Skill 技能系统设计文档

## 概述

Skill 是 Manta Agent 的「可复用能力模块」，类比代码中的函数/工具类，封装了特定场景的完整逻辑，供 Agent 自动匹配并调用。

## 架构设计

```
┌─────────────────────────────────────────────────────────────────┐
│                    Manta Skill System                            │
├─────────────────────────────────────────────────────────────────┤
│  Frontend (React SPA)                                           │
│  /skills — Skill 管理页面                                        │
│    • Skill CRUD（创建/查看/编辑/删除/启禁用）                      │
│    • 扫描导入 skills/ 中的 SKILL.md 文件                             │
│    • Agent 绑定/解绑管理（每个 Skill 可绑定多个 Agent）            │
│    • Skill 详情展开查看（参数/工具/指令/绑定关系）                 │
├─────────────────────────────────────────────────────────────────┤
│  Backend (Fastify)                                              │
│  /api/skills — RESTful API（共 11 个端点）                       │
│  /api/agents/names — Agent 名称列表（供绑定选择器使用）            │
├─────────────────────────────────────────────────────────────────┤
│  Storage                                                        │
│  {workspace}/.manta/skills/{id}.json — 管理数据持久化              │
│  skills/{name}/SKILL.md  — 源文件（YAML + Markdown）              │
└─────────────────────────────────────────────────────────────────┘
```

## 三种 Skill 类型

| 类型 | 图标 | 说明 | 适用场景 |
|------|------|------|---------|
| **writing** | 📝 | 写作类 | 周报、日报、技术文档、内容创作 |
| **tool** | 🔧 | 工具类 | 网页抓取、代码分析、数据查询 |
| **workflow** | ⚙️ | 流程类 | 代码审查流水线、自动化部署 |

## Skill 定义结构

```yaml
---
name: skill-unique-name        # 唯一标识，小写+数字+连字符
description: ...                # 描述（决定触发逻辑，≤1024字符）
version: 1.0.0
type: writing | tool | workflow
source: builtin | user | plugin
license: MIT
user-invocable: true
argument-hint: "[sub-command] [target]"
---
# 指令内容 (Markdown)
任务目标 / 规则 / 输出格式 / 注意事项
```

## Skill 与文件系统的联动

```
skills/                    →  后端扫描器  →  .manta/skills/
├── impeccable/SKILL.md        解析 YAML        ├── skill-xxx.json
├── code-review-pipeline/SKILL.md frontmatter      ├── skill-yyy.json
├── web-fetch-analyzer/SKILL.md                   └── skill-zzz.json
└── ...
```

**联动流程**：
1. 用户在 Skill 管理页点击「扫描导入」
2. 后端扫描项目 `skills/` 目录，解析所有 `SKILL.md` 的 YAML frontmatter + Markdown body
3. 展示扫描结果，标记「已导入/新发现」状态
4. 用户勾选要导入的 Skill → 写入 `{workspace}/.manta/skills/`
5. 后续可继续编辑、启用/禁用、绑定 Agent

## 核心设计原则

1. **单一职责**：一个 Skill 只做一件事
2. **描述驱动触发**：AI 通过 description 语义匹配决定何时调用
3. **强约束输出**：定义固定的输出格式，确保稳定性
4. **可组合性**：多个 Skill 可串联成工作流
5. **可演进**：版本管理、可迭代优化

## API 接口文档

### Skill CRUD

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/api/skills` | 获取 Skill 列表（支持 `?search=` 过滤） |
| GET | `/api/skills/:id` | 获取单个 Skill 完整定义 |
| POST | `/api/skills` | 创建新 Skill |
| PUT | `/api/skills/:id` | 更新 Skill（部分更新） |
| DELETE | `/api/skills/:id` | 删除 Skill |

### Skill 控制

| 方法 | 端点 | 说明 |
|------|------|------|
| PATCH | `/api/skills/:id/toggle` | 启用/禁用 Skill `{ enabled: true/false }` |

### Agent 绑定

| 方法 | 端点 | 说明 |
|------|------|------|
| PUT | `/api/skills/:id/bind` | 设置 Skill 绑定的 Agent 列表 `{ agentNames: [...] }` |
| DELETE | `/api/skills/:id/bind` | 解绑单个 Agent `{ agentName: "agent-name" }` |
| GET | `/api/skills/by-agent/:name` | 按 Agent 名称查询其绑定的所有 Skill |

### 文件扫描 & 导入

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/api/skills/scan` | 扫描 `skills/` 目录，返回 `{ scanned, baseDir, total, newCount, importedCount }` |
| POST | `/api/skills/import` | 从扫描结果导入 Skill `{ names: [...], overwrite: false }` |
| GET | `/api/skills/file/:name` | 读取 SKILL.md 原始文件内容 |

### Agent 辅助

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/api/agents/names` | 获取所有 Agent 名称列表 `{ agents: [{ name, label, enabled }] }` |

## 文件变更清单

### 类型系统 (shared)
- `packages/shared/src/types.ts` — 新增 Skill 类型体系
- `packages/shared/src/api-schemas.ts` — 新增 Skill Zod schemas
- `packages/shared/src/constants.ts` — 新增 `SKILLS` 数据目录常量

### 后端
- `packages/backend/src/core/storage/skill/store.ts` — Skill JSON 存储层
- `packages/backend/src/core/storage/skill/scanner.ts` — Skill 文件扫描器（解析 YAML frontmatter）
- `packages/backend/src/routes/skills.ts` — Skill RESTful API（11 端点）
- `packages/backend/src/routes/agents.ts` — 新增 Agent 名称列表端点
- `packages/backend/src/server.ts` — 注册 Skill 路由
- `packages/backend/src/core/types.ts` — 同步 AgentEntry.skillIds 字段

### 前端
- `packages/frontend/src/pages/skills/page.tsx` — Skill 管理全功能页面
- `packages/frontend/src/App.tsx` — 新增 `/skills` 路由
- `packages/frontend/src/components/sidebar/SidebarNavItems.tsx` — 新增侧边栏入口

### 示例 Skill
- `skills/weekly-report-generator/SKILL.md` — 周报生成（writing 类型）
- `skills/web-fetch-analyzer/SKILL.md` — 网页分析（tool 类型）
- `skills/code-review-pipeline/SKILL.md` — 代码审查流水线（workflow 类型）

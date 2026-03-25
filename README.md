# ARM · 前端研发工作流多 Agent 控制台

三省制多 Agent 协作系统，参照 edict 架构设计，基于 Next.js 14 全栈实现。

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 初始化本机数据目录（~/arm-data/）
npm run init-data

# 3. 启动开发服务器
npm run dev
```

访问 http://localhost:3000

## Agent 角色

| Agent | 对应古制 | 职责 |
|---|---|---|
| architect | 中书省 | 拆解需求，编写前端技术方案 |
| dev | 兵部 | 功能开发 |
| qa | 刑部 | 测试检查 |
| review | 御史台 | 代码审查 |

## 数据存储

所有数据保存在本机 `~/arm-data/`，不纳入 git 管理。

## 工作流

- `dev-standard`：标准前端开发流（需求→架构→审批→开发→QA+Review→打分）
- `quick-fix`：快速修复流（开发→Review→打分）

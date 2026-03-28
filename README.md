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

## Git 提交敏感信息检查

项目已配置 Git pre-commit 钩子，在每次提交代码时自动检查是否包含敏感信息（如 API 密钥、内网域名、公司邮箱等）。

### 安装钩子

```bash
# 运行安装脚本
chmod +x scripts/install-hooks.sh
./scripts/install-hooks.sh
```

### 自定义检测规则

编辑 `config/sensitive-rules.yaml` 文件，添加或修改检测规则：

```yaml
rules:
  - id: "custom-rule"
    name: "自定义规则名称"
    enabled: true
    severity: "high"          # critical | high | medium | low
    pattern: "你的正则表达式"
    description: "规则描述"
    suggestion: "修改建议"
```

### 常用命令

```bash
# 跳过敏感信息检查（不推荐）
git commit --no-verify -m "commit message"

# 手动运行检查（可选，需在 package.json 中添加脚本）
npm run check:sensitive

# 卸载钩子
rm .git/hooks/pre-commit

# 重新安装钩子
./scripts/install-hooks.sh
```

### 预置检测规则

- **快手相关**：公司邮箱、内网域名、内网 npm 镜像源
- **密钥类**：API Key、Bearer Token、JWT Token、AWS 密钥
- **证书类**：私钥、SSH 密钥
- **敏感数据**：密码、数据库连接字符串、手机号、身份证号

更多配置选项和规则，请查看 `config/sensitive-rules.yaml` 文件。

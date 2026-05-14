# ARM · 前端研发工作流多 Agent 控制台

多 Agent 协作调度系统，基于 Next.js 全栈实现。

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

## ✨ AI 润色功能

Manta 内置 AI 润色助手，帮助你快速创建专业的 Agent SOUL.md 文档。

### 🎉 零配置使用（推荐）

**直接使用本地 OpenClaw，无需配置任何 API Key！**

前提条件：已安装 OpenClaw CLI
```bash
brew install openclaw
```

### 可选：使用外部 API

如果想使用更快的外部模型，创建 `.env` 文件：

```bash
# 使用 OpenAI 或兼容服务
AI_API_KEY=your-api-key-here
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
```

### 智能降级策略

- ✅ 有外部 API Key → 使用外部 API（更快）
- ✅ 无外部 API Key → 自动使用 OpenClaw（零配置）
- ✅ 完全自动化，对用户透明

### 使用场景

- **新建 Agent**: 描述职责和流程，AI 自动生成完整 SOUL.md
- **编辑 Agent**: 基于现有内容优化改进，提升专业度
- **快速上手**: 无需了解 SOUL.md 格式，AI 帮你搞定

详细使用指南：[docs/ai-polish-guide.md](docs/ai-polish-guide.md)

## Agent 角色

| Agent | 职责 |
|---|---|
| architect | 拆解需求，编写前端技术方案 |
| dev | 功能开发 |
| qa | 测试检查 |
| review | 代码审查 |

## 数据存储

所有数据保存在本机 `~/arm-data/`，不纳入 git 管理。

## 📦 构建和安装

### 构建DMG
```bash
pnpm build
```

### macOS安装提示"已损坏"的解决方案

如果在macOS上安装DMG时提示"已损坏，无法打开"，这是因为应用未进行代码签名。请按以下步骤解决：

#### 解决方法一：系统偏好设置（推荐普通用户）

1. 将 Arm.app 拖入应用程序文件夹
2. 打开"系统偏好设置" → "安全性与隐私"
3. 在"通用"标签页底部，会看到"Arm 已阻止使用"的提示
4. 点击"仍要打开"按钮
5. 之后就可以正常打开应用了

#### 解决方法二：命令行解决（推荐开发者）

如果上述方法无效，或者你想快速解决，可以使用命令行：

```bash
# 方法1: 使用项目自带脚本
chmod +x scripts/fix-macos-quarantine.sh
./scripts/fix-macos-quarantine.sh /Applications/Arm.app

# 方法2: 手动执行命令
sudo xattr -rd com.apple.quarantine /Applications/Arm.app
```

#### 解决方法三：直接打开（快速临时方案）

在 Finder 中找到 Arm.app，然后：
1. 右键点击（或 Control+点击）Arm.app
2. 选择"打开"
3. 在弹出的警告对话框中点击"打开"
4. 之后就可以正常双击打开了

> **注意**：当前版本未进行代码签名，因此在其他 Mac 上安装时会触发 Gatekeeper 安全提示。这是预期行为，按上述步骤操作即可正常使用。详细解决方案请参考 [macOS Gatekeeper 修复指南](docs/macos-gatekeeper-fix.md)。

## 工作流

- `dev-standard`：标准前端开发流（需求→架构→审批→开发→QA+Review）
- `quick-fix`：快速修复流（开发→Review）

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

## 致谢

### 设计系统

Manta 的多主题系统灵感和设计 token 提取自以下开源项目：

- **[VoltAgent / awesome-design-md](https://github.com/VoltAgent/awesome-design-md)** — 一个汇集了 60+ 款知名产品（Notion、Linear、Cursor、Supabase、Vercel、Spotify、Stripe、Apple、Raycast、IBM 等）设计规范的开源合集，以 Markdown 格式整理，供 AI Agent 直接读取并生成一致的 UI。感谢该项目让我们能够快速引入多种高质量设计语言，为 Manta 用户提供丰富的主题选择。

  > *"Copy a DESIGN.md into your project, tell your AI agent 'build me a page that looks like this' and get pixel-perfect UI that actually matches."*

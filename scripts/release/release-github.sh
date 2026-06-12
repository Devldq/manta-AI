#!/bin/bash
# GitHub Release 发布脚本
# 用于将构建好的 DMG 发布到 GitHub Releases

set -e

# 检查是否提供了版本号
if [ -z "$1" ]; then
    echo "用法: $0 <版本号>"
    echo "示例: $0 v2.0.0"
    exit 1
fi

VERSION="$1"
DMG_FILE="dist/Arm-${VERSION#v}-arm64.dmg"

# 检查 DMG 文件是否存在
if [ ! -f "$DMG_FILE" ]; then
    echo "错误: DMG 文件不存在: $DMG_FILE"
    echo "请先运行: pnpm build"
    exit 1
fi

echo "📦 准备发布版本: $VERSION"
echo "📄 DMG 文件: $DMG_FILE"

# 检查是否安装了 GitHub CLI
if ! command -v gh &> /dev/null; then
    echo "❌ 未找到 GitHub CLI (gh)"
    echo "请先安装: brew install gh"
    exit 1
fi

# 检查是否登录了 GitHub
if ! gh auth status &> /dev/null; then
    echo "❌ 未登录 GitHub"
    echo "请先运行: gh auth login"
    exit 1
fi

echo "✅ GitHub CLI 已安装并登录"

# 创建 Release
echo "🚀 创建 GitHub Release..."
gh release create "$VERSION" \
    --repo Devldq/arm-claw \
    --title "Arm $VERSION" \
    --notes "## 更新内容
- 工作流编排功能优化
- 数据目录规范化（使用 .manta-data 隐藏目录）
- 内置工作流打包优化
- 修复 DMG 安装问题

## 安装说明
1. 下载 Arm-$VERSION-arm64.dmg
2. 打开 DMG 文件
3. 将 Arm.app 拖拽到 Applications 文件夹
4. 首次打开时，如果提示'无法打开'，请：
   - 右键点击 Arm.app
   - 选择'打开'
   - 在弹出的对话框中点击'打开'

## 系统要求
- macOS 10.15+ (Catalina 或更高版本)
- Apple Silicon (M1/M2/M3) 或 Intel Mac

## 已知问题
- 由于应用未签名，首次打开时需要手动允许
" \
    --draft \
    "$DMG_FILE"

echo ""
echo "✅ Release 创建成功！"
echo "📝 Release 当前为草稿状态，请检查后手动发布"
echo "🔗 访问: https://github.com/Devldq/arm-claw/releases"
echo ""
echo "💡 提示："
echo "   1. 在 GitHub 上检查 Release 内容"
echo "   2. 确认无误后，点击'Publish release'发布"
echo "   3. 用户下载后，按照安装说明操作即可"

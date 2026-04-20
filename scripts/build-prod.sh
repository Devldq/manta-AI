#!/bin/bash

# AI: 生产环境构建脚本
# 目标：只打包生产依赖，减少最终应用体积

set -e

echo "🚀 开始生产环境构建..."

# AI: 步骤1: 清理旧的构建产物
echo "🧹 清理旧的构建产物..."
rm -rf .next/
rm -rf dist/

# AI: 步骤2: 构建 Next.js
echo "📦 构建 Next.js..."
pnpm build:next

# AI: 步骤3: 清理 .next 中的缓存和临时文件
echo "🗑️ 清理 .next 缓存..."
rm -rf .next/cache
rm -rf .next/types
rm -f .next/trace
rm -f .next/package.json
rm -f .next/export-marker.json
rm -f .next/images-manifest.json

# AI: 注意：以下文件都是 Next.js 15 生产运行必需的（由 required-server-files.json 定义），不能删除：
# - routes-manifest.json
# - prerender-manifest.json  
# - build-manifest.json
# - react-loadable-manifest.json
# - app-build-manifest.json
# - server-reference-manifest.js / .json
# - required-server-dependencies.json

# AI: 步骤4: 清理 node_modules 中的开发依赖（可选，如果 disk space 紧张）
# 注意：这会影响开发环境，建议只在 CI/CD 中使用
if [ "$CI" = "true" ]; then
    echo "🗑️ 清理 node_modules 开发依赖（CI 环境）..."
    # 只保留 production 依赖
    npm prune --production
fi

# AI: 步骤5: 运行 electron-builder
echo "📦 打包 Electron 应用..."
pnpm build:electron

# AI: 步骤6: 移除 quarantine 属性（避免其他用户打开时提示"已损坏"）
echo "🔧 移除 quarantine 属性..."
if [ -d "dist/mac-arm64/Arm.app" ]; then
    # 先检查是否有 quarantine 属性
    if xattr -l dist/mac-arm64/Arm.app 2>/dev/null | grep -q "com.apple.quarantine"; then
        echo "📝 检测到 quarantine 属性，正在移除..."
        xattr -rd com.apple.quarantine dist/mac-arm64/Arm.app 2>/dev/null || true
        echo "✅ quarantine 属性已移除"
    else
        echo "ℹ️ 未检测到 quarantine 属性，跳过移除步骤"
    fi
else
    echo "⚠️ 未找到 Arm.app，跳过 quarantine 移除步骤"
fi

# AI: 步骤7: 显示构建结果
echo ""
echo "📊 构建结果:"
if [ -d "dist/mac-arm64" ]; then
    du -sh dist/mac-arm64/Arm.app
    du -sh dist/*.dmg 2>/dev/null || true
fi

echo ""
echo "✅ 生产环境构建完成！"
echo ""
echo "📦 构建产物位置："
echo "   应用: dist/mac-arm64/Arm.app"
echo "   DMG:  dist/*.dmg"
echo ""
echo "📝 重要提示："
echo "   如果其他用户打开 DMG 时提示'已损坏'，请按以下步骤操作："
echo ""
echo "   方法1 - 系统偏好设置（推荐）："
echo "   1. 打开 系统偏好设置 → 安全性与隐私"
echo "   2. 点击 仍要打开 按钮"
echo ""
echo "   方法2 - 命令行修复："
echo "   sudo xattr -rd com.apple.quarantine /Applications/Arm.app"
echo ""
echo "   方法3 - 使用自动修复脚本："
echo "   ./scripts/fix-macos-quarantine.sh /Applications/Arm.app"
echo ""
echo "   详细指南请查看: docs/macos-gatekeeper-fix.md"

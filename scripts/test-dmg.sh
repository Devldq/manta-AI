#!/bin/bash
# AI: DMG 自动化测试脚本

set -e

echo "🚀 开始自动化测试 DMG..."

DMG_PATH="dist/Arm-0.1.0-arm64.dmg"
APP_NAME="Arm.app"
INSTALL_DIR="/Applications"
TEST_INSTALL_DIR="/tmp/arm-test"

# AI: 清理旧的测试环境
echo "🧹 清理旧的测试环境..."
if [ -d "$TEST_INSTALL_DIR" ]; then
    rm -rf "$TEST_INSTALL_DIR"
fi
mkdir -p "$TEST_INSTALL_DIR"

# AI: 挂载 DMG
echo "📀 挂载 DMG..."
MOUNT_POINT=$(hdiutil attach "$DMG_PATH" | grep "/Volumes/" | awk '{print $3}')
echo "✅ DMG 已挂载到: $MOUNT_POINT"

# AI: 复制应用到测试目录
echo "📦 复制应用到测试目录..."
cp -R "$MOUNT_POINT/$APP_NAME" "$TEST_INSTALL_DIR/"

# AI: 卸载 DMG
echo "💿 卸载 DMG..."
hdiutil detach "$MOUNT_POINT" -quiet

# AI: 检查应用结构
echo "🔍 检查应用结构..."
APP_PATH="$TEST_INSTALL_DIR/$APP_NAME"

if [ ! -d "$APP_PATH" ]; then
    echo "❌ 应用不存在: $APP_PATH"
    exit 1
fi

echo "✅ 应用路径: $APP_PATH"

# AI: 检查关键文件
RESOURCES_PATH="$APP_PATH/Contents/Resources"
STANDALONE_DIR="$RESOURCES_PATH/.next/standalone"
NEXT_MODULE="$STANDALONE_DIR/node_modules/next"

echo "📂 检查关键文件..."
echo "  - Resources: $RESOURCES_PATH"
if [ -d "$RESOURCES_PATH" ]; then
    echo "    ✅ Resources 目录存在"
else
    echo "    ❌ Resources 目录不存在"
    exit 1
fi

echo "  - Standalone: $STANDALONE_DIR"
if [ -d "$STANDALONE_DIR" ]; then
    echo "    ✅ Standalone 目录存在"
else
    echo "    ❌ Standalone 目录不存在"
    exit 1
fi

echo "  - Next.js module: $NEXT_MODULE"
if [ -d "$NEXT_MODULE" ]; then
    echo "    ✅ Next.js 模块存在"
else
    echo "    ❌ Next.js 模块不存在"
    exit 1
fi

# AI: 尝试启动应用（后台模式，10秒后自动关闭）
echo "🎯 尝试启动应用（10秒测试）..."
timeout 10s open -a "$APP_PATH" --args --test-mode 2>&1 || true

# AI: 等待应用启动
sleep 3

# AI: 检查应用是否在运行
if pgrep -f "$APP_NAME" > /dev/null; then
    echo "✅ 应用已成功启动！"
    echo "📝 应用进程:"
    ps aux | grep "$APP_NAME" | grep -v grep
    
    # AI: 关闭应用
    echo "🛑 关闭应用..."
    pkill -f "$APP_NAME" || true
    sleep 2
    
    echo "🎉 测试成功！应用可以正常启动"
    exit 0
else
    echo "❌ 应用启动失败"
    
    # AI: 检查控制台日志
    echo "📄 检查最近的控制台日志..."
    log show --predicate 'process == "Arm"' --last 1m --info 2>/dev/null || echo "无法获取日志"
    
    exit 1
fi

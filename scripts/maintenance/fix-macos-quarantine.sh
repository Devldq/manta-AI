#!/bin/bash
# 修复 macOS 隔离属性脚本
# 用于移除未签名应用的 quarantine 属性，避免"已损坏"警告

# 检查是否提供了应用路径
if [ -z "$1" ]; then
    echo "用法: $0 <应用路径>"
    echo "示例: $0 /Applications/Arm.app"
    exit 1
fi

APP_PATH="$1"

# 检查应用是否存在
if [ ! -d "$APP_PATH" ]; then
    echo "错误: 应用不存在: $APP_PATH"
    exit 1
fi

echo "正在移除 quarantine 属性..."
echo "应用路径: $APP_PATH"

# 移除 quarantine 属性
sudo xattr -rd com.apple.quarantine "$APP_PATH" 2>/dev/null

if [ $? -eq 0 ]; then
    echo "✅ quarantine 属性已成功移除"
    echo ""
    echo "现在可以正常打开应用了！"
else
    echo "❌ 移除 quarantine 属性失败"
    echo "请确保:"
    echo "1. 应用路径正确"
    echo "2. 有足够的权限（可能需要输入密码）"
    exit 1
fi

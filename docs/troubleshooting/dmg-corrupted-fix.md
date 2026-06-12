# DMG "已损坏" 问题解决指南

## 问题描述

在 macOS 上安装未签名的应用时，系统会提示"Arm.app 已损坏，无法打开。您应该将它移到废纸篓。"

这是因为 macOS 的安全机制（Gatekeeper）会检查应用的签名状态。由于我们的应用没有 Apple 开发者签名，系统会阻止运行。

## 解决方案

### 方法一：使用自动修复脚本（推荐）

1. 打开终端（Terminal）

2. 运行修复脚本：
```bash
# 如果应用已经安装在 /Applications 目录
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Devldq/arm-claw/main/scripts/fix-macos-quarantine.sh)" /Applications/Arm.app

# 或者如果脚本已经下载到本地
./scripts/fix-macos-quarantine.sh /Applications/Arm.app
```

3. 输入管理员密码（如果需要）

4. 脚本会自动移除 quarantine 属性，完成后即可正常打开应用

### 方法二：手动移除 quarantine 属性

1. 打开终端（Terminal）

2. 运行以下命令：
```bash
sudo xattr -rd com.apple.quarantine /Applications/Arm.app
```

3. 输入管理员密码

4. 完成后即可打开应用

### 方法三：通过系统偏好设置

1. 点击苹果菜单 → 系统偏好设置 → 安全性与隐私

2. 在"通用"标签页中，可能会看到"Arm.app 已被阻止使用"的提示

3. 点击"仍要打开"按钮

4. 确认打开应用

### 方法四：直接打开（不推荐）

1. 在 Finder 中找到 Arm.app

2. 右键点击（或 Control+点击）应用

3. 选择"打开"

4. 在弹出的警告对话框中点击"打开"

## 为什么会出现这个问题？

- **Apple 安全机制**：macOS 的 Gatekeeper 会检查所有从网络下载的应用
- **签名要求**：正式发布的 macOS 应用需要 Apple 开发者签名才能通过 Gatekeeper 检查
- **开发阶段**：在开发阶段，我们通常不会对应用进行签名，因此会出现此问题

## 如何避免这个问题？

### 对于开发者
- 使用自动修复脚本
- 在构建脚本中自动移除 quarantine 属性
- 使用 ad-hoc 签名（仅用于开发）

### 对于用户
- 从可信来源下载应用
- 按照上述方法之一操作

## 安全性说明

虽然移除了 quarantine 属性，但应用本身是安全的：
- 代码是开源的，可以在 GitHub 上查看
- 应用只在本地运行，不会上传敏感数据
- 建议从官方渠道下载应用

## 常见问题

### Q: 这个脚本安全吗？
A: 脚本只是移除 macOS 的 quarantine 属性，不会对应用进行任何修改。

### Q: 为什么需要管理员密码？
A: 因为应用通常安装在 `/Applications` 目录，需要管理员权限才能修改。

### Q: 每次更新都需要重新运行脚本吗？
A: 是的，每次安装新版本都需要重新运行脚本。

### Q: 有其他方法吗？
A: 可以尝试禁用 Gatekeeper（不推荐，会降低系统安全性）：
```bash
sudo spctl --master-disable
```

## 技术支持

如果问题仍然存在，请：
1. 检查应用是否完整下载
2. 尝试重新下载安装
3. 查看系统日志获取更多信息
4. 在 GitHub 仓库提交 Issue

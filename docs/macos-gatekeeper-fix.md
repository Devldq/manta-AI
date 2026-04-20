# macOS Gatekeeper 修复指南

## 问题描述

当你在其他 macOS 电脑上打开 ARM 应用时，可能会看到以下提示：

> "Arm" 已损坏，无法打开。你应该将它移到废纸篓。

这不是应用真的损坏了，而是 macOS 的 **Gatekeeper 安全机制** 在阻止未签名的应用运行。

## 为什么会这样？

1. **代码签名缺失**：ARM 应用目前未进行正式的代码签名
2. **Quarantine 属性**：从网络下载的应用会被 macOS 自动标记 `com.apple.quarantine` 属性
3. **Gatekeeper 拦截**：macOS 会检查应用的签名和 quarantine 属性，阻止未签名或未认证的应用运行

## 解决方案

### 方法一：系统偏好设置（推荐）

这是最简单、最安全的方法，适合所有用户。

**步骤：**

1. 将 `Arm.app` 拖入"应用程序"文件夹
2. 打开 **系统偏好设置**（或"系统设置"）
3. 点击 **安全性与隐私**（或"隐私与安全性"）
4. 在 **通用** 标签页底部，你会看到：
   > "Arm" 已被阻止使用，因为来自身份不明的开发者
5. 点击 **仍要打开** 按钮
6. 在弹出的确认对话框中点击 **打开**
7. 完成！现在可以正常使用 ARM 应用了

**注意**：这个操作只需要执行一次。之后再次打开应用时就不会再有警告了。

### 方法二：命令行修复（开发者推荐）

如果你熟悉命令行，或者方法一无效，可以使用命令行快速修复。

**使用项目自带脚本：**

```bash
# 1. 进入项目目录
cd /path/to/arm-claw

# 2. 给脚本添加执行权限
chmod +x scripts/fix-macos-quarantine.sh

# 3. 运行修复脚本（替换为你的应用路径）
./scripts/fix-macos-quarantine.sh /Applications/Arm.app
```

**手动执行命令：**

```bash
# 直接运行以下命令
sudo xattr -rd com.apple.quarantine /Applications/Arm.app
```

**命令解释：**
- `sudo`：以管理员权限运行
- `xattr`：扩展属性工具
- `-r`：递归处理（包括应用包内的所有文件）
- `-d`：删除属性
- `com.apple.quarantine`：要删除的属性名
- `/Applications/Arm.app`：应用路径（根据你的实际安装位置修改）

**验证修复：**

```bash
# 检查 quarantine 属性是否已移除
xattr -l /Applications/Arm.app

# 如果输出中不包含 "com.apple.quarantine"，说明修复成功
```

### 方法三：右键打开（快速临时方案）

如果你只是想快速打开一次，可以使用这个方法：

1. 在 Finder 中找到 `Arm.app`
2. **右键点击**（或按住 Control 键点击）应用图标
3. 选择 **打开**
4. 在弹出的警告对话框中点击 **打开**
5. 应用将会启动，并且之后可以正常双击打开

## 常见问题

### Q: 这个应用安全吗？

A: ARM 是开源项目，代码完全透明。你可以查看 [GitHub 仓库](https://github.com/Devldq/arm-claw) 了解项目详情。

### Q: 为什么不移除 quarantine 属性？

A: 我们已经在构建配置中禁用了 hardened runtime（`hardenedRuntime: false`），这可以避免一些签名问题。但 quarantine 属性是在下载时由 macOS 自动添加的，需要在用户端移除。

### Q: 每次更新应用后都需要重新操作吗？

A: 是的。每次安装新版本的应用（新的 .dmg 文件）时，macOS 都会重新添加 quarantine 属性。你需要重新执行上述任一方法来移除它。

### Q: 能否一劳永逸地解决这个问题？

A: 可以，但需要加入 Apple Developer Program 并进行正式的代码签名。这会产生每年 $99 的费用。如果你认为有必要，请在 GitHub Issues 中提出。

### Q: 我在"安全性与隐私"中看不到"仍要打开"按钮

A: 这可能是因为：
1. 你已经打开过应用一次，系统已经记录了
2. 尝试重启电脑后再试
3. 使用方法二的命令行修复

## 技术细节

### Gatekeeper 是什么？

Gatekeeper 是 macOS 的安全功能，用于防止恶意软件和未经验证的应用运行。它会检查：

1. **代码签名**：应用是否有有效的开发者签名
2. **公证**：应用是否经过 Apple 公证（notarization）
3. **Quarantine 属性**：应用是否从网络下载

### 为什么 ARM 不进行代码签名？

目前 ARM 是一个开源项目，进行正式的代码签名需要：

1. 加入 Apple Developer Program（$99/年）
2. 维护签名证书和配置文件
3. 每次构建都进行签名和公证

对于个人开发者和小型开源项目来说，这是一笔不小的开销。我们选择在文档中提供清晰的解决方案，让用户可以轻松地手动绕过 Gatekeeper。

### 未来计划

如果项目用户量增长，我们会考虑进行正式的代码签名和公证，以提供更流畅的用户体验。

## 需要帮助？

如果你遇到了其他问题，或者这些方法都不奏效，请：

1. 查看 [GitHub Issues](https://github.com/Devldq/arm-claw/issues)
2. 提交新的 Issue 描述你的问题
3. 提供你的 macOS 版本和错误信息

---

**最后更新**：2026-04-17

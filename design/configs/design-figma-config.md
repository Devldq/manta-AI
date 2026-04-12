# Figma Design Config

## 品牌信息
- 名称: Figma
- 类型: 设计工具
- 风格: 黑白严谨

## 颜色配置

### 主色
```yaml
primary:
  background: "#FFFFFF"
  dark: "#000000"
  # 严格的黑白界面
```

### 文本色
```yaml
text:
  primary: "#000000"
  inverse: "#FFFFFF"
```

### 玻璃效果
```yaml
glass:
  dark: "rgba(0, 0, 0, 0.08)"
  light: "rgba(255, 255, 255, 0.16)"
```

## 字体配置

### 字体族
```yaml
fontFamily:
  primary: "figmaSans"
  mono: "figmaMono"
  fallback: "SF Pro Display, system-ui"
```

### 字体层级
```yaml
typography:
  display:
    size: 86px
    weight: 400
    lineHeight: 1.00
    letterSpacing: -1.72px
  section:
    size: 64px
    weight: 400
    lineHeight: 1.10
  body:
    size: 16px
    weight: 400
    lineHeight: 1.40
```

## 组件配置

### 按钮
```yaml
button:
  primary:
    background: "#000000"
    color: "#FFFFFF"
    radius: 50px  # Pill
  circle:
    radius: 50%
```

## 特色设计
- 严格的黑白界面（无其他颜色）
- figmaSans 变量字体（320-700字重）
- 虚线焦点边框（dashed 2px）
- 产品内容提供所有颜色

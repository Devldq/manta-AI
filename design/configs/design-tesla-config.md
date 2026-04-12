# Tesla Design Config

## 品牌信息
- 名称: Tesla
- 类型: 电动汽车
- 风格: 极简主义、摄影优先

## 颜色配置

### 主色
```yaml
primary:
  accent: "#3E6AE1"  # Electric Blue - CTA专用
  background: "#FFFFFF"  # Pure White
  dark: "#171A20"  # Carbon Dark
```

### 文本色
```yaml
text:
  primary: "#171A20"  # Carbon Dark
  secondary: "#393C41"  # Graphite
  tertiary: "#5C5E62"  # Pewter
  muted: "#8E8E8E"  # Silver Fog
  inverse: "#FFFFFF"  # White (on dark)
```

### 表面色
```yaml
surface:
  default: "#FFFFFF"
  alternate: "#F4F4F4"  # Light Ash
  dark: "#171A20"
  frosted: "rgba(255, 255, 255, 0.75)"
```

## 字体配置

### 字体族
```yaml
fontFamily:
  display: "Universal Sans Display"
  body: "Universal Sans Text"
  fallback: "-apple-system, Arial, sans-serif"
```

### 字体层级
```yaml
typography:
  hero:
    size: 40px
    weight: 500
    lineHeight: 1.20
  nav:
    size: 14px
    weight: 500
    lineHeight: 1.20
  body:
    size: 14px
    weight: 400
    lineHeight: 1.43
  button:
    size: 14px
    weight: 500
    lineHeight: 1.20
```

## 组件配置

### 按钮
```yaml
button:
  primary:
    background: "#3E6AE1"
    color: "#FFFFFF"
    radius: 4px
    padding: "12px 24px"
  secondary:
    background: "#FFFFFF"
    color: "#393C41"
    radius: 4px
    border: "none"
```

### 卡片
```yaml
card:
  radius: 0px
  shadow: none
  border: none
```

## 布局配置

### 间距
```yaml
spacing:
  base: 8px
  section: 80px
```

### 圆角
```yaml
radius:
  button: 4px
  card: 0px
```

## 特色设计
- 全屏视口英雄区（100vh）
- 零装饰（无阴影、无渐变、无边框）
- 单一强调色（仅用于CTA）
- 摄影优先的产品展示

# Apple Design Config

## 品牌信息
- 名称: Apple
- 类型: 消费电子
- 风格: 控制戏剧、产品崇拜

## 颜色配置

### 主色
```yaml
primary:
  accent: "#0071e3"  # Apple Blue - 唯一交互色
  dark: "#000000"  # Pure Black
  light: "#f5f5f7"  # Light Gray
```

### 文本色
```yaml
text:
  primary: "#1d1d1f"  # Near Black
  secondary: "rgba(0, 0, 0, 0.8)"
  tertiary: "rgba(0, 0, 0, 0.48)"
  inverse: "#FFFFFF"
```

### 暗色表面
```yaml
darkSurface:
  surface1: "#272729"
  surface2: "#262628"
  surface3: "#28282a"
  surface4: "#2a2a2d"
  surface5: "#242426"
```

## 字体配置

### 字体族
```yaml
fontFamily:
  display: "SF Pro Display"
  body: "SF Pro Text"
  fallback: "Helvetica Neue, Arial, sans-serif"
```

### 字体层级
```yaml
typography:
  display:
    size: 56px
    weight: 600
    lineHeight: 1.07
    letterSpacing: -0.28px
  section:
    size: 40px
    weight: 600
    lineHeight: 1.10
  body:
    size: 17px
    weight: 400
    lineHeight: 1.47
    letterSpacing: -0.374px
```

## 组件配置

### 按钮
```yaml
button:
  primary:
    background: "#0071e3"
    color: "#FFFFFF"
    radius: 980px  # Pill形状
    padding: "8px 15px"
  secondary:
    background: "transparent"
    color: "#0071e3"
```

### 卡片
```yaml
card:
  radius: 12px
  shadow: "rgba(0, 0, 0, 0.22) 3px 5px 30px"
```

## 布局配置

### 间距
```yaml
spacing:
  base: 8px
  section: 100px
```

### 圆角
```yaml
radius:
  button: 980px  # Pill
  card: 12px
```

## 特色设计
- 黑/浅灰区域交替节奏
- SF Pro 光学尺寸自动切换
- 单一强调色用于所有交互元素
- 极紧凑标题行高（1.07）

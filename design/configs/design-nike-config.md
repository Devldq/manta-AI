# Nike Design Config

## 品牌信息
- 名称: Nike
- 类型: 运动零售
- 风格: 动能零售殿堂

## 颜色配置

### 主色
```yaml
primary:
  background: "#FFFFFF"
  dark: "#111111"  # Nike Black
  alternate: "#F5F5F5"  # Light Gray
```

### 文本色
```yaml
text:
  primary: "#111111"
  secondary: "#707072"
  disabled: "#9E9EA0"
```

### 语义色
```yaml
semantic:
  error: "#D30005"  # Nike Red
  success: "#007D48"  # Success Green
  link: "#1151FF"  # Link Blue
  warning: "#FEDF35"  # Warning Yellow
```

## 字体配置

### 字体族
```yaml
fontFamily:
  display: "Nike Futura ND"
  heading: "Helvetica Now Display"
  body: "Helvetica Now Text"
  fallback: "Helvetica, Arial"
```

### 字体层级
```yaml
typography:
  display:
    size: 96px
    weight: 500
    lineHeight: 0.90
    transform: uppercase
  heading:
    size: 32px
    weight: 500
    lineHeight: 1.20
  body:
    size: 16px
    weight: 400
    lineHeight: 1.75
```

## 组件配置

### 按钮
```yaml
button:
  primary:
    background: "#111111"
    color: "#FFFFFF"
    radius: 30px  # Pill
    padding: "12px 24px"
  secondary:
    background: "#FFFFFF"
    color: "#111111"
    border: "1px solid #707072"
```

### 卡片
```yaml
card:
  radius: 0px
  shadow: none
```

## 布局配置

### 间距
```yaml
spacing:
  base: 8px
  section: 64px
```

### 圆角
```yaml
radius:
  button: 30px
  card: 0px
```

## 特色设计
- 单色UI让产品色彩主导
- 巨大uppercase显示字体（line-height 0.90）
- 无阴影、无边框的扁平设计
- 8px网格系统严格遵循

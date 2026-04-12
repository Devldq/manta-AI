# Notion Design Config

## 品牌信息
- 名称: Notion
- 类型: 生产力工具
- 风格: 温暖极简主义

## 颜色配置

### 主色
```yaml
primary:
  accent: "#0075de"  # Notion Blue
  background: "#FFFFFF"
  dark: "#31302e"
```

### 暖色中性
```yaml
warm:
  white: "#f6f5f4"  # Warm White
  dark: "#31302e"  # Warm Dark
  gray500: "#615d59"
  gray300: "#a39e98"
```

### 文本色
```yaml
text:
  primary: "rgba(0, 0, 0, 0.95)"
  secondary: "#615d59"
  muted: "#a39e98"
```

## 字体配置

### 字体族
```yaml
fontFamily:
  primary: "NotionInter"
  fallback: "Inter, -apple-system, system-ui"
```

### 字体层级
```yaml
typography:
  display:
    size: 64px
    weight: 700
    lineHeight: 1.00
    letterSpacing: -2.125px
  section:
    size: 48px
    weight: 700
    lineHeight: 1.00
    letterSpacing: -1.5px
  body:
    size: 16px
    weight: 400
    lineHeight: 1.50
```

## 组件配置

### 按钮
```yaml
button:
  primary:
    background: "#0075de"
    color: "#FFFFFF"
    radius: 4px
  pill:
    background: "#f2f9ff"
    color: "#097fe8"
    radius: 9999px
```

### 卡片
```yaml
card:
  radius: 12px
  border: "1px solid rgba(0, 0, 0, 0.1)"
  shadow: 
    - "rgba(0, 0, 0, 0.04) 0px 4px 18px"
```

## 特色设计
- NotionInter 自定义字体，负字间距
- 超薄边框（whisper border）
- 温暖的中性色调
- 多层阴影系统（opacity < 0.05）

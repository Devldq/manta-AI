# Stripe Design Config

## 品牌信息
- 名称: Stripe
- 类型: 金融科技
- 风格: 技术奢华、精确温暖

## 颜色配置

### 主色
```yaml
primary:
  accent: "#533afd"  # Stripe Purple
  background: "#FFFFFF"
  heading: "#061b31"  # Deep Navy
```

### 强调色
```yaml
accent:
  ruby: "#ea2261"
  magenta: "#f96bee"
  green: "#15be53"
```

### 文本色
```yaml
text:
  heading: "#061b31"
  body: "#64748d"
  label: "#273951"
```

### 阴影色
```yaml
shadow:
  primary: "rgba(50, 50, 93, 0.25)"
  secondary: "rgba(0, 0, 0, 0.1)"
```

## 字体配置

### 字体族
```yaml
fontFamily:
  primary: "sohne-var"
  mono: "SourceCodePro"
  fallback: "SF Pro Display"
```

### 字体层级
```yaml
typography:
  display:
    size: 56px
    weight: 300
    lineHeight: 1.03
    letterSpacing: -1.4px
  section:
    size: 32px
    weight: 300
    lineHeight: 1.10
    letterSpacing: -0.64px
  body:
    size: 16px
    weight: 300
    lineHeight: 1.40
```

## 组件配置

### 按钮
```yaml
button:
  primary:
    background: "#533afd"
    color: "#FFFFFF"
    radius: 4px
  secondary:
    background: "transparent"
    border: "1px solid #533afd"
    color: "#533afd"
```

### 卡片
```yaml
card:
  radius: 8px
  shadow: 
    - "rgba(50, 50, 93, 0.25) 0px 13px 27px -5px"
    - "rgba(0, 0, 0, 0.3) 0px 8px 16px -8px"
```

## 特色设计
- sohne-var 变量字体，weight 300 为标志性字重
- 蓝色调多层阴影系统
- OpenType "ss01" 特性集全局启用
- 深海军蓝标题而非纯黑

# 🎨 Geist Design System 深度学习

**学习时间**: 2026-04-10  
**学习目标**: 真正理解 Vercel 设计系统的核心，而非表面模仿

---

## ❌ 之前的错误理解

### 表面模仿（已失败）
```
❌ 只改了颜色：白色 → 黑色
❌ 只改了边框：灰色 → 锌色
❌ 布局没变：还是老样子
❌ 组件没变：还是老样式
❌ 间距没变：还是老比例
```

**结果**: 只是一个"深色主题"，不是 Vercel 风格！

---

## ✅ Geist 设计系统核心原则

### 1. 布局原则 (Layout)

#### Grid 系统
```jsx
// ❌ 错误：随意 spacing
<div className="grid grid-cols-4 gap-6">

// ✅ 正确：Geist 使用 4/8 点网格
<div className="grid grid-cols-4 gap-4">  // 16px
<div className="grid grid-cols-4 gap-6">  // 24px
<div className="grid grid-cols-4 gap-8">  // 32px
```

#### 光学对齐
```
Geist 不追求像素级对齐，而是视觉平衡

❌ 严格几何对齐
  [图标] 文字 (图标中心对齐)

✅ 光学对齐
  [图标] 文字 (图标略高于文字中心，视觉平衡)
```

### 2. 间距系统 (Spacing)

```
Geist 使用 4px 基础单位：

2px   - 极小间距 (图标内部)
4px   - 小间距 (紧凑元素)
8px   - 标准小间距
12px  - 中小间距
16px  - 标准间距
24px  - 中大间距
32px  - 大间距
48px  - 极大间距
64px  - section 间距
```

**应用示例**:
```jsx
// 卡片内部
<div className="p-6">      // 24px
  <label className="mb-2">  // 8px
  <input className="mb-4">  // 16px
  <button className="mt-6"> // 24px
</div>

// 卡片之间
<section className="mb-8">  // 32px
```

### 3. 排版系统 (Typography)

#### 字体层级
```
text-xs   (12px) - 辅助文字、标签
text-sm   (14px) - 正文、按钮
text-base (16px) - 默认
text-lg   (18px) - 小标题
text-xl   (20px) - 中标题
text-2xl  (24px) - 大标题
text-4xl  (36px) - 超大标题
```

#### 字重使用
```
font-normal  (400) - 正文
font-medium  (500) - 按钮、标签
font-semibold (600) - 标题
font-bold    (700) - 强调
```

#### 字间距 (Tracking)
```
tracking-tight    (-0.025em) - 标题 (Geist 特色！)
tracking-normal   (0)        - 正文
tracking-wide     (+0.025em) - 辅助文字
```

**关键**: Vercel 标题都用 `tracking-tight`！

#### 行高 (Leading)
```
leading-none   (1)    - 紧凑
leading-tight  (1.25) - 标题
leading-snug   (1.375)
leading-normal (1.5)  - 正文
leading-relaxed (1.625)
```

### 4. 颜色系统 (Color)

#### 主色调 (Zinc)
```
zinc-50   - 最浅 (几乎不用)
zinc-100  - 很浅
zinc-200  - 浅灰
zinc-300  - 次级文字
zinc-400  - 辅助文字
zinc-500  - 弱文字、边框
zinc-600  - 深色模式前景
zinc-700  - 深色模式背景
zinc-800  - 深色模式卡片
zinc-900  - 深色模式表面
zinc-950  - 深色模式背景 (接近黑)
```

#### 使用规则
```jsx
// 文字
text-zinc-100  // 主标题 (高对比)
text-zinc-300  // 次级标题
text-zinc-400  // 正文
text-zinc-500  // 辅助文字
text-zinc-600  // 禁用文字

// 背景
bg-zinc-900    // 卡片背景
bg-zinc-950    // 页面背景

// 边框
border-zinc-800  // 卡片边框
border-zinc-700  // 输入框边框 (focus)
```

#### 强调色
```
白色 (white) - 主按钮、重要元素
红色 (red-500) - 错误、危险
绿色 (green-500) - 成功、安全
蓝色 (blue-500) - 链接、信息
```

### 5. 组件样式 (Components)

#### 按钮
```jsx
// 主按钮 (Primary)
<button className="
  inline-flex items-center gap-2
  px-5 py-2.5
  text-sm font-medium
  rounded-md
  bg-white text-black
  hover:bg-zinc-200
  transition-all
">
  <Icon className="w-4 h-4" />
  按钮文字
</button>

// 次级按钮 (Secondary)
<button className="
  inline-flex items-center gap-2
  px-4 py-2
  text-sm font-medium
  rounded-md
  bg-zinc-800 text-zinc-300
  border border-zinc-700
  hover:border-zinc-500 hover:text-white
  transition-all
">
```

**关键特点**:
- `inline-flex` + `items-center` + `gap-2` (图标 + 文字)
- `px-5 py-2.5` (主按钮) / `px-4 py-2` (次级)
- `rounded-md` (中等圆角，不是 `rounded-lg` 或 `rounded-full`)
- `transition-all` (平滑过渡)

#### 输入框
```jsx
<input className="
  w-full px-3 py-2
  text-sm
  bg-zinc-800 border border-zinc-700
  rounded-md
  text-zinc-300
  placeholder-zinc-600
  focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-white/20
  transition-all
"/>
```

**关键特点**:
- 深色背景 (`bg-zinc-800`)
- 细边框 (`border-zinc-700`)
- 聚焦时白色光晕 (`focus:ring-white/20`)
- `transition-all` 平滑过渡

#### 卡片
```jsx
<section className="
  bg-zinc-900/50 border border-zinc-800
  rounded-xl
  p-6
">
```

**关键特点**:
- 半透明背景 (`bg-zinc-900/50`)
- 细边框 (`border-zinc-800`)
- 大圆角 (`rounded-xl`)
- 标准内边距 (`p-6` = 24px)

### 6. 图标使用

```jsx
// 图标尺寸
<svg className="w-4 h-4" />  // 按钮图标 (16px)
<svg className="w-5 h-5" />  // 中等图标 (20px)
<svg className="w-6 h-6" />  // 大图标 (24px)

// 图标 + 文字
<button className="inline-flex items-center gap-2">
  <svg className="w-4 h-4" />
  <span>文字</span>
</button>
```

### 7. 动效 (Motion)

```jsx
// 过渡
className="transition-all duration-200"

// 悬停
hover:bg-zinc-200
hover:border-zinc-500
hover:text-white

// 聚焦
focus:outline-none focus:ring-2 focus:ring-white/20

// 加载动画
<svg className="w-4 h-4 animate-spin" />
```

---

## 📐 Geist 布局模式

### 1. Header
```jsx
<header className="border-b border-zinc-800 bg-black/50 backdrop-blur-sm sticky top-0 z-50">
  <div className="max-w-7xl mx-auto px-6 py-4">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Logo className="w-6 h-6" />
        <div>
          <h1 className="text-lg font-semibold tracking-tight">标题</h1>
          <p className="text-xs text-zinc-500">副标题</p>
        </div>
      </div>
    </div>
  </div>
</header>
```

### 2. Section
```jsx
<section className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mb-8">
  <div className="flex items-center justify-between mb-6">
    <h2 className="text-sm font-medium text-zinc-300">章节标题</h2>
    <button className="text-xs text-zinc-500 hover:text-zinc-300">操作</button>
  </div>
  
  {/* 内容 */}
</section>
```

### 3. Grid 表单
```jsx
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
  {fields.map(field => (
    <div key={field.name}>
      <label className="block text-xs font-medium text-zinc-500 mb-2">
        {field.label}
      </label>
      <select className="w-full px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-md">
        {field.options}
      </select>
    </div>
  ))}
</div>
```

### 4. 按钮组
```jsx
<div className="flex items-center gap-3">
  <button className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-md bg-white text-black hover:bg-zinc-200">
    <Icon /> 主操作
  </button>
  <button className="px-4 py-2.5 text-sm font-medium rounded-md bg-zinc-800 text-zinc-300 hover:bg-zinc-700">
    次操作
  </button>
</div>
```

---

## 🎯 设计原则总结

### Vercel/Geist 核心

1. **克制** - 不用过多颜色，黑白灰主导
2. **精确** - 每个间距、圆角都有意义
3. **一致** - 相同元素相同样式
4. **平滑** - 所有交互都有过渡
5. **清晰** - 层级分明，对比度足够
6. **专业** - 不花哨，注重功能

### 常见错误

❌ 圆角不统一 (有的 `rounded-lg` 有的 `rounded-md`)
❌ 间距随意 (有的 `gap-3` 有的 `gap-4`)
❌ 颜色过多 (用了很多非 zinc 颜色)
❌ 没有过渡 (hover 直接变色)
❌ 字间距不对 (标题没用 `tracking-tight`)
❌ 图标对齐 (图标和文字不对齐)

---

## 📚 参考资源

- **Geist UI**: https://geist.dev
- **Vercel 官网**: https://vercel.com/design
- **Next.js UI**: https://nextjs.org/docs/app/building-your-application/routing/defining-routes
- **DESIGN.md**: https://getdesign.md/vercel/design-md

---

**真正理解 Geist，不是模仿颜色，而是理解原则！** 🎨

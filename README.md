# 📝 论文助手 v3

Next.js 全栈 AI 论文写作助手。流式输出、多模型、SQLite 对话存储、双源文献检索。

**✨ 新增功能（2026-04-09）**: 
- 🌐 论文翻译功能上线！支持中英互译、术语解释、润色优化
- 📄 PDF 上传与文本提取
- 📥 Word 文档导出（原文 + 译文对照）

---

## 🚀 快速启动

```bash
# 1. 安装依赖（约 1-3 分钟）
cd paper-assistant
npm install

# 2. 配置 API Key
cp .env.local.example .env.local
# 用编辑器打开 .env.local，填入你的 API Key

# 3. 启动
npm run dev
# 访问 http://localhost:3000
```

---

## ⚙️ .env.local 配置

| 变量 | 说明 |
|------|------|
| `ANTHROPIC_API_KEY` | Claude API Key，推荐 |
| `DEEPSEEK_API_KEY` | DeepSeek，国内可用 |
| `VOLC_API_KEY` + `VOLC_MODEL` | 火山方舟 |
| `DASHSCOPE_API_KEY` | 通义千问 |
| `DEFAULT_MODEL` | 默认模型：claude/deepseek/doubao/qwen |
| `SEMANTIC_SCHOLAR_API_KEY` | 可选，文献检索增强 |

---

## 📁 结构

```
pages/
  index.js              前端主界面
  translate.js          🆕 论文翻译页面
  api/
    chat.js             对话接口（流式 SSE）
    translate.js        🆕 翻译接口（支持流式）
    upload-pdf.js       🆕 PDF 上传与文本提取
    export-docx.js      🆕 Word 导出
    conversations.js    历史管理
    literature.js       文献检索
lib/
  systemPrompt.js       系统提示词（核心）
  aiCaller.js           多模型调用
  db.js                 SQLite 存储
  literature.js         CrossRef + OpenAlex + S2
uploads/                🆕 临时文件存储（PDF/Word）
```

---

## ❓ 常见问题

**Q: better-sqlite3 安装失败（Windows）**
```bash
npm install --global windows-build-tools
npm install
```

**Q: 文献检索为空**
- 换英文关键词，如 "machine learning" 替代 "机器学习"
- CrossRef 和 OpenAlex 均无需 Key，如果两个都失败说明网络问题

**Q: 429 错误**
- v3 已把 Semantic Scholar 改为备用（无 Key 时直接跳过）
- 主力改用 CrossRef 和 OpenAlex，无速率限制

**Q: PDF 上传失败**
- 确保 PDF 文件不超过 10MB
- 确保 PDF 是有效的（可以用其他 PDF 阅读器打开）
- 加密的 PDF 需要先解密

**Q: 导出 Word 失败**
- 确保已经有翻译结果
- 浏览器可能拦截弹窗，请允许下载

---

## 🧪 测试

### 翻译 API 测试
```bash
node test-translate.js
```

### PDF 上传测试
1. 访问 http://localhost:3000/translate
2. 点击 `📎 上传 PDF`
3. 选择 `uploads/test-paper.pdf`
4. 验证文本提取成功

---

## 🆕 翻译功能

**访问地址**: http://localhost:3000/translate

### 功能特性
- 📝 **翻译模式**: 专业学术论文中英互译
- 💡 **术语解释**: 解释专业术语和概念
- ✨ **润色优化**: 优化表达，使论文更学术化
- 🎯 **学科领域**: 通用 / 计算机 / 医学 / 工程 / 生物学
- ⚡ **流式输出**: 实时显示翻译结果

### 使用方式
1. 在主页点击顶部导航栏的 `🌐 翻译` 按钮
2. 选择翻译模式、学科领域、语言方向
3. 粘贴或输入要翻译的内容（或直接上传 PDF）
4. 点击 `开始翻译`，实时查看结果
5. 可选：点击 `📥 导出 Word` 下载翻译文档

### PDF 翻译流程
1. 点击 `📎 上传 PDF` 按钮
2. 选择要翻译的 PDF 论文文件（最大 10MB）
3. 系统自动提取文本并填充到输入框
4. 选择翻译模式和学科领域
5. 点击 `开始翻译`
6. 翻译完成后点击 `📥 导出 Word` 下载


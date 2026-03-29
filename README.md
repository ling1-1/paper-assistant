# 📝 论文助手 v3

Next.js 全栈 AI 论文写作助手。流式输出、多模型、SQLite 对话存储、双源文献检索。

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
  api/
    chat.js             对话接口（流式 SSE）
    conversations.js    历史管理
    literature.js       文献检索
lib/
  systemPrompt.js       系统提示词（核心）
  aiCaller.js           多模型调用
  db.js                 SQLite 存储
  literature.js         CrossRef + OpenAlex + S2
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


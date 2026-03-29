# Vercel 部署配置指南

## 🚀 部署步骤

### 1. 访问 Vercel
- 打开：https://vercel.com/new
- 使用 GitHub 账号登录

### 2. 导入项目
1. 点击 "Import Git Repository"
2. 找到 `ling1-1/paper-assistant`
3. 点击 "Import"

### 3. 配置环境变量

在 Vercel 的 "Environment Variables" 部分添加以下变量：

#### 必需配置
```bash
# 火山方舟 API（已配置）
VOLC_API_KEY=d78c3528-7a65-4746-a704-43660d80493d
VOLC_MODEL=ep-20260309122322-xwfhv

# 默认模型
DEFAULT_MODEL=doubao
```

#### 可选配置（根据需要添加）
```bash
# Claude API（推荐，效果最好）
ANTHROPIC_API_KEY=sk-ant-你的 Key

# DeepSeek API（国内可用，性价比高）
DEEPSEEK_API_KEY=sk-你的 Key

# 通义千问 API
DASHSCOPE_API_KEY=你的 Key

# Semantic Scholar API（文献检索增强，可选）
SEMANTIC_SCHOLAR_API_KEY=
```

### 4. 部署
1. 点击 "Deploy"
2. 等待 2-3 分钟
3. 部署完成后获得公网访问地址

---

## ⚠️ 重要注意事项

### 数据库问题
**当前使用 SQLite**：
- 文件：`chat_history.db`
- **问题**：Vercel 是无服务器环境，SQLite 文件不会持久化
- **影响**：对话历史在重启后会丢失

**解决方案**：

#### 方案 A：临时测试（当前）
- 功能正常，但对话历史不保存
- 适合快速测试和演示

#### 方案 B：使用 Vercel KV（推荐）
1. 在 Vercel Dashboard 创建 KV 数据库
2. 安装 `@vercel/kv` 包
3. 修改 `lib/db.js` 使用 KV 存储
4. 配置 `KV_URL` 环境变量

#### 方案 C：使用 Supabase（免费）
1. 注册 https://supabase.com
2. 创建 Postgres 数据库
3. 配置 `SUPABASE_URL` 和 `SUPABASE_KEY`
4. 修改代码使用 Supabase

### 构建配置
Vercel 会自动检测 Next.js 项目：
- **Build Command**: `npm run build`
- **Output Directory**: `.next`
- **Node Version**: 18.x

### 域名配置
- Vercel 提供免费的 `*.vercel.app` 域名
- 可以绑定自定义域名（免费）

---

## 🔧 后续优化建议

### 1. 数据库迁移
修改 `lib/db.js` 支持云数据库：

```javascript
// 示例：使用 Vercel KV
import { kv } from '@vercel/kv';

export async function saveMessage(conversationId, role, content) {
  await kv.lpush(`conversation:${conversationId}:messages`, {
    role,
    content,
    timestamp: Date.now()
  });
}
```

### 2. 添加更多 API Provider
在 `lib/aiCaller.js` 中添加：
- OpenAI GPT-4
- Google Gemini
- Moonshot Kimi

### 3. 文献检索优化
- 添加 PubMed 支持
- 添加 arXiv 支持
- 添加 Google Scholar（需要代理）

---

## 📊 访问地址

部署成功后：
- **生产环境**: `https://paper-assistant-xxx.vercel.app`
- **预览环境**: 每次 push 都会生成预览链接

---

## 🎯 下一步

1. ✅ 推送代码到 GitHub
2. ⏳ 在 Vercel 导入项目
3. ⏳ 配置环境变量
4. ⏳ 等待部署完成
5. ⏳ 测试公网访问

---

*最后更新：2026-03-29*

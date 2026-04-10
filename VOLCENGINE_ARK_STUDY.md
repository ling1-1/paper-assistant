# 📚 火山方舟 Ark 官方文档学习笔记

**学习时间**: 2026-04-10  
**资料来源**: 
- GitHub: https://github.com/volcengine/ai-app-lab
- 官方文档：https://www.volcengine.com/docs/product/ark
- API 文档：https://www.volcengine.com/docs/82379

---

## 🏗️ 官方架构

```
AI App Lab/
├── arkitect/          # 高代码 Python SDK
├── demohouse/         # 原型应用代码
├── docs/              # 文档
├── examples/          # 示例
├── mcp/server/        # MCP 服务器
└── scripts/           # 脚本工具
```

---

## 🔑 核心概念

### 1. Arkitect (高代码 SDK)

**定位**: 面向专业开发者的 Python SDK

**功能**:
- 工具集 (Tools)
- 流程集 (Flows)
- 大模型应用开发支持

**安装**:
```bash
pip install 'volcengine-python-sdk[ark]'
```

### 2. Demohouse (原型应用)

**已开源的应用**:

| 应用 | 说明 |
|------|------|
| 互动双语视频生成器 | 输入主题生成双语视频 |
| 深度推理 | DeepSeek-R1 复杂问题分析 |
| DeepDoubao | R1 推理 + 豆包对话 |
| 语音实时通话 - 青青 | 语音通话 AI |
| 长记忆方案 | 对话内容抽取成记忆 |
| 手机助手 | 移动端智能助手 |
| 智能客服助手 | 车载零配件网店客服 |
| 教师分身 | 视觉理解 + 深度推理教育方案 |
| 视频实时理解 | 多模态实时视觉/语音理解 |
| 实时对话式 AI | 超低延迟 AI 对话 |
| AI-Media2Doc | 音视频转文档/知识笔记 |
| Mobile-Use | 云手机 + 豆包视觉自动化 |

---

## 🔌 API 使用指南

### 1. 获取 API Key

1. 访问火山引擎控制台
2. 搜索进入"火山方舟 (Ark)"
3. 左侧菜单 → "API Key 管理"
4. 创建 API Key

### 2. 开通模型服务

访问开通管理页面开通所需模型服务

### 3. API 端点

```
Base URL: https://ark.cn-beijing.volces.com/api/v3
```

### 4. 核心 API

#### Files API (文件上传)

```http
POST /api/v3/files
Authorization: Bearer {api_key}
Content-Type: multipart/form-data

purpose: user_data
file: <binary>
```

**响应**:
```json
{
  "id": "file-xxx",
  "object": "file",
  "bytes": 12345,
  "created_at": 1234567890,
  "filename": "paper.pdf",
  "purpose": "user_data",
  "status": "uploaded"
}
```

#### Responses API (推荐)

```http
POST /api/v3/responses
Authorization: Bearer {api_key}
Content-Type: application/json

{
  "model": "doubao-seed-2-0-pro-260215",
  "input": [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "请翻译这篇论文"
        },
        {
          "type": "input_file",
          "file_id": "file-xxx"
        }
      ]
    }
  ]
}
```

**响应**:
```json
{
  "id": "resp-xxx",
  "object": "response",
  "output": [
    {
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "翻译结果..."
        }
      ]
    }
  ],
  "usage": {
    "prompt_tokens": 100,
    "completion_tokens": 200,
    "total_tokens": 300
  }
}
```

#### Chat Completions API (兼容 OpenAI)

```http
POST /api/v3/chat/completions
Authorization: Bearer {api_key}
Content-Type: application/json

{
  "model": "doubao-seed-2-0-pro-260215",
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "你好"
        }
      ]
    }
  ]
}
```

---

## 📝 Python SDK 使用示例

### 基础使用

```python
from volcengine-python-sdk import Ark

client = Ark(api_key="your-api-key")

# 文本生成
response = client.chat.completions.create(
    model="doubao-seed-2-0-pro-260215",
    messages=[
        {"role": "user", "content": "你好"}
    ]
)

print(response.choices[0].message.content)
```

### 文件上传

```python
from volcengine-python-sdk import Ark

client = Ark(api_key="your-api-key")

# 上传文件
with open("paper.pdf", "rb") as f:
    file = client.files.create(
        file=f,
        purpose="user_data"
    )

print(f"File ID: {file.id}")
```

### 文件翻译

```python
from volcengine-python-sdk import Ark

client = Ark(api_key="your-api-key")

# 1. 上传文件
with open("paper.pdf", "rb") as f:
    file = client.files.create(file=f, purpose="user_data")

# 2. 使用 Responses API 翻译
response = client.responses.create(
    model="doubao-seed-2-0-pro-260215",
    input=[
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": "请翻译这篇论文"
                },
                {
                    "type": "input_file",
                    "file_id": file.id
                }
            ]
        }
    ]
)

print(response.output[0].content[0].text)
```

### 流式输出

```python
from volcengine-python-sdk import Ark

client = Ark(api_key="your-api-key")

stream = client.chat.completions.create(
    model="doubao-seed-2-0-pro-260215",
    messages=[{"role": "user", "content": "你好"}],
    stream=True
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
```

---

## 🎯 关键发现

### 1. API 版本

- **v1**: 旧版本 (已废弃)
- **v3**: 当前版本 ✅

**错误示例**:
```
❌ https://ark.cn-beijing.volces.com/api/v1/files
✅ https://ark.cn-beijing.volces.com/api/v3/files
```

### 2. Purpose 参数

- **assistants**: 用于 Assistant API
- **user_data**: 用于 Responses API ✅

**错误示例**:
```
❌ purpose: "assistants"
✅ purpose: "user_data"
```

### 3. 文件类型

- **input_file**: Responses API 使用 ✅
- **file_id**: Chat Completions API 使用

**错误示例**:
```
❌ {"type": "file_id", "file_id": "xxx"}
✅ {"type": "input_file", "file_id": "xxx"}
```

### 4. 流式支持

- **Chat Completions API**: 支持流式 ✅
- **Responses API**: 暂不支持流式 ⚠️

---

## 🐛 常见错误及解决方案

### 错误 1: 404 Not Found

**原因**: API 端点不对
```
❌ /api/v1/files
✅ /api/v3/files
```

### 错误 2: 400 Bad Request - Invalid purpose

**原因**: purpose 参数不对
```
❌ purpose: "assistants"
✅ purpose: "user_data"
```

### 错误 3: 400 Bad Request - Invalid content type

**原因**: content type 不对
```
❌ {"type": "file_id"}
✅ {"type": "input_file"}
```

### 错误 4: FormData 无法使用

**原因**: Next.js API Route 不能直接用浏览器 FormData

**解决方案**:
```javascript
// ❌ 错误
const formData = new FormData();
formData.append('file', new Blob([buffer]));

// ✅ 正确 (使用 form-data 包)
import FormData from 'form-data';
const formData = new FormData();
formData.append('file', buffer, {
  filename: 'paper.pdf',
  contentType: 'application/pdf'
});
```

---

## 📚 参考资料

- **GitHub**: https://github.com/volcengine/ai-app-lab
- **官方文档**: https://www.volcengine.com/docs/product/ark
- **API 文档**: https://www.volcengine.com/docs/82379
- **Python SDK**: `pip install 'volcengine-python-sdk[ark]'`
- **Demo 体验**: https://console.volcengine.com/ark/region:ark+cn-beijing/application

---

**下次修复时严格按照官方文档来！** 📖

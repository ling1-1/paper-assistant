# 🔍 火山方舟官方代码库深度学习

**学习时间**: 2026-04-10  
**仓库**: https://github.com/volcengine/ai-app-lab  
**代码量**: 3648 个文件

---

## 📦 仓库结构

```
ai-app-lab/
├── arkitect/              # 高代码 Python SDK
│   ├── core/              # 核心组件
│   ├── launcher/          # 启动器
│   ├── telemetry/         # 遥测/Trace
│   ├── types/             # 类型定义
│   └── utils/             # 工具函数
├── demohouse/             # 原型应用 (12 个)
│   ├── chat2cartoon/      # 互动双语视频生成器
│   ├── deep_research/     # 深度推理
│   ├── deepdoubao/        # DeepSeek R1 + Doubao
│   ├── live_voice_call/   # 语音实时通话
│   ├── longterm_memory/   # 长记忆方案
│   ├── media2doc/         # 音视频转文档
│   ├── pocket_pal/        # 手机助手
│   ├── shop_assist/       # 智能客服
│   ├── teacher_avatar/    # 教师分身
│   ├── video_analyser/    # 视频实时理解
│   └── rtc_conversational_ai/
├── docs/                  # 文档
├── examples/              # 示例代码
└── mcp/server/            # MCP 服务器
```

---

## 🎯 Arkitect SDK 核心

### 架构设计

```
用户请求 → Launcher (启动器)
         ↓
    Core (核心组件)
    ├── LLM (模型调用)
    ├── Plugin (插件调用)
    └── Context (上下文管理)
         ↓
    Telemetry (Trace 监控)
         ↓
    响应输出
```

### 核心组件

#### 1. LLM 调用

```python
from arkitect.core.component.llm import ArkChatRequest
from arkitect.types.llm.model import (
    ArkChatCompletionChunk,
    ArkChatResponse,
)

@task()
async def default_model_calling(
    request: ArkChatRequest,
) -> AsyncIterable[Union[ArkChatCompletionChunk, ArkChatResponse]]:
    parameters = ArkChatParameters(**request.__dict__)
    ctx = Context(model="doubao-1.5-pro-32k-250115", parameters=parameters)
    await ctx.init()
    
    messages = [
        {"role": message.role, "content": message.content}
        for message in request.messages
    ]
    
    resp = await ctx.completions.create(messages=messages, stream=request.stream)
    
    if request.stream:
        async for chunk in resp:
            yield chunk
    else:
        yield resp
```

#### 2. 启动器

```python
from arkitect.launcher.local.serve import launch_serve

if __name__ == "__main__":
    port = os.getenv("_FAAS_RUNTIME_PORT")
    launch_serve(
        package_path="main",
        port=int(port) if port else 8080,
        health_check_path="/v1/ping",
        endpoint_path="/api/v3/bots/chat/completions",
        clients={},
    )
```

#### 3. Trace 监控

```python
from arkitect.telemetry.trace import task

@task()
async def main(request: ArkChatRequest):
    # 自动记录 Trace
    async for resp in default_model_calling(request):
        yield resp
```

---

## 🏠 Demohouse 原型应用分析

### 1. Media2Doc (音视频转文档)

**功能**: 一键将视频/音频转化为小红书/公众号/知识笔记等文档

**后端架构**:
```
backend/
├── main.py              # 主入口
├── env.py               # 环境变量配置
├── actions/
│   ├── dispatcher.py    # 动作分发器
│   ├── llm.py           # LLM 调用
│   ├── asr.py           # 语音识别
│   └── tos.py           # 火山 TOS 存储
```

**关键代码**:

#### TOS 文件上传
```python
import tos
from arkitect.core.component.llm import ArkChatRequest

@ActionDispatcher.register("generate_upload_url")
async def generate_upload_url(request: ArkChatRequest):
    file_name = request.messages[0].content
    tos_client = tos.TosClient(
        tos.Auth(TOS_ACCESS_KEY, TOS_SECRET_KEY, TOS_REGION),
        TOS_ENDPOINT
    )
    
    # 生成预签名 URL
    url = tos_client.generate_presigned_url(
        Method="PUT",
        Bucket=TOS_BUCKET,
        Key=file_name,
        ExpiresIn=3600
    )
    
    yield ArkChatResponse(
        id="upload_url",
        metadata={"upload_url": url}
    )
```

#### LLM 处理
```python
from arkitect.core.component.llm import ArkChatRequest
from arkitect.types.llm.model import ArkChatResponse

@ActionDispatcher.register("process_content")
async def process_content(request: ArkChatRequest):
    # 调用 LLM 处理内容
    # ...
    yield ArkChatResponse(
        choices=[{"message": {"content": processed_content}}]
    )
```

### 2. Deep Research (深度推理)

**功能**: 利用 DeepSeek-R1 对复杂问题进行多角度分析

**核心文件**:
- `deep_search.py` - 深度搜索逻辑
- `search_engine/` - 搜索引擎集成
- `webui.py` - Web 界面

### 3. Video Analyser (视频实时理解)

**功能**: 多模态洞察，基于豆包视觉理解模型

**核心能力**:
- 实时视频流处理
- 视觉 + 语音理解
- 多模态融合

---

## 🔌 API 调用模式

### 模式 1: 直接使用 Python SDK

```python
from arkitect.core.component.context import Context
from arkitect.types.llm.model import ArkChatRequest

# 初始化上下文
ctx = Context(model="doubao-1.5-pro-32k-250115")
await ctx.init()

# 调用模型
resp = await ctx.completions.create(
    messages=[{"role": "user", "content": "你好"}],
    stream=True
)

async for chunk in resp:
    print(chunk.choices[0].delta.content)
```

### 模式 2: 使用 REST API

```bash
curl --location 'http://localhost:8080/api/v3/bots/chat/completions' \
--header 'Content-Type: application/json' \
--data '{
    "model": "my-bot",
    "messages": [{"role": "user", "content": "介绍你自己"}]
}'
```

### 模式 3: 使用火山方舟 API

```python
import volcengines_python_sdk as volc

client = volc.Ark(api_key="your-api-key")

# 文件上传
with open("paper.pdf", "rb") as f:
    file = client.files.create(file=f, purpose="user_data")

# Responses API
response = client.responses.create(
    model="doubao-seed-2-0-pro-260215",
    input=[{
        "role": "user",
        "content": [
            {"type": "text", "text": "翻译这篇论文"},
            {"type": "input_file", "file_id": file.id}
        ]
    }]
)
```

---

## 📝 关键发现

### 1. 项目结构规范

```
project/
├── backend/
│   ├── main.py          # 入口
│   ├── config.py        # 配置
│   ├── actions/         # 动作/功能
│   └── utils/           # 工具
├── frontend/            # 前端
└── README.md
```

### 2. 动作分发器模式

```python
class ActionDispatcher:
    _actions = {}
    
    @classmethod
    def register(cls, name):
        def decorator(func):
            cls._actions[name] = func
            return func
        return decorator
    
    @classmethod
    async def dispatch(cls, name, request):
        if name not in cls._actions:
            raise ValueError(f"Unknown action: {name}")
        return cls._actions[name](request)

# 使用
@ActionDispatcher.register("translate")
async def translate(request):
    # ...
```

### 3. 环境变量管理

```python
# env.py
import os

ARK_API_KEY = os.getenv("ARK_API_KEY")
VOLC_MODEL = os.getenv("VOLC_MODEL", "doubao-seed-2-0-pro-260215")
TOS_ACCESS_KEY = os.getenv("TOS_ACCESS_KEY")
TOS_SECRET_KEY = os.getenv("TOS_SECRET_KEY")
```

### 4. 流式输出模式

```python
from typing import AsyncIterable, Union
from arkitect.types.llm.model import ArkChatCompletionChunk, ArkChatResponse

async def stream_handler(request) -> AsyncIterable[Union[ArkChatCompletionChunk, ArkChatResponse]]:
    # 流式处理
    async for chunk in response:
        yield chunk
```

---

## 🎯 对 Paper Assistant 的改进建议

### 1. 代码结构优化

**当前问题**:
- API Route 和前端混在一起
- 缺少统一的动作分发器
- 配置分散

**改进方案**:
```
paper-assistant/
├── backend/
│   ├── main.py          # 统一入口
│   ├── actions/
│   │   ├── translate.py
│   │   ├── upload.py
│   │   └── export.py
│   └── utils/
├── pages/               # Next.js 前端
└── config.py
```

### 2. 使用 Arkitect SDK

**当前**: 直接用 fetch 调用 API
**改进**: 使用官方 SDK

```python
from arkitect.core.component.context import Context

ctx = Context(model="doubao-seed-2-0-pro-260215")
await ctx.init()

resp = await ctx.completions.create(
    messages=[{"role": "user", "content": text}],
    stream=True
)
```

### 3. 添加 Trace 监控

```python
from arkitect.telemetry.trace import task

@task()
async def translate_paper(request):
    # 自动记录 Trace
    # ...
```

### 4. 动作分发器

```python
# actions/dispatcher.py
class PaperActionDispatcher:
    @classmethod
    def register(cls, name):
        # ...
    
    @classmethod
    async def dispatch(cls, name, request):
        # ...

# actions/translate.py
@PaperActionDispatcher.register("translate")
async def translate(request):
    # ...
```

---

## 📚 学习资源

### 官方文档
- **GitHub**: https://github.com/volcengine/ai-app-lab
- **SDK 文档**: /tmp/ai-app-lab/arkitect/README.md
- **应用示例**: /tmp/ai-app-lab/demohouse/

### 本地代码
- **SDK 实现**: `/tmp/ai-app-lab/arkitect/core/`
- **原型应用**: `/tmp/ai-app-lab/demohouse/*/backend/`
- **配置示例**: `/tmp/ai-app-lab/demohouse/*/backend/env.py`

---

## ✅ 下一步行动

1. **重构代码结构** - 按照官方规范
2. **引入 Arkitect SDK** - 替代直接 fetch
3. **添加动作分发器** - 统一管理功能
4. **集成 Trace 监控** - 便于调试
5. **优化配置管理** - 集中管理环境变量

---

**持续学习中... 深入理解官方实现模式！** 📖🔍

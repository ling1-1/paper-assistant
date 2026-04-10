# 🎓 火山方舟官方代码库最终学习报告

**学习时间**: 2026-04-10  
**学习深度**: 完整分析官方仓库架构和实现模式  
**目标**: 为 Paper Assistant 重构做准备

---

## 📊 学习总结

### 1. 核心架构模式

#### 动作分发器 (ActionDispatcher)

**官方实现**:
```python
class ActionDispatcher:
    _instance = None
    _actions: Dict[str, Callable] = {}
    
    @classmethod
    def register(cls, action_name: str):
        def decorator(func):
            cls._actions[action_name] = func
            @wraps(func)
            def wrapper(*args, **kwargs):
                return func(*args, **kwargs)
            return wrapper
        return decorator
    
    async def dispatch(self, action_name: str, *args, **kwargs):
        if action_name not in self._actions:
            raise ValueError(f"Action {action_name} not found")
        action = self._actions[action_name]
        async for response in action(*args, **kwargs):
            yield response
```

**使用方式**:
```python
# 注册动作
@ActionDispatcher.register("translate")
async def translate(request: ArkChatRequest):
    # ...

@ActionDispatcher.register("upload")
async def upload(request: ArkChatRequest):
    # ...

# 分发执行
dispatcher = ActionDispatcher()
async for response in dispatcher.dispatch("translate", request):
    yield response
```

#### 上下文管理 (Context)

**官方实现**:
```python
from arkitect.core.component.context import Context
from arkitect.types.llm.model import ArkChatParameters

# 初始化上下文
parameters = ArkChatParameters(**request.__dict__)
ctx = Context(model=MODEL_ID, parameters=parameters)
await ctx.init()

# 调用模型
messages = [
    {"role": message.role, "content": message.content}
    for message in request.messages
]
resp = await ctx.completions.create(messages=messages, stream=request.stream)

# 流式输出
if request.stream:
    async for chunk in resp:
        yield chunk
else:
    yield resp
```

#### 统一入口 (main.py)

**官方实现**:
```python
from arkitect.launcher.local.serve import launch_serve
from arkitect.telemetry.trace import task
from arkitect.types.llm.model import ArkChatRequest

@task()
async def main(request: ArkChatRequest) -> AsyncIterable[Response]:
    dispatcher = ActionDispatcher()
    request_action = get_headers().get("request-action", "default")
    
    async for response in dispatcher.dispatch(request_action, request):
        yield response

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

---

## 🏗️ Paper Assistant 重构方案

### 阶段 1: 代码结构调整

**当前结构**:
```
paper-assistant/
├── pages/
│   ├── api/
│   │   ├── translate.js
│   │   ├── translate-direct.js
│   │   └── upload-pdf-advanced.js
│   └── translate.js
└── lib/
    └── aiCaller.js
```

**目标结构**:
```
paper-assistant/
├── backend/
│   ├── main.py              # 统一入口
│   ├── env.py               # 环境变量
│   ├── actions/
│   │   ├── dispatcher.py    # 动作分发器
│   │   ├── translate.py     # 翻译动作
│   │   ├── upload.py        # 上传动作
│   │   └── export.py        # 导出动作
│   └── utils/
│       └── tos.py           # 火山 TOS 工具
├── pages/                   # Next.js 前端
│   ├── translate-vercel.js
│   └── api/
│       └── proxy.js         # API 代理
└── config.py
```

### 阶段 2: 引入 Arkitect SDK

**当前问题**:
- 直接用 fetch 调用火山 API
- 需要手动处理认证、错误、重试
- 没有 Trace 监控

**改进方案**:
```python
from arkitect.core.component.context import Context
from arkitect.telemetry.trace import task

@task()
async def translate_paper(request: ArkChatRequest):
    parameters = ArkChatParameters(**request.__dict__)
    ctx = Context(model="doubao-seed-2-0-pro-260215", parameters=parameters)
    await ctx.init()
    
    messages = [{"role": "user", "content": request.messages[0].content}]
    resp = await ctx.completions.create(messages=messages, stream=request.stream)
    
    if request.stream:
        async for chunk in resp:
            yield chunk
    else:
        yield resp
```

**优势**:
- ✅ 自动 Trace 监控
- ✅ 简化错误处理
- ✅ 统一的上下文管理
- ✅ 支持流式输出

### 阶段 3: 文件上传改进

**当前问题**:
- API 端点错误 (v1 → v3)
- purpose 参数错误 (assistants → user_data)
- content type 错误 (file_id → input_file)
- FormData 使用不当

**改进方案**:

#### 方案 A: 使用 Arkitect SDK
```python
from arkitect.core.component.file import upload_file

@ActionDispatcher.register("upload")
async def upload(request: ArkChatRequest):
    file_buffer = request.messages[0].content
    file = await upload_file(
        buffer=file_buffer,
        filename="paper.pdf",
        purpose="user_data"
    )
    
    yield ArkChatResponse(
        metadata={"file_id": file.id, "status": file.status}
    )
```

#### 方案 B: 使用火山 TOS (推荐)
```python
import tos
from arkitect.types.llm.model import ArkChatResponse

@ActionDispatcher.register("upload")
async def upload(request: ArkChatRequest):
    # 初始化 TOS 客户端
    tos_client = tos.TosClient(
        tos.Auth(TOS_ACCESS_KEY, TOS_SECRET_KEY, TOS_REGION),
        TOS_ENDPOINT
    )
    
    # 生成预签名 URL
    upload_url = tos_client.generate_presigned_url(
        Method="PUT",
        Bucket=TOS_BUCKET,
        Key=request.filename,
        ExpiresIn=3600
    )
    
    yield ArkChatResponse(
        metadata={"upload_url": upload_url}
    )
```

### 阶段 4: API 路由改进

**当前**: Next.js API Routes
**改进**: Python FastAPI + Next.js 代理

#### Python 后端 (FastAPI)
```python
from fastapi import FastAPI, Header
from arkitect.types.llm.model import ArkChatRequest

app = FastAPI()

@app.post("/api/v3/bots/chat/completions")
async def chat_completions(
    request: ArkChatRequest,
    request_action: str = Header(default="default")
):
    dispatcher = ActionDispatcher()
    async for response in dispatcher.dispatch(request_action, request):
        yield response
```

#### Next.js 代理
```javascript
// pages/api/proxy.js
export default async function handler(req, res) {
  const response = await fetch('http://localhost:8080' + req.url, {
    method: req.method,
    headers: req.headers,
    body: req.body,
  });
  
  const stream = response.body;
  res.setHeader('Content-Type', 'text/event-stream');
  stream.pipe(res);
}
```

---

## 📝 实施步骤

### 第 1 步：环境准备
```bash
# 安装 Arkitect SDK
pip install arkitect --index-url https://pypi.org/simple

# 安装 FastAPI
pip install fastapi uvicorn

# 安装火山 TOS SDK
pip install tos
```

### 第 2 步：创建后端结构
```bash
mkdir -p backend/{actions,utils}
touch backend/{main.py,env.py,config.py}
touch backend/actions/{dispatcher.py,translate.py,upload.py,export.py}
```

### 第 3 步：实现动作分发器
```python
# backend/actions/dispatcher.py
class ActionDispatcher:
    _instance = None
    _actions = {}
    
    @classmethod
    def register(cls, action_name):
        def decorator(func):
            cls._actions[action_name] = func
            return func
        return decorator
    
    async def dispatch(self, action_name, *args, **kwargs):
        if action_name not in self._actions:
            raise ValueError(f"Action {action_name} not found")
        action = self._actions[action_name]
        async for response in action(*args, **kwargs):
            yield response
```

### 第 4 步：实现翻译动作
```python
# backend/actions/translate.py
from arkitect.core.component.context import Context
from arkitect.types.llm.model import ArkChatParameters, ArkChatRequest
from arkitect.telemetry.trace import task
from .dispatcher import ActionDispatcher

@ActionDispatcher.register("translate")
@task()
async def translate(request: ArkChatRequest):
    parameters = ArkChatParameters(**request.__dict__)
    ctx = Context(model="doubao-seed-2-0-pro-260215", parameters=parameters)
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

### 第 5 步：实现上传动作
```python
# backend/actions/upload.py
import tos
from arkitect.types.llm.model import ArkChatResponse
from .dispatcher import ActionDispatcher
import env

@ActionDispatcher.register("upload")
async def upload(request: ArkChatRequest):
    tos_client = tos.TosClient(
        tos.Auth(env.TOS_ACCESS_KEY, env.TOS_SECRET_KEY, env.TOS_REGION),
        env.TOS_ENDPOINT
    )
    
    upload_url = tos_client.generate_presigned_url(
        Method="PUT",
        Bucket=env.TOS_BUCKET,
        Key=request.filename,
        ExpiresIn=3600
    )
    
    yield ArkChatResponse(
        metadata={"upload_url": upload_url}
    )
```

### 第 6 步：实现统一入口
```python
# backend/main.py
import os
from typing import AsyncIterable
from arkitect.core.errors import APIException
from arkitect.launcher.local.serve import launch_serve
from arkitect.telemetry.trace import task
from arkitect.types.llm.model import ArkChatRequest
from arkitect.types.runtime.model import Response
from arkitect.utils.context import get_headers

from actions.dispatcher import ActionDispatcher
import env

@task()
async def main(request: ArkChatRequest) -> AsyncIterable[Response]:
    dispatcher = ActionDispatcher()
    request_action = get_headers().get("request-action", "default")
    
    if (
        env.WEB_ACCESS_PASSWORD
        and get_headers().get("request-web-access-password") != env.WEB_ACCESS_PASSWORD
    ):
        raise APIException(message="Unauthorized", code="401", http_code=401)
    
    async for response in dispatcher.dispatch(request_action, request):
        yield response

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

### 第 7 步：配置环境变量
```python
# backend/env.py
import os

# 火山方舟配置
ARK_API_KEY = os.getenv("ARK_API_KEY", "")
VOLC_MODEL = os.getenv("VOLC_MODEL", "doubao-seed-2-0-pro-260215")

# TOS 配置
TOS_ACCESS_KEY = os.getenv("TOS_ACCESS_KEY", "")
TOS_SECRET_KEY = os.getenv("TOS_SECRET_KEY", "")
TOS_REGION = os.getenv("TOS_REGION", "cn-beijing")
TOS_BUCKET = os.getenv("TOS_BUCKET", "paper-assistant")
TOS_ENDPOINT = os.getenv("TOS_ENDPOINT", "tos-cn-beijing.volces.com")

# 安全配置
WEB_ACCESS_PASSWORD = os.getenv("WEB_ACCESS_PASSWORD", None)

# 设置环境变量以供 arkitect 使用
os.environ["ARK_API_KEY"] = ARK_API_KEY
```

### 第 8 步：启动后端
```bash
cd backend
export ARK_API_KEY=your-api-key
export TOS_ACCESS_KEY=your-access-key
export TOS_SECRET_KEY=your-secret-key
python3 main.py
```

### 第 9 步：更新前端
```javascript
// pages/translate-vercel.js
// 修改 API 调用，添加 request-action header
const response = await fetch('/api/proxy', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'request-action': 'translate',
  },
  body: JSON.stringify({
    messages: [{role: 'user', content: text}]
  })
});
```

---

## 🎯 预期效果

### 代码质量提升
- ✅ 统一的架构模式
- ✅ 清晰的职责分离
- ✅ 可复用的组件
- ✅ 易于测试和维护

### 功能改进
- ✅ 正确的 API 调用 (v3, user_data, input_file)
- ✅ 自动 Trace 监控
- ✅ 统一的错误处理
- ✅ 支持流式输出
- ✅ 文件上传到 TOS

### 开发体验提升
- ✅ 动作分发器简化路由
- ✅ Context 简化模型调用
- ✅ 环境变量集中管理
- ✅ 前后端分离

---

## 📚 参考资源

### 官方代码
- **仓库**: `/tmp/ai-app-lab/`
- **SDK**: `/tmp/ai-app-lab/arkitect/`
- **示例**: `/tmp/ai-app-lab/demohouse/*/backend/`

### 学习笔记
- `VOLCENGINE_ARK_STUDY.md` - API 学习笔记
- `VOLCENGINE_CODE_STUDY.md` - 代码库学习笔记
- `VOLCENGINE_FINAL_STUDY.md` - 最终学习报告 (本文件)

---

**学习完成！准备开始重构 Paper Assistant！** 🚀📖

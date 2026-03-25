# 聊天运行时 HTTP 契约

本文档描述当前已实现的聊天运行时 HTTP 契约，包括 control-plane 端点、单端点聊天方法分发、请求/响应结构与错误语义。

## 概述

Desktop runtime 提供两类 HTTP 端点：

1. **Control-plane 端点**：健康检查、版本信息、诊断数据（GET 方法）
2. **聊天 runtime 端点**：单根路径 POST 端点，通过 `method` 字段分发到不同聊天方法

当前实现阶段：`phase3-run-bridge`，支持最小聊天 MVP，包括 info 查询、session 连接与文本对话运行。

**代码锚点**：
- [`backend/app/desktop_runtime/server.py`](../backend/app/desktop_runtime/server.py) - FastAPI 应用与端点注册
- [`backend/app/copilot_runtime/router.py`](../backend/app/copilot_runtime/router.py) - 单端点方法分发路由
- [`backend/app/copilot_runtime/contracts.py`](../backend/app/copilot_runtime/contracts.py) - 契约数据结构
- [`backend/app/copilot_runtime/protocol.py`](../backend/app/copilot_runtime/protocol.py) - 协议解析与验证

## Control-Plane 端点

### GET /health

健康检查端点，返回服务基本状态。

**响应结构**（[`HealthContract`](../backend/app/desktop_runtime/contracts.py:17-21)）：
```json
{
  "service": "sustech-copilot-desktop-runtime",
  "status": "ok",
  "ready": true,
  "transport": "loopback-http"
}
```

**语义**：
- `ready`: 运行时是否完成启动并可接受请求
- 始终返回 200 状态码（即使 `ready: false`）

**测试依据**：[`backend/tests/unit/desktop_runtime/test_server.py:116-232`](../backend/tests/unit/desktop_runtime/test_server.py:116-232)

### GET /ready

就绪状态端点，返回详细的启动状态。

**响应结构**（[`ReadinessContract`](../backend/app/desktop_runtime/contracts.py:24-30)）：
```json
{
  "service": "sustech-copilot-desktop-runtime",
  "status": "ready",
  "ready": true,
  "startup_complete": true,
  "last_error": null
}
```

**语义**：
- `status`: 生命周期状态（`"starting"` | `"ready"` | `"stopped"`）
- `startup_complete`: 启动流程是否完成
- `last_error`: 最近一次启动错误消息（如有）

### GET /version 与 GET /build-info

版本信息端点（两个路径返回相同内容）。

**响应结构**（[`VersionContract`](../backend/app/desktop_runtime/contracts.py:34-40)）：
```json
{
  "service": "sustech-copilot-desktop-runtime",
  "version": "0.1.0",
  "python_version": "3.12.0",
  "app_mode": "desktop",
  "environment": "production",
  "build": {
    "transport": "loopback-http",
    "entrypoint": "app.desktop_runtime.server",
    "base_url": "http://127.0.0.1:8765"
  }
}
```

### GET /diagnostics 与 GET /diagnostics/runtime-info

诊断信息端点（需要 local token 认证，如已配置）。

**认证**：
- 如果配置了 `local_token`，必须在请求头 `X-Desktop-Runtime-Token` 中提供
- 认证失败返回 401，错误码 `invalid_local_token`

**响应结构**（[`DiagnosticsContract`](../backend/app/desktop_runtime/contracts.py:44-50)）：
```json
{
  "service": "sustech-copilot-desktop-runtime",
  "status": "ready",
  "runtime": {
    "working_directory": "/path/to/backend",
    "backend_dir": "/path/to/backend",
    "base_url": "http://127.0.0.1:8765",
    "started_at": "2026-03-25T09:00:00",
    "stopped_at": null,
    "initialized_directories": ["config", "logs", "database", "state"],
    "ready": true
  },
  "configuration": {
    "host": "127.0.0.1",
    "port": 8765,
    "model": "openai:gpt-4o",
    "paths": { "config_dir": "...", "logs_dir": "..." }
  },
  "auth": {
    "header_name": "X-Desktop-Runtime-Token",
    "token_configured": false,
    "protected_paths": ["/diagnostics", "/diagnostics/runtime-info"]
  },
  "capabilities": {
    "chat_runtime_registered": true,
    "chat_protocol": "single-endpoint",
    "chat_runtime_path": "/",
    "supported_methods": ["info", "agent/connect", "agent/run"],
    "chat_runtime_stage": "phase3-run-bridge",
    "session_store_type": "in-memory",
    "current_stage_supports_info_only": false,
    "current_stage_supports_connect": true,
    "current_stage_supports_run": true,
    "model_configured": true,
    "model_environment_keys": ["COPILOT_RUNTIME_MODEL", "COPILOT_MODEL"],
    "available_agents": ["default"],
    "default_agent": "default",
    "available_toolsets": ["default"],
    "default_toolset": "default"
  }
}
```

**代码锚点**：[`backend/app/desktop_runtime/health.py`](../backend/app/desktop_runtime/health.py)

## 聊天 Runtime 单端点契约

### POST / - 方法分发根端点

聊天 runtime 使用单个 POST 端点，通过请求载荷中的 `method` 字段分发到不同方法。

**协议标识**：`"single-endpoint"`  
**当前阶段**：`"phase3-run-bridge"`  
**支持的方法**：`["info", "agent/connect", "agent/run"]`

**方法分发逻辑**（[`RuntimeProtocolParser.extract_method`](../backend/app/copilot_runtime/protocol.py:86-132)）：

1. 空载荷或仅包含 `properties`/`frontendUrl` → `info`
2. 显式 `method` 字段 → 使用该方法（`"run"` 规范化为 `"agent/run"`）
3. 载荷包含 `threadId`/`runId`/`messages` 等字段 → 推断为 `agent/run`
4. 无法推断 → 返回 400 错误

### 方法 1: info

查询 runtime 能力与可用 agent 列表。

**请求示例**：
```json
{
  "method": "info",
  "properties": { "mode": "desktop" },
  "frontendUrl": "http://localhost:5173"
}
```

或空载荷：`{}`

**响应结构**（[`RuntimeInfoResponse`](../backend/app/copilot_runtime/contracts.py:36-43)）：
```json
{
  "actions": [],
  "agents": {
    "default": {
      "name": "default",
      "description": "Minimal default agent exposed by the Copilot runtime run bridge."
    }
  },
  "defaultAgent": "default",
  "protocol": "single-endpoint",
  "stage": "phase3-run-bridge",
  "supportedMethods": ["info", "agent/connect", "agent/run"],
  "transport": {
    "root_path": "/",
    "method": "POST"
  }
}
```

**语义边界**：
- `actions`: 当前为空数组，预留给未来工具/操作元数据
- `agents`: 当前仅包含 `default` agent，未来可扩展多 agent
- 不返回完整 tool 定义，仅元数据

**测试依据**：[`backend/tests/integration/test_copilot_runtime_http.py:15-34`](../backend/tests/integration/test_copilot_runtime_http.py:15-34)

### 方法 2: agent/connect

建立或恢复 session，不执行 agent 运行。

**请求结构**（[`RuntimeConnectRequest`](../backend/app/copilot_runtime/contracts.py:47-67)）：
```json
{
  "method": "agent/connect",
  "params": { "agentId": "default" },
  "body": {
    "threadId": "thread-123",
    "runId": "connect-1",
    "messages": [],
    "state": {},
    "tools": [],
    "context": [],
    "forwardedProps": {}
  }
}
```

**必需字段**：
- `threadId`: 会话线程 ID（非空字符串）
- `runId`: 本次连接运行 ID（非空字符串）
- `messages`: 消息数组（可为空）
- `state`: 状态对象（可为空对象）

**可选字段**：
- `tools`: 工具定义数组（当前未使用）
- `context`: 上下文数组（当前未使用）
- `forwardedProps`: 转发属性对象

**响应格式**：Server-Sent Events (SSE)，`Content-Type: text/event-stream`

**事件序列**（[`RuntimeScaffold.build_connect_events`](../backend/app/copilot_runtime/contracts.py:203-229)）：
```
data: {"type":"RUN_STARTED","threadId":"thread-123","runId":"connect-1"}

data: {"type":"STATE_SNAPSHOT","snapshot":{}}

data: {"type":"MESSAGES_SNAPSHOT","messages":[]}

data: {"type":"RUN_FINISHED","threadId":"thread-123","runId":"connect-1","result":{...}}
```

**最终 result 结构**（[`RuntimeConnectResult`](../backend/app/copilot_runtime/contracts.py:108-114)）：
```json
{
  "ok": true,
  "threadId": "thread-123",
  "runId": "connect-1",
  "agentName": "default",
  "session": {
    "threadId": "thread-123",
    "agentName": "default",
    "createdAt": "2026-03-25T09:00:00",
    "updatedAt": "2026-03-25T09:00:00",
    "newlyCreated": true,
    "metadata": { "last_connect_run_id": "connect-1" }
  }
}
```

**语义**：
- 如果 `threadId` 不存在，创建新 session（`newlyCreated: true`）
- 如果 `threadId` 已存在，返回现有 session（`newlyCreated: false`）
- 不执行 agent 推理，仅管理 session 生命周期

**测试依据**：[`backend/tests/integration/test_copilot_runtime_http.py:36-59`](../backend/tests/integration/test_copilot_runtime_http.py:36-59)

### 方法 3: agent/run

执行 agent 对话运行，返回 assistant 响应。

**请求结构**（[`RuntimeRunRequest`](../backend/app/copilot_runtime/contracts.py:71-94)）：
```json
{
  "method": "agent/run",
  "params": { "agentId": "default" },
  "body": {
    "threadId": "thread-123",
    "runId": "run-1",
    "messages": [
      {
        "id": "msg-1",
        "role": "user",
        "content": "Hello, how are you?"
      }
    ],
    "state": {},
    "actions": [],
    "metaEvents": [],
    "nodeName": null,
    "forwardedProps": {}
  }
}
```

**必需字段**：
- `threadId`: 会话线程 ID
- `runId`: 本次运行 ID
- `messages`: 消息数组，至少包含一条消息，最后一条必须是 `role: "user"` 的文本消息

**消息格式约束**（[`RuntimeProtocolParser._validate_supported_message_shape`](../backend/app/copilot_runtime/protocol.py:469-535)）：
- 支持的 `role`: `"user"`, `"assistant"`, `"system"`, `"developer"`
- `user` 消息 `content` 可以是字符串或 `[{"type":"text","text":"..."}]` 数组
- `assistant` 消息 `content` 必须是纯文本字符串（当前不支持 tool calls）
- `system`/`developer` 消息 `content` 必须是非空字符串
- 不支持 `toolCalls` 字段（MVP 限制）

**响应格式**：Server-Sent Events (SSE)

**事件序列**（[`RuntimeScaffold.build_run_events`](../backend/app/copilot_runtime/contracts.py:231-268)）：
```
data: {"type":"RUN_STARTED","threadId":"thread-123","runId":"run-1"}

data: {"type":"STATE_SNAPSHOT","snapshot":{}}

data: {"type":"TEXT_MESSAGE_START","messageId":"run-1:assistant","role":"assistant"}

data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"run-1:assistant","delta":"Hello! I'm doing well..."}

data: {"type":"TEXT_MESSAGE_END","messageId":"run-1:assistant"}

data: {"type":"RUN_FINISHED","threadId":"thread-123","runId":"run-1","result":{...}}
```

**最终 result 结构**（[`RuntimeRunResult`](../backend/app/copilot_runtime/contracts.py:117-124)）：
```json
{
  "ok": true,
  "threadId": "thread-123",
  "runId": "run-1",
  "agentName": "default",
  "output": "Hello! I'm doing well, thank you for asking.",
  "session": {
    "threadId": "thread-123",
    "agentName": "default",
    "createdAt": "2026-03-25T09:00:00",
    "updatedAt": "2026-03-25T09:00:10",
    "newlyCreated": false,
    "metadata": { "last_run_id": "run-1" }
  }
}
```

**语义**：
- 当前实现为**一次性完整响应**，`TEXT_MESSAGE_CONTENT` 事件包含完整 assistant 输出
- 未来可能支持真正的流式 token 输出（多个 `TEXT_MESSAGE_CONTENT` 事件）
- Session 自动持久化对话历史（user + assistant 消息对）
- 同一 `threadId` 的后续请求会复用历史上下文

**历史复用机制**（[`RuntimeBridge.run`](../backend/app/copilot_runtime/bridge.py:49-72)）：
- 从 session store 加载现有消息历史
- 转换为 PydanticAI `ModelMessage` 格式
- 传递给 agent executor 作为上下文
- 执行成功后追加新的 user/assistant 消息对到 session

**测试依据**：
- 基本运行：[`backend/tests/integration/test_copilot_runtime_http.py:61-99`](../backend/tests/integration/test_copilot_runtime_http.py:61-99)
- 历史复用：[`backend/tests/integration/test_copilot_runtime_http.py:61-99`](../backend/tests/integration/test_copilot_runtime_http.py:61-99)

## 错误处理与结构化错误

所有聊天 runtime 错误返回统一的 JSON 结构（[`RuntimeErrorResponse`](../backend/app/copilot_runtime/errors.py:29-32)）：

```json
{
  "ok": false,
  "error": {
    "code": "error_code",
    "message": "Human-readable error message",
    "stage": "phase3-run-bridge",
    "requestedMethod": "agent/run",
    "supportedMethods": ["info", "agent/connect", "agent/run"],
    "details": {}
  }
}
```

### 错误码与 HTTP 状态码映射

| 错误码 | HTTP 状态 | 触发场景 | 代码锚点 |
|--------|----------|---------|---------|
| `invalid_runtime_request` | 400 | 请求载荷格式错误、缺少必需字段 | [`errors.py:35-48`](../backend/app/copilot_runtime/errors.py:35-48) |
| `unsupported_message_shape` | 400 | 消息格式不符合 MVP 约束（如包含 tool calls） | [`errors.py:66-79`](../backend/app/copilot_runtime/errors.py:66-79) |
| `agent_not_found` | 404 | 请求的 agent 不存在 | [`errors.py:51-63`](../backend/app/copilot_runtime/errors.py:51-63) |
| `invalid_message_history` | 409 | Session 历史消息序列损坏（如 assistant 后不是 user） | [`errors.py:82-95`](../backend/app/copilot_runtime/errors.py:82-95) |
| `agent_execution_failed` | 500 | Agent 执行过程中发生异常 | [`errors.py:113-126`](../backend/app/copilot_runtime/errors.py:113-126) |
| `method_not_implemented` | 501 | 请求的方法当前阶段不支持 | [`errors.py:129-143`](../backend/app/copilot_runtime/errors.py:129-143) |
| `model_not_configured` | 503 | 未配置 LLM 模型（缺少环境变量或 CLI 参数） | [`errors.py:98-110`](../backend/app/copilot_runtime/errors.py:98-110) |

### 错误示例

**未配置模型**（503）：
```json
{
  "ok": false,
  "error": {
    "code": "model_not_configured",
    "message": "No runtime model is configured. Pass --model or set COPILOT_RUNTIME_MODEL or COPILOT_MODEL.",
    "stage": "phase3-run-bridge",
    "requestedMethod": "agent/run",
    "supportedMethods": ["info", "agent/connect", "agent/run"],
    "details": {
      "modelEnvironmentKeys": ["COPILOT_RUNTIME_MODEL", "COPILOT_MODEL"]
    }
  }
}
```

**Agent 不存在**（404）：
```json
{
  "ok": false,
  "error": {
    "code": "agent_not_found",
    "message": "Unknown agent 'custom-agent'.",
    "stage": "phase3-run-bridge",
    "requestedMethod": "agent/run",
    "supportedMethods": ["info", "agent/connect", "agent/run"],
    "details": {
      "agentName": "custom-agent"
    }
  }
}
```

**测试依据**：
- 模型未配置：[`test_copilot_runtime_http.py:100-117`](../backend/tests/integration/test_copilot_runtime_http.py:100-117)
- Agent 不存在：[`test_copilot_runtime_http.py:120-144`](../backend/tests/integration/test_copilot_runtime_http.py:120-144)
- 历史损坏：[`test_copilot_runtime_http.py:147-173`](../backend/tests/integration/test_copilot_runtime_http.py:147-173)

## 当前边界与未来扩展

### 当前实现边界

**已实现**：
- 单 agent（`default`）、单 toolset（`default`，无实际工具）
- 纯文本对话（user ↔ assistant）
- In-memory session 存储（进程重启后丢失）
- 完整响应流式输出（非真正 token 流）
- 基本错误分类与结构化错误

**明确不支持**（MVP 限制）：
- Assistant tool calls（请求中包含会返回 400 错误）
- 多模态消息（图片、文件等）
- 多 agent 切换
- Tool 动态注册与执行
- Session 持久化到磁盘/数据库
- 真正的 token 级流式输出

### 未来可能扩展

以下功能在设计中预留了扩展点，但**当前未实现**：

1. **多 agent 支持**：`AgentRegistry` 已支持注册多个 agent，但当前仅有 `default`
2. **Tool 执行**：`ToolRegistry` 与 `tools` 字段已预留，但当前为空
3. **Actions 与 meta events**：请求/响应中已有字段，但当前未使用
4. **真正流式输出**：事件结构已支持多个 `TEXT_MESSAGE_CONTENT`，但当前仅发送一次
5. **Session 持久化**：`session_store_type` 字段已预留，但当前仅 `"in-memory"`

**重要**：文档描述的是**当前实现事实**，不应将未来扩展写成现状。

## 与其他文档的关系

- **运行时生命周期**：参见 [`runtime-lifecycle.md`](runtime-lifecycle.md)，了解启动、停止与状态管理
- **架构概览**：参见 [`architecture-overview.md`](architecture-overview.md)，了解整体系统设计
- **前端连接契约**：参见 [`docs/frontend/backend-connection-contract.md`](../frontend/backend-connection-contract.md)，了解 Electron 如何调用这些端点

## 参考实现

完整的契约实现分布在以下模块：

- **端点注册**：[`backend/app/desktop_runtime/server.py`](../backend/app/desktop_runtime/server.py)
- **方法路由**：[`backend/app/copilot_runtime/router.py`](../backend/app/copilot_runtime/router.py)
- **协议解析**：[`backend/app/copilot_runtime/protocol.py`](../backend/app/copilot_runtime/protocol.py)
- **契约结构**：[`backend/app/copilot_runtime/contracts.py`](../backend/app/copilot_runtime/contracts.py)
- **错误定义**：[`backend/app/copilot_runtime/errors.py`](../backend/app/copilot_runtime/errors.py)
- **执行桥接**：[`backend/app/copilot_runtime/bridge.py`](../backend/app/copilot_runtime/bridge.py)

**集成测试**：[`backend/tests/integration/test_copilot_runtime_http.py`](../backend/tests/integration/test_copilot_runtime_http.py)  
**单元测试**：[`backend/tests/unit/desktop_runtime/test_server.py`](../backend/tests/unit/desktop_runtime/test_server.py)

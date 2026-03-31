---
title: 聊天运行时 HTTP 契约
description: 说明 desktop runtime 的控制面端点，以及当前真正生效的 session-first 聊天 HTTP 契约。
sidebar_position: 3
sidebar_label: 聊天运行时契约
---

# 聊天运行时 HTTP 契约

这篇文档只负责当前可观察的 HTTP 契约：有哪些端点，当前前端真正调用哪些方法，请求体和响应体长什么样，哪些旧方法还保留兼容作用。

Electron 怎样启动这个 runtime，见 [运行时生命周期](./runtime-lifecycle.md)。配置、设置、会话和消息状态分别由谁持有，见 [会话与状态模型](./session-and-state-model.md)。

## 当前接口分成两类

当前 desktop runtime 仍然是同一个 loopback HTTP 服务，对外暴露两类接口：

- 控制面端点用于健康检查、版本与诊断。
- 聊天入口统一走根路径 `POST /`，再由请求体里的 `method` 分发具体方法。

## 控制面端点

### `GET /health`

这条端点用于最小健康检查。当前典型响应如下：

```json
{
  "service": "sustech-copilot-desktop-runtime",
  "status": "ok",
  "ready": true,
  "transport": "loopback-http"
}
```

可以注意到，`ready` 才表示当前是否已经可以处理请求；即使还没 ready，这条端点通常也会返回 200。

### `GET /ready`

这条端点回答的是“启动流程是否已经完成”。当前典型响应如下：

```json
{
  "service": "sustech-copilot-desktop-runtime",
  "status": "ready",
  "ready": true,
  "startup_complete": true,
  "last_error": null
}
```

其中：

- `status` 当前会落在 `starting`、`ready`、`stopped` 或 `failed` 这些生命周期状态里。
- `last_error` 用于描述最近一次启动失败摘要。

### `GET /version` 与 `GET /build-info`

这两条路径当前返回同形数据。典型响应如下：

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

### `GET /diagnostics` 与 `GET /diagnostics/runtime-info`

这两条路径当前也返回同形数据，但信息更完整。响应会概括：

- 运行目录、工作目录和当前 base URL。
- 运行配置摘要。
- local token 是否已配置。
- 当前聊天能力摘要、智能体目录摘要与支持方法列表。

如果 runtime 配置了 local token，请求这两条诊断路径时需要带上请求头 `X-Local-Token`。当前 local token 保护范围只覆盖这两条 diagnostics 路径。

## 聊天根端点 `POST /`

### 当前推荐的请求外壳

当前推荐使用下面这类请求结构：

```json
{
  "method": "message/send",
  "body": {
    "...": "..."
  }
}
```

其中：

- `method` 必须是非空字符串。
- `body` 应该是对象。
- 当前解析器仍然兼容少数“省略 `body`，直接把字段放在顶层”的旧写法，但新代码继续使用显式 `body` 更清晰。

## 当前前端主路径

当前前端正式主路径已经收口为下面四个方法：

1. `agents/list`
2. `session/create`
3. `capabilities/get`
4. `message/send`

这条链路对应的是一组很清楚的职责划分：

- 后端目录给出当前有哪些智能体。
- 会话在创建时绑定具体智能体。
- 每次消息请求再显式给出本次使用的模型和工具策略。

## 方法一 `agents/list`

### 作用

这条方法用于读取当前 runtime 暴露的智能体目录。

### 请求示例

```json
{
  "method": "agents/list"
}
```

### 响应示例

```json
{
  "ok": true,
  "directoryVersion": "agents-v1",
  "defaultAgentId": "default",
  "agents": [
    {
      "agentId": "default",
      "status": "active",
      "recommendedTools": ["tool.file-convert"],
      "defaultModelPreference": null,
      "displayName": "Default",
      "description": "Minimal default agent exposed by the Copilot runtime run bridge.",
      "iconKey": null
    }
  ]
}
```

### 语义说明

- `agents` 是当前后端真正开放出来的智能体目录。
- `defaultAgentId` 是建议默认项，但前端仍然可以按自己的交互逻辑决定选中项。
- `recommendedTools` 是该智能体的推荐工具集合。
- `defaultModelPreference` 当前更接近提示信息，前端是否采用它仍由前端会话壳和交互决定。

## 方法二 `session/create`

### 作用

这条方法会创建一个新会话，并在创建时把选中的智能体绑定到会话上。

### 请求示例

```json
{
  "method": "session/create",
  "body": {
    "agentId": "default"
  }
}
```

### 响应示例

```json
{
  "ok": true,
  "sessionId": "session-123",
  "boundAgent": {
    "agentId": "default",
    "status": "active",
    "displayName": "Default",
    "description": "Minimal default agent exposed by the Copilot runtime run bridge.",
    "iconKey": null
  },
  "createdAt": "2026-03-27T18:00:00+00:00",
  "updatedAt": "2026-03-27T18:00:00+00:00",
  "recommendedTools": ["tool.file-convert"],
  "defaultModelPreference": null,
  "capabilities": {
    "tools": {
      "selectionMode": "recommendation-only",
      "recommendedTools": ["tool.file-convert"]
    }
  }
}
```

### 语义说明

- `sessionId` 是后端生成的会话标识。
- `boundAgent` 说明这个会话已经和哪一个智能体绑定。
- `recommendedTools` 与 `defaultModelPreference` 会把该智能体的推荐信息一起带回。
- 响应中确实包含轻量 `capabilities` 回显，但当前正式的能力面读取仍然由下一步 `capabilities/get` 提供。

## 方法三 `capabilities/get`

### 作用

这条方法读取某个已创建会话的正式能力面。

### 请求示例

```json
{
  "method": "capabilities/get",
  "body": {
    "sessionId": "session-123"
  }
}
```

### 响应示例

```json
{
  "ok": true,
  "sessionId": "session-123",
  "boundAgent": {
    "agentId": "default",
    "status": "active",
    "displayName": "Default",
    "description": "Minimal default agent exposed by the Copilot runtime run bridge.",
    "iconKey": null
  },
  "capabilitiesVersion": "capabilities:agents-v1:tools-v1",
  "tools": [
    {
      "toolId": "tool.file-convert",
      "kind": "builtin",
      "availability": "available",
      "displayName": "File Convert",
      "description": "Convert DOCX, PDF, and PPTX files into text."
    }
  ],
  "recommendedTools": ["tool.file-convert"],
  "toolSelectionMode": "recommendation-only",
  "defaultModelPreference": null
}
```

### 语义说明

- `tools` 是这个会话当前可见的工具目录。
- `recommendedTools` 是推荐默认启用项。
- `toolSelectionMode` 当前是 `recommendation-only`，表示后端给出推荐，前端仍然可以决定本次启用哪些工具。
- `capabilitiesVersion` 可以作为能力面版本标识使用。

## 方法四 `message/send`

### 作用

这条方法发送一条用户消息，并显式给出本次请求要使用的模型、工具与附加请求选项。

### 请求示例

```json
{
  "method": "message/send",
  "body": {
    "sessionId": "session-123",
    "agent": "default",
    "message": {
      "role": "user",
      "content": "帮我总结这份 PDF 的重点"
    },
    "model": "openrouter/gemini-2.5-pro-preview",
    "enabledTools": ["tool.file-convert"],
    "requestOptions": {}
  }
}
```

### 当前字段约束

| 字段 | 当前要求 |
| --- | --- |
| `sessionId` | 必须是非空字符串。 |
| `agent` | 可选；如果提供，会用来校验当前请求是否仍然指向该会话绑定的智能体。 |
| `message.role` | 当前必须是 `user`。 |
| `message.content` | 必须是非空文本。 |
| `model` | 必须是非空字符串。 |
| `enabledTools` | 可选；如果提供，必须是字符串数组；数组元素如果存在，必须是非空字符串。 |
| `requestOptions` | 可选；如果提供，必须是对象。 |

### 响应示例

```json
{
  "ok": true,
  "sessionId": "session-123",
  "boundAgent": {
    "agentId": "default",
    "status": "active",
    "displayName": "Default",
    "description": "Minimal default agent exposed by the Copilot runtime run bridge.",
    "iconKey": null
  },
  "assistantMessage": {
    "role": "assistant",
    "content": "这份 PDF 主要讲了三件事……"
  },
  "resolvedModelId": "openrouter/gemini-2.5-pro-preview",
  "resolvedToolIds": ["tool.file-convert"],
  "requestOptions": {}
}
```

### 语义说明

- 会话绑定的是智能体，但模型与工具策略属于消息请求自己携带的执行策略。
- `resolvedModelId` 和 `resolvedToolIds` 表示后端这一轮最终实际采用了什么。
- 如果 `enabledTools` 里出现后端不认识的工具 ID，请求会报错。
- 如果某个工具存在但当前可用性不是 `available`，后端会在解析后把它从 `resolvedToolIds` 中滤掉，而不是单独返回一种新的错误码。

## 当前错误结构

聊天相关错误当前统一返回下面这类 JSON 结构：

```json
{
  "ok": false,
  "error": {
    "code": "error_code",
    "message": "Human-readable error message",
    "stage": "phase3-run-bridge",
    "requestedMethod": "message/send",
    "supportedMethods": [
      "info",
      "agents/list",
      "session/create",
      "capabilities/get",
      "message/send",
      "agent/connect",
      "agent/run"
    ],
    "details": {}
  }
}
```

这里的 `supportedMethods` 只说明 runtime 当前还能识别哪些方法。它同时列出 `agent/connect` 和 `agent/run`，是因为兼容入口仍然存在；这份列表本身不表示这些方法仍和 session-first 四方法处在同一主路径层级。

### 当前常见错误码

| 错误码 | HTTP 状态 | 常见触发场景 |
| --- | --- | --- |
| `invalid_request` | 400 | `method`、`body`、`sessionId`、`message`、`model` 等字段格式不对。 |
| `session_not_found` | 404 | 请求的 `sessionId` 不存在。 |
| `agent_not_found` | 404 | 请求的 `agentId` 不在后端目录中。 |
| `agent_mismatch` | 409 | 消息请求携带的 `agent` 与会话绑定智能体不一致。 |
| `tool_not_found` | 400 | `enabledTools` 中存在后端不认识的工具。 |
| `model_not_configured` | 503 | 当前 runtime 没有可用模型配置。 |
| `invalid_message_history` | 409 | 后端进程内会话历史损坏，无法继续拼装上下文。 |
| `agent_execution_failed` | 500 | 智能体执行时抛错。 |
| `method_not_implemented` | 501 | 调用了当前 scaffold 不支持的方法。 |
| `unsupported_message_shape` | 400 | 主要见于 `message/send` 或旧兼容方法传入了当前不支持的消息结构。 |

## 仍然保留的兼容方法

### `info`

这条方法仍然会返回 runtime 基本元数据，例如 `protocol`、`stage`、`supportedMethods`、`agents` 与 `defaultAgent`。它现在更适合诊断和兼容调用。

### `agent/connect`

这条方法仍然保留 SSE 会话兼容路径。它会接收 `threadId`、`runId`、`messages` 等字段，并返回 SSE 事件流。当前前端正式主路径已经不再用它创建会话。

### `agent/run`

这条方法同样仍然保留 SSE 兼容路径。它会从请求里的消息数组提取最后一条用户文本消息，并通过 SSE 返回 assistant 文本事件。当前前端正式主路径也不再用它发送消息。

## 当前应该怎样理解这些旧方法

更准确的说法是：

- 它们还存在于 runtime 中。
- 它们继续服务旧兼容链路、测试和诊断。
- 当前正式前端文档不再把它们当成聊天主路径。

## 当前不要再写成什么

下面这些说法现在已经不准确：

- “前端主聊天契约还是 `agent/run`。”
- “全局 `agentName` 决定当前聊天连接哪个智能体。”
- “模型是程序级固定设置，消息请求里不用显式带。”
- “工具开关只是前端装饰状态，后端不会真正解析。”
- “settings workspace 里保存了 provider 或默认模型，就等同于聊天请求当前真源。”

## 相关文档

- [系统架构总览](./architecture-overview.md)
- [运行时生命周期](./runtime-lifecycle.md)
- [会话与状态模型](./session-and-state-model.md)
- [后端当前可观察契约参考](../backend/reference-current-contracts.md)

---
title: 聊天运行时 HTTP 契约
description: 说明 desktop runtime 的控制面端点，以及当前前端真正使用的 session-first 聊天契约。
sidebar_position: 3
sidebar_label: 聊天运行时契约
---

# 聊天运行时 HTTP 契约

本文档回答四个问题：

1. 本地 desktop runtime 现在对外暴露了哪些 HTTP 端点。
2. 当前前端真正依赖的聊天方法是什么。
3. 智能体、会话、能力面、消息发送现在分别怎么工作。
4. 旧的 `agent/connect` / `agent/run` 还剩什么地位。

## 先看结论

当前 desktop runtime 仍然是“**控制面端点 + 单根路径聊天端点**”的结构：

- 控制面端点用于健康检查、版本和诊断。
- 聊天端点统一走 `POST /`。

但聊天主路径已经不是早期那套“先靠全局 agent，再走 `agent/run`”的理解方式了。

当前前端正式主路径是 4 个方法：

1. `agents/list`：从后端拿智能体目录。
2. `session/create`：按选中的智能体创建会话，并把该智能体绑定到会话。
3. `capabilities/get`：读取这个会话对应的工具目录、推荐工具和模型偏好提示。
4. `message/send`：发送一条用户消息，并在请求里显式给出本次使用的模型和工具。

可以把它理解成一句话：

> **后端目录决定有哪些智能体；会话决定当前绑定的是哪个智能体；每次消息再决定本次要用哪个模型、哪些工具。**

## 文档范围

本文档覆盖：

- `GET /health`、`GET /ready`、`GET /version`、`GET /build-info`、`GET /diagnostics`、`GET /diagnostics/runtime-info`
- `POST /` 下当前可观察到的聊天方法
- 当前前端主路径使用的请求体、响应体和错误语义
- 仍然保留在 runtime 中的旧兼容方法

本文档不展开：

- Electron 如何启动 Python runtime（见系统运行时生命周期文档）
- 配置中心如何把 `model` 投影为 `--model`（见后端运行与配置文档）
- Blackboard / TIS 业务能力细节

## 运行时的两类 HTTP 端点

### 1. 控制面端点

这些端点主要服务于宿主和诊断：

| 端点 | 作用 | 当前说明 |
| --- | --- | --- |
| `GET /health` | 基础健康检查 | 始终返回 200，用 `ready` 表示当前是否可用 |
| `GET /ready` | 启动完成度与最近错误 | 用于区分 `starting`、`ready`、`failed` |
| `GET /version` | 版本信息 | 返回服务版本、Python 版本和运行模式 |
| `GET /build-info` | 构建信息 | 当前与 `GET /version` 同形 |
| `GET /diagnostics` | 运行时诊断 | 返回目录、配置摘要、能力摘要 |
| `GET /diagnostics/runtime-info` | 诊断别名 | 当前与 `GET /diagnostics` 同形 |

### 2. 聊天端点

聊天端点只有一个：

- `POST /`

它通过请求体里的 `method` 字段分发到不同方法。

## 控制面端点

### `GET /health`

用于最小健康检查。

典型响应：

```json
{
  "service": "sustech-copilot-desktop-runtime",
  "status": "ok",
  "ready": true,
  "transport": "loopback-http"
}
```

要点：

- `ready` 才表示当前是否已经能处理请求。
- 即使还没 ready，这个端点通常也会返回 200。

### `GET /ready`

用于回答“启动流程到底完成没有”。

典型响应：

```json
{
  "service": "sustech-copilot-desktop-runtime",
  "status": "ready",
  "ready": true,
  "startup_complete": true,
  "last_error": null
}
```

要点：

- `status` 当前会落在 `starting`、`ready`、`stopped`、`failed` 这些生命周期状态里。
- `last_error` 用来说明最近一次启动失败摘要。

### `GET /version` 与 `GET /build-info`

当前两条路径返回同形数据。

典型响应：

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

这两条路径当前也返回同形数据，但会带上更多诊断信息。

它会概括：

- 运行目录和工作目录
- 端口、模型、路径等配置摘要
- 是否配置了 local token
- 当前已注册的聊天能力
- 可用智能体目录和工具目录摘要

如果配置了 local token，需要在请求头里带：

- `X-Local-Token`

否则会返回 401。

## 聊天根端点：`POST /`

### 请求基本形状

当前推荐使用这种基本结构：

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
- 少数方法在 `body` 缺省时也可直接把字段放在顶层，但新代码不建议继续这样写。

## 当前正式主路径：session-first

### 为什么叫 session-first

因为当前聊天不是“全局选一个 agent 然后所有请求都沿用它”。

现在的顺序是：

1. 先从后端拉智能体目录。
2. 用户选择一个智能体。
3. 用该智能体创建会话。
4. 会话创建成功后，再读取这个会话的能力面。
5. 每次发消息时，再在请求里显式给出模型和工具选择。

这意味着三件事：

- **智能体目录的真源在后端**，不是前端静态常量。
- **智能体绑定发生在会话级**，不是全局级。
- **模型和工具是请求级策略**，不是整个程序里一次选定后永久锁死。

## 方法一：`agents/list`

### 作用

读取当前 runtime 暴露的智能体目录。

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

### 读这份响应时最重要的点

- `agents` 才是当前后端真正开放出来的智能体目录。
- `defaultAgentId` 只是建议默认项，不代表前端必须无条件照用。
- `recommendedTools` 是这个智能体的推荐工具集合。
- `defaultModelPreference` 当前更像提示信息，不等于前端一定自动切换到它。

## 方法二：`session/create`

### 作用

创建一个新会话，并把选中的智能体绑定到该会话。

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

- 会话一旦创建，就和 `boundAgent` 绑定。
- 后续请求如果带了不一致的 `agent` 校验值，会触发 `agent_mismatch`。
- 当前前端会把这个 `sessionId` 存在 renderer 内存里，用它作为会话切换的标识。

## 方法三：`capabilities/get`

### 作用

读取某个已创建会话的能力面。

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
- `recommendedTools` 是推荐默认勾选项。
- `toolSelectionMode` 当前是 `recommendation-only`，意思是后端给推荐，不是硬性替前端做唯一选择。
- `capabilitiesVersion` 可以用来判断当前能力面是否过期。

## 方法四：`message/send`

### 作用

发送一条用户消息，并显式给出本次请求要使用的模型、工具和可选请求参数。

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

### 当前必填项

| 字段 | 说明 |
| --- | --- |
| `sessionId` | 目标会话 ID |
| `message.role` | 当前必须是 `user` |
| `message.content` | 非空文本 |
| `model` | 本次请求要使用的模型 ID |

### 当前可选项

| 字段 | 说明 |
| --- | --- |
| `agent` | 可选的防串会话校验值；如果传了且与会话绑定智能体不一致，会报错 |
| `enabledTools` | 本次请求开启的工具 ID 列表 |
| `requestOptions` | 本次请求附带的附加选项对象 |

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

### 这条方法体现了什么新语义

- 会话绑定的是 **智能体**。
- 但本次执行使用什么 **模型**、启用什么 **工具**，是消息请求自己决定的。
- 返回值里的 `resolvedModelId` 和 `resolvedToolIds`，表示后端最终实际接受并使用了什么。

## 错误结构

所有聊天错误当前都返回统一 JSON：

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

### 当前常见错误码

| 错误码 | HTTP 状态 | 常见触发场景 |
| --- | --- | --- |
| `invalid_request` | 400 | `method`、`body`、`sessionId`、`message`、`model` 等字段格式不对 |
| `session_not_found` | 404 | 请求的 `sessionId` 不存在 |
| `agent_not_found` | 404 | 请求的 `agentId` 不在后端目录中 |
| `agent_mismatch` | 409 | 消息请求携带的 `agent` 与会话绑定智能体不一致 |
| `tool_not_found` | 400 | `enabledTools` 中存在后端不认识的工具 |
| `model_not_configured` | 503 | 当前 runtime 没有可用模型配置 |
| `invalid_message_history` | 409 | 会话历史损坏，无法继续拼装上下文 |
| `agent_execution_failed` | 500 | 智能体执行时抛错 |
| `method_not_implemented` | 501 | 调用了当前 scaffold 不支持的方法 |
| `unsupported_message_shape` | 400 | 主要见于旧兼容方法中传入了不支持的消息结构 |

## 仍然保留的旧兼容方法

### `info`

仍可用于返回 runtime 基本元数据，例如：

- `protocol`
- `stage`
- `supportedMethods`
- `agents`
- `defaultAgent`

它现在更适合诊断和兼容调用，不是前端主路径的权威入口。

### `agent/connect`

这是旧桥接时期保留的 SSE 会话方法。

它当前仍然：

- 接受 `threadId`、`runId`、`messages` 等字段
- 返回 `RUN_STARTED`、`STATE_SNAPSHOT`、`MESSAGES_SNAPSHOT`、`RUN_FINISHED` 这类 SSE 事件

但当前前端正式主路径已经不用它来创建会话。

### `agent/run`

这也是旧桥接时期保留的 SSE 运行方法。

它当前仍然：

- 接受 `threadId`、`runId`、`messages`
- 从最后一条 `user` 消息提取文本
- 通过 SSE 返回 assistant 文本事件

但它不再是当前前端主路径的权威契约。

### 应该怎样理解这三条旧方法

准确说法是：

- **它们还在 runtime 里存在**；
- **可以继续服务旧测试、旧兼容调用和诊断**；
- **但当前正式前端文档不再把它们写成主路径。**

## 当前后端真源分别在哪里

### 智能体目录真源

后端智能体目录来自 runtime 的智能体注册表，而不是前端写死的列表。

目录项当前会给出：

- `agentId`
- `status`
- `recommendedTools`
- `defaultModelPreference`
- `displayName`
- `description`
- `iconKey`

### 工具目录真源

工具目录来自 runtime 的工具注册表。

工具项当前会给出：

- `toolId`
- `kind`
- `availability`
- `displayName`
- `description`

## 当前不要再写成什么

下面这些说法现在都不准确：

- “前端主聊天契约还是 `agent/run`。”
- “全局 agentName 决定当前聊天要连哪个智能体。”
- “模型是程序级固定设置，消息请求里不用显式带。”
- “工具开关只是一组前端装饰状态，后端不会真正解析。”
- “前端仍以 `info -> agent/connect -> agent/run` 作为主流程。”

## 相关文档

- [系统架构总览](./architecture-overview.md)
- [会话与状态模型](./session-and-state-model.md)
- [后端运行与配置](../backend/run-and-config.md)
- [当前可观察契约参考](../backend/reference-current-contracts.md)

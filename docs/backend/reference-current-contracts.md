---
title: 当前契约参考
description: 查表式整理当前 runtime 控制面、聊天主路径字段与错误码。
sidebar_position: 6
---

# 当前契约参考

这页服务于[后端暴露契约与前端接入点](./frontend-connection.md)。正文只汇总当前已经确认的控制面端点、聊天方法、兼容方法和错误码，方便联调与排错时快速对照。

## 当前控制面端点

| 端点 | 当前用途 | 备注 |
| --- | --- | --- |
| `GET /health` | 最小健康检查 | 即使尚未 ready，通常也会返回 200。 |
| `GET /ready` | 返回启动状态、是否 ready 和最近错误摘要 | 更适合判断 hosted backend 是否完成启动。 |
| `GET /version` | 返回版本、Python 版本、运行模式与 base URL | 当前与 `GET /build-info` 同形。 |
| `GET /build-info` | 返回版本与构建摘要 | 当前与 `GET /version` 同形。 |
| `GET /diagnostics` | 返回运行目录、配置摘要、鉴权摘要与聊天能力摘要 | 如配置了 local token，请求时需要 `X-Local-Token`。 |
| `GET /diagnostics/runtime-info` | 返回 diagnostics 同形数据 | 当前与 `GET /diagnostics` 同形。 |

## 聊天根端点外壳

当前聊天相关方法统一走：

- `POST /`

当前推荐请求外壳是：

```json
{
  "method": "message/send",
  "body": {
    "...": "..."
  }
}
```

当前解析器仍兼容少量把字段直接放在顶层的旧写法，但新的对接更适合继续使用显式 `body`。

## 当前正式主路径方法

### `agents/list`

#### 当前用途

这条方法用于读取 runtime 暴露的智能体目录。

#### 当前值得依赖的响应字段

| 字段 | 含义 |
| --- | --- |
| `ok` | 请求是否成功 |
| `directoryVersion` | 当前智能体目录版本 |
| `defaultAgentId` | 默认推荐智能体 |
| `agents[]` | 智能体目录数组 |

#### `agents[]` 中当前较稳定的字段

| 字段 | 含义 |
| --- | --- |
| `agentId` | 智能体唯一标识 |
| `status` | 当前状态 |
| `recommendedTools` | 推荐工具集合 |
| `defaultModelPreference` | 默认模型偏好提示 |
| `displayName` | 展示名称 |
| `description` | 描述文本 |
| `iconKey` | 图标提示键 |

### `session/create`

#### 当前用途

这条方法用于创建会话，并在创建时把会话绑定到某个智能体。

#### 当前请求字段

| 字段 | 当前要求 |
| --- | --- |
| `agentId` | 必须是非空字符串，并且必须存在于当前智能体目录。 |

#### 当前值得依赖的响应字段

| 字段 | 含义 |
| --- | --- |
| `ok` | 请求是否成功 |
| `sessionId` | 后端生成的会话标识 |
| `boundAgent` | 当前会话绑定的智能体视图 |
| `createdAt` | 创建时间 |
| `updatedAt` | 最近更新时间 |
| `recommendedTools` | 推荐工具集合 |
| `defaultModelPreference` | 默认模型偏好提示 |
| `capabilities.tools.selectionMode` | 轻量工具选择模式提示 |

### `capabilities/get`

#### 当前用途

这条方法用于读取某个会话当前的能力面。

#### 当前请求字段

| 字段 | 当前要求 |
| --- | --- |
| `sessionId` | 必须是已存在会话的非空字符串。 |

#### 当前值得依赖的响应字段

| 字段 | 含义 |
| --- | --- |
| `ok` | 请求是否成功 |
| `sessionId` | 当前会话 ID |
| `boundAgent` | 当前绑定智能体 |
| `capabilitiesVersion` | 能力面版本标识 |
| `tools[]` | 当前会话可见工具目录 |
| `recommendedTools` | 推荐工具集合 |
| `toolSelectionMode` | 工具选择模式 |
| `defaultModelPreference` | 默认模型偏好提示 |

#### `tools[]` 中当前较稳定的字段

| 字段 | 含义 |
| --- | --- |
| `toolId` | 工具唯一标识 |
| `kind` | 工具类型 |
| `availability` | 当前可用状态 |
| `displayName` | 展示名称 |
| `description` | 描述文本 |

### `message/send`

#### 当前用途

这条方法用于向某个已绑定会话发送一条消息，并在请求里显式给出本次执行策略。

#### 当前请求字段

| 字段 | 当前要求 |
| --- | --- |
| `sessionId` | 必须是已存在会话的非空字符串。 |
| `agent` | 可选；如果提供，会用于校验与会话绑定智能体是否一致。 |
| `message.role` | 当前必须是 `user`。 |
| `message.content` | 必须是非空文本。 |
| `model` | 必须是非空字符串。 |
| `enabledTools` | 可选；如果提供，必须是字符串数组。 |
| `requestOptions` | 可选；如果提供，必须是对象。 |

#### 当前值得依赖的响应字段

| 字段 | 含义 |
| --- | --- |
| `ok` | 请求是否成功 |
| `sessionId` | 当前会话 ID |
| `boundAgent` | 当前绑定智能体 |
| `assistantMessage` | 助手返回消息 |
| `resolvedModelId` | 这一轮实际采用的模型 ID |
| `resolvedToolIds` | 这一轮实际启用的工具 ID |
| `requestOptions` | 当前回显的请求选项 |

#### 当前语义重点

- 会话绑定的是智能体。
- 模型和工具策略属于请求级输入。
- 当前 session store 仍然是内存态，runtime 重启后会话不会自动恢复。

## 当前兼容方法

下面这些方法仍然存在于 supported methods 中，但它们当前更适合作为兼容和诊断参考：

| 方法 | 当前定位 |
| --- | --- |
| `info` | 返回 runtime 基本元数据，用于兼容和诊断。 |
| `agent/connect` | 兼容的会话连接路径，仍服务旧链路和旧测试。 |
| `agent/run` | 兼容的消息执行路径，仍服务旧链路和旧测试。 |

backend 分册不再把它们当成当前正式主路径来描述。

## 当前错误响应外壳

聊天相关错误当前统一返回下面这类结构：

```json
{
  "ok": false,
  "error": {
    "code": "error_code",
    "message": "Human-readable error message",
    "stage": "phase3-run-bridge",
    "requestedMethod": "message/send",
    "supportedMethods": ["..."],
    "details": {}
  }
}
```

## 当前常见错误码

| 错误码 | HTTP 状态 | 常见触发场景 |
| --- | --- | --- |
| `invalid_request` | 400 | `method`、`body`、`sessionId`、`message` 或 `model` 等字段格式不对。 |
| `session_not_found` | 404 | 请求引用的 `sessionId` 不存在。 |
| `agent_not_found` | 404 | 请求中的 `agentId` 不在当前目录中。 |
| `agent_mismatch` | 409 | `message/send` 里的 `agent` 与会话绑定智能体不一致。 |
| `tool_not_found` | 400 | `enabledTools` 中出现后端不认识的工具 ID。 |
| `unsupported_message_shape` | 400 | 兼容方法里传入了当前不支持的消息结构。 |
| `invalid_message_history` | 409 | 进程内会话历史损坏，无法继续拼装上下文。 |
| `model_not_configured` | 503 | 当前 runtime 没有可用模型配置。 |
| `agent_execution_failed` | 500 | 智能体执行阶段抛错。 |
| `method_not_implemented` | 501 | 调用了当前 scaffold 不支持的方法。 |

## 当前哪些字段更适合依赖

当前阶段更适合作为稳定依赖的，是下面这组字段和概念：

- `directoryVersion`
- `defaultAgentId`
- `sessionId`
- `boundAgent`
- `capabilitiesVersion`
- `toolSelectionMode`
- `resolvedModelId`
- `resolvedToolIds`

相比之下，某些响应里较细的提示字段、错误文案逐字内容和日志明细键名，更适合继续按当前实现细节理解。

## 快速结论

- 当前正式聊天主路径仍然是四个 session-first 方法。
- 兼容方法依然存在，但已经退到参考位置。
- 当前错误外壳和常见错误码已经足够支持联调与排错。

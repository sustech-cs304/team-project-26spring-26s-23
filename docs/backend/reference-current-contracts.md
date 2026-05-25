---
title: 当前契约参考
description: 查表式整理当前 runtime 控制面、聊天主路径字段、流式事件与错误码。
sidebar_position: 6
---

# 当前契约参考

这页服务于 [后端暴露契约与前端接入点](./frontend-connection.md)。正文只汇总当前已经确认的控制面端点、聊天方法、流式事件、兼容方法和错误码，方便联调与排错时快速对照。

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

当前推荐继续使用显式 `body` 外壳；当前主路径不再依赖把字段直接放在顶层的旧兼容写法。

## 当前正式主路径方法

当前真实主链是 `thread/create`、`thread/get`、`run/start`、`run/stream`、`run/cancel`，并与 `agents/list` 一起构成运行时主入口。`session/create`、`capabilities/get`、`message/send` 作为兼容壳保留。

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

这条方法属于兼容壳，用于创建会话视图，并在创建时把底层 thread 绑定到某个智能体。

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

这条方法属于兼容壳，用于读取某个会话视图当前的能力面投影。底层数据来自同一条 thread 记录。

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

这条方法属于兼容壳，用于向某个会话视图发送一条消息，并以流式事件返回本轮 run 的执行过程。底层会映射到 `run/start + run/stream`。

#### 当前请求字段

| 字段 | 当前要求 |
| --- | --- |
| `sessionId` | 必须是已存在会话的非空字符串。 |
| `agent` | 可选；如果提供，会用于校验与会话绑定智能体是否一致。 |
| `message.role` | 当前必须是 `user`。 |
| `message.content` | 必须是非空文本。 |
| `policy.modelRoute.providerProfileId` | 必须是非空字符串。 |
| `policy.modelRoute.snapshot.provider` | 必须是非空字符串。 |
| `policy.modelRoute.snapshot.endpointType` | 必须是非空字符串。 |
| `policy.modelRoute.snapshot.baseUrl` | 必须是非空字符串。 |
| `policy.modelRoute.snapshot.modelId` | 必须是非空字符串。 |
| `policy.enabledTools` | 可选；如果提供，必须是字符串数组。 |
| `policy.requestOptions` | 可选；如果提供，必须是对象。 |

#### 当前事件流外壳

一旦流成功建立，每个事件都带有统一外壳：

| 字段 | 含义 |
| --- | --- |
| `type` | 事件类型 |
| `runId` | 当前 run 标识 |
| `sessionId` | 当前会话 ID |
| `sequence` | 严格递增的事件序号 |
| `payload` | 当前事件载荷 |

#### 当前事件集合

| 事件类型 | 当前语义 |
| --- | --- |
| `run_started` | run 已建立，前端可以创建 assistant 占位项。 |
| `tool_event` | 真实工具生命周期事件；通过 `phase` 区分 `started`、`completed` 与 `failed`。 |
| `text_delta` | assistant 文本增量片段。 |
| `run_completed` | 本轮成功完成，并带回最终 assistant 文本与解析后的路由回显。 |
| `run_failed` | 本轮失败结束，并给出错误码、错误消息与细节。 |
| `run_cancelled` | 本轮取消结束，并给出取消原因。 |
| `run_diagnostic` | 非敏感诊断信息，通常出现在失败前。 |

#### 当前终态规则

| 规则 | 当前要求 |
| --- | --- |
| 首个事件 | 必须是 `run_started`。 |
| 终态事件 | 只能是 `run_completed`、`run_failed` 或 `run_cancelled` 之一。 |
| 终态之后 | 不会继续输出其他事件。 |
| 诊断事件 | 可以在失败终态前出现。 |

#### `run_completed` 当前值得依赖的字段

| 字段 | 含义 |
| --- | --- |
| `assistantMessageId` | assistant 占位消息 ID |
| `assistantText` | 本轮最终 assistant 文本 |
| `resolvedModelId` | 本轮实际采用的模型 ID |
| `resolvedModelRoute` | 本轮解析确认后的公开路由回显 |
| `resolvedToolIds` | 本轮实际启用的工具 ID |
| `requestOptions` | 本轮回显的请求选项 |

#### `run_failed` 当前值得依赖的字段

| 字段 | 含义 |
| --- | --- |
| `code` | 错误码 |
| `message` | 错误消息 |
| `details` | 错误细节对象 |

#### `run_cancelled` 当前值得依赖的字段

| 字段 | 含义 |
| --- | --- |
| `assistantMessageId` | assistant 占位消息 ID |
| `reason` | 取消原因 |

#### `run_diagnostic` 当前值得依赖的字段

| 字段 | 含义 |
| --- | --- |
| `code` | 诊断码 |
| `message` | 诊断消息 |
| `details` | 非敏感诊断细节 |
| `stage` | 诊断阶段 |

#### `tool_event` 当前值得依赖的字段

| 字段 | 含义 |
| --- | --- |
| `toolCallId` | 同一次工具调用的稳定标识 |
| `toolId` | 当前调用的工具 ID |
| `phase` | 工具生命周期阶段，当前为 `started`、`completed` 或 `failed` |
| `title` | 面向用户的步骤标题 |
| `summary` | 面向用户的步骤摘要 |
| `inputSummary` | 可选的输入摘要 |
| `resultSummary` | 可选的结果摘要 |
| `errorSummary` | 可选的错误摘要 |

#### 当前语义重点

- 会话绑定的是智能体。
- 模型语义已经升级为请求级 `modelRoute`，而不是单一字符串 `model`。
- provider secrets 不进入请求体，也不进入事件流。
- 当前 session store 仍然是内存态，runtime 重启后会话不会自动恢复。
- 增量阶段只累积草稿，成功完成才归档 assistant 文本。
- 当 raw collector 观察到 tool-call 参数完备却没有真实工具执行时，会先发诊断，再以失败终态收口。

## 已退役的旧外层方法

下面这些旧方法已经不再包含在 current supported methods 中，也不再构成当前 runtime surface：

| 方法 | 当前状态 |
| --- | --- |
| `info` | 已退役；旧调用当前会收到 `method_not_implemented`。 |
| `agent/connect` | 已退役；旧调用当前会收到 `method_not_implemented`。 |
| `agent/run` | 已退役；旧调用当前会收到 `method_not_implemented`。 |

当前正式主链已经是 thread/run；session-first 三方法当前属于兼容壳。

## 当前错误响应外壳

### 流建立前的 JSON 错误

聊天相关错误当前仍然可能返回下面这类 JSON 外壳：

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

这类错误通常发生在流建立之前，例如请求结构无效、会话不存在，或者 agent 校验失败。

### 流建立后的错误

如果错误发生在 run 已建立之后，当前主线会优先使用流内错误：

1. 需要补充诊断时，先发 `run_diagnostic`。
2. 再发 `run_failed` 作为终态。

## 当前常见错误码

| 错误码 | 常见触发场景 |
| --- | --- |
| `invalid_request` | `method`、`body`、`sessionId`、`message` 或 `policy.modelRoute` 等字段格式不对。 |
| `session_not_found` | 请求引用的 `sessionId` 不存在。 |
| `agent_not_found` | 请求中的 `agentId` 不在当前目录中。 |
| `agent_mismatch` | `message/send` 里的 `agent` 与会话绑定智能体不一致。 |
| `tool_not_found` | `enabledTools` 中出现后端不认识的工具 ID。 |
| `tool_not_enabled` | 模型调用了本轮未在 `enabledTools` 中启用的工具。 |
| `invalid_message_history` | 进程内会话历史损坏，无法继续拼装上下文。 |
| `model_not_configured` | 当前 runtime 没有可用模型执行器配置。 |
| `provider_profile_not_found` | 请求中的 `providerProfileId` 在宿主真源中不存在。 |
| `model_route_snapshot_mismatch` | 请求快照与宿主当前 provider 配置不一致。 |
| `provider_secret_missing` | 对应 provider profile 缺少 API key。 |
| `host_model_route_access_denied` | Python runtime 调宿主私桥时访问令牌无效。 |
| `host_model_route_unavailable` | 宿主私桥不可用或返回了无效响应。 |
| `agent_execution_failed` | 智能体执行阶段抛错。 |
| `method_not_implemented` | 调用了当前 scaffold 不支持的方法。 |

## 当前哪些字段更适合依赖

当前阶段更适合作为稳定依赖的，是下面这组字段和概念：

- `directoryVersion`
- `defaultAgentId`
- `sessionId`
- `boundAgent`
- `capabilitiesVersion`
- `toolSelectionMode`
- `policy.modelRoute`
- `policy.enabledTools`
- `runId`
- `sequence`
- `tool_event.payload.phase`
- `resolvedModelId`
- `resolvedModelRoute`
- `resolvedToolIds`

相比之下，某些响应里较细的提示字段、错误文案逐字内容和日志明细键名，更适合继续按当前实现细节理解。

## 快速结论

- 当前正式聊天主路径已经是 thread/run 六方法，加上 `agents/list`。
- `session/create`、`capabilities/get`、[`message/send`](../system/chat-runtime-contract.md) 已降级为兼容壳。
- `info`、`agent/connect` 与 `agent/run` 已退役，不再属于当前 supported methods。
- 当前错误外壳、流式事件集合与常见错误码已经足够支持联调与排错。

---
title: 当前契约参考
description: 查表式整理 runtime 控制面、聊天主路径字段、流式事件与错误码。
sidebar_position: 6
---

# 当前契约参考

服务于 [后端暴露契约与前端接入点](./frontend-connection.md)。汇总已确认的控制面端点、聊天方法、流式事件、兼容方法和错误码，供联调与排错时快速对照。

## 控制面端点

| 端点 | 用途 | 备注 |
| --- | --- | --- |
| `GET /health` | 最小健康检查 | 即使未 ready，通常也返回 200。 |
| `GET /ready` | 返回启动状态、是否 ready 和最近错误摘要 | 判断 hosted backend 是否完成启动。 |
| `GET /version` | 返回版本、Python 版本、运行模式与 base URL | 与 `GET /build-info` 同形。 |
| `GET /build-info` | 返回版本与构建摘要 | 与 `GET /version` 同形。 |
| `GET /diagnostics` | 返回运行目录、配置摘要、鉴权摘要与聊天能力摘要 | 如配置了 local token，请求时需要 `X-Local-Token`。 |
| `GET /diagnostics/runtime-info` | 返回 diagnostics 同形数据 | 与 `GET /diagnostics` 同形。 |

## 聊天根端点外壳

聊天相关方法统一走：

- `POST /`

推荐请求外壳：

```json
{
  "method": "message/send",
  "body": {
    "...": "..."
  }
}
```

继续使用显式 `body` 外壳；主路径不再依赖把字段直接放在顶层的旧兼容写法。

## 正式主路径方法

真实主链是 `thread/create`、`thread/get`、`run/start`、`run/stream`、`run/cancel`，与 `agents/list` 一起构成运行时主入口。`session/create`、`capabilities/get`、`message/send` 作为兼容壳保留。

### 完整方法总表

| 方法 | 分类 | 状态 |
| --- | --- | --- |
| `agents/list` | 主路径 | 已可用 |
| `thread/create` | 主路径 | 已可用 |
| `thread/get` | 主路径 | 已可用 |
| `run/start` | 主路径 | 已可用 |
| `run/stream` | 主路径 | 已可用 |
| `run/cancel` | 主路径 | 已可用 |
| `thinking/capability/get` | 主路径 | 已可用 |
| `tools/catalog/get` | 主路径 | 已可用 |
| `tool-approval/resolve` | 主路径 | 已可用 |
| `shell-session/start` | 主路径 | 已可用 |
| `shell-session/exec` | 主路径 | 已可用 |
| `shell-session/close` | 主路径 | 已可用 |
| `session/create` | 兼容壳 | 部分接通 |
| `capabilities/get` | 兼容壳 | 部分接通 |
| `message/send` | 兼容壳 | 部分接通 |

### 持久化历史端点

| 端点 | 用途 | 状态 |
| --- | --- | --- |
| `GET /history/threads` | 列出历史线程 | 已可用 |
| `GET /history/threads/{thread_id}` | 获取线程详情 | 已可用 |
| `GET /history/runs/{run_id}/replay` | 回放运行 | 已可用 |
| `POST /history/threads/{thread_id}/rename` | 重命名线程 | 已可用 |
| `POST /history/threads/{thread_id}/duplicate` | 复制线程 | 已可用 |
| `DELETE /history/threads/{thread_id}` | 永久删除线程 | 已可用 |
| `POST /history/database/backup` | SQLite 文件级备份 | 已可用 |
| `POST /history/database/restore` | 从备份文件恢复 | 已可用 |

### `agents/list`

用于读取 runtime 暴露的智能体目录。

#### 值得依赖的响应字段

| 字段 | 含义 |
| --- | --- |
| `ok` | 请求是否成功 |
| `directoryVersion` | 智能体目录版本 |
| `defaultAgentId` | 默认推荐智能体 |
| `agents[]` | 智能体目录数组 |

#### `agents[]` 中较稳定的字段

| 字段 | 含义 |
| --- | --- |
| `agentId` | 智能体唯一标识 |
| `status` | 状态 |
| `recommendedTools` | 推荐工具集合 |
| `displayName` | 展示名称 |
| `description` | 描述文本 |
| `iconKey` | 图标提示键 |

### `session/create`

兼容壳，创建会话视图，创建时把底层 thread 绑定到某个智能体。

#### 请求字段

| 字段 | 要求 |
| --- | --- |
| `agentId` | 非空字符串，必须存在于智能体目录。 |

#### 值得依赖的响应字段

| 字段 | 含义 |
| --- | --- |
| `ok` | 请求是否成功 |
| `sessionId` | 后端生成的会话标识 |
| `boundAgent` | 会话绑定的智能体视图 |
| `createdAt` | 创建时间 |
| `updatedAt` | 最近更新时间 |
| `recommendedTools` | 推荐工具集合 |
| `capabilities.tools.selectionMode` | 轻量工具选择模式提示 |

### `capabilities/get`

兼容壳，读取某个会话视图的能力面投影。底层数据来自同一条 thread 记录。

#### 请求字段

| 字段 | 要求 |
| --- | --- |
| `sessionId` | 已存在会话的非空字符串。 |

#### 值得依赖的响应字段

| 字段 | 含义 |
| --- | --- |
| `ok` | 请求是否成功 |
| `sessionId` | 会话 ID |
| `boundAgent` | 绑定智能体 |
| `capabilitiesVersion` | 能力面版本标识 |
| `tools[]` | 会话可见工具目录 |
| `recommendedTools` | 推荐工具集合 |
| `toolSelectionMode` | 工具选择模式 |

#### `tools[]` 中较稳定的字段

| 字段 | 含义 |
| --- | --- |
| `toolId` | 工具唯一标识 |
| `kind` | 工具类型 |
| `availability` | 可用状态 |
| `displayName` | 展示名称 |
| `description` | 描述文本 |

### `message/send`

兼容壳，向某个会话视图发送一条消息，以流式事件返回本轮 run 的执行过程。底层映射到 `run/start + run/stream`。

#### 请求字段

| 字段 | 要求 |
| --- | --- |
| `sessionId` | 已存在会话的非空字符串。 |
| `agent` | 可选；如果提供，用于校验与会话绑定智能体是否一致。 |
| `message.role` | 必须是 `user`。 |
| `message.content` | 非空文本。 |
| `policy.modelRoute.providerProfileId` | 非空字符串。 |
| `policy.modelRoute.snapshot.provider` | 非空字符串。 |
| `policy.modelRoute.snapshot.endpointType` | 非空字符串。 |
| `policy.modelRoute.snapshot.baseUrl` | 非空字符串。 |
| `policy.modelRoute.snapshot.modelId` | 非空字符串。 |
| `policy.enabledTools` | 可选；如果提供，须是字符串数组。 |
| `policy.requestOptions` | 可选；如果提供，须是对象。 |

#### 事件流外壳

每个事件带有统一外壳：

| 字段 | 含义 |
| --- | --- |
| `type` | 事件类型 |
| `runId` | run 标识 |
| `sessionId` | 会话 ID |
| `sequence` | 严格递增的事件序号 |
| `payload` | 事件载荷 |

#### 事件集合

| 事件类型 | 语义 |
| --- | --- |
| `run_started` | run 已建立，前端可创建 assistant 占位项。 |
| `tool_event` | 真实工具生命周期事件；`phase` 区分 `started`、`waiting_approval`、`completed` 与 `failed`。 |
| `text_delta` | assistant 文本增量片段。 |
| `run_completed` | 本轮成功完成，带回最终 assistant 文本与解析后的路由回显。 |
| `run_failed` | 本轮失败结束，给出错误码、错误消息与细节。 |
| `run_cancelled` | 本轮取消结束，给出取消原因。 |
| `run_diagnostic` | 非敏感诊断信息，通常出现在失败前。 |

#### 终态规则

| 规则 | 要求 |
| --- | --- |
| 首个事件 | 必须是 `run_started`。 |
| 终态事件 | 只能是 `run_completed`、`run_failed` 或 `run_cancelled` 之一。 |
| 终态之后 | 不会继续输出其他事件。 |
| 诊断事件 | 可以在失败终态前出现。 |

#### `run_completed` 值得依赖的字段

| 字段 | 含义 |
| --- | --- |
| `assistantMessageId` | assistant 占位消息 ID |
| `assistantText` | 本轮最终 assistant 文本 |
| `resolvedModelId` | 实际采用的模型 ID |
| `resolvedModelRoute` | 解析确认后的公开路由回显 |
| `resolvedToolIds` | 实际启用的工具 ID |
| `requestOptions` | 回显的请求选项 |

#### `run_failed` 值得依赖的字段

| 字段 | 含义 |
| --- | --- |
| `code` | 错误码 |
| `message` | 错误消息 |
| `details` | 错误细节对象 |

#### `run_cancelled` 值得依赖的字段

| 字段 | 含义 |
| --- | --- |
| `assistantMessageId` | assistant 占位消息 ID |
| `reason` | 取消原因 |

#### `run_diagnostic` 值得依赖的字段

| 字段 | 含义 |
| --- | --- |
| `code` | 诊断码 |
| `message` | 诊断消息 |
| `details` | 非敏感诊断细节 |
| `stage` | 诊断阶段 |

#### `tool_event` 值得依赖的字段

| 字段 | 含义 |
| --- | --- |
| `toolCallId` | 同一次工具调用的稳定标识 |
| `toolId` | 调用的工具 ID |
| `phase` | 工具生命周期阶段，`started`、`completed` 或 `failed` |
| `title` | 面向用户的步骤标题 |
| `summary` | 面向用户的步骤摘要 |
| `inputSummary` | 可选的输入摘要 |
| `resultSummary` | 可选的结果摘要 |
| `errorSummary` | 可选的错误摘要 |

#### 语义重点

- 会话绑定的是智能体。
- 模型语义已升级为请求级 `modelRoute`，不是单一字符串 `model`。
- provider secrets 不进入请求体，也不进入事件流。
- 正式会话存储使用 SQLite 持久化（`SQLiteSessionStore`），runtime 重启后 thread 列表、历史时间线与已完成 run replay 可从本地 truth / projection 恢复。
- 增量阶段只累积草稿，成功完成才归档 assistant 文本。
- 当 raw collector 观察到 tool-call 参数完备却没有真实工具执行时，先发诊断，再以失败终态收口。

## 已退役的旧外层方法

| 方法 | 状态 |
| --- | --- |
| `info` | 已退役；旧调用收到 `method_not_implemented`。 |
| `agent/connect` | 已退役；旧调用收到 `method_not_implemented`。 |
| `agent/run` | 已退役；旧调用收到 `method_not_implemented`。 |

正式主链是 thread/run；session-first 三方法属于兼容壳。

## 错误响应外壳

### 流建立前的 JSON 错误

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

这类错误通常发生在流建立之前，例如请求结构无效、会话不存在或 agent 校验失败。

### 流建立后的错误

错误发生在 run 已建立之后时，优先使用流内错误：

1. 需要补充诊断时，先发 `run_diagnostic`。
2. 再发 `run_failed` 作为终态。

## 常见错误码

| 错误码 | 常见触发场景 |
| --- | --- |
| `invalid_request` | `method`、`body`、`sessionId`、`message` 或 `policy.modelRoute` 等字段格式不对。 |
| `session_not_found` | 请求引用的 `sessionId` 不存在。 |
| `agent_not_found` | 请求中的 `agentId` 不在目录中。 |
| `agent_mismatch` | `message/send` 里的 `agent` 与会话绑定智能体不一致。 |
| `tool_not_found` | `enabledTools` 中出现后端不认识的工具 ID。 |
| `tool_not_enabled` | 模型调用了本轮未在 `enabledTools` 中启用的工具。 |
| `invalid_message_history` | 进程内会话历史损坏，无法继续拼装上下文。 |
| `model_not_configured` | runtime 没有可用模型执行器配置。 |
| `provider_profile_not_found` | 请求中的 `providerProfileId` 在宿主真源中不存在。 |
| `model_route_snapshot_mismatch` | 请求快照与宿主 provider 配置不一致。 |
| `provider_secret_missing` | 对应 provider profile 缺少 API key。 |
| `host_model_route_access_denied` | Python runtime 调宿主私桥时访问令牌无效。 |
| `host_model_route_unavailable` | 宿主私桥不可用或返回无效响应。 |
| `agent_execution_failed` | 智能体执行阶段抛错。 |
| `method_not_implemented` | 调用了 scaffold 不支持的方法。 |

## 值得依赖的字段

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

某些响应里较细的提示字段、错误文案逐字内容和日志明细键名，按实现细节理解。

## 快速结论

- 正式聊天主路径是 thread/run 六方法，加上 `agents/list`。
- `session/create`、`capabilities/get`、[`message/send`](../system/chat-runtime-contract.md) 已降级为兼容壳。
- `info`、`agent/connect` 与 `agent/run` 已退役，不再属于 supported methods。
- 错误外壳、流式事件集合与常见错误码已足够支持联调与排错。

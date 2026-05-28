---
title: 聊天运行时 HTTP 契约（旧资料）
description: 旧 system 分册契约页。保留 HTTP 方法与兼容壳说明。
sidebar_position: 3
sidebar_label: 旧资料：运行时契约
---

# 聊天运行时 HTTP 契约（旧资料）

旧 `system` 分册，保留 HTTP 契约补充说明。第一次进入站点请先看 [聊天运行时](../developers/chat-runtime.md) 和 [运行时接口 / 事件参考](../reference/runtime-events.md)。

Electron 怎样托管这个 runtime，见 [运行时生命周期](./runtime-lifecycle.md)。配置、会话、宿主状态和页面状态分别由谁持有，见 [会话与状态模型](./session-and-state-model.md)。

## 接口分成两类

desktop runtime 是同一个 loopback HTTP 服务，对外暴露两类接口：

- 控制面端点用于健康检查、版本读取和运行诊断。
- 聊天入口统一走根路径 `POST /`，由请求体里的 `method` 字段分发具体方法。

## 控制面端点

### `GET /health`

最小健康检查。响应给出服务名、传输方式和 `ready` 标记。回答"服务进程是否还活着"。

### `GET /ready`

回答"启动流程是否已完成"。响应至少包含：

- `status`：`starting`、`ready`、`stopped` 或 `failed` 生命周期状态。
- `ready`：是否可处理请求。
- `startup_complete`：本轮启动过程是否已收口。
- `last_error`：最近一次启动失败摘要。

### `GET /version` 与 `GET /build-info`

两条路径返回同形数据，暴露：

- 后端版本。
- Python 版本。
- `app_mode` 与 `environment`。
- loopback base URL。

### `GET /diagnostics` 与 `GET /diagnostics/runtime-info`

两条路径也返回同形数据，内容更完整。响应概括：

- 运行目录、状态目录和日志目录。
- 启动配置摘要。
- local token 是否已配置。
- 聊天能力摘要。

如果 runtime 配置了 local token，请求诊断路径时需要带请求头 `X-Local-Token`。这个 token 的保护范围只覆盖 diagnostics 端点，不参与聊天消息主线。

## 聊天根端点 `POST /`

### 推荐的请求外壳

```json
{
  "method": "run/start",
  "body": {
    "...": "..."
  }
}
```

其中：

- `method` 必须是非空字符串。
- `body` 应是对象。
- 新代码继续使用显式 `body`，优先走 `thread/run` 主链。
- `message/send` 保留为兼容壳，不再作为推荐主入口。

## 真实主链

thread/run 六方法：

1. `thread/create`
2. `thread/get`
3. `run/start`
4. `run/stream`
5. `run/cancel`
6. `agents/list`

已稳定的职责划分：

- 后端目录先给出有哪些智能体。
- thread 在创建时绑定具体智能体。
- run 在启动时显式携带模型路由、工具列表和请求选项。
- run 事件流负责文本增量、工具生命周期与终态收口。

## 兼容壳

`session/create`、`capabilities/get`、`message/send` 保留并对外可用，是 thread/run 的兼容投影层：

- `session/create` 对应 `thread/create`。
- `capabilities/get` 对应 `thread/get` 的能力面投影。
- `message/send` 对应 `run/start + run/stream` 的兼容封装。

`info`、`agent/connect` 与 `agent/run` 已从 runtime surface 退役。旧调用命中它们时收到 `method_not_implemented`。

## 方法一 `agents/list`

读取 runtime 暴露的智能体目录。

### 请求示例

```json
{
  "method": "agents/list"
}
```

### 响应要点

稳定字段包括：

- `directoryVersion`
- `defaultAgentId`
- `agents[]`
- `agents[].agentId`
- `agents[].status`
- `agents[].recommendedTools`
- `agents[].defaultModelPreference`
- `agents[].displayName`
- `agents[].description`
- `agents[].iconKey`

## 方法二 `session/create`

兼容壳，对应 `thread/create`。

### 作用

创建新会话，创建时把选中的智能体绑定到会话上。

### 请求示例

```json
{
  "method": "session/create",
  "body": {
    "agentId": "default"
  }
}
```

### 响应要点

稳定字段包括：

- `sessionId`
- `boundAgent`
- `createdAt`
- `updatedAt`
- `recommendedTools`
- `defaultModelPreference`
- `capabilities`

`capabilities` 是轻量回显。正式能力面由下一步 `capabilities/get` 提供。

## 方法三 `capabilities/get`

兼容壳，对应 `thread/get` 的能力面投影。

### 作用

读取已创建会话的正式能力面。

### 请求示例

```json
{
  "method": "capabilities/get",
  "body": {
    "sessionId": "session-123"
  }
}
```

### 响应要点

稳定字段包括：

- `sessionId`
- `boundAgent`
- `capabilitiesVersion`
- `tools[]`
- `recommendedTools`
- `toolSelectionMode`
- `defaultModelPreference`

能力面暴露工具目录和推荐工具；流式主线已包含真实 `tool_event`，用于承载工具调用的 `started`、`completed` 和 `failed` 生命周期阶段。

工具语义已稳定为三层边界：`capabilities/get` 下发工具目录，`message/send` 的 `policy.enabledTools` 只表达本轮启用的工具 ID，真实调用过程通过同一条 run 事件流里的 `tool_event` 回传。

## 方法四 `message/send`

兼容壳，对应 `run/start + run/stream`。

### 作用

向已绑定会话发送一条消息，以 SSE 事件流返回本轮 run 全过程。对外可用，但不承担新增主语义。

### 与 thread/run 的对应关系

`message/send` 在运行时内部创建一条 run 记录，调用与 `run/stream` 同源的事件编排路径。前端如果直接走 `run/start` 与 `run/stream`，得到的事件语义与终态规则一致。

### 请求头

- `Content-Type: application/json`
- `Accept: text/event-stream`

### 请求示例

```json
{
  "method": "message/send",
  "body": {
    "sessionId": "session-123",
    "agent": "default",
    "message": {
      "role": "user",
      "content": "请用一句话概括当前实现。"
    },
    "policy": {
      "modelRoute": {
        "providerProfileId": "custom-provider-1",
        "snapshot": {
          "provider": "openai",
          "endpointType": "openai-compatible",
          "baseUrl": "https://api.example.com/v1",
          "modelId": "gpt-4.1"
        }
      },
      "enabledTools": [],
      "requestOptions": {}
    }
  }
}
```

### 请求字段要求

| 字段 | 要求 |
| --- | --- |
| `sessionId` | 已存在会话的非空字符串。 |
| `agent` | 可选；如果提供，校验与会话绑定智能体是否一致。 |
| `message.role` | 必须是 `user`。 |
| `message.content` | 非空文本。 |
| `policy.modelRoute.providerProfileId` | 非空字符串，稳定定位宿主侧 provider profile。 |
| `policy.modelRoute.snapshot.provider` | 非空字符串。 |
| `policy.modelRoute.snapshot.endpointType` | 非空字符串。 |
| `policy.modelRoute.snapshot.baseUrl` | 非空字符串。 |
| `policy.modelRoute.snapshot.modelId` | 非空字符串。 |
| `policy.enabledTools` | 可选；如果提供，须是字符串数组。 |
| `policy.requestOptions` | 可选；如果提供，须是对象。 |

### 模型语义

模型语义已固定为"稳定 ID + 路由快照"的对象，不是单一字符串 `model`：

- `providerProfileId` 稳定定位宿主侧 provider profile 与对应 secret。
- `snapshot.provider`、`snapshot.endpointType`、`snapshot.baseUrl` 与 `snapshot.modelId` 表达本次发送时的路由快照。

Python runtime 不会从这条请求里读取 secret，也不会从 startup 参数里读取本次执行模型。执行阶段的凭据解析和快照校验，发生在 Electron 主进程持有的宿主私桥上。

### 宿主安全边界

- provider profiles 与 secrets 真源在 Electron 主进程。
- Python runtime 在每次执行前，通过宿主私有 provider route bridge 按 `providerProfileId` 解析本地配置与 API key。
- 请求体里不带 `apiKey`，事件流里不回显 secret。
- startup 参数只传入 bridge 的 bootstrap 信息（URL 和访问 token），不承载聊天模型或 provider 执行配置。

## `message/send` 的响应形态

### 正式响应是 SSE 事件流

请求通过最外层结构校验后，[`message/send`](./chat-runtime-contract.md) 返回 `text/event-stream`，每个事件放在一条 `data:` 记录里。

典型形态：

```text
data: {"type":"run_started","runId":"run-123","sessionId":"session-123","sequence":1,"payload":{"assistantMessageId":"run-123:assistant"}}

data: {"type":"text_delta","runId":"run-123","sessionId":"session-123","sequence":2,"payload":{"assistantMessageId":"run-123:assistant","delta":"你好"}}

data: {"type":"run_completed","runId":"run-123","sessionId":"session-123","sequence":3,"payload":{"assistantMessageId":"run-123:assistant","assistantText":"你好","resolvedModelId":"gpt-4.1","resolvedModelRoute":{"providerProfileId":"custom-provider-1","snapshot":{"provider":"openai","endpointType":"openai-compatible","baseUrl":"https://api.example.com/v1","modelId":"gpt-4.1"}},"resolvedToolIds":[],"requestOptions":{}}}

```

上面是未启用工具的最小成功路径。若启用了工具并发生真实调用，事件流在同一 `runId` 下插入 `tool_event`，与 `text_delta` 一起遵守统一的 `sequence` 递增规则。

### 事件外壳

每个运行时事件带同一层外壳：

- `type`
- `runId`
- `sessionId`
- `sequence`
- `payload`

`sequence` 严格递增；前端按这个规则做顺序校验。

### 事件集合

| 事件类型 | 语义 |
| --- | --- |
| `run_started` | run 已建立，前端可据此创建 assistant 占位项。 |
| `text_delta` | assistant 文本增量片段。 |
| `run_completed` | 本轮成功完成，带回最终 assistant 文本与解析后的路由回显。 |
| `run_failed` | 本轮失败结束，给出错误码、错误消息和细节对象。 |
| `run_cancelled` | 本轮取消结束，给出取消原因。 |
| `run_diagnostic` | 非敏感诊断信息，常用于路由解析或执行阶段失败前的补充说明。 |
| `tool_event` | 真实工具生命周期步骤，通过 `phase` 区分 `started`、`completed` 与 `failed`。 |

### 顺序规则

1. 请求体不合法时，服务端直接返回 JSON 错误，不开启事件流。
2. 事件流成功建立后，首条事件是 `run_started`。
3. `tool_event` 可出现零次或多次，与 `text_delta` 按 `sequence` 交错输出。
4. `text_delta` 可出现零次或多次。
5. `run_diagnostic` 可出现在失败前，补充非敏感诊断信息。
6. 后端观察到 raw tool-call 参数完备但没有真实工具执行时，流内先出现 `run_diagnostic`，再以 `run_failed` 终止。
7. 终态事件只能是 `run_completed`、`run_failed` 或 `run_cancelled` 三者之一。
8. 终态事件发出后，流内不再输出其他事件。

### 终态载荷

#### `run_completed`

稳定字段：

- `assistantMessageId`
- `assistantText`
- `resolvedModelId`
- `resolvedModelRoute`
- `resolvedToolIds`
- `requestOptions`

#### `run_failed`

稳定字段：

- `code`
- `message`
- `details`

#### `run_cancelled`

稳定字段：

- `assistantMessageId`
- `reason`

#### `run_diagnostic`

稳定字段：

- `code`
- `message`
- `details`
- `stage`

#### `tool_event`

稳定字段：

- `toolCallId`
- `toolId`
- `phase`
- `title`
- `summary`
- 可选的 `inputSummary`
- 可选的 `resultSummary`
- 可选的 `errorSummary`

## 归档规则

采用"增量阶段只累积草稿，成功完成才归档 assistant 文本"的规则：

- `text_delta` 阶段，前端只更新 assistant 草稿，后端在内存里累计本轮文本。
- 只有 `run_completed` 到来后，后端把 user 文本和最终 assistant 文本写入会话存储。
- `tool_event` 步骤不写入正式后端会话历史。
- `run_failed` 不写入 assistant 成功消息。
- `run_cancelled` 也不写入 assistant 成功消息。

页面层可保留失败项或取消态草稿用于窗口提示；正式会话归档只在成功完成时发生。

## 错误外壳

### JSON 错误

错误发生在流建立之前（请求体缺字段、`sessionId` 不存在、`agent` 与会话绑定不一致），服务端返回传统 JSON 错误外壳：

```json
{
  "ok": false,
  "error": {
    "code": "invalid_request",
    "message": "...",
    "stage": "phase3-run-bridge",
    "requestedMethod": "message/send",
    "supportedMethods": ["..."],
    "details": {}
  }
}
```

### 流内错误

错误发生在 run 已建立之后（模型路由解析失败、宿主私桥不可用、执行阶段抛错），主线优先使用流内错误：

- 需要补充诊断时，先发 `run_diagnostic`。
- 再发 `run_failed` 作为终态。

有一条专门的收紧语义：如果 raw collector 观察到 provider tool-call 参数已完备但后续没有真实工具执行，后端发出 `raw_tool_call_unexecuted` 诊断并以失败终止，不会静默落成 `run_completed`。

## 常见错误码

- `invalid_request`
- `session_not_found`
- `agent_not_found`
- `agent_mismatch`
- `tool_not_found`
- `invalid_message_history`
- `model_not_configured`
- `provider_profile_not_found`
- `model_route_snapshot_mismatch`
- `provider_secret_missing`
- `host_model_route_access_denied`
- `host_model_route_unavailable`
- `tool_not_enabled`
- `agent_execution_failed`

路由解析相关错误优先反映请求级 `modelRoute` 与宿主真源之间的偏差，不会静默回退到别的 provider 或模型。

## 本地主线验收资产

smoke 资产是双轨：

1. `frontend-copilot/scripts/smoke-thread-run-chat.mjs` 是 thread/run 主链 smoke。
2. `frontend-copilot/scripts/smoke-streaming-chat.mjs` 是兼容壳 smoke。

两条脚本都读取 settings workspace，创建宿主私桥，拉起 Python runtime，校验流式事件终态规则。thread/run smoke 直接覆盖 `thread/create + run/start + run/stream (+ run/cancel)`，兼容 smoke 覆盖 `session/create + message/send`。

首个真实工具是 `tool.weather-current`。它是内建随机天气占位工具，不依赖外部天气 API；工具结果摘要以 `Shenzhen：小雨 / 19°C / 湿度 84%` 这类文本通过 `tool_event` 返回，再由 assistant 文本继续组织最终回答。

## collector 与调试开关

后端默认 collector 已切到 provider-native 的 raw stream 路径，用于更早观察并驱动 tool-call 链。`result.stream_text()` 文本流路径保留为 fallback。

链路调试开关是环境变量 `COPILOT_RUNTIME_CHAIN_DEBUG`。打开后输出 collector 选择、raw tool-call 观察、工具生命周期与终态收口等结构化日志。

## 与 CopilotKit 的关系

CopilotKit 依赖已从仓库移除：

- 前端聊天协议、状态机和流式解析都由项目自身实现。
- Python runtime 主合同也由项目自身维护。
- 仓库里保留的 `copilot_runtime`、`features/copilot` 等命名是历史沿用内部命名空间，不再代表对第三方 CopilotKit runtime 的运行时耦合。

## 相关文档

- [系统架构总览](./architecture-overview.md)
- [运行时生命周期](./runtime-lifecycle.md)
- [会话与状态模型](./session-and-state-model.md)
- [后端暴露契约与前端接入点](../backend/frontend-connection.md)
- [前端现在怎样连接后端](../frontend/backend-connection-contract.md)

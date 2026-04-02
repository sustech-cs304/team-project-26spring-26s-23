---
title: 聊天运行时 HTTP 契约
description: 说明 desktop runtime 当前控制面端点，以及 session-first 流式聊天主契约。
sidebar_position: 3
sidebar_label: 聊天运行时契约
---

# 聊天运行时 HTTP 契约

这篇文档只描述当前已经落地的 HTTP 契约：有哪些端点，前端真正怎样发请求，[`message/send`](./chat-runtime-contract.md) 现在怎样以流式事件工作，以及哪些旧方法已经退役。

Electron 怎样托管这个 runtime，见 [运行时生命周期](./runtime-lifecycle.md)。配置、会话、宿主状态和页面状态分别由谁持有，见 [会话与状态模型](./session-and-state-model.md)。

## 当前接口分成两类

当前 desktop runtime 仍然是同一个 loopback HTTP 服务，对外暴露两类接口：

- 控制面端点用于健康检查、版本读取和运行诊断。
- 聊天入口统一走根路径 `POST /`，再由请求体里的 `method` 字段分发具体方法。

## 控制面端点

### `GET /health`

这条端点用于最小健康检查。当前响应会给出服务名、传输方式和 `ready` 标记。它更适合回答“服务进程是否还活着”。

### `GET /ready`

这条端点用于回答“启动流程是否已经完成”。当前响应至少会包含：

- `status`，也就是 `starting`、`ready`、`stopped` 或 `failed` 这一类生命周期状态。
- `ready`，也就是当前是否已经可以处理请求。
- `startup_complete`，也就是本轮启动过程是否已经收口。
- `last_error`，也就是最近一次启动失败摘要。

### `GET /version` 与 `GET /build-info`

这两条路径当前返回同形数据，主要用于暴露：

- 后端版本。
- Python 版本。
- `app_mode` 与 `environment`。
- 当前 loopback base URL。

### `GET /diagnostics` 与 `GET /diagnostics/runtime-info`

这两条路径当前也返回同形数据，但内容更完整。响应会概括：

- 运行目录、状态目录和日志目录。
- 当前启动配置摘要。
- local token 是否已配置。
- 当前聊天能力摘要。

如果 runtime 配置了 local token，请求这两条诊断路径时需要带上请求头 `X-Local-Token`。这个 token 的保护范围只覆盖 diagnostics 端点，不参与聊天消息主线。

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
- `body` 应当是对象。
- 新代码应继续使用显式 `body`，当前主路径不再依赖顶层旧兼容写法。

## 当前前端正式主路径

当前前端正式主路径已经收口为下面四个方法：

1. `agents/list`
2. `session/create`
3. `capabilities/get`
4. `message/send`

这条链路对应一组已经稳定下来的职责划分：

- 后端目录先给出当前有哪些智能体。
- 会话在创建时绑定具体智能体。
- 每次消息请求再显式给出本次模型路由、工具列表和请求选项。

`info`、`agent/connect` 与 `agent/run` 已从当前 runtime surface 退役。如果仍有旧调用命中它们，当前应收到 `method_not_implemented`，并迁移到 session-first 四方法。

## 方法一 `agents/list`

### 作用

这条方法用于读取当前 runtime 暴露的智能体目录。

### 请求示例

```json
{
  "method": "agents/list"
}
```

### 响应要点

当前稳定字段主要包括：

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

### 响应要点

当前稳定字段主要包括：

- `sessionId`
- `boundAgent`
- `createdAt`
- `updatedAt`
- `recommendedTools`
- `defaultModelPreference`
- `capabilities`

其中 `capabilities` 目前只是一份轻量回显。正式能力面仍然由下一步 `capabilities/get` 提供。

## 方法三 `capabilities/get`

### 作用

这条方法用于读取某个已创建会话的正式能力面。

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

当前稳定字段主要包括：

- `sessionId`
- `boundAgent`
- `capabilitiesVersion`
- `tools[]`
- `recommendedTools`
- `toolSelectionMode`
- `defaultModelPreference`

需要注意的是，能力面会继续暴露工具目录和推荐工具；当前流式主线已经包含真实 `tool_event`，用于承载工具调用的 `started`、`completed` 和 `failed` 生命周期阶段。

## 方法四 `message/send`

### 作用

这条方法用于向某个已绑定会话发送一条消息，并以 SSE 事件流返回本轮 run 的全过程。当前正式主路径已经不再把 [`message/send`](./chat-runtime-contract.md) 当成“整包 JSON 响应”接口。

### 请求头

当前前端发送这条请求时，会显式带上：

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

### 当前请求字段要求

| 字段 | 当前要求 |
| --- | --- |
| `sessionId` | 必须是已存在会话的非空字符串。 |
| `agent` | 可选；如果提供，会用于校验与会话绑定智能体是否一致。 |
| `message.role` | 当前必须是 `user`。 |
| `message.content` | 必须是非空文本。 |
| `policy.modelRoute.providerProfileId` | 必须是非空字符串，用来稳定定位宿主侧 provider profile。 |
| `policy.modelRoute.snapshot.provider` | 必须是非空字符串。 |
| `policy.modelRoute.snapshot.endpointType` | 必须是非空字符串。 |
| `policy.modelRoute.snapshot.baseUrl` | 必须是非空字符串。 |
| `policy.modelRoute.snapshot.modelId` | 必须是非空字符串。 |
| `policy.enabledTools` | 可选；如果提供，必须是字符串数组。 |
| `policy.requestOptions` | 可选；如果提供，必须是对象。 |

### 当前模型语义

当前模型语义已经固定为“稳定 ID + 路由快照”的对象，而不是单一字符串 `model`：

- `providerProfileId` 用来稳定定位宿主侧 provider profile 与对应 secret。
- `snapshot.provider`、`snapshot.endpointType`、`snapshot.baseUrl` 与 `snapshot.modelId` 用来表达本次发送时的路由快照。

Python runtime 不会从这条请求里读取 secret，也不会再从 startup 参数里读取本次执行模型。执行阶段真正的凭据解析和快照校验，发生在 Electron 主进程持有的宿主私桥上。

### 当前宿主安全边界

当前主线的安全边界已经明确：

- provider profiles 与 secrets 真源在 Electron 主进程。
- Python runtime 在每次执行前，通过宿主私有 provider route bridge 按 `providerProfileId` 解析本地配置与 API key。
- 请求体里不带 `apiKey`，事件流里也不会回显 secret。
- startup 参数当前只负责传入 bridge 的 bootstrap 信息，也就是 URL 和访问 token，不再承载聊天模型或 provider 执行配置。

## `message/send` 的当前响应形态

### 当前正式响应是 SSE 事件流

只要请求通过了最外层结构校验，[`message/send`](./chat-runtime-contract.md) 就会返回 `text/event-stream`，每个事件都放在一条 `data:` 记录里。

典型形态如下：

```text
data: {"type":"run_started","runId":"run-123","sessionId":"session-123","sequence":1,"payload":{"assistantMessageId":"run-123:assistant"}}

data: {"type":"text_delta","runId":"run-123","sessionId":"session-123","sequence":2,"payload":{"assistantMessageId":"run-123:assistant","delta":"你好"}}

data: {"type":"run_completed","runId":"run-123","sessionId":"session-123","sequence":3,"payload":{"assistantMessageId":"run-123:assistant","assistantText":"你好","resolvedModelId":"gpt-4.1","resolvedModelRoute":{"providerProfileId":"custom-provider-1","snapshot":{"provider":"openai","endpointType":"openai-compatible","baseUrl":"https://api.example.com/v1","modelId":"gpt-4.1"}},"resolvedToolIds":[],"requestOptions":{}}}

```

上面示例展示的是未启用工具的最小成功路径。若本轮启用了工具并发生真实调用，事件流会在同一 `runId` 下插入 `tool_event`，并继续与 `text_delta` 一起遵守统一的 `sequence` 递增规则。

### 当前事件外壳

每个运行时事件都带有同一层外壳：

- `type`
- `runId`
- `sessionId`
- `sequence`
- `payload`

其中 `sequence` 会严格递增；前端也按这个规则做顺序校验。

### 当前事件集合

当前正式事件集合如下：

| 事件类型 | 当前语义 |
| --- | --- |
| `run_started` | 这条事件表示 run 已建立，前端可以据此创建 assistant 占位项。 |
| `text_delta` | 这条事件承载 assistant 文本增量片段。 |
| `run_completed` | 这条事件表示本轮成功完成，并带回最终 assistant 文本与解析后的路由回显。 |
| `run_failed` | 这条事件表示本轮失败结束，并给出错误码、错误消息和细节对象。 |
| `run_cancelled` | 这条事件表示本轮取消结束，并给出取消原因。 |
| `run_diagnostic` | 这条事件承载非敏感诊断信息，当前常用于路由解析或执行阶段失败前的补充说明。 |
| `tool_event` | 这条事件承载真实工具生命周期步骤，并通过 `phase` 区分 `started`、`completed` 与 `failed`。 |

### 当前顺序规则

当前流式主线有几条已经可以依赖的顺序规则：

1. 如果请求体本身不合法，服务端会直接返回 JSON 错误，不会开启事件流。
2. 一旦事件流成功建立，首条事件必须是 `run_started`。
3. `tool_event` 可以出现零次或多次，并与 `text_delta` 一起按 `sequence` 交错输出。
4. `text_delta` 可以出现零次或多次。
5. `run_diagnostic` 可以出现在失败前，用来补充非敏感诊断信息。
6. 终态事件只能是 `run_completed`、`run_failed` 或 `run_cancelled` 三者之一。
7. 终态事件发出后，流内不会再继续输出其他事件。

### 当前终态载荷

#### `run_completed`

当前稳定字段主要包括：

- `assistantMessageId`
- `assistantText`
- `resolvedModelId`
- `resolvedModelRoute`
- `resolvedToolIds`
- `requestOptions`

#### `run_failed`

当前稳定字段主要包括：

- `code`
- `message`
- `details`

#### `run_cancelled`

当前稳定字段主要包括：

- `assistantMessageId`
- `reason`

#### `run_diagnostic`

当前稳定字段主要包括：

- `code`
- `message`
- `details`
- `stage`

#### `tool_event`

当前稳定字段主要包括：

- `toolCallId`
- `toolId`
- `phase`
- `title`
- `summary`
- 可选的 `inputSummary`
- 可选的 `resultSummary`
- 可选的 `errorSummary`

## 当前归档规则

当前主线已经明确采用“增量阶段只累积草稿，成功完成才归档 assistant 文本”的规则：

- `text_delta` 阶段，前端只更新当前 assistant 草稿，后端也只在内存里累计本轮文本。
- 只有 `run_completed` 到来后，后端才会把 user 文本和最终 assistant 文本一起写入会话存储。
- `run_failed` 不会写入 assistant 成功消息。
- `run_cancelled` 也不会写入 assistant 成功消息。

页面层可以继续保留失败项或取消态草稿，用于当前窗口提示；正式会话归档只在成功完成时发生。

## 当前错误外壳

### JSON 错误

如果错误发生在流建立之前，例如请求体缺字段、`sessionId` 不存在，或者 `agent` 与会话绑定不一致，服务端仍然会返回传统 JSON 错误外壳：

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

如果错误发生在 run 已建立之后，例如模型路由解析失败、宿主私桥不可用，或者执行阶段抛错，当前主线会优先使用流内错误：

- 需要补充诊断时，先发 `run_diagnostic`。
- 然后再发 `run_failed` 作为终态。

## 当前常见错误码

当前联调中较常见的错误码包括：

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
- `agent_execution_failed`

其中路由解析相关错误会优先反映请求级 `modelRoute` 与宿主真源之间的偏差，不会静默回退到别的 provider 或别的模型。

## 当前本地主线验收资产

当前已经有一条可以直接用于本地主线验收的 smoke 脚本，也就是 `frontend-copilot/scripts/smoke-streaming-chat.mjs`。这条脚本会完成下面这些动作：

1. 它从 settings workspace 文档读取 provider profiles 与 secrets。
2. 它在本地创建宿主私有 provider route bridge。
3. 它以临时 bootstrap 信息拉起 Python runtime。
4. 它执行 `session/create`。
5. 它执行流式 `message/send`，并校验最终事件为 `run_completed`。

这条脚本已经可以覆盖真实 provider、请求级模型路由、宿主取密钥与 `text_delta` 主线。

## 当前与 CopilotKit 的关系

CopilotKit 依赖已经从当前仓库移除；当前主线里的事实是：

- 前端聊天协议、状态机和流式解析都由项目自身实现。
- Python runtime 主合同也由项目自身维护。
- 仓库里保留的 `copilot_runtime`、`features/copilot` 等命名主要是历史沿用的内部命名空间，不再代表对第三方 CopilotKit runtime 的运行时耦合。

## 相关文档

- [系统架构总览](./architecture-overview.md)
- [运行时生命周期](./runtime-lifecycle.md)
- [会话与状态模型](./session-and-state-model.md)
- [后端暴露契约与前端接入点](../backend/frontend-connection.md)
- [前端现在怎样连接后端](../frontend/backend-connection-contract.md)

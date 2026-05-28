---
title: 前端运行时状态参考
description: 汇总 frontend bootstrap 状态、hosted runtime 状态与聊天 run 状态。
sidebar_position: 4
---

# 前端运行时状态参考

frontend 分册参考层，用于查询状态名与判定规则。连接主路径见[前端现在怎样连接后端](./backend-connection-contract.md)，界面结构见[前端当前 UI 状态](./ui-current-state.md)。

## 状态分三层

前端运行时状态分成三层：

1. hosted runtime 状态由 Electron 主进程维护，描述宿主管理的本地后端情况。
2. bootstrap 状态由 renderer 计算，描述前端工作台下一步怎样走。
3. chat run 状态由聊天面板维护，描述 run 执行的进度。

三层不混写。hosted runtime 是运行事实，bootstrap 是入口判断，chat run 是聊天过程。

## 第一层：hosted runtime 状态

hosted runtime 使用下面几个状态值：

- `stopped`
- `starting`
- `ready`
- `failed`
- `degraded`

这层状态回答：

- 宿主有没有成功拉起本地 runtime。
- 是否拿到了可用地址。
- 运行模式是什么。
- 最近一次失败摘要是什么。

### `failed` 和 `degraded` 的区别

- `failed`：宿主没有形成稳定可用的 hosted 地址。
- `degraded`：宿主出现异常，但保留了可继续使用的地址。

## 第二层：bootstrap 状态

renderer 把公开配置中心的 bootstrap 字段和 hosted runtime 快照合并，得到 bootstrap 状态。

状态值包括：

- `loading`
- `empty`
- `incomplete`
- `starting`
- `ready`
- `failed`
- `degraded`
- `error`

## bootstrap 状态含义

| 状态 | 含义 |
| --- | --- |
| `loading` | 根装配层还在读取公开配置中心与 hosted runtime 快照。 |
| `empty` | 没有可用 `runtimeUrl`。 |
| `incomplete` | 缺少继续进入主路径所需的最小字段，实际主要就是 `runtimeUrl`。 |
| `starting` | 宿主正在启动本地 runtime。 |
| `ready` | 前端已拿到可用地址，可以继续进入智能体目录、会话和聊天路径。 |
| `failed` | 宿主启动失败，也没有可用的开发态 override。 |
| `degraded` | 宿主处于降级状态，但仍提供了可用地址。 |
| `error` | 读取公开快照或 runtime 快照的链路本身失败。 |

## 判断最关键字段

bootstrap 判断依赖的最小字段是 `runtimeUrl`。

`agentName` 仍然进入状态对象，但主要用于偏好与诊断摘要，不再是进入聊天主路径的硬门槛。

`backendExposed.model` 存在于公开配置结构里，但不是聊天主线模型配置，也不决定 run 用哪条模型路由。

## `runtimeUrl` 选择过程

前端按下面的顺序决定连接地址：

1. 如果 hosted runtime 状态是 `ready`、`starting` 或 `degraded`，优先使用宿主管理的地址。
2. 如果 hosted runtime 状态是 `failed` 或 `stopped`，而且是开发模式、不是打包态，并且公开配置中心里已配置 `runtimeUrl`，允许使用开发态 override。
3. 上面两条都不满足时，没有可用地址。

对应的 `runtimeSource` 有三种取值：

- `hosted`
- `dev-override`
- `none`

## 归并规则速查表

| hosted runtime 状态 | 是否存在可用地址 | 最终 bootstrap 状态 |
| --- | --- | --- |
| `ready` | 是 | `ready` |
| `ready` | 否 | `incomplete` |
| `starting` | 无论是否完整 | `starting` |
| `degraded` | 是 | `degraded` |
| `degraded` | 否 | `incomplete` |
| `failed` | 有开发态 override | `ready` |
| `failed` | 无开发态 override | `failed` |
| `stopped` | 有开发态 override | `ready` |
| `stopped` | 无开发态 override | `empty` |

## 第三层：chat run 状态

进入聊天分支后，聊天面板维护一份独立的 run 状态。状态值包括：

- `idle`
- `starting`
- `streaming`
- `awaiting_input`
- `completed`
- `failed`
- `cancelled`

### run 状态含义

| 状态 | 含义 |
| --- | --- |
| `idle` | 没有在途 run。 |
| `starting` | 请求已发出，等待首个 `run_started` 事件。 |
| `streaming` | assistant 占位项已建立，前端持续接收 `tool_event` 与 `text_delta`。 |
| `awaiting_input` | run 已暂停，等待用户提供额外输入或确认（如工具审批）。 |
| `completed` | 本轮成功完成，最终 assistant 文本已定稿。 |
| `failed` | 本轮失败结束，页面保留失败摘要。 |
| `cancelled` | 本轮取消结束，页面保留取消终态。 |

### run 状态记录字段

聊天 run 状态至少记录：

- `runId`
- `threadId`
- `activeModelRoute`
- `resolvedModelId`
- `resolvedModelRoute`
- `resolvedToolIds`
- `requestOptions`
- `requestedThinkingSelection` / `appliedThinkingSelection`
- `requestedThinkingLevel` / `appliedThinkingLevel`
- `thinkingCapabilitySnapshot`
- `thinkingSeriesDecision`
- `reasoningSuppressionBasis`
- `reasoningSuppressed`
- `reasoningTraceState`（`not_observed` / `suppressed` / `visible`）
- `diagnostic`
- `failure`
- `cancelReason`
- `segments`（`assistant` / `reasoning` / `tool` / `inline_form` / `diagnostic` 段列表）

### run 状态随事件变化

前端按下面方式驱动 run 状态：

- 收到 `run_started` 时，状态从 `starting` 进入 `streaming`，附带 thinking 元数据。
- 收到 `run_metadata` 时，状态保持 `streaming`，更新 thinking 能力快照。
- 收到 `tool_event` 时，状态保持 `streaming`，更新同一 `toolCallId` 的工具步骤。
- 收到 `text_delta` 时，状态保持 `streaming`，更新 assistant 草稿。
- 收到 `reasoning_delta` 时，状态保持 `streaming`，增量拼接推理链段；若推理压制生效则剥离推理段。
- 收到 `run_completed` 时，状态进入 `completed`，记录最终 `resolvedModelRoute` 等结果。
- 收到 `run_failed` 时，状态进入 `failed`。
- 收到 `run_cancelled` 时，状态进入 `cancelled`。
- 收到 `run_diagnostic` 时，状态附带非敏感诊断摘要。

当流内出现"raw tool-call 参数完备但未发生真实工具执行"这一类诊断时，状态先记录诊断摘要，再进入 `failed` 终态。

## 这些状态在界面里被消费

根装配层根据 bootstrap 状态决定显示启动说明、错误说明，还是继续进入工作台。

助手工作区在 `ready` 或 `degraded` 可连接分支里，才继续拉智能体目录、创建会话和展示聊天发送区。

聊天面板根据 run 状态决定：

- 是否禁用发送按钮。
- 是否展示 assistant 流式占位项。
- 是否展示成功终态、失败摘要或取消终态。

## 边界

- 前端不再要求先拿到全局 `agentName` 才能进入聊天路径。
- 配置中心更新已能推送到 renderer，但 runtime 运行事实仍主要靠快照读取和重试后重算。
- `backendExposed.model` 是正式字段，但不直接决定聊天连接是否成立，也不决定 run 使用哪个模型路由。
- 前端已正式消费流式事件，而不是只等待非流式完整响应。
- 主链是 thread/run，`session/create`、`capabilities/get`、`message/send` 作为兼容壳继续保留。

## 相关文档

- [前端现在怎样连接后端](./backend-connection-contract.md)
- [当前生效字段参考](./reference-current-fields.md)
- [会话与状态模型](../system/session-and-state-model.md)

---
title: 会话与状态模型
description: 解释公开配置中心、settings workspace、宿主运行态、前端 run 状态与后端 thread/run 存储怎样分层持有。
sidebar_position: 4
---

# 会话与状态模型

回答一个问题：系统里有哪些状态，它们分别放在哪里，由谁持有，又怎样彼此影响。系统结构见 [系统架构总览](./architecture-overview.md)，启动顺序见 [运行时生命周期](./runtime-lifecycle.md)，HTTP 字段与事件流见 [聊天运行时契约](./chat-runtime-contract.md)。

## 状态地图

系统分成六层状态：

| 状态层 | 主要 owner | 主要位置 | 典型内容 |
| --- | --- | --- | --- |
| 公开配置中心状态 | Electron 主进程 | `config-center` 域文档与公开快照 | `theme`、`animationsEnabled`、`agentName`、`runtimeUrl`，以及仍存在但已退居次要位置的 `backendExposed.model` |
| settings workspace 普通状态 | Electron 主进程 | `settings-workspace-state.json` | provider profiles、默认模型路由、设置页普通字段 |
| settings workspace secret 状态 | Electron 主进程 | `settings-workspace-secrets.json` | provider API key、CAS 密码等敏感值 |
| 宿主运行态 | Electron 主进程 | hosted runtime 内存快照与诊断文件 | `starting`、`ready`、`failed`、`degraded`、`runtimeUrl`、失败摘要、宿主私桥 bootstrap |
| renderer 根装配与 run 状态 | renderer | `CopilotConfigState`、聊天面板本地 state | `loading`、`ready`、`degraded`、`empty`，以及 run 的 `idle`、`starting`、`streaming`、`completed`、`failed`、`cancelled` |
| 会话与消息状态 | renderer 与 Python runtime 分层持有 | renderer 会话壳、聊天面板本地会话视图、后端 `SQLiteSessionStore` | 智能体目录、会话壳、消息草稿、流式占位项、已归档历史 |

系统已不是"一份 settings 文件 + 一份前端本地状态"的结构。provider 元数据、secrets、运行态快照、run 草稿和正式会话历史，各自有不同 owner。

## 第一层：公开配置中心状态

### 保存可公开、稳定、适合根装配消费的配置

统一配置中心由 Electron 主进程读写，投影成 renderer 可消费的公开快照。公开字段包括：

- `theme`
- `animationsEnabled`
- `agentName`
- `runtimeUrl`
- `backendExposed.model`

### 真正影响聊天入口判断的字段是 `runtimeUrl`

根装配判断能否进入聊天主线，主要看 `runtimeUrl`。`agentName` 保留在公开快照里，但不是聊天入口门槛。`backendExposed.model` 仍在公开配置结构里，但不承担聊天主线模型决策职责。

### 已具备订阅更新链路

主进程在公开补丁写回后广播新公开快照。renderer 收到后重新计算根装配状态。这层状态不是一次性读取。

## 第二层：settings workspace 普通状态

### 服务设置工作区，也是 provider 元数据真源

由主进程持久化，保存设置页需要完整回显和编辑的字段：

- provider profiles 与模型清单。
- 默认模型路由。
- SUSTech 普通字段。
- 搜索、API、数据、导出、MCP、记忆等设置项。

对聊天主线最关键的事实：provider profile 元数据真源在 Electron 主进程，不是 Python runtime。

### 不再存在"唯一 active provider 决定聊天模型集合"的语义

settings workspace 里可保留 `activeProviderId` 等页面交互状态，但它只作为设置页编辑焦点、列表筛选或选中项。聊天区使用的模型路由取决于每次 `run/start` 请求里显式携带的 `modelRoute`；兼容层 [`message/send`](./chat-runtime-contract.md) 也映射到同一语义，不是某个全局 active provider。

### 首次状态允许空白

- provider profiles 可为空数组。
- 默认模型路由可为空字符串。
- 设置页首次进入时不会自动带一组预置 provider。

实现允许用户从空白模型配置开始，不是默认预置一条聊天主线。

## 第三层：settings workspace secret 状态

### secrets 单独成层

与普通状态分文档保存。典型 secret：

- provider API key。
- SUSTech CAS 密码。

### 由主进程直接持有

renderer 不能通过公开快照获得这类值，只能通过专门受控接口读取、保存或清除。主线强调的是"宿主持有敏感真源"，不是"把敏感值并入页面普通状态"。

### secret 状态与普通状态的关系

设置页把普通状态与 secret 状态一起水合成可编辑视图，例如 provider profile 上的 `hasApiKey` 展示信息，但 API key 保存在 secret 文档里。

## 第四层：宿主运行态

### 描述 Python runtime 的运行事实

主进程构建 hosted runtime 快照，通过 preload 暴露给 renderer。这层状态回答：

- hosted backend 处于 `starting`、`ready`、`failed`、`degraded` 还是 `stopped`。
- 有没有可用 `runtimeUrl`。
- 期望模式与已解析模式分别是什么。
- 最近一次失败发生在什么阶段。

### 还持有宿主私桥 bootstrap

主进程持有宿主私有 provider route bridge 的 bootstrap 信息：

- bridge URL。
- bridge token。

这些信息在启动 Python runtime 时以运行边界参数形式注入，provider secrets 不下发给 Python。

## 第五层：renderer 根装配与 run 状态

### 根装配状态是"公开配置 + 运行事实"的合成结果

renderer 启动时并行读取公开配置快照与 runtime 快照，合成为 `CopilotConfigState`。状态值包括：

- `loading`
- `empty`
- `incomplete`
- `starting`
- `ready`
- `failed`
- `degraded`
- `error`

关键判断围绕 `runtimeUrl` 展开，不把全局 model 或 agentName 当成聊天 readiness 的硬门槛。

### 聊天面板有独立的 run 状态机

进入聊天分支后，renderer 维护 run 状态：

- `idle`
- `starting`
- `streaming`
- `awaiting_input`
- `completed`
- `failed`
- `cancelled`

记录：

- `runId`
- `sessionId`
- assistant 占位项 ID
- `activeModelRoute`
- `resolvedModelRoute`
- `resolvedModelId`
- `resolvedToolIds`
- `requestOptions`
- 非敏感诊断信息
- 失败摘要或取消原因

### 前端不等待整包响应后再更新界面

聊天面板：

- 收到 `run_started` 时建立 assistant 占位项。
- 收到 `text_delta` 时增量拼接文本。
- 收到 `run_completed` 时定稿最终 assistant 文本。
- 收到 `run_failed` 或 `run_cancelled` 时进入对应终态。

页面会话视图和后端 run 事件流紧密耦合，不是"一次请求返回一整包 assistant 消息"模型。

## 第六层：会话与消息状态

这层由前后端分开持有。

### 6.1 智能体目录状态来自后端

前端进入可连接状态后调用 `agents/list`。目录状态由后端给出，前端只做展示增强。目录项包含：

- `agentId`
- `status`
- `displayName`
- `description`
- `recommendedTools`
- `defaultModelPreference`
- `iconKey`

### 6.2 renderer 会话壳只保留在当前窗口内存

前端在 renderer 内存里维护 thread 壳与兼容会话壳。thread 壳包含：

- `threadId`
- `boundAgent`
- `createdAt`
- `updatedAt`
- `latestRunId`

兼容会话壳保留 `sessionId` 视图字段，由同一底层 thread 投影。能力面字段带出工具目录、推荐工具、工具选择模式和默认模型偏好提示。

### 6.3 默认发送路径不自动启用推荐工具

能力面仍返回推荐工具和默认偏好提示，但聊天草稿默认使用空工具数组。工具目录保留在能力面里，发送时是否携带工具由消息请求显式决定。

### 6.4 后端正式历史保存在 SQLite 持久化存储

Python runtime 以 thread/run 为主模型持有记录。正式存储使用 SQLite 持久化：

- **`SQLiteSessionStore`**（`backend/app/copilot_runtime/persistence/`）：保存 thread truth、run truth、run events 以及 thread/run projections。这是唯一的正式持久化存储。
- `InMemorySessionStore` 仅用作无 `DesktopRuntimeConfig` 时的回退（如测试场景），不属于正式运行时存储。

Alembic 迁移脚本位于 `backend/alembic/versions/`，运行时默认在初始化时执行 `alembic upgrade head`。thread/run 的 projection 视图是可重建 cache，不是唯一真相来源。

多轮上下文的正式持有者是 SQLite 持久化层，底层主键是 `threadId + runId`。

### 6.5 归档规则已和流式 run 主线对齐

- 流式阶段只累计 assistant 草稿。
- 工具步骤在消息流中显示，但不写入正式后端会话历史。
- 只有 `run_completed` 到来后，后端把 user 文本和最终 assistant 文本追加进正式会话历史。
- `run_failed` 不归档 assistant 成功消息。
- `run_cancelled` 也不归档 assistant 成功消息。

前端可保留错误项或取消态草稿用于窗口提示；这层状态不是后端正式会话历史。

### 6.6 历史持久化与跨 runtime 恢复

会话存储是 SQLite 持久化与内存缓存的双层结构。

- SQLite 层（`copilot-chat.db`）持久保存 thread、run 和 run events。
- thread 列表可从本地 truth / projection 恢复，历史时间线可按需重建，已完成 run 可从持久化事件做基础 replay。
- 前端通过 `GET /history/threads`、`GET /history/runs/{runId}/replay` 等端点查询历史。

不支持的场景：跨设备同步、云端托管备份、全局 retention / search 策略。

前端没有一条正式的"按 `sessionId` 回放完整历史"的链路。

### 6.7 聊天面板还有页面级临时状态

聊天面板本地维护更短生命周期的交互状态：

- 输入框草稿文本。
- 选中的模型路由。
- 启用的工具列表。
- `requestOptions` 文本与解析结果。
- run 状态。
- 窗口里已显示的消息列表。

这层状态是页面交互所需的临时状态，不是后端正式会话历史。

## 能自动更新的状态

### 已有明确更新链路的状态

- 公开配置中心快照在补丁写回后广播更新。
- 根装配状态在收到公开快照后重新计算。
- settings workspace 普通状态和 secret 状态在设置页重新加载或保存后更新。
- thread 壳在 `thread/create` 与 `thread/get` 完成后建立或刷新，兼容会话壳在 `session/create` 与 `capabilities/get` 投影后刷新。
- 聊天面板 run 状态随 `run/stream` 事件流持续变化，兼容层 [`message/send`](./chat-runtime-contract.md) 也复用同一事件语义。

### 没有完整持续流的状态

- hosted runtime 的全部状态变化。
- settings workspace 跨页面、跨窗口的同步更新。
- renderer 会话列表的跨窗口同步。
- 后端完整会话历史的主动回放。

## 常见注意点

### 公开配置中心不是聊天执行真源

它保存公开、稳定、适合根装配消费的配置事实。聊天执行时真正的 provider 元数据真源和 secret 真源在 Electron 主进程持有的 settings workspace 体系里。

### `backendExposed.model` 仍在，但不是聊天主线模型配置

这个字段在公开配置结构里，但聊天主线不再依赖它决定 Python runtime 的执行模型，也不再下发给 startup 参数。

### settings workspace 里的 `activeProviderId` 不是聊天总开关

它是设置页交互状态。聊天主线使用的目标路由以每次请求里的 `modelRoute` 为准。

### 前端显示失败项或取消态草稿并非正式归档消息

后端只在 `run_completed` 时把 assistant 文本写入正式历史。失败和取消都不写入 assistant 成功消息。

运行时已收紧一条诊断语义：当 raw collector 观察到 tool-call 参数完备却没有真实工具执行时，后端显式发出诊断并以失败终止，不会静默完成。

## 相关文档

- [系统架构总览](./architecture-overview.md)
- [运行时生命周期](./runtime-lifecycle.md)
- [聊天运行时契约](./chat-runtime-contract.md)
- [前端运行时状态参考](../frontend/reference-runtime-states.md)

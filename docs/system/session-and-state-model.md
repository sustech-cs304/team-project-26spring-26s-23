---
title: 会话与状态模型
description: 解释公开配置中心、settings workspace、宿主运行态、前端 run 状态与后端会话存储当前怎样分层持有。
sidebar_position: 4
---

# 会话与状态模型

这篇文档只回答一个问题：当前系统里有哪些状态，它们分别放在哪里，由谁持有，又怎样彼此影响。系统结构见 [系统架构总览](./architecture-overview.md)，启动顺序见 [运行时生命周期](./runtime-lifecycle.md)，HTTP 字段与事件流见 [聊天运行时契约](./chat-runtime-contract.md)。

## 先看当前状态地图

当前系统至少可以分成下面六层状态：

| 状态层 | 主要 owner | 主要位置 | 典型内容 |
| --- | --- | --- | --- |
| 公开配置中心状态 | Electron 主进程 | `config-center` 域文档与公开快照 | `theme`、`animationsEnabled`、`agentName`、`runtimeUrl`，以及仍然存在但已退居次要位置的 `backendExposed.model` |
| settings workspace 普通状态 | Electron 主进程 | `settings-workspace-state.json` | provider profiles、默认模型路由、设置页普通字段 |
| settings workspace secret 状态 | Electron 主进程 | `settings-workspace-secrets.json` | provider API key、CAS 密码等敏感值 |
| 宿主运行态 | Electron 主进程 | hosted runtime 内存快照与诊断文件 | `starting`、`ready`、`failed`、`degraded`、`runtimeUrl`、失败摘要、宿主私桥 bootstrap |
| renderer 根装配与 run 状态 | renderer | `CopilotConfigState`、聊天面板本地 state | `loading`、`ready`、`degraded`、`empty`，以及 run 的 `idle`、`starting`、`streaming`、`completed`、`failed`、`cancelled` |
| 会话与消息状态 | renderer 与 Python runtime 分层持有 | renderer 会话壳、聊天面板本地会话视图、后端 `InMemorySessionStore` | 智能体目录、会话壳、消息草稿、流式占位项、已归档历史 |

这张图背后最关键的一点是：当前系统已经不是“一份 settings 文件 + 一份前端本地状态”的结构。provider 元数据、secrets、运行态快照、run 草稿和正式会话历史，各自都有不同 owner。

## 第一层：公开配置中心状态

### 这层保存的是可公开、稳定、适合根装配消费的配置

统一配置中心由 Electron 主进程读写，并投影成 renderer 可消费的公开快照。当前公开字段仍然包括：

- `theme`
- `animationsEnabled`
- `agentName`
- `runtimeUrl`
- `backendExposed.model`

### 这层真正影响聊天入口判断的字段仍然是 `runtimeUrl`

当前根装配判断能否继续进入聊天主线，主要看的是 `runtimeUrl`。`agentName` 仍然保留在公开快照里，但它已经不是聊天入口门槛。`backendExposed.model` 也还在公开配置结构里，不过它不再承担聊天主线模型决策职责。

### 这层已经具备订阅更新链路

主进程在公开补丁写回后，会广播新的公开快照。renderer 收到后会重新计算根装配状态，因此这层状态已经不是一次性读取。

## 第二层：settings workspace 普通状态

### 这层服务设置工作区本身，也是 provider 元数据真源

settings workspace 普通状态由主进程持久化，当前保存的是设置页需要完整回显和编辑的一整组字段，例如：

- provider profiles 与模型清单。
- 默认模型路由。
- SUSTech 普通字段。
- 搜索、API、数据、导出、MCP、记忆等设置项。

对聊天主线来说，这层最重要的事实是：provider profile 元数据真源在 Electron 主进程，而不是 Python runtime。

### 当前不再存在“唯一 active provider 决定聊天模型集合”的产品语义

settings workspace 里仍然可以保留 `activeProviderId` 这一类页面交互状态，但它只适合作为设置页的编辑焦点、列表筛选或当前选中项。聊天区真正使用哪条模型路由，取决于每次 [`message/send`](./chat-runtime-contract.md) 请求里显式携带的 `modelRoute`，而不是某个全局 active provider。

### 这层首次状态仍然允许是空白的

当前默认行为仍然是：

- provider profiles 可以是空数组。
- 默认模型路由可以是空字符串。
- 设置页首次进入时不会自动带上一组预置 provider。

这代表当前实现允许用户从空白模型配置开始，而不是默认预置一条聊天主线。

## 第三层：settings workspace secret 状态

### secrets 已经单独成层

settings workspace secrets 与普通状态分文档保存。当前典型 secret 包括：

- provider API key。
- SUSTech CAS 密码。

### 这层继续由主进程直接持有

renderer 不能通过公开快照获得这类值，只能通过专门的受控接口读取、保存或清除。当前主线强调的是“宿主持有敏感真源”，而不是“把敏感值并入页面普通状态”。

### secret 状态与普通状态的关系

设置页会把普通状态与 secret 状态一起水合成可编辑视图，例如 provider profile 上的 `hasApiKey` 一类展示信息，但实际 API key 仍然保存在 secret 文档里。

## 第四层：宿主运行态

### 这层描述的是当前 Python runtime 的运行事实

主进程会构建 hosted runtime 快照，并通过 preload 暴露给 renderer。当前这层状态主要回答：

- hosted backend 处于 `starting`、`ready`、`failed`、`degraded` 还是 `stopped`。
- 当前有没有可用 `runtimeUrl`。
- 当前期望模式与已解析模式分别是什么。
- 最近一次失败发生在什么阶段。

### 这层还持有宿主私桥 bootstrap

主进程还会持有宿主私有 provider route bridge 的 bootstrap 信息，也就是：

- bridge URL。
- bridge token。

这些信息会在启动 Python runtime 时以运行边界参数形式注入，但 provider secrets 本身不会下发给 Python。

## 第五层：renderer 根装配与 run 状态

### 根装配状态是“公开配置 + 运行事实”的合成结果

renderer 启动时会并行读取公开配置快照与 runtime 快照，再合成为 `CopilotConfigState`。当前状态值包括：

- `loading`
- `empty`
- `incomplete`
- `starting`
- `ready`
- `failed`
- `degraded`
- `error`

这层的关键判断仍然围绕 `runtimeUrl` 展开，不再把旧的全局 model 或 agentName 当成聊天 readiness 的硬门槛。

### 聊天面板已经形成独立的 run 状态机

进入聊天分支后，renderer 还会维护一份 run 状态。当前阶段包括：

- `idle`
- `starting`
- `streaming`
- `completed`
- `failed`
- `cancelled`

这份状态主要记录：

- 当前 `runId`
- 当前 `sessionId`
- assistant 占位项 ID
- 本次请求使用的 `activeModelRoute`
- 最终解析得到的 `resolvedModelRoute`
- `resolvedModelId`
- `resolvedToolIds`
- `requestOptions`
- 非敏感诊断信息
- 失败摘要或取消原因

### 当前前端不会等待整包响应后再更新界面

当前聊天面板会在：

- 收到 `run_started` 时建立 assistant 占位项。
- 收到 `text_delta` 时增量拼接文本。
- 收到 `run_completed` 时定稿最终 assistant 文本。
- 收到 `run_failed` 或 `run_cancelled` 时进入对应终态。

因此，页面上的会话视图已经和后端 run 事件流紧密耦合，而不是旧的“一次请求返回一整包 assistant 消息”模型。

## 第六层：会话与消息状态

这层最容易混淆，因为它其实由前后端分开持有。

### 6.1 智能体目录状态来自后端

前端进入可连接状态后，会先调用 `agents/list`。当前目录状态由后端目录给出，前端只做展示增强。目录项至少会包含：

- `agentId`
- `status`
- `displayName`
- `description`
- `recommendedTools`
- `defaultModelPreference`
- `iconKey`

### 6.2 renderer 会话壳只保留在当前窗口内存里

前端当前会在 renderer 内存里维护已创建的会话列表与激活会话。每个会话壳至少会包含：

- `sessionId`
- `boundAgent`
- `createdAt`
- `updatedAt`
- `capabilities`

其中 `capabilities` 会带出工具目录、推荐工具、工具选择模式和默认模型偏好提示。

### 6.3 当前默认发送路径不会自动启用推荐工具

虽然能力面仍然会返回推荐工具和默认偏好提示，但聊天草稿当前默认使用的是空工具数组。工具目录保留在能力面里，发送时是否携带工具，仍由当前消息请求显式决定。

### 6.4 后端正式会话历史保存在 `InMemorySessionStore`

当前 Python runtime 继续按 `sessionId` 持有会话记录。每条会话记录至少保存：

- `session_id`
- `bound_agent_id`
- `metadata`
- `messages`
- `created_at`
- `updated_at`

多轮上下文的正式持有者，当前仍然是后端会话存储。

### 6.5 当前归档规则已经和流式 run 主线对齐

当前归档规则是：

- 流式阶段只累计 assistant 草稿。
- 只有 `run_completed` 到来后，后端才会把 user 文本和最终 assistant 文本一起追加进正式会话历史。
- `run_failed` 不会归档 assistant 成功消息。
- `run_cancelled` 也不会归档 assistant 成功消息。

前端可以继续保留错误项或取消态草稿，用于当前窗口提示；这不等于后端已经把它们写进正式会话历史。

### 6.6 这份历史当前不会跨 runtime 重启保存

因为会话存储仍然是进程内内存结构，所以 runtime 一旦重启，会话历史就会丢失。前端当前也没有一条正式的“按 `sessionId` 回放完整历史”的链路。

### 6.7 聊天面板还有一层页面级临时状态

聊天面板本地还会维护一组更短生命周期的交互状态，例如：

- 输入框草稿文本。
- 当前选中的模型路由。
- 当前启用的工具列表。
- `requestOptions` 文本与解析结果。
- 当前 run 状态。
- 当前窗口里已经显示出来的消息列表。

这层状态只是页面交互所需的临时状态，不等于后端正式会话历史。

## 当前哪些状态会自动更新

### 已经有明确更新链路的状态

下面这些状态当前已经有比较明确的刷新路径：

- 公开配置中心快照会在补丁写回后广播更新。
- 根装配状态会在收到公开快照后重新计算。
- settings workspace 普通状态和 secret 状态会在设置页重新加载或保存后更新。
- 会话壳会在 `session/create` 和 `capabilities/get` 完成后建立或刷新。
- 聊天面板里的 run 状态会随着 [`message/send`](./chat-runtime-contract.md) 事件流持续变化。

### 当前仍然没有完整持续流的状态

下面这些状态还没有形成完整、持续的实时推送：

- hosted runtime 的全部状态变化。
- settings workspace 跨页面、跨窗口的同步更新。
- renderer 会话列表的跨窗口同步。
- 后端完整会话历史的主动回放。

## 当前最容易写错的地方

### 公开配置中心不是聊天执行真源

它保存的是公开、稳定、适合根装配消费的配置事实。聊天执行时真正的 provider 元数据真源和 secret 真源，仍然在 Electron 主进程持有的 settings workspace 体系里。

### `backendExposed.model` 仍然存在，但它已经不是聊天主线模型配置

这个字段还在公开配置结构里，但当前聊天主线不再依赖它来决定 Python runtime 的执行模型，也不会再把它下发为 startup 参数。

### settings workspace 里的 `activeProviderId` 不是聊天总开关

它当前只是设置页交互状态。聊天主线真正使用的目标路由，以每次请求里的 `modelRoute` 为准。

### 前端显示出来的失败项或取消态草稿不等于正式归档消息

当前后端只在 `run_completed` 时把 assistant 文本写入正式会话历史。失败和取消都不会写入 assistant 成功消息。

## 相关文档

- [系统架构总览](./architecture-overview.md)
- [运行时生命周期](./runtime-lifecycle.md)
- [聊天运行时契约](./chat-runtime-contract.md)
- [前端运行时状态参考](../frontend/reference-runtime-states.md)

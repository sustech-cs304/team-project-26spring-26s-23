---
title: 前端现在怎样连接后端
description: 从 renderer 视角说明当前怎样判断连接可用，并进入 session-first 流式聊天主路径。
sidebar_position: 2
sidebar_label: 后端连接契约
---

# 前端现在怎样连接后端

这页只从前端视角说明当前连接链路。系统级 HTTP 方法、请求体、事件集合与错误外壳，已经收口在 [聊天运行时契约](../system/chat-runtime-contract.md)。这里关注的是：renderer 先读哪些输入，怎样判断自己可以继续往下走，连接建立后前端实际会做什么。

## 当前连接链路分成三段

1. 根装配层先判断有没有可用 `runtimeUrl`。
2. 助手工作区再进入“目录、会话、消息”这条 session-first 主路径。
3. 聊天面板在每次发送消息时显式带上模型路由，并用 run 状态机消费流式事件。

## 第一段：根装配层怎样判断可连接

当前前端会先同时读取两类输入：

- 公开配置中心的公共快照。
- 主进程维护的 hosted runtime 快照。

公开配置中心当前仍然包含 `theme`、`animationsEnabled`、`agentName`、`runtimeUrl` 和 `backendExposed.model` 这些公开字段。这里真正影响聊天连接判断的字段，仍然是 `runtimeUrl`。

hosted runtime 快照提供的是宿主当前运行事实，例如：

- 当前状态值。
- 当前可用地址。
- 运行模式。
- 是否处于打包态。
- 最近失败摘要。

根装配层会把这两类输入合并，得到当前 bootstrap 状态。

## 当前 `runtimeUrl` 的选择顺序

前端当前按下面的顺序决定真正使用哪个地址：

1. 宿主已经给出可用 hosted runtime 地址时，优先使用宿主管理的地址。
2. 宿主没有给出可用地址，但当前处于开发模式、不是打包态，而且公开配置中心里已经填写 `runtimeUrl` 时，允许使用开发态 override。
3. 上面两条都不满足时，当前没有可用地址。

可以把这条规则理解成“先看宿主运行事实，再看开发态覆盖地址”。

## `agentName` 和 `backendExposed.model` 在当前连接链路里的位置

`agentName` 仍然保留在公开配置中心里，也会继续进入前端状态对象和诊断摘要。当前聊天 readiness 已经不再依赖它。只要前端拿到了可用 `runtimeUrl`，就可以继续进入后面的 session-first 路径。

`backendExposed.model` 也仍然存在于公开配置结构里，但它已经不是聊天面板每条消息的执行模型来源。当前聊天真正使用的目标路由，取决于每次 [`message/send`](../system/chat-runtime-contract.md) 请求里的 `modelRoute`。

## 第二段：前端怎样进入 session-first 聊天主路径

当前 bootstrap 状态进入可连接分支后，助手工作区会按下面的顺序继续：

1. 调用 `agents/list` 拉取后端智能体目录。
2. 让用户从目录里选择一个智能体。
3. 调用 `session/create` 创建会话，并把当前智能体绑定到这个 `sessionId` 上。
4. 调用 `capabilities/get` 读取这个会话的能力面。

这条路径已经把聊天主线收口为三件事：

- 智能体目录以后端返回为准。
- 会话是聊天过程中的明确边界。
- 工具目录和默认模型偏好先挂在会话能力面上，再进入发送阶段。

## 第三段：模型路由怎样进入消息发送

进入会话后，前端会再读取 settings workspace 状态，用来补齐聊天发送区自己的模型目录与默认路由。

当前聊天模型目录来自 settings workspace 里的两组数据：

- `providerProfiles` 提供可选模型列表。
- `defaultModelRouting.primaryAssistantModel` 提供首选模型 ID。

聊天面板会先把 `providerProfiles` 展开成跨 provider 的模型目录，再尝试用 `primaryAssistantModel` 找到匹配项。匹配成功时，输入区会用它作为当前草稿模型；如果 settings workspace 里还没有任何 provider 或模型，聊天区会保持空白模型状态，并提示用户先去设置页补齐模型服务。

这也是当前一个容易写错的事实：前端聊天模型目录不再依赖静态内置默认模型。首次初始化可以是完全空白的。

## 当前模型语义已经是 `modelRoute`

真正发送消息时，前端会调用 [`message/send`](../system/chat-runtime-contract.md)，并在请求里显式带上：

- `sessionId`
- 可选的 `agent` 校验值
- 当前用户消息
- `policy.modelRoute`
- `policy.enabledTools`
- `policy.requestOptions`

其中 `modelRoute` 已经固定为“稳定 ID + 路由快照”的对象，而不是单一字符串 `model`。这条对象至少包含：

- `providerProfileId`
- `snapshot.provider`
- `snapshot.endpointType`
- `snapshot.baseUrl`
- `snapshot.modelId`

因此，前端当前真正发送给后端的，已经是请求级模型路由，而不是旧的 startup model 或全局 active provider 概念。

## 工具在当前发送链路里的位置

工具选择的来源仍然来自 `capabilities/get` 返回的能力面，但当前默认发送路径不会自动启用推荐工具。前端当前默认使用空工具数组；用户如果显式选择工具，才会把它们带进本次请求。

这意味着：

- 工具目录仍然是正式能力面的一部分。
- 当前流式主线仍然以模型路由、宿主取密钥与文本流为骨架，但已经把真实工具生命周期并入同一条 run 事件流。
- 前端当前已经依赖真实 `tool_event`，并会把同一 `toolCallId` 的 `started`、`completed`、`failed` 更新为聊天消息流中的工具步骤。

## 前端现在怎样消费流式响应

当前 [`message/send`](../system/chat-runtime-contract.md) 不再返回整包 JSON。前端会把响应体当成 `text/event-stream`，并逐条解析 SSE 事件。

当前前端已经可以消费下面这些事件：

- `run_started`
- `tool_event`
- `text_delta`
- `run_completed`
- `run_failed`
- `run_cancelled`
- `run_diagnostic`

对应的页面行为是：

- 收到 `run_started` 时创建 assistant 占位项。
- 收到 `tool_event` 时插入或更新当前 run 的工具步骤。
- 收到 `text_delta` 时增量拼接 assistant 文本。
- 收到 `run_completed` 时定稿最终 assistant 文本，并回填 `resolvedModelRoute` 等结果信息。
- 收到 `run_failed` 或 `run_cancelled` 时进入对应终态，并让未完成工具步骤在页面上收口为失败或取消显示。
- 收到 `run_diagnostic` 时记录非敏感诊断摘要。

## 当前 run 状态机已经进入前端主链

聊天面板当前用一份独立的 run 状态来驱动发送过程。当前阶段包括：

- `idle`
- `starting`
- `streaming`
- `completed`
- `failed`
- `cancelled`

这份状态会记录：

- 当前 `runId`
- 当前 `sessionId`
- 当前 assistant 占位项 ID
- 本次请求使用的 `activeModelRoute`
- 最终回显的 `resolvedModelRoute`
- `resolvedModelId`
- `resolvedToolIds`
- `requestOptions`
- 非敏感诊断信息
- 失败摘要或取消原因

这说明当前前端已经不再按“一次请求换来一整包 assistant 消息”的方式工作，而是把聊天过程真正看成一个 run 生命周期。

## 当前归档和页面展示的关系

当前主线的归档规则是：增量阶段只累积草稿，成功完成才归档 assistant 文本。对应到前端，可以这样理解：

- 页面会在流式阶段展示 assistant 草稿。
- 成功结束后，这条 assistant 文本才与后端正式历史保持一致。
- 失败项和取消态草稿可以继续停留在当前窗口提示层，但它们不代表后端已经把 assistant 成功消息写入正式会话历史。

## 前端当前依赖的最小桥接面

从 renderer 视角看，当前真正依赖的桥接面相对克制：

- 读取、订阅和写回公开配置中心公共快照。
- 读取 hosted runtime 快照，并触发受控 retry。
- 读取和保存 settings workspace 的 state 与 secrets。

前端不会直接持有底层配置文件路径、启动参数、原始日志文件或任意文件系统访问能力。它拿到的是已经过裁剪的 UI 友好接口。

## 当前连接链路里的几条边界

- 首次初始化不会自动生成示例 provider，也不会自动填入默认聊天模型。
- `backendExposed.model` 仍然是公开配置字段，但它已经不是聊天主线模型配置。
- 当前不存在“单一 active provider 决定全部模型集合”的产品语义。
- 前端当前已经正式消费流式事件，而不是只消费非流式完整响应。
- runtime 运行事实当前仍以快照读取和重试后重算为主，前端还没有拿到完整持续推送的运行时流。
- 仓库里保留的 `features/copilot` 等命名当前主要是历史沿用的内部命名空间，不代表前端仍依赖第三方 CopilotKit runtime。

## 当前本地主线验收资产

当前已经有一条可直接用于本地主线验收的脚本，也就是 `frontend-copilot/scripts/smoke-streaming-chat.mjs`。这条脚本会：

1. 从 settings workspace 文档读取 provider profiles 与 secrets。
2. 在本地创建宿主私桥。
3. 拉起 Python runtime。
4. 执行 `session/create`。
5. 执行流式 [`message/send`](../system/chat-runtime-contract.md)，并校验最终事件为 `run_completed`。

这条脚本已经能够覆盖真实 provider、请求级模型路由、宿主取密钥与 `text_delta` 主线。

## 相关文档

- [前端当前 UI 状态](./ui-current-state.md)
- [当前生效字段参考](./reference-current-fields.md)
- [前端运行时状态参考](./reference-runtime-states.md)
- [会话与状态模型](../system/session-and-state-model.md)
- [聊天运行时契约](../system/chat-runtime-contract.md)

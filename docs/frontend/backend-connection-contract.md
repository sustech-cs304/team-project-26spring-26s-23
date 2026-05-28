---
title: 前端现在怎样连接后端
description: 从 renderer 视角说明怎样判断连接可用并进入 thread/run 主链。
sidebar_position: 2
sidebar_label: 后端连接契约
---

# 前端现在怎样连接后端

从前端视角说明连接链路。系统级 HTTP 方法、请求体、事件集合与错误外壳收口在[聊天运行时契约](../system/chat-runtime-contract.md)。这里关注 renderer 先读哪些输入、怎样判断能否继续、连接建立后做什么。

## 连接链路分成三段

1. 根装配层先判断有没有可用 `runtimeUrl`。
2. 助手工作区先进入"目录、thread、run"这条主链。
3. 聊天面板在每次发送消息时显式带上模型路由，并用 run 状态机消费流式事件。

## 第一段：根装配层怎样判断可连接

前端会先同时读取两类输入：

- 公开配置中心的公共快照。
- 主进程维护的 hosted runtime 快照。

公开配置中心包含 `theme`、`animationsEnabled`、`agentName`、`runtimeUrl` 和 `backendExposed.model` 这些公开字段。这里真正影响聊天连接判断的字段是 `runtimeUrl`。

hosted runtime 快照提供宿主运行事实，例如：

- 状态值。
- 可用地址。
- 运行模式。
- 是否处于打包态。
- 最近失败摘要。

根装配层把这两类输入合并，得到 bootstrap 状态。

## `runtimeUrl` 选择顺序

前端按下面的顺序决定真正使用哪个地址：

1. 宿主已经给出可用 hosted runtime 地址时，优先使用宿主管理的地址。
2. 宿主没有给出可用地址，但处于开发模式、不是打包态，而且公开配置中心里已经填写 `runtimeUrl` 时，允许使用开发态 override。
3. 上面两条都不满足时，没有可用地址。

这条规则是"先看宿主运行事实，再看开发态覆盖地址"。

## `agentName` 和 `backendExposed.model` 在连接链路中的位置

`agentName` 仍然保留在公开配置中心里，也会继续进入前端状态对象和诊断摘要。聊天 readiness 不再依赖它。只要前端拿到了可用 `runtimeUrl`，就可以继续进入 thread/run 主链。

`backendExposed.model` 也存在于公开配置结构里，但它已经不是聊天面板每条消息的执行模型来源。聊天使用的目标路由取决于每次 `run/start` 的 `modelRoute`；兼容入口 [`message/send`](../system/chat-runtime-contract.md) 会映射到同一语义。

## 第二段：前端怎样进入 thread/run 聊天主链

bootstrap 状态进入可连接分支后，助手工作区按下面的顺序继续：

1. 调用 `agents/list` 拉取后端智能体目录。
2. 让用户从目录里选择一个智能体。
3. 调用 `thread/create` 创建 thread，并把智能体绑定到这个 `threadId` 上。
4. 需要能力面时，调用 `thread/get` 读取该 thread 的能力投影。

这条路径把聊天主线收口为三件事：

- 智能体目录以后端返回为准。
- thread 是聊天过程中的明确边界。
- 工具目录和默认模型偏好先挂在 thread 能力面上，再进入发送阶段。

`session/create` 与 `capabilities/get` 仍然可用，但属于兼容壳；它们的底层对象是同一条 thread 记录。

## 第三段：模型路由怎样进入消息发送

进入会话后，前端再读取 settings workspace 状态，用来补齐聊天发送区的模型目录与默认路由。

聊天模型目录来自 settings workspace 里的两组数据：

- `providerProfiles` 提供可选模型列表。
- `defaultModelRouting.primaryAssistantModel` 提供首选模型 ID。

聊天面板先把 `providerProfiles` 展开成跨 provider 的模型目录，再尝试用 `primaryAssistantModel` 找到匹配项。匹配成功时，输入区用它作为草稿模型；如果 settings workspace 里还没有任何 provider 或模型，聊天区保持空白模型状态，并提示用户先去设置页补齐模型服务。

请注意：前端聊天模型目录不再依赖静态内置默认模型。首次初始化可以是完全空白的。

## 模型语义是 `modelRoute`

真正发送消息时，前端主链调用 `run/start`，并在请求里显式带上：

- `threadId`
- 可选的 `agent` 校验值
- 用户消息
- `policy.modelRoute`
- `policy.enabledTools`
- `policy.requestOptions`

兼容入口 [`message/send`](../system/chat-runtime-contract.md) 把 `sessionId` 映射到同一 thread/run 语义。

其中 `modelRoute` 是"稳定 ID + 路由快照"的对象，而不是单一字符串 `model`。这条对象至少包含：

- `providerProfileId`
- `snapshot.provider`
- `snapshot.endpointType`
- `snapshot.baseUrl`
- `snapshot.modelId`

前端发送给后端的是请求级模型路由，而不是旧的 startup model 或全局 active provider 概念。

## 工具在发送链路中的位置

工具选择的来源来自 `thread/get` 或兼容入口 `capabilities/get` 返回的能力面，但默认发送路径不会自动启用推荐工具。前端默认使用空工具数组；用户如果显式选择工具，才会带进本次请求。

这意味着：

- 工具目录是正式能力面的一部分。
- 请求层只通过 `enabledTools` 传本轮启用工具 ID，不回传工具定义快照。
- 流式主线以模型路由、宿主取密钥与文本流为骨架，但已经把真实工具生命周期并入同一条 run 事件流。
- 前端依赖真实 `tool_event`，并把同一 `toolCallId` 的 `started`、`completed`、`failed` 更新为聊天消息流中的工具步骤。

## 前端怎样消费流式响应

主链通过 `run/stream` 消费 `text/event-stream`，兼容层 [`message/send`](../system/chat-runtime-contract.md) 也会返回同一事件语义。前端逐条解析 SSE 事件。

前端可以消费下面这些事件：

- `run_started`
- `run_metadata`
- `tool_event`
- `text_delta`
- `reasoning_delta`
- `run_completed`
- `run_failed`
- `run_cancelled`
- `run_diagnostic`

对应的页面行为：

- 收到 `run_started` 时创建 assistant 占位项，附带 thinking 元数据。
- 收到 `run_metadata` 时更新 thinking 元数据快照。
- 收到 `tool_event` 时插入或更新 run 的工具步骤。
- 收到 `text_delta` 时增量拼接 assistant 文本。
- 收到 `reasoning_delta` 时增量拼接推理链文本，并在推理压制生效时剥离推理段。
- 收到 `run_completed` 时定稿最终 assistant 文本，并回填 `resolvedModelRoute` 等结果信息。
- 收到 `run_failed` 或 `run_cancelled` 时进入对应终态，未完成工具步骤收口为失败或取消显示。
- 收到 `run_diagnostic` 时记录非敏感诊断摘要。

## run 状态机进入前端主链

聊天面板用一份独立的 run 状态来驱动发送过程。阶段包括：

- `idle`
- `starting`
- `streaming`
- `awaiting_input`
- `completed`
- `failed`
- `cancelled`

这份状态记录：

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
- `reasoningTraceState`
- 非敏感诊断信息
- 失败摘要或取消原因

前端不再按"一次请求换来一整包 assistant 消息"的方式工作，而是把聊天过程看成一个 run 生命周期。

## 归档与页面展示的关系

主线的归档规则是：增量阶段只累积草稿，成功完成才归档 assistant 文本。对应到前端：

- 页面在流式阶段展示 assistant 草稿。
- 成功结束后，这条 assistant 文本才与后端正式历史保持一致。
- 失败项和取消态草稿可以继续停留在提示层，但它们不代表后端已经把 assistant 成功消息写入正式会话历史。

## 前端依赖的最小桥接面

从 renderer 视角看，前端依赖的桥接面相对克制：

- 读取、订阅和写回公开配置中心公共快照。
- 读取 hosted runtime 快照，并触发受控 retry。
- 读取和保存 settings workspace 的 state 与 secrets。

前端不会直接持有底层配置文件路径、启动参数、原始日志文件或任意文件系统访问能力。它拿到的是已经过裁剪的 UI 友好接口。

## 连接链路的边界

- 首次初始化不会自动生成示例 provider，也不会自动填入默认聊天模型。
- `backendExposed.model` 仍然是公开配置字段，但它已经不是聊天主线模型配置。
- 不存在"单一 active provider 决定全部模型集合"的产品语义。
- 前端已经正式消费流式事件，而不是只消费非流式完整响应。
- runtime 运行事实仍以快照读取和重试后重算为主，前端还没有拿到完整持续推送的运行时流。
- 仓库里保留的 `features/copilot` 等命名主要是历史沿用的内部命名空间，不代表前端仍依赖第三方 CopilotKit runtime。

## 本地主线验收资产

smoke 资产是双轨：

1. `frontend-copilot/scripts/smoke-thread-run-chat.mjs` 覆盖 thread/run 主链。
2. `frontend-copilot/scripts/smoke-streaming-chat.mjs` 覆盖兼容壳。

两条脚本都会读取 settings workspace、创建宿主私桥并拉起 Python runtime。thread/run smoke 直接验证 `thread/create → run/start → run/stream`，并可选覆盖 `run/cancel`；compat smoke 继续验证 `session/create → message/send`。

当脚本启用 `--enable-weather-tool` 时，校验真实工具闭环，要求事件序列包含 `run_started → tool_event(started) → tool_event(completed) → text_delta → run_completed`。首刀真实工具是 `tool.weather-current`，内建随机天气占位工具，不依赖外部天气 API。

## chain debug 入口

调试开关是环境变量 `COPILOT_RUNTIME_CHAIN_DEBUG`。开启后，后端输出 collector 选择、raw tool-call 观察、工具生命周期与终态收口日志。thread/run smoke 与 compat smoke 都支持联动这个开关，用于复盘 text → tool → text 交错链。

## 相关文档

- [前端当前 UI 状态](./ui-current-state.md)
- [当前生效字段参考](./reference-current-fields.md)
- [前端运行时状态参考](./reference-runtime-states.md)
- [会话与状态模型](../system/session-and-state-model.md)
- [聊天运行时契约](../system/chat-runtime-contract.md)

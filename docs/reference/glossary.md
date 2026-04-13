---
title: 术语表
description: 统一解释当前站点里的关键术语，避免在不同页面里各写一套说法。
sidebar_position: 1
---

# 术语表

- 这页给谁看：在阅读站点时经常遇到术语，但不确定它们现在具体指什么的使用者和开发者。
- 这页解决什么问题：把高频术语收口成一份统一解释，减少首页、使用者页、开发者页之间的口径漂移。
- 当前覆盖到哪：先覆盖这一阶段最关键的术语，包括聊天主链、模型路由、配置分层、thinking 和运行时事件。
- 当前状态：已可用。

这页只做一件事：把词解释清楚。它不是教程页，也不代替架构页。

## 主链相关术语

| 术语 | 现在的意思 |
| --- | --- |
| thread | 一条对话主容器。它在创建时绑定智能体，后续一轮轮 run 都挂在这条 thread 下。 |
| run | thread 内的一次执行。一次 `run/start` 发起，一条 `run/stream` 事件流返回，最终会进入完成、失败或取消中的一个终态。 |
| thread/run 主链 | 当前聊天的正式主链。文档和实现都应优先按这条链理解，而不是按旧的 `session/create`、`message/send` 主链理解。 |
| 兼容壳 | 仍然保留、但不再承担主语义的旧方法层。当前主要指 `session/create`、`capabilities/get`、`message/send` 这组投影接口。 |

## 模型与 Provider 相关术语

| 术语 | 现在的意思 |
| --- | --- |
| provider catalog | 项目共享的 provider 清单。它定义 providerId、endpointType、authSchema、runtimeStatus、能力提示等公共事实。 |
| provider profile | 用户在 settings workspace 里保存的一条具体 provider 配置。它会引用某个 provider catalog 条目，并带上实际可用的模型、地址和 secret 状态。 |
| model route | 运行时要走哪条模型路径的稳定引用。请求体里的 `modelRoute` 以 `routeRef` 为核心，要求 `routeRef.profileId + modelId`，并可选带 `catalogRevision`；`routeRef` 的主形态是 `provider-model`。 |
| 默认模型路由 | settings workspace 里保存的首选模型路由，例如主助手模型路由。它提供默认值，但不代替每次请求显式携带的 route。 |
| 请求级模型路由 | 每次 `run/start` 或兼容层消息请求里显式带上的模型路由。真正执行哪条 route，最终以这一步为准。 |
| resolved route | 宿主完成 route 解析后，运行时真正拿到的执行信息。它会补齐 provider、baseUrl、认证方式等执行所需字段，也可能重复携带 `providerProfileId` 这类已解析标识。 |
| host model route bridge | 宿主侧私有解析桥。它负责把请求里的 route 解析成 runtime 可执行的 resolved route，并在边界内注入私有认证信息。 |

## 配置分层相关术语

| 术语 | 现在的意思 |
| --- | --- |
| 公开配置快照 | Electron 主进程投影给 renderer 的非敏感配置视图。它适合做根装配判断，但不是 provider secret 的真源。 |
| settings workspace | Electron 主进程持有的设置工作区。它按普通状态和 secret 状态分层保存，是 provider profile、默认模型路由和大部分设置项的真源。 |
| secret 状态 | settings workspace 里专门保存敏感值的一层，例如 provider API key。它不会并入公开快照。 |
| 宿主运行态 | Electron 主进程对 Python runtime 当前状态的快照，例如 `starting`、`ready`、`failed`、`degraded`。 |

## Thinking 相关术语

| 术语 | 现在的意思 |
| --- | --- |
| thinking | 当前模型推理控制与可见推理信息的总称。它已经是现有能力的一部分，不再按旧 intent / 档位叙事单独理解。 |
| thinkingSelection | 请求里显式带上的 thinking 选择。它按 `series + value` 组织，而不是旧的单字段 intent。 |
| thinking capability | 某条模型路由当前支持怎样的 thinking 选择。它可以单独查询，也会在 run 元数据里留下快照。 |
| thinking series | 一组可选值的定义模板。例如“思考开关”“四档思考”“思考预算”都属于不同 series。 |
| requestedThinkingSelection | 本次请求原始提出的 thinking 选择。 |
| appliedThinkingSelection | 运行时最终真正应用的 thinking 选择。它可能和请求值相同，也可能被调整。 |
| thinkingSeriesDecision | 运行时在本次路由上如何解释、接受、调整或拒绝这次 thinking 选择的公开结果。 |
| reasoningSuppressionBasis | 为什么当前没有展示可见 reasoning，或为什么只保留部分信息的说明依据。 |

## 运行时事件相关术语

| 术语 | 现在的意思 |
| --- | --- |
| run event stream | `run/stream` 返回的 SSE 事件流。它会按顺序把本轮执行过程推送给前端。 |
| run_started | 一轮 run 的开始事件。事件流必须先从它开始。 |
| run_metadata | 一轮 run 的元数据事件。当前常用于回传模型路由、thinking 快照和其他非文本信息。 |
| text_delta | assistant 正文的文本增量事件。界面会按流式方式拼接。 |
| reasoning_delta | 可见 reasoning 的增量事件。只有当前路由和展示策略允许时才会出现。 |
| tool_event | 工具生命周期事件。当前至少会区分 started、completed、failed。 |
| terminal event | 一轮 run 的终态事件。当前只包括 `run_completed`、`run_failed`、`run_cancelled`。 |

## 什么时候应该继续读别的页面

- 你想看模型路由的完整链路，请读[Provider 与模型路由说明](./providers-and-routing.md)。
- 你想看 thinking 现在怎样请求，请读[Thinking 能力说明](./thinking.md)。
- 你想看能力边界，请读[能力边界 / 状态总表](./capabilities.md)。
- 你想看接口和事件，请读[运行时接口 / 事件参考](./runtime-events.md)。

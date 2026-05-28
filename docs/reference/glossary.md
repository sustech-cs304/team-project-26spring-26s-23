---
title: 术语表
description: 集中解释本站的关键术语。
sidebar_position: 1
---

# 术语表

## 聊天主链

| 术语 | 意思 |
| --- | --- |
| thread | 一条对话。创建时绑定一个智能体，后续的每次运行（run）都属于这个 thread。 |
| run | thread 里的一次执行。用 `run/start` 发起，用 `run/stream` 接收事件流，最终进入完成、失败或取消三种终态之一。 |
| thread/run 主链 | 聊天的主流程：先创建 thread，再发起 run。旧的 `session/create`、`message/send` 方式虽然还能用，但已经不作为主流程推荐。 |
| 兼容壳 | 旧接口的兼容层。`session/create`、`capabilities/get`、`message/send` 这三个方法仍然能用，但内部已经映射到 thread/run 主链上。 |

## 模型与 Provider

| 术语 | 意思 |
| --- | --- |
| provider catalog | 项目自带的 provider 清单，定义了每个模型服务商（如 OpenAI、Anthropic）的公共信息：ID、接入方式、认证方式、能力提示等。存放在 `provider-catalog/registry.json`。 |
| provider profile | 用户在设置页里保存的一条具体模型服务配置。它引用 provider catalog 中的某个服务商，填上自己的地址、模型列表和 API Key。 |
| model route | 一次聊天请求要走哪条模型路径。请求里用 `modelRoute` 指定，核心是 `profileId + modelId`，表示“用哪个配置下的哪个模型”。 |
| 默认模型路由 | 设置页里保存的默认模型路径（如“主助手模型”）。它只提供默认值，不影响每次请求显式指定的模型。 |
| 请求级模型路由 | 每次 `run/start` 请求里显式携带的模型路径。最终执行以这个为准。 |
| host model route bridge | Electron 主进程提供的模型路由解析服务。它检查请求里的模型配置是否存在、API Key 是否可用，然后把执行所需的信息交给 Python 后端。 |

## 配置分层

| 术语 | 意思 |
| --- | --- |
| 公开配置快照 | Electron 主进程暴露给前端界面的非敏感配置。适合做启动判断，但不包含 API Key 等敏感信息。 |
| settings workspace | Electron 主进程持有的设置工作区，分成普通状态和秘密状态两层。provider profile、默认模型路由和大部分设置项都保存在这里。 |
| secret 状态 | 专门存敏感值的一层，比如 provider 的 API Key、CAS 密码。不会进入公开快照。 |
| 宿主运行态 | Electron 主进程对 Python 后端的运行状态快照，例如 `starting`、`ready`、`failed`、`degraded`。 |

## Thinking

| 术语 | 意思 |
| --- | --- |
| thinking | 模型推理控制与可见推理信息的总称。用 `series + value` 的方式选择，不再用旧的 intent 字段。 |
| thinkingSelection | 请求里携带的 thinking 选项，格式为 `series + value`。例如 `series: "level", value: "high"`。 |
| thinking capability | 某条模型路由支持哪些 thinking 选项。可以单独查询，也会在 run 的元数据里留下快照。 |
| thinking series | 一组可选值的模板。比如“思考开关”、“四档思考”、“思考预算”各是一个 series。 |
| appliedThinkingSelection | 运行时最终实际应用的 thinking 选项，可能与请求值不同。 |
| reasoningSuppressionBasis | 为什么没有展示可见推理过程，或为什么只展示了部分信息的说明。 |

## 运行时事件

| 术语 | 意思 |
| --- | --- |
| run event stream | `run/stream` 返回的 SSE 事件流，按顺序把一轮执行过程推送给前端。 |
| run_started | 一轮 run 开始。事件流必须以它开头。 |
| run_metadata | run 的元数据，通常携带模型路由、thinking 快照等信息。 |
| text_delta | 助手回复文字的增量片段，前端按流式方式拼接。 |
| reasoning_delta | 可见推理过程的增量片段，由运行时统一通过 `reasoning_delta` 事件处理。是否出现取决于模型/Provider 的 API 是否输出推理内容。 |
| tool_event | 工具调用生命周期事件，区分 `started`、`waiting_approval`、`completed`、`failed` 等阶段。 |
| terminal event | 一轮 run 的终态事件，只能是 `run_completed`、`run_failed`、`run_cancelled` 之一。 |

## 继续阅读

- [Provider 与模型路由说明](./providers-and-routing.md) — 模型路由的完整链路
- [Thinking 能力说明](./thinking.md) — 如何请求和使用 thinking
- [能力边界 / 状态总表](./capabilities.md) — 各功能当前做到哪一步
- [运行时接口 / 事件参考](./runtime-events.md) — 接口和事件详细信息

---
title: 运行时接口 / 事件参考
description: 面向站点读者说明当前控制面端点、运行时方法、SSE 事件和兼容壳的关系。
sidebar_position: 4
---

# 运行时接口 / 事件参考

- 这页给谁看：需要理解当前 runtime 暴露面、方法集合和事件语义的开发者，也适合需要查边界的高级使用者。
- 这页解决什么问题：把控制面端点、`POST /` 方法分发、run 事件流和兼容壳的关系放在一页里统一说明。
- 当前覆盖到哪：覆盖当前代码与测试已经落地的主接口和事件，不把退役方法和旧整包响应模型继续写成主路径。
- 当前状态：已可用。

## 先说结论

当前运行时暴露面可以分成三层：

1. 控制面端点。
2. `POST /` 下的方法分发。
3. `run/stream` 返回的 SSE 事件流。

真正的聊天主链已经围绕 `thread/run` 组织。`session/create`、`capabilities/get`、`message/send` 还在，但现在是兼容壳。

## 控制面端点

| 路径 | 主要用途 | 当前状态 |
| --- | --- | --- |
| `GET /health` | 最小健康检查，更适合回答“进程还活着吗”。 | 已可用 |
| `GET /ready` | 读取启动是否收口，以及当前是否 ready。 | 已可用 |
| `GET /version` | 读取版本、Python 版本、模式和 base URL。 | 已可用 |
| `GET /build-info` | 当前与 `GET /version` 返回同形信息。 | 已可用 |
| `GET /diagnostics` | 读取更完整的运行目录、状态目录、日志目录和配置摘要。 | 已可用 |
| `GET /diagnostics/runtime-info` | 当前与 `GET /diagnostics` 返回同形信息。 | 已可用 |

需要注意的一点是：如果 runtime 配了 local token，诊断端点需要带 `X-Local-Token`。这个保护范围只覆盖 diagnostics，不是聊天主链的认证方式。

## `POST /` 方法分发

聊天相关请求统一走根路径 `POST /`，再靠请求体里的 `method` 字段分发。

当前推荐结构如下：

```json
{
  "method": "run/start",
  "body": {
    "...": "..."
  }
}
```

主路径现在不再依赖顶层旧兼容写法。

## 当前主方法总表

| 方法 | 主要作用 | 当前状态 |
| --- | --- | --- |
| `agents/list` | 读取当前 runtime 暴露的智能体目录。 | 已可用 |
| `thread/create` | 创建 thread，并在创建时绑定智能体。 | 已可用 |
| `thread/get` | 读取 thread 视图和能力面。 | 已可用 |
| `run/start` | 发起一轮 run，显式携带消息、模型路由、thinking 和工具策略。 | 已可用 |
| `run/stream` | 读取这轮 run 的 SSE 事件流。 | 已可用 |
| `run/cancel` | 取消一轮 run。 | 已可用 |
| `capabilities/get` | 兼容读取能力面的投影方法。 | 部分接通 |
| `thinking/capability/get` | 查询当前模型路由的 thinking capability。 | 已可用 |

## 兼容壳现在怎么理解

| 兼容方法 | 现在对应什么 | 当前状态 |
| --- | --- | --- |
| `session/create` | `thread/create` 的兼容投影。 | 部分接通 |
| `capabilities/get` | `thread/get` 能力面的兼容投影。 | 部分接通 |
| `message/send` | `run/start + run/stream` 的兼容封装。 | 部分接通 |

下面这些旧方法已经退役，不应再继续写成当前 surface：

- `info`
- `agent/connect`
- `agent/run`

## run 事件流的基本规则

当前 run 事件流有几条最值得先记住的规则：

1. 事件流必须先从 `run_started` 开始。
2. 中间可以出现元数据、文本、reasoning、工具和诊断事件。
3. 最后必须收口到一个终态事件。
4. 终态事件只包括 `run_completed`、`run_failed`、`run_cancelled`。

## 当前事件类型总表

| 事件类型 | 作用 | 当前状态 |
| --- | --- | --- |
| `run_started` | 说明这轮 run 已经开始，前端通常会据此建立 assistant 占位项。 | 已可用 |
| `run_metadata` | 回传模型路由、thinking 快照等非正文元数据。 | 已可用 |
| `text_delta` | 增量返回 assistant 正文文本。 | 已可用 |
| `reasoning_delta` | 增量返回可见 reasoning 文本。 | 部分接通 |
| `tool_event` | 返回工具调用生命周期，例如 started、completed、failed。 | 已可用 |
| `run_diagnostic` | 返回调试或诊断信息。 | 已可用 |
| `run_completed` | 说明这轮 run 成功结束，并给出最终成功终态。 | 已可用 |
| `run_failed` | 说明这轮 run 失败结束。 | 已可用 |
| `run_cancelled` | 说明这轮 run 被取消。 | 已可用 |

## 这些事件对界面意味着什么

当前界面主线不是“等一整包响应回来再一次性渲染”，而是：

- 先等 `run_started`。
- 再持续消费 `text_delta`。
- 如果当前路由允许，也可能看到 `reasoning_delta`。
- 如果本轮调用了工具，还会看到 `tool_event`。
- 最后用一个终态事件收口。

这就是为什么现在更适合把聊天理解成 run 事件流，而不是旧的一次请求返回整包消息。

## 当前归档规则该怎么记

当前更合适的记法是：

- `run_completed` 才会把 user 文本和最终 assistant 文本作为成功结果归档。
- `run_failed` 不会把 assistant 成功消息写成正式成功历史。
- `run_cancelled` 也不会把 assistant 成功消息写成正式成功历史。

这能帮助你区分“页面里看到了临时草稿”和“后端已经把它当成正式成功历史保存”。

## 什么时候最该看这页

- 你想判断当前正式方法集合。
- 你想确认 `message/send` 现在是不是主链。
- 你在读前端或后端代码，但不确定某个事件是什么时候出现的。
- 你想知道 thinking 和工具生命周期是怎样进入 run 流的。

## 相关页面

- [术语表](./glossary.md)
- [Provider 与模型路由说明](./providers-and-routing.md)
- [Thinking 能力说明](./thinking.md)
- [能力边界 / 状态总表](./capabilities.md)
- [聊天运行时契约](../system/chat-runtime-contract.md)

---
title: 聊天运行时
description: 面向开发者说明 thread/run 主链、兼容壳位置、流式事件与工具步骤怎样贯穿当前聊天实现。
sidebar_position: 3
---

# 聊天运行时

- 这页给谁看：准备修改聊天主链、运行时协议、流式事件处理或消息渲染的开发者。
- 这页解决什么问题：把当前 `thread/run` 主链、兼容壳、事件流和关键代码落点收成一页。
- 当前覆盖到哪：覆盖当前聊天主链和其前后端对应关系；完整方法与事件表继续收口到共享事实页。
- 当前状态：`thread/run` 主链已可用；兼容壳仍可使用但只属于部分接通层。

先说结论：当前聊天主线已经明确是 **`agents/list → thread/create → thread/get → run/start → run/stream → run/cancel`**。`session/create`、`capabilities/get`、`message/send` 还在，但现在应该把它们理解成兼容投影，而不是继续围绕它们设计新主语义。

## 先记住主链顺序

| 步骤 | 谁发起 | 作用 | 当前状态 |
| --- | --- | --- | --- |
| `agents/list` | 前端 | 读取当前可用智能体目录。 | 已可用 |
| `thread/create` | 前端 | 创建 thread，并在创建时绑定智能体。 | 已可用 |
| `thread/get` | 前端 | 读取这条 thread 的能力面。 | 已可用 |
| `run/start` | 前端 | 发起一轮 run，显式带上消息、模型路由、Thinking 与工具策略。 | 已可用 |
| `run/stream` | 前端 | 消费这轮 run 的 SSE 事件流。 | 已可用 |
| `run/cancel` | 前端 | 取消这轮 run。 | 已可用 |

## 兼容壳现在处在什么位置

当前仍保留三条兼容方法：

- `session/create`
- `capabilities/get`
- `message/send`

更准确的理解是：

- `session/create` 对应 `thread/create`。
- `capabilities/get` 对应 `thread/get` 的能力投影。
- `message/send` 对应 `run/start + run/stream` 的兼容封装。

所以当前新增功能、修文档或查主链问题时，应该先回到 `thread/run`，再看兼容层有没有同步映射。

## 一轮 run 到底发生了什么

### 1. 前端准备请求

前端会在发送前准备这些输入：

- 当前 `threadId`
- 用户消息
- 模型路由
- Thinking 选择
- 启用工具列表
- 请求选项

Provider、route、Thinking 的完整事实请分别看：

- [Provider 与模型路由说明](../reference/providers-and-routing.md)
- [Thinking 能力说明](../reference/thinking.md)

### 2. 运行时按需解析 route

真正执行前，Python runtime 会通过宿主边界解析本次 route。这里要特别注意：

- route 解析发生在执行阶段。
- secret 仍留在宿主侧。
- Python runtime 拿到的是本轮执行所需的最小结果。

### 3. `run/stream` 开始返回事件

前端当前不会等待整包响应，而是按事件流推进界面。最常见的事件包括：

- `run_started`
- `run_metadata`
- `text_delta`
- `reasoning_delta`
- `tool_event`
- `run_completed`
- `run_failed`
- `run_cancelled`

事件完整表和终态规则继续收口在[运行时接口 / 事件参考](../reference/runtime-events.md)。

### 4. 前端按 run 生命周期更新界面

当前前端主线会：

1. 收到 `run_started` 后建立 assistant 占位项。
2. 收到 `text_delta` 后增量拼接文本。
3. 收到 `tool_event` 后更新工具步骤。
4. 收到终态事件后收口本轮 run。

这就是为什么当前聊天问题常常要同时看前端合同和后端事件编码，而不能只盯一个请求函数。

## 工具步骤现在怎么走

当前工具相关语义也已经进入主链：

- 工具目录来自能力面。
- 本轮启用哪些工具，由请求显式带上。
- 工具真正执行时，会在同一条 run 事件流里发出 `tool_event`。

从开发者角度，最重要的是把这三层分清，而不是把工具调用再塞回旧整包响应模型里。

## 当前最值得先看的代码入口

| 主题 | 推荐入口 |
| --- | --- |
| 前端 `thread/run` 合同 | `frontend-copilot/src/features/copilot/thread-run-contract.ts` |
| SSE 消费与消息流处理 | `frontend-copilot/src/features/copilot/runtime-message-stream.ts` |
| run 片段归并与视图模型 | `frontend-copilot/src/features/copilot/run-segment-reducer.ts`、`run-segment-view-model.ts` |
| 聊天面板 UI | `frontend-copilot/src/features/copilot/CopilotChatPanel.tsx` |
| 后端方法分发 | `backend/app/copilot_runtime/router.py` |
| run 编排 | `backend/app/copilot_runtime/message_runs.py` |
| 事件编码 | `backend/app/copilot_runtime/run_events.py` |
| 兼容投影 | `backend/app/copilot_runtime/legacy_event_projection.py` |

## 当前排查聊天问题时的顺序

### 先判断是不是主链问题

如果问题发生在 `thread/create`、`run/start`、`run/stream` 其中一段，优先按主链排查。

### 再判断是不是兼容层映射问题

如果只有 `message/send` 失常，而主链正常，优先看兼容封装，不要反过来怀疑主链。

### 最后再看共享事实页

如果症状像“模型不匹配”“Thinking 选项异常”“事件理解不一致”，分别回到共享事实页统一口径。

## 建议接着读什么

- 想理解状态 owner，读[配置与状态模型](./config-and-state.md)。
- 想深入前端消息处理，读[前端实现](./frontend.md)。
- 想深入 Python 运行时编排，读[后端实现](./backend.md)。
- 想查完整事件定义，读[运行时接口 / 事件参考](../reference/runtime-events.md)。

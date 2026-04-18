---
title: 配置与状态模型
description: 说明公开配置、settings workspace、secret 状态、宿主运行态、页面 run 状态和后端存储之间的当前关系。
sidebar_position: 4
---

# 配置与状态模型

- 这页给谁看：准备修改设置页、运行态装配、模型默认值或状态流转逻辑的开发者。
- 这页解决什么问题：说明当前有哪些状态层、分别由谁持有、什么时候会被前端或后端消费。
- 当前覆盖到哪：覆盖当前主链上最关键的配置与状态层，不展开所有字段细表。
- 当前状态：双层配置与主状态流已可用；跨窗口同步和历史恢复仍有部分接通或规划中边界。

先说结论：当前系统已经不是“一份 settings 文件 + 一份前端本地状态”的简单结构。更准确的理解是：**公开配置、settings workspace 普通状态、settings workspace secret 状态、宿主运行态、renderer 页面状态、后端 thread/run 存储各有 owner。**

## 先看状态分层表

| 状态层 | 主要 owner | 主要作用 | 当前状态 |
| --- | --- | --- | --- |
| 公开配置快照 | Electron 主进程 | 给 renderer 根装配提供公开、稳定、非敏感配置。 | 已可用 |
| settings workspace 普通状态 | Electron 主进程 | 保存 provider profiles、默认模型和设置页普通字段。 | 已可用 |
| settings workspace secret 状态 | Electron 主进程 | 保存 API key、密码等敏感值。 | 已可用 |
| 宿主运行态 | Electron 主进程 | 描述 Python runtime 当前是 starting、ready、failed 还是 degraded。 | 已可用 |
| renderer 页面状态 | 前端工作台 | 保存当前窗口的装配状态、run 状态、输入草稿和局部 UI 状态。 | 已可用 |
| 后端 thread/run 存储 | Python runtime + SQLite | 保存 thread、run、事件日志、projection 和历史快照。 | 已可用 |
| 本地聊天历史恢复 | Python runtime + desktop history query | 可在重启后恢复 thread 列表、时间线和基础 run replay。 | 已可用 |
| 跨设备 / 云端历史同步 | 当前未形成稳定主线 | 不能默认它已经存在。 | 规划中 |

## 公开配置快照负责什么

公开配置快照适合被理解成“根装配输入”，不是“所有设置的真源”。

它主要服务这些场景：

- 启动时决定主题和基础外观。
- 帮 renderer 判断当前有没有可用的运行时地址。
- 提供少量适合公开投影的宿主信息。

如果你在改的是 provider profile、API key、默认模型，通常不应该先去找公开配置快照。

## settings workspace 为什么是当前配置主线

settings workspace 才是当前设置工作区的主线。它至少分成两层：

### 普通状态

这一层保存：

- provider profiles
- 默认模型路由
- 各类设置页普通字段

### secret 状态

这一层保存：

- provider API key
- 其他敏感凭据

最关键的结论是：**普通状态和 secret 状态都由 Electron 主进程持有。** Python runtime 不直接读取这些文档。

## Provider 相关状态最容易写错的地方

### `activeProviderId` 不是聊天总开关

当前页面里可能仍有选中项、焦点项或列表上下文，但聊天真正走哪条模型路由，不由“切一个 active provider”单独决定。

更准确的理解是：

- catalog 负责共享目录事实。
- profile 负责用户自己的配置。
- route 负责本次默认值或请求值。

完整口径请看[Provider 与模型路由说明](../reference/providers-and-routing.md)。

### 默认模型是默认值，不是唯一执行真相

默认模型路由会影响聊天草稿初始选择，但真正执行时，仍以本次请求显式携带的 route 为准。

## 宿主运行态是怎样进入前端的

当前 Electron 主进程会整理 hosted runtime 快照，再通过 preload 暴露给 renderer。对前端来说，这层状态最重要的作用是回答：

- runtime 当前有没有 ready。
- 当前有没有可用地址。
- 最近失败发生在哪个阶段。

这层状态帮助前端决定显示启动中、可用、失败还是降级分支。

## renderer 页面状态当前包括什么

进入前端后，至少有两组你会经常碰到的状态：

### 根装配状态

它用来判断当前页面处于：

- loading
- starting
- ready
- failed
- degraded
- empty
- incomplete
- error

### run 状态

它用来描述当前这轮聊天是否处在：

- idle
- starting
- streaming
- completed
- failed
- cancelled

这一层状态更多服务当前窗口内的体验，不等于后端正式历史。

## 后端存储层现在保存什么

当前 Python runtime 已经以 `thread/run` 为主模型保存：

- thread truth 记录
- run truth 记录
- run 事件日志
- thread / run projection cache
- 历史模型、工具与 Thinking snapshot
- 成功归档后的正式消息结果

这份历史现在已经可以跨 runtime / application 重启在本地恢复。但要特别保守的一点是：**当前恢复能力仍然是单机本地 SQLite 语境。** 所以不要把当前系统写成已经具备跨设备同步、云端历史管理或全局 retention / search 能力。

## 配置和状态最常见的三条流转

### 1. 设置保存流

用户在设置页保存内容后，Electron 主进程分别写普通状态和 secret 状态，前端再重新加载或水合它们。

### 2. 启动装配流

renderer 启动时会同时读取公开配置快照和宿主运行态，再决定进入哪个装配分支。

### 3. 聊天执行流

聊天发送时，前端从 settings workspace 取默认值或可选项，真正执行时再显式把 route、Thinking 和工具策略带进请求。

## 当前建议从哪些代码入口开始看

| 主题 | 推荐入口 |
| --- | --- |
| 公开配置中心 | `frontend-copilot/electron/config-center/` |
| settings workspace | `frontend-copilot/electron/settings-workspace/` |
| 宿主运行态 | `frontend-copilot/electron/runtime/` |
| 根装配 | `frontend-copilot/src/CopilotAppRoot.tsx` |
| 设置工作区前端状态 | `frontend-copilot/src/workbench/settings/` |
| 聊天页面状态 | `frontend-copilot/src/features/copilot/` |
| 后端聊天持久化 | `backend/app/copilot_runtime/persistence/` |

## 建议接着读什么

- 想读前端入口，继续看[前端实现](./frontend.md)。
- 想读后端状态与存储落点，继续看[后端实现](./backend.md)。
- 想统一 Provider 和 route 口径，读[Provider 与模型路由说明](../reference/providers-and-routing.md)。
- 想统一 Thinking 口径，读[Thinking 能力说明](../reference/thinking.md)。

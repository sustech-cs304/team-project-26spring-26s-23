---
title: 能力边界 / 状态总表
description: 用统一口径列出当前哪些能力已可用、哪些只是部分接通、哪些还在规划中。
sidebar_position: 5
---

# 能力边界 / 状态总表

- 这页给谁看：想快速判断项目当前覆盖到哪、哪些能力可以直接依赖、哪些需要注意边界的人。
- 这页解决什么问题：把状态表达统一成“已可用 / 部分接通 / 规划中”，避免不同页面各写一套。
- 当前覆盖到哪：覆盖当前最关键的产品链路、配置链路、运行时链路和领域边界，不把草案页写成现状。
- 当前状态：已可用。

## 先说结论

当前最完整的一条链是：

- 桌面应用。
- 双层配置。
- provider catalog / provider profile / model route。
- `thread/run` 聊天主链。
- run 事件流和 thinking 元数据。

真正需要注意边界的，主要是：

- Blackboard、TIS 这类领域能力的产品化接入面。
- 一些工作台分区和外部源流程。
- 会话持久化恢复和统一业务 Web API。

## 总表

| 能力主题 | 当前状态 | 现在可以怎样理解 |
| --- | --- | --- |
| 桌面应用与本地后端 | 已可用 | 当前主形态已经是桌面应用拉起本地后端，并暴露健康检查、就绪状态和诊断入口。 |
| 双层配置与 settings workspace | 已可用 | 公开快照、普通设置状态、secret 状态已经明确分层，owner 关系已经成立。 |
| provider catalog / provider profile / model route | 已可用 | 这组术语和解析链路已经是当前可靠事实，不再按旧的 active provider 心智理解。 |
| 默认模型路由与请求级模型路由 | 已可用 | settings workspace 可提供默认值，真正执行仍以每次请求显式携带的 route 为准。 |
| `thread/run` 聊天主链 | 已可用 | 当前主链已经围绕 `thread/create`、`thread/get`、`run/start`、`run/stream`、`run/cancel` 组织。 |
| 兼容壳 `session/create` / `message/send` | 部分接通 | 这些方法仍可用，但它们现在是投影层，不再承担新增主语义。 |
| thinking capability 查询与选择 | 已可用 | thinking 已经能查询 capability、提交 selection，并把结果写入 run 元数据。 |
| reasoning 可见展示 | 已可用 | 运行时通过 `reasoning_delta` 事件统一支持推理过程展示；是否输出推理内容取决于模型/Provider 的 API。 |
| 工具生命周期事件 | 已可用 | run 流里已经有 `tool_event`，能表达工具 started、completed、failed。 |
| Blackboard HTTP API | 已可用 | `/api/blackboard/*` 端点已可用，支持同步触发、数据查询（课程、公告、作业、成绩、资源）和资源下载管理。 |
| Blackboard 领域能力（工具层） | 部分接通 | 工具层面板调用尚未完全产品化，但 HTTP API 已面向前端开放。 |
| TIS 领域能力 | 部分接通 | 已经有真实能力和集成痕迹，但还没有形成统一产品化接入面。 |
| 外部源 / WakeUP 流程 | 部分接通 | 已有设置入口和前端解析流程，`/api/wakeup/*` 端点已可用，但尚未形成完整后端同步能力。 |
| 日历事件查询 | 已可用 | `GET /calendar/events` 端点已可用，可从 timeline.db 读取日历事件。 |
| 调试日志查询 | 已可用 | `/diagnostics/debug-logs/*` 端点已可用，支持最近日志、关联链和事件查询。 |
| 工具审批（Human-in-the-Loop） | 已可用 | `tool-approval/resolve` 方法已可用，支持高危操作的用户确认流程。 |
| Shell 会话 | 已可用 | `shell-session/start`、`shell-session/exec`、`shell-session/close` 已可用。 |
| sustech 工作区 | 部分接通 | 前端已存在完整的 Blackboard 数据浏览器和同步面板。 |
| capabilities / files / developer 等辅助工作区 | 部分接通 | 页面已具备真实功能（MCP 服务器管理、文件 CRUD、看板/Gantt），但闭环完整性仍在演进。 |
| 会话历史跨 runtime 重启恢复 | 已可用 | 基于 SQLite 持久化，runtime 重启后 thread 列表、历史时间线和已完成 run 可以恢复。 |
| 面向前端的统一业务 Web API | 已可用 | Blackboard、日历、调试日志、WakeUP 等领域已有正式 HTTP API 端点。 |

## 怎么使用这张表

### 如果你是普通使用者

最重要的是先区分两类能力：

- 可以直接围绕聊天、模型配置和 thinking 去试用的能力。
- 仍然需要注意边界的外围能力和领域能力。

所以你最应该先看的通常是：

- [Provider 与模型路由说明](./providers-and-routing.md)
- [Thinking 能力说明](./thinking.md)

### 如果你是开发者

最重要的是先区分两类事实：

- 已经可以直接作为现状写进新文档的事实。
- 只能写成部分接通或规划中的边界。

所以你最应该先看的通常是：

- [运行时接口 / 事件参考](./runtime-events.md)
- [Provider 与模型路由说明](./providers-and-routing.md)
- [Thinking 能力说明](./thinking.md)
- [MCP 集成说明](./mcp-integration.md)
- [日历与事件系统说明](./calendar-event-system.md)
- [边界与未覆盖范围](../backend/roadmap-and-boundaries.md)

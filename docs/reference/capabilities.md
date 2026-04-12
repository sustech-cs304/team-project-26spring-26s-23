---
title: 能力边界 / 状态总表
description: 用统一口径列出当前哪些能力已可用、哪些只是部分接通、哪些还在规划中。
sidebar_position: 5
---

# 能力边界 / 状态总表

- 这页给谁看：想快速判断项目当前覆盖到哪、哪些能力可以直接依赖、哪些还要保守理解的人。
- 这页解决什么问题：把状态表达统一成“已可用 / 部分接通 / 规划中”，避免不同页面各写一套。
- 当前覆盖到哪：覆盖当前最关键的产品链路、配置链路、运行时链路和领域边界，不把草案页写成现状。
- 当前状态：已可用。

## 先说结论

当前最完整的一条链是：

- 桌面宿主。
- 双层配置。
- provider catalog / provider profile / model route。
- `thread/run` 聊天主链。
- run 事件流和 thinking 元数据。

真正需要保守写的，主要是：

- Blackboard、TIS 这类领域能力的产品化接入面。
- 一些工作台分区和外部源流程。
- 会话持久化恢复和统一业务 Web API。

## 总表

| 能力主题 | 当前状态 | 现在可以怎样理解 |
| --- | --- | --- |
| 桌面宿主与本地 runtime | 已可用 | 当前主形态已经是桌面宿主拉起本地 runtime，并暴露健康检查、就绪状态和诊断入口。 |
| 双层配置与 settings workspace | 已可用 | 公开快照、普通设置状态、secret 状态已经明确分层，owner 关系已经成立。 |
| provider catalog / provider profile / model route | 已可用 | 这组术语和解析链路已经是当前可靠事实，不再按旧的 active provider 心智理解。 |
| 默认模型路由与请求级模型路由 | 已可用 | settings workspace 可提供默认值，真正执行仍以每次请求显式携带的 route 为准。 |
| `thread/run` 聊天主链 | 已可用 | 当前主链已经围绕 `thread/create`、`thread/get`、`run/start`、`run/stream`、`run/cancel` 组织。 |
| 兼容壳 `session/create` / `message/send` | 部分接通 | 这些方法仍可用，但它们现在是投影层，不再承担新增主语义。 |
| thinking capability 查询与选择 | 已可用 | thinking 已经能查询 capability、提交 selection，并把结果写入 run 元数据。 |
| reasoning 可见展示 | 部分接通 | 某些路由可以看到更完整的 reasoning 行为，但不同 route 的体验并不完全一致。 |
| 工具生命周期事件 | 已可用 | run 流里已经有 `tool_event`，能表达工具 started、completed、failed。 |
| Blackboard 领域能力 | 部分接通 | 已经有真实能力、工具和测试，但还不能写成完整对前端开放的稳定业务接口。 |
| TIS 领域能力 | 部分接通 | 已经有真实能力和集成痕迹，但还没有形成统一产品化接入面。 |
| 外部源流程 | 部分接通 | 已有设置入口和部分前端流程，但还不能写成完整后端同步能力。 |
| capabilities / files / developer 等辅助工作区 | 部分接通 | 页面骨架已经存在，但真实数据面和完整闭环还没有全部接上。 |
| 会话历史跨 runtime 重启恢复 | 规划中 | 当前 session store 仍以内存为主，runtime 重启后不会自动恢复完整历史。 |
| 面向前端的统一业务 Web API | 规划中 | 现有能力基础已经存在，但还不能把它写成一套完整、稳定、正式开放的业务接口面。 |

## 怎么使用这张表

### 如果你是普通使用者

最重要的是先区分两类能力：

- 可以直接围绕聊天、模型配置和 thinking 去试用的能力。
- 仍然要保守理解的外围能力和领域能力。

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

## 当前最容易写错的地方

1. 目录里有代码，不等于对外产品面已经成立。
2. 页面里有入口，不等于全链路已经接通。
3. 旧兼容方法还能调用，不等于它还是主链。
4. 某个能力能在一部分路由上运行，不等于所有路由体验都一致。

## 进一步阅读

- [术语表](./glossary.md)
- [Provider 与模型路由说明](./providers-and-routing.md)
- [Thinking 能力说明](./thinking.md)
- [运行时接口 / 事件参考](./runtime-events.md)
- [边界与未覆盖范围](../backend/roadmap-and-boundaries.md)

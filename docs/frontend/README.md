---
title: 前端分册入口
description: 说明 frontend 分册的阅读顺序、页面分层与适用场景。
sidebar_position: 1
sidebar_label: 总览
---

# 前端分册入口

这个分册只从前端视角说明当前桌面端实现：React renderer 里有哪些真实界面，Electron 通过哪些桥接面向前端暴露能力，设置字段分别落在哪层持久化里，以及哪些部分仍然只是半接通或占位。

跨前后端都必须一致的事实，已经收口在 `docs/system/`。阅读这里之前，最好先看[系统架构总览](../system/architecture-overview.md)、[运行时生命周期](../system/runtime-lifecycle.md)、[聊天运行时契约](../system/chat-runtime-contract.md)和[会话与状态模型](../system/session-and-state-model.md)。

## 这一分册当前回答什么问题

- 前端怎样判断自己能否进入聊天主路径。
- 用户今天真正能看到哪些工作区、页面和交互。
- 配置字段是落在公开配置中心，还是落在 settings workspace。
- 哪些页面已经进入真实主路径，哪些页面仍然只是设置资产、半接通入口或结构占位。

## 阅读顺序

1. [前端现在怎样连接后端](./backend-connection-contract.md)：先看前端怎样判断运行时可用、怎样进入 session-first 聊天主路径。
2. [前端当前 UI 状态](./ui-current-state.md)：再看当前桌面工作台里真正存在的界面结构和页面边界。
3. [当前生效字段参考](./reference-current-fields.md)：需要追字段 owner、持久化位置和当前生效范围时再看这页。
4. [页面能力参考](./reference-page-capabilities.md)：需要判断某一页现在做到哪一步、属于主路径还是占位时再看这页。
5. [前端运行时状态参考](./reference-runtime-states.md)：需要对照 `empty`、`starting`、`degraded` 等状态枚举时再看这页。
6. [已实现、占位与下一步](./roadmap-and-placeholders.md)：需要确认半接通边界、占位页面和未接通能力时再看这页。
7. [未来后端 API 讨论草案](./future-backend-api-draft.md)：只有在讨论未来接口主题时才需要看这页。

## 三层结构

| 层级 | 页面 | 用途 |
| --- | --- | --- |
| 入口层 | [前端分册入口](./README.md) | 说明阅读顺序、读者定位和各页职责，不重复展开实现细节。 |
| 当前事实层 | [前端现在怎样连接后端](./backend-connection-contract.md)、[前端当前 UI 状态](./ui-current-state.md) | 只说明当前前端已经落地的连接路径、界面结构和交互边界。 |
| 参考/边界层 | [当前生效字段参考](./reference-current-fields.md)、[页面能力参考](./reference-page-capabilities.md)、[前端运行时状态参考](./reference-runtime-states.md)、[已实现、占位与下一步](./roadmap-and-placeholders.md)、[未来后端 API 讨论草案](./future-backend-api-draft.md) | 用于查字段 owner、状态枚举、半接通说明、占位边界和未来草案。 |

## 读这组文档时先记住四个事实

- 首次初始化可以是空白状态，前端不会再自带示例 provider，也不会自动给出默认模型。
- 当前持久化已经分成两层：公开配置中心负责少量公开字段，settings workspace 负责大部分设置状态与 secrets。
- 当前聊天主路径已经是 session-first：先有智能体目录与会话，再在每次发送消息时显式给出模型和工具选择。
- `外部源`、WakeUP、部分设置页和其他工作区仍然保留明显的半接通或占位边界，不应写成成熟的后端集成能力。

## 按问题找文档

| 你要确认的问题 | 优先阅读 |
| --- | --- |
| 为什么前端现在能进或进不了聊天主路径 | [前端现在怎样连接后端](./backend-connection-contract.md) |
| 应用里今天真正有哪些页面和工作区 | [前端当前 UI 状态](./ui-current-state.md) |
| 某个字段到底存在哪里 | [当前生效字段参考](./reference-current-fields.md) |
| 某个页面是主路径、持久化页还是占位页 | [页面能力参考](./reference-page-capabilities.md) |
| 某个运行时状态具体代表什么 | [前端运行时状态参考](./reference-runtime-states.md) |
| 某项能力是不是还没有接到真实后端 | [已实现、占位与下一步](./roadmap-and-placeholders.md) |

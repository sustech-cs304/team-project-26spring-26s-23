---
title: 项目文档
description: 文档入口，说明系统层权威范围、前后端分册边界与建议阅读顺序。
sidebar_position: 1
sidebar_label: 文档首页
slug: /
---

# 项目文档

这套文档按“系统层权威源 + 端内分册”的方式组织。

## 先看文档边界

- `docs/system/` 负责收口跨前后端都必须一致的系统事实。后续前端分册和后端分册都应当以这里为准。
- `docs/frontend/` 从 renderer、Electron 暴露面、页面状态和设置工作区的前端视角展开，不单独改写系统层已经确定的事实。
- `docs/backend/` 从 desktop runtime、copilot runtime 和业务模块的后端视角展开，也不单独改写系统层已经确定的事实。
- `docs/plans/` 只用于计划、排期和方案讨论，不作为当前实现的权威说明。
- `docs/meetings/` 主要用于历史追溯，不替代正式手册。

## 建议阅读顺序

### 第一次接手项目

建议先按下面的顺序阅读：

1. [系统架构总览](./system/architecture-overview.md)
2. [运行时生命周期](./system/runtime-lifecycle.md)
3. [聊天运行时契约](./system/chat-runtime-contract.md)
4. [会话与状态模型](./system/session-and-state-model.md)
5. [前端分册入口](./frontend/README.md)
6. [后端分册入口](./backend/README.md)

这个顺序的作用很直接：先把跨端共识读清，再进入各自分册，后面阅读 [`docs/frontend/`](./frontend/) 或 [`docs/backend/`](./backend/) 时就不会反复碰到概念冲突。

### 只想快速定位某类问题

| 你要确认的问题 | 优先阅读 |
| --- | --- |
| 现在系统由哪些层组成，各层谁负责什么 | [系统架构总览](./system/architecture-overview.md) |
| 应用怎样启动窗口、拉起 runtime、暴露启动态 | [运行时生命周期](./system/runtime-lifecycle.md) |
| 聊天 HTTP 端点、请求体、响应体和错误码是什么 | [聊天运行时契约](./system/chat-runtime-contract.md) |
| 配置、设置、会话、消息历史分别放在哪里 | [会话与状态模型](./system/session-and-state-model.md) |
| renderer 当前页面、配置桥接和运行态细节 | [前端分册入口](./frontend/README.md) |
| Python runtime、模块边界和运行配置细节 | [后端分册入口](./backend/README.md) |

## 当前系统层已经收口的事实

系统层文档当前已经统一收口了这些全局事实，后续分册应当直接引用，不再各自重写一遍：

- 当前配置系统已经是“统一配置中心 + settings workspace”双层持久化结构。
- 当前聊天主路径已经是 session-first，会话先绑定智能体，每次消息再携带模型与工具策略。
- Electron 产品命名与 `userData` 路径已经统一收口到 `CanDue`。
- 首次启动时不会再预置默认 provider 或默认模型，系统会从更空白的初始状态进入设置与聊天链路。

这些事实的具体展开，分别见 [`docs/system/`](./system/) 下四篇系统文档。

## 分册该怎么用

### 前端分册

当前前端分册更适合回答下面这些问题：

- renderer 当前有哪些工作区与页面能力。
- preload 和 IPC 暴露面怎样被前端消费。
- 设置工作区当前有哪些可编辑字段和运行态表现。
- 哪些界面已经稳定，哪些仍然只是占位或未来草案。

入口位于 [前端分册入口](./frontend/README.md)。

### 后端分册

当前后端分册更适合回答下面这些问题：

- desktop runtime 与 copilot runtime 怎样组织。
- 当前服务怎样启动、怎样接收宿主投影的运行配置。
- 当前可观察契约和兼容边界分别是什么。
- Blackboard、TIS 等后端领域能力处在什么阶段。

入口位于 [后端分册入口](./backend/README.md)。

## 正式文档的使用原则

- 需要判断当前实现事实时，优先看系统层文档和分册正文，不把计划稿当成实现说明。
- 需要判断跨端概念时，优先回到 [`docs/system/`](./system/) 校验，不在前端分册和后端分册之间来回比对口径。
- 需要判断未来方向时，明确区分“当前已实现”“兼容保留”“未来草案”三种状态。

## 继续阅读

- [系统架构总览](./system/architecture-overview.md)
- [前端分册入口](./frontend/README.md)
- [后端分册入口](./backend/README.md)

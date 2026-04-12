---
title: 文档首页
description: 站点新的双入口首页，先分流给使用者和开发者，再把高变化事实收口到共享事实层。
sidebar_position: 1
sidebar_label: 文档首页
slug: /
---

# 赶渡 CanDue 文档

- 这页给谁看：第一次进入站点的人，包括普通使用者和开发者。
- 这页解决什么问题：告诉你该从哪条阅读路径开始，不需要先钻进旧分册。
- 当前覆盖到哪：双入口首页和共享事实层已经落地；使用者路径与开发者路径的细分专题已经可读。
- 当前状态：站点骨架已可用；使用者路径已可用；开发者路径已可用；共享事实层已可用。

这套站点现在按三层组织：

1. 给使用者。
2. 给开发者。
3. 共享事实层。

先按你的目标选入口。需要跨页面复用、又容易过时的事实，统一放到共享事实层，不再分散写在很多地方。

## 先选你的入口

### 给使用者

如果你更关心“这东西现在能做什么、怎么配模型、thinking 是什么、现在有哪些边界”，请先读[给使用者入口](./users/overview.md)。

这条路径会优先帮助你判断：

- 这个项目现在适不适合你。
- 该先看哪些说明。
- 需要配置模型时去哪里看。
- 想了解能力边界时去哪里看。

### 给开发者

如果你更关心“当前主链是什么、模型路由怎么解析、thinking 元数据怎么流动、代码该从哪里读”，请先读[给开发者入口](./developers/getting-started.md)。

这条路径会优先帮助你判断：

- 当前可靠主链是不是 `thread/run`。
- provider catalog、provider profile、model route 各自是什么。
- thinking 现在的请求和返回口径是什么。
- 旧资料该怎样作为补充材料来使用。

### 共享事实层

如果你已经知道自己要找的是某个具体事实，而不是一整条阅读路线，请直接进入共享事实层：

- [术语表](./reference/glossary.md)
- [Provider 与模型路由说明](./reference/providers-and-routing.md)
- [Thinking 能力说明](./reference/thinking.md)
- [能力边界 / 状态总表](./reference/capabilities.md)
- [运行时接口 / 事件参考](./reference/runtime-events.md)

## 共享事实层现在负责什么

共享事实层不是教程区。它负责把高变化主题收口成一份权威说明。

| 页面 | 这页解决什么问题 | 当前状态 |
| --- | --- | --- |
| [术语表](./reference/glossary.md) | 统一解释 thread、run、provider profile、model route、settings workspace 等关键名词。 | 已可用 |
| [Provider 与模型路由说明](./reference/providers-and-routing.md) | 解释 provider catalog、provider profile、默认模型路由、请求级模型路由和宿主解析边界。 | 已可用 |
| [Thinking 能力说明](./reference/thinking.md) | 解释 thinking 怎样请求、怎样查询能力、怎样出现在运行时元数据里。 | 已可用 |
| [能力边界 / 状态总表](./reference/capabilities.md) | 用统一口径列出哪些能力已可用，哪些只是部分接通，哪些还在规划中。 | 已可用 |
| [运行时接口 / 事件参考](./reference/runtime-events.md) | 解释当前控制面端点、运行时方法、SSE 事件和兼容壳的关系。 | 已可用 |

## 当前推荐阅读顺序

### 如果你是普通使用者

1. 先读[给使用者入口](./users/overview.md)。
2. 需要配置模型时，读[Provider 与模型路由说明](./reference/providers-and-routing.md)。
3. 需要理解 thinking 时，读[Thinking 能力说明](./reference/thinking.md)。
4. 需要判断现阶段能做什么、不能做什么时，读[能力边界 / 状态总表](./reference/capabilities.md)。

### 如果你是开发者

1. 先读[给开发者入口](./developers/getting-started.md)。
2. 需要对齐运行时方法和事件时，读[运行时接口 / 事件参考](./reference/runtime-events.md)。
3. 需要对齐模型解析链路时，读[Provider 与模型路由说明](./reference/providers-and-routing.md)。
4. 需要对齐 thinking 请求和元数据时，读[Thinking 能力说明](./reference/thinking.md)。
5. 需要先把现阶段边界看清楚时，读[能力边界 / 状态总表](./reference/capabilities.md)。

## 当前事实基线怎么判断

这次翻修不再把旧文档默认当成现状。当前判断顺序是：

1. 代码。
2. 测试。
3. 近期设计和实施计划。
4. 旧文档。

这意味着首页主路径已经不再按 `system / frontend / backend` 分册组织。当前可靠主链也不再按旧的 `session/create`、`message/send` 口径理解，而是以 `thread/run` 为主。

## 旧资料现在怎么用

旧目录没有删除，但它们不再是首页主路径：

- [系统专题](./system/architecture-overview.md)
- [前端分册](./frontend/README.md)
- [后端分册](./backend/README.md)

现在更合适的用法是：

- 先从新首页进入合适路径。
- 先看共享事实层把术语和边界对齐。
- 只有在需要更细的历史材料或实现细节时，再进入旧目录继续阅读。

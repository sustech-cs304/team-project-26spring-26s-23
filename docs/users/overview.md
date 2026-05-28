---
title: 给使用者
description: 按任务顺序带你认识 CanDue：是什么、怎么开始、怎么配置、怎么聊天、有什么边界。
sidebar_position: 1
---

# 给使用者

本文档按"是什么、怎么开始、怎么配置、怎么聊天、有什么边界"的顺序，帮你快速找到对应页面。

你不需要先读系统架构，也不需要先理解前后端分层。

## 推荐阅读顺序

| 页面 | 说明 |
| --- | --- |
| [CanDue 是什么](./what-is-candue.md) | 它现在是什么，适不适合你。 |
| [5 分钟上手](./quickstart.md) | 用最短路径完成第一次可工作的聊天。 |
| [模型与 Provider 设置](./model-setup.md) | 配置模型服务、默认模型和聊天可用路由。 |
| [聊天与 Thinking](./chat-and-thinking.md) | 理解日常聊天流程、thinking 的可见行为，以及怎样判断是否生效。 |
| [当前限制与能力边界](./limits.md) | 快速判断哪些能力可用，哪些需要先确认。 |

## 如果你只想先解决一个问题

| 你的问题 | 先读哪一页 |
| --- | --- |
| CanDue 现在到底是什么 | [CanDue 是什么](./what-is-candue.md) |
| 我想尽快跑通第一次聊天 | [5 分钟上手](./quickstart.md) |
| 模型为什么选不了，或者列表为什么是空的 | [模型与 Provider 设置](./model-setup.md) |
| Thinking 到底该怎么理解，为什么不同模型表现不同 | [聊天与 Thinking](./chat-and-thinking.md) |
| 我想先判断现阶段适不适合继续投入时间 | [当前限制与能力边界](./limits.md) |

## 这条路径默认依赖哪些共享事实页

主路径不会把高变化主题整段重写一遍。下面这些主题需要时再跳过去看：

- [术语表](../reference/glossary.md)：遇到 thread、run、provider profile 这类词时再查。
- [Provider 与模型路由说明](../reference/providers-and-routing.md)：弄清模型目录、默认模型路由和请求级模型路由时再看。
- [Thinking 能力说明](../reference/thinking.md)：想知道 thinking 为什么在不同模型上表现不一致时再看。
- [能力边界 / 状态总表](../reference/capabilities.md)：想快速确认"已可用 / 部分接通 / 规划中"时再看。

## 建议怎么读

### 先判断值不值得继续试

按这个顺序：

1. [CanDue 是什么](./what-is-candue.md)
2. [当前限制与能力边界](./limits.md)
3. 再决定要不要继续看上手和配置页。

### 你已经准备动手试

按这个顺序：

1. [5 分钟上手](./quickstart.md)
2. [模型与 Provider 设置](./model-setup.md)
3. [聊天与 Thinking](./chat-and-thinking.md)
4. 如果中途想判断边界，再看[当前限制与能力边界](./limits.md)。

## 什么时候切到开发者路径

如果你开始关心下面这些问题，就应该改读[给开发者](../developers/getting-started.md)：

- 本地怎么启动桌面应用。
- Electron 宿主、前端工作台、后端运行时之间怎样分工。
- 运行时事件和流式主链到底是什么。
- 配置和状态到底由谁保存。

## 进一步阅读

如果你需要补充材料，可以再看这些旧页，但它们不是主路径：

- [文档首页](../README.md)
- [系统架构总览](../system/architecture-overview.md)

---
title: 旧前端资料入口
description: 旧的 frontend 分册入口。保留前端实现细节与历史说明，当前主阅读路径请先走新的开发者路径和共享事实层。
sidebar_position: 1
sidebar_label: 旧资料入口
---

# 旧前端资料入口

- 这页给谁看：已经走完新主路径，还需要补旧前端实现细节的人。
- 这页解决什么问题：说明 frontend 分册现在还能拿来做什么，以及哪些事实已经迁到新路径。
- 当前覆盖到哪：保留旧页面索引、UI 细节、字段 owner 说明和历史边界说明；当前正式入口已迁到 `docs/developers/` 与 `docs/reference/`。
- 当前状态：旧资料入口已可用；当前主阅读路径已迁移。

先说结论：不要再把 frontend 分册当成首页入口。当前更适合先看 [给开发者](../developers/getting-started.md)、[前端实现](../developers/frontend.md)、[配置与状态模型](../developers/config-and-state.md)、[Provider 与模型路由说明](../reference/providers-and-routing.md) 和 [运行时接口 / 事件参考](../reference/runtime-events.md)。

## 先看新的正式入口

- 想先知道怎么跑项目、按什么顺序读，先看 [给开发者](../developers/getting-started.md)。
- 想直接找前端代码入口，先看 [前端实现](../developers/frontend.md)。
- 想先把模型路由、Provider 与配置 owner 对齐，先看 [Provider 与模型路由说明](../reference/providers-and-routing.md) 和 [配置与状态模型](../developers/config-and-state.md)。
- 想先把运行时方法、事件和兼容壳关系对齐，先看 [运行时接口 / 事件参考](../reference/runtime-events.md)。

## 这组旧页现在怎么用

这组页面继续保留，但现在只适合做三类事情：

1. 补旧的前端实现细节。
2. 追某个字段、页面或状态枚举的历史上下文。
3. 对照旧资料和当前新文档之间的迁移关系。

## 旧分册里最容易写错的四件事

1. 当前聊天主链已经是 `agents/list -> thread/create -> thread/get -> run/start -> run/stream -> run/cancel`；`session/create`、`capabilities/get` 和 `message/send` 只是兼容壳。
2. `activeProviderId` 只是设置页里的交互焦点，不是当前模型配置中心。
3. Thinking 不再按旧 intent / 档位体系理解，统一口径请看 [Thinking 能力说明](../reference/thinking.md)。
4. 当前前端主线不再依赖 CopilotKit runtime；仓库里保留的 `copilot` 命名主要是历史命名空间。

## 如果你仍然要读旧页

| 旧页面 | 现在更适合拿来做什么 |
| --- | --- |
| [前端现在怎样连接后端](./backend-connection-contract.md) | 补前端视角的连接细节，但主链解释请以共享事实层为准。 |
| [前端当前 UI 状态](./ui-current-state.md) | 补当前工作台结构和页面可见结果。 |
| [当前生效字段参考](./reference-current-fields.md) | 追字段 owner、持久化位置和显示层投影。 |
| [页面能力参考](./reference-page-capabilities.md) | 查某一页属于主路径、部分接通还是占位。 |
| [前端运行时状态参考](./reference-runtime-states.md) | 查页面状态枚举与显示语义。 |
| [已实现、占位与下一步](./roadmap-and-placeholders.md) | 补历史边界说明，不把它当成当前路线承诺。 |
| [未来后端 API 讨论草案](./future-backend-api-draft.md) | 只在讨论未来接口主题时参考。 |

## 相关新页面

- [给开发者](../developers/getting-started.md)
- [前端实现](../developers/frontend.md)
- [配置与状态模型](../developers/config-and-state.md)
- [Provider 与模型路由说明](../reference/providers-and-routing.md)
- [Thinking 能力说明](../reference/thinking.md)
- [运行时接口 / 事件参考](../reference/runtime-events.md)

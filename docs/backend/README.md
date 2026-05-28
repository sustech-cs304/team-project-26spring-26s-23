---
title: 旧后端资料入口
description: 旧的 backend 分册入口。保留后端实现细节与历史边界说明，当前主阅读路径请先走新的开发者路径和共享事实层。
sidebar_position: 1
sidebar_label: 旧资料入口
---

# 旧后端资料入口

- 这页给谁看：已经走完新主路径，还需要补旧后端实现细节的人。
- 这页解决什么问题：说明 backend 分册现在还能拿来做什么，以及哪些事实已经迁到新路径。
- 当前覆盖到哪：保留旧页面索引、运行细节、契约补充说明和边界页；当前正式入口已迁到 `docs/developers/` 与 `docs/reference/`。
- 当前状态：旧资料入口已可用；当前主阅读路径已迁移。

先说结论：backend 分册不应再作为当前主入口。当前更适合先看 [给开发者](../developers/getting-started.md)、[后端实现](../developers/backend.md)、[聊天运行时](../developers/chat-runtime.md)、[Provider 与模型路由说明](../reference/providers-and-routing.md)、[运行时接口 / 事件参考](../reference/runtime-events.md) 和 [能力边界 / 状态总表](../reference/capabilities.md)。

## 先看新的正式入口

- 想先知道怎么跑项目、按什么顺序读，先看 [给开发者](../developers/getting-started.md)。
- 想直接找 Python runtime 与领域模块代码入口，先看 [后端实现](../developers/backend.md)。
- 想先把 `thread/run` 主链、兼容壳和事件流对齐，先看 [聊天运行时](../developers/chat-runtime.md) 与 [运行时接口 / 事件参考](../reference/runtime-events.md)。
- 想先把配置 owner、provider route 和密钥边界对齐，先看 [配置与状态模型](../developers/config-and-state.md) 与 [Provider 与模型路由说明](../reference/providers-and-routing.md)。

## 这组旧页现在怎么用

这组页面继续保留，但现在只适合做三类事情：

1. 补旧的后端实现细节。
2. 追某个目录、旧契约或运行参数的历史上下文。
3. 对照旧资料和当前新文档之间的迁移关系。

## 旧分册常见注意点

1. 当前聊天主链已经是 `agents/list -> thread/create -> thread/get -> run/start -> run/stream -> run/cancel`；`session/create`、`capabilities/get` 和 `message/send` 是兼容壳。
2. Python runtime 不是当前配置 owner；配置、provider profile 和 secrets 真源仍在 Electron 主进程。
3. Provider 相关事实应以统一口径为准，详见 [Provider 与模型路由说明](../reference/providers-and-routing.md)。
4. Blackboard 与 TIS 已经有真实能力，但对前端的完整产品化接入面仍然只是部分接通。

## 如果你仍然要读旧页

| 旧页面 | 现在更适合拿来做什么 |
| --- | --- |
| [后端模块布局](./module-layout.md) | 补目录结构和模块边界的旧说明。 |
| [后端运行与配置](./run-and-config.md) | 补运行参数、路径差异和宿主管理细节。 |
| [后端暴露契约与前端接入点](./frontend-connection.md) | 补后端视角下的连接面细节。 |
| [运行与配置参考](./reference-run-and-config.md) | 查命令、参数、环境变量和路径映射。 |
| [当前契约参考](./reference-current-contracts.md) | 查兼容壳与旧契约字段，但主链判断请回到共享事实层。 |
| [边界与未覆盖范围](./roadmap-and-boundaries.md) | 补历史边界说明，不应视为当前产品承诺。 |
| [未来 API 草案参考](./reference-future-api-draft.md) | 只在讨论未来服务化主题时参考。 |

## 相关新页面

- [给开发者](../developers/getting-started.md)
- [后端实现](../developers/backend.md)
- [聊天运行时](../developers/chat-runtime.md)
- [配置与状态模型](../developers/config-and-state.md)
- [Provider 与模型路由说明](../reference/providers-and-routing.md)
- [Thinking 能力说明](../reference/thinking.md)
- [运行时接口 / 事件参考](../reference/runtime-events.md)
- [能力边界 / 状态总表](../reference/capabilities.md)

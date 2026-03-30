---
title: 后端分册入口
description: 说明 backend 分册的读者定位、阅读顺序与三层结构。
sidebar_position: 1
sidebar_label: 总览
---

# 后端分册入口

这个分册只从 Python 后端视角说明当前桌面运行时实现：本地 `desktop_runtime` 怎样被宿主管理，`copilot_runtime` 怎样提供当前聊天主契约，Blackboard 与 TIS 模块今天处在什么成熟度，以及哪些内容只适合放在参考页和草案页里。

跨前后端都必须一致的事实，已经收口在 `docs/system/`。阅读这里之前，最好先看[系统架构总览](../system/architecture-overview.md)、[运行时生命周期](../system/runtime-lifecycle.md)、[聊天运行时契约](../system/chat-runtime-contract.md)和[会话与状态模型](../system/session-and-state-model.md)。

## 这一分册适合谁读

- 刚接手后端代码的同学，可以先用这组文档辨认入口、目录边界和运行方式。
- 需要和前端或 Electron 宿主联调的同学，可以先确认后端今天实际暴露了哪些契约。
- 只想查命令、字段和错误码的读者，可以直接跳到参考页，而不必从头读完整叙述。

## 阅读顺序

1. [后端模块布局](./module-layout.md)。这页先说明当前目录结构、运行责任和各层边界。
2. [后端运行与配置](./run-and-config.md)。这页说明 Python runtime 怎样启动、怎样取配置，以及 CLI 与 Electron 宿主两种运行语境有什么差别。
3. [后端暴露契约与前端接入点](./frontend-connection.md)。这页说明今天真正对前端可见的控制面、聊天主路径与宿主接入点。
4. [运行与配置参考](./reference-run-and-config.md)。需要查命令、参数、环境变量和路径映射时再看这页。
5. [当前契约参考](./reference-current-contracts.md)。需要查方法字段、错误码和兼容方法时再看这页。
6. [边界与未覆盖范围](./roadmap-and-boundaries.md)。需要确认哪些内容还不应写成已实现能力时再看这页。
7. [未来 API 草案参考](./reference-future-api-draft.md)。只有在讨论未来服务化方向时才需要看这页。

## 三层结构

| 层级 | 页面 | 用途 |
| --- | --- | --- |
| 入口层 | [后端分册入口](./README.md) | 这一层只说明读者定位、阅读顺序和各页职责。 |
| 当前事实层 | [后端模块布局](./module-layout.md)、[后端运行与配置](./run-and-config.md)、[后端暴露契约与前端接入点](./frontend-connection.md) | 这一层只描述当前代码已经落地的实现、运行责任和对外连接面。 |
| 参考/边界层 | [运行与配置参考](./reference-run-and-config.md)、[当前契约参考](./reference-current-contracts.md)、[边界与未覆盖范围](./roadmap-and-boundaries.md)、[未来 API 草案参考](./reference-future-api-draft.md) | 这一层用于查表、对照边界和记录未来草案，不和当前事实层混写。 |

## 读这组文档时先记住四个事实

- 当前桌面后端的正式宿主是 Electron 主进程。它负责准备路径、持久化配置、启动 Python 子进程，并把必要参数投影给 runtime。
- 当前聊天主契约已经收口为 session-first 路径，也就是 `agents/list`、`session/create`、`capabilities/get` 和 `message/send`。
- 当前 Python runtime 仍然按 CLI 参数、环境变量和默认值解释配置。统一配置中心与 settings workspace 仍然由 Electron 主进程持有。
- Blackboard 与 TIS 已经有可调用能力和部分成熟入口，但它们还没有整体收束成面向前端的完整业务 Web API。

## 按问题找文档

| 你要确认的问题 | 优先阅读 |
| --- | --- |
| 当前后端目录到底怎样分层 | [后端模块布局](./module-layout.md) |
| CLI 运行和 Electron 宿主管理下的路径差别是什么 | [后端运行与配置](./run-and-config.md) |
| 前端今天真正连到哪些后端能力 | [后端暴露契约与前端接入点](./frontend-connection.md) |
| 某个参数、环境变量或默认路径具体是什么 | [运行与配置参考](./reference-run-and-config.md) |
| 某个聊天方法有哪些关键字段和错误码 | [当前契约参考](./reference-current-contracts.md) |
| 哪些目录、能力和接口还不该写成成熟服务层 | [边界与未覆盖范围](./roadmap-and-boundaries.md) |
| 未来如果继续服务化，可能朝哪里扩展 | [未来 API 草案参考](./reference-future-api-draft.md) |

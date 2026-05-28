---
title: 给开发者
description: 面向开发者的总入口，按先运行、再架构、再机制、再代码落点的顺序阅读。
sidebar_position: 1
---

# 给开发者

开发者阅读顺序：先启动桌面应用，再看架构，再看聊天运行时，再看配置与状态，最后再看前端、后端和测试调试页。

## 第一次进入仓库，先做什么

### 第一步：准备依赖

仓库有三块你可能会直接操作的目录：

- `backend/`：Python 后端运行时与领域能力。
- `frontend-copilot/`：Electron 宿主与 React 工作台。
- `website/`：Docusaurus 文档站点。

先准备好依赖：

```powershell
uv sync --directory backend
cd frontend-copilot
npm install
cd ..\website
npm install
```

如果你只改桌面应用，`website/` 可以稍后再装。

### 第二步：启动桌面应用

通过下述命令可以启动本地桌面应用：

```powershell
cd frontend-copilot
npm run dev
```

这条路径会启动前端开发环境，并由 Electron 宿主进入桌面工作台主线。也是验证"CanDue 整体怎么连起来"的入口。

### 第三步：需要单独看后端时，再跑 Python runtime

如果你主要在查运行时契约、路由解析或后端日志，再单独运行后端：

```powershell
uv run --directory backend python -m app.desktop_runtime
```

这条路径适合做运行时联调、契约验证和后端问题隔离。

## 启动之后，按什么顺序读

| 顺序 | 页面 | 解决什么问题 |
| --- | --- | --- |
| 1 | [系统架构](./architecture.md) | 分清楚 Electron 宿主、前端工作台、后端运行时、共享配置各自归谁管。 |
| 2 | [聊天运行时](./chat-runtime.md) | 理解 `thread/run` 主链、兼容壳位置、事件流和工具步骤。 |
| 3 | [配置与状态模型](./config-and-state.md) | 理解公开配置、settings workspace、secret 状态、运行时快照和页面状态。 |
| 4 | [前端实现](./frontend.md) | 快速定位桌面工作台、助手主线和设置工作区的代码入口。 |
| 5 | [后端实现](./backend.md) | 快速定位 `desktop_runtime`、`copilot_runtime` 和领域模块的边界。 |
| 6 | [测试与调试](./testing-and-debugging.md) | 找到最常用的测试命令、smoke 脚本和排查顺序。 |

## 代码目录怎么先看

| 目录 | 角色 | 什么时候先看它 |
| --- | --- | --- |
| `frontend-copilot/electron/` | Electron 主进程、preload、宿主私桥、运行时生命周期。 | 你在看宿主、配置 owner、启动与桥接问题。 |
| `frontend-copilot/src/features/copilot/` | 助手聊天主线、`thread/run` 前端合同、流式消息处理。 | 你在看聊天主线和消息渲染。 |
| `frontend-copilot/src/workbench/settings/` | 设置工作区 UI 与状态组织。 | 你在看模型服务、默认模型或设置页。 |
| `backend/app/desktop_runtime/` | Python runtime 入口、控制面端点、宿主桥客户端。 | 你在看后端启动和宿主托管。 |
| `backend/app/copilot_runtime/` | 聊天协议、路由、run 编排、事件流、工具与 thinking 适配。 | 你在看聊天运行机制。 |
| `provider-catalog/` | 共享 Provider 目录事实。 | 你在核对 Provider 目录和路由口径。 |
| `docs/reference/` | 高变化主题的共享事实层。 | 你在对齐术语、Provider、thinking、能力边界、事件语义。 |

## 哪些共享事实页应该优先当准绳

开发者路径不会在每一页重复复制高变化主题。需要时优先回到这些共享页：

- [术语表](../reference/glossary.md)
- [Provider 与模型路由说明](../reference/providers-and-routing.md)
- [Thinking 能力说明](../reference/thinking.md)
- [运行时接口 / 事件参考](../reference/runtime-events.md)
- [能力边界 / 状态总表](../reference/capabilities.md)

## 常见注意点

1. 将 `session/create`、`message/send` 视为兼容壳，而非主链方法。
2. 区分 Provider 的 catalog、profile 和 route，而非仅切换 active provider。
3. 将 thinking 作为模型与 Provider 组合相关能力理解，而非旧 intent 口径。
4. 将 Electron 宿主定位为配置 owner 和 runtime launcher。

## 进一步阅读

如果你需要更多历史材料，可以再看这些旧页，但它们是补充材料，不是主路径：

- [系统架构总览](../system/architecture-overview.md)
- [聊天运行时契约](../system/chat-runtime-contract.md)
- [会话与状态模型](../system/session-and-state-model.md)
- [前端分册入口](../frontend/README.md)
- [后端分册入口](../backend/README.md)

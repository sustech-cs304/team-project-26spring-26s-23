---
title: 前端实现
description: 快速定位 Electron 宿主、React 工作台、助手主线和设置工作区的前端代码入口。
sidebar_position: 5
---

# 前端实现

前端不能只看 `src/`。如果你在改桌面应用主线，至少要同时认识三块代码：**`electron/` 里的宿主代码、`src/features/copilot/` 里的聊天主线、`src/workbench/settings/` 里的设置工作区。**

## 先按角色看目录

| 目录 | 主要角色 | 什么时候优先看它 |
| --- | --- | --- |
| `frontend-copilot/electron/` | Electron 主进程、preload、运行时生命周期、宿主桥、settings workspace 服务。 | 你在看宿主、启动、IPC、配置 owner、route 解析。 |
| `frontend-copilot/src/` | React renderer 入口、工作台、聊天面板、设置 UI。 | 你在看桌面界面和页面状态。 |
| `frontend-copilot/src/features/copilot/` | 助手聊天主线、`thread/run` 前端合同、事件流消费、消息列表。 | 你在改聊天链路。 |
| `frontend-copilot/src/workbench/settings/` | 设置工作区页面与表单状态。 | 你在改模型服务、默认模型或其他设置页。 |
| `frontend-copilot/src/workbench/hub/` | 其余工作区的 Hub 结构。 | 你在看能力、文件、开发等工作区入口。 |
| `frontend-copilot/src/workbench/` | Thinking 能力适配、展示策略、共享 UI 配置。 | 你在看 Thinking 展示和工作台级配置。 |

## 建议的读码顺序

### 1. 先看入口和根装配

先看：

- `frontend-copilot/src/main.tsx`
- `frontend-copilot/src/App.tsx`
- `frontend-copilot/src/CopilotAppRoot.tsx`

这一层帮你分清：启动时先发生什么、页面如何根据公开配置和宿主运行态决定进入哪条分支。

### 2. 再看 Electron 宿主侧代码

如果你继续往下读，下一站通常是：

- `frontend-copilot/electron/main.ts`
- `frontend-copilot/electron/preload.ts`
- `frontend-copilot/electron/runtime/`
- `frontend-copilot/electron/settings-workspace/`

很多"前端问题"实际上都和宿主有关，例如：

- 为什么某些配置不在 renderer 本地保存。
- 为什么 route 解析在执行前才发生。
- 为什么 secret 不会出现在公开快照里。

## 助手主线从哪里看

如果你主要在看聊天功能，按这个顺序：

1. `frontend-copilot/src/features/copilot/thread-run-contract.ts`
2. `frontend-copilot/src/features/copilot/runtime-message-stream.ts`
3. `frontend-copilot/src/features/copilot/run-segment-reducer.ts`
4. `frontend-copilot/src/features/copilot/CopilotChatPanel.tsx`
5. `frontend-copilot/src/features/copilot/CopilotMessageList.tsx`

这条线能把"请求怎么发""事件怎么收""消息怎么合并""页面怎么展示"串起来。

## 设置工作区从哪里看

如果你主要在改模型服务或默认模型，按这个顺序：

1. `frontend-copilot/src/workbench/settings/SettingsWorkspace.tsx`
2. `frontend-copilot/src/workbench/settings/ProviderProfilesSection.tsx`
3. `frontend-copilot/src/workbench/settings/DefaultModelRoutesSection.tsx`
4. `frontend-copilot/electron/settings-workspace/service.ts`
5. `frontend-copilot/electron/settings-workspace/provider-route-resolver.ts`

这条线能把"页面怎么编辑""状态怎么保存""route 怎样被宿主解析"串起来。

## Thinking 相关前端逻辑在哪里

前端对 Thinking 的处理不是写死一套旧 intent，而是围绕 capability 和展示策略组织。你通常会先看：

- `frontend-copilot/src/workbench/thinking-capabilities.ts`
- `frontend-copilot/src/workbench/thinking-display.ts`
- `frontend-copilot/src/features/copilot/` 下与模型选择或消息展示相关的组件

如果要统一事实口径，再回去看[Thinking 能力说明](../reference/thinking.md)。

## 各区域当前状态

| 区域 | 怎样理解 | 状态 |
| --- | --- | --- |
| 助手工作区 | 前端最完整的一条主线。 | 已可用 |
| 设置工作区 | 直接影响模型配置和运行体验的重要主线。 | 已可用 |
| SUSTech (Blackboard/TIS) 工作区 | 支持 Blackboard 同步、数据浏览器、日历与事件浏览。 | 部分接通 |
| 能力 / 文件 / 开发工作区 | 页面结构已经存在，但真实数据面不完整。 | 部分接通 |
| 外部源等外围设置 | 已有入口和部分交互，不构成完整闭环。 | 部分接通 |

## 常见注意点

### `frontend-copilot/electron/` 是配置和运行时边界的一部分

桌面前端主线里，Electron 宿主代码不是附属细节，而是配置和运行时边界的一部分。

### `features/copilot` 命名来自历史命名空间

仓库里保留 `copilot` 命名，主要是历史命名空间，不表示主链建立在 CopilotKit 上。

### 设置页保存能力尚未全部接入运行时

很多设置已经可保存，但哪些字段直接影响运行时，需要回到配置 owner 和能力边界来判断。

## 进一步阅读

- [前端当前 UI 状态](../frontend/ui-current-state.md)
- [前端现在怎样连接后端](../frontend/backend-connection-contract.md)
- [配置与状态模型](./config-and-state.md)
- [聊天运行时](./chat-runtime.md)

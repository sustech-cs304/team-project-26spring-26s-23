---
title: 前端实现
description: 帮开发者快速定位 Electron 宿主、React 工作台、助手主线和设置工作区的前端代码入口。
sidebar_position: 5
---

# 前端实现

- 这页给谁看：准备修改桌面前端、设置工作区、聊天面板或启动装配逻辑的开发者。
- 这页解决什么问题：说明当前前端代码主要分布在哪些目录，应该从哪里开始读，哪些部分已经直接进入主路径。
- 当前覆盖到哪：覆盖 `frontend-copilot/` 下与当前主链最相关的宿主、renderer、聊天和设置代码；更旧的前端分册继续作为补充材料。
- 当前状态：助手与设置主线已可用；其余工作区的数据面多数仍属部分接通。

先说结论：当前前端不能只看 `src/`。如果你在改的是桌面应用主线，至少要同时认识三块代码：**`electron/` 里的宿主代码、`src/features/copilot/` 里的聊天主线、`src/workbench/settings/` 里的设置工作区。**

## 先按角色看目录

| 目录 | 当前主要角色 | 什么时候优先看它 |
| --- | --- | --- |
| `frontend-copilot/electron/` | Electron 主进程、preload、运行时生命周期、宿主桥、settings workspace 服务。 | 你在看宿主、启动、IPC、配置 owner、route 解析。 |
| `frontend-copilot/src/` | React renderer 入口、工作台、聊天面板、设置 UI。 | 你在看实际桌面界面和页面状态。 |
| `frontend-copilot/src/features/copilot/` | 助手聊天主线、`thread/run` 前端合同、事件流消费、消息列表。 | 你在改聊天链路。 |
| `frontend-copilot/src/workbench/settings/` | 设置工作区页面与表单状态。 | 你在改模型服务、默认模型或其他设置页。 |
| `frontend-copilot/src/workbench/hub/` | 其余工作区的 Hub 结构。 | 你在看能力、文件、开发等工作区入口。 |
| `frontend-copilot/src/workbench/` | Thinking 能力适配、展示策略、共享 UI 配置。 | 你在看 Thinking 展示和工作台级配置。 |

## 建议的读码顺序

### 1. 先看入口和根装配

建议先看：

- `frontend-copilot/src/main.tsx`
- `frontend-copilot/src/App.tsx`
- `frontend-copilot/src/CopilotAppRoot.tsx`

这一层帮助你先分清：启动时先发生什么、页面如何根据公开配置和宿主运行态决定进入哪条分支。

### 2. 再看 Electron 宿主侧代码

如果你继续往下读，下一站通常是：

- `frontend-copilot/electron/main.ts`
- `frontend-copilot/electron/preload.ts`
- `frontend-copilot/electron/runtime/`
- `frontend-copilot/electron/settings-workspace/`

当前很多“前端问题”实际上都和宿主有关，例如：

- 为什么某些配置不在 renderer 本地保存。
- 为什么 route 解析在执行前才发生。
- 为什么 secret 不会出现在公开快照里。

## 助手主线应该从哪里看

如果你主要在看聊天功能，建议按这个顺序：

1. `frontend-copilot/src/features/copilot/thread-run-contract.ts`
2. `frontend-copilot/src/features/copilot/runtime-message-stream.ts`
3. `frontend-copilot/src/features/copilot/run-segment-reducer.ts`
4. `frontend-copilot/src/features/copilot/CopilotChatPanel.tsx`
5. `frontend-copilot/src/features/copilot/CopilotMessageList.tsx`

这条线能把“请求怎么发”“事件怎么收”“消息怎么合并”“页面怎么展示”串起来。

## 设置工作区应该从哪里看

如果你主要在改模型服务或默认模型，建议按这个顺序：

1. `frontend-copilot/src/workbench/settings/SettingsWorkspace.tsx`
2. `frontend-copilot/src/workbench/settings/ProviderProfilesSection.tsx`
3. `frontend-copilot/src/workbench/settings/DefaultModelRoutesSection.tsx`
4. `frontend-copilot/electron/settings-workspace/service.ts`
5. `frontend-copilot/electron/settings-workspace/provider-route-resolver.ts`

这条线能把“页面怎么编辑”“状态怎么保存”“route 怎样被宿主解析”串起来。

## Thinking 相关前端逻辑在哪里

当前前端对 Thinking 的处理，主要不是写死一套旧 intent，而是围绕 capability 和展示策略组织。你通常会先看：

- `frontend-copilot/src/workbench/thinking-capabilities.ts`
- `frontend-copilot/src/workbench/thinking-display.ts`
- `frontend-copilot/src/features/copilot/` 下与模型选择或消息展示相关的组件

如果你要统一事实口径，再回去看[Thinking 能力说明](../reference/thinking.md)。

## 目前哪些前端区域最值得保守判断

| 区域 | 当前应该怎样理解 | 当前状态 |
| --- | --- | --- |
| 助手工作区 | 当前前端最完整的一条主线。 | 已可用 |
| 设置工作区 | 当前直接影响模型配置和运行体验的重要主线。 | 已可用 |
| 能力 / 文件 / 开发工作区 | 页面结构已经存在，但真实数据面仍不完整。 | 部分接通 |
| 外部源等外围设置 | 已有入口和部分交互，但不应写成完整成熟闭环。 | 部分接通 |

## 前端实现最容易误写的地方

### 不要把 `frontend-copilot/electron/` 忽略掉

桌面前端主线里，Electron 宿主代码不是附属细节，而是当前配置和运行时边界的一部分。

### 不要把 `features/copilot` 误写成第三方运行时依赖

仓库里保留 `copilot` 命名，主要是历史命名空间，不表示当前主链建立在 CopilotKit 上。

### 不要把设置页保存能力直接等同于运行时全部接通

很多设置已经可保存，但哪些字段直接影响运行时，仍然需要回到配置 owner 和能力边界来判断。

## 进一步阅读

- [前端当前 UI 状态](../frontend/ui-current-state.md)
- [前端现在怎样连接后端](../frontend/backend-connection-contract.md)
- [配置与状态模型](./config-and-state.md)
- [聊天运行时](./chat-runtime.md)

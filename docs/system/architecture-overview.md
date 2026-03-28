---
title: 系统架构总览
description: 从系统级视角说明 Electron 主进程、双层配置系统、Python runtime 与当前 session-first 聊天主路径的关系。
sidebar_position: 1
---

# 系统架构总览

本文档先回答一个最重要的问题：系统现在到底由谁负责什么，配置、运行时和聊天主路径又是怎样衔接起来的。

## 一句话认识当前系统

当前系统可以这样理解：Electron 主进程负责桌面宿主、配置持久化和 runtime 生命周期，renderer 负责工作台界面与会话壳，Python runtime 负责本地 HTTP 服务，而聊天正式主路径已经进入“后端目录给出智能体 → 创建会话时绑定智能体 → 每次请求再携带模型与工具策略”的 session-first 结构。

## 当前系统的四个核心层

### Electron 主进程

主进程当前承担下面这些职责：

- 它负责创建窗口、延迟显示窗口，并处理应用退出时的清理。
- 它负责统一配置中心和 settings workspace 的磁盘持久化。
- 它负责托管 hosted backend 的启动、停止、失败记录与重试。
- 它负责把可公开的能力通过 IPC 暴露给 renderer，同时保留对底层文件和 secrets 的直接控制。

实现入口位于[`frontend-copilot/electron/main.ts`](../../frontend-copilot/electron/main.ts)。

### Preload

preload 当前是一层很薄的受控桥。它不会把文件系统、spawn 细节或 secret 文档直接暴露到页面环境，而是只暴露几个清晰的接口：

- 它会暴露公开配置中心的读取、补丁和订阅接口。
- 它会暴露 settings workspace 普通状态与 secrets 的独立接口。
- 它会暴露 hosted runtime 快照读取与 retry 接口。
- 它会暴露 bootstrap ready 信号，用来告诉主进程何时可以显示窗口。

相关实现位于[`frontend-copilot/electron/preload.ts`](../../frontend-copilot/electron/preload.ts)与[`frontend-copilot/electron/renderer-ipc.ts`](../../frontend-copilot/electron/renderer-ipc.ts)。

### Renderer 工作台

renderer 是运行在 Electron 中的 React 工作台。它承担的是页面级装配和交互职责：

- 它会在启动时读取公开配置快照与 runtime 快照，决定当前工作台状态。
- 它会承载助手工作区、设置工作区以及其余工作区视图。
- 它会在有可用 `runtimeUrl` 时进入聊天主路径，继续向后端拉目录、创建会话和发送消息。

相关入口位于[`frontend-copilot/src/CopilotAppRoot.tsx`](../../frontend-copilot/src/CopilotAppRoot.tsx)、[`frontend-copilot/src/workbench/assistant/AssistantWorkspace.tsx`](../../frontend-copilot/src/workbench/assistant/AssistantWorkspace.tsx)和[`frontend-copilot/src/workbench/settings/SettingsWorkspace.tsx`](../../frontend-copilot/src/workbench/settings/SettingsWorkspace.tsx)。

### Python Desktop Runtime

Python runtime 提供本地 loopback HTTP 服务。它既承担控制面接口，也承担聊天协议入口：

- 它会提供 `/health`、`/ready`、`/version` 和 `/diagnostics` 等运行控制面接口。
- 它会通过根路径 `POST /` 承载当前单端点聊天协议。
- 它会维护智能体目录、工具目录以及进程内会话存储。

服务创建位于[`backend/app/desktop_runtime/server.py`](../../backend/app/desktop_runtime/server.py)，契约结构位于[`backend/app/copilot_runtime/contracts.py`](../../backend/app/copilot_runtime/contracts.py)。

## 配置系统已经分成两层

### 第一层是公开配置中心

公开配置中心位于[`frontend-copilot/electron/config-center/`](../../frontend-copilot/electron/config-center/)。它当前属于 Electron 主进程层，由主进程负责读取、归一化、迁移、写回和广播公开快照。

当前正式公开域主要有四个：

| 配置域 | 当前公开字段 | 主要用途 |
| --- | --- | --- |
| `frontend-preferences` | `theme`、`animationsEnabled` | 这些字段用于前端主题和动画偏好。 |
| `assistant-behavior` | `agentName` | 这个字段保留为助手行为偏好，但当前聊天主路径已经不再依赖它决定能否连接。 |
| `host-config` | `runtimeUrl` | 这个字段用于开发态 runtime 地址覆盖。 |
| `backend-exposed` | `model` | 这个字段供主进程在启动 hosted backend 时投影为默认模型参数。 |

公开快照的投影定义位于[`frontend-copilot/electron/config-center/public-snapshot.ts`](../../frontend-copilot/electron/config-center/public-snapshot.ts)，存储和迁移逻辑位于[`frontend-copilot/electron/config-center/service.ts`](../../frontend-copilot/electron/config-center/service.ts)。

### 第二层是 settings workspace 持久化

settings workspace 位于[`frontend-copilot/electron/settings-workspace/`](../../frontend-copilot/electron/settings-workspace/)。这层同样由主进程 owner 持有，但它解决的是另一类问题：设置工作区中更完整的普通设置和 secret 持久化。

它当前分成两份文档：

- [`frontend-copilot/electron/settings-workspace/schema.ts`](../../frontend-copilot/electron/settings-workspace/schema.ts)定义的普通状态文档会保存 provider profiles、默认模型路由、SUSTech 相关字段、API 配置等设置。
- 同一文件中定义的 secrets 文档会保存 provider API key 和 SUSTech CAS 密码等敏感值。

读取与写回逻辑位于[`frontend-copilot/electron/settings-workspace/service.ts`](../../frontend-copilot/electron/settings-workspace/service.ts)，主进程封装位于[`frontend-copilot/electron/settings-workspace/main-process.ts`](../../frontend-copilot/electron/settings-workspace/main-process.ts)。

### 这两层的边界很明确

可以用下面这张表来理解它们的差别：

| 维度 | 公开配置中心 | settings workspace 普通状态 | settings workspace secrets |
| --- | --- | --- | --- |
| owner | Electron 主进程负责持久化与广播。 | Electron 主进程负责持久化。 | Electron 主进程负责持久化，并限制暴露方式。 |
| 主要消费者 | 根装配、启动页主题、工作台公共设置读取。 | 设置工作区表单。 | 设置工作区的 secret 管理界面。 |
| 是否进入公开快照 | 这部分数据会进入公开快照。 | 这部分数据不会进入公开快照。 | 这部分数据不会进入公开快照。 |
| 是否适合直接暴露给 renderer | 这部分数据就是给 renderer 公开消费的那一层。 | 这部分数据通过设置工作区 API 定向暴露。 | 这部分数据只通过专门的 secret API 暴露必要结果。 |

这意味着，当前配置系统已经不再是“一个 settings 文件 + renderer 本地 state”的结构。系统现在同时存在公开配置面和设置工作区持久化面，两者由同一个主进程持有，但职责不同。

## Secret 与普通设置已经分层

当前关于 secret 的准确表述应该是下面这样：

- provider API key 和 SUSTech CAS 密码属于 settings workspace secrets。
- 这些 secret 不会进入 config center public snapshot。
- renderer 只会通过专门的 load、save、clear API 与主进程交互。
- 主进程会继续作为 secret 文档的直接 owner。

这条边界非常重要，因为它说明“设置已持久化”并不等于“设置已经公开给全部页面状态使用”。

## Electron 在当前系统中的角色

Electron 当前不是一个简单的窗口壳。它在系统中承担的是三个 owner 角色。

### 它是桌面生命周期 owner

主进程负责窗口创建、启动页显示时机、运行日志转发和退出清理。当前窗口会先创建，再等待 bootstrap ready 信号后显示。这个行为已经是正式启动路径的一部分。

### 它是配置持久化 owner

主进程同时持有公开配置中心与 settings workspace 的状态和 secrets 文档。renderer 不会直接访问这些底层文件，而是通过 preload 暴露的 API 获得受控读写能力。

### 它是 runtime 生命周期 owner

主进程会决定使用 development 还是 bundled 模式启动 Python runtime，也会决定向 runtime 传递哪些 CLI 参数，例如 `host`、`port`、`local token` 和从公开配置中投影出的默认模型。runtime 本身不会直接去读这些配置文档。

## 当前聊天为什么已经是 session-first

### 后端目录已经成为智能体真源

当前 renderer 不再自己维护一份聊天专用的智能体真源。工作台会向后端请求 `agents/list`，由后端告诉前端当前有哪些可用智能体、默认智能体是谁，以及每个智能体推荐哪些工具、偏好什么默认模型。

相关契约位于[`frontend-copilot/src/features/copilot/chat-contract.ts`](../../frontend-copilot/src/features/copilot/chat-contract.ts)和[`backend/app/copilot_runtime/contracts.py`](../../backend/app/copilot_runtime/contracts.py)。

### 会话创建时就会绑定智能体

当前前端主路径会调用 `session/create`。后端返回值中已经包含 `sessionId`、`boundAgent`、`createdAt`、`updatedAt`、`recommendedTools` 和 `defaultModelPreference`。这说明“会话属于哪个智能体”是在会话创建时就确定下来的，而不是在消息发送时临时猜测。

### 能力面已经进入正式主路径

会话创建后，前端会继续调用 `capabilities/get`。返回值当前会包含 `capabilitiesVersion`、工具目录、推荐工具、工具选择模式和默认模型偏好。`AssistantWorkspace` 会把这些内容整理成 `AssistantSessionCapabilities`，再放进 `AssistantSessionShell`。

当前前端还会把 `recommendedTools` 映射为新会话的 `defaultEnabledTools`。因此，默认启用工具来源已经进入正式会话壳，不再是界面上随手拼出来的临时值。

### 请求级消息策略已经进入正式消息请求

[`frontend-copilot/src/features/copilot/CopilotChatPanel.tsx`](../../frontend-copilot/src/features/copilot/CopilotChatPanel.tsx)发送消息时，会在 `message/send` 请求里显式携带：

- `sessionId` 用来指定当前会话。
- `agent` 用来做绑定智能体一致性校验。
- `model` 用来指定本次发送使用的模型。
- `enabledTools` 用来指定本次启用哪些工具。
- `requestOptions` 用来携带本次请求的附加选项。

这说明当前聊天主路径已经同时具备会话级绑定和请求级策略两个层次。

## 当前系统关系图

```text
Electron Main Process
  ├─ Config Center
  │    ├─ 分域公开配置文档
  │    ├─ 公开快照投影与广播
  │    └─ 旧 copilot-settings.json 迁移入口
  ├─ Settings Workspace Persistence
  │    ├─ 普通状态文档
  │    └─ secrets 文档
  ├─ Hosted Runtime Lifecycle
  │    ├─ 创建 / 启动 / 重试 / 停止
  │    └─ runtime 快照与失败摘要
  └─ Preload / IPC Surface
            │
            ▼
Renderer Workbench
  ├─ 根装配层读取公开配置与 runtime 快照
  ├─ AssistantWorkspace 进入 session-first 聊天主路径
  └─ SettingsWorkspace 读写普通设置与 secrets
            │
            ▼
Python Desktop Runtime
  ├─ /health /ready /version /diagnostics
  ├─ POST / 单端点聊天协议
  ├─ 智能体目录与工具目录
  └─ InMemorySessionStore
```

## 旧 `copilot-settings.json` 现在的角色

[`frontend-copilot/electron/config-center/service.ts`](../../frontend-copilot/electron/config-center/service.ts)和[`frontend-copilot/electron/config-center/paths.ts`](../../frontend-copilot/electron/config-center/paths.ts)仍然会把旧 `copilot-settings.json` 作为迁移输入路径使用。它当前最主要的用途，就是在新分域文档不存在时为 `runtimeUrl`、`agentName` 等历史字段提供迁移来源。

因此，旧文件当前更像主进程内部的兼容输入，而不是正式对外接口。

## 当前边界

### 当前已经成立的事实

- 配置系统已经分成公开配置中心和 settings workspace 持久化两层。
- secret 与普通设置已经分层，secret 不会进入公开快照。
- Electron 主进程已经成为配置持久化 owner 和 runtime 生命周期 owner。
- 后端目录、会话绑定、能力面和请求级消息策略已经进入正式聊天主路径。

### 当前仍然需要写得谨慎的地方

- Python runtime 还不会直接读取配置中心文档。
- 会话列表当前还没有后端持久化接口。
- runtime 状态变化当前还没有面向 renderer 的完整实时推送。
- 旧 `agent/connect` 与 `agent/run` 仍然保留兼容语义，但当前前端主路径使用的是 `agents/list`、`session/create`、`capabilities/get` 和 `message/send`。

## 相关文档

- [运行时生命周期](./runtime-lifecycle.md)
- [会话与状态模型](./session-and-state-model.md)
- [聊天运行时契约](./chat-runtime-contract.md)
- [前端分册入口](../frontend/README.md)
- [后端运行与配置](../backend/run-and-config.md)

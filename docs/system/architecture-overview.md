---
title: 系统架构总览
description: 从系统级视角说明 Electron 宿主、双层配置持久化、Python runtime 与 session-first 聊天路径的当前关系。
sidebar_position: 1
---

# 系统架构总览

这篇文档负责收口跨前后端都必须一致的系统事实：桌面宿主由谁持有，配置怎样落盘，聊天主路径怎样接到 Python runtime，以及首次启动时系统处在什么默认状态。

具体启动顺序见 [运行时生命周期](./runtime-lifecycle.md)，HTTP 字段和错误语义见 [聊天运行时契约](./chat-runtime-contract.md)，状态分层与持有者见 [会话与状态模型](./session-and-state-model.md)。

## 当前系统的一句话

当前应用是一个名为 `CanDue` 的 Electron 桌面宿主。Electron 主进程负责窗口、`userData` 目录下的持久化与 Python hosted backend 生命周期；renderer 负责工作台界面；Python desktop runtime 通过本地 loopback HTTP 提供控制面和聊天入口；聊天主路径已经稳定在 session-first agent 与 request-scoped model/tool policy 这一组契约上。

## 当前系统的四个核心部分

### Electron 主进程

主进程当前承担这些系统级职责：

- 它负责设置产品名 `CanDue`，并在解析 `app.getPath('userData')` 之前完成命名收口。
- 它负责创建主窗口、控制启动页显示时机，并在退出时回收 hosted backend。
- 它负责统一配置中心与 settings workspace 的磁盘持久化。
- 它负责启动、停止、重试和诊断 Python hosted backend。
- 它负责通过 preload 与 IPC 向 renderer 暴露受控接口。

当前实现主要落在 `frontend-copilot/electron/main.ts`、`frontend-copilot/electron/main-window.ts`、`frontend-copilot/electron/preload.ts` 与 `frontend-copilot/electron/main-ipc.ts`。

### Renderer 工作台

renderer 负责页面装配和交互，而不直接持有底层文件或 secrets：

- 它会在启动时读取公开配置快照与 runtime 快照，决定应用当前处于 `loading`、`starting`、`ready`、`failed`、`degraded`、`empty` 或 `incomplete` 哪一类状态。
- 它会订阅公开配置快照更新，并在配置变化后重新计算根装配状态。
- 它会承载助手工作区与设置工作区。
- 它会在存在可用 `runtimeUrl` 时进入聊天主路径。

当前实现主要落在 `frontend-copilot/src/CopilotAppRoot.tsx`、`frontend-copilot/src/features/copilot/config.ts`、`frontend-copilot/src/workbench/assistant/` 与 `frontend-copilot/src/workbench/settings/`。

### Preload 与 IPC 暴露面

preload 当前是一层受控桥，而不是让页面直接接触文件系统和 secret 文档的通道。它主要暴露三类接口：

- 公开配置中心的读取、补丁写回与快照订阅接口。
- settings workspace 的普通状态接口与 secrets 接口。
- hosted runtime 快照读取、重试，以及启动页 ready 信号接口。

这层边界保证了 renderer 能读取当前需要的事实，但不会直接持有 `userData` 下的配置文件与 secret 文档。

### Python desktop runtime

Python runtime 当前通过 loopback HTTP 提供本地服务：

- 它暴露 `/health`、`/ready`、`/version`、`/build-info`、`/diagnostics` 和 `/diagnostics/runtime-info` 这类控制面端点。
- 它通过根路径 `POST /` 承载聊天相关方法。
- 它维护后端智能体目录、工具目录和进程内会话存储。

当前实现主要落在 `backend/app/desktop_runtime/server.py`、`backend/app/copilot_runtime/router.py`、`backend/app/copilot_runtime/contracts.py` 与 `backend/app/copilot_runtime/session_store.py`。

## 配置与持久化已经形成双层结构

当前系统已经不能再用“单个 settings 文件”来描述。更准确的说法是：Electron 主进程同时持有两层面向不同职责的持久化结构。

### 第一层是统一配置中心

统一配置中心位于 `frontend-copilot/electron/config-center/`。它负责公开、稳定、可投影到根装配和宿主启动参数的字段。

当前公开域包括：

| 配置域 | 当前字段 | 主要用途 |
| --- | --- | --- |
| `frontend-preferences` | `theme`、`animationsEnabled` | 控制主题与动画偏好。 |
| `assistant-behavior` | `agentName` | 保留助手偏好信息，但它已经不是聊天入口的硬门槛。 |
| `host-config` | `runtimeUrl` | 提供开发态 runtime 地址覆盖。 |
| `backend-exposed` | `model` | 供主进程在启动 hosted backend 时投影默认模型参数。 |

这些字段会被投影成公开快照，供启动页主题、根装配和少量公共设置消费。

### 第二层是 settings workspace

settings workspace 位于 `frontend-copilot/electron/settings-workspace/`。它和统一配置中心同样由主进程持有，但职责不同：

- 普通状态文档保存 provider profiles、默认模型路由、SUSTech 普通字段、API 设置和其他设置工作区字段。
- secrets 文档单独保存 provider API key 与 SUSTech CAS 密码等敏感值。
- 这两类文档不会投影进公开配置快照。

它的默认路径与统一配置中心共享同一个根目录，也就是 `frontend-copilot/electron/config-center/paths.ts` 生成的 `config-center` 根目录。当前 `settings-workspace-state.json` 与 `settings-workspace-secrets.json` 也位于这个根目录下。

### 两层结构的关键边界

两层结构虽然都由主进程持有，但用途并不相同：

- 统一配置中心面向“公开、稳定、跨工作区共享”的配置事实。
- settings workspace 面向“设置页内部需要完整持久化，但不应进入公开快照”的状态和 secrets。
- Python runtime 当前不会自行读取这两层文档；主进程会把需要的运行参数整理后投影给 runtime。

### 旧 `copilot-settings.json` 的当前角色

旧 `copilot-settings.json` 仍然存在兼容作用，但它已经退到迁移输入位置。当前系统会把它当成历史来源，用来回填 `runtimeUrl` 与 `agentName` 等字段；正式写回和后续读取已经转到新的统一配置中心与 settings workspace 结构中。

## 首次启动已经进入更空白的默认状态

最近的实现变化里，有一条很重要：系统默认不再预置 provider 与模型。

当前默认状态是这样的：

- `frontend-copilot/src/workbench/settings/config.ts` 中的 `initialProviderProfiles` 为空数组。
- `frontend-copilot/electron/settings-workspace/provider-schema.ts` 会据此把默认 provider profiles 初始化为空。
- `frontend-copilot/electron/settings-workspace/provider-schema.ts` 里的默认模型路由也会退回空字符串。
- 统一配置中心中的 `backendExposed.model` 默认值是 `null`。

这意味着，首次启动时应用不会自动带着一组预填好的 provider 和模型进入设置页。系统仍然保留其他类别的基础默认值，例如语言、搜索或数据路径，但 provider 与模型链路已经收成更空白的起点。

## 聊天主路径为什么已经是 session-first

当前聊天主路径已经不再围绕全局 `agentName` 或旧的 `agent/run` 叙事组织。跨前后端一致的实际链路是下面这组步骤：

1. renderer 调用 `agents/list`，从后端获取智能体目录。
2. 用户选择智能体后，renderer 调用 `session/create`，由后端创建会话并绑定该智能体。
3. renderer 再调用 `capabilities/get`，读取这个会话对应的工具目录、推荐工具和默认模型偏好提示。
4. 用户发送消息时，renderer 调用 `message/send`，并在请求里显式携带 `model`、`enabledTools` 与 `requestOptions`。

这条链路体现的是三层分工：

- 智能体目录由后端给出。
- 会话在创建时绑定智能体。
- 模型与工具策略在每次消息请求里决定。

`frontend-copilot/src/features/copilot/chat-contract.ts` 与 `backend/app/copilot_runtime/contracts.py` 已经围绕这条链路对齐。前端当前还会把 `recommendedTools` 映射成新会话的 `defaultEnabledTools`，因此推荐工具已经进入正式会话壳，而不是页面临时拼装出来的装饰状态。

## 当前系统关系图

```text
Electron Main Process
  ├─ 产品命名与 userData 路径
  ├─ Config Center
  │    ├─ 公开域文档
  │    └─ 公开快照投影与广播
  ├─ Settings Workspace
  │    ├─ state 文档
  │    └─ secrets 文档
  ├─ Hosted Backend Lifecycle
  │    ├─ 启动 / 重试 / 停止
  │    └─ runtime 快照与失败摘要
  └─ Preload / IPC
             │
             ▼
Renderer Workbench
  ├─ 根装配读取公开快照与 runtime 快照
  ├─ AssistantWorkspace 进入 session-first 聊天链路
  └─ SettingsWorkspace 读写普通状态与 secrets
             │
             ▼
Python Desktop Runtime
  ├─ 控制面 HTTP 端点
  ├─ POST / 聊天入口
  ├─ 智能体目录与工具目录
  └─ InMemorySessionStore
```

## 当前已经成立的系统事实

- Electron 产品命名、窗口标题与 `userData` 命名已经统一收口到 `CanDue`。
- 配置持久化已经形成“统一配置中心 + settings workspace”双层结构。
- settings workspace 的普通状态与 secrets 已经分文档保存，并继续由主进程直接持有。
- 聊天主路径已经切到 session-first，会话绑定与请求级模型、工具策略都已经进入正式契约。
- provider profiles 与默认模型路由的首次状态已经清空为更空白的起点。

## 当前仍然要保守描述的地方

- Python runtime 当前不会主动读取统一配置中心或 settings workspace 文档。
- 会话历史仍然保存在后端进程内的 `InMemorySessionStore` 中，runtime 重启后不会自动恢复。
- hosted runtime 的状态变化还没有形成完整、持续的 renderer 实时推送流。
- `agent/connect` 与 `agent/run` 仍然保留兼容作用，但它们已经不是当前前端主路径的权威入口。

## 相关文档

- [运行时生命周期](./runtime-lifecycle.md)
- [聊天运行时契约](./chat-runtime-contract.md)
- [会话与状态模型](./session-and-state-model.md)
- [前端分册入口](../frontend/README.md)
- [后端分册入口](../backend/README.md)

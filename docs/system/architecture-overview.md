---
title: 旧系统架构资料
description: 旧的 system 分册架构总览。保留跨前后端的实现细节，当前主阅读路径请先看新的开发者路径和共享事实层。
sidebar_position: 1
sidebar_label: 旧资料总览
---

# 旧系统架构资料

- 这页给谁看：已经读过新开发者路径，还需要补系统级实现细节的人。
- 这页解决什么问题：保留旧的 `system` 分册说明，但不再把它当成当前首页主入口。
- 当前覆盖到哪：保留宿主、配置、运行时和兼容壳的实现细节；当前正式主阅读路径已经迁到 [给开发者](../developers/getting-started.md)、[系统架构](../developers/architecture.md) 和 [共享事实层](../reference/runtime-events.md)。
- 当前状态：旧资料页已可用；当前主阅读路径已迁移。

先说结论：如果你现在是第一次进入站点，不要先从这页开始。当前更适合先看 [给开发者](../developers/getting-started.md)、[系统架构](../developers/architecture.md)、[Provider 与模型路由说明](../reference/providers-and-routing.md) 和 [运行时接口 / 事件参考](../reference/runtime-events.md)。这页只在你需要补历史实现细节时再回来看。

## 当前系统的一句话

当前应用是一个名为 `CanDue` 的 Electron 桌面宿主。Electron 主进程负责窗口、`userData` 目录下的双层配置持久化、provider 状态与 secrets 真源，以及 Python hosted backend 生命周期；renderer 负责工作台界面与 run 级状态机；Python desktop runtime 通过本地 loopback HTTP 提供控制面和 `thread/run` 聊天主入口；`session/create`、`capabilities/get` 与 [`message/send`](./chat-runtime-contract.md) 作为兼容壳继续保留。

文中出现 `frontend-copilot/` 时，它只是仓库里的前端目录名，用来定位代码；产品名、窗口标题和 `userData` 命名都以 `CanDue` 为准。

## 当前系统的四个核心部分

### Electron 主进程

主进程当前承担这些系统级职责：

- 它负责设置产品名 `CanDue`，并在解析 `app.getPath('userData')` 之前完成命名收口。
- 它负责创建主窗口、控制启动页显示时机，并在退出时回收 hosted backend。
- 它负责统一配置中心与 settings workspace 的磁盘持久化。
- 它负责持有 provider profiles、provider secrets 与宿主私有 provider route bridge。
- 它负责启动、停止、重试和诊断 Python hosted backend。
- 它负责通过 preload 与 IPC 向 renderer 暴露受控接口。

当前实现主要落在：

- [`frontend-copilot/electron/main.ts`](../../frontend-copilot/electron/main.ts)
- [`frontend-copilot/electron/main-window.ts`](../../frontend-copilot/electron/main-window.ts)
- [`frontend-copilot/electron/runtime/host-model-route-bridge.ts`](../../frontend-copilot/electron/runtime/host-model-route-bridge.ts)
- [`frontend-copilot/electron/main-ipc.ts`](../../frontend-copilot/electron/main-ipc.ts)

### Renderer 工作台

renderer 负责页面装配和交互，但不直接持有底层文件或 secret：

- 它会在启动时读取公开配置快照与 runtime 快照，决定应用当前处于 `loading`、`starting`、`ready`、`failed`、`degraded`、`empty`、`incomplete` 或 `error` 哪一类状态。
- 它会订阅公开配置快照更新，并在配置变化后重新计算根装配状态。
- 它会承载助手工作区与设置工作区。
- 它会在进入聊天分支后，以 run 级状态机消费 `run/stream` 的流式事件，并兼容 [`message/send`](./chat-runtime-contract.md) 投影流。

当前实现主要落在：

- [`frontend-copilot/src/CopilotAppRoot.tsx`](../../frontend-copilot/src/CopilotAppRoot.tsx)
- [`frontend-copilot/src/features/copilot/config.ts`](../../frontend-copilot/src/features/copilot/config.ts)
- [`frontend-copilot/src/features/copilot/chat-contract.ts`](../../frontend-copilot/src/features/copilot/chat-contract.ts)
- [`frontend-copilot/src/features/copilot/copilot-send-controller.ts`](../../frontend-copilot/src/features/copilot/copilot-send-controller.ts)

### Python desktop runtime

Python runtime 当前通过 loopback HTTP 提供本地服务：

- 它暴露 `/health`、`/ready`、`/version`、`/build-info`、`/diagnostics` 和 `/diagnostics/runtime-info` 这类控制面端点。
- 它通过根路径 `POST /` 承载聊天相关方法。
- 它维护后端智能体目录、工具目录和进程内会话存储。
- 它通过 run 编排层把请求级模型路由解析、流式输出、诊断事件和最终归档统一收口。

当前实现主要落在：

- [`backend/app/desktop_runtime/server.py`](../../backend/app/desktop_runtime/server.py)
- [`backend/app/copilot_runtime/router.py`](../../backend/app/copilot_runtime/router.py)
- [`backend/app/copilot_runtime/protocol.py`](../../backend/app/copilot_runtime/protocol.py)
- [`backend/app/copilot_runtime/message_runs.py`](../../backend/app/copilot_runtime/message_runs.py)
- [`backend/app/copilot_runtime/run_events.py`](../../backend/app/copilot_runtime/run_events.py)

### 可选外部参考

当前聊天运行时主线的协议、状态机和传输层，已经由项目自身实现；仓库里的 CopilotKit 依赖也已经移除。当前仍保留的 `copilot_runtime`、`features/copilot` 等命名，主要是历史沿用的内部命名空间，而不是第三方运行时耦合。

## 配置与持久化已经形成双层结构

当前系统已经不能再用“单个 settings 文件”来描述。更准确的说法是：Electron 主进程同时持有两层面向不同职责的持久化结构。

### 第一层是统一配置中心

统一配置中心位于 `frontend-copilot/electron/config-center/`。它负责公开、稳定、适合根装配消费的字段，例如：

- `theme`
- `animationsEnabled`
- `agentName`
- `runtimeUrl`
- 仍然存在但已退居次要位置的 `backendExposed.model`

这些字段会被投影成公开快照，供启动页主题、根装配和少量公共设置消费。

### 第二层是 settings workspace

settings workspace 位于 `frontend-copilot/electron/settings-workspace/`。它与统一配置中心同样由主进程持有，但职责不同：

- 普通状态文档保存 provider profiles、默认模型路由、设置页普通字段和其他工作区配置。
- secrets 文档单独保存 provider API key 与 CAS 密码等敏感值。
- 这两类文档不会投影进公开配置快照。

对聊天主线来说，这层还有一个关键职责：它是真正的 provider profile 元数据真源，也是宿主取密钥的来源。

### 两层结构的关键边界

两层结构虽然都由主进程持有，但用途并不相同：

- 统一配置中心面向“公开、稳定、适合根装配消费”的配置事实。
- settings workspace 面向“设置页完整状态与敏感值”的持久化事实。
- Python runtime 不会直接读取这两层文档；主进程只会把运行边界参数和宿主私桥 bootstrap 传给 Python。

## 宿主私桥是当前安全边界的一部分

当前系统最关键的一条边界已经明确：provider 状态与 secrets 真源留在 Electron 主进程，Python runtime 只在执行阶段通过宿主私桥按需解析本轮路由。

### 请求中的模型已经变成路由对象

当前前端在主链发送 `run/start` 时，带的是 `modelRoute`，而不是单一字符串 `model`。兼容入口 [`message/send`](./chat-runtime-contract.md) 也映射到同一请求语义。这条路由对象包含：

- `providerProfileId`
- `snapshot.provider`
- `snapshot.endpointType`
- `snapshot.baseUrl`
- `snapshot.modelId`

这里的语义已经固定：`providerProfileId` 用来稳定定位本地 provider profile，快照字段用来表达本次请求认定的路由并参与一致性校验。

### Python runtime 在执行前才向宿主取密钥

当前消息执行阶段会按下面顺序工作：

1. 前端发送携带 `modelRoute` 的 `run/start` 请求，或通过 [`message/send`](./chat-runtime-contract.md) 进入兼容映射。
2. Python run 编排层读取请求中的 `modelRoute`。
3. Python runtime 通过宿主私桥按 `providerProfileId` 解析 provider profile 与 API key。
4. 宿主用 `snapshot` 校验 `provider`、`endpointType`、`baseUrl` 与 `modelId` 是否仍与本地配置一致。
5. 校验通过后，Python runtime 才真正连接上游模型并输出流式文本。

因此，密钥不会进入公开快照，不会进入 renderer 公共状态，也不会出现在消息请求体和流式事件里。

## 聊天主路径已经收口为 thread/run 主链 + compat 壳

当前聊天主路径已经不再围绕全局 `agentName` 或旧的 `agent/run` 叙事组织。跨前后端一致的实际主链是下面这组步骤：

1. renderer 调用 `agents/list`，从后端获取智能体目录。
2. 用户选择智能体后，renderer 调用 `thread/create`，由后端创建 thread 并绑定该智能体。
3. 用户发送消息时，renderer 调用 `run/start`，并在请求里显式携带 `modelRoute`、`enabledTools` 与 `requestOptions`。
4. renderer 调用 `run/stream` 消费同一 `runId` 的 SSE 事件流。
5. 用户主动中断时，renderer 调用 `run/cancel` 请求终止。

这条链路体现的是三层分工：

- 智能体目录由后端给出。
- thread 在创建时绑定智能体。
- 模型路由、工具列表和请求选项在每次 run 请求里决定。

`session/create`、`capabilities/get` 与 [`message/send`](./chat-runtime-contract.md) 当前仍然可用，但它们是对 thread/run 主链的兼容映射层。当前工具信息边界也已经稳定：工具目录由 `thread/get` 或 `capabilities/get` 的投影结果下发，请求层只通过 `enabledTools` 传启用工具 ID，真实工具生命周期通过 `tool_event` 在消息流里回传。

### 当前事件集合已经固定到 run 语义

当前正式事件集合包括：

- `run_started`
- `tool_event`
- `text_delta`
- `run_completed`
- `run_failed`
- `run_cancelled`
- `run_diagnostic`

其中 `tool_event` 已经用于承载真实工具生命周期步骤，并通过 `phase` 区分 `started`、`completed` 与 `failed`。

这说明当前主线已经从“整包响应”切换到了“typed event stream + run 终态收口”。

### 当前归档规则已经与流式主线对齐

当前归档规则也已经固定下来：

- 增量阶段只累计 assistant 草稿。
- `tool_event` 步骤会显示在当前消息流里，但不会写入正式后端会话历史。
- 只有 `run_completed` 到来后，后端才会把最终 assistant 文本写入正式会话历史。
- `run_failed` 和 `run_cancelled` 都不会归档 assistant 成功消息。

## 首次启动仍然允许是空白配置

当前默认状态仍然允许：

- provider profiles 为空数组。
- 默认模型路由为空字符串。
- 聊天区在没有模型时显示空白状态并提示用户先去设置页补齐模型服务。

这意味着首次启动时应用不会自动带着一组预填好的 provider 和模型进入聊天主线。当前主线要求用户真正配置 provider profile，并在发送时显式选定一条模型路由。

## 当前系统关系图

```text
Electron Main Process
  ├─ 产品命名与 userData 路径
  ├─ Config Center
  │    ├─ 公开域文档
  │    └─ 公开快照投影与广播
  ├─ Settings Workspace
  │    ├─ provider profile 状态
  │    └─ provider secret 状态
  ├─ Host Model Route Bridge
  │    └─ 按请求解析 provider route 与 auth
  ├─ Hosted Backend Lifecycle
  │    ├─ 启动 / 重试 / 停止
  │    └─ runtime 快照与失败摘要
  └─ Preload / IPC
             │
             ▼
Renderer Workbench
  ├─ 根装配读取公开快照与 runtime 快照
  ├─ AssistantWorkspace 进入 thread/run 聊天主链
  ├─ Chat Panel 以 run 状态机消费流式事件
  └─ SettingsWorkspace 读写普通状态与 secrets
             │
             ▼
Python Desktop Runtime
  ├─ 控制面 HTTP 端点
  ├─ POST / 聊天入口
  ├─ protocol / router / message_runs
  ├─ run_events SSE 编码
  └─ InMemorySessionStore
```

## 当前已经成立的系统事实

- Electron 产品命名、窗口标题与 `userData` 命名已经统一收口到 `CanDue`。
- 配置持久化已经形成“统一配置中心 + settings workspace”双层结构。
- provider profiles 与 secrets 真源已经稳定落在 Electron 主进程。
- Python runtime 通过宿主私桥在执行阶段解析 provider 路由与密钥，不再通过 startup model 参数承载聊天执行配置。
- thread/run 六方法已经成为真实主链；`session/create`、`capabilities/get`、[`message/send`](./chat-runtime-contract.md) 作为兼容壳保留。
- 后端默认 collector 已经切到 provider-native raw stream；`result.stream_text()` 文本流路径只作为 fallback。
- 同一 run 内的 text → tool → text 交错链已经可稳定表达。
- 当后端观察到 raw tool-call 参数完备却没有真实工具执行时，运行时会显式输出诊断并失败收口，不会静默 completed。
- 首刀真实工具 `tool.weather-current` 已经进入默认工具目录，并通过 `tool_event` 在聊天消息流里回传 `started`、`completed` 与 `failed`。
- 本地 smoke 当前是双轨：`frontend-copilot/scripts/smoke-thread-run-chat.mjs` 覆盖 thread/run 主链，`frontend-copilot/scripts/smoke-streaming-chat.mjs` 覆盖兼容壳。
- `COPILOT_RUNTIME_CHAIN_DEBUG` 可用于采集 collector、tool-call 与终态收口链路的结构化调试日志。
- CopilotKit 依赖已经移除；仓库里保留的 `copilot` 命名当前主要是内部历史命名空间。

## 当前仍然要保守描述的地方

- Python runtime 当前不会主动读取统一配置中心或 settings workspace 文档。
- 会话历史仍然保存在后端进程内的 `InMemorySessionStore` 中，runtime 重启后不会自动恢复。
- hosted runtime 的状态变化还没有形成完整、持续的 renderer 实时推送流。
- 旧的 `info`、`agent/connect` 与 `agent/run` 已退役；仓库里若仍出现相关文字，应该理解为历史背景而不是当前可用入口。

## 相关文档

- [给开发者](../developers/getting-started.md)
- [系统架构](../developers/architecture.md)
- [聊天运行时](../developers/chat-runtime.md)
- [配置与状态模型](../developers/config-and-state.md)
- [Provider 与模型路由说明](../reference/providers-and-routing.md)
- [运行时接口 / 事件参考](../reference/runtime-events.md)

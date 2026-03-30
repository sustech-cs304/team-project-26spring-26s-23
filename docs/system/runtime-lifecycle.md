---
title: 运行时生命周期
description: 说明桌面应用当前怎样启动窗口、装配配置、拉起本地 runtime，并在启动页可见后进入正式工作台。
sidebar_position: 2
---

# 运行时生命周期

## 文档目标

本文档说明当前桌面应用怎样完成这几件事：

- Electron 主进程怎样创建但延迟显示窗口。
- renderer 怎样先准备启动页主题，再发出 bootstrap ready 信号。
- 主进程怎样拉起 hosted backend，并向 renderer 暴露当前可读的 runtime 快照。
- 配置中心公共快照怎样参与启动装配，又怎样通过订阅链路继续更新。

本文档只描述当前已经落地的行为。聊天协议细节和系统状态分层会分别放在[聊天运行时契约](./chat-runtime-contract.md)和[会话与状态模型](./session-and-state-model.md)中展开。

## 一张总图

当前启动主线可以概括成下面这条链路：

```text
Electron main 进入 whenReady
  → 注册当前 preload / IPC 暴露面
  → 异步启动 hosted backend
  → 创建 BrowserWindow，并保持 show: false
  → renderer 预先读取公开配置快照，准备启动页主题
  → renderer 渲染启动页
  → renderer 在下一次绘制后发送 bootstrap ready 信号
  → main 收到信号后显示窗口
  → renderer 继续装配配置状态、runtime 状态与工作台
```

这条链路里有两个容易写错的点。

- 主窗口当前会尽早创建，但不会立刻显示。
- renderer 当前已经拥有公开配置快照的订阅链路，配置变化后可以继续刷新根装配状态。

## 运行时模式

Electron 仍然根据 `app.isPackaged` 选择 hosted backend 的启动方式。主判断和服务创建位于[`frontend-copilot/electron/main.ts`](../../frontend-copilot/electron/main.ts)与[`frontend-copilot/electron/runtime/python-runtime-resolver.ts`](../../frontend-copilot/electron/runtime/python-runtime-resolver.ts)。

### Development 模式

当 `app.isPackaged === false` 时，主进程会把工作区中的 `backend/` 目录作为后端源码目录，并通过 `python -m app.desktop_runtime` 启动本地 Python runtime。解析器会优先尝试工作区虚拟环境中的 Python，可用时直接使用该解释器。

### Bundled 模式

当 `app.isPackaged === true` 时，主进程会从 `resources/python-runtime/` 中读取打包后的运行时清单，再据此解析 Python 可执行文件、后端工作目录和入口模块。清单准备逻辑位于[`frontend-copilot/scripts/prepare-bundled-runtime.mjs`](../../frontend-copilot/scripts/prepare-bundled-runtime.mjs)。

## 主进程启动顺序

### 生命周期处理器会先完成注册

[`frontend-copilot/electron/main.ts`](../../frontend-copilot/electron/main.ts)在模块加载阶段就调用 `registerApplicationLifecycleHandlers()`。因此，`window-all-closed`、`activate` 和 `before-quit` 这些收尾逻辑会早于真正的窗口创建完成注册。

### `app.whenReady()` 之后会进入三件并行相关的工作

主进程在 `whenReady` 成功后会依次完成下面几步：

1. 主进程会调用 `registerRendererIpcHandlers()`，把当前 renderer 需要的公开接口全部挂到 IPC 上。
2. 主进程会调用 `startHostedBackend()`，但这个调用使用 `void` 启动，因此不会阻塞后续窗口创建。
3. 主进程会立即调用 `createWindow()` 创建主窗口。

这意味着当前系统的窗口创建与后端就绪不是同一个等待点。窗口会先被创建，后端会在后台继续启动，真正的可见时机会交给 bootstrap ready 信号控制。

### 主窗口当前采用延迟显示

[`frontend-copilot/electron/main.ts`](../../frontend-copilot/electron/main.ts)中的 `BrowserWindow` 配置明确设置了 `show: false`。窗口创建后会开始加载 renderer 页面，但主进程不会在 `did-finish-load` 时直接调用 `show()`。

实际显示动作由[`frontend-copilot/electron/bootstrap-window-controller.ts`](../../frontend-copilot/electron/bootstrap-window-controller.ts)中的 `showWindowWhenBootstrapScreenIsReady()` 控制。只要窗口仍然存在且尚未可见，主进程就会在收到 bootstrap ready 信号后再显示窗口。

## 启动页主题与 bootstrap ready 信号

### 启动页主题会先于正式工作台准备

renderer 入口位于[`frontend-copilot/src/main.tsx`](../../frontend-copilot/src/main.tsx)。它在真正渲染 React 根节点前，会先调用[`frontend-copilot/src/startup-theme.ts`](../../frontend-copilot/src/startup-theme.ts)中的 `primeStartupTheme()`。

这一步会先按系统主题写入一个回退值，再尝试读取公开配置快照中的 `theme` 字段。如果读取成功，启动页会尽早使用配置中心中的主题值。这样做的直接结果是，窗口首次可见时，启动页主题已经过一次准备，不需要先闪出默认主题再切换。

### 启动页可见后才会通知主进程显示窗口

renderer 在渲染出启动页后，不会立刻通知主进程。它会调用[`frontend-copilot/src/bootstrap-window.ts`](../../frontend-copilot/src/bootstrap-window.ts)中的 `waitForNextPaint()`，等待两个 `requestAnimationFrame` 周期之后，再通过 preload API 触发 `signalBootstrapScreenReady()`。

对应的 IPC 信道是 `bootstrap-window:ready`，定义位于[`frontend-copilot/electron/bootstrap-window.ts`](../../frontend-copilot/electron/bootstrap-window.ts)。主进程收到该调用后，会执行 `notifyBootstrapWindowReady()`，最终进入 `showWindowWhenBootstrapScreenIsReady()`。

因此，当前窗口延迟显示的意义很明确：主进程等待的是“启动页已经实际绘制”，而不是“runtime 已经 ready”或“工作台已经完全加载”。

## 当前 preload 暴露面与 IPC 名称

当前 preload 入口是[`frontend-copilot/electron/preload.ts`](../../frontend-copilot/electron/preload.ts)。它对 renderer 暴露的是几组分开的 API，而不是旧文档里那种单一 settings bridge。

| 能力分组 | window 暴露名 | 当前 IPC 名称 | 作用 |
| --- | --- | --- | --- |
| 公开配置快照读取 | `window.configCenterPublicSnapshot` | `config-center:load-public-snapshot` | renderer 读取公开配置中心快照。 |
| 公开配置补丁写回 | `window.configCenterPublicPatch` | `config-center:apply-public-patch` | renderer 提交公开字段补丁，由主进程写回对应域文件。 |
| 公开配置快照订阅 | `window.configCenterPublicSnapshotSubscription` | `config-center:public-snapshot-updated` | 主进程在公开快照更新后向所有窗口广播。 |
| settings workspace 普通状态 | `window.settingsWorkspaceState` | `settings-workspace:state-load` 与 `settings-workspace:state-save` | 设置页读取和保存普通持久化状态。 |
| settings workspace secrets | `window.settingsWorkspaceSecrets` | `settings-workspace:secrets-load-statuses`、`settings-workspace:secrets-load-sustech-cas`、`settings-workspace:secrets-save-provider-api-key`、`settings-workspace:secrets-clear-provider-api-key`、`settings-workspace:secrets-save-sustech-cas`、`settings-workspace:secrets-clear-sustech-cas` | 设置页读取 secret 状态、加载具体 secret、保存与清除 secret。 |
| hosted runtime 快照 | `window.copilotRuntime` | `copilot-runtime:load` 与 `copilot-runtime:retry` | renderer 读取当前 runtime 快照，并触发重试。 |
| bootstrap ready | `window.bootstrapWindow` | `bootstrap-window:ready` | renderer 告知主进程启动页已经可以对用户显示。 |

除此之外，preload 还会通过[`frontend-copilot/electron/renderer-ipc.ts`](../../frontend-copilot/electron/renderer-ipc.ts)注册 `runtime:main-console` 监听，把主进程的运行日志转发到浏览器控制台。这条链路属于日志可见性，不属于给业务页面直接调用的公开 API。

## 启动时的配置读取与公开订阅

### 根装配会同时读取公开配置快照和 runtime 快照

[`frontend-copilot/src/CopilotAppRoot.tsx`](../../frontend-copilot/src/CopilotAppRoot.tsx)启动后，会调用[`frontend-copilot/src/features/copilot/config.ts`](../../frontend-copilot/src/features/copilot/config.ts)中的 `loadCopilotConfigState()`。这个函数会并行做两件事：

1. 它会通过 `loadConfigCenterPublicSnapshot()` 读取公开配置中心快照。
2. 它会通过 `loadCopilotRuntime()` 读取 hosted runtime 快照。

然后，renderer 会把这两部分信息合并为当前 `CopilotBootstrapState`。因此，当前根装配从一开始就同时依赖配置事实和运行事实。

### 公开配置快照已经具备订阅更新链路

[`frontend-copilot/src/features/copilot/config-center.ts`](../../frontend-copilot/src/features/copilot/config-center.ts)已经对外提供 `subscribeToConfigCenterPublicSnapshotUpdates()`。主进程在应用公开补丁后，会通过[`frontend-copilot/electron/main.ts`](../../frontend-copilot/electron/main.ts)中的 `publishConfigCenterPublicSnapshotUpdate()` 广播新的公开快照。

[`frontend-copilot/src/CopilotAppRoot.tsx`](../../frontend-copilot/src/CopilotAppRoot.tsx)收到订阅事件后，会调用 `refreshCopilotBootstrapStateFromPublicSnapshot()`。这一步不会只重算本地 state，它还会再次读取当前 runtime 快照，然后重新得出新的 bootstrap 状态。

因此，当前 renderer 已经不能再写成“只有一次性 snapshot、没有后续更新”。准确的说法是：

- 公开配置中心已经有订阅链路。
- 公开配置变化到来时，根装配会据此重新计算状态，并顺带刷新一次 runtime 快照。
- hosted runtime 自身还没有独立的持续推送通道，读取方式仍然以 `load` 和 `retry` 为主。

### settings workspace 持久化不会进入公开快照

设置页的普通状态与 secrets 当前走的是另一套 API，入口位于[`frontend-copilot/src/workbench/settings/workspace-state.ts`](../../frontend-copilot/src/workbench/settings/workspace-state.ts)。这部分状态虽然也由主进程持久化，但它不会投影进公开配置快照。

因此，启动主线中的“公开配置读取”与“设置工作区持久化”需要分开理解。前者参与根装配和主题准备，后者主要服务设置工作区本身。

## Hosted backend 的启动与就绪

### 主进程会先构造服务，再按当前配置启动 Python runtime

[`frontend-copilot/electron/main.ts`](../../frontend-copilot/electron/main.ts)中的 `ensureHostedBackendService()` 会先准备运行时目录，再解析命令行参数，并从统一配置中心完整快照中读取 `backendExposed.model`。这个模型字段随后会作为 hosted backend 的启动配置之一，交给 `createHostedBackendService()`。

这里有两个实际含义：

- runtime 的默认模型投影属于主进程启动逻辑的一部分。
- Python runtime 当前不会自己去读配置中心文件，它接收的是主进程整理后的 CLI 参数。

### 启动过程仍然以健康检查作为 ready 条件

主进程最终会通过[`frontend-copilot/electron/runtime/python-runtime-manager.ts`](../../frontend-copilot/electron/runtime/python-runtime-manager.ts)拉起 Python 子进程，并轮询 `GET /ready`。只有 readiness 检查成功后，hosted backend 状态才会进入 `ready`。

后端应用本身由[`backend/app/desktop_runtime/server.py`](../../backend/app/desktop_runtime/server.py)创建。它会在 FastAPI lifespan 中准备 runtime 依赖，并暴露 `/health`、`/ready`、`/version`、`/build-info`、`/diagnostics` 等控制面端点，同时把聊天主路径挂在根路径 `POST /` 上。

### renderer 读取到的是主进程整理后的 runtime 快照

主进程通过[`frontend-copilot/electron/main.ts`](../../frontend-copilot/electron/main.ts)中的 `buildCopilotRuntimeSnapshot()` 向 renderer 返回 `CopilotRuntimeSnapshot`。当前快照会包含下面这些信息：

- `status` 会反映 `starting`、`ready`、`failed`、`degraded` 或 `stopped`。
- `expectedMode` 会告诉 renderer 当前期望是 development 还是 bundled。
- `resolvedMode` 会告诉 renderer 已经解析出的实际 Python runtime 模式。
- `runtimeUrl` 会告诉 renderer 当前可用的 loopback 地址。
- `failure` 会带上最近一次失败摘要。

如果 hosted backend 仍在启动中，而底层状态还停留在 `stopped`，主进程会把快照状态修正为 `starting`，从而让 renderer 得到更符合用户感知的启动状态。

## 当前聊天进入工作台后的主路径位置

当根装配已经拿到可用 `runtimeUrl` 时，工作台会进入 session-first 聊天主路径。相关前端实现主要位于[`frontend-copilot/src/workbench/assistant/AssistantWorkspace.tsx`](../../frontend-copilot/src/workbench/assistant/AssistantWorkspace.tsx)和[`frontend-copilot/src/features/copilot/CopilotChatPanel.tsx`](../../frontend-copilot/src/features/copilot/CopilotChatPanel.tsx)。

当前正式链路会依次完成下面这些步骤：

1. renderer 会调用 `agents/list` 获取后端智能体目录。
2. 用户选择智能体后，renderer 会调用 `session/create` 创建会话，并在创建时绑定智能体。
3. renderer 会继续调用 `capabilities/get` 取得 `capabilitiesVersion`、工具目录、推荐工具和默认模型偏好。
4. 用户发送消息时，renderer 会调用 `message/send`，并在每次请求里显式传入 `model`、`enabledTools` 与 `requestOptions`。

因此，runtime 就绪之后进入的已经是会话优先主路径，不再是旧文档中那种围绕旧 IPC 名称和旧 agent 入口展开的描述。

## 停止与回收

### 正常退出时，主进程会先清理 hosted backend

当应用进入 `before-quit` 时，[`frontend-copilot/electron/main.ts`](../../frontend-copilot/electron/main.ts)会先把 `quitSequenceStarted` 置为真，再调用 `stopHostedBackend()`。只有这一步结束后，主进程才会继续执行 `app.quit()`。

底层停止逻辑由[`frontend-copilot/electron/runtime/python-runtime-manager.ts`](../../frontend-copilot/electron/runtime/python-runtime-manager.ts)负责。它会先尝试优雅停止，再在需要时执行更强制的回收动作，并把状态与失败信息写回诊断体系。

### 异常退出后，主进程会保留失败摘要

如果 runtime 在启动期退出，状态会进入 `failed`。如果 runtime 曾经 ready，后来又退出，状态会进入 `degraded`。失败摘要会通过 `CopilotHostedRuntimeFailureSummary` 暴露给 renderer，同时也会进入主进程日志和运行诊断文件。

## 当前边界

### 当前已经成立的事实

- 主窗口已经采用延迟显示，显示时机由 bootstrap ready 信号控制。
- 启动页主题会在工作台加载前根据公开配置快照先做准备。
- 公开配置中心已经具备读取、补丁写回和订阅更新三条链路。
- settings workspace 普通状态与 secrets 已经形成独立的主进程持久化接口。
- hosted backend 的创建、启动、失败摘要和停止都由 Electron 主进程统一持有。

### 当前仍然需要保守描述的地方

- hosted runtime 状态还没有面向 renderer 的持续推送通道。
- settings workspace secrets 仍然由主进程 owner 持有，不会进入公开快照。
- 会话历史当前仍然保留在 Python runtime 进程内存中，runtime 重启后不会自动恢复。
- 窗口显示不等待 runtime ready，因此用户先看到的仍然可能是启动页或错误态壳层。

## 相关文档

- [系统架构总览](./architecture-overview.md)
- [会话与状态模型](./session-and-state-model.md)
- [聊天运行时契约](./chat-runtime-contract.md)

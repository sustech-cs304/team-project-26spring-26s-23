---
title: 运行时生命周期
description: 说明桌面应用当前怎样命名宿主、准备持久化目录、延迟显示窗口，并托管 Python runtime。
sidebar_position: 2
---

# 运行时生命周期

这篇文档只说明当前桌面应用怎样启动、怎样进入工作台、怎样托管 hosted backend，以及怎样在退出时回收资源。

系统层结构见 [系统架构总览](./architecture-overview.md)，HTTP 端点与字段见 [聊天运行时契约](./chat-runtime-contract.md)，状态持有关系见 [会话与状态模型](./session-and-state-model.md)。

## 先看当前启动主线

```text
Electron main 模块加载
  → 先设置应用名 CanDue
  → 注册应用生命周期处理器
  → app.whenReady()
  → 注册主进程 IPC 处理器
  → 后台启动 hosted backend
  → 创建主窗口，保持 show: false
  → renderer 预热启动页主题
  → renderer 渲染启动页
  → renderer 等待下一次绘制后发送 bootstrap-window:ready
  → main 收到 ready 信号后显示窗口
  → renderer 继续装配公开配置、runtime 快照与工作台
```

这条链路里有三个容易写错的点：

- `CanDue` 的命名收口发生得很早，早于 `userData` 路径解析。
- 主窗口会先创建，但不会立即显示。
- hosted backend 的启动与窗口可见时机不是同一个等待点。

## 第一步：先完成产品命名与目录根路径收口

### Electron 命名已经统一到 `CanDue`

`frontend-copilot/electron/main.ts` 在模块顶层就定义了 `ELECTRON_APPLICATION_NAME = 'CanDue'`，并在任何 `userData` 派生路径被读取前调用 `app.setName()`。`frontend-copilot/electron/main-window.ts` 里的窗口标题也已经统一为 `CanDue`。

这一步的结果很直接：

- Electron 的产品名、窗口标题和打包元数据使用同一组命名。
- `app.getPath('userData')` 解析出的宿主目录也跟随这组命名一致。

### hosted runtime 目录由 `userData` 派生

主进程首次需要路径时，会调用 `createHostedRuntimePaths(app.getPath('userData'))`。当前目录结构会从 `userData` 根目录派生出下面几层：

- `desktop-runtime/`
- `desktop-runtime/config/`
- `desktop-runtime/logs/`
- `desktop-runtime/database/`
- `desktop-runtime/state/`

统一配置中心和 settings workspace 都挂在 `desktop-runtime/config/` 下面。当前统一配置中心会创建自己的 `config-center/` 根目录，settings workspace 的 `settings-workspace-state.json` 与 `settings-workspace-secrets.json` 也会写到这个根目录里。

## 第二步：`app.whenReady()` 之后进入宿主装配

### 生命周期处理器会更早注册

主进程在模块加载阶段就调用应用生命周期注册逻辑，因此 `window-all-closed`、`activate` 和 `before-quit` 这些处理器会早于窗口创建完成注册。

### `whenReady()` 后当前会做三件事

`app.whenReady()` 成功后，主进程会依次执行下面这些动作：

1. 它调用主进程 IPC 注册函数，把 renderer 需要的接口挂到 IPC 上。
2. 它通过 `void startHostedBackend()` 在后台启动 Python hosted backend。
3. 它立即创建主窗口。

这三步的组合意味着，窗口创建不会等待 backend ready；backend 启动失败时，用户看到的也会是启动页或失败态壳层，而不是一个完全没有界面的进程。

## 第三步：主窗口先创建，再等待启动页 ready

### 主窗口当前采用延迟显示

`frontend-copilot/electron/main-window.ts` 创建 `BrowserWindow` 时明确设置了 `show: false`。窗口创建后会开始加载 renderer，但不会在 `did-finish-load` 时直接显示。

### renderer 会主动通知“启动页已经可以显示”

renderer 入口位于 `frontend-copilot/src/main.tsx`。当前链路是这样的：

1. renderer 先调用 `primeStartupTheme()` 预热启动页主题。
2. 它渲染 `BootstrapScreen`。
3. 它等待两个 `requestAnimationFrame` 周期。
4. 它再调用 `notifyBootstrapScreenReady()`，通过 `bootstrap-window:ready` 告诉主进程可以显示窗口。

主进程收到这个信号后，才会进入显示窗口的控制逻辑。

### 这一步等待的不是 runtime ready

当前窗口显示等待的是“启动页已经实际绘制”，而不是“Python runtime 已经健康就绪”或“工作台已经全部完成装配”。这也是当前启动体验比较稳定的原因：用户先看到的是已准备好的启动页，而不是白屏或闪烁主题。

## 第四步：公开配置快照先参与启动装配

### 启动页主题会先读取公开配置

renderer 在真正渲染 React 根节点之前，会先从公开配置快照中尝试读取主题字段。这样做的结果是，启动页在首次可见前就能尽量贴近当前配置，而不是先显示默认主题再切换。

### 根装配会并行读取公开配置与 runtime 快照

`frontend-copilot/src/features/copilot/config.ts` 中的 `loadCopilotConfigState()` 会并行做两件事：

- 它读取统一配置中心投影出来的公开快照。
- 它读取主进程整理后的 hosted runtime 快照。

renderer 会把这两部分信息合成为 `CopilotConfigState`。因此，当前启动状态不是单看配置文件，也不是单看 runtime，而是两类事实一起决定。

### 公开配置已经具备订阅更新链路

主进程在公开补丁写回后，会广播新的公开快照。renderer 订阅到这类更新后，会重新计算根装配状态，并顺带再次读取当前 runtime 快照。

这条链路说明一件事：当前公开配置不是一次性快照。主题、动画、`runtimeUrl`、`agentName` 或宿主投影模型发生变化后，renderer 可以收到新的公开快照并刷新自己的根状态。

### settings workspace 不参与根装配快照

settings workspace 的普通状态与 secrets 也由主进程持久化，但它们不进入公开快照。启动主线里的根装配只消费公开配置中心与 hosted runtime 快照；设置页自己的完整状态会在进入设置工作区后通过独立 API 读取。

## 第五步：主进程托管 Python hosted backend

### 启动前会先准备目录与启动参数

主进程在确保 hosted backend 服务时，会先准备 runtime 目录，再解析命令行参数，并从统一配置中心读取 `backendExposed.model` 作为已配置默认模型。

这一步说明两件事：

- 公开配置中的模型字段会影响宿主启动 Python runtime 的参数。
- Python runtime 当前不会自己去读取配置中心或 settings workspace 文档。

### 启动模式仍然分 development 与 bundled

主进程仍然根据 `app.isPackaged` 决定 Python runtime 的启动方式：

- 在 development 模式下，它会从工作区后端源码目录启动本地 Python runtime。
- 在 bundled 模式下，它会从打包后的运行时清单解析 Python 可执行文件、工作目录与入口模块。

### renderer 读取的是宿主整理后的 runtime 快照

preload 暴露给 renderer 的是 `copilotRuntime.load()` 与 `copilotRuntime.retry()` 两个接口。它们对应的是主进程整理后的 `CopilotRuntimeSnapshot`，而不是 Python 进程内部对象。

当前快照至少会告诉 renderer：

- hosted backend 处于 `starting`、`ready`、`failed`、`degraded` 或 `stopped` 哪种状态。
- 当前期望模式与已解析模式分别是什么。
- 当前是否已经有可用的 `runtimeUrl`。
- 最近一次失败摘要是什么。

## 第六步：根装配怎样判断能否进入工作台

### hosted runtime ready 时，系统直接进入宿主管理路径

当 hosted runtime 处于 `ready` 或 `degraded`，并且主进程给出了可用 `runtimeUrl` 时，renderer 会把当前连接来源认定为宿主管理路径。

### development override 仍然保留

当前公开配置中的 `hostConfig.runtimeUrl` 仍然保留开发态 override 作用。在未打包的 development 场景里，如果 hosted backend 失败或停止，但公开配置里配置了可用 `runtimeUrl`，renderer 仍然可以用这个地址进入可连接状态。

### 空白首次状态已经更明确

如果 hosted runtime 处于 `stopped`，同时公开配置里也没有 `runtimeUrl`，根装配会把当前系统视为 `empty`。这和最近的默认值收口是一致的：首次状态允许是空白的，而不是强行预填一组 provider 或模型。

## 当前 preload 暴露面的职责

当前 preload 负责把主进程受控能力暴露给 renderer，主要包括下面几组接口：

| 能力 | 当前接口或信道 | 作用 |
| --- | --- | --- |
| 公开配置快照读取 | `configCenterPublicSnapshot.load()` | 读取公开配置快照。 |
| 公开配置补丁写回 | `configCenterPublicPatch.apply()` | 提交公开字段补丁。 |
| 公开配置订阅 | `configCenterPublicSnapshotSubscription` | 接收公开快照更新广播。 |
| settings workspace 普通状态 | `settings-workspace-state:load` 与 `settings-workspace-state:save` | 读取和保存设置工作区普通状态。 |
| settings workspace secrets | `settings-workspace-secrets:*` | 读取、保存和清除 provider API key 与 CAS 密码。 |
| hosted runtime 快照 | `copilot-runtime:load` 与 `copilot-runtime:retry` | 读取当前 runtime 快照并触发重试。 |
| 启动页 ready | `bootstrap-window:ready` | 告诉主进程启动页已经可显示。 |

这套暴露面已经不再是早期单一 settings bridge 的结构，而是按公开配置、设置工作区、runtime 和启动控制四类职责分开。

## 退出、失败与恢复

### 正常退出时，主进程会先停止 hosted backend

应用进入 `before-quit` 时，主进程会先启动清理序列，再停止 hosted backend。清理结束后才继续真正退出。

### 失败摘要会保留在宿主快照里

如果 runtime 在启动阶段失败，状态会进入 `failed`；如果它曾经 ready，后来又退出，状态会进入 `degraded`。这些失败摘要会进入主进程日志与 runtime 快照，供 renderer 展示失败态。

### 用户可以通过 retry 重新触发启动

renderer 当前可以调用 `copilotRuntime.retry()`，由主进程重新准备路径、复用 hosted backend 服务，并再次尝试拉起 Python runtime。

## 当前已经成立的生命周期事实

- 应用名、窗口标题与 `userData` 命名已经统一收口到 `CanDue`。
- 主窗口已经采用延迟显示，显示时机由启动页 ready 信号决定。
- 公开配置快照会参与启动页主题和根装配，并且已经有订阅更新链路。
- settings workspace 已经形成独立的主进程持久化接口，但它不参与根装配公开快照。
- hosted backend 的创建、启动、失败、重试与停止都由 Electron 主进程托管。

## 当前仍然要保守描述的地方

- hosted runtime 的全部状态变化还没有形成面向 renderer 的持续实时推送。
- settings workspace 的变化当前也没有跨工作区的统一订阅流。
- 窗口显示不等待 runtime ready，因此用户首次可见内容仍然可能是启动页或失败态壳层。
- 会话历史仍然留在 Python 进程内存里，runtime 重启后不会自动恢复。

## 相关文档

- [系统架构总览](./architecture-overview.md)
- [聊天运行时契约](./chat-runtime-contract.md)
- [会话与状态模型](./session-and-state-model.md)

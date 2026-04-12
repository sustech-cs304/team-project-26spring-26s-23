---
title: 运行时生命周期
description: 说明桌面应用当前怎样托管 Python runtime、怎样注入宿主私桥 bootstrap，以及窗口怎样进入工作台。
sidebar_position: 2
---

# 运行时生命周期

这篇文档只说明当前桌面应用怎样启动、怎样托管 hosted backend，以及窗口怎样进入工作台。系统层结构见 [系统架构总览](./architecture-overview.md)，HTTP 契约见 [聊天运行时契约](./chat-runtime-contract.md)，状态分层见 [会话与状态模型](./session-and-state-model.md)。

## 先看当前启动主线

```text
Electron main 模块加载
  → 尽早设置应用名 CanDue
  → 注册应用生命周期处理器
  → app.whenReady()
  → 注册主进程 IPC
  → 后台启动 hosted backend
       → 创建宿主私有 provider route bridge
       → 生成 bridge bootstrap
       → 把路径、端口、local token 与 bridge bootstrap 传给 Python runtime
  → 创建主窗口，保持 show: false
  → renderer 预热启动页主题并渲染 BootstrapScreen
  → renderer 发送 bootstrap-window:ready
  → main 收到 ready 信号后显示窗口
  → renderer 继续读取公开配置快照与 runtime 快照，装配工作台
```

这条链路里有三件事最容易写错：

- 窗口显示等待的是启动页 ready，而不是 Python runtime ready。
- Python runtime 的聊天执行配置不再来自 startup `model` 参数。
- 宿主在启动阶段只注入 bridge bootstrap，真正的 provider 路由解析与取密钥发生在每次消息执行前。

## 第一步：先完成产品命名与运行目录收口

### Electron 命名已经统一到 `CanDue`

`frontend-copilot/electron/main.ts` 会在任何 `userData` 派生路径被读取前调用 `app.setName('CanDue')`，因此产品名、窗口标题与 `userData` 目录命名都会使用 `CanDue`。

### hosted runtime 目录仍然由 `userData` 派生

主进程准备运行路径时，会从 `userData` 根目录派生出下面这组目录：

- `desktop-runtime/`
- `desktop-runtime/config/`
- `desktop-runtime/logs/`
- `desktop-runtime/database/`
- `desktop-runtime/state/`

settings workspace 与统一配置中心都落在 `config/` 子树下。provider profiles 和 secrets 继续由 Electron 主进程持有，不会在启动阶段被整体下发给 Python runtime。

## 第二步：`app.whenReady()` 之后进入宿主装配

`app.whenReady()` 成功后，主进程会依次执行下面这些动作：

1. 它注册主进程 IPC，把公开配置、settings workspace 和 runtime 快照接口暴露给 renderer。
2. 它在后台启动 hosted backend。
3. 它立即创建主窗口，但窗口仍然保持隐藏。

这三步并行推进，所以用户先看到的是启动页或失败态壳层，而不是“等待 backend ready 后再出现窗口”的流程。

## 第三步：主进程先创建宿主私有 provider route bridge

### 宿主私桥在 Electron main 里创建

当前主进程会先创建一个只监听 loopback 的宿主私桥。桥的职责很单一：

- 它接收 Python runtime 发来的 `providerProfileId + snapshot` 请求。
- 它调用 settings workspace 的 `resolveProviderRoute()` 读取当前 provider profile 与 secret。
- 它返回本轮执行所需的连接信息与认证信息，或者返回稳定的解析错误。

对应实现主要落在下面这些文件里：

- `frontend-copilot/electron/runtime/host-model-route-bridge.ts`
- `frontend-copilot/electron/main.ts`
- `frontend-copilot/electron/settings-workspace/service.ts`

### 启动阶段只下发 bridge bootstrap

主进程启动 Python runtime 时，会把下面这些信息作为启动参数传入：

- host 与 port。
- `app_mode` 与 `environment`。
- 各类运行目录路径。
- 可选的 `--local-token`。
- `--host-model-route-bridge-url` 与 `--host-model-route-bridge-token`。

这里要分清边界：bridge bootstrap 只是让 Python 知道“去哪里、用什么 token 调宿主私桥”。聊天真正使用哪条 provider 路由，仍然要等 [`message/send`](./chat-runtime-contract.md) 到来后，由请求里的 `modelRoute` 决定。

## 第四步：Python runtime 在启动时只装配运行边界

### Python server 会创建宿主私桥客户端

Python runtime 启动后，会先解析运行参数，再构造一个宿主私桥客户端：

- `backend/app/desktop_runtime/config.py` 负责读取目录、网络参数、local token 与 bridge bootstrap。
- `backend/app/desktop_runtime/host_model_route_bridge.py` 负责在消息执行阶段请求宿主私桥。
- `backend/app/desktop_runtime/server.py` 会把这个客户端注入聊天运行时依赖。

### startup 阶段不再传聊天模型执行配置

当前启动层已经不再用 startup `model` 参数来决定聊天执行模型。对 Python runtime 来说，启动阶段只负责这些事情：

- 拉起 loopback HTTP 服务。
- 装配控制面端点。
- 准备聊天运行时依赖。
- 保存 bridge bootstrap，以便后续按请求解析 provider 路由。

如果文档仍然把“启动时传 `model` 给 runtime”写成当前主路径，那就已经落后于实现事实了。

## 第五步：renderer 先等待启动页 ready，再显示窗口

### 主窗口仍然采用延迟显示

主窗口创建时明确设置了 `show: false`。窗口创建后会开始加载 renderer，但不会在 `did-finish-load` 时直接显示。

### renderer 会主动发出 ready 信号

renderer 入口会先预热启动页主题，再渲染 `BootstrapScreen`，随后通过 `bootstrap-window:ready` 告诉主进程启动页已经可以显示。主进程收到这个信号后，才会真正显示窗口。

这一步等待的是“启动页已经实际绘制”，不是“聊天后端已经 ready”。

## 第六步：根装配先读取公开配置快照与 runtime 快照

renderer 真正装配工作台时，会先读取两类输入：

- 统一配置中心投影出来的公开快照。
- 主进程整理后的 hosted runtime 快照。

这一步有两个边界：

- settings workspace 的完整 provider 状态与 secrets 不会直接进入公开快照。
- 根装配当前判断连接可用，主要仍然看 `runtimeUrl`，而不是旧的全局 model 字段。

## 第七步：聊天执行阶段才发生真实路由解析

当用户真正发送一条 [`message/send`](./chat-runtime-contract.md) 时，当前主线会按下面顺序工作：

1. 前端把 `providerProfileId + snapshot` 放进 `policy.modelRoute`，并在 `enabledTools` 中提交本轮启用工具 ID。
2. Python runtime 创建 run，先发出 `run_started` 事件。
3. run 编排层通过宿主私桥解析当前 provider profile 与 API key。
4. 宿主私桥用请求中的路由快照校验 `provider`、`endpointType`、`baseUrl` 与 `modelId`。
5. 校验通过后，Python runtime 才会真正打开上游模型流。
6. 模型发生工具调用时，运行时会在同一条消息流中发出 `tool_event`，并按 `started`、`completed`、`failed` 回传生命周期阶段。

因此，provider 状态与 secrets 的真源始终留在 Electron 主进程。Python runtime 拿到的是本轮执行所需的最小结果，而不是 settings workspace 的原始文档。

## 第八步：退出、失败与恢复

### 正常退出时，主进程会先停止 Python runtime 和宿主私桥

应用进入退出序列后，主进程会先停止 hosted backend，再停止宿主私桥，最后继续真正退出。

### 失败摘要继续留在宿主快照里

如果 runtime 在启动阶段失败，宿主快照会进入 `failed`；如果它曾经 ready，后来又退出，快照会进入 `degraded`。这些失败摘要会进入主进程日志与 runtime 快照，供 renderer 展示失败态。

### 用户仍然可以通过 retry 重新触发启动

renderer 当前可以调用重试接口，让主进程重新准备运行路径、重建宿主私桥，并再次尝试拉起 Python runtime。

## 当前已经成立的生命周期事实

- 应用名、窗口标题与 `userData` 命名已经统一收口到 `CanDue`。
- 主窗口已经采用延迟显示，显示时机由启动页 ready 信号决定。
- Electron 主进程会先创建宿主私有 provider route bridge，再启动 Python runtime。
- Python runtime 在启动阶段只接收运行边界参数和 bridge bootstrap，不再接收聊天模型执行配置。
- 真实 provider 路由解析、快照校验与取密钥发生在每次 [`message/send`](./chat-runtime-contract.md) 执行阶段。

## 当前仍然要保守描述的地方

- hosted runtime 的全部状态变化还没有形成完整、持续的 renderer 实时推送流。
- settings workspace 的变化当前也没有跨窗口统一订阅流。
- 会话历史仍然保存在 Python 进程内存里，runtime 重启后不会自动恢复。
- 统一配置中心里仍然保留一些旧字段，但它们已经不再决定聊天主线执行。

## 相关文档

- [系统架构总览](./architecture-overview.md)
- [聊天运行时契约](./chat-runtime-contract.md)
- [会话与状态模型](./session-and-state-model.md)

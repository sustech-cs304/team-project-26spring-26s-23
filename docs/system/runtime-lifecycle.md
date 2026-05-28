---
title: 运行时生命周期
description: 说明桌面应用怎样托管 Python runtime、注入宿主私桥 bootstrap，以及窗口怎样进入工作台。
sidebar_position: 2
---

# 运行时生命周期

说明桌面应用怎样启动、托管 hosted backend，以及窗口怎样进入工作台。系统层结构见 [系统架构总览](./architecture-overview.md)，HTTP 契约见 [聊天运行时契约](./chat-runtime-contract.md)，状态分层见 [会话与状态模型](./session-and-state-model.md)。

## 启动主线

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

这条链路需注意三件事：

- 窗口显示等待的是启动页 ready，不是 Python runtime ready。
- Python runtime 的聊天执行配置不来自 startup `model` 参数。
- 宿主在启动阶段只注入 bridge bootstrap，provider 路由解析与取密钥发生在每次消息执行前。

## 第一步：产品命名与运行目录收口

### Electron 命名已统一到 `CanDue`

`frontend-copilot/electron/main.ts` 在任何 `userData` 派生路径被读取前调用 `app.setName('CanDue')`，产品名、窗口标题与 `userData` 目录命名都使用 `CanDue`。

### hosted runtime 目录由 `userData` 派生

主进程准备运行路径时，从 `userData` 根目录派生：

- `desktop-runtime/`
- `desktop-runtime/config/`
- `desktop-runtime/logs/`
- `desktop-runtime/database/`
- `desktop-runtime/state/`

settings workspace 与统一配置中心落在 `config/` 子树下。provider profiles 和 secrets 由 Electron 主进程持有，不在启动阶段整体下发给 Python runtime。

## 第二步：`app.whenReady()` 之后进入宿主装配

`app.whenReady()` 成功后，主进程依次执行：

1. 注册主进程 IPC，把公开配置、settings workspace 和 runtime 快照接口暴露给 renderer。
2. 后台启动 hosted backend。
3. 立即创建主窗口，窗口保持隐藏。

三步并行推进，用户先看到启动页或失败态壳层，不是"等待 backend ready 后再出现窗口"的流程。

## 第三步：主进程先创建宿主私有 provider route bridge

### 宿主私桥在 Electron main 里创建

主进程先创建一个只监听 loopback 的宿主私桥。桥的职责：

- 接收 Python runtime 发来的 `providerProfileId + snapshot` 请求。
- 调用 settings workspace 的 `resolveProviderRoute()` 读取 provider profile 与 secret。
- 返回本轮执行所需的连接信息与认证信息，或返回稳定的解析错误。

对应实现：

- `frontend-copilot/electron/runtime/host-model-route-bridge.ts`
- `frontend-copilot/electron/main.ts`
- `frontend-copilot/electron/settings-workspace/service.ts`

### 启动阶段只下发 bridge bootstrap

主进程启动 Python runtime 时传入：

- host 与 port。
- `app_mode` 与 `environment`。
- 各类运行目录路径。
- 可选的 `--local-token`。
- `--host-model-route-bridge-url` 与 `--host-model-route-bridge-token`。

bridge bootstrap 只让 Python 知道"去哪里、用什么 token 调宿主私桥"。聊天使用哪条 provider 路由，等 [`message/send`](./chat-runtime-contract.md) 到来后由请求里的 `modelRoute` 决定。

## 第四步：Python runtime 在启动时只装配运行边界

### Python server 创建宿主私桥客户端

Python runtime 启动后，先解析运行参数，再构造宿主私桥客户端：

- `backend/app/desktop_runtime/config.py` 读取目录、网络参数、local token 与 bridge bootstrap。
- `backend/app/desktop_runtime/host_model_route_bridge.py` 在消息执行阶段请求宿主私桥。
- `backend/app/desktop_runtime/server.py` 把这个客户端注入聊天运行时依赖。

### startup 阶段不再传聊天模型执行配置

启动层不再用 startup `model` 参数决定聊天执行模型。Python runtime 启动阶段只负责：

- 拉起 loopback HTTP 服务。
- 装配控制面端点。
- 准备聊天运行时依赖。
- 保存 bridge bootstrap，以便后续按请求解析 provider 路由。

启动时传 `model` 给 runtime 已不再是主路径。

## 第五步：renderer 先等待启动页 ready，再显示窗口

### 主窗口采用延迟显示

主窗口创建时设置 `show: false`。窗口创建后加载 renderer，不在 `did-finish-load` 时直接显示。

### renderer 主动发出 ready 信号

renderer 入口预热启动页主题，渲染 `BootstrapScreen`，通过 `bootstrap-window:ready` 告诉主进程启动页已可显示。主进程收到信号后才真正显示窗口。

这一步等待的是"启动页已实际绘制"，不是"聊天后端已 ready"。

## 第六步：根装配先读取公开配置快照与 runtime 快照

renderer 装配工作台时，先读取两类输入：

- 统一配置中心投影出来的公开快照。
- 主进程整理后的 hosted runtime 快照。

两个边界：

- settings workspace 的完整 provider 状态与 secrets 不直接进入公开快照。
- 根装配判断连接可用，主要看 `runtimeUrl`，不是旧的全局 model 字段。

## 第七步：聊天执行阶段才发生真实路由解析

用户发送 [`message/send`](./chat-runtime-contract.md) 时，主线按下面顺序工作：

1. 前端把 `providerProfileId + snapshot` 放进 `policy.modelRoute`，在 `enabledTools` 中提交本轮启用工具 ID。
2. Python runtime 创建 run，先发出 `run_started` 事件。
3. run 编排层通过宿主私桥解析 provider profile 与 API key。
4. 宿主私桥用请求中的路由快照校验 `provider`、`endpointType`、`baseUrl` 与 `modelId`。
5. 校验通过后，Python runtime 打开上游模型流。
6. 模型发生工具调用时，运行时在同一条消息流中发出 `tool_event`，按 `started`、`completed`、`failed` 回传生命周期阶段。

provider 状态与 secrets 的真源始终留在 Electron 主进程。Python runtime 拿到的是本轮执行所需的最小结果。

## 第八步：退出、失败与恢复

### 正常退出时，主进程先停止 Python runtime 和宿主私桥

应用进入退出序列后，主进程先停止 hosted backend，再停止宿主私桥，最后继续真正退出。

### 失败摘要留在宿主快照里

如果 runtime 在启动阶段失败，宿主快照进入 `failed`；如果它曾 ready 后又退出，快照进入 `degraded`。失败摘要进入主进程日志与 runtime 快照，供 renderer 展示失败态。

### 用户可通过 retry 重新触发启动

renderer 可调用重试接口，让主进程重新准备运行路径、重建宿主私桥，再次尝试拉起 Python runtime。

## 已成立的生命周期事实

- 应用名、窗口标题与 `userData` 命名已统一收口到 `CanDue`。
- 主窗口采用延迟显示，显示时机由启动页 ready 信号决定。
- Electron 主进程先创建宿主私有 provider route bridge，再启动 Python runtime。
- Python runtime 在启动阶段只接收运行边界参数和 bridge bootstrap，不再接收聊天模型执行配置。
- 真实 provider 路由解析、快照校验与取密钥发生在每次 [`message/send`](./chat-runtime-contract.md) 执行阶段。

## 需先确认的地方

- hosted runtime 的全部状态变化未形成完整、持续的 renderer 实时推送流。
- settings workspace 的变化没有跨窗口统一订阅流。
- 会话历史保存在 SQLite 持久化存储中，runtime 重启后 thread 列表、历史时间线与已完成 run replay 可从本地 truth / projection 恢复。
- 统一配置中心里保留一些旧字段，它们不再决定聊天主线执行。

## 相关文档

- [系统架构总览](./architecture-overview.md)
- [聊天运行时契约](./chat-runtime-contract.md)
- [会话与状态模型](./session-and-state-model.md)

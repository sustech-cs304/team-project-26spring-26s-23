---
title: 后端暴露契约与前端接入点
description: 说明前端今天怎样进入 Python 后端，以及后端当前真正暴露了哪些连接面。
sidebar_position: 4
sidebar_label: 后端暴露契约与前端接入点
---

# 后端暴露契约与前端接入点

这页只讲前端今天怎样接到后端，以及后端当前真正暴露了哪些连接面。方法字段的细表请看[当前契约参考](./reference-current-contracts.md)，路径和配置来源请看[后端运行与配置](./run-and-config.md)。

## 先分清两层接入点

从 backend 视角看，前端今天接到后端并不是一条单层链路，而是两层接入点叠在一起。

### 第一层是 Electron 主进程提供的宿主接入点

前端 renderer 并不会直接管理 Python 子进程、`userData` 路径或启动参数。当前这些事情都由 Electron 主进程承担：

- 它准备 hosted runtime 路径。
- 它持有统一配置中心和 settings workspace。
- 它决定是否把宿主层字段投影为 Python 启动参数。
- 它启动、停止和重试 Python runtime。
- 它把 hosted runtime 快照整理后暴露给 renderer。

因此，前端真正先接触到的，是宿主层提供的 runtime 快照和公开配置接口，而不是 Python 进程内部对象。

### 第二层是 Python runtime 暴露的 loopback HTTP 契约

一旦主进程把 Python runtime 拉起，后端真正对前端可见的 HTTP 连接面就是同一个 loopback 服务：

- 一组控制面端点。
- 一个统一的聊天根端点 `POST /`。

当前前端的后端联调重点，主要落在这第二层。

## Electron 主进程在 backend 视角下的角色

### 它是配置 owner

统一配置中心和 settings workspace 现在都由主进程持有。Python runtime 当前不会直接读取 `config-center/*.json`、`settings-workspace-state.json` 或 `settings-workspace-secrets.json`。

### 它是 runtime launcher

主进程负责准备路径、构造启动参数、拉起 Python 子进程，并在失败时保留宿主管理下的状态和失败摘要。

### 它是参数投影者

主进程可以把宿主层的字段投影为 Python runtime 的启动参数。当前最典型的一条链路，是把 `backendExposed.model` 解析后投影为 `--model`。

这三件事在 backend 视角下很重要，因为它们解释了当前后端为什么仍然按 CLI 参数工作，却又已经处在 Electron 宿主管理之下。

## 当前 Python 后端真正暴露了什么

## 控制面端点

当前 loopback HTTP 服务已经稳定暴露下面这些控制面端点：

- `GET /health`
- `GET /ready`
- `GET /version`
- `GET /build-info`
- `GET /diagnostics`
- `GET /diagnostics/runtime-info`

这组端点主要回答三类问题：

- 本地 runtime 是否已经启动。
- 当前是否 ready，以及最近一次失败发生了什么。
- 当前运行目录、配置摘要和聊天能力摘要是什么。

在前端视角下，这组端点更像宿主管理下的本地控制面，而不是 Blackboard 或 TIS 业务接口。

## 当前聊天主契约

当前正式聊天主契约已经收口为 session-first 四方法：

1. `agents/list`
2. `session/create`
3. `capabilities/get`
4. `message/send`

这四个方法共同描述了一条更清楚的后端连接主线：

- 后端目录先告诉前端当前有哪些智能体。
- 前端创建会话时，把当前会话绑定到某个智能体。
- 前端再读取这个会话的能力面。
- 每次发送消息时，前端显式带上本次模型和工具策略。

因此，今天前后端真正需要对齐的对象已经是：

- 智能体目录。
- 会话绑定。
- 能力面版本和工具目录。
- 请求级模型与工具策略。

## 当前前端怎样走这条主路径

从 backend 视角看，前端当前主路径可以概括成下面四步：

1. 它先确认 hosted runtime 已经可用，并拿到可访问的 runtime URL。
2. 它调用 `agents/list` 读取后端智能体目录。
3. 它调用 `session/create` 创建会话，并拿到 `sessionId` 和 `boundAgent`。
4. 它调用 `capabilities/get` 与 `message/send` 继续完成会话内交互。

这里最关键的变化，是当前后端已经把“智能体绑定”和“每次请求的模型/工具策略”拆成两层语义。

## 旧兼容方法现在处在什么位置

当前 runtime 仍然保留这些兼容方法：

- `info`
- `agent/connect`
- `agent/run`

它们现在仍然能在支持方法列表、兼容链路和部分旧测试里观察到，但这不代表它们仍然和当前主路径处在同一层级。

在 backend 分册里，更准确的定位是：

- 它们仍然存在。
- 它们继续承担兼容和诊断作用。
- 当前正式前端主路径已经不再围绕它们组织。

## 前端今天还没有直接连到哪些后端能力

### Blackboard 与 TIS 还不是正式前端业务 API

Blackboard 和 TIS 当前已经有真实能力，但这些能力主要以 CLI、工具层、provider 用例和结构化结果对象的形式存在。

这意味着：

- 后端确实已经有可用的领域能力。
- 前端今天还不能把它们当成稳定的业务 HTTP API 去依赖。
- backend 分册里不适合把这两组模块写成已经完整对外开放的服务层。

### settings workspace 也不是 Python runtime 的直接接口层

设置页今天能保存很多字段，但它们并不会被 Python runtime 直接读取。当前真实链路仍然是：

- 主进程持久化设置文档。
- 主进程按需要投影少量字段给 runtime 启动参数。
- Python runtime 继续解释这些启动参数。

## 当前连接面更适合怎样理解

如果只用一句话概括当前后端对前端的连接面，可以这样理解：

- 宿主层负责持有配置、托管 runtime 和投影参数。
- Python 后端负责提供本地控制面和 session-first 聊天主契约。
- Blackboard 与 TIS 则仍然主要停留在领域能力层和未来服务化输入层。

## 这页想帮助你先建立什么判断

- 当前前端已经有真实后端连接面，不再是只参考 CLI 输出的状态。
- 当前真正稳定的连接面，是控制面端点和 session-first 聊天主路径。
- Electron 主进程是这条链路里的配置 owner、runtime launcher 和参数投影者。
- Blackboard 与 TIS 还没有整体进入正式前端业务 API 层。

## 相关文档

- [后端运行与配置](./run-and-config.md)
- [当前契约参考](./reference-current-contracts.md)
- [聊天运行时契约](../system/chat-runtime-contract.md)
- [运行时生命周期](../system/runtime-lifecycle.md)

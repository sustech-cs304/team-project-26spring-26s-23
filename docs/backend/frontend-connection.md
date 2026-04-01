---
title: 后端暴露契约与前端接入点
description: 说明前端当前怎样接到 Python runtime，以及后端真正暴露了哪些连接面。
sidebar_position: 4
sidebar_label: 后端暴露契约与前端接入点
---

# 后端暴露契约与前端接入点

这页只讲前端今天怎样接到后端，以及后端当前真正暴露了哪些连接面。方法字段的细表见 [当前契约参考](./reference-current-contracts.md)，路径和配置来源见 [后端运行与配置](./run-and-config.md)。

## 先分清两层接入点

从 backend 视角看，前端今天接到后端并不是一条单层链路，而是两层接入点叠在一起。

### 第一层是 Electron 主进程提供的宿主接入点

前端 renderer 并不会直接管理 Python 子进程、`userData` 路径或 provider secrets。当前这些事情都由 Electron 主进程承担：

- 它准备 hosted runtime 路径。
- 它持有统一配置中心和 settings workspace。
- 它持有 provider profiles 与 provider secrets 真源。
- 它创建宿主私有 provider route bridge。
- 它启动、停止和重试 Python runtime。
- 它把 hosted runtime 快照整理后暴露给 renderer。

因此，前端真正先接触到的，是宿主层提供的 runtime 快照、公开配置接口和 settings workspace 接口，而不是 Python 进程内部对象。

### 第二层是 Python runtime 暴露的 loopback HTTP 契约

一旦主进程把 Python runtime 拉起，后端真正对前端可见的 HTTP 连接面就是同一个 loopback 服务：

- 一组控制面端点。
- 一个统一的聊天根端点 `POST /`。

当前前端的后端联调重点，主要落在这第二层。

## Electron 主进程在 backend 视角下的角色

### 它是配置 owner

统一配置中心和 settings workspace 现在都由主进程持有。Python runtime 不会直接读取 `config-center/*.json`、`settings-workspace-state.json` 或 `settings-workspace-secrets.json`。

### 它是 runtime launcher

主进程负责准备路径、构造启动参数、拉起 Python 子进程，并在失败时保留宿主管理下的状态和失败摘要。

### 它是路由解析真源的入口

主进程当前还承担一层更关键的职责：它持有 provider profile 元数据与 secrets 真源，并通过宿主私有 provider route bridge 在运行期按请求解析：

- 当前 `providerProfileId` 对应的 provider profile 是否存在。
- 请求中的路由快照是否仍与本地配置一致。
- 当前 provider profile 是否具备可用 API key。

这件事解释了当前后端为什么已经不再需要 startup `model` 参数，却仍然能在每次 [`message/send`](../system/chat-runtime-contract.md) 执行时拿到真实 provider 连接信息。

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

## 当前聊天主契约

当前正式聊天主契约已经收口为 session-first 四方法：

1. `agents/list`
2. `session/create`
3. `capabilities/get`
4. [`message/send`](../system/chat-runtime-contract.md)

这四个方法共同描述了一条更清楚的后端连接主线：

- 后端目录先告诉前端当前有哪些智能体。
- 前端创建会话时，把当前会话绑定到某个智能体。
- 前端再读取这个会话的能力面。
- 每次发送消息时，前端显式带上本次模型路由、工具列表与请求选项。

## 当前前端怎样走这条主路径

从 backend 视角看，前端当前主路径可以概括成下面四步：

1. 它先确认 hosted runtime 已经可用，并拿到可访问的 runtime URL。
2. 它调用 `agents/list` 读取后端智能体目录。
3. 它调用 `session/create` 创建会话，并拿到 `sessionId` 和 `boundAgent`。
4. 它调用 `capabilities/get` 与流式 [`message/send`](../system/chat-runtime-contract.md) 完成会话内交互。

这里最关键的变化有两点：

- 当前后端已经把“智能体绑定”和“每次请求的模型路由”拆成了两层语义。
- 当前 [`message/send`](../system/chat-runtime-contract.md) 已经是 POST + SSE 事件流主合同，而不是整包 JSON 响应主路径。

## 当前 `message/send` 在后端视角下是什么

当前 [`message/send`](../system/chat-runtime-contract.md) 的后端主线，可以概括成下面几步：

1. 协议解析层读取 `sessionId`、消息体和 `policy.modelRoute`。
2. run 编排层先发出 `run_started`。
3. Python runtime 通过宿主私桥按 `providerProfileId` 解析 provider profile 与 API key。
4. 宿主使用路由快照校验 `provider`、`endpointType`、`baseUrl` 与 `modelId`。
5. 执行器打开真实上游模型流，后端持续发出 `text_delta`。
6. 正常完成时，后端归档最终 assistant 文本，并发出 `run_completed`。
7. 失败或取消时，后端发出 `run_failed` 或 `run_cancelled`，不会归档 assistant 成功消息。

这说明当前后端对前端真正暴露的，已经是一条 run 语义明确的流式聊天链路。

## 当前前端真正需要对齐的对象

因此，今天前后端真正需要对齐的对象已经是：

- 智能体目录。
- 会话绑定。
- 能力面版本和工具目录。
- 请求级 `modelRoute`。
- 流式事件集合与终态规则。
- 成功归档与失败不归档的会话规则。

## 已退役的旧外层方法

下面这些旧方法已经退出当前 runtime surface：

- `info`
- `agent/connect`
- `agent/run`

它们不再出现在 supported methods 中，也不再承担兼容或诊断职责。旧调用当前只会收到 `method_not_implemented`；当前正式前端主路径已经完全围绕 session-first 四方法组织。

## 前端今天还没有直接连到哪些后端能力

### Blackboard 与 TIS 还不是正式前端业务 API

Blackboard 和 TIS 当前已经有真实能力，但这些能力主要以 CLI、工具层、provider 用例和结构化结果对象的形式存在。

这意味着：

- 后端确实已经有可用的领域能力。
- 前端今天还不能把它们当成稳定的业务 HTTP API 去依赖。
- backend 分册里不适合把这两组模块写成已经完整对外开放的服务层。

### settings workspace 也不是 Python runtime 的直接接口层

设置页今天能保存很多字段，但它们不会被 Python runtime 直接读取。当前真实链路仍然是：

- 主进程持久化 settings workspace 状态与 secrets。
- 主进程创建宿主私桥。
- Python runtime 在执行前通过私桥解析本轮 provider 路由与认证信息。

## 当前连接面更适合怎样理解

如果只用一句话概括当前后端对前端的连接面，可以这样理解：

- 宿主层负责持有配置、托管 runtime 和守住 provider 与 secrets 真源。
- Python 后端负责提供本地控制面和 session-first 流式聊天主契约。
- Blackboard 与 TIS 仍然主要停留在领域能力层和未来服务化输入层。

## 这页想帮助你先建立什么判断

- 当前前端已经有真实后端连接面，不再是只参考 CLI 输出的状态。
- 当前真正稳定的连接面，是控制面端点和 session-first 流式聊天主路径。
- Electron 主进程是这条链路里的配置 owner、runtime launcher 与宿主私桥 owner。
- provider secrets 不会进入消息请求体，也不会出现在流式事件里。
- Blackboard 与 TIS 还没有整体进入正式前端业务 API 层。

## 相关文档

- [后端运行与配置](./run-and-config.md)
- [当前契约参考](./reference-current-contracts.md)
- [聊天运行时契约](../system/chat-runtime-contract.md)
- [运行时生命周期](../system/runtime-lifecycle.md)

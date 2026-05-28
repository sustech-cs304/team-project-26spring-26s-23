---
title: 后端暴露契约与前端接入点（旧资料）
description: 旧 backend 分册连接面说明。保留后端视角的补充细节。
sidebar_position: 4
sidebar_label: 旧资料：连接面
---

# 后端暴露契约与前端接入点（旧资料）

旧 `backend` 分册，补充"后端视角下的连接面细节"。第一次进入站点请先看 [给开发者](../developers/getting-started.md)、[聊天运行时](../developers/chat-runtime.md)、[运行时接口 / 事件参考](../reference/runtime-events.md) 和 [Provider 与模型路由说明](../reference/providers-and-routing.md)。

## 两层接入点

从 backend 视角看，前端接到后端不是单层链路，而是两层接入点叠在一起。

### 第一层：Electron 主进程提供的宿主接入点

前端 renderer 不直接管理 Python 子进程、`userData` 路径或 provider secrets。这些事由 Electron 主进程承担：

- 准备 hosted runtime 路径。
- 持有统一配置中心和 settings workspace。
- 持有 provider profiles 与 provider secrets 真源。
- 创建宿主私有 provider route bridge。
- 启动、停止和重试 Python runtime。
- 把 hosted runtime 快照整理后暴露给 renderer。

前端先接触到的，是宿主层提供的 runtime 快照、公开配置接口和 settings workspace 接口，不是 Python 进程内部对象。

### 第二层：Python runtime 暴露的 loopback HTTP 契约

主进程拉起 Python runtime 后，后端对前端可见的 HTTP 连接面是同一个 loopback 服务：

- 一组控制面端点。
- 一个统一的聊天根端点 `POST /`。
- 一组持久化历史与运维端点，用于读取历史线程、回放 run，以及 delete / backup / restore。

前后端联调重点落在这第二层。

## Electron 主进程在 backend 视角下的角色

### 配置 owner

统一配置中心和 settings workspace 由主进程持有。Python runtime 不会直接读取 `config-center/*.json`、`settings-workspace-state.json` 或 `settings-workspace-secrets.json`。

### runtime launcher

主进程准备路径、构造启动参数、拉起 Python 子进程，失败时保留宿主管理下的状态和失败摘要。

### 路由解析真源的入口

主进程持有 provider profile 元数据与 secrets 真源，通过宿主私有 provider route bridge 在运行期按请求解析：

- `providerProfileId` 对应的 provider profile 是否存在。
- 请求中的路由快照是否仍与本地配置一致。
- provider profile 是否具备可用 API key。

这解释了后端为什么已不需要 startup `model` 参数，却仍能在每次 `run/start` 执行前解析真实 provider 连接信息；兼容入口 [`message/send`](../system/chat-runtime-contract.md) 映射到同一条 `thread/run` 语义。

## Python 后端暴露的内容

### 控制面端点

loopback HTTP 服务已稳定暴露：

- `GET /health`
- `GET /ready`
- `GET /version`
- `GET /build-info`
- `GET /diagnostics`
- `GET /diagnostics/runtime-info`

这组端点回答三类问题：

- 本地 runtime 是否已启动。
- 是否 ready，以及最近一次失败发生了什么。
- 运行目录、配置摘要和聊天能力摘要。

### 聊天持久化运维契约

除 `thread/run` 主链外，desktop runtime 还额外暴露一组面向持久化历史的运维端点：

- `GET /history/threads`
- `GET /history/threads/{threadId}`
- `GET /history/runs/{runId}/replay`
- `POST /history/threads/{threadId}/rename`
- `POST /history/threads/{threadId}/duplicate`
- `DELETE /history/threads/{threadId}`
- `POST /history/database/backup`
- `POST /history/database/restore`

职责边界：

- renderer 不直接接触 SQLite 文件，通过 Electron main / preload IPC 间接调用这些端点。
- `delete` 直接永久删除线程 truth、run、event 与 projection。
- `backup` / `restore` 是桌面本地单机运维能力，不涉及云同步或多副本协调。

### 聊天主契约

聊天主链已收口为 `thread/run` 六方法：

1. `agents/list`
2. `thread/create`
3. `thread/get`
4. `run/start`
5. `run/stream`
6. `run/cancel`

`session/create`、`capabilities/get` 和 [`message/send`](../system/chat-runtime-contract.md) 保留为兼容壳。

这条主链描述的后端连接主线：

- 后端目录告诉前端有哪些智能体。
- 前端创建 thread 时绑定到某个智能体。
- 前端读取 thread 的能力面。
- 每次发起 run 时，前端显式带上本次模型路由、Thinking、工具列表与请求选项。

### 前端走这条主路径的步骤

1. 确认 hosted runtime 已可用，拿到可访问的 runtime URL。
2. 调用 `agents/list` 读取后端智能体目录。
3. 调用 `thread/create` 创建 thread，绑定智能体。
4. 调用 `thread/get` 读取 thread 视图和能力面。
5. 调用 `run/start` 发起本轮 run，显式带上模型路由、Thinking 和工具选择。
6. 调用 `run/stream` 消费事件流；需要中断时调用 `run/cancel`。

关键变化：

- 后端把"智能体绑定"和"每次请求的模型路由"拆成两层语义。
- 正式主链是 `thread/run`；兼容入口 [`message/send`](../system/chat-runtime-contract.md) 映射到同一条事件流语义。

### `message/send` 在后端视角下的路线

1. 协议解析层读取 `sessionId`、消息体和 `policy.modelRoute`。
2. run 编排层先发出 `run_started`。
3. Python runtime 通过宿主私桥按 `providerProfileId` 解析 provider profile 与 API key。
4. 宿主使用路由快照校验 `provider`、`endpointType`、`baseUrl` 与 `modelId`。
5. 执行器在模型调用工具时发出真实 `tool_event`，回传 `started`、`completed` 或 `failed`。
6. 执行器打开真实上游模型流，后端持续发出 `text_delta`。
7. 正常完成时，后端归档最终 assistant 文本，发出 `run_completed`。
8. 失败或取消时，后端发出 `run_failed` 或 `run_cancelled`，不归档 assistant 成功消息。

后端对前端真正暴露的是一条 run 语义明确的流式聊天链路。

### 前后端需要对齐的对象

- 智能体目录。
- 会话绑定。
- 能力面版本和工具目录。
- 请求级 `modelRoute` 与 `enabledTools`。
- 流式事件集合、`tool_event` 生命周期阶段与终态规则。
- 成功归档与失败不归档的会话规则。

## 已退役的旧外层方法

- `info`
- `agent/connect`
- `agent/run`

它们不再出现在 supported methods 中，旧调用收到 `method_not_implemented`。正式前端主路径围绕 `agents/list -> thread/create -> thread/get -> run/start -> run/stream -> run/cancel` 组织。

## Python 后端额外暴露的领域 HTTP API

### Blackboard HTTP API（已可用）

以 `/api/blackboard` 为前缀：

| 端点 | 用途 |
| --- | --- |
| `GET /api/blackboard/sync/status` | 同步状态查询 |
| `POST /api/blackboard/sync/trigger` | 触发全量快照同步 |
| `POST /api/blackboard/sync/cancel` | 取消进行中的同步 |
| `POST /api/blackboard/sync/rebuild-announcement-links` | 重建公告-作业链接 |
| `POST /api/blackboard/resources/downloads/select-start` | 启动选择性资源下载 |
| `POST /api/blackboard/resources/downloads/cancel` | 取消资源下载 |
| `GET /api/blackboard/resources/downloads/status` | 下载队列状态 |
| `GET /api/blackboard/data/summary` | 同步数据摘要 |
| `GET /api/blackboard/data/courses` | 课程列表 |
| `GET /api/blackboard/data/courses/{course_id}/announcements` | 课程公告 |
| `GET /api/blackboard/data/courses/{course_id}/assignments` | 课程作业 |
| `GET /api/blackboard/data/courses/{course_id}/grades` | 课程成绩 |
| `GET /api/blackboard/data/courses/{course_id}/resources` | 课程资源 |

### WakeUP HTTP API（已可用）

| 端点 | 用途 |
| --- | --- |
| `POST /api/wakeup/import/ics` | 导入 ICS 日历文本 |
| `POST /api/wakeup/parse/ics` | 解析 ICS 日历而不导入 |

### 日历事件 API（已可用）

| 端点 | 用途 |
| --- | --- |
| `GET /calendar/events` | 从 timeline.db 获取日历事件 |

### 调试日志 API（已可用）

| 端点 | 用途 |
| --- | --- |
| `GET /diagnostics/debug-logs/recent` | 查询最近调试日志 |
| `GET /diagnostics/debug-logs/chain` | 获取关联链 |
| `GET /diagnostics/debug-logs/events/{event_id}` | 按 ID 获取事件 |
| `GET /diagnostics/debug-logs/maintenance-status` | 检查保留维护状态 |

### settings workspace 不是 Python runtime 的直接接口层

设置页能保存很多字段，但不会被 Python runtime 直接读取。真实链路：

- 主进程持久化 settings workspace 状态与 secrets。
- 主进程创建宿主私桥。
- Python runtime 在执行前通过私桥解析本轮 provider 路由与认证信息。

## 连接面概括

- 宿主层持有配置、托管 runtime、守住 provider 与 secrets 真源。
- Python 后端提供本地控制面、`thread/run` 聊天主链和领域 HTTP API（Blackboard、WakeUP、日历、调试日志）；`session/create`、`capabilities/get` 和 `message/send` 作为兼容壳保留。
- Blackboard、WakeUP、日历和调试日志已有正式 HTTP API。

## 判断要点

- 前端有真实后端连接面，不再是只参考 CLI 输出的状态。
- 真正稳定的连接面是控制面端点、`thread/run` 流式聊天主路径和领域 HTTP API。
- Electron 主进程是配置 owner、runtime launcher 与宿主私桥 owner。
- provider secrets 不进入消息请求体，不出现在流式事件里。
- Blackboard、WakeUP、日历和调试日志已有正式前端 HTTP API。

## 相关文档

- [后端运行与配置](./run-and-config.md)
- [当前契约参考](./reference-current-contracts.md)
- [聊天运行时契约](../system/chat-runtime-contract.md)
- [运行时生命周期](../system/runtime-lifecycle.md)

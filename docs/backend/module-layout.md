---
title: 后端模块布局（旧资料）
description: 旧 backend 分册目录说明。保留后端模块边界与实现细节。
sidebar_position: 2
---

# 后端模块布局（旧资料）

旧 `backend` 分册，保留目录结构和职责边界的补充说明。第一次进入站点请先看 [给开发者](../developers/getting-started.md)、[后端实现](../developers/backend.md) 和 [运行时接口 / 事件参考](../reference/runtime-events.md)。

## 后端分成四层

1. 本地桌面运行时 `desktop_runtime/`。
2. 聊天运行时核心 `copilot_runtime/`。
3. 两组领域能力模块：Blackboard 和 TIS。
4. 少量基础设施与辅助目录，成熟度不一。

前两层组成今天对桌面应用生效的本地后端；后两层是能力储备和未来服务化输入。

## 顶层目录总图

```text
backend/app/
├─ desktop_runtime/              # 本地 loopback HTTP 服务、生命周期与宿主私桥客户端
├─ copilot_runtime/             # 聊天契约、会话、run 编排与流式事件
├─ integrations/                # 领域能力模块
│   └─ sustech/                 #   SUSTech 相关能力
│       ├─ blackboard/          #   Blackboard 抓取、同步、HTTP API
│       └─ teaching_information_system/ # TIS 领域能力
│   └─ wakeup/                  #   WakeUP 日历 ICS 解析
├─ tooling/                     # 工具框架（browser_tools、calendar_tools、file_tools、MCP 适配器等）
├─ event_manager/               # 日历事件同步桥（Blackboard → timeline.db）
├─ shared_integrations/         # 跨集成共享代码（CAS 认证等）
├─ core/                        # 跨领域基础设施
├─ tools/                       # 通用工具实现（当前为空）
└─ services/                    # 预留目录
```

## 顶层目录职责一览

| 目录 | 角色 | 是否属于正式主路径 |
| --- | --- | --- |
| `desktop_runtime/` | 启动本地 HTTP 服务，解析运行配置，提供控制面端点，装配宿主私桥客户端。 | 是 |
| `copilot_runtime/` | 承接聊天主契约，管理智能体目录、工具目录、会话、run 编排和流式事件。 | 是 |
| `integrations/sustech/blackboard/` | 提供 Blackboard 抓取、同步、持久化、HTTP API 与工具层能力。 | 是（HTTP API 已对前端开放） |
| `integrations/sustech/teaching_information_system/` | 提供 TIS 抓取、诊断、成绩与课程相关能力。 | 否 |
| `integrations/wakeup/` | 提供 WakeUP 日历 ICS 导入与解析能力。 | 是（HTTP API 已可用） |
| `tooling/` | 工具框架（browser_tools、calendar_tools、file_tools、MCP 适配器等）。 | 间接参与 |
| `event_manager/` | 日历事件同步桥（Blackboard → timeline.db）。 | 间接参与 |
| `shared_integrations/` | 跨集成共享代码（CAS 认证等）。 | 否 |
| `core/` | 跨领域基础设施，以认证为主。 | 否 |
| `tools/` | 可复用工具实现，为空。 | 否 |
| `services/` | 预留目录，未形成统一服务编排层。 | 否 |

## `desktop_runtime/` 负责启动本地服务

`desktop_runtime/` 是 Python 后端在桌面场景下的正式入口，承担的责任：

- 解析 CLI 参数、环境变量和默认值。
- 准备运行目录与状态目录。
- 创建 FastAPI 应用。
- 注册 `/health`、`/ready`、`/version`、`/build-info`、`/diagnostics` 和 `/diagnostics/runtime-info` 控制面端点。
- 把聊天运行时根端点 `POST /` 挂到同一个 loopback HTTP 服务上。
- 创建宿主私桥客户端，让 Python runtime 在执行阶段按请求解析 provider 路由。
- 管理启动、就绪和关闭过程。

边界：`desktop_runtime/` 是宿主管理下的服务入口层，负责承载服务和暴露控制面，不展开聊天业务细节。

### 先看哪些文件

- `server.py` 负责创建应用、注册控制面端点、挂载聊天路由，注入宿主私桥客户端。
- `config.py` 负责解析 `--host`、`--port`、`--local-token`、宿主私桥 bootstrap 和各类路径参数。
- `host_model_route_bridge.py` 负责与宿主私桥通信，按请求解析 provider route。
- `health.py` 负责构造健康检查、版本和 diagnostics 响应。
- `lifecycle.py` 负责管理 runtime 的生命周期状态。

## `copilot_runtime/` 是聊天主契约的核心

`copilot_runtime/` 是聊天后端的核心实现，围绕 `thread/run` 主路径和 run 流式主线展开。

正式主路径是十一个方法：

- `agents/list`
- `thread/create`
- `thread/get`
- `run/start`
- `run/stream`
- `run/cancel`
- `capabilities/get`
- `tools/catalog/get`
- `thinking/capability/get`
- `tool-approval/resolve`
- `shell-session/start` / `shell-session/exec` / `shell-session/close`

`session/create` 和 `message/send` 保留为兼容投影层。

这条主路径对应三件事：

- 智能体目录由后端提供。
- thread 在创建时绑定智能体。
- 模型路由、工具列表和请求选项在每次 run 请求里单独给出。

关键责任包括：

- 解析聊天根端点上的请求协议。
- 维护智能体目录和工具目录。
- 管理 SQLite 持久化会话存储与 projection 缓存。
- 组装能力面响应。
- 以 run 为中心编排一次流式消息执行。
- 在成功终态时完成会话归档。

### 成熟度

默认装配里，聊天 runtime 只注册了最小智能体目录和默认工具目录。默认工具目录已包含 `tool.file-convert` 和 `tool.weather-current`（内建随机占位实现，不依赖外部天气 API）。

这意味着两件事：

- `copilot_runtime/` 是一条能独立工作的流式聊天主路径，工具生命周期已进入主流事件链路。
- Blackboard 和 TIS 不会因为目录存在就自动成为聊天工具目录的一部分。

### 先看哪些文件

- `contracts.py` 定义方法对应的目录视图、请求契约和能力面模型。
- `protocol.py` 负责把 `POST /` 的请求体解析成内部请求对象，重点包括 `policy.modelRoute`。
- `router.py` 负责按 `method` 分发请求，把 [`message/send`](../system/chat-runtime-contract.md) 转到流式响应路径。
- `composition.py` 负责装配默认 session store、智能体目录、工具目录、run 编排层和 bridge。
- `message_runs.py` 负责请求级模型路由解析、流式事件编排、错误终态和最终归档。
- `run_events.py` 负责定义 `run_started`、`tool_event`、`text_delta`、`run_completed`、`run_failed`、`run_cancelled` 与 `run_diagnostic` 事件，以及 SSE 编码。
- `model_routes.py` 负责模型路由对象、解析结果和相关错误类型定义。
- `bridge.py` 保留会话能力查询和最薄的流式桥接入口。
- `session_store.py` 定义记录类型与内存态会话存储（测试 / 回退用）。
- `persistence/` 提供 SQLite 持久化会话存储（`SQLiteSessionStore`），含 Alembic 迁移、projection 重建、历史查询与 backup / restore。
- `agent_registry.py` 和 `tool_registry.py` 负责目录真源。

### `message_runs.py` 是主线的收口点

流式主线最关键的模块是 `message_runs.py`，承担的工作：

- 生成 `runId` 和 assistant 占位消息 ID。
- 先发 `run_started`。
- 读取请求中的 `modelRoute`。
- 通过 `RuntimeModelRouteResolver` 在执行前解析 provider route 与认证信息。
- 在模型调用工具时输出真实 `tool_event`，按 `started`、`completed`、`failed` 回传生命周期阶段。
- 打开上游文本流并持续输出 `text_delta`。
- 在失败前按需要输出 `run_diagnostic`。
- 在成功结束时归档最终 assistant 文本，发出 `run_completed`。
- 在取消或失败时发出对应终态，不归档 assistant 成功消息。

### `bridge.py` 已退到薄桥位置

`bridge.py` 不再承担整条聊天执行主语义。它是：

- 兼容会话能力查询入口。
- 兼容 [`message/send`](../system/chat-runtime-contract.md) 的最薄转发入口。

如果文档仍把 `RuntimeBridge.send_message()` 写成主线核心，就落后于实现现实。

### 旧兼容方法

`info`、`agent/connect` 和 `agent/run` 已从 runtime surface 退役。它们不再出现在 supported methods 中，旧调用收到 `method_not_implemented`。

权威主路径是 `agents/list + thread/create + thread/get + run/start + run/stream + run/cancel`；`session/create`、`capabilities/get` 与 [`message/send`](../system/chat-runtime-contract.md) 是兼容壳。

## `integrations/sustech/blackboard/` 是成熟度最高的领域能力模块

`blackboard/` 已形成完整的抓取、解析、同步、落盘与 HTTP API 链路。对外可观察的入口有三类：

- 课程目录搜索 CLI。
- 日历 ICS 同步 CLI。
- 面向前端的 HTTP API（`/api/blackboard/*`）。

内部结构：

- `api/` 负责访问上游 Blackboard 系统并解析数据。
- `data/` 负责本地同步与持久化。
- `provider/` 负责用例编排、CLI 和工具层。
- `facade/` 负责工具适配器。
- `shared/` 放领域内共用工具。

HTTP API 已支持：同步触发与取消、数据查询（课程、公告、作业、成绩、资源）、资源下载管理、公告-作业链接重建。

## `integrations/sustech/teaching_information_system/` 提供 TIS 领域能力

`teaching_information_system/` 成熟度与 Blackboard 不同。它有诊断、成绩、学分绩和已选课程等可调用能力，也具备部分持久化能力，但现成入口和对外暴露面比 Blackboard 少。

事实：

- 不是空目录或占位层。
- 有真实用例和结果对象。
- 是 Python 内部能力和未来服务化输入，而不是已对前端开放的业务接口层。

## `integrations/wakeup/` 提供 WakeUP 日历 ICS 解析

`wakeup/` 提供 WakeUP 分享链接的 ICS 日历导入与解析能力。HTTP API 已可用：

- `POST /api/wakeup/import/ics`：导入 ICS 日历文本。
- `POST /api/wakeup/parse/ics`：解析 ICS 日历而不导入。

## `event_manager/` 负责日历事件同步

`event_manager/` 提供 Blackboard 日历事件到 timeline.db 的同步桥接：

- `sync_bridge.py`：Blackboard → timeline.db 同步逻辑。
- `data/`：事件 DTO 与模型定义。

## `tooling/` 是工具框架层

`tooling/` 承载完整的工具框架：

- `browser_tools.py`：基于宿主机的浏览器工具。
- `calendar_tools/`：日历相关工具。
- `file_tools/`：文件操作工具。
- `contract/`：工具契约定义。
- `host_capabilities/`：宿主机能力适配。
- `mcp_adapter/`：MCP 工具适配器。
- `prompts/`：工具提示词模板。
- `runtime_adapter/`：运行时适配器。

默认聊天工具目录已包含 `tool.file-convert` 和 `tool.weather-current`（内建随机占位实现）。

## `core/`、`tools/` 和 `services/` 的边界

### `core/` 是跨领域基础设施

内容以认证相关基础设施为主，例如 CAS 客户端。给多个模块提供复用底座，不承接产品级服务编排。

### `shared_integrations/` 是跨集成共享代码

`shared_integrations/sustech_auth/` 包含共享的 CAS 认证客户端，被 `integrations/sustech/blackboard/` 和 `integrations/sustech/teaching_information_system/` 共同使用。

### `tools/` 为空

只包含 `__pycache__`，没有实质内容。工具实现在 `tooling/`。

### `services/` 是预留目录

只有一个很薄的包结构，不存在统一 service layer。

## 运行时层和领域层的关系

常见误区：把"领域模块存在"等同于"已接入桌面聊天主路径"。

准确的关系：

- `desktop_runtime/` 和 `copilot_runtime/` 构成本地流式聊天后端。
- `blackboard/` 和 `teaching_information_system/` 提供领域能力、CLI、工具结果和未来服务化输入。
- 默认聊天 runtime 不会自动把 Blackboard 与 TIS 全量收编成正式工具目录。

## 判断要点

- `desktop_runtime/` 是本地宿主服务入口和宿主私桥客户端入口。
- `copilot_runtime/` 是聊天契约、run 编排和流式事件核心。
- Blackboard 与 TIS 是领域能力模块，不是已完成前端服务化的业务 API。
- `services/` 是预留位置，不是已成型的主服务层。

## 相关文档

- [后端运行与配置](./run-and-config.md)
- [后端暴露契约与前端接入点](./frontend-connection.md)
- [运行与配置参考](./reference-run-and-config.md)
- [当前契约参考](./reference-current-contracts.md)
- [边界与未覆盖范围](./roadmap-and-boundaries.md)

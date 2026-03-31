---
title: 后端模块布局
description: 说明 Python 后端当前的目录结构、运行责任与模块边界。
sidebar_position: 2
---

# 后端模块布局

这页只说明当前代码已经形成的目录结构和职责边界。启动参数、路径差异和配置来源请看[后端运行与配置](./run-and-config.md)，HTTP 方法与前端接入方式请看[后端暴露契约与前端接入点](./frontend-connection.md)。

## 当前后端可以先分成四层

1. 它有一层本地桌面运行时，也就是 `desktop_runtime/`。
2. 它有一层聊天运行时核心，也就是 `copilot_runtime/`。
3. 它有两组领域能力模块，也就是 Blackboard 和 TIS。
4. 它还带着少量基础设施与辅助目录，但这些目录的成熟度并不一样。

这四层里，前两层组成今天真正对桌面应用生效的本地后端；后两层更多是当前能力储备和未来服务化输入。

## 顶层目录总图

```text
backend/app/
├─ desktop_runtime/              # 本地 loopback HTTP 服务与生命周期
├─ copilot_runtime/             # 聊天契约、会话、目录与消息执行
├─ blackboard/                  # Blackboard 领域能力
├─ teaching_information_system/ # TIS 领域能力
├─ core/                        # 跨领域基础设施
├─ tools/                       # 通用工具实现
└─ services/                    # 预留目录，当前很薄
```

## 顶层目录职责一览

| 目录 | 当前角色 | 今天是否属于正式主路径 |
| --- | --- | --- |
| `desktop_runtime/` | 启动本地 HTTP 服务，解析运行配置，提供控制面端点，挂载聊天根端点。 | 是 |
| `copilot_runtime/` | 承接当前聊天主契约，管理智能体目录、工具目录、会话和消息执行。 | 是 |
| `blackboard/` | 提供 Blackboard 抓取、同步、持久化、CLI 与工具层能力。 | 否 |
| `teaching_information_system/` | 提供 TIS 抓取、诊断、成绩与课程相关能力。 | 否 |
| `core/` | 放跨领域基础设施，目前以认证为主。 | 否 |
| `tools/` | 放可复用工具实现，目前已包含文件转换工具。 | 间接参与 |
| `services/` | 预留目录，当前还没有形成统一服务编排层。 | 否 |

## `desktop_runtime/` 负责把本地服务跑起来

`desktop_runtime/` 是 Python 后端在桌面场景下的正式入口。它当前承担的责任比较集中：

- 它解析 CLI 参数、环境变量和默认值。
- 它准备运行目录与状态目录。
- 它创建 FastAPI 应用。
- 它注册 `/health`、`/ready`、`/version`、`/build-info`、`/diagnostics` 和 `/diagnostics/runtime-info` 这些控制面端点。
- 它把聊天运行时根端点 `POST /` 挂到同一个 loopback HTTP 服务上。
- 它管理启动、就绪和关闭过程。

这里要分清一条边界：`desktop_runtime/` 是宿主管理下的服务入口层，它负责承载服务和暴露控制面，但不会在这里展开聊天业务细节。

### 先看哪些文件

- `server.py` 负责创建应用、注册控制面端点和挂载聊天路由。
- `config.py` 负责解析 `--host`、`--port`、`--model` 以及各类路径参数。
- `health.py` 负责构造健康检查、版本和 diagnostics 响应。
- `lifecycle.py` 负责管理 runtime 的生命周期状态。

## `copilot_runtime/` 是当前聊天主契约的核心

`copilot_runtime/` 才是今天聊天后端的核心实现。它当前已经不是早期那种以 `agent/connect` 和 `agent/run` 为中心的说明方式，而是围绕一条更清楚的 session-first 主路径组织。

当前正式主路径是四个方法：

- `agents/list`
- `session/create`
- `capabilities/get`
- `message/send`

这条主路径对应三件事：

- 智能体目录由后端提供。
- 会话在创建时绑定智能体。
- 模型和工具策略在每次消息请求里单独给出。

因此，这一层的关键责任包括：

- 解析聊天根端点上的请求协议。
- 维护智能体目录和工具目录。
- 管理进程内会话存储。
- 组装能力面响应。
- 按请求执行消息发送，并把成功结果写回会话历史。

### 这一层今天真正成熟到什么程度

当前默认装配里，聊天 runtime 只注册了最小智能体目录和默认工具目录。默认工具目录里已经有内建的 `tool.file-convert`，对应的实现位于 `app/tools/file_convert.py`。

这意味着两件事：

- `copilot_runtime/` 已经是一条能独立工作的聊天主路径。
- Blackboard 和 TIS 并不会因为目录存在，就自动成为当前正式聊天工具目录的一部分。

### 先看哪些文件

- `contracts.py` 定义当前方法对应的响应契约和目录视图。
- `protocol.py` 负责把 `POST /` 的请求体解析成内部请求对象。
- `router.py` 负责按 `method` 分发请求。
- `composition.py` 负责装配默认 session store、智能体目录、工具目录和 bridge。
- `bridge.py` 负责读取会话历史、解析请求级模型与工具策略，并执行消息。
- `session_store.py` 负责当前的内存态会话存储。
- `agent_registry.py` 和 `tool_registry.py` 负责目录真源。

### 旧兼容方法现在处在什么位置

`info`、`agent/connect` 和 `agent/run` 仍然存在于 runtime 中，也仍然服务某些兼容链路和旧测试。但在 backend 分册里，它们不再和当前主路径并列叙述。

更准确的说法是：这些方法仍然可见，但它们已经退到兼容位置；当前权威主路径仍然是 session-first 四方法。

## `blackboard/` 是成熟度最高的领域能力模块

`blackboard/` 当前已经形成比较完整的抓取、解析、同步与落盘链路。对外较容易观察到的入口主要有两类：

- 课程目录搜索 CLI。
- 日历 ICS 同步 CLI。

它的内部结构也比较清楚：

- `api/` 负责访问上游 Blackboard 系统并解析数据。
- `data/` 负责本地同步与持久化。
- `provider/` 负责用例编排、CLI 和工具层。
- `shared/` 放领域内共用工具。

这组能力已经能稳定产出 CLI 输出、工具层结果和本地数据库结果，但它还没有整体收束成面向前端的完整业务 HTTP API。

## `teaching_information_system/` 提供 TIS 领域能力

`teaching_information_system/` 的成熟度和 Blackboard 不完全一样。它已经有诊断、成绩、学分绩和已选课程等可调用能力，也具备部分持久化能力，但现成入口和对外暴露面比 Blackboard 少一些。

这一层更适合这样理解：

- 它已经不是空目录或占位层。
- 它已经有真实用例和结果对象。
- 它当前更像 Python 内部能力和未来服务化输入，而不是已经对前端开放的业务接口层。

## `core/`、`tools/` 和 `services/` 的边界

### `core/` 是跨领域基础设施

`core/` 当前规模不大，主要内容是认证相关基础设施，例如 CAS 客户端。它的角色很清楚，就是给多个模块提供复用底座，而不是承接产品级服务编排。

### `tools/` 是通用工具实现

`tools/` 当前已经包含文件转换工具。默认聊天工具目录里的 `tool.file-convert` 会用到这层实现。

这层的定位是可复用工具代码，不是独立的服务层，也不是面向前端的接口层。

### `services/` 目前仍然只是预留目录

`services/` 当前只有一个很薄的包结构，还不能写成已经存在统一 service layer。后端文档如果把这个目录描述成成熟编排层，会比代码现状更超前。

## 当前运行时层和领域层是什么关系

现在最容易被写错的地方，是把“领域模块存在”直接等同于“已经接入当前桌面聊天主路径”。

当前更准确的关系是：

- `desktop_runtime/` 和 `copilot_runtime/` 一起构成当前本地聊天后端。
- `blackboard/` 和 `teaching_information_system/` 主要提供领域能力、CLI、工具结果和未来服务化输入。
- 默认聊天 runtime 目前不会自动把 Blackboard 与 TIS 全量收编成正式工具目录。

## 这页想帮助你先建立什么判断

如果你刚接手代码，可以先用下面这组判断防止误读：

- 看到 `desktop_runtime/` 时，优先把它理解成本地宿主服务入口。
- 看到 `copilot_runtime/` 时，优先把它理解成当前聊天契约和会话执行核心。
- 看到 Blackboard 与 TIS 时，优先把它们理解成领域能力模块，而不是已经完成前端服务化的业务 API。
- 看到 `services/` 时，先把它看成预留位置，不要直接当成已经成型的主服务层。

## 相关文档

- [后端运行与配置](./run-and-config.md)
- [后端暴露契约与前端接入点](./frontend-connection.md)
- [运行与配置参考](./reference-run-and-config.md)
- [当前契约参考](./reference-current-contracts.md)
- [边界与未覆盖范围](./roadmap-and-boundaries.md)

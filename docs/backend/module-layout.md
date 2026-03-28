---
title: 后端模块布局
description: 说明 Python 后端当前的目录组织、模块职责边界，以及 session-first 聊天 runtime 与领域能力的关系。
sidebar_position: 2
---

# 后端模块布局

这篇文档帮助读者先看懂一件事：当前后端代码为什么这样分层，以及不同目录分别应该去哪找。

如果你刚接手仓库，建议先把这几个层次分清：

- 哪些目录负责本地聊天 runtime
- 哪些目录负责 Blackboard / TIS 领域能力
- 哪些目录只是基础设施或占位
- 当前测试按什么边界组织

## 先给结论

当前后端主要分成五层：

1. **Desktop Runtime**：本地 HTTP 服务器和运行时宿主边界
2. **Copilot Runtime**：聊天协议、智能体目录、工具目录、会话与消息执行
3. **领域模块**：Blackboard 和 TIS 的抓取、解析、同步与持久化能力
4. **基础设施**：认证等跨领域能力
5. **服务层占位**：目录已存在，但当前还没有发展成统一编排层

## 一张总图

```text
backend/app/
├─ desktop_runtime/              # 本地 HTTP 服务与运行时配置
├─ copilot_runtime/             # 聊天运行时核心
├─ blackboard/                  # Blackboard 领域能力
├─ teaching_information_system/ # TIS 领域能力
├─ core/                        # 跨领域基础设施
└─ services/                    # 预留目录，当前基本为空
```

## 1. `desktop_runtime/`：本地 HTTP 服务器

这个目录是 Electron 主进程托管的 Python 子进程入口。

它当前主要负责：

- 解析 CLI 参数、环境变量和默认值
- 初始化运行目录
- 创建 FastAPI 应用
- 暴露控制面端点
- 挂载聊天 runtime 根端点
- 维护运行时生命周期

### 现在应该先看哪些文件

- `server.py`
  - 创建 FastAPI 应用
  - 注册控制面端点
  - 挂载聊天 runtime 路由

- `config.py`
  - 解析 `--host`、`--port`、`--model`、各类路径参数
  - 生成 desktop runtime 配置对象

- `lifecycle.py`
  - 管理启动与关闭钩子

- `health.py`
  - 生成 `/health`、`/ready`、`/version`、`/diagnostics` 对应的输出

### 当前边界

`desktop_runtime/` 负责“把服务跑起来”，但不直接实现聊天业务细节。聊天行为主要交给 `copilot_runtime/`。

## 2. `copilot_runtime/`：聊天运行时核心

这个目录是当前聊天后端的核心。

它当前负责：

- 协议解析
- 路由分发
- 智能体目录
- 工具目录
- 会话创建与绑定
- 消息执行与历史追加

### 当前正式前端主路径

当前前端真正使用的聊天主路径是 4 个方法：

- `agents/list`
- `session/create`
- `capabilities/get`
- `message/send`

也就是说，现在更准确的理解已经不是早期的“`info` / `agent/connect` / `agent/run` 三步桥接主路径”，而是：

- 后端目录提供智能体真源
- 会话绑定当前智能体
- 每次消息再显式给出模型和工具策略

### 这个目录里最重要的文件

- `contracts.py`
  - 定义目录项、会话响应、能力面响应、消息发送响应等契约数据类

- `protocol.py`
  - 解析 `POST /` 的请求体
  - 校验 `method`、`sessionId`、`message`、`model`、`enabledTools` 等字段

- `router.py`
  - 聊天根路由分发层
  - 把请求转给不同方法处理逻辑

- `bridge.py`
  - 连接协议层和 agent 执行层
  - 负责读会话历史、执行消息、成功后把 user / assistant 结果写回 session store

- `session_store.py`
  - 当前使用的内存态会话存储
  - 一条会话会稳定绑定一个智能体

- `agent_registry.py`
  - 当前智能体目录的真源注册表

- `tool_registry.py`
  - 当前工具目录的真源注册表
  - 默认工具集当前已包含内建 `tool.file-convert`

- `composition.py`
  - 把 registry、session store、bridge、scaffold 等依赖组装起来

### 当前仍然保留但已降到兼容位置的方法

runtime 里当前仍然还能看到：

- `info`
- `agent/connect`
- `agent/run`

更准确的说法是：

- 它们还在代码里存在
- 某些旧测试与兼容调用仍可观察到它们
- 但当前正式前端主路径已经不再围绕它们组织

## 3. `blackboard/`：Blackboard 领域能力

这个目录围绕 Blackboard 系统组织。

### 当前内部结构

- `api/`
  - 面向上游系统的数据抓取、请求和解析

- `data/`
  - 本地数据落盘、同步和结果结构

- `provider/`
  - 用例编排层
  - 同时包含 CLI、工具层和 use case

- `shared/`
  - Blackboard 领域内共用的小工具

### 当前最适合怎么理解

Blackboard 这条线当前最成熟的外部可观察能力仍然是：

- 课程目录搜索 CLI
- 日历 ICS 同步 CLI
- 工具层返回字典
- snapshot 同步相关结果

它当前还没有整体收束成面向前端的完整业务 Web API。

## 4. `teaching_information_system/`：TIS 领域能力

这个目录围绕 TIS 系统组织。

### 当前内部结构

- `api/`
  - 抓取和解析上游系统输出

- `data/`
  - 本地数据与同步结果

- `provider/`
  - 诊断、个人成绩、学分绩、已选课程等 use case

- `shared/`
  - TIS 领域内的共用工具

### 当前最适合怎么理解

TIS 这条线目前更像：

- Python 内部可调用能力
- 未来服务化或工具化的输入

相比 Blackboard CLI，它当前面向外部的“现成入口”更少。

## 5. `core/`：跨领域基础设施

当前 `core/` 主要用于放跨领域复用能力，例如认证。

这层当前体量不大，但边界很清楚：

- 不承载业务编排
- 主要提供可复用底座

## 6. `services/`：当前还是占位目录

`services/` 当前几乎还是空目录。

因此不要把它预设成：

- 已经形成统一 service layer
- 当前前后端编排入口
- 成熟的服务层实现

## 7. 当前运行时层和领域层是什么关系

当前很重要的一条边界是：

- `desktop_runtime/` + `copilot_runtime/` 组成当前本地聊天运行时层
- `blackboard/` 和 `teaching_information_system/` 属于领域能力层

目前默认聊天 runtime 并不会自动把 Blackboard / TIS 全量能力接成正式聊天工具目录。

也就是说：

- 聊天 runtime 已经可以独立工作
- 领域能力仍主要作为未来工具化或服务化输入

## 8. 测试如何分层

当前测试主要按两套维度组织：

### Unit 测试

- `tests/unit/copilot_runtime/`
- `tests/unit/desktop_runtime/`
- `tests/unit/data/`
- `tests/unit/provider/`
- `tests/unit/shared/`

这些测试主要关注单模块逻辑。

### Integration 测试

- `tests/integration/test_copilot_runtime_http.py`
- 其他 Blackboard / TIS 集成测试

这些测试主要验证模块之间协作，部分依赖真实凭据和网络。

### E2E 测试

- `tests/e2e/test_blackboard_snapshot_sync_e2e.py`

当前主要覆盖 Blackboard snapshot 同步整链路。

## 9. 现在应该去哪找什么

### 如果你想理解聊天运行时

优先阅读：

1. `backend/app/copilot_runtime/router.py`
2. `backend/app/copilot_runtime/protocol.py`
3. `backend/app/copilot_runtime/bridge.py`
4. `backend/app/copilot_runtime/session_store.py`

### 如果你想理解 desktop runtime 如何启动

优先阅读：

1. `backend/app/desktop_runtime/server.py`
2. `backend/app/desktop_runtime/config.py`
3. `backend/app/desktop_runtime/lifecycle.py`

### 如果你想理解 Blackboard / TIS 能力

建议按下面顺序读：

- `api/` → `provider/use_cases/` → `data/`

## 相关文档

- [后端分册](./README.md)
- [后端运行与配置](./run-and-config.md)
- [当前可观察契约参考](./reference-current-contracts.md)
- [聊天运行时契约](../system/chat-runtime-contract.md)
- [系统架构总览](../system/architecture-overview.md)

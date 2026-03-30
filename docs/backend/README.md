---
title: 后端分册
description: 后端文档入口，帮助读者理解 desktop runtime、copilot runtime、领域能力边界与推荐阅读顺序。
sidebar_position: 1
sidebar_label: 总览
---

# 后端分册

本文档作为后端分册入口，帮助读者先回答几个问题：

- 当前 Python 后端在整个系统里负责什么。
- desktop runtime 和 copilot runtime 现在分别承担什么角色。
- 当前聊天后端为什么已经不再适合只按旧 `agent/connect` / `agent/run` 去理解。
- Blackboard、TIS 与聊天 runtime 现在是什么关系。

## 先给一句话结论

当前后端可以概括成：

> **Electron 主进程托管一个本地 Python desktop runtime；它提供控制面端点与聊天根端点；而当前正式聊天主路径已经切到“智能体目录 → 会话创建 → 能力面 → 消息发送”的 session-first 方式。**

## 后端由哪些主要部分构成

当前后端主要由这几部分组成：

- `backend/app/desktop_runtime/`
  - 本地 loopback HTTP 服务
  - 提供健康检查、版本、诊断等控制面端点
  - 挂载聊天 runtime 路由

- `backend/app/copilot_runtime/`
  - 聊天运行时核心
  - 管理智能体目录、工具目录、会话存储和消息执行
  - 当前正式前端主路径使用 `agents/list`、`session/create`、`capabilities/get`、`message/send`

- `backend/app/blackboard/`
  - Blackboard 抓取、解析、同步和持久化能力

- `backend/app/teaching_information_system/`
  - TIS 抓取、解析与部分持久化能力

- `backend/tests/`
  - unit / integration / e2e 分层测试

## 后端在系统中的位置

### Desktop runtime + Copilot runtime

当前后端在系统中的位置可以这样理解：

1. Electron 主进程启动 Python desktop runtime 子进程。
2. desktop runtime 提供本地 HTTP 服务。
3. 控制面端点负责健康检查、版本、诊断。
4. 聊天根端点 `POST /` 负责智能体目录、会话、能力面和消息发送。

这里要特别注意两件事：

- 当前聊天仍然是单根路径协议；
- 但前端正式主路径已经不是旧 `info` / `agent/connect` / `agent/run` 的理解方式，而是 session-first 四方法主路径。

### Blackboard / TIS 与聊天 runtime 的关系

Blackboard 和 TIS 当前主要还是领域能力层：

- Blackboard 已有较清楚的 CLI、工具层和本地持久化链路
- TIS 已有 provider 可调用能力与部分持久化能力

它们和聊天 runtime 的关系当前更准确的说法是：

- 目前主要是 Python 内部能力与未来工具化输入；
- 还没有整体暴露成面向前端的完整业务 Web API；
- 当前默认聊天 runtime 也没有把 Blackboard / TIS 整体收编成正式聊天工具目录。

## 后端快速上手

### 安装依赖

如果你主要是运行 desktop runtime 或后端能力，推荐先执行：

```bash
cd backend
uv sync
```

如果还要跑测试：

```bash
cd backend
uv sync --extra test --extra dev
```

### 准备环境变量

建议把 `backend/.env.example` 复制成 `.env`，并至少准备：

- `SUSTECH_USERNAME`
- `SUSTECH_PASSWORD`
- `BLACKBOARD_CALENDAR_FEED_URL`（跑 ICS 时）
- `SUSTECH_DB_PATH`（如需覆盖数据库路径）

### 最值得优先尝试的运行入口

#### 1. Blackboard 课程目录搜索 CLI

```bash
cd backend
python -m app.blackboard.provider.cli.search_course_catalog --keyword 计算机 --preview 5
```

#### 2. Blackboard 日历 ICS 同步 CLI

```bash
cd backend
python -m app.blackboard.provider.cli.sync_calendar_ics --save-json
```

#### 3. Desktop runtime

如果你要验证本地聊天 runtime 或桌面后端服务，推荐从仓库根目录执行：

```bash
uv run --directory backend python -m app.desktop_runtime --model test
```

## 当前运行与配置边界

### 配置从哪里来

当前 runtime 的配置入口仍然是：

- CLI 参数
- 环境变量
- 默认值

统一配置中心已经正式落在 Electron 主进程侧。

所以当前更准确的关系是：

- Electron 主进程负责管理 `config-center/*.json`
- 宿主在下一次完整启动时，可把 `backendExposed.model` 投影成 Python `--model`
- Python runtime 自己不会直接读取统一配置中心分域文件

### 旧 `copilot-settings.json` 现在还剩什么意义

它当前主要只剩：

- 主进程内部迁移输入源

因此不要再把它写成：

- 当前正式配置主入口
- renderer 当前正式接口
- Python runtime 直接读取的长期配置文件

## 当前聊天后端到底已经做到什么

### 当前正式前端主路径

当前正式前端主路径是：

1. `agents/list`
2. `session/create`
3. `capabilities/get`
4. `message/send`

这条主路径已经体现出三层分工：

- 后端目录决定有哪些智能体
- 会话决定当前绑定的是哪个智能体
- 每次消息再决定本次使用哪个模型和哪些工具

### 仍然保留但不再是主路径的方法

当前 runtime 里仍然还能看到：

- `info`
- `agent/connect`
- `agent/run`

更准确的说法是：

- 它们现在仍可用于兼容调用和旧测试
- 但不再是当前正式前端主路径的权威说明

## 当前“已实现什么 / 尚不是什么”

### 已实现

- ✅ desktop runtime 本地 HTTP 服务
- ✅ 控制面端点（health / ready / version / diagnostics）
- ✅ session-first 聊天主路径四方法
- ✅ 内存态 session store
- ✅ 智能体目录与工具目录最小实现
- ✅ Blackboard CLI 与本地持久化链路
- ✅ TIS provider 可调用能力
- ✅ 分层测试（unit / integration / e2e）

### 代码里可调用，但不是正式入口

- ⚠️ Blackboard 工具函数
- ⚠️ TIS provider use case
- ⚠️ Blackboard / TIS 更细粒度内部结果对象

### 当前尚不是什么

- ❌ 不是完整业务 Web API 服务
- ❌ 不是持久化会话管理系统
- ❌ 不是 Python runtime 直接读取统一配置中心的架构
- ❌ 不是已经把 Blackboard / TIS 全量接成聊天工具目录的系统

## 推荐阅读顺序

### 第一次接手后端

建议按这个顺序阅读：

1. [系统架构总览](../system/architecture-overview.md)
2. [运行时生命周期](../system/runtime-lifecycle.md)
3. 本文档
4. [后端模块布局](./module-layout.md)
5. [后端运行与配置](./run-and-config.md)
6. [当前可观察契约参考](./reference-current-contracts.md)

### 如果你主要想理解聊天 runtime

建议阅读：

1. [聊天运行时契约](../system/chat-runtime-contract.md)
2. [会话与状态模型](../system/session-and-state-model.md)
3. [后端模块布局](./module-layout.md)

### 如果你主要想理解现阶段边界

建议阅读：

1. [边界与路线图](./roadmap-and-boundaries.md)
2. [前后端连接现状说明](./frontend-connection.md)
3. [未来 API 草案参考](./reference-future-api-draft.md)

## 关键代码位置

### Desktop Runtime

- `backend/app/desktop_runtime/server.py`
- `backend/app/desktop_runtime/config.py`
- `backend/app/desktop_runtime/lifecycle.py`
- `backend/app/desktop_runtime/health.py`

### Copilot Runtime

- `backend/app/copilot_runtime/router.py`
- `backend/app/copilot_runtime/protocol.py`
- `backend/app/copilot_runtime/contracts.py`
- `backend/app/copilot_runtime/bridge.py`
- `backend/app/copilot_runtime/session_store.py`
- `backend/app/copilot_runtime/agent_registry.py`
- `backend/app/copilot_runtime/tool_registry.py`
- `backend/app/copilot_runtime/composition.py`

### 领域能力

- `backend/app/blackboard/`
- `backend/app/teaching_information_system/`
- `backend/tests/`

## 相关文档

- [系统架构总览](../system/architecture-overview.md)
- [聊天运行时契约](../system/chat-runtime-contract.md)
- [会话与状态模型](../system/session-and-state-model.md)
- [后端运行与配置](./run-and-config.md)
- [当前可观察契约参考](./reference-current-contracts.md)

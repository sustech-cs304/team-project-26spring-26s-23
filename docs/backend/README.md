---
title: 后端分册
description: 后端文档入口，说明能力边界、快速上手路径与推荐阅读顺序。
sidebar_position: 1
sidebar_label: 总览
---

# 后端分册

## 文档目标

本文档作为后端子系统的入口，帮助读者理解当前 Python 后端的职责边界、主要组成部分，以及如何在整个系统中定位后端的角色。

## 后端子系统的定位

当前后端由以下主要部分构成：

- `backend/app/desktop_runtime/`：桌面宿主本地 HTTP 服务，提供健康检查、诊断端点，并挂载 Copilot runtime
- `backend/app/copilot_runtime/`：单端点聊天 runtime，支持 `info`、`agent/connect`、`agent/run` 三类方法
- `backend/app/blackboard/`：Blackboard 系统的抓取、解析、同步与持久化能力
- `backend/app/teaching_information_system/`：TIS 系统的抓取、解析与部分持久化能力
- `backend/tests/`：分层测试（unit / integration / e2e）

**文档定位**：本文档是后端分册入口，并吸收了原 `backend/README.md` 中的快速上手信息。

## 后端在系统中的位置

### Desktop Runtime + Copilot Runtime

当前已落地的 **desktop runtime** 与 **copilot runtime** 在整个系统中扮演以下角色：

1. **Desktop Runtime** 作为 Electron 主进程托管的 Python 子进程，提供本地 HTTP 服务（默认 `127.0.0.1:8765`）
2. **Copilot Runtime** 挂载在 desktop runtime 的根路径 `/`，提供单端点聊天能力
3. 两者共同构成**最小聊天 MVP** 的后端支撑，支持多轮对话、session 管理、agent 执行

**系统视角**：参见 [系统架构总览](../system/architecture-overview.md) 了解 Electron 主进程、Python runtime、Renderer 之间的关系。

**启动链路**：参见 [运行时生命周期](../system/runtime-lifecycle.md) 了解 development / bundled 两种模式的启动流程。

**代码锚点**：
- Desktop runtime 服务创建：[`backend/app/desktop_runtime/server.py`](../../backend/app/desktop_runtime/server.py)
- Copilot runtime 路由：[`backend/app/copilot_runtime/router.py`](../../backend/app/copilot_runtime/router.py)
- Copilot runtime 组装：[`backend/app/copilot_runtime/composition.py`](../../backend/app/copilot_runtime/composition.py)

**测试依据**：
- Desktop runtime 单元测试：[`backend/tests/unit/desktop_runtime/test_server.py`](../../backend/tests/unit/desktop_runtime/test_server.py)
- Copilot runtime 集成测试：[`backend/tests/integration/test_copilot_runtime_http.py`](../../backend/tests/integration/test_copilot_runtime_http.py)

### Blackboard / TIS 与桌面聊天运行时的关系

Blackboard 和 TIS 相关能力当前主要以以下形式存在：

- **Blackboard**：已有较明确的 CLI 入口（课程目录搜索、日历 ICS 同步）、provider use case、数据同步与本地持久化链路
- **TIS**：已有 provider 可调用能力（诊断、个人成绩、学分绩、已选课程），部分支持持久化，但尚无明确的 CLI 入口

这些能力与桌面聊天运行时的关系：

- **当前状态**：Blackboard / TIS 能力主要作为 Python 内部可调用的工具层，尚未直接暴露为桌面聊天运行时的 HTTP API
- **未来方向**：可通过 tool registry 将这些能力注册为 agent 可调用的 tools，从而在聊天界面中使用

**代码锚点**：
- Blackboard API 层：`backend/app/blackboard/api/`
- TIS API 层：`backend/app/teaching_information_system/api/`
- Tool registry：[`backend/app/copilot_runtime/tool_registry.py`](../../backend/app/copilot_runtime/tool_registry.py)

## 后端快速上手

### 安装依赖

如果你主要是运行后端能力或 desktop runtime，推荐先在 `backend/` 目录执行：

```bash
cd backend
uv sync
```

如果你还需要运行测试或类型检查，建议补齐可选依赖：

```bash
cd backend
uv sync --extra test --extra dev
```

### 准备环境变量

建议将 [`backend/.env.example`](../../backend/.env.example) 复制为 `.env`，并至少准备以下项目：

- `SUSTECH_USERNAME`
- `SUSTECH_PASSWORD`
- `BLACKBOARD_CALENDAR_FEED_URL`（运行 ICS 同步时）
- `SUSTECH_DB_PATH`（如果你希望覆盖默认数据库路径）

### 优先选择的运行入口

如果你要快速确认当前后端到底能跑什么，优先按下面顺序尝试：

1. **Blackboard 课程目录搜索 CLI**

   ```bash
   cd backend
   python -m app.blackboard.provider.cli.search_course_catalog --keyword 计算机 --preview 5
   ```

2. **Blackboard 日历 ICS 同步 CLI**

   ```bash
   cd backend
   python -m app.blackboard.provider.cli.sync_calendar_ics --save-json
   ```

3. **Desktop runtime 最小聊天入口**

   如果你要验证桌面宿主本地 HTTP 服务或最小聊天链路，建议优先阅读 [后端运行与配置](./run-and-config.md)。开发态最小链路至少应显式传入 `--model test`，以确认 runtime 协议链路可以启动。

### 测试与验证

常见测试命令如下：

```bash
cd backend
pytest
pytest -m "not live"
pytest -m live
```

其中 `live` 类测试依赖真实凭据与网络环境；如果你只做本地结构验证，优先运行 `pytest -m "not live"`。

## 当前后端"已实现什么 / 尚不是什么"

### 已实现

- ✅ Desktop runtime 本地 HTTP 服务（健康检查、诊断、版本信息）
- ✅ Copilot runtime 单端点聊天能力（info、connect、run）
- ✅ 内存 session store（多轮对话历史）
- ✅ Agent registry 与 tool registry（当前默认单 agent、单 toolset）
- ✅ Blackboard CLI（课程目录搜索、日历 ICS 同步）
- ✅ Blackboard 数据同步与本地持久化链路
- ✅ TIS provider 可调用能力（诊断、成绩、学分绩、已选课程）
- ✅ 分层测试（unit / integration / e2e）

### 代码里可调用，但不是正式入口

- ⚠️ Blackboard 工具函数（返回字典结果，非 HTTP 响应）
- ⚠️ TIS provider use case（可在 Python 内调用，但无明确 CLI 入口）
- ⚠️ `app/blackboard/api/` 和 `app/teaching_information_system/api/`（这里的 `api` 更接近"访问上游系统并解析结果"，不是给前端直接调用的 HTTP API）

### 尚不是什么

- ❌ **不是完整的统一业务 Web API**：当前 desktop runtime 提供的是最小聊天 MVP 的 HTTP 端点，不是面向前端的完整业务 API 后端
- ❌ **不是服务化架构**：`app/services/` 当前只是占位 package，不表示已经形成服务层编排
- ❌ **不是持久化 session 管理**：session store 当前在内存中，Python runtime 重启后丢失

**边界说明**：可继续阅读 [边界与路线图](./roadmap-and-boundaries.md) 与 [当前可观察契约参考](./reference-current-contracts.md) 获取更细的判断依据。

## 推荐阅读顺序

### 首次接手后端

如果你是第一次接手后端，建议按以下顺序阅读：

1. **先建立系统全局视角**：
   - [系统架构总览](../system/architecture-overview.md)：理解 Electron + Python runtime 的整体架构
   - [运行时生命周期](../system/runtime-lifecycle.md)：理解 desktop runtime 如何被启动、配置、就绪

2. **再深入后端分册**：
   - 本文档：理解后端当前是什么、能跑什么、还不能当成什么
   - [模块布局](./module-layout.md)：理解 `desktop_runtime`、`copilot_runtime`、`blackboard`、`teaching_information_system` 等目录的职责
   - [运行与配置](./run-and-config.md)：理解如何运行 desktop runtime、Blackboard CLI，以及配置如何影响运行

3. **理解边界与契约**：
   - [边界与路线图](./roadmap-and-boundaries.md)：明确区分"已实现 / 可调用但不是正式入口 / 未来草案"
   - [当前可观察契约参考](./reference-current-contracts.md)：查看当前真正可观察到的输出契约

### 需要理解聊天运行时契约

如果你需要理解 desktop runtime 与 copilot runtime 的 HTTP 契约，建议阅读：

- [聊天运行时契约](../system/chat-runtime-contract.md)：理解单端点协议、`info` / `agent/connect` / `agent/run` 三类请求、显式失败与结构化错误

### 需要理解 session 与状态管理

如果你需要理解 session store、threadId 语义、hosted backend state，建议阅读：

- [Session 与状态模型](../system/session-and-state-model.md)：理解 threadId、多轮上下文、session store、hosted backend state、renderer config state

### 需要对接前端或理解前后端连接

如果你需要理解前后端如何连接，建议阅读：

- [前后端连接现状说明](./frontend-connection.md)：理解当前前后端连接的实际状态，避免把未来草案当成现成接口

## 后端分册文档列表

### 说明型专题

- [模块布局](./module-layout.md)：后端目录结构与各模块职责
- [运行与配置](./run-and-config.md)：如何运行 desktop runtime、Blackboard CLI，配置来源与优先级
- [边界与路线图](./roadmap-and-boundaries.md)：明确区分已实现、可调用但不是正式入口、未来草案
- [前后端连接现状说明](./frontend-connection.md)：前后端连接的实际状态

### 结构化附录

- [运行与配置参考](./reference-run-and-config.md)：命令、配置项、环境变量的结构化参考
- [当前可观察契约参考](./reference-current-contracts.md)：当前真正可观察到的输出契约
- [未来 API 草案参考](./reference-future-api-draft.md)：未来可能的 API 设计草案（非当前实现承诺）

## 关键代码锚点

### Desktop Runtime

- 服务创建：[`backend/app/desktop_runtime/server.py`](../../backend/app/desktop_runtime/server.py)
- 配置解析：[`backend/app/desktop_runtime/config.py`](../../backend/app/desktop_runtime/config.py)
- 生命周期管理：[`backend/app/desktop_runtime/lifecycle.py`](../../backend/app/desktop_runtime/lifecycle.py)
- 健康检查：[`backend/app/desktop_runtime/health.py`](../../backend/app/desktop_runtime/health.py)

### Copilot Runtime

- 路由：[`backend/app/copilot_runtime/router.py`](../../backend/app/copilot_runtime/router.py)
- 组装：[`backend/app/copilot_runtime/composition.py`](../../backend/app/copilot_runtime/composition.py)
- 契约：[`backend/app/copilot_runtime/contracts.py`](../../backend/app/copilot_runtime/contracts.py)
- Bridge：[`backend/app/copilot_runtime/bridge.py`](../../backend/app/copilot_runtime/bridge.py)
- Session store：[`backend/app/copilot_runtime/session_store.py`](../../backend/app/copilot_runtime/session_store.py)
- Agent registry：[`backend/app/copilot_runtime/agent_registry.py`](../../backend/app/copilot_runtime/agent_registry.py)
- Tool registry：[`backend/app/copilot_runtime/tool_registry.py`](../../backend/app/copilot_runtime/tool_registry.py)

### Blackboard

- API 层：`backend/app/blackboard/api/`
- 数据层：`backend/app/blackboard/data/`
- 共享工具：`backend/app/blackboard/shared/`

### Teaching Information System

- API 层：`backend/app/teaching_information_system/api/`
- 数据层：`backend/app/teaching_information_system/data/`
- Provider 层：`backend/app/teaching_information_system/provider/`
- 共享工具：`backend/app/teaching_information_system/shared/`

### 测试

- Desktop runtime 单元测试：`backend/tests/unit/desktop_runtime/`
- Copilot runtime 单元测试：`backend/tests/unit/copilot_runtime/`
- Blackboard 单元测试：`backend/tests/unit/api/`（部分）、`backend/tests/unit/provider/`（部分）
- TIS 单元测试：`backend/tests/unit/api/`（部分）、`backend/tests/unit/provider/`（部分）
- 集成测试：`backend/tests/integration/`
- E2E 测试：`backend/tests/e2e/`

## 相关文档

### 系统专题

- [系统架构总览](../system/architecture-overview.md)
- [运行时生命周期](../system/runtime-lifecycle.md)
- [聊天运行时契约](../system/chat-runtime-contract.md)
- [Session 与状态模型](../system/session-and-state-model.md)

### 前端分册

- [前端分册入口](../frontend/README.md)

---

**文档版本**：2026-03-25  
**对应代码版本**：当前 main 分支

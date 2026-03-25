# 后端模块布局

本文档说明当前 Python 后端的目录组织与模块职责边界，帮助读者理解代码按什么原则分层、新增的 runtime 模块如何与既有领域模块协作、以及测试如何按层次分布。

## 核心分层原则

当前后端按以下边界组织：

- **Desktop Runtime**（[`backend/app/desktop_runtime/`](../../backend/app/desktop_runtime/)）：桌面宿主使用的本地 HTTP 服务器，负责启动、配置解析、健康检查与生命周期管理
- **Copilot Runtime**（[`backend/app/copilot_runtime/`](../../backend/app/copilot_runtime/)）：聊天运行时核心，包含协议解析、会话管理、agent/tool 注册表与执行桥接
- **领域模块**（[`backend/app/blackboard/`](../../backend/app/blackboard/) 与 [`backend/app/teaching_information_system/`](../../backend/app/teaching_information_system/)）：围绕上游系统组织的抓取、解析、同步与持久化能力
- **基础设施**（[`backend/app/core/`](../../backend/app/core/)）：认证等跨领域复用能力
- **服务层占位**（[`backend/app/services/`](../../backend/app/services/)）：目录已存在但尚未形成强存在感的统一服务层

## Desktop Runtime：本地 HTTP 服务器

[`backend/app/desktop_runtime/`](../../backend/app/desktop_runtime/) 是桌面宿主（Electron 主进程）启动的 Python 子进程入口，负责：

- **HTTP 服务器**（[`server.py`](../../backend/app/desktop_runtime/server.py)）：基于 FastAPI 的最小本地服务，监听 loopback 地址，处理 CORS 与 Electron null origin，挂载 copilot runtime 路由与健康检查端点
- **配置解析**（[`config.py`](../../backend/app/desktop_runtime/config.py)）：解析 CLI 参数与环境变量，构建运行时配置（host/port、路径、模型、local token 等）
- **生命周期管理**（[`lifecycle.py`](../../backend/app/desktop_runtime/lifecycle.py)）：管理启动/关闭钩子，确保目录创建
- **健康检查**（[`health.py`](../../backend/app/desktop_runtime/health.py)）：提供 `/health`、`/ready`、`/version`、`/diagnostics` 端点契约

Desktop runtime 不直接实现聊天逻辑，而是通过 [`composition.py`](../../backend/app/copilot_runtime/composition.py) 组装 copilot runtime 依赖，并将其路由挂载到 FastAPI 应用中。

**关键代码锚点**：
- [`backend/app/desktop_runtime/server.py:73-162`](../../backend/app/desktop_runtime/server.py) - `create_app()` 函数展示如何组装 runtime 依赖并挂载路由
- [`backend/app/desktop_runtime/config.py:234-336`](../../backend/app/desktop_runtime/config.py) - `parse_runtime_config()` 展示配置解析逻辑

## Copilot Runtime：聊天运行时核心

[`backend/app/copilot_runtime/`](../../backend/app/copilot_runtime/) 实现最小可用的多 agent 聊天运行时，当前处于 MVP 阶段（phase3-run-bridge），支持纯文本对话。

### 模块职责分工

- **[`contracts.py`](../../backend/app/copilot_runtime/contracts.py)**：定义运行时契约数据类（info/connect/run 请求与响应、session descriptor、scaffold 等）
- **[`protocol.py`](../../backend/app/copilot_runtime/protocol.py)**：解析与规范化 HTTP 请求 payload，提取 method、验证字段、构建内部请求对象
- **[`router.py`](../../backend/app/copilot_runtime/router.py)**：FastAPI 路由层，处理 `/` 端点的 POST 请求，分发到 info/connect/run 处理逻辑，返回 SSE 事件流
- **[`bridge.py`](../../backend/app/copilot_runtime/bridge.py)**：桥接层，协调 session 加载、agent 解析、executor 调用与成功持久化
- **[`session_store.py`](../../backend/app/copilot_runtime/session_store.py)**：进程内会话存储，按 `thread_id` 管理 user/assistant 消息历史
- **[`agent_registry.py`](../../backend/app/copilot_runtime/agent_registry.py)**：agent 元数据注册表，当前注册单个默认 agent
- **[`tool_registry.py`](../../backend/app/copilot_runtime/tool_registry.py)**：tool 元数据注册表，当前注册空的默认 toolset（为未来扩展预留）
- **[`composition.py`](../../backend/app/copilot_runtime/composition.py)**：依赖组装层，构建 `RuntimeDependencies` 对象图，避免在 server 层手动拼装

### 协议处理流程

1. **请求到达** → [`router.py`](../../backend/app/copilot_runtime/router.py) 的 `handle_runtime_root()` 接收 POST 请求
2. **协议解析** → [`protocol.py`](../../backend/app/copilot_runtime/protocol.py) 的 `RuntimeProtocolParser` 提取 method 与请求体
3. **方法分发**：
   - `info` → 返回 scaffold 的 info 响应（agents、supportedMethods 等）
   - `agent/connect` → 创建或获取 session，返回连接事件流
   - `agent/run` → 调用 bridge 执行 agent，返回运行事件流
4. **执行桥接** → [`bridge.py`](../../backend/app/copilot_runtime/bridge.py) 的 `RuntimeBridge.run()` 加载历史、解析 agent、调用 executor、持久化结果
5. **响应返回** → 以 SSE 格式流式返回事件（`RUN_STARTED`、`TEXT_MESSAGE_CONTENT`、`RUN_FINISHED` 等）

**关键代码锚点**：
- [`backend/app/copilot_runtime/composition.py:31-65`](../../backend/app/copilot_runtime/composition.py) - `build_default_runtime_dependencies()` 展示依赖组装
- [`backend/app/copilot_runtime/router.py:39-70`](../../backend/app/copilot_runtime/router.py) - 单端点路由分发逻辑
- [`backend/app/copilot_runtime/bridge.py:49-72`](../../backend/app/copilot_runtime/bridge.py) - `RuntimeBridge.run()` 展示执行流程

### 当前扩展边界

- **Agent 扩展**：通过 [`agent_registry.py`](../../backend/app/copilot_runtime/agent_registry.py) 注册新 agent descriptor，提供 executor factory
- **Tool 扩展**：通过 [`tool_registry.py`](../../backend/app/copilot_runtime/tool_registry.py) 注册新 toolset descriptor（当前为空实现，预留未来扩展）
- **Session 存储**：当前为进程内存储（[`InMemorySessionStore`](../../backend/app/copilot_runtime/session_store.py)），未来可替换为持久化实现

## 领域模块：Blackboard 与 TIS

[`backend/app/blackboard/`](../../backend/app/blackboard/) 和 [`backend/app/teaching_information_system/`](../../backend/app/teaching_information_system/) 是两条并列的领域线，围绕上游系统组织抓取、解析、同步能力。

### 共同的内部分层

两个领域模块都采用类似的内部分层：

- **`api/`**：访问上游系统的接口层，负责 HTTP 请求、HTML/JSON 解析、DTO 构建
  - 示例：[`backend/app/blackboard/api/course_client.py`](../../backend/app/blackboard/api/course_client.py)、[`backend/app/teaching_information_system/api/client.py`](../../backend/app/teaching_information_system/api/client.py)
- **`data/`**：本地持久化层，负责 SQLite 数据库同步、模型定义、同步操作
  - 示例：[`backend/app/teaching_information_system/data/db_manager.py`](../../backend/app/teaching_information_system/data/db_manager.py)、[`backend/app/teaching_information_system/data/models.py`](../../backend/app/teaching_information_system/data/models.py)
- **`provider/`**：用例编排层，串联登录、抓取、解析、持久化等步骤（Blackboard 还包含 `cli/` 与 `tools/` 子目录）
- **`shared/`**：领域内复用工具，如日志、时间、文本、ID 处理
  - 示例：[`backend/app/blackboard/shared/datetime.py`](../../backend/app/blackboard/shared/datetime.py)、[`backend/app/teaching_information_system/shared/semesters.py`](../../backend/app/teaching_information_system/shared/semesters.py)

### 与 Runtime 的关系

Desktop runtime 与 copilot runtime 是**独立的运行时层**，不依赖 Blackboard/TIS 领域模块。当前：

- Desktop runtime 启动时只组装 copilot runtime 依赖，不加载领域模块
- Copilot runtime 的默认 agent 是最小实现，不调用 Blackboard/TIS 能力
- 未来若需要将 Blackboard/TIS 能力暴露给 agent，需要通过 tool registry 注册工具函数

这种分离确保了运行时层的轻量与可测试性。

## 基础设施与服务层

### Core：跨领域基础能力

[`backend/app/core/`](../../backend/app/core/) 提供认证等底层能力：

- **[`core/auth/cas_client.py`](../../backend/app/core/auth/cas_client.py)**：CAS 登录客户端，被 Blackboard/TIS 的 `api/context.py` 使用

当前 `core/` 规模较小，主要服务于领域模块的认证需求。

### Services：尚未成型的服务层

[`backend/app/services/`](../../backend/app/services/) 目录已存在，但当前只有空的 `__init__.py`，尚未形成统一的服务编排层。不要将其预设为成熟的 service layer。

## 测试分层

[`backend/tests/`](../../backend/tests/) 按测试类型与模块边界组织：

### Unit 测试

- **[`tests/unit/copilot_runtime/`](../../backend/tests/unit/copilot_runtime/)**：copilot runtime 各模块的单元测试
  - [`test_protocol.py`](../../backend/tests/unit/copilot_runtime/test_protocol.py) - 协议解析逻辑
  - [`test_router.py`](../../backend/tests/unit/copilot_runtime/test_router.py) - 路由分发逻辑
  - [`test_bridge.py`](../../backend/tests/unit/copilot_runtime/test_bridge.py) - 桥接层逻辑
  - [`test_session_store.py`](../../backend/tests/unit/copilot_runtime/test_session_store.py) - 会话存储
  - [`test_agent_registry.py`](../../backend/tests/unit/copilot_runtime/test_agent_registry.py) - agent 注册表
  - [`test_tool_registry.py`](../../backend/tests/unit/copilot_runtime/test_tool_registry.py) - tool 注册表
  - [`test_composition.py`](../../backend/tests/unit/copilot_runtime/test_composition.py) - 依赖组装

- **[`tests/unit/desktop_runtime/`](../../backend/tests/unit/desktop_runtime/)**：desktop runtime 的单元测试
  - [`test_config.py`](../../backend/tests/unit/desktop_runtime/test_config.py) - 配置解析
  - [`test_server.py`](../../backend/tests/unit/desktop_runtime/test_server.py) - 服务器创建与路由挂载

- **[`tests/unit/api/`](../../backend/tests/unit/api/)**：Blackboard/TIS 的 API 层单元测试
- **[`tests/unit/data/`](../../backend/tests/unit/data/)**：数据同步与持久化单元测试
- **[`tests/unit/provider/`](../../backend/tests/unit/provider/)**：用例编排层单元测试
- **[`tests/unit/shared/`](../../backend/tests/unit/shared/)**：共享工具单元测试

### Integration 测试

- **[`tests/integration/test_copilot_runtime_http.py`](../../backend/tests/integration/test_copilot_runtime_http.py)**：copilot runtime 的 HTTP 端到端测试，验证 info/connect/run 方法的完整流程
- **[`tests/integration/test_comprehensive_live.py`](../../backend/tests/integration/test_comprehensive_live.py)**：Blackboard 综合集成测试（需真实凭据）
- **[`tests/integration/test_tis_*_live.py`](../../backend/tests/integration/)**：TIS 各模块的集成测试（需真实凭据）

### E2E 测试

- **[`tests/e2e/test_blackboard_snapshot_sync_e2e.py`](../../backend/tests/e2e/test_blackboard_snapshot_sync_e2e.py)**：Blackboard 快照同步的端到端测试

**测试分层原则**：
- Unit 测试聚焦单个模块逻辑，使用 mock 隔离外部依赖
- Integration 测试验证模块间协作，部分需要真实上游系统凭据
- E2E 测试验证完整用户场景

## 阅读建议

如果你是第一次接手后端代码，建议按以下顺序阅读：

1. **理解运行时启动**：从 [`backend/app/desktop_runtime/server.py`](../../backend/app/desktop_runtime/server.py) 的 `create_app()` 开始，了解如何组装依赖并启动服务
2. **理解聊天协议**：阅读 [`backend/app/copilot_runtime/router.py`](../../backend/app/copilot_runtime/router.py) 与 [`backend/app/copilot_runtime/protocol.py`](../../backend/app/copilot_runtime/protocol.py)，了解请求如何解析与分发
3. **理解执行流程**：阅读 [`backend/app/copilot_runtime/bridge.py`](../../backend/app/copilot_runtime/bridge.py)，了解 agent 如何被调用
4. **理解领域能力**：选择 Blackboard 或 TIS 其中一条线，从 `api/` → `provider/` → `data/` 顺序阅读，了解如何抓取与持久化数据
5. **理解测试覆盖**：查看 [`backend/tests/unit/copilot_runtime/`](../../backend/tests/unit/copilot_runtime/) 与 [`backend/tests/integration/test_copilot_runtime_http.py`](../../backend/tests/integration/test_copilot_runtime_http.py)，了解如何验证运行时行为

**相关文档**：
- [运行与配置](./run-and-config.md) - 如何启动后端与配置参数
- [系统架构概览](../system/architecture-overview.md) - 前后端整体架构
- [运行时生命周期](../system/runtime-lifecycle.md) - 跨进程启动链路
- [聊天运行时契约](../system/chat-runtime-contract.md) - HTTP 协议详细说明

# 系统架构总览

## 文档目标

本文档帮助新成员在一篇文档中理解当前系统全貌，建立整体心智模型。阅读时间约 5-10 分钟。

## 系统定位

赶渡 CanDue 是一个基于 Electron 的桌面应用，当前处于**最小聊天 MVP 阶段**，核心能力是提供一个本地托管的 AI 助手聊天界面。系统采用"Electron 宿主 + Python 后端 runtime"架构，前端通过 HTTP 与本地 Python 服务通信。

## 核心组件关系

### 组件拓扑

```
┌─────────────────────────────────────────────────────────────┐
│ Electron 主进程 (main.ts)                                    │
│  - 管理窗口生命周期                                           │
│  - 启动/停止 Python runtime                                   │
│  - 提供 IPC 桥接（settings、runtime snapshot）                │
└────────────┬────────────────────────────────────────────────┘
             │
             │ spawn 子进程
             ↓
┌─────────────────────────────────────────────────────────────┐
│ Python Desktop Runtime (backend/app/desktop_runtime/)       │
│  - FastAPI HTTP 服务（默认 127.0.0.1:8765）                  │
│  - 提供 /health、/ready、/diagnostics 等管理端点             │
│  - 挂载 Copilot Runtime 单端点路由                           │
└────────────┬────────────────────────────────────────────────┘
             │
             │ 挂载路由
             ↓
┌─────────────────────────────────────────────────────────────┐
│ Copilot Runtime (backend/app/copilot_runtime/)              │
│  - 单端点聊天 runtime（POST /）                              │
│  - 支持 info、agent/connect、agent/run 三类方法              │
│  - 管理 session store（内存中的多轮对话历史）                │
│  - 默认单 agent（名为 "default"）                            │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Electron Renderer (frontend-copilot/src/)                   │
│  - React 应用，提供聊天 UI                                    │
│  - 通过 fetch 调用本地 Python runtime                        │
│  - 集成 CopilotKit 作为聊天 UI 框架                          │
└─────────────────────────────────────────────────────────────┘
```

### 主要数据流

1. **启动流程**：
   - Electron 主进程启动 → 创建窗口 → 并行启动 Python runtime
   - Python runtime 启动 → 监听端口 → 报告 `/ready` 端点可用
   - Renderer 加载 → 通过 IPC 获取 runtime URL → 连接到本地 HTTP 服务

2. **聊天流程**：
   - 用户在 Renderer 输入消息 → CopilotKit 发起 HTTP POST 请求到 `/`
   - Copilot Runtime 解析请求 → 调用 PydanticAI agent → 返回 SSE 流式响应
   - Session store 记录 user/assistant 消息对，维护多轮上下文

3. **配置流程**：
   - Renderer 通过 IPC 请求加载/保存 settings
   - Electron 主进程读写 `config/copilot-settings.json`
   - Settings 当前仅包含 `runtimeUrl` 与 `agentName`，用于配置本地 Copilot Runtime 地址及默认使用的 agent 名称

## 关键子系统说明

### 1. Electron 主进程

**代码锚点**：[`frontend-copilot/electron/main.ts`](../../frontend-copilot/electron/main.ts)

**职责**：
- 管理 BrowserWindow 生命周期
- 通过 `PythonRuntimeManager` 启动/停止 Python 子进程
- 提供 IPC handlers：
  - `COPILOT_SETTINGS_LOAD_CHANNEL` / `COPILOT_SETTINGS_SAVE_CHANNEL`
  - `COPILOT_RUNTIME_LOAD_CHANNEL` / `COPILOT_RUNTIME_RETRY_CHANNEL`
- 在 `before-quit` 时优雅关闭 Python runtime

**关键依赖**：
- `PythonRuntimeManager`：管理 Python 子进程的启动、健康检查、停止
- `HostedBackendService`：封装 runtime manager，提供统一的 start/stop 接口

### 2. Python Desktop Runtime

**代码锚点**：[`backend/app/desktop_runtime/server.py`](../../backend/app/desktop_runtime/server.py)

**职责**：
- 提供本地 HTTP 服务（FastAPI），默认监听 `127.0.0.1:8765`
- 仅允许 loopback 地址，拒绝外部访问
- 提供管理端点：
  - `GET /health`：健康检查
  - `GET /ready`：就绪检查（启动时轮询此端点）
  - `GET /diagnostics`：诊断信息（需要 local token）
  - `GET /version`：版本信息
- 挂载 Copilot Runtime 路由到 `POST /`

**配置来源**：
- CLI 参数（由 Electron 主进程传递）
- 环境变量（如 `COPILOT_DESKTOP_RUNTIME_HOST`、`COPILOT_DESKTOP_RUNTIME_PORT`）
- 配置文件路径由 CLI 参数指定

**代码锚点**：[`backend/app/desktop_runtime/config.py`](../../backend/app/desktop_runtime/config.py)

### 3. Copilot Runtime（单端点聊天 runtime）

**代码锚点**：[`backend/app/copilot_runtime/router.py`](../../backend/app/copilot_runtime/router.py)

**职责**：
- 提供单端点 `POST /` 接收所有聊天请求
- 根据 `method` 字段路由到不同处理逻辑：
  - `info`：返回 runtime 元信息（支持的 agents、methods）
  - `agent/connect`：建立 session，返回 session descriptor
  - `agent/run`：执行用户消息，调用 agent，返回 assistant 回复
- 返回 SSE（Server-Sent Events）流式响应
- 错误处理：返回结构化错误（如 `agent_not_found`、`model_not_configured`）

**核心契约**：[`backend/app/copilot_runtime/contracts.py`](../../backend/app/copilot_runtime/contracts.py)

**测试依据**：[`backend/tests/integration/test_copilot_runtime_http.py`](../../backend/tests/integration/test_copilot_runtime_http.py)

### 4. Session Store

**代码锚点**：[`backend/app/copilot_runtime/session_store.py`](../../backend/app/copilot_runtime/session_store.py)

**职责**：
- 维护 `threadId` → `RuntimeSessionRecord` 的映射
- 每个 session 包含：
  - `thread_id`：唯一标识一个对话线程
  - `agent_name`：当前使用的 agent
  - `messages`：user/assistant 消息历史
  - `metadata`：元数据（如 `last_run_id`）
  - `created_at` / `updated_at`：时间戳
- 当前实现：`InMemorySessionStore`（进程内存，重启丢失）

**语义**：
- `threadId` 是前端生成的 UUID，代表一个对话线程
- 同一 `threadId` 的多次 `agent/run` 请求会复用历史消息
- Session 在 Python runtime 重启后丢失（未持久化）

### 5. Agent Registry & Tool Registry

**代码锚点**：
- [`backend/app/copilot_runtime/agent_registry.py`](../../backend/app/copilot_runtime/agent_registry.py)
- [`backend/app/copilot_runtime/tool_registry.py`](../../backend/app/copilot_runtime/tool_registry.py)

**当前状态**：
- **Agent Registry**：注册可用的 agents，当前默认只有一个名为 `"default"` 的 agent
- **Tool Registry**：注册可用的 toolsets，当前默认只有一个名为 `"default"` 的空 toolset
- **边界**：这两个 registry 主要承载**注册与元数据管理**，不是完整的业务 API 后端
- **未来扩展**：多 agent、多 toolset 的支持已预留接口，但当前 MVP 仅使用默认单例

### 6. Electron Renderer

**代码锚点**：[`frontend-copilot/src/CopilotAppRoot.tsx`](../../frontend-copilot/src/CopilotAppRoot.tsx)

**职责**：
- 提供聊天 UI（基于 CopilotKit）
- 启动时通过 IPC 加载 runtime snapshot，获取 `runtimeUrl`
- 根据 runtime 状态决定是否注入 CopilotKit Provider
- 提供重试机制（当 runtime 启动失败时）

**状态管理**：
- `CopilotBootstrapState`：runtime 启动状态（loading、ready、degraded、error）
- `CopilotSettings`：用户配置（`runtimeUrl`、`agentName`）

**代码锚点**：[`frontend-copilot/src/features/copilot/config.ts`](../../frontend-copilot/src/features/copilot/config.ts)

## 运行时产物与目录

### 目录结构

默认情况下，运行时产物存储在 Electron `userData` 目录下：

```
<userData>/
└── desktop-runtime/
    ├── config/
    │   └── copilot-settings.json      # 用户配置
    ├── logs/
    │   ├── electron-host.log          # Electron 主进程日志
    │   ├── backend.stdout.log         # Python 子进程 stdout
    │   └── backend.stderr.log         # Python 子进程 stderr
    ├── database/                      # 预留（当前未使用）
    └── state/
        ├── runtime-snapshot.json      # Runtime 状态快照
        └── last-failure.json          # 最近失败记录
```

**代码锚点**：
- [`backend/app/desktop_runtime/config.py`](../../backend/app/desktop_runtime/config.py) - `DesktopRuntimePaths`
- [`frontend-copilot/electron/runtime/runtime-paths.ts`](../../frontend-copilot/electron/runtime/runtime-paths.ts)

### Settings 语义

`copilot-settings.json` 包含：
- `runtimeUrl`：本地 Copilot Runtime 地址（如 `http://127.0.0.1:8765`）
- `agentName`：默认使用的 agent 名称

**代码锚点**：[`frontend-copilot/electron/copilot-settings.ts`](../../frontend-copilot/electron/copilot-settings.ts)

## 当前边界与非目标

### 已实现

- ✅ Electron 宿主 + Python runtime 基础架构
- ✅ 单端点聊天 runtime（info、connect、run）
- ✅ 内存 session store（多轮对话）
- ✅ 基于 PydanticAI 的 agent 执行
- ✅ 本地 HTTP 服务（loopback only）
- ✅ 启动健康检查与重试机制
- ✅ 结构化错误处理

### 当前限制

- ⚠️ Session 未持久化（重启丢失）
- ⚠️ 默认单 agent、单 toolset（多 agent 接口已预留）
- ⚠️ Tool registry 主要承载注册/元数据，非完整业务 API
- ⚠️ 无用户认证（本地应用，loopback only）
- ⚠️ 无多用户支持

### 未来扩展方向

- 🔮 Session 持久化（SQLite）
- 🔮 多 agent 支持（不同角色的助手）
- 🔮 Tool calling（调用外部 API、本地工具）
- 🔮 更丰富的 UI 交互（文件上传、图表展示等）

## 主要控制流与边界

### 启动链路

1. **Electron 主进程启动**：
   - 解析 CLI 参数（如 `--host`、`--port`、`--model`）
   - 创建 `PythonRuntimeManager`
   - 调用 `manager.start()`

2. **Python Runtime Manager**：
   - 分配 loopback 端口
   - 解析 Python runtime 启动规格（development 或 bundled 模式）
   - Spawn Python 子进程：`python -m app.desktop_runtime --host 127.0.0.1 --port <port> ...`
   - 轮询 `/ready` 端点，等待就绪

3. **Python Desktop Runtime**：
   - 加载配置（CLI 参数 + 环境变量）
   - 创建 FastAPI app
   - 组装 Copilot Runtime 依赖（session store、agent registry、tool registry）
   - 启动 uvicorn 服务

4. **Renderer 启动**：
   - 通过 IPC 调用 `COPILOT_RUNTIME_LOAD_CHANNEL`
   - 获取 runtime snapshot（包含 `runtimeUrl`、`status`）
   - 如果 status 为 `ready`，注入 CopilotKit Provider
   - 渲染聊天 UI

**代码锚点**：
- [`frontend-copilot/electron/runtime/python-runtime-manager.ts`](../../frontend-copilot/electron/runtime/python-runtime-manager.ts)
- [`backend/app/desktop_runtime/server.py`](../../backend/app/desktop_runtime/server.py) - `create_app()`

### 聊天请求链路

1. **用户输入消息**：
   - Renderer 中用户输入文本
   - CopilotKit 发起 `POST <runtimeUrl>/` 请求
   - Body 包含 `method: "agent/run"`、`threadId`、`runId`、`messages`

2. **Copilot Runtime 处理**：
   - Router 解析 `method` 字段，路由到 `_handle_run_request()`
   - 从 session store 获取或创建 session
   - 调用 `RuntimeBridge.run()`

3. **RuntimeBridge 执行**：
   - 从 agent registry 获取 agent
   - 将 session 历史转换为 PydanticAI 消息格式
   - 调用 `agent.run(user_prompt, message_history=...)`
   - 获取 assistant 回复

4. **返回响应**：
   - 将 assistant 回复追加到 session
   - 构造 SSE 事件流：`RUN_STARTED` → `STATE_SNAPSHOT` → `TEXT_MESSAGE_START` → `TEXT_MESSAGE_CONTENT` → `TEXT_MESSAGE_END` → `RUN_FINISHED`
   - 返回给 Renderer

**代码锚点**：
- [`backend/app/copilot_runtime/router.py`](../../backend/app/copilot_runtime/router.py) - `_handle_run_request()`
- [`backend/app/copilot_runtime/bridge.py`](../../backend/app/copilot_runtime/bridge.py)

### 错误处理边界

Copilot Runtime 提供**显式失败与结构化错误**：

- `agent_not_found` (404)：请求的 agent 不存在
- `model_not_configured` (503)：未配置 LLM model
- `invalid_message_history` (409)：session 历史损坏（如孤立的 assistant 消息）
- `agent_execution_failed` (500)：agent 执行失败

**测试依据**：[`backend/tests/integration/test_copilot_runtime_http.py`](../../backend/tests/integration/test_copilot_runtime_http.py)

## 关键设计决策

### 1. 为什么使用 Electron + Python？

- **Electron**：提供跨平台桌面 UI，成熟的生态
- **Python**：AI/ML 生态丰富，PydanticAI 等框架成熟
- **本地 HTTP**：解耦前后端，Python runtime 可独立测试

### 2. 为什么使用单端点 runtime？

- 简化协议：所有请求发往同一端点，通过 `method` 字段路由
- 便于扩展：新增 method 无需修改路由配置
- 对齐 CopilotKit 协议：CopilotKit 默认使用单端点模式

### 3. 为什么 session 在内存中？

- MVP 阶段优先快速迭代
- 避免引入 SQLite 等持久化依赖
- 未来可平滑迁移到持久化存储

### 4. 为什么 loopback only？

- 安全性：避免暴露到网络
- 简化认证：本地应用无需复杂的用户认证
- 性能：本地通信延迟低

## 相关文档

- [Runtime 生命周期](./runtime-lifecycle.md) - 详细启动链路、两种运行模式
- [聊天 Runtime 契约](./chat-runtime-contract.md) - 单端点协议、请求/响应格式
- [Session 与状态模型](./session-and-state-model.md) - threadId 语义、状态管理
- [后端分册](../backend/README.md) - 后端模块布局、配置、边界
- [前端分册](../frontend/README.md) - 前端 UI 现状、连接契约

## 快速定位代码

### 核心入口

- Electron 主进程：[`frontend-copilot/electron/main.ts`](../../frontend-copilot/electron/main.ts)
- Python runtime 入口：[`backend/app/desktop_runtime/server.py`](../../backend/app/desktop_runtime/server.py)
- Copilot runtime 路由：[`backend/app/copilot_runtime/router.py`](../../backend/app/copilot_runtime/router.py)
- Renderer 根组件：[`frontend-copilot/src/CopilotAppRoot.tsx`](../../frontend-copilot/src/CopilotAppRoot.tsx)

### 关键测试

- Desktop runtime 单元测试：[`backend/tests/unit/desktop_runtime/test_server.py`](../../backend/tests/unit/desktop_runtime/test_server.py)
- Copilot runtime 集成测试：[`backend/tests/integration/test_copilot_runtime_http.py`](../../backend/tests/integration/test_copilot_runtime_http.py)
- Session store 单元测试：[`backend/tests/unit/copilot_runtime/test_session_store.py`](../../backend/tests/unit/copilot_runtime/test_session_store.py)

---

**文档版本**：2026-03-25  
**对应代码版本**：当前 main 分支（commit e3cacfa 之后）

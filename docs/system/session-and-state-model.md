# 会话与状态模型

## 概述

本文档描述当前系统中的会话（session）与状态（state）模型，解释前端工作区如何通过 `threadId` 维持多轮对话上下文，以及 renderer 侧配置状态、运行时状态与后端会话存储之间的协作关系。

**核心问题**：
- 为什么同一个会话可以延续上下文？
- 前端展示的"运行时状态 / 配置状态 / 错误状态"分别来自哪里？
- `threadId` 是如何变成后端 session key 的？
- 哪些状态是宿主 runtime 的，哪些状态是 renderer 侧派生的？

**当前边界**：
- 会话存储为内存态（`InMemorySessionStore`），进程重启后丢失
- 默认单 agent 运行，未实现持久化记忆或复杂状态机
- 前端 `threadId` 直接映射为后端 `thread_id`，一对一关系

## 前端状态层次

### Renderer 侧配置状态

前端通过 [`frontend-copilot/src/features/copilot/config.ts`](../frontend-copilot/src/features/copilot/config.ts:41) 中的 `resolveCopilotConfigState` 函数归并多个来源的状态，生成统一的 `CopilotConfigState`。

**状态来源**：
1. **Settings 状态**：从 Electron 预加载桥接读取的用户配置（`runtimeUrl`、`agentName`）
2. **Hosted Runtime 状态**：宿主后端的运行时快照（`starting` / `ready` / `failed` / `stopped` / `degraded`）
3. **派生决策**：根据上述两者计算出的 `runtimeSource`（`hosted` / `dev-override` / `none`）

**配置状态类型**（[`frontend-copilot/src/features/copilot/types.ts`](../frontend-copilot/src/features/copilot/types.ts:26)）：
- `empty`：缺少 `runtimeUrl` 和 `agentName`
- `incomplete`：部分字段缺失
- `starting`：宿主后端正在启动
- `ready`：可连接，所有必需字段完整
- `failed`：宿主后端启动失败
- `degraded`：宿主后端曾成功但已降级，保留的 URL 仍可用
- `error`：读取配置或运行时失败

**状态归并逻辑**：
```typescript
// frontend-copilot/src/features/copilot/config.ts:41
export function resolveCopilotConfigState(input: {
  settingsResult: CopilotRendererSettingsLoadResult
  runtimeResult: CopilotRendererRuntimeLoadResult
}): CopilotConfigState
```

该函数将 settings 与 hosted runtime 状态合并，决定最终的 `status`、`runtimeUrl`、`runtimeSource` 等字段。例如：
- 当 `runtime.status === 'ready'` 且所有字段完整时，返回 `{ status: 'ready' }`
- 当 `runtime.status === 'failed'` 但配置了 `dev-override` 时，仍可返回 `{ status: 'ready' }`

### Hosted Backend 运行时状态

宿主后端状态由 Electron 主进程管理，存储在 [`frontend-copilot/electron/runtime/runtime-state.ts`](../frontend-copilot/electron/runtime/runtime-state.ts:4) 中的 `HostedBackendState`。

**状态字段**：
- `status`：`starting` / `ready` / `failed` / `stopped` / `degraded`
- `mode`：运行模式（`development` / `production` / `bundled`）
- `baseUrl`：后端运行地址（例如 `http://127.0.0.1:8000`）
- `pid`：进程 ID
- `startedAt` / `readyAt` / `stoppedAt`：时间戳
- `exitCode` / `signal`：进程退出信息
- `lastFailure`：失败摘要（包含 `code`、`phase`、`message`、`retryable` 等）

**状态转换**：
- `stopped` → `starting`：调用 `markHostedBackendStarting`
- `starting` → `ready`：健康检查通过后调用 `markHostedBackendReady`
- `starting` / `ready` → `failed`：启动失败或运行时错误调用 `markHostedBackendFailed`
- `ready` → `degraded`：曾成功但异常退出调用 `markHostedBackendDegraded`

这些状态通过 IPC 传递给 renderer 进程，成为配置状态归并的输入之一。

### UI 展示状态

[`frontend-copilot/src/features/copilot/CopilotChatPanel.tsx`](../frontend-copilot/src/features/copilot/CopilotChatPanel.tsx:29) 根据 `CopilotConfigState` 渲染不同的 UI：

- `loading`：等待根层完成运行态装配
- `error`：读取运行态失败（IPC 链路问题）
- `empty` / `incomplete`：显示缺失字段提示
- `starting`：宿主正在启动本地后端
- `failed`：宿主启动后端失败，显示失败摘要与重试按钮
- `degraded`：运行态已降级，但仍可连接
- `ready`：连接入口已就绪，挂载聊天区域

**诊断信息**（[`frontend-copilot/src/features/copilot/types.ts`](../frontend-copilot/src/features/copilot/types.ts:37)）：
```typescript
export interface CopilotDiagnosticsSummary {
  hostedStatus: CopilotRendererRuntimeSnapshot['status']
  failure: CopilotRendererRuntimeFailureSummary | null
  mode: PythonRuntimeMode
  modeSource: 'resolved' | 'expected'
  runtimeSource: 'hosted' | 'dev-override' | 'none'
}
```

这些诊断信息在 UI 中以详情网格形式展示，帮助用户理解当前状态来源。

## 后端会话存储

### Session Store 设计

后端使用 [`backend/app/copilot_runtime/session_store.py`](../backend/app/copilot_runtime/session_store.py:55) 中的 `InMemorySessionStore` 维护会话记录。

**核心数据结构**：
```python
@dataclass(slots=True)
class RuntimeSessionRecord:
    thread_id: str
    agent_name: str
    metadata: dict[str, Any]
    messages: list[RuntimeTextMessage]
    created_at: datetime
    updated_at: datetime
```

**存储语义**：
- 以 `thread_id` 为 key 存储在内存字典中
- 每个 session 包含完整的消息历史（`messages`）
- 消息为 `RuntimeTextMessage`，包含 `role`（`user` / `assistant`）、`content`、`created_at`

**关键方法**：
- `get_or_create(thread_id, agent_name, metadata)`：获取或创建会话，返回 `(session, newly_created)`
- `append_turn(thread_id, agent_name, user_text, assistant_text, metadata)`：追加一轮对话
- `list_messages(thread_id)`：返回会话的消息历史

**测试依据**（[`backend/tests/unit/copilot_runtime/test_session_store.py`](../backend/tests/unit/copilot_runtime/test_session_store.py:6)）：
- 新 `thread_id` 创建新会话，`created` 为 `True`
- 相同 `thread_id` 复用会话，`created` 为 `False`，metadata 合并
- `append_turn` 自动去除首尾空白，空内容抛出 `ValueError`
- 消息历史按追加顺序保存，`updated_at` 更新为最后一条消息的时间

### threadId 传递链路

**前端侧**：
1. [`frontend-copilot/src/workbench/assistant/AssistantWorkspace.tsx`](../frontend-copilot/src/workbench/assistant/AssistantWorkspace.tsx:133) 将用户选择的会话 ID 作为 `threadId` 传递给 `CopilotChatPanel`
2. [`frontend-copilot/src/features/copilot/CopilotChatPanel.tsx`](../frontend-copilot/src/features/copilot/CopilotChatPanel.tsx:279) 调用 `setCopilotThreadId(threadId)` 设置 CopilotKit 的 `threadId`
3. CopilotKit 在发送请求时将 `threadId` 包含在请求体中

**后端侧**：
1. [`backend/app/copilot_runtime/contracts.py`](../backend/app/copilot_runtime/contracts.py:47) 中的 `RuntimeConnectRequest` 和 `RuntimeRunRequest` 包含 `thread_id` 字段
2. [`backend/app/copilot_runtime/bridge.py`](../backend/app/copilot_runtime/bridge.py:49) 中的 `RuntimeBridge.run` 方法接收 `request.thread_id`
3. Bridge 调用 `session_store.get(request.thread_id)` 获取现有会话
4. 执行成功后调用 `session_store.append_turn(thread_id=request.thread_id, ...)` 持久化

**关键代码**（[`backend/app/copilot_runtime/bridge.py`](../backend/app/copilot_runtime/bridge.py:49)）：
```python
async def run(self, *, request: RuntimeRunRequest) -> RuntimeBridgeResult:
    existing_session = self._session_store.get(request.thread_id)
    history = self._build_message_history(
        existing_session.message_history() if existing_session is not None else ()
    )
    # ... 执行 agent ...
    persisted_session, newly_created = self._session_store.append_turn(
        thread_id=request.thread_id,
        agent_name=request.agent_name,
        user_text=request.user_message_text,
        assistant_text=assistant_text,
        metadata={"last_run_id": request.run_id},
    )
```

### 多轮上下文实现

**历史加载**：
- Bridge 从 session store 读取 `existing_session.message_history()`
- 调用 `_build_message_history` 将 `RuntimeTextMessage` 转换为 PydanticAI 的 `ModelMessage`
- 转换逻辑（[`backend/app/copilot_runtime/bridge.py`](../backend/app/copilot_runtime/bridge.py:88)）：
  - `user` 消息 → `ModelRequest.user_text_prompt(content)`
  - `assistant` 消息 → `ModelResponse(parts=[TextPart(content=content)])`
  - 验证消息角色交替（user → assistant → user → ...）

**历史传递**：
- Agent executor 接收 `message_history: list[ModelMessage]`
- PydanticAI 将历史作为上下文传递给 LLM
- LLM 基于完整历史生成回复

**成功持久化**：
- 仅在 agent 执行成功后调用 `append_turn`
- 失败时不更新 session store，避免污染历史
- 每次追加更新 `session.updated_at` 和 `metadata`

**测试依据**（[`backend/tests/unit/copilot_runtime/test_bridge.py`](../backend/tests/unit/copilot_runtime/test_bridge.py)）：
- Bridge 正确加载现有会话历史
- 历史消息按顺序转换为 model messages
- 执行成功后会话包含新的 user + assistant 消息对
- 相同 `thread_id` 的多次调用累积历史

## 状态更新时机

### 前端状态更新

**初始加载**（[`frontend-copilot/src/CopilotAppRoot.tsx`](../frontend-copilot/src/CopilotAppRoot.tsx:100)）：
- 组件挂载时调用 `loadInitialConfigState()`
- 并行读取 settings 和 runtime 快照
- 结果缓存在 `initialConfigStateCache` 中

**重试更新**：
- 用户点击"重试"按钮触发 `retryCopilotConfigState()`
- 调用 `retryCopilotRuntime()` 重新尝试启动宿主后端
- 重新归并 settings 和 runtime 状态

**被动更新**：
- 当前实现中，runtime 状态不会主动推送更新
- 需要用户手动重试或重新加载应用

### 后端会话更新

**创建时机**：
- 首次使用某个 `thread_id` 发送消息时
- `get_or_create` 返回 `newly_created=True`

**更新时机**：
- 每次成功执行 agent run 后
- `append_turn` 追加 user + assistant 消息对
- 更新 `updated_at` 和 `metadata`（包含 `last_run_id`）

**失败处理**：
- Agent 执行失败时不调用 `append_turn`
- Session store 保持上一次成功状态
- 前端可以在同一 `threadId` 上重试

**测试依据**（[`backend/tests/integration/test_copilot_runtime_http.py`](../backend/tests/integration/test_copilot_runtime_http.py)）：
- 集成测试验证完整的 HTTP → Bridge → Session Store 链路
- 确认相同 `thread_id` 的多次请求共享会话
- 验证 session descriptor 正确返回 `newlyCreated` 标志

## 状态边界与限制

### 内存态存储

**当前实现**：
- `InMemorySessionStore` 将所有会话存储在进程内存中
- 后端进程重启后所有会话丢失
- 无持久化到数据库或文件系统

**影响**：
- 适合开发和原型验证
- 生产环境需要替换为持久化存储（例如 Redis、PostgreSQL）
- 当前架构支持替换存储实现（通过 `session_store` 参数注入）

### 单 Agent 默认

**当前实现**：
- 每个会话绑定一个 `agent_name`
- `get_or_create` 会更新 `agent_name`，允许同一 `thread_id` 切换 agent
- 但前端当前未实现 agent 切换 UI

**限制**：
- 未实现多 agent 协作或路由
- 未实现 agent 切换时的上下文迁移策略

### 无持久化记忆

**当前实现**：
- 会话历史仅包含文本消息（`role` + `content`）
- 无结构化记忆、知识图谱或长期记忆系统
- 无消息摘要或历史压缩机制

**限制**：
- 长会话可能超出 LLM 上下文窗口
- 无法跨会话共享知识
- 无法实现"记住用户偏好"等高级功能

### 前端状态同步

**当前实现**：
- 前端状态为快照式读取，无实时推送
- 宿主后端状态变化不会主动通知 renderer
- 需要用户手动重试或重新加载

**限制**：
- 后端启动完成后前端可能仍显示 `starting`
- 后端异常退出后前端可能仍显示 `ready`
- 未来可通过 IPC 事件或轮询改进

## 相关文档

- [架构概览](./architecture-overview.md)：系统整体架构与模块划分
- [运行时生命周期](./runtime-lifecycle.md)：宿主后端启动、健康检查与停止流程
- [聊天运行时契约](./chat-runtime-contract.md)：HTTP 端点、请求/响应格式与事件流

## 代码锚点

**前端配置与状态**：
- [`frontend-copilot/src/features/copilot/types.ts`](../frontend-copilot/src/features/copilot/types.ts)：状态类型定义
- [`frontend-copilot/src/features/copilot/config.ts`](../frontend-copilot/src/features/copilot/config.ts)：配置状态归并逻辑
- [`frontend-copilot/src/CopilotAppRoot.tsx`](../frontend-copilot/src/CopilotAppRoot.tsx)：根层状态装配
- [`frontend-copilot/electron/runtime/runtime-state.ts`](../frontend-copilot/electron/runtime/runtime-state.ts)：宿主后端状态管理

**前端 UI 与 threadId 传递**：
- [`frontend-copilot/src/workbench/assistant/AssistantWorkspace.tsx`](../frontend-copilot/src/workbench/assistant/AssistantWorkspace.tsx)：会话选择与 threadId 传递
- [`frontend-copilot/src/features/copilot/CopilotChatPanel.tsx`](../frontend-copilot/src/features/copilot/CopilotChatPanel.tsx)：聊天面板与状态展示

**后端会话与 Bridge**：
- [`backend/app/copilot_runtime/session_store.py`](../backend/app/copilot_runtime/session_store.py)：会话存储实现
- [`backend/app/copilot_runtime/bridge.py`](../backend/app/copilot_runtime/bridge.py)：Bridge 层协调逻辑
- [`backend/app/copilot_runtime/contracts.py`](../backend/app/copilot_runtime/contracts.py)：请求/响应契约

**测试依据**：
- [`backend/tests/unit/copilot_runtime/test_session_store.py`](../backend/tests/unit/copilot_runtime/test_session_store.py)：会话存储单元测试
- [`backend/tests/unit/copilot_runtime/test_bridge.py`](../backend/tests/unit/copilot_runtime/test_bridge.py)：Bridge 层单元测试
- [`backend/tests/integration/test_copilot_runtime_http.py`](../backend/tests/integration/test_copilot_runtime_http.py)：HTTP 集成测试
- [`frontend-copilot/src/features/copilot/config.test.ts`](../frontend-copilot/src/features/copilot/config.test.ts)：配置状态归并测试
- [`frontend-copilot/src/features/copilot/CopilotChatPanel.test.tsx`](../frontend-copilot/src/features/copilot/CopilotChatPanel.test.tsx)：聊天面板测试
- [`frontend-copilot/src/workbench/assistant/AssistantWorkspace.test.tsx`](../frontend-copilot/src/workbench/assistant/AssistantWorkspace.test.tsx)：工作区测试

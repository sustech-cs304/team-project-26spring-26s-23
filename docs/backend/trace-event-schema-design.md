# Trace Event Schema & Human-in-the-Loop 设计草案 (Task 13)

定义 Agent 执行轨迹（Trace）以及人在回路（Human-in-the-Loop）确认机制在前后端之间的事件契约（Event Schema）。

## 1. 核心目标
1. 统一 Agent 在"思考"、"工具调用"、"执行成功"、"执行失败"等阶段的状态流转。
2. 引入"等待用户确认"（`waiting_approval`）及对应回调（`approved` / `rejected`）机制，以支持高危操作拦截。

## 2. 事件流总体变更说明

系统采用 Agentic Loop 架构，通过 Server-Sent Events (SSE) 向前端推送执行事件。已有的 `tool_event` 包含 `started`, `completed`, `failed`。

为支持 Human-in-the-Loop，需对 `tool_event` 的阶段（phase）进行扩展，增加挂起与审批相关的状态，并提供明确的危险等级分置。

---

## 3. Tool Event (工具调用事件) Schema 设计

工具生命周期通过 `tool_event` 中的 `phase` 字段表达。

### 3.1 Schema 定义（TypeScript 视角）

```ts
// 扩展现有的 RuntimeToolEventPhase
export type RuntimeToolEventPhase = 
  | 'started'               // 工具开始准备执行
  | 'waiting_approval'      // 【新增】工具被拦截，挂起并等待用户授权
  | 'completed'             // 工具执行成功完成
  | 'failed'                // 工具执行失败或被用户拒绝
  | 'cancelled';            // 【可选】工具执行由于所属 Run 取消而取消

export interface RuntimeToolEventPayload {
  toolCallId: string;       // 同一次工具调用的唯一稳定标识
  toolId: string;           // 调用的工具 ID
  phase: RuntimeToolEventPhase; // 生命周期阶段
  
  title: string;            // 面向用户的步骤标题
  summary: string;          // 面向用户的简要说明
  
  // 数据摘要载荷
  inputSummary?: string;    // 工具输入的参数摘要组合 (JSON 字符串或纯文本)
  resultSummary?: string;   // 工具执行成功后的结果展示
  errorSummary?: string;    // 执行失败或被用户拒绝时的错误信息/拒绝原因
  
  // 【新增】权限安全管控字段 (建议在 waiting_approval 时提供)
  security?: {
    riskLevel: 'safe' | 'moderate' | 'high'; // 危险等级
    approvalMethod?: 'accept_reject' | 'password'; // 需要的验证方式
  };
}
```

### 3.2 对应的后端数据类（Python 视角）

在实现中，`ToolLifecyclePhase` 定义在 `backend/app/copilot_runtime/agent_tool_lifecycle.py`，`RuntimeToolLifecycleEvent` 定义在 `backend/app/copilot_runtime/agent.py`，示意 `phase` 枚举：

```python
class RuntimeToolLifecycleEvent:
    tool_call_id: str
    tool_id: str
    phase: ToolLifecyclePhase # 包括 "started", "waiting_approval", "completed", "failed", "cancelled"
    title: str
    summary: str
    input_summary: str | None = None
    # ... 其他可选字段
```

### 3.3 工具流转逻辑

1. **普通工具（Safe / 无需确认）**
   `started` -> `completed` (或 `failed`)

2. **高危工具（拦截场景）**
   `started` -> `waiting_approval`（触发前端弹窗） -> 
     *(用户点击确认)* -> 发送 API 恢复 -> 继续执行 -> `completed` (或 `failed`)
     *(用户点击拒绝)* -> 发送 API 拒绝 -> `failed` (携带用户拒绝的原因)

---

## 4. 回调交互：用户决定的回传

后端发射 `phase: 'waiting_approval'` 的 `tool_event` 时，工具执行会通过 PydanticAI 的机制挂起（或暂停）。前端展示确认 UI 后，将用户决定回传给后端。

实现使用 RPC 方法 `tool-approval/resolve`，通过统一的 `POST /` 聊天根端点分发：

### `tool-approval/resolve`

**请求体结构：**
```json
{
  "method": "tool-approval/resolve",
  "body": {
    "runId": "...",
    "toolCallId": "...",
    "decision": "approved",
    "userFeedback": "不需要添加这个日程"
  }
}
```

**后端动作**：
- 接收到 `approved` 时，放行对应的执行闸门（Gate），继续工具的真实执行。
- 接收到 `rejected` 时，向执行期注入或抛出异常（例如 `UserRejectedToolCallError`），工具执行中止，下发 `failed` 的 `tool_event`。

---

## 5. 实现状态跟踪 (Task 13)

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| 后端 `waiting_approval` 阶段定义 | ✅ 已完成 | `ToolLifecyclePhase` 定义在 `agent_tool_lifecycle.py` |
| 后端 `tool-approval/resolve` 方法 | ✅ 已完成 | HTTP handler 在 `transport/http_handlers.py`，协调器在 `tool_approval_coordinator.py` |
| 后端 `security` 字段 | ⬜ 待补充 | schema 层已预留，但运行时尚未完整实施 |
| 前端 `RuntimeToolEventPhase` 扩展 | ⬜ 待确认 | 需检查 `thread-run-contract.ts` 中的类型定义 |
| 测试断言覆盖 | ⬜ 待补充 | 需补充 `waiting_approval` 相关测试 |

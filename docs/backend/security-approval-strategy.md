# 危险分级操作与确认策略设计 (Dangerous Operation Classification & Approval Strategy)

## 1. 背景 (Background)
随着 Copilot Agent 接入越来越多的系统工具（Tools），它具备了直接修改、删除或影响系统资源的能力。为了确保系统安全与用户数据的完整性，并满足 Human-in-the-Loop (HITL) 的要求，我们必须对 Agent 的操作权限进行严格管控。
本文档（关联 Issue #16）在此前扩展的 `waiting_approval` 与 `cancelled` 运行时状态之上，进一步从业务维度定义“危险分级”以及“确认与放行策略”，明确哪些动作可以直接执行，哪些动作必须跨过用户的明确批准。

## 2. 操作危险等级划分 (Risk Level Classification)

操作风险依据其“破坏性”、“数据隐私影响”和“资源消耗”分为三个等级（映射到前端已有的 `riskLevel` 属性）：

### 2.1 Low (低危操作 - 白名单)
- **定义**：对系统无任何破坏性、无明显副作用的“只读 (Read-Only)”操作，或纯粹的本地/内存计算。
- **确认策略**：**自动放行 (Auto-Approve)**。无需用户干预。
- **操作举例**：
  - 搜索维基百科 / 搜索引擎 (`search_web`)
  - 读取当前天气 / 日历 (`get_weather`)
  - 查询数据库只读数据 (`fetch_user_list`)
  - 本地数学计算 (`calculate_math`)

### 2.2 Medium (中危操作 - 需要知情)
- **定义**：会产生副作用，写入或更改了部分系统状态，但影响范围可控或易于撤销/恢复。
- **确认策略**：**UI 明确授权 (Requires Human Confirmation)**。Agent 必须暂停，并向前端下发 `waiting_approval`，用户在 UI 点击“允许”后才可继续。
- **操作举例**：
  - 发送单封非机密邮件 (`send_email`)
  - 新建或修改非敏感文件/配置 (`write_local_file`)
  - 提交 Git Commit 或创建分支 (`git_commit_push`)
  - 创建提醒事项或日历日程 (`create_calendar_event`)

### 2.3 High (高危操作 - 严格拦截)
- **定义**：涉及核心数据销毁、大规模副作用、涉及金钱交易或敏感权限变更的危险动作，且不可逆。
- **确认策略**：**强授权 (Requires Human Confirmation with Warning)**。除 UI 明确授权外，前端应标红高亮警告（在 `payload.security` 中透传相关信息），未来可拓展为需输入密码或 MFA 校验。
- **操作举例**：
  - 删除服务器资源、Drop 表 (`delete_database_table`)
  - 触发生产环境部署 (`deploy_to_production`)
  - 批量发送邮件或执行汇款 (`transfer_funds`)
  - 赋予或修改系统管理员权限 (`grant_admin_access`)

## 3. 后端 Tool 注册与标记方案 (Tool Schema Extension)

为了实现上述机制，我们在后端的 Tool 注册层（例如 PydanticAI 的 `@tool` 装饰器或自定义 Registry）引入安全声明 (Security Context)。

**设计变更草案：**
在注册工具时，需强制或可选地显式声明 `risk_level`（默认可以是低级或最高级，建议如果未声明，保守默认为 `high` 级别）。
```python
from enum import Enum
from pydantic import BaseModel

class RiskLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"

class ToolSecurityConfig(BaseModel):
    risk_level: RiskLevel
    # approval_method 预期为前端 UI 下发的批准形式
    approval_method: str = "button_click"

# 伪代码：在注册工具时的声明方法
@tool(security=ToolSecurityConfig(risk_level=RiskLevel.HIGH))
def delete_database_table(table_name: str):
    ...
```

## 4. 执行控制流 (Execution Flow)

1. **意图生成阶段**：LLM 决定调用 `delete_database_table(table_name="users")`。
2. **拦截判定阶段 (Interceptor)**：
   - 运行时 (Runtime/Agent Executor) 捕获到目标函数。
   - 检查该工具的 `@tool` 元数据，获取其 `risk_level`。
3. **状态分发阶段**：
   - `if risk_level == LOW`：拦截器放行，工具立刻执行，并将状态推送 `completed`。
   - `if risk_level in [MEDIUM, HIGH]`：拦截器挂起当前执行线程（或采用回调机制），通过 Event Manager 向前端发送 SSE 事件 `phase="waiting_approval"` 和 `payload.security = { riskLevel: "high", approvalMethod: "button_click" }`。
4. **决策反馈阶段**：
   - 用户在前端审核通过 -> 客户端通过 HTTP Post/WebSocket 给服务端回抛 Approve 信号。
   - 后端恢复工具线程，继续执行，完成后推送 `completed`。
   - 客户端回抛 Reject 信号 -> 后端抛出 Cancellation 异常，推送 `cancelled`。

## 5. 后续代码修改边界 (Action Plan)
在下一阶段的代码实现中，我们需要：
1. **修改后端 Tool Registry/Model**: 增加用于承载危险等级的数据结构和装饰器支持。
2. **修改 Runtime Agent Executor**: 在执行 Python 函数真正的 invoke 前增加鉴权和阻塞轮询的设计（或异步挂起逻辑）。
3. **模拟/重构两个真实的 Tool 进行测试**: 例如新建一个 `tool_get_time` (Low) 和一个 `tool_delete_file` (High) 来验证我们的鉴权流。

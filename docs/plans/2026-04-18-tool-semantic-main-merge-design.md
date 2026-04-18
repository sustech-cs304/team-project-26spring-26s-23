# 2026-04-18 Tool Semantic Main Merge Design

## 背景

当前分支已经形成一套稳定的工具语义，包括工具权限策略、人工与延迟审批、文件工具族、`switch_root` 与 workspace root / default root 语义，以及 capability bridge 的接入方式。`main` 分支则新增了 diagnostics、debug-log 与 config 相关能力。此次设计文档的目标，是把已经获批的合并方案固化下来，作为后续审慎合并时的唯一设计依据。

本设计以当前分支的工具外部行为为主语义，要求在吸收 `main` 的新增能力时，只增强可观测性与配置完整性，不改写工具执行、审批与目录暴露语义。合并后的系统只保留一套正式语义，不引入平行协议、双状态机或临时 fallback。

## 设计目标

### 主目标

- 合并后的系统以当前分支的工具外部行为为准语义。
- 系统吸收 `main` 的 diagnostics、debug-log 与 config 能力，但这些能力只能增强可观测性与配置完整性。
- 合并后的运行时只保留一套正式语义，不引入平行协议、双状态机或临时 fallback。

### 保留范围

- 保留工具权限策略。
- 保留人工审批与延迟审批语义。
- 保留文件工具族的现有对外行为。
- 保留 `switch_root`、workspace root 与 default root 的现有语义。
- 保留 capability bridge 的现有接入方式。

### 吸收范围

- 吸收 `main` 新增的 diagnostics 能力。
- 吸收 `main` 新增的 debug-log 能力。
- 吸收 `main` 新增的 config 能力。

## 范围与非目标

### 本文档覆盖范围

- 本文档定义装配层、bridge 层、agent 层、transport 层、desktop config 层与前端消费层的合并语义。
- 本文档定义显式冲突处理顺序、风险控制要求与验收策略。
- 本文档只固化已经批准的设计决策，不展开实现计划。

### 明确不做的事

- 不新增第二套审批状态机。
- 不在 transport 层复制工具权限判断。
- 不用临时 fallback 掩盖 capability bridge 或 policy 接线问题。
- 不为了吸收 `main` 的日志与配置能力而回退当前分支工具外部行为。

## 顶层不变量

### 共享审批状态不变量

共享审批状态必须继续由同一装配链创建并贯穿执行与 resolve。以 [`build_default_runtime_dependencies()`](backend/app/copilot_runtime/composition.py:51) 为总装配锚点，由它把同一个 coordinator 同时注入 [`_PydanticAIAgentRunDeps`](backend/app/copilot_runtime/agent.py:237) 所在执行链和 [`RuntimeBridge.resolve_tool_approval()`](backend/app/copilot_runtime/bridge.py:210) 所在 resolve 链。

这条不变量保证审批请求、等待审批、审批决议与后续工具恢复执行共享同一状态来源，避免执行链和 resolve 链各自持有一份状态。

### 工具目录真相不变量

工具目录真相只能来自 [`RuntimeBridge.get_capabilities()`](backend/app/copilot_runtime/bridge.py:154)。transport 必须把权限策略显式传入，避免“目录可见性”和“实际可执行性”形成双轨。

这条不变量要求 capability catalog 与真实执行集合保持一致。只要目录暴露与权限策略脱节，就应视为设计错误，而不是可接受的运行时偏差。

### 审批状态机真相不变量

审批状态机真相只能来自 [`_await_tool_approval_if_needed()`](backend/app/copilot_runtime/agent.py:1069) 与 coordinator，不允许在 transport 或前端复制一套业务判断。

这条不变量的目的，是把等待审批、超时、拒绝、重复决议与状态冲突统一收敛到同一业务链路中，确保错误模型稳定，事件含义一致。

### Capability Bridge Bootstrap 不变量

capability bridge bootstrap 继续是独立启动语义，不能被 `main` 的 debug/config 体系吞并。相关语义以 [`backend/app/desktop_runtime/config.py`](backend/app/desktop_runtime/config.py) 和 [`frontend-copilot/electron/main.ts`](frontend-copilot/electron/main.ts) 为准。

这条不变量要求 capability bridge 的 URL、token 与启动失败语义继续作为独立系统边界存在。新增的 debug 与 config 字段可以并联扩展，但不能改变 bootstrap 的成立条件与故障暴露方式。

## 模块责任与合并策略

### 装配层

装配层以 [`backend/app/copilot_runtime/composition.py`](backend/app/copilot_runtime/composition.py) 为中心，先锁住共享 coordinator、bridge 注入与 runtime dependencies 的关系。`main` 引入的横切依赖只允许并联注入，不能替换或拆散现有装配链。

装配层负责保证执行链与 resolve 链看到的是同一审批协调器、同一 bridge 语义边界，以及一致的 runtime dependency 图。任何新增 diagnostics、logging 或 config 依赖，都只能作为旁路增强能力接入。

### Bridge 层

bridge 层以 [`backend/app/copilot_runtime/bridge.py`](backend/app/copilot_runtime/bridge.py) 为统一入口，负责 capability 过滤、approval resolve 与 run metadata priming。这里需要先统一 capability 过滤、approval resolve 与 metadata priming 语义，再处理其他冲突。

其中 [`prime_run_metadata()`](backend/app/copilot_runtime/bridge.py:226) 的时序保持现有分支语义，不因 `main` 新增的 debug 或 diagnostics 接线而改变。bridge 层是目录真相、审批 resolve 与运行元数据预热的收束点，因此不允许出现多个来源竞争解释同一运行态。

### Agent 层

agent 层以 [`backend/app/copilot_runtime/agent.py`](backend/app/copilot_runtime/agent.py) 为中心，保留 waiting approval、timeout/reject、tool event、enabled tools、file tools、root 切换与 capability-backed tool 的现有行为。`main` 的 debug/log hook 只能作为观察点嵌入，不能改写现有工具状态机。

agent 层负责把业务语义体现在真实运行流程中，因此新增日志或调试信息只能旁路观察工具准备、审批等待、执行开始、执行结束与失败分支，不能影响这些分支的控制流和结果映射。

### Transport 层

transport 层以 [`backend/app/copilot_runtime/transport/http_handlers.py`](backend/app/copilot_runtime/transport/http_handlers.py) 为主，吸收 `main` 的 request context、error normalization、debug-log 与 diagnostics，但不得重定义审批与权限逻辑。[`_handle_tool_approval_resolve_request()`](backend/app/copilot_runtime/transport/http_handlers.py:321) 与 [`TOOL_APPROVAL_RESOLVE_METHOD`](backend/app/copilot_runtime/contracts.py:24) 必须保持一一对应。

transport 层的职责是转发请求、归一化错误和提供观测信息，不是解释工具目录真相或审批状态机。审批与权限判断若在此重复实现，会直接破坏顶层不变量。

### Desktop Config 层

desktop config 层完整吸收 `main` 新增的 debug、log 与 config 字段，但只做扩字段，不换语义。capability bridge URL 与 token 的启动语义继续独立成立。

这一层负责把桌面端配置表达完整、可验证、可透传，但不能因配置模型扩展而改造 capability bridge 的既有启动契约，更不能把 bridge 异常折叠为模糊的部分可用状态。

### 前端消费层

前端消费层继续围绕 live approval 建模，相关基线分别位于 [`resolveRuntimeToolApproval()`](frontend-copilot/src/features/copilot/tool-approval.ts:33)、[`run-segment-reducer.ts`](frontend-copilot/src/features/copilot/run-segment-reducer.ts:656) 和 [`CopilotMessagesShell.tsx`](frontend-copilot/src/features/copilot/messages/CopilotMessagesShell.tsx:553)。历史回放可以展示 waiting approval，但不得误暴露可操作审批按钮。

前端层的责任是准确消费后端审批与工具状态，而不是推导一套新的业务真相。live run 与历史回放的交互边界需要继续清晰分开，避免用户在只读历史上看到仍可提交审批操作的错误暗示。

## 显式冲突处理顺序

### 第 1 步：校准总不变量

先校准装配与 bridge 的总体不变量，再进入具体冲突块。只有先确认共享 coordinator、bridge 注入、目录真相与审批状态机真相的边界，后续各层冲突处理才不会偏离设计目标。

### 第 2 步：处理 Bridge 层显式冲突

随后处理 [`backend/app/copilot_runtime/bridge.py`](backend/app/copilot_runtime/bridge.py) 的显式冲突，先统一 capability 过滤、approval resolve 与 metadata priming 语义。

### 第 3 步：处理 Agent 层显式冲突

再处理 [`backend/app/copilot_runtime/agent.py`](backend/app/copilot_runtime/agent.py) 的显式冲突，保留当前分支工具状态机，并把 `main` 的 debug/log 观察点嵌回去。

### 第 4 步：处理 Composition 测试显式冲突

之后处理 [`backend/tests/unit/copilot_runtime/test_composition.py`](backend/tests/unit/copilot_runtime/test_composition.py) 的显式冲突，使测试同时表达工具语义不变量与 `main` 的 config/debug 字段存在性。

### 第 5 步：回查隐式冲突

最后回查 [`backend/app/copilot_runtime/transport/http_handlers.py`](backend/app/copilot_runtime/transport/http_handlers.py)、[`backend/app/desktop_runtime/config.py`](backend/app/desktop_runtime/config.py) 以及前端审批消费层，消化已识别的隐式冲突。

## 风险控制与错误处理

### 业务错误稳定性

缺失审批请求、重复决议与状态冲突必须继续映射为稳定业务错误，不能被 logging 或 diagnostics 包装成 500。新增可观测性能力必须服从已有错误模型，而不是替换它。

### Capability 目录一致性

capability 目录与真实执行集合不一致时，应视为设计错误。因此 transport 将策略传入 [`RuntimeBridge.get_capabilities()`](backend/app/copilot_runtime/bridge.py:154) 是硬性要求，不能退化成可选优化。

### Capability Bridge 启动异常可见性

capability bridge 启动异常不能静默降级成“部分工具偶尔不可用”，必须明确暴露 unavailable 或 failure。只有这样，调用方和测试才能看到真实系统状态。

### 观测链路的边界

debug、log 与 diagnostics 可以失败，但不能篡改原始工具执行、审批结果或 run 终态。观测能力与业务能力必须维持单向依附关系，前者记录后者，前者不能接管后者。

## 验收策略

### 单元护栏

单元护栏优先关注 [`backend/tests/unit/copilot_runtime/test_composition.py`](backend/tests/unit/copilot_runtime/test_composition.py:247)、[`backend/tests/unit/copilot_runtime/test_tool_approval_coordinator.py`](backend/tests/unit/copilot_runtime/test_tool_approval_coordinator.py) 与 [`backend/tests/unit/copilot_runtime/test_agent.py`](backend/tests/unit/copilot_runtime/test_agent.py:695)。这些测试需要共同证明共享装配关系、审批协调器语义与 agent 层工具状态机没有退化。

### 路由与消息流护栏

路由与消息流护栏重点关注 [`backend/tests/unit/copilot_runtime/test_message_runs.py`](backend/tests/unit/copilot_runtime/test_message_runs.py:413) 与 [`backend/tests/unit/copilot_runtime/test_router.py`](backend/tests/unit/copilot_runtime/test_router.py:1501)。这些测试需要覆盖审批消息流、错误归一化和路由层契约是否仍与后端真实语义一致。

### Desktop 与 Runtime 贯通护栏

desktop/runtime 贯通护栏重点关注 [`backend/tests/unit/desktop_runtime/test_server.py`](backend/tests/unit/desktop_runtime/test_server.py:414) 与 [`backend/tests/integration/test_copilot_runtime_http.py`](backend/tests/integration/test_copilot_runtime_http.py:1560)。这些测试需要证明 desktop config 扩展、capability bridge 启动语义与运行时 HTTP 链路仍然保持一致。

### 前端护栏

前端护栏要求审批按钮只对 live run 可操作，历史回放保持只读，tool picker 与 capability 刷新遵守权限策略，等待审批段在 reducer 与 UI 中维持当前分支语义。前端层的验收重点不在于视觉变化，而在于状态消费和交互边界没有偏离批准设计。

### 完成定义

完成定义不是“能编译”，而是“当前分支工具外部行为不退化，且 `main` 的 diagnostics、debug-log 与 config 已接入真实链路并受测试保护”。只有同时满足这两部分条件，合并才算达成设计目标。

## 决策摘要

- 当前分支工具外部行为是合并后的主语义来源。
- `main` 的 diagnostics、debug-log 与 config 能力只能作为增强项接入。
- 共享审批状态、工具目录真相、审批状态机真相与 capability bridge bootstrap 必须继续保持单一来源。
- 合并过程中所有模块都要围绕“增强可观测性而不改写工具语义”这一原则执行。
- 验收标准以行为不退化和真实链路受测为准，不以表面接线完成为准。

---
title: Thinking Selection Round-Trip Recovery 设计
description: 在 bridge 层修复 thinkingSelection 的有损 round-trip，并复用既有 stdout/stderr 落盘链，避免 run/start 因回填失败打成 500。
---

# 2026-04-08 Thinking Selection Round-Trip Recovery 设计

> 本文档仅描述已批准的第三轮补充设计，用于支撑后续实现，不包含代码实现。

## 背景与问题

第一轮设计已将首修边界收敛到 [`_handle_run_start_request()`](../../backend/app/copilot_runtime/router.py:218) 附近，参考 [`2026-04-08-run-start-500-recovery-design.md`](./2026-04-08-run-start-500-recovery-design.md)。第二轮设计又把怀疑点前移到最终响应出口 [`JSONResponse()`](../../backend/app/copilot_runtime/router.py:285) / [`RuntimeContract.to_dict()`](../../backend/app/copilot_runtime/contracts.py:40) / [`_jsonable()`](../../backend/app/copilot_runtime/contracts.py:937)，参考 [`2026-04-08-run-start-serialization-recovery-design.md`](./2026-04-08-run-start-serialization-recovery-design.md)。

最新诊断进一步收敛后，当前真实问题更可能不在最终 JSON 渲染，而在 bridge 层的 thinkingSelection round-trip：

- 响应体中的 error.stage 字段值 phase3-run-bridge 只是 scaffold 里的静态 stage，不代表实时失败 phase；
- 新版 provider-specific thinkingSelection 形态已经不再只依赖 legacy 的 mode / level / budgetTokens；
- 现有 [`_to_stored_thinking_selection()`](../../backend/app/copilot_runtime/bridge.py:658) 与 [`_to_runtime_thinking_selection()`](../../backend/app/copilot_runtime/bridge.py:672) 只保留 legacy 语义，无法无损往返新版 provider-specific value；
- 当 [`_to_message_send_request()`](../../backend/app/copilot_runtime/bridge.py:459) 回填 [`RuntimeThinkingSelection`](../../backend/app/copilot_runtime/contracts.py:69) 时，旧式回建结果可能触发 [`RuntimeThinkingSelection.__init__()`](../../backend/app/copilot_runtime/contracts.py:73) 校验异常，最终把 [`run/start`](../../backend/app/copilot_runtime/router.py:218) 打成真实 500。

典型症状是：像 valueType / code / labelZh 这一类 provider-specific 字段，在存储往返后被截断成 legacy 形态，导致运行时回建出来的选择对象不再满足当前校验要求。

```mermaid
flowchart LR
A[run start request] --> B[_to_stored_thinking_selection]
B --> C[stored thinkingSelection]
C --> D[_to_runtime_thinking_selection]
D --> E[_to_message_send_request]
E --> F[RuntimeThinkingSelection validation]
F --> G[run start 500]
```

## 目标与非目标

### 目标

- 修复 bridge 层 thinkingSelection 的有损 round-trip，使新版 provider-specific 值不再把 [`run/start`](../../backend/app/copilot_runtime/router.py:218) 打成 500；
- 保持修复边界最小，只收敛在 [`_to_stored_thinking_selection()`](../../backend/app/copilot_runtime/bridge.py:658)、[`_to_runtime_thinking_selection()`](../../backend/app/copilot_runtime/bridge.py:672)、[`_to_message_send_request()`](../../backend/app/copilot_runtime/bridge.py:459) 与 [`_resolve_initial_run_metadata()`](../../backend/app/copilot_runtime/bridge.py:491) 所覆盖的数据流边界；
- 复用现有 Python runtime stdout / stderr 输出链，让后端 requestId / phase / exception 能继续落到 [`BACKEND_STDOUT_LOG_FILE_NAME`](../../frontend-copilot/electron/runtime/runtime-paths.ts:12) 与 [`BACKEND_STDERR_LOG_FILE_NAME`](../../frontend-copilot/electron/runtime/runtime-paths.ts:13)；
- 对旧数据和异常输入保持 fail-soft：即便个别历史记录无法完全回建，也不再把 [`run/start`](../../backend/app/copilot_runtime/router.py:218) 打成 500。

### 非目标

- 不改前端错误文案；
- 不改 compat 的 message/send 路径；
- 不扩大到 provider route resolver；
- 不扩大到 settings schema；
- 不把通用序列化层 [`RuntimeContract.to_dict()`](../../backend/app/copilot_runtime/contracts.py:40) / [`_jsonable()`](../../backend/app/copilot_runtime/contracts.py:937) 作为本轮主修复点；
- 不新增新的前端日志查看器，也不新增额外日志路径协议。

## 最新根因分析

### 现状断裂点

当前 bridge 层的 thinkingSelection 数据流可以概括为：

1. [`_to_stored_thinking_selection()`](../../backend/app/copilot_runtime/bridge.py:658) 在建单时把运行时选择对象压平为存储结构；
2. 存储结构当前只保留 series / mode / level / budget_tokens 这组 legacy 字段；
3. [`_to_runtime_thinking_selection()`](../../backend/app/copilot_runtime/bridge.py:672) 读取存储值时，只能按 legacy 语义重新构造；
4. [`_to_message_send_request()`](../../backend/app/copilot_runtime/bridge.py:459) 将该回建结果重新塞回执行请求；
5. 一旦回建结果与当前 [`RuntimeThinkingSelection`](../../backend/app/copilot_runtime/contracts.py:69) 的校验约束不匹配，就会在 [`RuntimeThinkingSelection.__init__()`](../../backend/app/copilot_runtime/contracts.py:73) 处抛异常。

### 为何第二轮怀疑没有完全命中根因

第二轮把怀疑点前移到 [`JSONResponse()`](../../backend/app/copilot_runtime/router.py:285) 侧是合理收敛，但那更像是症状层而不是源头层：

- 如果 bridge 层已经把 thinkingSelection 还原成不合法对象，那么后续任意依赖该对象的路径都可能暴露异常；
- 即使最终表现为 [`run/start`](../../backend/app/copilot_runtime/router.py:218) 返回 500，真正造成断裂的仍是 bridge 内部的有损 round-trip；
- 因此本轮不继续追着 [`JSONResponse()`](../../backend/app/copilot_runtime/router.py:285) 做外层兜底，而是把首刀收敛在 bridge 的 round-trip 边界。

### 本轮设计结论

本轮把真实根因定义为：bridge 层对新版 provider-specific thinkingSelection.value 做了有损 round-trip，导致回填后的选择对象不再满足运行时校验要求。对应修复也应优先落在 round-trip 源头，而不是继续扩大到与根因距离更远的外层响应出口。

## 修复边界

### 首修边界

本轮只修改以下边界：

- [`_to_stored_thinking_selection()`](../../backend/app/copilot_runtime/bridge.py:658)
- [`_to_runtime_thinking_selection()`](../../backend/app/copilot_runtime/bridge.py:672)
- [`_to_message_send_request()`](../../backend/app/copilot_runtime/bridge.py:459)
- [`_resolve_initial_run_metadata()`](../../backend/app/copilot_runtime/bridge.py:491)

不改 compat 路径，不扩大到 [`RuntimeContract.to_dict()`](../../backend/app/copilot_runtime/contracts.py:40) 或 [`_jsonable()`](../../backend/app/copilot_runtime/contracts.py:937) 的通用语义。

### 存储侧策略

[`_to_stored_thinking_selection()`](../../backend/app/copilot_runtime/bridge.py:658) 的职责从只保留 legacy 字段，调整为双轨保留：

1. 继续保留现有 mode / level / budgetTokens 语义，用作旧数据兼容回退；
2. 额外保留一份完整、JSON-safe 的原始 thinkingSelection.value 表示，用作新版 provider-specific 值的无损恢复来源。

这里的关键点不是重定义前端协议，而是在 bridge 存储层补上一份最小但完整的 provider-specific 原值镜像。该镜像必须满足：

- 可被稳定 JSON 序列化；
- 不依赖运行时对象实例；
- 能覆盖 valueType / code / labelZh 这类新版 provider-specific 字段；
- 对旧记录保持可选，不要求历史数据回填迁移。

### 回建侧策略

[`_to_runtime_thinking_selection()`](../../backend/app/copilot_runtime/bridge.py:672) 的恢复优先级调整为：

1. 优先根据存储中的完整 JSON-safe 原值无损回建；
2. 若完整原值不存在，再回退到 legacy 的 mode / level / budgetTokens；
3. 若两条路径都无法得到合法结果，则返回空结果而不是制造新的非法对象。

这意味着 bridge 的恢复逻辑需要从总是构造对象，改为优先保证正确恢复，其次保证安全降级。

### 请求回填边界

[`_to_message_send_request()`](../../backend/app/copilot_runtime/bridge.py:459) 需要把 thinkingSelection 回填从无条件构造改为受控回填：

- 对可无损恢复的数据，继续按现有请求对象返回；
- 对只能走 legacy 回退且仍合法的数据，继续保持兼容；
- 对旧数据或异常输入导致的不可恢复场景，不再把异常直接升级成 [`run/start`](../../backend/app/copilot_runtime/router.py:218) 的 500，而是把失败留给上层 fail-soft 边界处理。

这里的设计重点不是新增一个更大的错误模型，而是避免 bridge 在 metadata 预热前就因为 thinkingSelection 回填失败而整体中断。

### fail-soft 边界

[`_resolve_initial_run_metadata()`](../../backend/app/copilot_runtime/bridge.py:491) 保留并强化 fail-soft：

- 如果旧数据或异常输入仍无法回建 thinkingSelection，就记录局部日志；
- 该局部日志至少带 requestId、phase、runId、threadId 与 exception 摘要；
- 然后跳过本次 thinking selection rehydrate，继续返回可用的 metadata 子集；
- 不再因为 metadata 预热期间的 thinkingSelection 回建失败，把整个 [`run/start`](../../backend/app/copilot_runtime/router.py:218) 打成 500。

这一层的语义是：thinkingSelection 的恢复失败应当影响 metadata 完整性，但不应继续影响 run/start 的基本可用性。

## 日志落盘策略

### 复用既有 stdout 和 stderr 落盘链

本轮不新建新的后端日志路径协议。后端继续把阶段日志与异常输出写到 stdout / stderr，Electron 侧已有链路会负责落盘：[`initializeRuntimeOutputSinks()`](../../frontend-copilot/electron/runtime/python-runtime-lifecycle-support.ts:51) → [`PythonRuntimeManager.initializeOutputSinks()`](../../frontend-copilot/electron/runtime/python-runtime-manager.ts:383) → [`BACKEND_STDOUT_LOG_FILE_NAME`](../../frontend-copilot/electron/runtime/runtime-paths.ts:12) / [`BACKEND_STDERR_LOG_FILE_NAME`](../../frontend-copilot/electron/runtime/runtime-paths.ts:13)。

因此本轮约束非常明确：

- 后端继续复用现有输出链；
- 不新增新的文件名、目录协定或 IPC 通道；
- 不新增新的前端日志查看器；
- 目标只是让 requestId / phase / exception 能在现有 runtime 日志文件中可访问。

### 日志内容要求

桥接层本轮新增或强化的日志至少应覆盖：

- requestId
- phase
- exception 摘要
- runId
- threadId
- 是否命中 legacy fallback
- 是否跳过 thinking selection rehydrate

其中：

- 常规阶段日志继续走 stdout 即可；
- 异常与失败摘要继续沿用现有 stderr 输出习惯；
- 不要求在本轮设计新的结构化日志协议，只要求上述字段能稳定出现在既有 runtime 文件里。

## 测试策略

本轮测试至少覆盖以下四组场景。

### 1. 新版 provider-specific round-trip 回归

针对新版 provider-specific thinkingSelection，覆盖 [`_to_stored_thinking_selection()`](../../backend/app/copilot_runtime/bridge.py:658) → [`_to_runtime_thinking_selection()`](../../backend/app/copilot_runtime/bridge.py:672) 的往返：

- 完整 JSON-safe 原值存在时，能够无损恢复；
- 若输入异常，至少能 fail-soft，而不是把 [`run/start`](../../backend/app/copilot_runtime/router.py:218) 打成 500；
- 通过 HTTP 或 bridge 集成路径验证 [`_to_message_send_request()`](../../backend/app/copilot_runtime/bridge.py:459) 不再因该类值触发校验异常。

### 2. legacy 兼容回归

针对旧的 mode / level / budgetTokens 形态，验证：

- 旧数据仍能按 legacy 语义正常回建；
- 没有完整原值的历史记录仍可继续工作；
- 新增的完整原值存储不会破坏旧记录读取行为。

### 3. 正常无 thinkingSelection 路径回归

覆盖不带 thinkingSelection 或不带 thinking capability override 的正常路径，验证：

- 请求与 metadata 预热不受影响；
- 本轮补丁不会把原本的空选择路径变成新的失败点；
- 不扩大到 compat message/send 的行为变化。

### 4. 日志输出链回归

验证后端阶段日志仍会通过现有 stdout / stderr 链路输出，至少能覆盖 requestId 与 phase：

- bridge 层成功路径会输出阶段日志；
- fail-soft 路径会输出异常摘要；
- 这些内容仍能被 Electron 既有 sink 链路落到 [`BACKEND_STDOUT_LOG_FILE_NAME`](../../frontend-copilot/electron/runtime/runtime-paths.ts:12) 与 [`BACKEND_STDERR_LOG_FILE_NAME`](../../frontend-copilot/electron/runtime/runtime-paths.ts:13)。

## 风险与回滚

### 主要风险

1. **存储扩展破坏历史兼容**  
   如果完整原值字段被设计成必填，就会误伤旧 run 记录。控制方式是让新增字段保持可选，并保留 legacy fallback。

2. **fail-soft 吞掉可诊断信息**  
   如果只跳过回建而不记录上下文，问题会从 500 变成静默退化。控制方式是要求局部日志必须带 requestId、phase 与 exception 摘要。

3. **范围重新扩散到通用层**  
   若实现时顺手改到 [`RuntimeContract.to_dict()`](../../backend/app/copilot_runtime/contracts.py:40)、[`_jsonable()`](../../backend/app/copilot_runtime/contracts.py:937)、provider route resolver 或 settings schema，会偏离本轮最小修复目标。

4. **日志协议扩张**  
   若为了可观测性新建额外路径或前端查看器，会扩大实现面并引入无关变更。本轮明确禁止这样做。

### 回滚策略

本方案不涉及数据迁移。若需要回滚，按以下顺序撤回即可：

1. 撤回 bridge 层完整原值存储与优先回建逻辑；
2. 撤回 [`_resolve_initial_run_metadata()`](../../backend/app/copilot_runtime/bridge.py:491) 的新增 fail-soft 日志与跳过回建逻辑；
3. 保留既有 stdout / stderr 输出链，不影响 Electron 现有日志落盘能力。

由于新增的完整原值字段是向后兼容的可选扩展，回滚后旧实现最多忽略该字段，不需要额外数据清理。

## 实施步骤

1. 在 [`_to_stored_thinking_selection()`](../../backend/app/copilot_runtime/bridge.py:658) 中补充完整、JSON-safe 的原始 thinkingSelection.value 存储，同时保留 legacy 字段。
2. 在 [`_to_runtime_thinking_selection()`](../../backend/app/copilot_runtime/bridge.py:672) 中实现优先无损回建、其次 legacy fallback、最后安全返回空结果的恢复顺序。
3. 在 [`_to_message_send_request()`](../../backend/app/copilot_runtime/bridge.py:459) 中把 thinkingSelection 回填改为受控步骤，避免把不可恢复输入直接升级成 [`run/start`](../../backend/app/copilot_runtime/router.py:218) 的 500。
4. 在 [`_resolve_initial_run_metadata()`](../../backend/app/copilot_runtime/bridge.py:491) 中保留 fail-soft：对不可恢复的旧数据或异常输入记录局部日志，并跳过 thinking selection rehydrate。
5. 复用现有 stdout / stderr 输出链，确保 requestId / phase / exception 能落到 [`BACKEND_STDOUT_LOG_FILE_NAME`](../../frontend-copilot/electron/runtime/runtime-paths.ts:12) 与 [`BACKEND_STDERR_LOG_FILE_NAME`](../../frontend-copilot/electron/runtime/runtime-paths.ts:13)。
6. 补齐 round-trip、legacy 兼容、无 thinkingSelection 正常路径与日志输出链四组回归测试。
7. 复核范围边界，确认不改前端错误文案、不改 compat message/send、不扩大到 provider route resolver、settings schema、[`RuntimeContract.to_dict()`](../../backend/app/copilot_runtime/contracts.py:40) 或 [`_jsonable()`](../../backend/app/copilot_runtime/contracts.py:937)。

## 结论

第三轮补充设计的核心不是继续追最终响应出口，而是把真实根因收敛到 bridge 的 thinkingSelection round-trip：由 [`_to_stored_thinking_selection()`](../../backend/app/copilot_runtime/bridge.py:658) 保存完整 JSON-safe 原值，由 [`_to_runtime_thinking_selection()`](../../backend/app/copilot_runtime/bridge.py:672) 优先无损回建，由 [`_resolve_initial_run_metadata()`](../../backend/app/copilot_runtime/bridge.py:491) 保底 fail-soft，并继续复用 Electron 现有 stdout / stderr 落盘链。

这样可以在不改前端协议、不改 compat 路径、不扩大通用序列化语义的前提下，完成本轮最小有效修复设计，并为后续实现提供清晰边界。
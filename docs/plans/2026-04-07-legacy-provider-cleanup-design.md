---
title: 旧模型与旧 provider 链路正本清源清理设计
description: 一次性删除已被 route ref、resolved route、provider catalog 与 adapter registry 替代的旧语义与兼容层，并用新合同测试矩阵收口。
---

# 2026-04-07 旧模型与旧 provider 链路正本清源清理设计

## 文档定位

这份设计记录已经获批的一次性全量清理方案。范围只覆盖旧模型与旧 provider 链路的删改边界、执行顺序、风险控制与完成判定，不包含实现代码，也不展开新的 provider 功能设计。

## 背景与现状

### 当前主链已经升级，但仓库仍保留旧主语义与兼容层

父任务中的主链工作已经完成，新的骨架已经具备：provider catalog、settings 持久化迁移、settings UI 数据驱动化、聊天 route ref、宿主 resolver / bridge 协议、Python adapter registry、thinking 对齐与测试收口都已经落地。当前真正的问题不再是“新链路能否工作”，而是仓库内部仍保留多处旧主语义与兼容层，新旧规则同时存在，后续实现很容易被旧路径重新带偏。

当前残留至少集中在下面几类位置。

- [`frontend-copilot/src/features/copilot/model-picker.ts`](frontend-copilot/src/features/copilot/model-picker.ts) 仍同时保留 selectionValue、id、裸 modelId 与 route ref 多套匹配路径，还保留 openai-compatible 的前端专用判断，并且会从裸字符串生成回退模型。
- [`frontend-copilot/electron/settings-workspace/provider-route-resolver.ts`](frontend-copilot/electron/settings-workspace/provider-route-resolver.ts) 仍接受 route ref 之外的 providerProfileId + snapshot 旧请求，并继续从 defaultModel、fastModel、fallbackModel 等历史字段扩展“支持模型”集合。
- [`backend/app/copilot_runtime/protocol.py`](backend/app/copilot_runtime/protocol.py) 仍把 snapshot 作为运行时请求的主体输入，route ref 仍处于附属位置。
- [`backend/app/copilot_runtime/model_routes.py`](backend/app/copilot_runtime/model_routes.py) 仍会从 providerProfileId + snapshot.modelId 自动补 route ref，并同时输出 snapshot 与 routeSnapshot 两套同义字段。
- [`frontend-copilot/electron/runtime/host-model-route-bridge.ts`](frontend-copilot/electron/runtime/host-model-route-bridge.ts) 与 [`backend/app/desktop_runtime/host_model_route_bridge.py`](backend/app/desktop_runtime/host_model_route_bridge.py) 仍保留旧 bridge 协议兼容，包括旧请求形状、旧 success payload 别名、旧 auth 字段与旧错误码别名。
- [`backend/app/copilot_runtime/message_runs.py`](backend/app/copilot_runtime/message_runs.py) 仍保留 legacy text stream 路径，执行器缺少事件流接口时仍可回退。
- [`frontend-copilot/src/workbench/thinking-capabilities.ts`](frontend-copilot/src/workbench/thinking-capabilities.ts) 仍根据前端本地 protocol、endpoint 与 modelId 规则推断 thinking 能力。
- [`frontend-copilot/src/workbench/settings/settings-workspace-model-options.ts`](frontend-copilot/src/workbench/settings/settings-workspace-model-options.ts) 与 [`frontend-copilot/src/workbench/settings/settings-workspace-save-input.ts`](frontend-copilot/src/workbench/settings/settings-workspace-save-input.ts) 仍保留从裸 modelId 反推唯一 route ref 的迁移式保存逻辑。
- 与这些残留并存的新权威源已经存在于 [`provider-catalog/registry.json`](provider-catalog/registry.json) 与 [`backend/app/copilot_runtime/provider_adapter_registry.py`](backend/app/copilot_runtime/provider_adapter_registry.py)。

这些残留对应的旧问题也很明确：旧 modelId 弱匹配、旧 snapshot 请求主语义、前端本地 provider 与 thinking 真相、旧 openai-compatible 专用分支、旧 text stream fallback、旧 success payload 与错误码兼容都还在。当前仓库已经没有继续保留这些兼容层的必要条件。

### 本轮目标是正本清源

本轮采用一次性全量清理方案。凡是已经被 route ref、resolved route、provider catalog、adapter registry 替代的旧语义与兼容层，都在同一轮中直接删除，不再维持双轨主语义。清理完成后，主链只保留一套事实来源，测试也只覆盖这套新合同。

## 目标与非目标

### 目标

1. 系统只保留 route ref、resolved route、provider catalog、adapter registry 作为唯一真相。
2. 系统删除旧 snapshot 请求主语义、旧字符串默认模型主语义、旧 openai-compatible 专用分支、前端本地 thinking 真相、旧 text stream fallback、旧 bridge success payload 与错误码兼容。
3. 测试夹具、假请求、假响应、假执行器同步改成只覆盖新合同，防止旧逻辑通过测试残留重新进入主链。
4. 清理过程遵循“先收紧合同，再删除调用侧，再删除执行侧，最后重写测试”的顺序，避免中途重新引入临时兼容层。

### 非目标

1. 本轮不重做新的 provider 功能设计。
2. 本轮不扩展 UI 能力。
3. 本轮不删除 settings 持久化层对旧本地数据的只读读取与迁移入口。
4. 本轮不为旧合同保留长期旁路，也不为平滑过渡增加新的双轨兼容开关。

## 清理后的唯一真相边界

### 请求与运行时身份

聊天发送、thinking 查询、默认模型选择、会话恢复等所有前端入口，只能持有稳定 route ref。运行时解析完成后的身份，只能由 resolved route 表达。旧字符串默认模型与旧 snapshot 在清理完成后不再承担主语义，也不再作为请求合同的必填主体。

这条边界会直接落在 [`frontend-copilot/src/features/copilot/thread-run-contract.ts`](frontend-copilot/src/features/copilot/thread-run-contract.ts)、[`frontend-copilot/electron/settings-workspace/provider-route-resolver.ts`](frontend-copilot/electron/settings-workspace/provider-route-resolver.ts)、[`backend/app/copilot_runtime/protocol.py`](backend/app/copilot_runtime/protocol.py)、[`backend/app/copilot_runtime/model_routes.py`](backend/app/copilot_runtime/model_routes.py) 与 [`backend/app/desktop_runtime/host_model_route_bridge.py`](backend/app/desktop_runtime/host_model_route_bridge.py)。

### provider 真相

provider 的稳定身份、运行时状态、端点类型、认证模式与 adapter 绑定，只保留两处权威源：[`provider-catalog/registry.json`](provider-catalog/registry.json) 与 [`backend/app/copilot_runtime/provider_adapter_registry.py`](backend/app/copilot_runtime/provider_adapter_registry.py)。

前端设置页、聊天页、Electron 宿主与 Python runtime 都从这两处读取或投影，不再各自保留手写 provider、protocol、endpointType 或 adapter 枚举。

### thinking 真相

thinking 的权威判断只保留后端 canonical capability 与 adapter 最终确认。事实来源落在 [`backend/app/copilot_runtime/thinking_adapter.py`](backend/app/copilot_runtime/thinking_adapter.py) 与 [`backend/app/copilot_runtime/provider_adapter_registry.py`](backend/app/copilot_runtime/provider_adapter_registry.py)。

前端本地规则不再参与聊天运行时决策。像 [`frontend-copilot/src/workbench/thinking-capabilities.ts`](frontend-copilot/src/workbench/thinking-capabilities.ts) 这类文件里与 provider、endpoint、modelId 相关的推断逻辑，需要从聊天运行时路径中移除；若其中有纯表单编辑用的枚举、标签与规范化工具，后续只能以纯 UI 辅助工具存在，不能继续表达运行时真相。

### 唯一允许保留的历史兼容边界

唯一允许保留的历史兼容边界，是 settings 持久化层对旧本地数据的读取与迁移。这部分边界目前位于 [`frontend-copilot/electron/config-center/service.ts`](frontend-copilot/electron/config-center/service.ts) 与 [`frontend-copilot/electron/config-center/copilot-settings-bridge.ts`](frontend-copilot/electron/config-center/copilot-settings-bridge.ts) 一类入口。

这个边界只负责读取旧数据并迁移到新结构。保存完成后，磁盘上只能落新结构，不能再生成旧字符串默认模型，也不能再生成旧 provider secret 命名语义。

## 一次性清理的分层删改顺序与落点

### 第一层：先收紧合同层

这一层先统一输入与输出合同，阻断旧语义继续向上游和下游扩散。

- [`frontend-copilot/src/features/copilot/thread-run-contract.ts`](frontend-copilot/src/features/copilot/thread-run-contract.ts)：将聊天请求合同收紧为 route-ref-only，请求侧移除 snapshot 主体；运行完成、诊断与桥接相关响应只保留 resolved route，不再复用一套结构同时表达“请求身份”和“解析结果”。
- [`frontend-copilot/electron/settings-workspace/provider-route-resolver.ts`](frontend-copilot/electron/settings-workspace/provider-route-resolver.ts)：只接受 route ref 作为解析入口，移除 providerProfileId + snapshot、routeSnapshot、snapshot 等旧请求形式；支持模型集合只来自当前 profile 的真实模型列表，不再额外拼接 defaultModel、fastModel、fallbackModel 等历史字段。
- [`frontend-copilot/electron/runtime/host-model-route-bridge.ts`](frontend-copilot/electron/runtime/host-model-route-bridge.ts)：bridge 请求校验只接受 route-ref-only 形状；bridge 响应只透出 resolver 的单一新合同，不再识别旧 snapshot 请求变体。
- [`backend/app/copilot_runtime/protocol.py`](backend/app/copilot_runtime/protocol.py)：运行时协议解析只接受 route ref 输入，删除由 snapshot 驱动的旧主语义与自动补位。
- [`backend/app/copilot_runtime/model_routes.py`](backend/app/copilot_runtime/model_routes.py)：删除从 snapshot 自动补 route ref 的逻辑，删除 snapshot 与 routeSnapshot 的同义双写，明确区分请求用 route ref 与运行时 resolved route。
- [`backend/app/desktop_runtime/host_model_route_bridge.py`](backend/app/desktop_runtime/host_model_route_bridge.py)：bridge 客户端只解析 resolvedRoute success payload，移除 route 别名、旧 auth 回退字段与旧错误码别名兼容。

### 第二层：再删前端聊天与 settings 中的旧主语义

合同层收紧后，再统一删除聊天页和设置页里残留的旧选择语义与旧保存语义。

- [`frontend-copilot/src/features/copilot/model-picker.ts`](frontend-copilot/src/features/copilot/model-picker.ts)：模型选择与默认模型恢复只按 route ref 命中，删除裸 modelId 弱匹配、唯一命中旧字符串回退、从裸字符串构造回退模型等路径；前端也不再以 openai-compatible 作为流式聊天专用判断入口。
- [`frontend-copilot/src/features/copilot/CopilotChatPanel.tsx`](frontend-copilot/src/features/copilot/CopilotChatPanel.tsx)：聊天面板内的默认模型恢复、草稿恢复与提交装配统一改为 route ref 主语义，不再接受旧字符串默认模型回流到发送链路。
- [`frontend-copilot/src/features/copilot/copilot-chat-helpers.ts`](frontend-copilot/src/features/copilot/copilot-chat-helpers.ts)：thinking 记忆键、诊断构造与错误投影统一改成 route ref 或后端 resolved route 语义，不再从 snapshot 或前端本地 provider 线索重建运行时事实。
- [`frontend-copilot/src/workbench/settings/DefaultModelRoutesSection.tsx`](frontend-copilot/src/workbench/settings/DefaultModelRoutesSection.tsx)：设置文案与交互说明只表达稳定 route ref 选择，不再保留旧裸 modelId 的暗示性描述。
- [`frontend-copilot/src/workbench/settings/settings-workspace-model-options.ts`](frontend-copilot/src/workbench/settings/settings-workspace-model-options.ts)：删除从 legacy modelId 反推唯一 route ref 的活动逻辑；默认选项构造在拿不到合法 route ref 时直接回空，而不是继续保留裸字符串。
- [`frontend-copilot/src/workbench/settings/settings-workspace-save-input.ts`](frontend-copilot/src/workbench/settings/settings-workspace-save-input.ts)：保存时只写 route ref 或空值，删除从 selectedModelId、persistedRoute 与 profile 唯一匹配关系中反推旧模型的逻辑。

### 第三层：再删前端本地 provider 与 thinking 真相

这一层的目标是让前端退出运行时判定，只负责展示与收集输入。

- [`frontend-copilot/src/workbench/thinking-capabilities.ts`](frontend-copilot/src/workbench/thinking-capabilities.ts) 中依赖 protocol、endpoint、host hint、modelId 的内建推断逻辑要删除。
- 聊天运行时若需要 thinking 能力，只能读取后端 canonical capability 查询结果，或读取运行时返回的确定性元数据。
- 前端 provider 真相只能来自 [`provider-catalog/registry.json`](provider-catalog/registry.json) 投影出的非敏感元数据，不能再自行维护一套“本地理解的 provider 能力”。

### 第四层：再删后端旧执行适配层与重复入口

前端旧主语义删除后，后端再收掉旧执行适配与重复入口，保证主链只有一条执行方式。

- [`backend/app/copilot_runtime/message_runs.py`](backend/app/copilot_runtime/message_runs.py)：删除 legacy text stream 适配器与 open_text_stream 回退路径；执行器必须提供事件流接口，主链只保留 event-stream-only。
- [`backend/app/copilot_runtime/agent.py`](backend/app/copilot_runtime/agent.py)：删除旧 startup model env fallback，运行时模型来源只能是 resolved route + adapter registry，测试若需要伪模型，只能显式注入测试替身。
- [`backend/app/copilot_runtime/thinking_adapter.py`](backend/app/copilot_runtime/thinking_adapter.py)：删除将 local override 或 unknown route 继续提升为运行时真相的路径；override 只能作为显式输入，最终是否可用仍由已验证的 capability 与 adapter 决定。
- [`backend/app/copilot_runtime/provider_adapter_registry.py`](backend/app/copilot_runtime/provider_adapter_registry.py)：删除旧 openai-compatible 专用判断，尤其是依赖 openai provider、host hint 与特定 modelId 的隐式 special case；provider 能力与 thinking 映射只由 catalog 绑定的 adapter 负责。

### 第五层：测试与夹具同步重写

测试与夹具要和实现同步改写，不能等主代码改完之后再用补丁式方式兜底。

- 前端假请求只允许生成 route ref 主语义，不再生成 snapshot 主体。
- Electron bridge 假响应只允许生成 resolvedRoute success payload，不再生成 route、auth、旧错误码别名等兼容形状。
- 后端假执行器只允许提供事件流接口；继续只实现 text stream 的测试替身需要删除或改写。
- 任何仍然喂旧合同的测试，都视为本轮清理未完成，不能以跳过或保留旧断言的方式留在仓库中。

## 风险控制与测试矩阵

### 风险控制原则

1. 不保留双轨主语义。清理完成后，旧请求、旧响应、旧匹配、旧回退都不能继续存在于生产代码中。
2. 不允许测试继续喂旧合同。测试夹具、测试数据和假执行器必须先改合同，再承接实现改动。
3. 不允许前端本地规则继续替代运行时事实。前端若无法确定某项能力，应当等待后端确定性结果，而不是继续用本地推断补位。
4. settings 迁移边界与聊天运行时边界严格分离。旧本地数据读取可以保留，聊天运行时不能因此继续接受旧合同。

### 必测矩阵

| 层次 | 必测范围 | 关键断言 |
| --- | --- | --- |
| 前端 Renderer | 模型选择、默认模型恢复、聊天提交、thinking 能力展示、错误提示 | 只按 route ref 选择；不再按裸 modelId 弱匹配；不再用前端本地 provider 与 thinking 规则决定运行时行为。 |
| Electron 宿主 | route resolver、host bridge、settings 保存与加载 | 只接受 route-ref-only 请求；只返回 resolved-route-only 响应；settings 新保存结果不再生成旧字符串默认模型。 |
| Python Runtime | 协议解析、bridge 客户端、message runs、agent、thinking adapter、adapter registry | 协议不再接受 snapshot 主语义；bridge 客户端不再解析旧别名；执行器只允许事件流；不再存在 env fallback 与 openai special case。 |
| 测试夹具 | 假请求、假响应、假执行器、测试数据工厂 | 新夹具只表达新合同，旧合同夹具删除或彻底改写。 |

### 必须新增的防隐蔽回归测试

1. route-ref-only request：前端到后端到宿主的请求链路只包含 route ref 与当前合同允许的最小辅助字段，旧 snapshot 请求必须直接失败。
2. resolved-route-only response：宿主返回成功结果时只包含 resolvedRoute 与私有认证载荷，bridge 客户端不再接受旧 route 别名或旧 auth 形状。
3. no-weak-match：两个 profile 下存在同名 modelId 时，默认模型恢复与聊天发送都必须依赖 route ref；裸字符串不能再命中其中任意一条路由。
4. no-openai-special-case：旧 openai-compatible 专用判断彻底移除，不能再因为 provider 名称、host hint 或旧 endpoint 习惯触发隐藏能力分支。
5. event-stream-only：执行器若没有事件流接口，主链直接失败；旧 text stream 回退不再存在。

## 完成判定

### 代码层面

1. 聊天、宿主、后端主链中不再存在旧 snapshot 请求主语义。
2. 聊天、默认模型恢复与 settings 保存中不再存在旧 modelId 弱匹配主语义。
3. 前端运行时路径中不再存在本地 provider 与 thinking 真相。
4. 后端运行时路径中不再存在旧 text stream fallback、旧 openai-compatible 专用分支与旧 bridge success payload 兼容。

### 测试层面

1. 对应旧语义的旧测试入口全部删除或改写，而不是跳过。
2. 旧假请求、旧假响应、旧假执行器全部删除或改成只表达新合同。
3. 关键回归测试至少覆盖 route-ref-only request、resolved-route-only response、no-weak-match、no-openai-special-case、event-stream-only。

### 数据层面

1. settings 仍能读取旧本地数据并迁移。
2. 新保存结果只落新结构，不再生成旧字符串默认模型。
3. 新保存结果不再生成旧 provider secret 命名语义。

### 验证层面

1. 前端与 Electron 的确定性单测全部通过。
2. 后端确定性单测全部通过。
3. 类型检查全部通过。
4. 无外部密钥 smoke 全部通过。

只要上述四个层面的判定同时成立，本轮“旧模型 / 旧 provider 链路正本清源清理”才算完成。

---
title: Claude Code 竞品分析报告
description: Claude Code 竞品分析报告
sidebar_position: 1
sidebar_label: Claude Code 竞品分析报告
---

# 当前项目与 Claude Code 的技术竞品分析报告

## 1. 研究目标、范围与证据边界
本报告围绕当前项目 [`README.md`](../README.md) 与竞品源码 `claude-code-main` 的技术形态、运行机制与工程治理能力展开对比研究。

本报告将研究范围限定在七个一级维度，并且仅使用已完成父任务研究所确认的证据。

本报告采用三类表述边界。

- 事实：事实来自可追溯的源码与项目文档锚点，例如当前项目架构总述 [`architecture-overview.md`](../system/architecture-overview.md) 与竞品会话核心 `QueryEngine`。
- 推断：推断来自对已确认事实的结构化归纳，例如对架构演进速度与治理深度的趋势判断。
- 建议：建议面向当前项目后续迭代，不作为已实现能力陈述。

本报告对当前项目能力状态仅使用四种标识。

- 已实现。
- 已预留。
- 文档规划。
- 合理推断。

## 2. 核心结论摘要
第一，竞品在部署边界与接入弹性方面形成了更宽的技术覆盖。竞品以 CLI 为核心入口，并已支持 headless、remote 与服务化混合形态。当前项目以 Electron 桌面宿主为主，形成了稳定的本地闭环，部署边界更聚焦。这个差异体现的是产品路线与目标场景差异，而不是绝对优劣关系。

第二，竞品在长生命周期会话引擎与上下文治理方面更成熟。竞品存在统一的长会话执行核心 `QueryEngine`，并配套上下文压缩 `microcompactMessages()` 与持久记忆注入 `loadMemoryPrompt()`。当前项目聊天主线已实现 `RuntimeMessageRunOrchestrator`，但正式会话历史仍主要依赖进程内 `InMemorySessionStore`。

第三，竞品在 Agent 编排与复杂任务自治上达到更高成熟度。竞品已有子代理任务入口 `runAgent()`。当前项目现阶段更偏消息运行编排，任务自治深度仍处于演进阶段。

第四，竞品扩展面呈现多层结构。竞品扩展体系由 `Tool`、`Command`、plugin 与 MCP 共同构成。当前项目已实现受控注册表 `build_default_tool_registry()`，扩展机制清晰且可控，但生态 leverage 仍有明显差距。

第五，当前项目在宿主管理的配置与 secret 边界方面具备可观优势。该优势主要来自受控 preload、loopback 与私桥策略，这一点在本地桌面场景中具有现实价值。与此同时，竞品在策略深度、远程桥接成熟度与可观测治理闭环方面领先。

## 3. 差异矩阵总览
| 维度 | 竞品现状 | 当前项目现状 | 差距判断 | 对项目启示 | 证据类型 |
| --- | --- | --- | --- | --- | --- |
| 产品形态与部署边界 | 竞品以 CLI 为中心，并支持 headless、remote、服务化混合部署。 | 当前项目以 Electron 桌面宿主与本地 runtime 为主，文档显示架构边界聚焦本地闭环。 | 竞品在部署弹性与接入边界上更灵活。当前项目在本地体验与宿主控制上更集中。 | 项目可以在保持桌面主形态前提下，逐步预留远程执行与服务化入口。 | 事实 + 推断 |
| 运行时架构与会话执行模型 | 竞品存在统一长会话核心 `QueryEngine`。 | 当前项目由 `RuntimeMessageRunOrchestrator` 组织聊天主线，会话历史以 `InMemorySessionStore` 为主。 | 竞品更接近长生命周期会话执行核心，当前项目更接近围绕聊天流程的运行编排。 | 项目需要优先补强会话持久化、上下文分层与长会话恢复能力。 | 事实 + 推断 |
| Agent 编排与任务自治深度 | 竞品已具备子代理编排入口 `runAgent()`。 | 当前项目已实现消息运行编排，但任务自治能力仍在演进。 | 竞品在复杂任务自治与多步协同方面成熟度更高。 | 项目可以先建立可审计的任务图与中间状态模型，再迭代多代理协作。 | 事实 + 推断 + 建议 |
| 工具、命令与扩展生态 | 竞品形成 Tool、Command、plugin、MCP 的分层扩展面。 | 当前项目采用受控工具注册表 `build_default_tool_registry()`，默认工具数量有限，部分能力仍为占位。 | 竞品扩展接口层次更丰富，生态 leverage 更强。当前项目扩展面更可控。 | 项目可以维持受控安全边界，并增加分层扩展契约与第三方接入规范。 | 事实 + 推断 + 建议 |
| 上下文治理与记忆体系 | 竞品已实现上下文压缩 `microcompactMessages()` 与持久记忆注入 `loadMemoryPrompt()`。 | 当前项目会话历史当前以进程内存存储为主。 | 竞品在长会话治理成熟度上明显领先。 | 项目可以分阶段引入摘要压缩、长期记忆索引与可回放会话资产。 | 事实 + 推断 + 建议 |
| 安全、策略与集成控制 | 竞品具备多层权限、策略控制与远程桥接治理能力。 | 当前项目在 settings 与 secret 边界方面已形成较清晰宿主侧控制。 | 当前项目基础安全边界具备优势，策略深度与远程集成成熟度仍弱于竞品。 | 项目应延续最小权限原则，并补全策略执行链与远程审计链路。 | 事实 + 推断 + 建议 |
| 可观测性、交互体验与工程化成熟度 | 竞品呈现 feature flag、启动 profiling 等工程治理迹象，可观测能力较强。 | 当前项目在桌面 GUI 承载与本地宿主边界方面已有基础，服务化运维闭环证据较弱。 | 竞品在运行治理闭环与运维工程化上领先。 | 项目需要建立统一观测指标、运行事件模型与跨端诊断流水。 | 事实 + 推断 + 建议 |

## 4. 产品形态与部署边界对比
### 4.1 竞品事实
事实：竞品采用 CLI-first 形态，并支持 headless、remote 与服务化混合部署。该形态允许同一能力在终端交互、自动化流程与远程执行场景中复用。

### 4.2 当前项目事实
事实：当前项目已实现 Electron 桌面宿主、React renderer 与本地 loopback Python runtime 的主形态，系统总述可见 [`architecture-overview.md`](../system/architecture-overview.md)。

事实：当前项目文档强调运行生命周期与边界治理，相关说明可见 [`runtime-lifecycle.md`](../system/runtime-lifecycle.md) 与 [`roadmap-and-boundaries.md`](../backend/roadmap-and-boundaries.md)。

### 4.3 差距判断
推断：两者差异主要表现为部署弹性与接入边界宽度。竞品覆盖面更宽，当前项目控制面更集中。

推断：当前项目在本地桌面体验、宿主资源调度和用户配置保护方面具备现实优势，但远程服务化弹性仍不足。

### 4.4 对本项目启示
建议：项目可以保持桌面宿主作为核心交付形态，同时通过接口抽象逐步引入 headless 与远程执行入口。

建议：项目推进部署形态扩展时，建议优先复用已有宿主边界治理机制，减少多形态并行带来的控制面分裂。

## 5. 运行时架构与会话执行模型对比
### 5.1 竞品事实
事实：竞品会话主引擎由 `QueryEngine` 提供，体现了统一长生命周期执行核心的设计思路。

### 5.2 当前项目事实
事实：当前项目聊天主线由 `RuntimeMessageRunOrchestrator` 组织。

事实：当前项目会话状态与模型文档可见 [`session-and-state-model.md`](../system/session-and-state-model.md)。

事实：当前项目正式会话历史当前仍主要使用进程内 `InMemorySessionStore`。

事实：前端 transport 当前仍主要通过线程与运行适配层衔接，尚未完全收敛到文档目标中的新会话合同，合同参考 [`chat-runtime-contract.md`](../system/chat-runtime-contract.md)。

### 5.3 差距判断
推断：竞品已经形成更统一的长会话运行核心，当前项目仍处于以消息驱动编排为主的阶段。

推断：当前项目在会话恢复、跨阶段上下文治理与执行连续性方面还有明显提升空间。

### 5.4 对本项目启示
建议：项目可以先引入可持久化会话索引与会话快照机制，再逐步演进统一会话执行核心。

建议：项目可以将 transport 收敛计划与会话生命周期改造同步推进，以减少接口双轨期的复杂度。

## 6. Agent 编排与任务自治深度对比
### 6.1 竞品事实
事实：竞品具备子代理任务入口 `runAgent()`，说明其在任务拆解与代理协同方面已经形成可执行主线。

### 6.2 当前项目事实
事实：当前项目已实现消息运行编排主线 `RuntimeMessageRunOrchestrator`。

事实：当前项目后端模块与运行配置文档可见 [`module-layout.md`](../backend/module-layout.md) 与 [`run-and-config.md`](../backend/run-and-config.md)。

事实：当前项目部分集成能力与领域模块仍处于已预留或文档规划状态，边界说明可见 [`roadmap-and-boundaries.md`](../backend/roadmap-and-boundaries.md)。

### 6.3 差距判断
推断：竞品在复杂任务自治与多步任务协同方面成熟度更高。

推断：当前项目当前阶段更偏向单主线消息调度，复杂任务的中间状态治理与代理协作机制尚未形成完整闭环。

### 6.4 对本项目启示
建议：项目可先建立任务分解协议、子任务生命周期状态机与失败恢复语义，再扩展多代理编排深度。

建议：项目在推进自治能力时应强调可审计与可回放，避免任务分叉导致的可解释性下降。

## 7. 工具、命令与扩展生态对比
### 7.1 竞品事实
事实：竞品扩展体系由 `Tool`、`Command`、plugin 与 MCP 共同构成，具备分层接口与生态接入基础。

### 7.2 当前项目事实
事实：当前项目已实现受控工具注册表 `build_default_tool_registry()`。

事实：当前项目默认工具数量有限，部分能力仍为占位或预留。

事实：当前项目后端与前端连接边界可见 [`frontend-connection.md`](../backend/frontend-connection.md) 与 [`ui-current-state.md`](../frontend/ui-current-state.md)。

### 7.3 差距判断
推断：竞品在扩展层次、第三方接入与生态 leverage 方面更成熟。

推断：当前项目扩展面具备受控优势，这一优势有利于保证宿主安全边界与行为一致性。

### 7.4 对本项目启示
建议：项目可以在现有受控注册机制基础上，增加分层扩展契约，例如内置工具层、受信扩展层与外部桥接层。

建议：项目可以逐步公开命令与工具元数据协议，以支持工具发现、权限声明与审计。

### Cherry Studio 思考配置适配机制
#### 问题背景
事实：Cherry Studio 这一部分的研究证据主要来自类型定义、模型规则、状态修正钩子与参数构造链路。相关入口覆盖统一设置类型 `ReasoningEffortOption`、模型支持矩阵 `MODEL_SUPPORTED_OPTIONS` 与统一请求入口 `buildStreamTextParams()`。

事实：从这些源码可以看到，不同 provider 与不同模型族对 thinking 配置的支持形式并不相同，差异涉及开关、挡位、预算、固定推理模型与 auto 的具体下发语义。例如 `getOpenAIReasoningParams()`、`getAnthropicReasoningParams()`、`getGeminiReasoningParams()` 与 `getOllamaReasoningParams()` 分别处理了不同参数形态。

推断：这一问题本质上是统一用户配置入口与异构 provider wire format 之间的适配问题，因此仅依赖单一字段透传，很难同时保持 UI、状态与请求层的一致性。

#### Cherry Studio 的统一抽象层
事实：Cherry Studio 先在助手设置层定义统一思考意图枚举 `ReasoningEffortOption`，并在 `AssistantSettings` 中持有 `reasoning_effort`、`reasoning_effort_cache` 与 `qwenThinkMode` 等字段，对应默认值由 `DEFAULT_ASSISTANT_SETTINGS` 提供。

推断：这种结构说明其持久化层保存的是相对稳定的用户意图与纠正辅助状态，provider 原生参数则延后到发送前再做翻译。

事实：预算型思考强度没有分散写入各 provider 分支，而是通过 `EFFORT_RATIO`、`findTokenLimit` 与 `getThinkingBudget()` 形成独立计算链路。

#### 支持矩阵与模型识别方式
事实：Cherry Studio 对模型支持能力的判断主要由本地规则表驱动，关键入口包括 `MODEL_SUPPORTED_REASONING_EFFORT`、`MODEL_SUPPORTED_OPTIONS`、`REASONING_REGEX`、`getThinkModelType()` 与 `getModelSupportedReasoningEffortOptions()`。

事实：虽然存在 `ModelCapability` 与 `Model` 等模型元数据结构，但 reasoning 识别并未完全交给元数据字段；`isReasoningModel()` 与 `isFixedReasoningModel` 体现出显式覆盖、family 判断与正则识别并行的做法。

推断：它采用的是“少量元数据覆盖 + 大量本地静态规则”的混合识别方式，这种方式的维护成本较高，但能力边界更可控。

#### UI 与请求层的一致性保障
事实：Cherry Studio 在 UI 展示层直接复用同一套能力矩阵。`ThinkingButton` 会结合 `getThinkModelType()` 与 `MODEL_SUPPORTED_OPTIONS` 决定图标样式、是否弹出多挡位选择与关闭逻辑，其中多选面板的触发点可见 `ThinkingButton`。

事实：模型切换时的旧值纠正也建立在同一套规则上。`useAssistant()` 会在模型变化后检查配置合法性；若原值已不再支持，则根据 `useAssistant()` 优先恢复缓存值，再回退到新模型支持的首个选项。

推断：UI、状态修正与请求下发共享同一套能力识别逻辑，因此较少出现界面可选值与实际请求参数脱节的问题。

#### Provider 适配与回退策略
事实：统一下发入口位于 `buildStreamTextParams()`，该函数在启用 reasoning 时会继续调用 `buildProviderOptions()`。具体 provider builder 分布在 `buildOpenAIProviderOptions()`、`buildAnthropicProviderOptions()`、`buildGeminiProviderOptions()`、`buildXAIProviderOptions()`、`buildBedrockProviderOptions()`、`buildOllamaProviderOptions()` 与 `buildGenericProviderOptions()`。

事实：统一意图到 provider 参数的主要翻译逻辑集中在 `getReasoningEffort()`。其中 OpenAI、Anthropic、Gemini、Bedrock Claude 与 Ollama 分别通过 `getOpenAIReasoningParams()`、`getAnthropicReasoningParams()`、`getGeminiReasoningParams()`、`getBedrockReasoningParams()` 与 `getOllamaReasoningParams()` 生成各自参数形态，openai-compatible 的 snake_case 与 camelCase 兼容修正则在 `buildProviderOptions()` 完成。

事实：auto、未知模型与不支持当前挡位时的处理并不完全一致。部分 effort 型模型会在 `getReasoningEffort()` 回退到首个支持值；某些未知分支会在 `getReasoningEffort()` 走 warning 后尽量退化；OpenAI、Anthropic 与 Gemini 对 auto 的下发语义也分别体现在 `getOpenAIReasoningParams()`、`getAnthropicReasoningParams()` 与 `getGeminiReasoningParams()`。

推断：Cherry Studio 追求的是统一用户心智与保守下发策略，最终 wire format 仍然保持 provider 差异。

#### 对当前项目的参考价值
建议：如果当前项目未来引入不同 provider 与 model 的 thinking 配置，可优先建立统一抽象层，由 UI 与持久化层保存用户意图，再由发送前适配器负责翻译原生参数。

建议：项目宜集中维护支持矩阵，并让 UI 展示、模型切换纠正与请求构造复用同一套判断函数，降低 stale config 与配置分叉风险。

建议：项目可将预算计算器独立封装，并为 unknown provider、fixed reasoning model 与 auto 语义分别定义保守回退策略，避免将异构细节扩散到多处分支。

## 8. 上下文治理与记忆体系对比
### 8.1 竞品事实
事实：竞品在上下文治理方面已经形成压缩机制 `microcompactMessages()`。

事实：竞品在记忆体系方面支持持久记忆注入 `loadMemoryPrompt()`。

### 8.2 当前项目事实
事实：当前项目会话状态模型可见 [`session-and-state-model.md`](../system/session-and-state-model.md)。

事实：当前项目正式会话历史目前仍以内存存储 `InMemorySessionStore` 为主。

事实：前端存在记忆与设置相关页面能力，但其中部分能力属于已预留或文档规划，相关说明可见 [`roadmap-and-placeholders.md`](../frontend/roadmap-and-placeholders.md)。

### 8.3 差距判断
推断：竞品在长会话持续性、上下文压缩效率与长期记忆治理方面形成了更完整能力链路。

推断：当前项目当前证据不足以支持成熟长期记忆系统结论。

### 8.4 对本项目启示
建议：项目可优先建设三层机制，即短期会话缓存层、摘要压缩层与长期检索层。

建议：项目可以先将记忆治理纳入可观测体系，再推进自动注入策略，以降低记忆污染风险。

## 9. 安全、策略与集成控制对比
### 9.1 竞品事实
事实：竞品已具备多层权限、策略控制、远程桥接与集成治理能力。

### 9.2 当前项目事实
事实：当前项目在宿主侧 settings 与 secret 边界上具有较清晰控制，相关内容可见 [`architecture-overview.md`](../system/architecture-overview.md) 与 [`run-and-config.md`](../backend/run-and-config.md)。

事实：当前项目受控 preload、loopback 与私桥构成了本地执行边界治理基础，前端侧现状可见 [`ui-current-state.md`](../frontend/ui-current-state.md)。

事实：当前项目部分集成能力仍处于已预留或文档规划阶段，边界说明可见 [`roadmap-and-boundaries.md`](../backend/roadmap-and-boundaries.md)。

### 9.3 差距判断
推断：当前项目安全基础并不薄弱，尤其在本地宿主边界控制方面具备可验证实践。

推断：竞品在策略深度、远程桥接成熟度与集成产品化程度方面更强。

### 9.4 对本项目启示
建议：项目可在既有边界控制上继续强化权限策略语言、策略执行链路与审计事件模型。

建议：项目在扩展远程集成时，可采用分级信任模型与默认拒绝策略，保障边界扩展过程的安全一致性。

## 10. 可观测性、交互体验与工程化成熟度对比
### 10.1 竞品事实
事实：竞品呈现 feature flag、启动 profiling 等工程治理迹象，可观测与运行治理能力较强。

### 10.2 当前项目事实
事实：当前项目在桌面 GUI 承载方面已经形成稳定基础。

事实：当前项目运行与配置文档已较完整，相关内容可见 [`run-and-config.md`](../backend/run-and-config.md) 与 [`frontend-connection.md`](../backend/frontend-connection.md)。

事实：当前项目服务化运维闭环与跨环境治理能力当前证据较弱。

### 10.3 差距判断
推断：竞品在可观测性、工程治理工具链与服务化运维闭环方面领先。

推断：当前项目在本地可用性与交互承载上具备优势基础，但跨端诊断与统一治理模型仍需加强。

### 10.4 对本项目启示
建议：项目可先定义统一运行事件模型，再补齐关键指标面板、异常分类与回放机制。

建议：项目可将观测建设与会话治理改造联动推进，使性能、稳定性与记忆质量能够被同一套指标持续评估。

## 11. 对当前项目的启示与建议
### 11.1 面向五个核心差距的优先建议
建议：针对长会话引擎与上下文治理差距，项目应优先建立会话持久化、摘要压缩与记忆注入的最小闭环，并明确每一步的观测指标。

建议：针对 Agent 编排成熟度差距，项目应先形成任务分解协议与可回放执行图，再逐步增加代理协作深度。

建议：针对扩展接口层次与生态 leverage 差距，项目应在受控注册表基础上扩展多层契约与权限声明机制。

建议：针对部署形态与远程服务化能力差距，项目应采用渐进式扩展策略，先打通 headless 入口，再评估远程执行稳定性。

建议：针对可观测性与治理闭环差距，项目应建立统一事件口径、跨层追踪链路与策略执行审计。

建议：如果项目后续接入不同 provider 与 model 的 thinking 配置，适合参考前文 Cherry Studio 专题所呈现的统一意图枚举、集中支持矩阵与请求前适配链路。UI 侧只暴露稳定的用户意图；模型切换时自动纠正旧值；预算型 thinking 通过独立计算器生成下发参数，以减少 provider 差异对设置层的侵入。

### 11.2 当前项目阶段匹配性说明
推断：当前项目处于从本地桌面稳态向更强运行治理能力演进的阶段。

推断：建议的优先顺序应以低侵入改造为原则，优先改造会话治理与观测基础，再推进生态和部署外延。

### 11.3 当前项目不宜直接照搬的竞品能力
建议：项目当前不宜直接复制竞品的全量远程化与高自由度扩展模式，因为当前项目的核心优势来自宿主边界控制与本地稳定体验。

建议：项目在引入复杂 Agent 体系时，应优先保障可解释与可审计特性，避免在能力扩张初期产生治理负担。

## 12. 附录：关键证据锚点与谨慎表述说明
### 12.1 关键证据锚点
| 编号 | 证据锚点 | 类型 | 用途 |
| --- | --- | --- | --- |
| A1 | 竞品会话核心 `QueryEngine` | 事实 | 用于支持竞品长生命周期会话执行核心判断。 |
| A2 | 竞品 Agent 入口 `runAgent()` | 事实 | 用于支持竞品任务自治与编排成熟度判断。 |
| A3 | 竞品扩展基础 `Tool` | 事实 | 用于支持竞品工具扩展接口层结论。 |
| A4 | 竞品命令接口 `Command` | 事实 | 用于支持竞品命令层能力存在性判断。 |
| A5 | 竞品上下文压缩 `microcompactMessages()` | 事实 | 用于支持竞品上下文治理成熟度判断。 |
| A6 | 竞品持久记忆注入 `loadMemoryPrompt()` | 事实 | 用于支持竞品记忆体系成熟度判断。 |
| B1 | 当前项目系统总览 [`architecture-overview.md`](../system/architecture-overview.md) | 事实 | 用于支持桌面宿主与本地 runtime 主形态判断。 |
| B2 | 当前项目运行时主线 `RuntimeMessageRunOrchestrator` | 事实 | 用于支持当前项目消息运行编排主线判断。 |
| B3 | 当前项目会话存储 `InMemorySessionStore` | 事实 | 用于支持当前项目会话历史现状判断。 |
| B4 | 当前项目工具注册表 `build_default_tool_registry()` | 事实 | 用于支持当前项目受控扩展机制判断。 |
| B5 | 当前项目会话合同 [`chat-runtime-contract.md`](../system/chat-runtime-contract.md) | 事实 | 用于支持会话合同目标与现状差距判断。 |
| B6 | 当前项目路线边界 [`roadmap-and-boundaries.md`](../backend/roadmap-and-boundaries.md) | 事实 | 用于标注已预留与文档规划边界。 |
| C1 | Cherry Studio 统一抽象 `ReasoningEffortOption` 与 `AssistantSettings` | 事实 | 用于支持统一意图配置层与设置结构判断。 |
| C2 | Cherry Studio 默认设置 `DEFAULT_ASSISTANT_SETTINGS` | 事实 | 用于支持 reasoning 默认字段与缓存字段存在性判断。 |
| C3 | Cherry Studio 支持矩阵 `MODEL_SUPPORTED_OPTIONS` 与 `getThinkModelType()` | 事实 | 用于支持本地规则驱动的能力识别结论。 |
| C4 | Cherry Studio 状态纠正 `useAssistant()` 与 `useAssistant()` | 事实 | 用于支持模型切换后 stale config 自动修正结论。 |
| C5 | Cherry Studio 请求入口 `buildStreamTextParams()` 与 `buildProviderOptions()` | 事实 | 用于支持统一下发入口与 provider builder 分层判断。 |
| C6 | Cherry Studio 统一翻译与预算计算 `getReasoningEffort()`、`getThinkingBudget()` 与 `EFFORT_RATIO` | 事实 | 用于支持 effort 翻译与预算计算独立封装判断。 |
| C7 | Cherry Studio 异构 provider 参数 `getOpenAIReasoningParams()`、`getAnthropicReasoningParams()`、`getGeminiReasoningParams()` 与 `getOllamaReasoningParams()` | 事实 | 用于支持 auto 语义异构与 provider 专项适配结论。 |

### 12.2 谨慎表述边界
事实：本报告未将 CLI-first 与 Electron 桌面宿主关系写成绝对优劣判断。

事实：本报告未将未见成熟能力写成能力不存在。

事实：本报告未将 `InMemorySessionStore` 叙述为长期记忆系统。

事实：本报告未将工具数量差异写成无扩展能力结论。

事实：本报告未将治理能力差距写成当前项目不安全。

事实：本报告未将建议段落写成已确认路线图或已实现能力。

事实：本报告未将成本控制单列为证据充分的已实现能力。

事实：本报告未将 Cherry Studio 写成完全依赖模型元数据的 reasoning 系统。

事实：本报告未将 auto 叙述为跨 provider 统一的 wire 语义。

事实：本报告未将不同 provider 的回退行为叙述为完全一致。

事实：本报告关于 Cherry Studio 思考配置机制的结论主要来自源码锚点，不以官方文档总述替代源码事实。

事实：本报告未将 Cherry Studio 各 provider 适配分支表述为已完成端到端完备验证。

### 12.3 质量控制清单
- 本报告完整覆盖十二个既定章节，并保持固定章节顺序。
- 本报告完整覆盖七个一级比较维度，且未新增一级维度。
- 本报告在第 4 节至第 10 节逐节执行了“竞品事实、当前项目事实、差距判断、对本项目启示”的展开顺序。
- 本报告在正文与附录中显式区分了事实、推断与建议三类表述。
- 本报告对当前项目能力状态仅使用已实现、已预留、文档规划、合理推断四类状态。
- 本报告在附录中集中整理了关键证据锚点与谨慎表述边界。
- 本报告在摘要、矩阵与正文中保持了五个核心差距的一致表达。

### 12.4 事实、推断、建议标注规则
事实：事实段落以源码与文档锚点为依据，并可回溯到具体链接。

推断：推断段落基于多个事实进行归纳，不将推断表述为源码直接结论。

建议：建议段落仅表达改进方向与实施优先级，不表达为既定承诺或已落地能力。

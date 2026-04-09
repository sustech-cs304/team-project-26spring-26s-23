---
title: Provider 支持完全数据驱动重构设计
description: 将 provider 支持从分散硬编码收敛到 catalog、profile、默认路由引用、运行时 snapshot 与后端 adapter 的统一体系。
---

# 2026-04-06 Provider 支持完全数据驱动重构设计

## 文档定位

这份设计记录已获批准的 provider 扩展方向，范围只覆盖架构、数据模型、迁移策略、错误边界与测试分层。当前阶段不包含实现代码，也不展开任务拆分。

## 背景与现状

### 现有链路存在多处分散硬编码

当前项目对 provider 的语义在至少四条链路中重复维护，实际已经形成多份事实来源。

1. 设置页链路直接手写 provider 与 protocol 选项。[`frontend-copilot/src/workbench/settings/config.ts`](frontend-copilot/src/workbench/settings/config.ts:17) 在 [`protocolOptions`](frontend-copilot/src/workbench/settings/config.ts:17) 中直接列出 `openai`、`openai-response`、`gemini`、`anthropic`、`ollama` 等选项，设置页展示依赖这份静态枚举。
2. 聊天链路单独维护当前可用的流式端点类型。[`frontend-copilot/src/features/copilot/model-picker.ts`](frontend-copilot/src/features/copilot/model-picker.ts:39) 把 [`STREAMING_CHAT_SUPPORTED_ENDPOINT_TYPES`](frontend-copilot/src/features/copilot/model-picker.ts:39) 固定为 `openai-compatible`，同时在 [`createRuntimeModelRoute()`](frontend-copilot/src/features/copilot/model-picker.ts:352) 中继续手写 `provider === 'openai' ? 'openai-compatible' : provider` 的投影规则。
3. 宿主 route resolver 再维护一份 provider 与 endpoint 的推导逻辑。[`frontend-copilot/electron/settings-workspace/provider-route-resolver.ts`](frontend-copilot/electron/settings-workspace/provider-route-resolver.ts:72) 在解析路由时重复拼装 `provider`、`endpointType`、`baseUrl`、`modelId` 与 `auth`，并在 [`projectEndpointType()`](frontend-copilot/electron/settings-workspace/provider-route-resolver.ts:222) 中再次写入与聊天侧相同的 endpoint 推导规则。
4. 后端执行器继续把执行能力绑定在 `openai-compatible` 语义上。[`backend/app/copilot_runtime/agent.py`](backend/app/copilot_runtime/agent.py:72) 将 `_SUPPORTED_STREAM_ENDPOINT_TYPES` 固定为 `openai-compatible`，[`_build_stream_model()`](backend/app/copilot_runtime/agent.py:1219) 则直接构造 `OpenAIProvider` 与 `OpenAIModel`。
5. Electron 与 Python 之间的宿主桥还在重复传输与解析同一套 route snapshot 结构。[`frontend-copilot/electron/runtime/host-model-route-bridge.ts`](frontend-copilot/electron/runtime/host-model-route-bridge.ts:18) 与 [`backend/app/desktop_runtime/host_model_route_bridge.py`](backend/app/desktop_runtime/host_model_route_bridge.py:52) 都显式维护 `providerProfileId`、`provider`、`endpointType`、`baseUrl`、`modelId` 这套字段。

这些重复规则已经带来两个直接问题。第一，任何 provider 扩展都要横跨前端设置页、聊天页、Electron 宿主、Python runtime 多处同步修改。第二，不同链路的概念粒度并不一致，`provider`、`protocol`、`endpointType`、`modelId` 经常混用，后续很难继续稳定扩展。

### 设置页已放开多个 provider，聊天主链仍主要受限于 openai-compatible 风格路由

设置页表面上已经允许用户配置多个 provider 或 protocol。[`frontend-copilot/src/workbench/settings/config.ts`](frontend-copilot/src/workbench/settings/config.ts:17) 的枚举已经包含 OpenAI、Gemini、Anthropic、Ollama 等选项。

真实聊天主链仍主要受限于 [`openai-compatible`](frontend-copilot/src/features/copilot/model-picker.ts:39) 风格路由。前端模型选择器只把 `openai-compatible` 视为当前流式聊天的可用端点，后端执行器也只认可同一组 endpoint 类型。这样一来，设置页展示出的“多 provider 可选”与聊天发送链路的“单一路径可运行”之间出现了明显落差。

这个落差还体现在路由表达方式上。当前聊天链路与宿主解析链路都倾向于先把 provider 压成 `endpointType`，再让后端按 endpoint 执行。这样虽然可以短期兼容 openai-compatible，但它无法准确表达“Groq 与 Mistral 都可能复用 openai-compatible 传输层，却仍是不同 provider”的事实，也不利于后续接入 Anthropic、Gemini、Ollama 这类原生语义不同的 provider。

### 默认模型目前只保存字符串，已经存在同名 modelId 的歧义风险

设置持久层当前把默认模型保存为纯字符串。[`frontend-copilot/electron/settings-workspace/state-schema.ts`](frontend-copilot/electron/settings-workspace/state-schema.ts:24) 中的 `defaultModelRouting.primaryAssistantModel` 与 [`fastAssistantModel`](frontend-copilot/electron/settings-workspace/state-schema.ts:26) 都是字符串字段。

同一时期，provider profile 自身的默认模型也仍是字符串字段。[`frontend-copilot/src/workbench/types.ts`](frontend-copilot/src/workbench/types.ts:114) 定义的 `ProviderProfile` 中，`defaultModel`、`fastModel`、`fallbackModel` 都直接保存 `modelId` 字符串。

聊天页在选择默认模型时也会按纯 `modelId` 回退匹配。[`frontend-copilot/src/features/copilot/model-picker.ts`](frontend-copilot/src/features/copilot/model-picker.ts:201) 的 [`resolveCopilotPreferredModelId()`](frontend-copilot/src/features/copilot/model-picker.ts:201) 在找不到精确 `id` 时，会继续按 `model.modelId === preferredModelId` 命中模型。

一旦多个 profile 下出现同名 `modelId`，例如多个 provider 都有 `gpt-4.1`、`llama-3.3-70b` 或 `sonnet` 风格命名，当前默认模型就会缺少稳定锚点。系统此时很难确定字符串究竟对应哪个 profile，也无法保证迁移与恢复时还能选回同一条路由。

## 目标与非目标

### 目标

1. 系统要构建完全数据驱动的 provider 描述体系，并让设置页、聊天链路、宿主解析链路、后端执行链路消费同一套 provider 语义。
2. 首批需要真正打通的 provider 包括 OpenAI、Anthropic、Gemini、Ollama、Groq、Mistral。这六类 provider 要覆盖基础聊天与流式主链。
3. 其余 PydanticAI provider 在这一轮先做到数据模型兼容与扩展点兼容。它们可以先进入 catalog 与 profile 体系，但不要求立即完成运行时接入。
4. 首批 provider 在设置页首版只要求四类核心信息：API Key、可选 Base URL、模型列表、默认模型。
5. 更复杂的认证方式、区域参数、组织参数、项目级凭据等信息要在数据模型中预留扩展位，但首版 UI 不承担这些高级配置。
6. 默认模型与聊天选中模型要升级为稳定 route 引用，而不是继续依赖单个字符串 `modelId`。
7. thinking 能力的查询与最终校验要继续收敛到运行时 resolved route，并与 [`docs/plans/2026-04-04-thinking-parameter-adjustment-design.md`](docs/plans/2026-04-04-thinking-parameter-adjustment-design.md) 保持一致。

### 非目标

1. 这一轮不要求所有 provider 一次性提供完整的高级参数 UI。
2. 这一轮不要求把所有 provider 差异完全塞进纯静态配置。少量运行时 adapter 仍然保留，而且它们是必要设计。
3. 这一轮不要求所有 catalog 中出现的 provider 都立即可运行。
4. 这一轮不要求重写整个设置页框架、聊天会话模型或工具系统。

## 总体架构

### 单一事实源

provider 的非敏感元数据应收敛到单一 catalog。推荐新增 [`provider-catalog/registry.json`](provider-catalog/registry.json) 与约束文件 [`provider-catalog/schema.json`](provider-catalog/schema.json)。

这套 catalog 只保存非敏感信息，例如：

- `providerId` 与展示名称。
- 传输语义或协议族。
- 运行时启用状态。
- 默认认证方式与可选认证扩展位。
- Base URL 是否允许用户覆盖。
- 模型列表的编辑策略与最小字段约束。
- 对应的运行时 adapter 标识。
- 对 UI 有帮助但不涉及秘密信息的能力描述。

catalog 不保存任何用户秘密信息，也不保存会被用户编辑的 profile 实例数据。

### 分层原则

这次重构采用“三层稳定源 + 一层运行时解析 + 少量 adapter”的结构。

| 层次 | 真相来源 | 主要内容 | 主要消费者 |
| --- | --- | --- | --- |
| provider 元数据层 | [`provider-catalog/registry.json`](provider-catalog/registry.json) | provider 身份、协议族、运行时状态、UI 约束、adapter 绑定。 | 设置页、聊天页、宿主 resolver、后端 runtime。 |
| provider profile 实例层 | 设置状态文档与 secret 文档 | 用户创建的 profile、Base URL、模型列表、默认模型、认证输入。 | 设置页、宿主 resolver。 |
| 默认路由层 | 设置状态文档 | 稳定 route 引用，例如 `routeKind + profileId + modelId`。 | 聊天入口、agent 默认模型选择。 |
| 运行时 route snapshot 层 | 宿主解析结果 | 稳定引用段与解析结果段，外加运行时私有 auth 数据。 | 聊天 run、thinking 查询、Python runtime。 |
| provider adapter 层 | 后端注册表 | 构造 PydanticAI provider/model，并映射 request options 与 thinking 参数。 | Python runtime。 |

### 统一 route 语义

统一后的 route 语义要明确区分三件事。

1. `providerId` 表示稳定的 provider 身份，例如 `openai`、`anthropic`、`gemini`、`ollama`、`groq`、`mistral`。
2. `endpointType` 表示运行时传输语义，例如 `openai-compatible`、`anthropic-native`、`gemini-native`、`ollama-native`。
3. `profileId` 表示用户创建的具体配置实例，同一 `providerId` 下可以存在多个 profile。

这样一来，Groq 与 Mistral 即使都走 openai-compatible 传输层，系统也仍然知道它们是不同 provider。Anthropic、Gemini、Ollama 这类原生 provider 也可以直接表达自己的 endpoint 语义，不需要继续被“压扁”成开放式字符串映射。

### 统一后要消除的硬编码位置

重构完成后，设置页不再在 [`frontend-copilot/src/workbench/settings/config.ts`](frontend-copilot/src/workbench/settings/config.ts:17) 这类位置手写 provider 选项。聊天、宿主、后端也不再各自维护 provider 枚举与 endpoint 规则。

具体要求如下。

1. 设置页根据 catalog 动态生成 provider 创建菜单、字段约束与展示文案。
2. 聊天页根据 profile + catalog 组装模型选项，不再自行拼写 `provider === 'openai' ? 'openai-compatible' : provider` 这类规则。
3. 宿主 resolver 不再重复维护 provider 枚举，而是根据 profile 绑定的 `providerId` 与 catalog 解析 route。
4. 后端执行器不再把 `OpenAIProvider` 视为默认通路，而是先按 `providerId` 找到 adapter，再决定使用哪一种 PydanticAI provider/model。

## 组件划分与数据模型

### provider 元数据层

provider 元数据层由 catalog 驱动，目标是让设置页、聊天页、宿主 resolver、后端 runtime 使用同一份 provider 描述。

建议每个 provider 条目至少包含下列字段。

| 字段 | 作用 |
| --- | --- |
| `providerId` | 提供稳定 provider 身份。 |
| `displayName` | 提供设置页与聊天页展示名称。 |
| `endpointType` | 提供运行时默认传输语义。 |
| `runtimeStatus` | 标记 `enabled`、`catalog-only`、`legacy-unsupported` 这类状态。 |
| `adapterId` | 标记后端应该绑定哪个 adapter。 |
| `authSchema` | 标记当前 provider 需要哪些认证输入，首批至少支持 `api-key`。 |
| `baseUrlPolicy` | 标记 Base URL 是固定、可选覆盖还是必填输入。 |
| `modelConfigPolicy` | 标记模型列表是否允许用户编辑，以及默认模型字段的约束。 |
| `capabilityHints` | 提供非权威的 provider 级提示信息，例如工具、流式、视觉等大类能力。 |

首批真正打通的 provider 在 catalog 中应标记为 `enabled`。其余 PydanticAI provider 可以先以 `catalog-only` 进入 catalog，这样数据模型与 UI 创建入口都已经对齐，后续补 adapter 时不需要再改 schema。

### provider profile 实例层

provider profile 实例层表示用户真实创建的配置实例。它与 catalog 的关系是“实例引用元数据”，而不是复制一份 provider 描述。

这个层次需要明确拆分非敏感 profile 数据与 secret 数据。

#### 非敏感 profile 数据

非敏感 profile 数据建议至少包含下列字段。

| 字段 | 作用 |
| --- | --- |
| `profileId` | 作为实例主键，替代当前容易混淆 provider 身份与实例身份的 `id`。 |
| `providerId` | 指向 catalog 中的 provider 条目。 |
| `displayName` | 提供用户可读名称。 |
| `baseUrl` | 保存用户可选覆盖的 Base URL。 |
| `models` | 保存该 profile 下可选模型列表。 |
| `defaultModelId` | 保存该 profile 的默认模型。 |
| `compatibility` | 标记该 profile 当前是 `active`、`legacy` 还是 `unsupported`。 |
| `extensions` | 预留未来区域、组织、项目、额外 headers 等非敏感扩展字段。 |

首版设置页只要求用户编辑 API Key、可选 Base URL、模型列表与默认模型。`extensions` 字段先作为数据模型预留位，不进入首版 UI。

#### secret 数据

secret 数据单独保存在 secret 文档中，按 `profileId` 索引。首版虽然只需要 API Key，但 secret 模型要能够容纳未来更复杂的认证方式。

建议 secret 数据遵循统一 envelope，至少表达下面三层信息。

1. `profileId` 用来定位对应的 profile。
2. `authKind` 用来声明当前 secret 的认证种类，例如 `api-key`、`oauth-token`、`service-account`。
3. `secretValues` 用来保存具体凭据。首版实际只需要 `apiKey`，后续可以扩展更多键。

这样可以避免再次把“只有 API Key”硬编码进整个状态模型。

### 默认路由层

默认路由层用于保存“主助手默认模型”“快速助手默认模型”这类长期偏好。这个层次需要从当前字符串模型升级为稳定 route 引用对象。

推荐最小结构如下。

```json
{
  "routeKind": "provider-model",
  "profileId": "profile-openai-main",
  "modelId": "gpt-4.1"
}
```

字段含义需要保持克制。

1. `routeKind` 为未来扩展预留路由类别，目前首版可以固定为 `provider-model`。
2. `profileId` 明确指向具体 provider profile。
3. `modelId` 明确指向该 profile 下的模型条目。

`providerId`、`endpointType`、流式支持、thinking 能力等信息都应从 `profile + catalog` 推导，而不进入这个稳定引用对象。这样可以让默认路由保持稳定，同时避免把本可推导的信息重复保存进设置状态。

### 运行时 route snapshot 层

运行时 route snapshot 层负责区分“稳定引用段”和“解析结果段”。这两部分不能继续混在一起。

建议把运行时路由拆成两段。

#### 稳定引用段

稳定引用段与默认路由对象保持同构，最小只包含 `routeKind`、`profileId`、`modelId`。这段数据适合写入设置、会话草稿与跨端请求。

#### 解析结果段

解析结果段由宿主 resolver 在运行时生成，至少包含下列信息。

| 字段 | 作用 |
| --- | --- |
| `providerId` | 标记真实 provider 身份。 |
| `endpointType` | 标记真实传输语义。 |
| `baseUrl` | 标记最终生效的 Base URL。 |
| `modelId` | 标记最终模型。 |
| `adapterId` | 标记后端应使用的 adapter。 |
| `runtimeStatus` | 标记当前 route 是否可运行。 |
| `catalogRevision` | 作为可选字段，用于诊断和缓存失效。 |

运行时私有数据还需要再加一层，只在宿主与后端之间传输，例如：

- `authKind`
- `authPayload`
- 未来可能需要的 region 或组织级凭据

这层私有数据不回写设置，不进入公开 snapshot，也不进入聊天页的持久化状态。

### provider 适配器层

provider 适配器层由后端按 `providerId` 注册。每个 adapter 负责把统一 route 语义翻译成具体执行语义。

每个 adapter 至少承担四类职责。

1. adapter 需要根据 `providerId + resolved route + secret` 构造对应的 PydanticAI provider 与 model。
2. adapter 需要声明基础聊天与流式主链是否可用，并把不满足条件的 route 在运行前拦住。
3. adapter 需要把 thinking、temperature、tools、结构化输出等 request options 映射到上游 provider 需要的格式。
4. adapter 需要把常见 provider 错误归一化成稳定的运行时错误类型，方便前端展示与测试覆盖。

这里保留少量运行时 adapter 是有意设计。catalog 负责描述 provider，adapter 负责执行 provider。两者职责不同，不应该混在一起。

## 端到端数据流

### 设置页编辑与保存

1. 设置页启动时先加载 catalog、settings state 与 secret 状态。
2. 设置页根据 catalog 动态生成 provider 创建入口、字段标签、认证要求与 Base URL 规则，不再依赖手写 `protocolOptions`。
3. 用户编辑 profile 时，非敏感字段写入 settings state，secret 字段写入 secret 存储，两者继续分离。
4. 用户编辑模型列表与默认模型时，设置页保存的是 `profileId + modelId` 关系，不再只保存单个模型字符串。
5. 设置持久层只保存稳定引用和用户输入，不保存任何可由 catalog 推导出的 provider 能力。

### 聊天页装配与模型选择

1. 聊天页根据 `profile + catalog` 组装模型目录，而不是从 profile 里直接推断 provider 枚举。
2. 每个模型选项都绑定稳定 route 引用，默认模型选择也只按 route 引用匹配，不再按裸 `modelId` 回退。
3. 聊天页可以展示 catalog 提供的能力提示，但这些提示只作为 UI 信息，不是运行时权威结论。
4. 当 provider 的 `runtimeStatus` 不是 `enabled` 时，聊天页必须把对应模型标记为禁用，并给出明确原因。

### 宿主 route 解析

1. 聊天发送时，前端向宿主提交稳定 route 引用，而不是拼接一份带 `provider`、`endpointType`、`baseUrl` 的手写 snapshot。
2. 宿主 resolver 读取 profile、catalog 与 secret，验证 `profileId`、`providerId`、`modelId` 与认证输入是否有效。
3. 宿主 resolver 生成运行时 route snapshot，包括公开的解析结果段与私有的 auth 段。
4. 宿主 resolver 还需要在这里完成“当前 provider 是否已启用”“当前 adapter 是否已注册”“当前模型是否属于该 profile”这类前置校验。

### Python runtime 执行

1. Python runtime 通过宿主桥拿到 resolved route，而不是自己再去解释设置页 protocol。
2. runtime 按 `providerId` 查找 adapter，并由 adapter 构造真正的 PydanticAI provider/model。
3. OpenAI、Anthropic、Gemini、Ollama、Groq、Mistral 六类 provider 在首批都要覆盖基础聊天与流式主链。
4. 其余 catalog-only provider 在没有 adapter 时不得进入真实发送链路。

### thinking 能力查询与最终校验

thinking 设计继续以运行时 resolved route 为锚点，与 [`docs/plans/2026-04-04-thinking-parameter-adjustment-design.md`](docs/plans/2026-04-04-thinking-parameter-adjustment-design.md) 保持一致。

推荐的数据流如下。

1. 聊天页在 route 选中后，可以根据当前 resolved route 请求 thinking 能力快照，用于 UI 展示。
2. 这份能力快照应由后端 adapter 或运行时能力解析层产出，不能回退为前端本地硬编码判断。
3. 用户真正发送消息时，后端必须再次基于当前 resolved route 做最终校验，避免 UI 缓存过期后继续发送。
4. 设置持久层不保存 thinking 能力。thinking 能力属于可推导的运行时信息，应随 catalog、profile 与 adapter 重新计算。

## 错误处理与能力降级

### 四层错误边界

| 层级 | 主要职责 | 典型错误 |
| --- | --- | --- |
| 设置页层 | 负责用户输入校验与禁用态展示。 | Base URL 格式错误、模型列表为空、默认模型不存在、需要 API Key 但未填写。 |
| 宿主解析层 | 负责把稳定 route 引用解析为可执行 route。 | profile 不存在、provider 不存在、provider 处于 `legacy` 或 `catalog-only`、secret 缺失、adapter 未注册。 |
| 后端适配层 | 负责 provider 专属执行映射。 | provider 不支持流式、thinking 参数无法映射、结构化输出映射失败、adapter 构造 provider/model 失败。 |
| 上游调用层 | 负责承接真实 provider 返回的失败。 | 401/403、模型不存在、速率限制、配额耗尽、网络超时、上游服务不可用。 |

错误边界之间需要保持职责清楚。设置页负责阻止明显无效的输入，宿主 resolver 负责阻止不可执行 route，后端 adapter 负责阻止不被当前 provider 支持的执行参数，上游错误则由运行时统一归一化后上报。

### 首批真实打通 provider 的能力要求

对 OpenAI、Anthropic、Gemini、Ollama、Groq、Mistral 六类首批 provider，最低要求如下。

1. 基础聊天链路要可用。
2. 流式主链要可用。
3. thinking 能力允许按 provider 与 model 维度差异化实现。
4. 即使某个 provider 或 model 不支持 thinking，也不能影响普通聊天主链。

### 暂未真实打通 provider 的降级方式

对暂未真实打通的 provider，设置页仍然允许配置与保存。这样可以保证数据模型完整，也能为后续接入保留用户输入。

聊天页在面对这类 provider 时要明确展示“当前运行时未启用”状态，并阻止用户把它当作可发送模型误选进去。禁用态可以出现在模型列表、默认模型选择器或详情面板中，但系统不能等到发送时才让请求失败。

## 迁移与兼容策略

### settings schema 需要版本迁移

当前 settings state 版本仍然停留在 [`SETTINGS_WORKSPACE_STATE_DOCUMENT_VERSION`](frontend-copilot/electron/settings-workspace/state-schema.ts:12) 的旧结构上。provider 重构落地时，settings schema 需要同步升级，并增加显式 migrator。

### 迁移原则

迁移遵循两条原则。

1. 系统在能够确定映射关系时执行自动迁移。
2. 系统在无法确定映射关系时显式失效，并要求用户重新选择。

尤其是默认路由迁移不能猜测。只要历史字符串默认模型存在多义性，迁移就要把该默认路由标记为无效，并提示用户重新选择。

### 建议迁移顺序

1. 先把旧的 provider profile 转成新的 `profileId + providerId + models + defaultModelId` 结构。
2. 再把 secret 从旧的 `providerId -> apiKey` 映射迁移到新的 `profileId -> auth envelope` 结构。
3. 最后把 `primaryAssistantModel` 与 `fastAssistantModel` 从字符串迁移为稳定 route 引用。

### 默认路由迁移规则

默认路由迁移可以按下列顺序尝试。

1. 若字符串能在单个 profile 下唯一命中一个 `modelId`，系统可以自动迁移。
2. 若字符串能在多个 profile 下命中同名 `modelId`，系统必须判定为歧义并失效。
3. 若字符串根本命不中任何模型，系统必须判定为失效并要求用户重选。
4. 若旧配置只能说明 protocol，却不能唯一映射到新的 `providerId`，系统也要判定为失效。

### legacy 与 unsupported provider 的保留策略

catalog 中暂不支持的历史 provider 不能直接丢弃。系统需要保留原始 profile 数据，并把它们标记为 `legacy` 或 `unsupported`。

推荐保留策略如下。

1. 系统保留用户原始 profile 的非敏感字段与 secret 索引关系。
2. 系统在 profile 的 `compatibility` 字段中标记当前状态，并保存失效原因。
3. 系统在聊天链路中禁用这类 profile，但继续允许用户在设置页查看、复制或手动迁移数据。

这样可以避免用户数据丢失，也能给后续补 catalog 或补 adapter 留出空间。

## 测试策略

### catalog/schema 测试

catalog/schema 测试负责保证 provider 元数据本身稳定可依赖。

1. 测试需要校验 [`provider-catalog/registry.json`](provider-catalog/registry.json) 满足 [`provider-catalog/schema.json`](provider-catalog/schema.json) 约束。
2. 测试需要校验 `providerId`、`adapterId`、`runtimeStatus` 等关键字段唯一且合法。
3. 测试需要校验首批 `enabled` provider 至少包含 OpenAI、Anthropic、Gemini、Ollama、Groq、Mistral。
4. 测试需要校验 `catalog-only` provider 可以通过 schema，但不会被误判为运行时已启用。

### 设置页测试

设置页测试负责保证 UI 真正改为数据驱动。

1. 测试需要校验 provider 创建菜单与字段定义来自 catalog，而不是来自手写枚举。
2. 测试需要校验 API Key、Base URL、模型列表与默认模型的首版编辑流程。
3. 测试需要校验默认模型保存的是稳定 route 引用，而不是字符串 `modelId`。
4. 测试需要校验 `catalog-only` 与 `legacy` provider 在设置页中的展示、禁用与提示文案。

### 宿主解析测试

宿主解析测试负责保证 route 引用能够稳定转成 resolved route。

1. 测试需要覆盖 profile 不存在、provider 不存在、模型不存在、secret 缺失、runtime disabled、adapter missing 等失败路径。
2. 测试需要覆盖 Base URL 归一化、模型归属校验、public/private route 数据分离。
3. 测试需要保证宿主解析结果不泄露 secret。

### 后端适配测试

后端适配测试负责保证每个已启用 provider 都能正确构造运行时执行对象。

1. 测试需要逐个覆盖 OpenAI、Anthropic、Gemini、Ollama、Groq、Mistral 的 adapter。
2. 测试需要校验 adapter 构造的 PydanticAI provider/model 是否符合对应 provider 语义。
3. 测试需要校验 thinking 与 request options 的映射逻辑。
4. 测试需要校验不支持流式或不支持 thinking 的 provider/model 会被清晰拒绝，而不会静默降成另一种行为。

### 聊天前端测试

聊天前端测试负责保证聊天页只消费统一 route 语义。

1. 测试需要校验模型选择器按稳定 route 引用工作，不再按裸 `modelId` 兜底。
2. 测试需要校验 `enabled` 与 `catalog-only` provider 在聊天页的可选态与禁用态。
3. 测试需要校验 thinking 能力展示来自运行时查询结果，而不是本地 endpoint 枚举。
4. 测试需要校验用户无法把未启用 provider 选为可发送模型。

### 端到端测试与 live test 分层

端到端测试与 live test 需要分层设计。

1. 端到端测试覆盖“设置保存 → 宿主解析 → runtime 执行 → 聊天回显”完整主链，但默认使用可控桩件，不依赖真实上游 provider。
2. live test 只对首批真实打通 provider 开放，并且要求显式凭据与显式开关。
3. live test 至少覆盖基础聊天与流式主链；thinking live test 只对当前声明支持的 provider/model 开启。
4. 未启用 provider 不进入 live test 主矩阵，只保留 schema、设置页与 resolver 级别测试。

## 设计结论

这次 provider 重构的核心不在于继续补一组新的 provider 枚举，而在于把 provider 支持从“多处重复推断”收敛到“单一 catalog + profile 实例 + 稳定 route 引用 + 运行时 adapter”这条主线。

设计落地后，设置页、聊天页、宿主 resolver、Python runtime 将围绕同一套 provider 语义协作。首批六类 provider 进入真实可运行状态，其余 PydanticAI provider 先纳入统一数据模型与扩展点。这样后续新增 provider 时，系统就能围绕 catalog 与 adapter 两个稳定入口扩展，而不必继续在多条链路里重复散落硬编码。

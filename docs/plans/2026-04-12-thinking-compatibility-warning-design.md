# Thinking Compatibility Warning Design

## 背景

当前设置页的模型编辑器允许用户在配置模型时声明思考能力与推理系列，但部分 provider 与 endpointType 组合实际上并不兼容某些 thinking series。现状下，用户在配置阶段不会收到任何提示，只有在后续实际发送消息时才会因为运行时不兼容而失败。

这会带来两个明显问题：

- 用户在设置阶段缺少风险感知，容易误以为配置已正确生效。
- 问题暴露时机过晚，错误出现在发送消息链路，而不是更接近配置动作本身的位置。

本次修复目标是提供一个轻量、非阻塞的前端提醒，在高风险组合被选中时尽早提示用户，但不把本次范围扩展为严格校验或后端兼容性治理。

## 问题定义

在 [`ProviderModelEditorDialog`](frontend-copilot/src/workbench/settings/ProviderModelEditorDialog.tsx:157) 中，用户可以在“思考能力”设置为已支持后继续选择“推理系列”。当前交互没有对 provider、endpointType 与 thinking series 之间的潜在风格不匹配做任何前置判断。

因此会出现以下问题：

- 用户可以保存一个看起来合法、但实际高风险的 thinking 配置。
- 风险信号在设置页缺失，错误延迟到运行时才暴露。
- 兼容性判断逻辑若未来直接散落在组件中，会增加维护成本并降低可测试性。

## 目标

本次设计的目标如下：

1. 当用户在设置页模型编辑弹窗中开启思考能力，并选择了对当前模型服务看起来可能不兼容的 thinking series 时，显示一条小号橙色文本提示：`⚠ 当前模型可能不支持此类思考模式`。
2. 提示展示位置位于“思考能力 / 推理系列”区域下方，紧贴该配置语义范围，确保用户在选择时即可注意到风险。
3. 兼容性判断仅依赖前端当前已有信息，包括 provider、endpointType 与当前选择的 thinking series，不新增接口。
4. 将判断逻辑收敛为前端 helper，由组件消费轻量结果，避免在组件内部堆积复杂条件分支。
5. 增加至少一层测试，覆盖明显不兼容组合会提示、明显兼容组合不提示的核心行为。

## 非目标

以下内容明确不在本次范围内：

- 不新增后端接口或配置元数据来源。
- 不尝试实现严格、权威、可完全防错的兼容性校验。
- 不阻止保存，不修改字段值，不改变关闭弹窗、恢复已有配置或表单提交流程。
- 不重构现有思考能力编辑器整体结构。
- 不处理所有未来可能出现的 provider 专有规则，只提供基于当前信息的高风险前置提醒。

## 用户体验设计

### 提示位置

提示放置在设置页模型编辑弹窗 [`ProviderModelEditorDialog`](frontend-copilot/src/workbench/settings/ProviderModelEditorDialog.tsx:157) 的“思考能力 / 推理系列”区域下方，属于该区域内的补充说明信息，而不是全局错误提示。

推荐将提示渲染在现有 thinking 配置块附近，使其与当前选择直接关联，避免用户需要扫描到弹窗其他区域才能理解原因。

### 触发条件

提示仅在以下条件同时满足时出现：

- 用户已将“思考能力”设置为开启或已支持状态。
- 当前存在已选中的 thinking series。
- 前端本地规则判断该 series 与当前 provider / endpointType 组合存在明显跨风格不匹配，或虽然无法严格确认但属于高风险组合。

如果 thinking capability 未开启、series 未选择、或判断结果为兼容 / 通用兼容 / 低风险，则不展示提示。

### 展示形式

提示采用轻量提醒样式：

- 文案固定为：`⚠ 当前模型可能不支持此类思考模式`
- 视觉上为小号橙色文本
- 语义为提示而非报错，不附带阻塞操作

这种形式与本次修复的产品定位一致：帮助用户提前识别风险，但不把不确定判断误包装成硬性错误。

## 判断规则设计

### 总体原则

判断逻辑采用前端本地“风险判断”，重点是提前暴露高风险组合，而不是追求严格正确的最终裁决。规则应尽量覆盖常见场景，但必须以当前前端已可获取的信息为边界。

### 输入信息

helper 的输入建议至少包含以下信息：

- 当前模型所属 provider
- 当前模型的 endpointType
- 当前选择的 thinking series
- 当前 thinking capability 是否为支持状态

其中，provider 与 endpointType 共同代表模型服务侧的风格特征，thinking series 代表用户所选思考模式的风格类型。

### thinking series 轻量分类

在进行 provider / endpointType 匹配之前，先对 thinking series 做轻量分类。分类目标不是精细枚举全部系列，而是为兼容判断提供较稳定的中间语义层。建议包含以下类别：

- OpenAI 风格系列
- Anthropic 风格系列
- 通用兼容系列
- 未知或自定义系列

该分类层的作用有两点：

- 降低组件或最终判断函数对具体 series 名称枚举的耦合程度
- 为未来新增系列时提供统一扩展点

### provider / endpointType 匹配策略

在 series 分类完成后，再与当前 provider / endpointType 做风险匹配：

- 当 series 分类与当前 provider / endpointType 的主风格明显跨类型时，判定为应提示。
- 当 series 属于通用兼容类型时，不提示。
- 当 series 属于未知或自定义类型，且当前 provider / endpointType 无法形成稳定兼容判断时，可按高风险处理并提示。
- 当 provider / endpointType 本身无法完全识别，但已知当前 series 更偏特定供应商风格时，也应倾向提示而不是静默放过。

这样可以确保规则偏保守地暴露风险，但仍避免对通用兼容场景造成过多误报。

### 输出结果

helper 输出应保持轻量，组件层只消费展示相关结果。例如：

- 是否显示警告
- 固定警告文案
- 可选的内部 reason 或 category 供测试断言或后续扩展使用

其中面向组件的核心契约应尽量简单，避免把规则细节泄漏到视图层。

## 实现落点

### helper 收敛

兼容性判断应封装在前端 helper 中，而不是直接写在 [`ProviderModelEditorDialog`](frontend-copilot/src/workbench/settings/ProviderModelEditorDialog.tsx:157) 内部。推荐的结构结论如下：

- helper 负责接收 provider、endpointType、thinking capability 状态与 selected series。
- helper 内部完成 series 分类与风险匹配。
- helper 返回统一、轻量、可测试的判断结果。

这样做有三个直接收益：

- 组件层只负责展示，不承载复杂业务判断。
- 规则演进时只需调整 helper 与测试，不必反复修改弹窗渲染逻辑。
- 单元测试可以直接围绕 helper 建立，降低 UI 测试覆盖所有分支的负担。

### 组件接入

[`ProviderModelEditorDialog`](frontend-copilot/src/workbench/settings/ProviderModelEditorDialog.tsx:157) 中的接入职责应保持最小化：

- 在已有 thinking capability 与 selected series 的派生数据基础上，调用 warning helper。
- 若 helper 返回需要提示，则在“思考能力 / 推理系列”区域下方渲染固定橙色提示文案。
- 不影响任何已有字段更新、保存按钮状态、关闭行为或表单提交流程。

### 测试落点

测试至少分为两层中的一层，优先保证 helper 可直接验证；若现有测试结构方便，也可补充组件级展示断言：

- helper 单元测试：覆盖明显不兼容组合、明显兼容组合、通用兼容组合、未知高风险组合。
- 组件测试：覆盖提示在目标区域展示，且不影响保存与关闭等交互流程。

## 测试与验收

### 验收标准

本次修复完成后，应满足以下验收条件：

- 明显可能不兼容的 provider / endpointType 与 thinking series 组合会显示橙色提示。
- 明显兼容或低风险组合不显示提示。
- 提示仅影响展示，不影响保存、关闭弹窗、已有配置恢复或表单提交流程。
- 兼容性规则集中在 helper 中，组件不承担复杂兼容判断。
- 至少补一层测试，验证明显不兼容组合会提示，明显兼容组合不提示。

### 建议测试矩阵

建议最少覆盖以下场景：

1. 已开启 thinking capability，选择明显跨风格 series，显示提示。
2. 已开启 thinking capability，选择与 provider / endpointType 风格一致的 series，不显示提示。
3. 已开启 thinking capability，选择通用兼容 series，不显示提示。
4. 已开启 thinking capability，选择未知但高风险的 series，显示提示。
5. 未开启 thinking capability，即使存在其他字段值，也不显示提示。
6. 显示提示时仍可正常保存与关闭弹窗。

## 风险与后续

### 已知风险

本次规则是“前端风险提示”而不是严格校验，因此存在以下已知风险：

- 可能出现少量误报，即某些实际可用组合被提示为高风险。
- 也可能存在漏报，即部分兼容性问题仍然只会在运行时暴露。
- 未知自定义 series 的判断只能基于保守策略，无法做到权威结论。

这些风险是本次范围选择下的可接受权衡，因为核心目标是把最明显、最常见的高风险组合提前暴露。

### 后续演进方向

若未来需要进一步完善，可沿以下方向扩展：

- 将 helper 中的分类规则与 provider / endpointType 映射提炼为更集中、可配置的数据结构。
- 当后端或 provider catalog 提供更权威兼容元数据时，再逐步替换本地启发式判断。
- 在提醒效果稳定后，再评估是否需要对极高风险组合增加更强提示或保存前确认。

## 结论

本设计采用“本地启发式判断 + 非阻塞橙色提醒”的最小修复策略，在不改变现有保存和提交流程的前提下，将高风险 thinking series 组合的风险暴露时机从运行时前移到设置阶段。

后续实现应优先坚持两个结构约束：

1. 兼容性判断集中在 helper 中，组件仅消费轻量结果。
2. 提示为展示层提醒，不升级为表单校验或流程拦截。

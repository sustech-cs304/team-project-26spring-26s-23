# Thinking Compatibility Warning Implementation Plan

## 实施目标与范围

本次实施仅交付一个轻量前端预警：当用户在设置页模型编辑弹窗中，将思考能力声明为支持，并选择了对当前模型服务看起来可能不兼容的 thinking series 时，在思考能力 / 推理系列区域下方展示固定文案 `⚠ 当前模型可能不支持此类思考模式`。

本次实现必须满足以下边界：

- 只基于前端当前已有数据做本地风险判断，不新增接口、不依赖运行时探测。
- 判断逻辑集中在 helper 中，组件层只消费轻量结果并负责展示。
- 提示属于非阻塞提醒，不影响保存、关闭弹窗、已有字段编辑、恢复已有配置或提交流程。
- 至少补一层测试，覆盖明显不兼容与明显兼容两个核心场景。

## 受影响文件与模块清单

### 直接修改目标

- [`frontend-copilot/src/workbench/settings/ProviderModelEditorDialog.tsx`](frontend-copilot/src/workbench/settings/ProviderModelEditorDialog.tsx)
  - 接入 warning helper。
  - 在思考能力 / 推理系列区域下方增加提示渲染。
  - 保持现有字段更新、保存按钮状态、关闭逻辑不变。
- [`frontend-copilot/src/workbench/settings/ProviderModelEditorDialog.test.tsx`](frontend-copilot/src/workbench/settings/ProviderModelEditorDialog.test.tsx)
  - 增补组件展示测试，验证提示出现 / 不出现，必要时补一条“不影响保存”的行为断言。

### 新增 helper 候选文件

- [`frontend-copilot/src/workbench/settings/thinking-compatibility-warning.ts`](frontend-copilot/src/workbench/settings/thinking-compatibility-warning.ts)
  - 集中封装 series 分类、provider 风格识别、风险判断与返回结果。
- [`frontend-copilot/src/workbench/settings/thinking-compatibility-warning.test.ts`](frontend-copilot/src/workbench/settings/thinking-compatibility-warning.test.ts)
  - 优先承载 helper 单元测试，避免大量兼容性分支压到 UI 测试中。

### 参考但不修改的上下文文件

- [`frontend-copilot/src/workbench/thinking-capabilities.ts`](frontend-copilot/src/workbench/thinking-capabilities.ts)
  - 提供当前 thinking series 预设清单，可作为 helper 识别系列类别的主要输入来源。
- [`frontend-copilot/src/workbench/settings/provider-profiles.ts`](frontend-copilot/src/workbench/settings/provider-profiles.ts)
  - 确认模型编辑状态与 provider profile 的数据来源，帮助实现方判断如何把 provider / endpointType 传入 helper。

## 实施步骤

### 1. 明确 helper 的输入契约

先定义一个面向组件的最小输入结构，建议包含：

- 当前 provider 标识，例如 `providerId` 或等价字段。
- 当前 endpointType 或可替代其风格识别的字段。
- 当前 thinking capability 是否处于 `supported` 状态。
- 当前已选 thinking series。

如果 [`ProviderModelEditorDialog`](frontend-copilot/src/workbench/settings/ProviderModelEditorDialog.tsx) 现有 props 不能直接拿到 provider / endpointType，需要在不扩大范围的前提下，从现有编辑态或挂载层补齐必要只读信息；计划实现时应优先复用已有状态来源，不新增远程依赖。

### 2. 设计 helper 返回结构

helper 输出保持轻量，建议固定为一个简单对象：

- `shouldWarn`: 是否展示提示。
- `message`: 固定返回 `⚠ 当前模型可能不支持此类思考模式`，或由组件使用常量文案。
- `reason`: 可选内部原因码，供测试断言与未来调试使用。
- `seriesCategory`: 可选分类结果，帮助测试覆盖与后续扩展。

组件层只依赖 `shouldWarn`，其余字段不参与 UI 分支扩散。

### 3. 按顺序拆解 helper 内部规则

建议严格按以下顺序实现，减少条件散落：

1. 先做前置短路：
   - thinking capability 不是 `supported` 时直接不提示。
   - 未选择 series 时直接不提示。
2. 对 series 做轻量分类：
   - OpenAI 风格。
   - Anthropic 风格。
   - 通用兼容风格。
   - 未知 / 自定义风格。
3. 对 provider / endpointType 做风格归类：
   - OpenAI 风格服务。
   - Anthropic 风格服务。
   - 通用 / 多协议 / 无法稳定识别服务。
4. 做风险匹配：
   - 明显跨风格时提示。
   - 通用兼容 series 不提示。
   - 未知 / 自定义 series 在无法确认兼容时按高风险提示。
   - provider / endpointType 无法识别但 series 明显偏特定供应商风格时，倾向提示。
5. 返回轻量结果，不把具体判断细节泄漏到组件。

## helper 设计与规则拆解顺序

### series 分类建议

建议优先基于 [`frontend-copilot/src/workbench/thinking-capabilities.ts`](frontend-copilot/src/workbench/thinking-capabilities.ts) 中现有 preset id 做一层稳定映射，而不是在组件里直接枚举字符串：

- OpenAI 风格：如 `openai-6-level-superset-v1`、`openai-4-level-minimal-v1`、`openai-3-level-classic-v1`。
- Anthropic 风格：如 `anthropic-adaptive-max-v1`、`anthropic-budget-v1`。
- 通用兼容：如 `unified-4-level-v1`，以及需要被视作低风险的统一档位方案。
- 其他已知供应商特定风格：如 `qwen-thinking-switch-v1`、`deepseek-fixed-reasoning-v1`、`gemini-2.5-budget-v1`，可先归入各自供应商特定类别，最终在风险判断阶段按“非通用、偏特定风格”处理。
- 自定义 series：不在预设表中的值统一归入 `unknown`。

这里的关键不是覆盖完整 taxonomy，而是先把当前内置 preset 按“通用 / 特定风格 / 未知”分层，形成后续判断的中间语义层。

### provider / endpointType 风格识别建议

实现时应优先复用当前设置域已有 provider 标识，不引入 catalog 结构改造。建议按以下优先级识别：

1. 先看显式 provider 标识，如 `providerId`。
2. 若存在 endpointType，则作为补充风格信号。
3. 若两者都无法形成稳定判断，归为 `unknown` 或 `generic-service`。

推荐先仅支持最明显的风格识别：

- OpenAI 风格服务。
- Anthropic 风格服务。
- 其他特定服务风格，如 Gemini、Qwen、DeepSeek。
- 未知 / 自定义服务。

### 风险判断顺序建议

为了保持轻量且可解释，规则建议按保守优先顺序执行：

1. `thinking disabled` 或 `series missing` -> 不提示。
2. `seriesCategory = generic` -> 不提示。
3. `providerStyle` 与 `seriesCategory` 明显同风格 -> 不提示。
4. `providerStyle` 与 `seriesCategory` 明显跨风格 -> 提示。
5. `seriesCategory = unknown` 且服务风格不明或无法稳定匹配 -> 提示。
6. `providerStyle = unknown` 且 series 明显供应商特定 -> 提示。
7. 剩余不明确组合默认不升级为复杂校验，可按设计稿中的保守策略返回提示，但需避免把全部组合都打成风险。

## UI 落点与样式实现点

### 落点

提示必须落在 [`frontend-copilot/src/workbench/settings/ProviderModelEditorDialog.tsx`](frontend-copilot/src/workbench/settings/ProviderModelEditorDialog.tsx) 的思考能力 / 推理系列区域内部，紧跟该区域的系列选择与默认值编辑块之后，不能放到全局错误条或弹窗底部。

建议实现时：

- 在组件已有 `normalizedThinkingCapability`、`selectedSeriesOption` 等派生值附近计算 warning 结果。
- 在 thinking 配置块渲染末尾插入一段独立文本节点或说明容器。
- 仅在 `shouldWarn` 为 `true` 时渲染。

### 样式

本次样式不需要引入复杂视觉结构，保持为小号橙色文本即可。实现上建议：

- 优先复用当前设置页已有说明文案样式类；若无合适类，再新增一个局部 class。
- 控制为辅助说明层级，不使用错误红色，不加图标按钮，不加入交互行为。
- 保持和现有 thinking 配置块的垂直间距一致，避免挤压现有 pill、slider、select 的点击区。

### 可访问性与交互约束

- 提示只作为静态说明，不需要抢占焦点。
- 不绑定 `aria-live`、不引入弹出式 tooltip。
- 不改变保存按钮的可用状态，也不影响 `onSave`、`onClose`、`onStateChange`、`onToggleCapability` 的既有调用路径。

## 测试计划

### helper 单元测试

优先为新增 helper 建立单元测试，至少覆盖以下场景：

- 明显不兼容：OpenAI 风格服务 + Anthropic 风格 series -> `shouldWarn = true`。
- 明显兼容：OpenAI 风格服务 + OpenAI 风格 series -> `shouldWarn = false`。
- 通用兼容：任意已识别服务 + 通用兼容 series -> `shouldWarn = false`。
- 未知高风险：未知 / 自定义 series + 无法稳定识别服务 -> `shouldWarn = true`。
- capability 未开启：即使传入 series，也应 `shouldWarn = false`。

### 组件测试

在 [`frontend-copilot/src/workbench/settings/ProviderModelEditorDialog.test.tsx`](frontend-copilot/src/workbench/settings/ProviderModelEditorDialog.test.tsx) 至少补两类断言：

- 出现提示：构造一个明显跨风格组合，断言固定文案可见。
- 不出现提示：构造一个明显兼容或通用兼容组合，断言文案不存在。

如果当前测试装配成本可控，再补一条轻量回归断言：

- 提示出现时点击保存仍会调用 `onSave`，证明 UI 提示未阻塞流程。

## 风险与回归检查点

### 主要风险

- `ProviderModelEditorDialog` 当前是否直接持有 provider / endpointType 信息可能不足，若信息链路不完整，后续实现需要先做最小只读透传。
- 系列分类若直接硬编码在组件中，会违背设计约束并增加回归面。
- 若把未知场景全部判为风险，可能造成提示过度；若过于宽松，又会漏掉最明显风险。

### 回归检查点

实现后应重点检查以下内容：

- 打开 / 关闭模型编辑弹窗的行为不变。
- 修改 thinking series、budget mode、default value 仍按原路径回写状态。
- 提示只在思考能力支持且已选 series 时出现，不影响其他 capability 区域。
- 保存按钮、关闭按钮、Esc 关闭、点击遮罩关闭等既有行为不受影响。
- 现有关于 budget series、离散 series、默认值标签的测试不应被新提示破坏。

## 不在本次范围内

以下内容明确不纳入本次实现：

- 不新增后端兼容性接口、provider catalog 元数据或运行时探测。
- 不将 warning 升级为表单校验、阻止保存、禁用按钮或二次确认。
- 不重构整个 thinking capability 编辑器或重新设计 preset 数据结构。
- 不建立完整供应商兼容矩阵系统，只覆盖当前前端可判断的明显高风险组合。
- 不尝试保证所有自定义 series 的准确兼容性结论，只做保守预警。

## 建议实现顺序

1. 在新增 helper 文件中定义输入 / 输出类型、固定警告文案与分类函数。
2. 先完成 series 分类与 provider 风格识别，再补最终 `resolveThinkingCompatibilityWarning` 一类的聚合函数。
3. 先写 helper 单元测试，锁定明显兼容与明显不兼容规则。
4. 在 [`frontend-copilot/src/workbench/settings/ProviderModelEditorDialog.tsx`](frontend-copilot/src/workbench/settings/ProviderModelEditorDialog.tsx) 接入 helper，并把提示渲染到思考能力 / 推理系列区域下方。
5. 补组件测试，验证提示展示与非阻塞行为。
6. 最后做一次设置页回归检查，确认没有把本次轻量提醒扩展成流程级校验。

## 实施完成定义

当以下条件全部满足时，可认为本计划对应的实现完成：

- warning 逻辑集中在独立 helper 中，而非散落在 [`frontend-copilot/src/workbench/settings/ProviderModelEditorDialog.tsx`](frontend-copilot/src/workbench/settings/ProviderModelEditorDialog.tsx) 内。
- 设置页模型编辑弹窗会在目标区域内展示固定橙色提示文案。
- 明显不兼容组合会提示，明显兼容与通用兼容组合不提示。
- 提示不阻塞保存，也不改变现有编辑流程。
- 至少一层测试落地，且覆盖明显兼容 / 不兼容的核心行为。

---
title: UI 调试性 / 内部实现文本清理报告
description: 记录 2026-04-11 普通用户可见 UI 中调试性、内部实现、兼容迁移文案清理的逐文件处理结果、测试覆盖与回归关注点。
---

# 2026-04-11 UI 调试性 / 内部实现文本清理报告

## 摘要

- 覆盖聊天主界面、运行态壳层、模型选择器、设置页 provider / 默认模型区域、thinking 相关展示。
- 本轮处理以“删除纯工程噪音、改写必要动作提示、保留纯产品交互文本”为统一口径。
- 重点清除了普通用户可见路径中的内部实现术语、兼容迁移说明、调试诊断文本、原因码与内部标识值展示。
- 已同步更新相关前端测试，并完成类型检查与全量 Vitest 回归。

## 自动化验证结果

- `npm run typecheck`：通过。
- `node ./scripts/run-vitest.mjs`：通过。
- Vitest 汇总：`83` 个测试文件通过，`341` 个测试通过。

## 逐文件清查

### `frontend-copilot/src/features/copilot/CopilotMessageList.tsx`

| 页面路径 | 场景 | 原文本 | 处理动作 | 改写结果 | 保留理由 | 测试覆盖 |
| --- | --- | --- | --- | --- | --- | --- |
| 聊天主界面 | 诊断消息行 | `诊断：{stage} / {code} / {message}` | 删除 | - | 该行仅承担诊断输出职责，普通用户不需要看到阶段名和代码名 | `frontend-copilot/src/features/copilot/CopilotMessageList.segment.test.tsx` |
| 聊天主界面 | thinking 详情行 | `Provider Hint`、请求值、应用值、思考轨迹、抑制依据等详情行 | 删除 | - | 属于调试/快照信息，不承担用户动作引导职责 | `frontend-copilot/src/features/copilot/CopilotMessageList.segment.test.tsx` |
| 聊天主界面 | 常规标题、消息正文、工具卡片标题 | 普通消息头、工具状态词 | 保留 | - | 属于纯产品交互反馈，未暴露工程实现 | `frontend-copilot/src/features/copilot/CopilotMessageList.segment.test.tsx` |

### `frontend-copilot/src/features/copilot/copilot-chat-helpers.ts`

| 页面路径 | 场景 | 原文本 | 处理动作 | 改写结果 | 保留理由 | 测试覆盖 |
| --- | --- | --- | --- | --- | --- | --- |
| 聊天主界面 | 发送失败提示 | `provider_catalog_only`、`adapter_missing`、`route_ref_snapshot_mismatch` 等内部错误语义映射 | 改写 | `当前模型不可用，请重新选择模型。` / `请先完成模型服务配置后再试。` / `当前消息暂时无法发送，请调整内容后重试。` 等 | 保留用户下一步动作，去除内部原因码解释 | `frontend-copilot/src/features/copilot/copilot-chat-helpers.test.ts` |
| thinking 展示 | capability 不可用原因 | `provider_runtime_not_enabled`、`provider_profile_not_found` 等 reason code 对应文案 | 改写 | `请先完成模型配置` / `当前模型不可用，请重新选择` / `当前模型暂不支持思考设置` | 用户需要理解的是下一步动作，而不是内部 reason code | `frontend-copilot/src/features/copilot/copilot-chat-helpers.test.ts`、`frontend-copilot/src/features/copilot/CopilotThinkingSelector.test.tsx` |
| 控制台调试 | debug summary 构造 | runtime / session debug summary | 保留 | - | 仅用于控制台调试，不属于普通用户可见 UI，本轮设计明确排除 | `frontend-copilot/src/features/copilot/copilot-chat-helpers.test.ts` |

### `frontend-copilot/src/features/copilot/run-segment-view-model.ts`

| 页面路径 | 场景 | 原文本 | 处理动作 | 改写结果 | 保留理由 | 测试覆盖 |
| --- | --- | --- | --- | --- | --- | --- |
| 聊天主界面 | run 失败终态 | `run_failed: ...`、`code: message` 风格失败文本 | 改写 | `当前响应失败，请重试。` / `工具执行失败，请重试。` | 保留基础失败反馈，但不展示内部 code | `frontend-copilot/src/features/copilot/CopilotMessageList.segment.test.tsx`、`frontend-copilot/src/features/copilot/CopilotChatPanel.composer.test.tsx` |

### `frontend-copilot/src/features/copilot/run-state-projection.ts`

| 页面路径 | 场景 | 原文本 | 处理动作 | 改写结果 | 保留理由 | 测试覆盖 |
| --- | --- | --- | --- | --- | --- | --- |
| 聊天主界面 | conversation projection 失败终态 | 原始失败 code 与 message 组合文本 | 改写 | `当前响应失败，请重试。` | 统一聊天区失败口径，保留用户可理解反馈 | `frontend-copilot/src/features/copilot/CopilotMessageList.segment.test.tsx` |

### `frontend-copilot/src/features/copilot/copilot-panel-diagnostics.ts`

| 页面路径 | 场景 | 原文本 | 处理动作 | 改写结果 | 保留理由 | 测试覆盖 |
| --- | --- | --- | --- | --- | --- | --- |
| 运行态壳层 | 详情卡片 | 运行模式、runtime source、runtime URL、phase、failure code 等详情 | 删除 | - | 普通用户不需要理解运行时链路明细 | `frontend-copilot/src/features/copilot/CopilotPanelShell.diagnostic.test.tsx` |
| 运行态壳层 | failure summary | 原始连接失败分类与内部说明 | 改写 | `当前无法连接服务，请稍后重试。` / `当前无法连接服务，请重试。` / `当前无法连接服务，请检查设置后重试。` | 保留动作导向提示，去除内部诊断语义 | `frontend-copilot/src/features/copilot/CopilotPanelShell.diagnostic.test.tsx` |

### `frontend-copilot/src/features/copilot/CopilotRuntimeStateShell.tsx`

| 页面路径 | 场景 | 原文本 | 处理动作 | 改写结果 | 保留理由 | 测试覆盖 |
| --- | --- | --- | --- | --- | --- | --- |
| 运行态壳层 | loading / empty / incomplete / starting / failed / error | `正在等待根层完成运行态装配`、`尚未获得可用运行时`、`宿主正在启动本地后端`、`宿主启动后端失败` 等 | 改写 | `正在准备服务连接`、`尚未连接服务`、`正在连接服务`、`连接服务失败` 等 | 用户只需要知道当前连接状态和下一步动作 | `frontend-copilot/src/features/copilot/CopilotChatPanel.test.tsx` |
| 运行态壳层 | 重试按钮 | `重试启动宿主后端` | 改写 | `重试连接` | 保留动作，但去除内部启动链路描述 | `frontend-copilot/src/features/copilot/CopilotChatPanel.test.tsx` |

### `frontend-copilot/src/features/copilot/CopilotPanelShell.tsx`

| 页面路径 | 场景 | 原文本 | 处理动作 | 改写结果 | 保留理由 | 测试覆盖 |
| --- | --- | --- | --- | --- | --- | --- |
| 聊天主界面 | agent 列表加载 / 空状态 | `正在准备智能体目录`、`后端智能体目录加载失败`、`后端目录中暂无可选智能体` | 改写 | `正在加载助手列表`、`加载助手列表失败`、`暂无可用助手` | 保留用户能理解的状态反馈，不再解释后端目录来源 | `frontend-copilot/src/features/copilot/CopilotChatPanel.test.tsx` |
| 聊天主界面 | session 创建失败 | 原始 `sessionError` 文本直接输出 | 改写 | `当前无法创建会话，请重试。` | 保留必要失败提示，去除内部原始错误串 | `frontend-copilot/src/features/copilot/CopilotChatPanel.test.tsx` |

### `frontend-copilot/src/features/copilot/components/NotConnectedNotice.tsx`

| 页面路径 | 场景 | 原文本 | 处理动作 | 改写结果 | 保留理由 | 测试覆盖 |
| --- | --- | --- | --- | --- | --- | --- |
| 运行态 / 未连接提示 | 缺失字段标签 | `Runtime URL（仅开发态可手填）` | 改写 | `服务地址` | 仍需提示用户补充字段，但不解释开发态/运行时实现 | `frontend-copilot/src/features/copilot/CopilotChatPanel.test.tsx` |

### `frontend-copilot/src/features/copilot/model-picker.ts`

| 页面路径 | 场景 | 原文本 | 处理动作 | 改写结果 | 保留理由 | 测试覆盖 |
| --- | --- | --- | --- | --- | --- | --- |
| 模型选择器 | streaming / route 可用性提示 | `当前模型路由缺少稳定 routeRef。` | 改写 | `当前模型不可用，请重新选择。` | 用户无需理解 routeRef，只需知道当前选择不可用 | `frontend-copilot/src/features/copilot/model-picker.test.ts` |
| 模型选择器 | fallback 标签 | `已失效路由 · profileId`、带内部 profile / model 标识的 fallback | 改写 | `当前选择不可用` / `当前选择已失效，请重新选择。` | 保留失效提醒，但不暴露内部标识值 | `frontend-copilot/src/features/copilot/model-picker.test.ts`、`frontend-copilot/src/features/copilot/CopilotChatPanel.composer.test.tsx` |
| 模型选择器 | compatibility / catalog-only 提示 | 带 catalog / compatibility 分类的不可用原因 | 改写 | `当前模型暂不可用于聊天。` | 统一为用户可理解的可用性说明 | `frontend-copilot/src/features/copilot/model-picker.test.ts` |

### `frontend-copilot/src/features/copilot/components/ModelPicker.tsx`

| 页面路径 | 场景 | 原文本 | 处理动作 | 改写结果 | 保留理由 | 测试覆盖 |
| --- | --- | --- | --- | --- | --- | --- |
| 模型选择器 | 下拉项附加信息 | `model.id` | 删除 | - | `model.id` 属于内部标识，不应直接展示给普通用户 | `frontend-copilot/src/features/copilot/CopilotChatPanel.composer.test.tsx` |
| 模型选择器 | 模型名 / 可用性文案 | 模型名与不可用原因 | 保留 | - | 属于用户理解模型选择所需的产品信息 | `frontend-copilot/src/features/copilot/CopilotChatPanel.composer.test.tsx` |

### `frontend-copilot/src/features/copilot/CopilotComposer.tsx`

| 页面路径 | 场景 | 原文本 | 处理动作 | 改写结果 | 保留理由 | 测试覆盖 |
| --- | --- | --- | --- | --- | --- | --- |
| thinking 面板 | 当前值展示 | 当前值后拼接内部 `code` | 删除 | - | code 只用于内部识别，不应进入普通 UI | `frontend-copilot/src/features/copilot/CopilotComposer.test.tsx` |
| thinking 面板 | fixed thinking 展示 | `固定推理` 后展示 `<code>` | 改写 | 仅保留 `固定思考` 与锁定态 | 保留用户可感知的锁定状态，不暴露内部 code | `frontend-copilot/src/features/copilot/CopilotComposer.test.tsx` |

### `frontend-copilot/src/components/ThinkingControls.tsx`

| 页面路径 | 场景 | 原文本 | 处理动作 | 改写结果 | 保留理由 | 测试覆盖 |
| --- | --- | --- | --- | --- | --- | --- |
| thinking 选项 pill | 档位展示 | `label + code` | 改写 | 仅保留 `label` | 保留产品化档位名，去除内部 code | `frontend-copilot/src/features/copilot/CopilotComposer.test.tsx` |

### `frontend-copilot/src/workbench/thinking-capabilities.ts`

| 页面路径 | 场景 | 原文本 | 处理动作 | 改写结果 | 保留理由 | 测试覆盖 |
| --- | --- | --- | --- | --- | --- | --- |
| thinking 展示 / 设置页 | 系列名与 hint | `OpenAI 6 档总超集`、`Anthropic Budget`、`Qwen Thinking 开关`、`自定义系列` 等工程化/实现导向命名 | 改写 | `六档思考`、`思考预算`、`思考开关`、`按当前模型设置` 等产品化命名 | 保留用户需要理解的操作概念，去除供应商/实现导向表达 | `frontend-copilot/src/features/copilot/CopilotThinkingSelector.test.tsx`、`frontend-copilot/src/workbench/thinking-capabilities.test.ts` |

### `frontend-copilot/src/features/copilot/copilot-send-controller.ts`

| 页面路径 | 场景 | 原文本 | 处理动作 | 改写结果 | 保留理由 | 测试覆盖 |
| --- | --- | --- | --- | --- | --- | --- |
| 聊天主界面 | 发送前禁用原因 / title | `当前没有可用于聊天发送的模型路由...`、`请先选择本次发送要使用的模型路由。` 等 | 改写 | `当前没有可用模型，请前往设置页调整模型配置。`、`请先选择模型。`、`当前选择的模型不可用于聊天。` | 保留明确动作引导，去除 route 语义 | `frontend-copilot/src/features/copilot/CopilotChatPanel.composer.test.tsx` |

### `frontend-copilot/src/workbench/settings/DefaultModelRoutesSection.tsx`

| 页面路径 | 场景 | 原文本 | 处理动作 | 改写结果 | 保留理由 | 测试覆盖 |
| --- | --- | --- | --- | --- | --- | --- |
| 设置页 / 默认模型 | 标题、副标题、字段说明、占位文案 | `默认模型路由`、`请选择默认路由`、解释不同 route 的说明 | 改写 | `默认模型`、`请选择默认模型`、`为不同场景选择默认使用的模型。` | 保留设置意图，但不解释内部 route 机制 | `frontend-copilot/src/workbench/settings/SettingsWorkspace.structure.test.tsx` |

### `frontend-copilot/src/workbench/settings/settings-workspace-provider-helpers.ts`

| 页面路径 | 场景 | 原文本 | 处理动作 | 改写结果 | 保留理由 | 测试覆盖 |
| --- | --- | --- | --- | --- | --- | --- |
| 设置页 / provider 详情 | provider 状态横幅 | catalog、legacy、unsupported、仅数据层兼容等状态说明 | 改写 | `当前服务不可用` / `请重新选择服务类型或检查配置。` | 只保留用户动作导向提示 | `frontend-copilot/src/workbench/settings/SettingsWorkspace.providers.test.tsx` |
| 设置页 / provider 详情 | capability summary | `Provider: ...`、`Endpoint: ...`、状态来源等内部说明 | 改写 | `请完成服务配置后再使用。` / `支持：流式、工具、视觉、推理、联网` / `可用功能信息暂未提供。` | 保留用户能理解的功能摘要，去除内部来源说明 | `frontend-copilot/src/workbench/settings/SettingsWorkspace.providers.test.tsx` |
| 设置页 / provider 详情 | auth / base url / model editing 提示 | 旧提示包含实现细节或内部状态解释 | 改写 | `请填写 API 密钥。`、`服务地址`、`当前模型列表暂不可编辑。` 等 | 保留表单指导，但不夹带工程语义 | `frontend-copilot/src/workbench/settings/SettingsWorkspace.providers.test.tsx`、`frontend-copilot/src/workbench/settings/SettingsWorkspace.persistence.test.tsx` |

### `frontend-copilot/src/workbench/settings/settings-workspace-model-options.ts`

| 页面路径 | 场景 | 原文本 | 处理动作 | 改写结果 | 保留理由 | 测试覆盖 |
| --- | --- | --- | --- | --- | --- | --- |
| 设置页 / 默认模型下拉 | option hint | modelId / providerType / 内部状态拼接 hint | 删除 | - | 属于内部标识与状态拼接，不应在默认模型下拉向用户展示 | `frontend-copilot/src/workbench/settings/SettingsWorkspace.persistence.test.tsx` |
| 设置页 / 默认模型下拉 | fallback 选项 | `已失效路由 · profileId · modelId`、`旧配置 · xxx` | 改写 | `当前选择已失效` / `当前选择不可用` / `请重新选择模型。` | 保留需要重选的用户动作，不暴露 route / legacy 语义 | `frontend-copilot/src/workbench/settings/SettingsWorkspace.persistence.test.tsx` |

### `frontend-copilot/src/workbench/settings/ProviderProfileDetails.tsx`

| 页面路径 | 场景 | 原文本 | 处理动作 | 改写结果 | 保留理由 | 测试覆盖 |
| --- | --- | --- | --- | --- | --- | --- |
| 设置页 / provider 详情 | 区块标题与字段说明 | `服务商基础信息`、`Provider 类型`、`Base URL`、扩展字段透传说明 | 改写 | `服务信息`、`服务类型`、`服务地址`、`当前服务包含附加信息，保存时会一并保留。` | 保留必要表单说明，但去除 provider / base URL / 透传等工程化解释 | `frontend-copilot/src/workbench/settings/SettingsWorkspace.providers.test.tsx` |

### `frontend-copilot/src/workbench/settings/ProviderProfileList.tsx`

| 页面路径 | 场景 | 原文本 | 处理动作 | 改写结果 | 保留理由 | 测试覆盖 |
| --- | --- | --- | --- | --- | --- | --- |
| 设置页 / provider 列表 | 标题、副标题、搜索框 | `模型服务商`、工程化搜索提示 | 改写 | `模型服务`、`在这里管理可用的模型服务。`、`搜索服务、地址或模型...` | 保留列表用途说明，统一产品化表达 | `frontend-copilot/src/workbench/settings/SettingsWorkspace.structure.test.tsx`、`frontend-copilot/src/workbench/settings/SettingsWorkspace.providers.test.tsx` |

### `frontend-copilot/src/workbench/settings/ProviderProfileListItem.tsx`

| 页面路径 | 场景 | 原文本 | 处理动作 | 改写结果 | 保留理由 | 测试覆盖 |
| --- | --- | --- | --- | --- | --- | --- |
| 设置页 / provider 列表项 | 空地址提示 | `未设置 Base URL` | 改写 | `未设置服务地址` | 保留必要状态提示，去除工程字段名 | `frontend-copilot/src/workbench/settings/SettingsWorkspace.providers.test.tsx` |

### `frontend-copilot/src/workbench/settings/ProviderModelListPanel.tsx`

| 页面路径 | 场景 | 原文本 | 处理动作 | 改写结果 | 保留理由 | 测试覆盖 |
| --- | --- | --- | --- | --- | --- | --- |
| 设置页 / provider 模型列表 | 空状态与不可编辑提示 | 含 `provider` 的工程化说明 | 改写 | `当前服务还没有可用模型。点击下方按钮添加第一个模型。` / `当前模型列表暂不可编辑。` | 保留用户动作引导，不解释内部模型来源 | `frontend-copilot/src/workbench/settings/SettingsWorkspace.providers.test.tsx` |

### `frontend-copilot/src/workbench/settings/GeneralSettingsSection.tsx`

| 页面路径 | 场景 | 原文本 | 处理动作 | 改写结果 | 保留理由 | 测试覆盖 |
| --- | --- | --- | --- | --- | --- | --- |
| 设置页 / 通用设置 | 调试模式说明 | `显示运行诊断，并让新的聊天运行自动开启后端 runtime chain debug 日志。` | 改写 | `开启后会显示更多问题排查信息。` | 保留开关效果说明，但去掉 runtime chain debug 等内部术语 | `frontend-copilot/src/workbench/settings/SettingsWorkspace.persistence.test.tsx` |

### `frontend-copilot/src/workbench/settings/ProviderModelEditorDialog.tsx`

| 页面路径 | 场景 | 原文本 | 处理动作 | 改写结果 | 保留理由 | 测试覆盖 |
| --- | --- | --- | --- | --- | --- | --- |
| 设置页 / 模型编辑器 | thinking 预算标签 | `精确推理 Token 预算` | 改写 | `思考预算` | 保留用户理解所需预算概念，去除实现导向措辞 | `frontend-copilot/src/workbench/settings/ProviderModelEditorDialog.test.tsx` |
| 设置页 / 模型编辑器 | thinking 内部 code 数据 | `ThinkingPillOption.code` 数据结构 | 保留 | - | 仅作为内部状态数据存在，用户界面已不再直接渲染 code，不属于普通 UI 暴露 | `frontend-copilot/src/workbench/settings/ProviderModelEditorDialog.test.tsx`、`frontend-copilot/src/features/copilot/CopilotComposer.test.tsx` |

## 保留项附录

以下内容经复核后原样保留或仅做轻度产品化保留：

- 聊天消息标题、普通空状态标题、重试按钮、发送失败等基础交互反馈：属于纯产品交互文本。
- 模型名、服务名称、锁定状态、预算值、按钮与字段标签：属于用户完成任务所必需的信息，不包含工程实现语义。
- 控制台调试 summary 相关函数：不属于普通用户可见 UI，本轮按设计边界不纳入清理。
- `ThinkingPillOption.code` 等内部数据字段：仅作为组件内部状态存在，未直接向用户渲染，因此不构成普通 UI 暴露。

## 重点回归关注点

### 聊天主界面

- 确认默认聊天路径不再渲染诊断行、原因码、阶段名、provider hint 与 thinking 详情行。
- 确认发送失败、运行失败、取消后的尾部提示仍保留基础失败反馈。
- 确认运行态 loading / empty / incomplete / starting / failed / error 六类状态统一使用用户视角文本。

### 模型选择器

- 确认 trigger、下拉项、禁用原因、fallback 标签不再暴露 route、legacy、catalog、profileId、modelId。
- 确认无模型、失效模型、重复 modelId 恢复失败等场景都落到统一的用户动作引导。

### 设置页 provider / 默认模型区域

- 确认 provider 状态横幅、默认模型下拉、服务地址与认证信息提示均已去除工程术语。
- 确认扩展字段说明、模型列表空状态、调试模式说明均保持产品化表达。

### thinking 相关展示

- 确认聊天 thinking 面板、选择器 trigger、设置页模型编辑器都只展示档位、预算、锁定等产品信息。
- 确认用户界面中不再出现 thinking code、reason code、capability source、provider hint 等内部词汇。

## 遗留项

- 无代码层遗留阻塞项。
- 控制台日志与开发调试通道中的 debug summary 仍然保留，符合设计文档“非普通用户可见通道不在本轮范围内”的边界约束。

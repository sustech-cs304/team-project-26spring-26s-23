---
title: UI 调试性 / 内部实现文本清理实施计划
description: 基于已批准设计，将聊天主界面、模型选择器、设置页与 thinking 展示中的调试性、内部实现、兼容迁移说明文本按阶段清理，并为后续代码实施与清查报告提供执行顺序、文件范围与验证口径。
---

# 2026-04-11 UI 调试性 / 内部实现文本清理实施计划

## 文档定位

本文将已确认设计文档 [`2026-04-11-ui-debug-text-cleanup-design.md`](./2026-04-11-ui-debug-text-cleanup-design.md) 转换为可直接委派给 code 模式的实施计划。本文只覆盖阶段划分、文件范围、处理动作、测试同步、回归路径与最终清查报告组织方式，不包含任何代码补丁，也不要求修改 Markdown 以外的文件。

后续实现必须始终以 [`2026-04-11-ui-debug-text-cleanup-design.md`](./2026-04-11-ui-debug-text-cleanup-design.md) 为最高依据；若测试旧断言、现有文案或局部实现习惯与设计口径冲突，统一按设计文档与本文的执行顺序裁决。

## 实施目标

1. 先清除用户高频路径中的工程噪音，再收口设置页与 thinking 展示中的残留术语。
2. 把所有用户必须看到的提示统一改写为用户动作导向，不再解释内部判定过程。
3. 让删除、改写、保留三类动作有一致口径，避免同类文本在不同入口被不同方式处理。
4. 在实现阶段同步收敛测试断言，避免旧测试继续要求展示内部实现文本。
5. 为最终清查报告预留统一结构，确保后续可以逐文件复核。

## 执行原则

1. **先用户主路径，后说明性边角。** 先处理聊天主界面、模型选择器和运行态壳层，再处理设置页与 thinking 相关展示。
2. **先删纯噪音，再改保留项。** 只要某段文本不承担用户动作引导职责，就优先删除，不做弱化保留。
3. **改写只保留下一步动作。** 改写项只允许表达用户接下来该做什么，不解释 catalog、route、adapter、迁移来源或失败原因码。
4. **保留项必须有理由。** 任何保留文本都要能证明其属于纯产品交互文案，而不是工程解释文案。
5. **测试与文案同步调整。** 每个阶段处理用户可见文案时，同步更新对应渲染测试，避免最后集中返工。

## 文本分类与统一处理口径

| 文本类别 | 当前常见表现 | 处理动作 | 判定口径 |
| --- | --- | --- | --- |
| 内部实现与架构链路 | route ref、profile + model、preload、IPC、hosted backend、runtime URL 作为解释性说明 | 删除；若用户必须采取动作则改写 | 用户完成当前操作并不需要理解内部链路时，一律不展示 |
| 兼容迁移与历史状态 | legacy、catalog-only、legacy-unsupported、历史兼容、迁移保留、透传保留 | 删除或改写 | 若只是解释历史来源或兼容状态，删除；若与当前选择失效直接相关，只保留用户动作引导 |
| 调试诊断与原因码 | diagnostic、stage、code、reasonCode、adapter_missing、provider_runtime_not_enabled 等 | 删除 | 普通 UI 中不展示原因码、阶段名、诊断汇总或内部状态枚举 |
| 用户动作引导 | 当前选择已失效、请重新选择、请先完成配置 | 改写后保留 | 允许保留，但必须是纯用户视角，且不夹带内部术语 |
| 纯产品交互文本 | 字段标签、按钮文案、搜索空状态、基础失败反馈 | 原样保留 | 前提是文本本身没有夹带工程实现、迁移或诊断语义 |

### 统一禁用表达

以下表达及其同类变体在普通用户路径中不应继续直接展示：

- provider catalog
- legacy
- route ref
- adapter
- diagnostic
- code
- stage
- profileId、modelId 等内部标识值
- 原始错误码、原因码、状态枚举拼接文本

### 统一改写方向

后续实现阶段遇到需要保留的提示时，统一收敛到以下表达方向：

- 失效选择类：强调“当前选择不可用，请重新选择”
- 未配置类：强调“请先完成模型服务配置”
- 能力不支持类：强调“当前模型暂不支持该功能”
- 启动失败类：强调“当前无法继续，请重试或检查配置”

不得在改写结果中继续附带内部名词解释、状态来源说明、迁移来源说明或原始错误码。

## 阶段总览

| 阶段 | 名称 | 目标 | 主要文件组 | 完成标志 |
| --- | --- | --- | --- | --- |
| 阶段 0 | 命中清单与统一文案基线 | 逐文件列出命中文本并先做删除/改写/保留归类 | 聊天、模型选择器、设置页、thinking 高优先级文件 | 得到可执行的命中清单与统一替换口径 |
| 阶段 1 | 聊天主界面与运行态提示清理 | 去掉聊天区、运行态壳层、失败提示中的诊断和内部链路说明 | [`CopilotMessageList.tsx`](../../frontend-copilot/src/features/copilot/CopilotMessageList.tsx)、[`copilot-chat-helpers.ts`](../../frontend-copilot/src/features/copilot/copilot-chat-helpers.ts)、[`CopilotRuntimeStateShell.tsx`](../../frontend-copilot/src/features/copilot/CopilotRuntimeStateShell.tsx)、[`copilot-panel-diagnostics.ts`](../../frontend-copilot/src/features/copilot/copilot-panel-diagnostics.ts)、[`NotConnectedNotice.tsx`](../../frontend-copilot/src/features/copilot/components/NotConnectedNotice.tsx) | 聊天主路径不再展示诊断行、原因码或内部链路说明 |
| 阶段 2 | 模型选择器与失效选择清理 | 收口模型不可用提示、失效 fallback 标签与选择器提示 | [`model-picker.ts`](../../frontend-copilot/src/features/copilot/model-picker.ts)、[`ModelPicker.tsx`](../../frontend-copilot/src/features/copilot/components/ModelPicker.tsx)、[`CopilotComposer.tsx`](../../frontend-copilot/src/features/copilot/CopilotComposer.tsx) | 模型选择器只展示用户可理解的可用性提示 |
| 阶段 3 | 设置页 provider 与默认模型区域清理 | 清除 provider 说明区、默认模型说明、兼容状态说明中的内部语义 | [`DefaultModelRoutesSection.tsx`](../../frontend-copilot/src/workbench/settings/DefaultModelRoutesSection.tsx)、[`ProviderProfileDetails.tsx`](../../frontend-copilot/src/workbench/settings/ProviderProfileDetails.tsx)、[`settings-workspace-provider-helpers.ts`](../../frontend-copilot/src/workbench/settings/settings-workspace-provider-helpers.ts)、[`settings-workspace-model-options.ts`](../../frontend-copilot/src/workbench/settings/settings-workspace-model-options.ts)、[`GeneralSettingsSection.tsx`](../../frontend-copilot/src/workbench/settings/GeneralSettingsSection.tsx)、[`ProviderProfileList.tsx`](../../frontend-copilot/src/workbench/settings/ProviderProfileList.tsx) | 设置页不再向用户解释 route、catalog、迁移与调试语义 |
| 阶段 4 | thinking 相关展示清理 | 收口 thinking 触发器、面板、不可用原因和详情展示 | [`CopilotComposer.tsx`](../../frontend-copilot/src/features/copilot/CopilotComposer.tsx)、[`ThinkingControls.tsx`](../../frontend-copilot/src/components/ThinkingControls.tsx)、[`thinking-display.ts`](../../frontend-copilot/src/workbench/thinking-display.ts)、[`CopilotMessageList.tsx`](../../frontend-copilot/src/features/copilot/CopilotMessageList.tsx)、[`ProviderModelEditorDialog.tsx`](../../frontend-copilot/src/workbench/settings/ProviderModelEditorDialog.tsx) | thinking 展示只保留用户可理解的档位与操作，不显示内部 code 或原因码 |
| 阶段 5 | 测试、回归与清查报告收口 | 同步更新测试断言，按用户路径回归，并输出清查报告 | 相关前端测试文件与最终清查报告 | 关键路径通过，且有逐文件清查记录 |

```mermaid
flowchart LR
  A[阶段 0 命中清单与统一文案基线] --> B[阶段 1 聊天主界面与运行态]
  B --> C[阶段 2 模型选择器与失效选择]
  C --> D[阶段 3 设置页 provider 与默认模型]
  D --> E[阶段 4 thinking 相关展示]
  E --> F[阶段 5 测试 回归 清查报告]
  B --> F
  C --> F
  D --> F
  E --> F
```

## 阶段 0：命中清单与统一文案基线

### 目标

先不急于改文案，先把设计要求落到逐文件命中清单上，避免后续实施时出现同类文本在不同入口处理不一致的问题。

### 目标文件组

- [`CopilotMessageList.tsx`](../../frontend-copilot/src/features/copilot/CopilotMessageList.tsx)
- [`copilot-chat-helpers.ts`](../../frontend-copilot/src/features/copilot/copilot-chat-helpers.ts)
- [`CopilotRuntimeStateShell.tsx`](../../frontend-copilot/src/features/copilot/CopilotRuntimeStateShell.tsx)
- [`model-picker.ts`](../../frontend-copilot/src/features/copilot/model-picker.ts)
- [`DefaultModelRoutesSection.tsx`](../../frontend-copilot/src/workbench/settings/DefaultModelRoutesSection.tsx)
- [`ProviderProfileDetails.tsx`](../../frontend-copilot/src/workbench/settings/ProviderProfileDetails.tsx)
- [`settings-workspace-provider-helpers.ts`](../../frontend-copilot/src/workbench/settings/settings-workspace-provider-helpers.ts)
- [`settings-workspace-model-options.ts`](../../frontend-copilot/src/workbench/settings/settings-workspace-model-options.ts)
- [`GeneralSettingsSection.tsx`](../../frontend-copilot/src/workbench/settings/GeneralSettingsSection.tsx)
- [`CopilotComposer.tsx`](../../frontend-copilot/src/features/copilot/CopilotComposer.tsx)
- [`ThinkingControls.tsx`](../../frontend-copilot/src/components/ThinkingControls.tsx)

### 执行清单

1. 逐文件列出所有最终会进入普通 UI 的文本，不按源码用途而按“最终是否直接显示给用户”判断。
2. 给每条文本打上删除、改写、保留标签。
3. 为改写项整理统一替换口径，避免同一类失效提示在聊天区、设置页、模型选择器各写各的。
4. 为保留项同步记下保留理由，后续可直接进入清查报告。
5. 在进入阶段 1 之前，先把“纯产品交互文本白名单”单独列出来，避免误删字段标签、按钮文案和基础空状态。

### 完成标志

- 已形成逐文件命中清单。
- 已形成统一替换口径表。
- 已形成保留项白名单与理由草稿。

## 阶段 1：聊天主界面与运行态提示清理

### 目标

优先清掉用户最频繁接触路径中的工程噪音，包括聊天消息列表、发送失败提示、运行态空状态和启动失败提示。

### 目标文件

- [`CopilotMessageList.tsx`](../../frontend-copilot/src/features/copilot/CopilotMessageList.tsx)
- [`copilot-chat-helpers.ts`](../../frontend-copilot/src/features/copilot/copilot-chat-helpers.ts)
- [`CopilotRuntimeStateShell.tsx`](../../frontend-copilot/src/features/copilot/CopilotRuntimeStateShell.tsx)
- [`copilot-panel-diagnostics.ts`](../../frontend-copilot/src/features/copilot/copilot-panel-diagnostics.ts)
- [`NotConnectedNotice.tsx`](../../frontend-copilot/src/features/copilot/components/NotConnectedNotice.tsx)
- 如需配合渲染入口，可一并复核 [`CopilotPanelShell.tsx`](../../frontend-copilot/src/features/copilot/CopilotPanelShell.tsx)

### 处理重点

1. 删除消息列表中只承担诊断展示职责的原始阶段名、代码名、原因码与内部详情行。
2. 收口发送失败提示中的原始错误码前缀、catalog 状态、adapter 缺失、route 失配等内部说明。
3. 重写运行态空状态、启动中、启动失败、读取失败描述，只保留“当前状态 + 用户下一步动作”。
4. 复核详情面板与失败摘要，避免继续把 hosted、runtime source、phase、timestamp 等内部状态直接灌给普通用户。
5. 保留诸如“发送失败”“重试”这类纯产品交互反馈，但不要拼接内部状态串。

### 本阶段判定口径

- **删除**：诊断卡片正文、原始错误摘要、阶段名、代码名、原因码、内部链路解释。
- **改写**：用户仍需采取动作的发送失败、连接失败、启动失败提示。
- **保留**：消息标题、基础失败标题、重试按钮、普通空状态标题。

### 完成标志

- 聊天主界面默认不再出现原始错误码、阶段名、原因码与架构链路说明。
- 运行态壳层在异常场景下只说明用户可感知状态与下一步动作。

## 阶段 2：模型选择器与失效选择清理

### 目标

把模型选择器中的“已失效路由”“旧配置”“历史兼容”“仅数据层兼容”等内部/迁移语义收口为用户可理解的状态提示。

### 目标文件

- [`model-picker.ts`](../../frontend-copilot/src/features/copilot/model-picker.ts)
- [`ModelPicker.tsx`](../../frontend-copilot/src/features/copilot/components/ModelPicker.tsx)
- [`CopilotComposer.tsx`](../../frontend-copilot/src/features/copilot/CopilotComposer.tsx)

### 处理重点

1. 替换失效 fallback 标签，禁止把 profileId、原始 route 值或内部路由描述直接展示为模型名或分组名。
2. 把不可用原因统一收敛成用户视角，例如“当前选择不可用，请重新选择”“该模型当前不可用于聊天”。
3. 删除 legacy、catalog-only、route ref 等状态来源说明，不在模型项提示中解释失效原因的内部分类。
4. 如需保留无效状态徽标，可保留“失效”或“不可用”这类产品词，但不拼接内部语义。
5. 复核选择器 trigger、选项 hint、禁用项原因、默认选择失效后的回退标签是否一致。

### 本阶段判定口径

- **删除**：内部状态来源、原始 route 字符串、profile 标识值、兼容迁移说明。
- **改写**：用户需要重新选择时的提示、当前模型不可用时的提示。
- **保留**：模型名、服务名称、可理解的状态徽标。

### 完成标志

- 模型选择器内外的失效提示不再暴露 route、legacy、catalog 等内部术语。
- 相同失效场景在 trigger、下拉项与聊天发送前提示中口径一致。

## 阶段 3：设置页 provider 与默认模型区域清理

### 目标

把设置页中关于 provider、默认模型、兼容状态、扩展字段、调试模式的说明文案改成用户可理解的产品语言，并移除不必要的工程解释。

### 目标文件

- [`DefaultModelRoutesSection.tsx`](../../frontend-copilot/src/workbench/settings/DefaultModelRoutesSection.tsx)
- [`ProviderProfileDetails.tsx`](../../frontend-copilot/src/workbench/settings/ProviderProfileDetails.tsx)
- [`settings-workspace-provider-helpers.ts`](../../frontend-copilot/src/workbench/settings/settings-workspace-provider-helpers.ts)
- [`settings-workspace-model-options.ts`](../../frontend-copilot/src/workbench/settings/settings-workspace-model-options.ts)
- [`GeneralSettingsSection.tsx`](../../frontend-copilot/src/workbench/settings/GeneralSettingsSection.tsx)
- [`ProviderProfileList.tsx`](../../frontend-copilot/src/workbench/settings/ProviderProfileList.tsx)

### 处理重点

1. 重写默认模型区域标题、副标题和字段说明，不再向用户解释稳定 route、profile + model、模糊匹配等内部机制。
2. 清理 provider 状态横幅中的 catalog、legacy、unsupported、仅数据层兼容、迁移保留等说明。
3. 清理扩展字段保留说明，不再向用户解释 organization、region、notes 或扩展字典如何在保存链路中透传。
4. 清理默认模型失效 fallback 选项文案，不再展示“已失效路由”“旧配置”等内部措辞。
5. 复核调试模式开关描述。若开关本身继续保留，说明文案只能描述用户可见效果，不能出现 runtime chain debug 日志等内部术语。
6. 保留字段标签、基础占位文案、表单按钮等纯产品交互文本。

### 本阶段判定口径

- **删除**：关于 catalog、route、迁移、透传、内部结构的解释性说明。
- **改写**：需要指导用户重新选择模型、补充认证信息、检查配置的提示。
- **保留**：字段标签、按钮、普通表单提示、简洁的服务说明。

### 完成标志

- 设置页的 provider 区域和默认模型区域不再向用户解释内部实现与兼容迁移历史。
- 同类状态提示在 provider 详情、默认模型下拉和列表检索处口径一致。

## 阶段 4：thinking 相关展示清理

### 目标

清理聊天与设置中的 thinking 展示，确保用户只看到可操作的档位、预算和支持状态，而不是内部 code、原因码或能力来源说明。

### 目标文件

- [`CopilotComposer.tsx`](../../frontend-copilot/src/features/copilot/CopilotComposer.tsx)
- [`ThinkingControls.tsx`](../../frontend-copilot/src/components/ThinkingControls.tsx)
- [`thinking-display.ts`](../../frontend-copilot/src/workbench/thinking-display.ts)
- [`CopilotMessageList.tsx`](../../frontend-copilot/src/features/copilot/CopilotMessageList.tsx)
- [`copilot-chat-helpers.ts`](../../frontend-copilot/src/features/copilot/copilot-chat-helpers.ts)
- [`ProviderModelEditorDialog.tsx`](../../frontend-copilot/src/workbench/settings/ProviderModelEditorDialog.tsx)

### 处理重点

1. 删除 thinking 选项中仅供内部识别的 code 展示，不把原始 code 值作为普通用户可见内容。
2. 删除消息详情里关于能力来源、原因码、provider hint、状态快照等内部说明。
3. 把“不支持”原因统一改写为用户可理解的提示，例如“当前模型暂不支持思考设置”或“请更换模型”。
4. 保留用户真正需要操作的档位名、预算值、锁定状态等产品化信息。
5. 确保聊天 thinking 面板与设置页模型编辑器中的 thinking 相关用词一致，不出现一处是产品语言、一处又回到内部术语的情况。

### 本阶段判定口径

- **删除**：thinking code、原因码、来源、内部能力快照字段。
- **改写**：thinking 不可用原因与切换提示。
- **保留**：档位名称、预算、锁定、开关类产品文案。

### 完成标志

- thinking 触发器、面板、详情和设置编辑器中不再展示内部 code 或能力来源语义。
- 用户可以仅凭界面文案理解如何切换或为何当前不可切换。

## 阶段 5：测试、回归与清查报告收口

### 目标

在前四个阶段完成后，同步更新测试断言、完成重点路径回归，并输出清查报告，确保本轮清理可以被复核而不是只凭人工印象判断。

### 执行清单

1. 按阶段同步修改已有渲染测试中的文本断言，去掉对内部术语的旧依赖。
2. 对核心用户路径补充“应包含什么”和“不应包含什么”的显式断言，避免只靠快照。
3. 按重点回归路径做手工复核，确认聊天主界面、模型选择器、设置页和 thinking 展示都已收口。
4. 根据阶段 0 的命中清单输出最终清查报告，逐文件记录处理动作。
5. 清查报告完成后再做一次全局检索，确认普通 UI 相关文件中不再残留禁用表达。

### 完成标志

- 测试断言已迁移到用户视角文案。
- 四条重点回归路径完成复核。
- 已生成逐文件清查报告。

## 需要同步更新或新增的测试范围

| 用户路径 | 需要同步更新的测试文件 | 测试目标 |
| --- | --- | --- |
| 聊天主界面与运行态 | [`CopilotPanelShell.diagnostic.test.tsx`](../../frontend-copilot/src/features/copilot/CopilotPanelShell.diagnostic.test.tsx)、[`CopilotChatPanel.test.tsx`](../../frontend-copilot/src/features/copilot/CopilotChatPanel.test.tsx)、[`CopilotMessageList.segment.test.tsx`](../../frontend-copilot/src/features/copilot/CopilotMessageList.segment.test.tsx)、[`copilot-chat-helpers.test.ts`](../../frontend-copilot/src/features/copilot/copilot-chat-helpers.test.ts) | 断言诊断文本、原因码、阶段名不再直接渲染；保留简洁的失败与重试文案 |
| 模型选择器 | [`model-picker.test.ts`](../../frontend-copilot/src/features/copilot/model-picker.test.ts)、[`ModelPicker.test.tsx`](../../frontend-copilot/src/features/copilot/components/ModelPicker.test.tsx)、[`CopilotChatPanel.composer.test.tsx`](../../frontend-copilot/src/features/copilot/CopilotChatPanel.composer.test.tsx) | 断言失效选择、禁用提示和 fallback 标签已改为用户语言，不暴露 route 或兼容状态来源 |
| 设置页 provider 与默认模型 | [`SettingsWorkspace.providers.test.tsx`](../../frontend-copilot/src/workbench/settings/SettingsWorkspace.providers.test.tsx)、[`SettingsWorkspace.persistence.test.tsx`](../../frontend-copilot/src/workbench/settings/SettingsWorkspace.persistence.test.tsx)、[`SettingsWorkspace.secrets.test.tsx`](../../frontend-copilot/src/workbench/settings/SettingsWorkspace.secrets.test.tsx)、[`settings-workspace-save-input.test.ts`](../../frontend-copilot/src/workbench/settings/settings-workspace-save-input.test.ts) | 断言默认模型说明、provider 状态横幅、扩展字段说明、调试模式说明已清理内部语义 |
| thinking 相关展示 | [`CopilotThinkingSelector.test.tsx`](../../frontend-copilot/src/features/copilot/CopilotThinkingSelector.test.tsx)、[`CopilotComposer.test.tsx`](../../frontend-copilot/src/features/copilot/CopilotComposer.test.tsx)、[`ProviderModelEditorDialog.test.tsx`](../../frontend-copilot/src/workbench/settings/ProviderModelEditorDialog.test.tsx) | 断言 thinking 面板只展示产品化档位与预算，不再展示内部 code、原因码或来源 |

### 测试断言建议

1. 对每个关键渲染面同时写正向断言和反向断言。
2. 正向断言只验证用户应看到的动作引导或产品文本。
3. 反向断言重点覆盖 legacy、route ref、catalog、adapter、diagnostic、code、stage 及其常见拼接形式。
4. 尽量使用显式文本断言，不依赖大范围快照，以减少后续文案微调时的维护成本。

## 重点回归路径

### 1. 聊天主界面

- 无消息空状态
- 无模型或模型不可用时的空状态与发送前提示
- 发送失败后的提示文本
- 运行态 loading、empty、incomplete、starting、failed、error 各状态卡片
- 打开与关闭诊断相关开关后，普通聊天路径是否仍然保持用户视角文案

### 2. 模型选择器

- 正常模型选择与发送
- 失效模型、禁用模型、缺失模型 fallback 展示
- 重复 modelId 场景下的默认模型恢复与重选提示
- trigger、下拉项、禁用原因三处文案是否一致

### 3. 设置页 provider 与默认模型区域

- provider 基础信息卡片
- provider 状态横幅
- 默认模型下拉与失效项展示
- 认证字段和 Base URL 说明
- 调试模式开关说明
- 搜索与列表区域是否仍残留兼容状态术语

### 4. thinking 相关展示

- thinking 触发器默认态、不可用态、已选中态
- thinking 面板中的离散档位、预算模式、锁定态
- 模型切换后 thinking 不可用提示是否已收口
- 消息详情区域是否还残留能力来源、原因码、内部 code
- 设置页模型编辑器中的 thinking 说明是否与聊天面板一致

## 最终清查报告组织方式

后续实现完成后，建议交付一份独立 Markdown 清查报告，推荐路径为 [`2026-04-11-ui-debug-text-cleanup-audit-report.md`](./2026-04-11-ui-debug-text-cleanup-audit-report.md)。本次任务不创建该文件，只规定其组织方式。

### 报告结构建议

1. **摘要**
   - 本轮覆盖的页面与文件组
   - 删除、改写、保留三类条目数量
   - 是否完成四条重点回归路径
2. **逐文件清查表**
   - 按文件列出命中的文本与处理动作
3. **保留项附录**
   - 单列所有保留项与保留理由
4. **回归结果**
   - 记录自动化测试与手工路径复核结果
5. **遗留项**
   - 若确有暂缓项，必须说明原因与后续入口，不能静默遗漏

### 报告字段建议

| 字段 | 要求 |
| --- | --- |
| 文件 | 使用文件路径逐条记录，优先覆盖本计划中的高优先级文件 |
| 页面路径 | 标明聊天主界面、模型选择器、设置页或 thinking 展示 |
| 场景 | 标明空状态、失效选择、失败提示、状态横幅等具体触发场景 |
| 原文本 | 记录命中的原始文本 |
| 处理动作 | 删除、改写或保留 |
| 改写结果 | 若为改写项，记录最终文案 |
| 保留理由 | 若为保留项，说明其属于纯产品交互文本 |
| 测试覆盖 | 记录对应更新的测试文件或手工回归路径 |

## 建议的实施顺序与委派方式

若后续直接切换到 code 模式，建议按以下文件组顺序实施：

1. 聊天主界面与运行态文件组：[`CopilotMessageList.tsx`](../../frontend-copilot/src/features/copilot/CopilotMessageList.tsx)、[`copilot-chat-helpers.ts`](../../frontend-copilot/src/features/copilot/copilot-chat-helpers.ts)、[`CopilotRuntimeStateShell.tsx`](../../frontend-copilot/src/features/copilot/CopilotRuntimeStateShell.tsx)、[`copilot-panel-diagnostics.ts`](../../frontend-copilot/src/features/copilot/copilot-panel-diagnostics.ts)、[`NotConnectedNotice.tsx`](../../frontend-copilot/src/features/copilot/components/NotConnectedNotice.tsx)
2. 模型选择器文件组：[`model-picker.ts`](../../frontend-copilot/src/features/copilot/model-picker.ts)、[`ModelPicker.tsx`](../../frontend-copilot/src/features/copilot/components/ModelPicker.tsx)、[`CopilotComposer.tsx`](../../frontend-copilot/src/features/copilot/CopilotComposer.tsx)
3. 设置页文件组：[`DefaultModelRoutesSection.tsx`](../../frontend-copilot/src/workbench/settings/DefaultModelRoutesSection.tsx)、[`ProviderProfileDetails.tsx`](../../frontend-copilot/src/workbench/settings/ProviderProfileDetails.tsx)、[`settings-workspace-provider-helpers.ts`](../../frontend-copilot/src/workbench/settings/settings-workspace-provider-helpers.ts)、[`settings-workspace-model-options.ts`](../../frontend-copilot/src/workbench/settings/settings-workspace-model-options.ts)、[`GeneralSettingsSection.tsx`](../../frontend-copilot/src/workbench/settings/GeneralSettingsSection.tsx)
4. thinking 文件组：[`CopilotComposer.tsx`](../../frontend-copilot/src/features/copilot/CopilotComposer.tsx)、[`ThinkingControls.tsx`](../../frontend-copilot/src/components/ThinkingControls.tsx)、[`thinking-display.ts`](../../frontend-copilot/src/workbench/thinking-display.ts)、[`ProviderModelEditorDialog.tsx`](../../frontend-copilot/src/workbench/settings/ProviderModelEditorDialog.tsx)

这种顺序可以先消除用户最容易看到的噪音，再把设置页与 thinking 展示统一收口，最后集中完成测试与清查报告。

## 完成定义

本计划对应的后续代码实施，只有在同时满足以下条件时才算完成：

1. 聊天主界面、模型选择器、设置页 provider 与默认模型区域、thinking 展示四条重点路径均已清理。
2. 普通用户 UI 中不再出现内部实现、兼容迁移、诊断原因码、架构链路说明。
3. 所有保留项都能在清查报告中给出明确保留理由。
4. 相关前端测试已同步更新，且不再依赖旧内部术语文本。
5. 已交付逐文件清查报告，能够支撑后续复核。

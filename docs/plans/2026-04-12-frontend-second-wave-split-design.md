# 前端第二波巨石拆分设计

## 背景与目标

本轮设计聚焦前端第二波巨石拆分，目标对象限定为 [`frontend-copilot/src/features/copilot/CopilotChatPanel.tsx`](frontend-copilot/src/features/copilot/CopilotChatPanel.tsx) 链路，以及 [`frontend-copilot/src/workbench/settings/`](frontend-copilot/src/workbench/settings/) 中 provider 与 config-center 相关领域装配链路，并覆盖与这两组对象直接相关的大测试文件。

本轮工作的核心目标有四点。

1. 需要继续按照“职责混杂优先”的原则，处理当前前端中最容易跨越视图、状态、领域装配与测试支持边界的高风险对象。
2. 需要采用激进拆分路线，同步整理目录结构、模块命名与测试支撑落点，让后续重构不再受历史命名和目录包袱牵制。
3. 需要保留薄兼容入口文件，控制调用侧改动半径，避免在结构重组阶段放大接入成本。
4. 需要在整个过程中严格保持前端可观察行为不变，只重组内部模块与测试结构，不改变用户可见交互、状态语义和运行结果。

本设计只描述结构重组方案、职责落位方案、测试策略与实施节奏，不包含任何代码实现细节，不引入行为变更，也不顺带扩展到无直接关系的前端模块。

## 范围与边界

本轮实际重构范围如下。

- [`frontend-copilot/src/features/copilot/CopilotChatPanel.tsx`](frontend-copilot/src/features/copilot/CopilotChatPanel.tsx) 及其直接相关的状态、消息、输入区、装配支撑与测试文件。
- [`frontend-copilot/src/workbench/settings/`](frontend-copilot/src/workbench/settings/) 中 provider 与 config-center 相关领域装配链路，以及与之直接耦合的测试与测试支持文件。
- 与上述两组对象直接关联、且会阻碍拆分落位的大测试文件。

本轮明确不处理下列事项。

- 不将拆分范围扩展到整个 [`frontend-copilot/src/features/copilot/`](frontend-copilot/src/features/copilot/) 或整个 [`frontend-copilot/src/workbench/settings/`](frontend-copilot/src/workbench/settings/) 的全量普遍性整理。
- 不借本轮重构调整用户可见交互、页面布局语义、消息行为、设置项含义、保存时机或错误提示策略。
- 不顺带引入新的产品能力、状态模型重定义或 API 契约调整。
- 不在本轮文档中规定实现细节、具体命令或 CI 配置改造。

## 候选文件与问题概述

### CopilotChatPanel 组

[`frontend-copilot/src/features/copilot/CopilotChatPanel.tsx`](frontend-copilot/src/features/copilot/CopilotChatPanel.tsx) 处在 copilot 前端交互链路的核心位置。这类文件通常会同时承接页面壳层、消息列表渲染、输入区装配、交互事件分发、局部状态推导、流式消息协同以及测试挂接。

关键问题并不只是文件体量，而是关注点长期堆叠在同一入口层。只要视图编排、消息处理、输入区行为、派生状态和测试桥接没有切开，任何一个局部调整都可能穿透整条聊天面板链路，测试也会持续依赖“大而全”的整体装配。

结合已批准方向，当前这组对象适合向 `shell/`、`state/`、`composer/`、`messages/`、`test-support/` 等更明确的子域拆开，让页面骨架、会话状态、输入区逻辑、消息展示与测试支撑分别归位。

### Settings provider/config-center 组

[`frontend-copilot/src/workbench/settings/`](frontend-copilot/src/workbench/settings/) 中 provider 与 config-center 相关链路目前已经出现部分 shell、state、test-support 落位，但领域装配与相关测试仍然容易在旧入口周围聚集。尤其是 provider profiles、provider 编辑器、provider secrets、config center 公共字段与 settings 工作区装配之间，仍然存在职责交叉与路径分散的问题。

这一组对象的风险在于，页面 section、领域规则、控制器、列表辅助逻辑、编辑器挂载、测试夹具与测试 DOM 支持可能同时围绕旧路径演化。结果就是命名虽然开始改善，但模块边界仍然不稳定，后续新增需求仍会向原有装配入口回流。

本轮继续下沉到 `domains/provider-profiles/`、`domains/config-center/`、`test-support/` 等目录，是为了让 provider 与 config-center 的领域逻辑从“设置页局部实现细节”转成“可识别的独立子域”。

## 为何选择这两组作为第二波

第二波选择 [`frontend-copilot/src/features/copilot/CopilotChatPanel.tsx`](frontend-copilot/src/features/copilot/CopilotChatPanel.tsx) 链路与 [`frontend-copilot/src/workbench/settings/`](frontend-copilot/src/workbench/settings/) 中 provider/config-center 链路，原因仍然来自“职责混杂优先”的判定原则。

首先，这两组对象都处在高频改动且高耦合的位置。聊天面板是 copilot 交互主链路，provider 与 config-center 是设置工作区里最容易持续扩张的领域装配链路。它们的结构清晰度会直接影响后续改动成本。

其次，这两组对象都同时跨越多个关注点。聊天面板天然连接壳层、消息、输入、状态与测试；provider/config-center 链路则同时连接 section 视图、领域规则、控制器、表单状态与测试支持。这种交叉程度比单纯“行数偏大但职责单一”的文件更值得优先处理。

再次，这两组对象都已经具备明确的目录级承接方向。[`frontend-copilot/src/features/copilot/`](frontend-copilot/src/features/copilot/) 已经可以自然落向 `shell/`、`state/`、`composer/`、`messages/`、`test-support/`；[`frontend-copilot/src/workbench/settings/`](frontend-copilot/src/workbench/settings/) 已经明确继续下沉到 `domains/provider-profiles/`、`domains/config-center/`、`test-support/`。这意味着本轮无需再反复讨论大方向，可以直接围绕落位与职责收口展开设计。

最后，第一波已经建立了“薄兼容入口 + 子域拆分 + 测试同步迁移”的总体模式。第二波围绕这两组对象继续推进，能够把这套模式真正固化为前端重构标准，而不是停留在个别案例。

## 目标目录结构

### CopilotChatPanel 方向

[`frontend-copilot/src/features/copilot/`](frontend-copilot/src/features/copilot/) 下建议逐步形成如下结构。

```text
frontend-copilot/src/features/copilot/
  CopilotChatPanel.tsx
  shell/
    CopilotChatPanelShell.tsx
  state/
    useCopilotChatPanelState.ts
    CopilotChatPanelViewModel.ts
  composer/
    CopilotComposerShell.tsx
    CopilotComposerViewModel.ts
    CopilotComposerDomain.ts
  messages/
    CopilotMessagesShell.tsx
    CopilotMessagesViewModel.ts
    CopilotMessageListDomain.ts
  test-support/
    CopilotChatPanelTestSupport.tsx
    copilot-chat-panel-test-fixtures.ts
    copilot-chat-panel-test-dom.tsx
```

其中 [`frontend-copilot/src/features/copilot/CopilotChatPanel.tsx`](frontend-copilot/src/features/copilot/CopilotChatPanel.tsx) 继续保留为薄兼容入口，对外维持原导出面。实际页面壳层逻辑迁往 [`frontend-copilot/src/features/copilot/shell/CopilotChatPanelShell.tsx`](frontend-copilot/src/features/copilot/shell/CopilotChatPanelShell.tsx)，状态聚合迁往 `state/`，输入区相关职责迁往 `composer/`，消息展示与消息域逻辑迁往 `messages/`，测试支撑统一迁往 `test-support/`。

### Settings provider/config-center 方向

[`frontend-copilot/src/workbench/settings/`](frontend-copilot/src/workbench/settings/) 下建议在现有基础上继续收敛为如下结构。

```text
frontend-copilot/src/workbench/settings/
  ProviderProfilesSection.tsx
  ProviderProfilesSectionShell.tsx
  ProviderProfilesSectionDomain.ts
  useConfigCenterPublicField.ts
  domains/
    provider-profiles/
      ProviderProfilesSectionDomain.ts
      ProviderProfilesViewModel.ts
      provider-profile-list-helpers.ts
      provider-profiles.ts
      ProviderModelEditorDomain.ts
      ProviderSecretsDomain.ts
    config-center/
      ConfigCenterPublicFieldDomain.ts
      ConfigCenterPublicFieldViewModel.ts
      useConfigCenterPublicFieldState.ts
  test-support/
    SettingsWorkspaceTestSupport.tsx
    settings-workspace-test-bridge.ts
    settings-workspace-test-dom.tsx
    settings-workspace-test-fixtures.ts
    ProviderProfilesTestSupport.tsx
```

这里的重点不是制造更深的目录层级，而是让 provider-profiles 与 config-center 形成稳定的领域目录。现有旧路径下的入口文件继续保留为薄兼容入口，内部逐步转发到新的领域模块或壳层模块，避免一次性修改所有引用点。

## 模块职责分配

### CopilotChatPanel 模块分配

[`frontend-copilot/src/features/copilot/shell/CopilotChatPanelShell.tsx`](frontend-copilot/src/features/copilot/shell/CopilotChatPanelShell.tsx) 负责聊天面板页面壳层与区域编排。这个模块只处理整体布局、区域挂接与子模块拼装，不继续承接消息域细节、输入区状态细节或复杂副作用。

[`frontend-copilot/src/features/copilot/state/useCopilotChatPanelState.ts`](frontend-copilot/src/features/copilot/state/useCopilotChatPanelState.ts) 负责聚合聊天面板所需状态，并为壳层提供稳定的状态接口。涉及多来源派生、事件回调拼装与面板级状态协调的内容，应优先落在这里。

[`frontend-copilot/src/features/copilot/state/CopilotChatPanelViewModel.ts`](frontend-copilot/src/features/copilot/state/CopilotChatPanelViewModel.ts) 负责整理壳层可直接消费的视图模型，减少壳层组件中出现大量内联派生逻辑。

[`frontend-copilot/src/features/copilot/composer/`](frontend-copilot/src/features/copilot/composer/) 负责输入区子域。输入框、提交动作、输入区视图模型与输入相关领域规则，都应在这个子域内部闭合，而不是继续挂在聊天面板根文件上。

[`frontend-copilot/src/features/copilot/messages/`](frontend-copilot/src/features/copilot/messages/) 负责消息展示子域。消息列表渲染、消息项派生、消息显示相关领域规则与对应视图模型，都应在这一层集中表达。

[`frontend-copilot/src/features/copilot/test-support/`](frontend-copilot/src/features/copilot/test-support/) 负责聊天面板测试支撑，包括测试 fixtures、测试 DOM 支持与高层测试封装。测试文件应随着源码拆分同步贴近新的模块边界，避免继续依赖旧式整体装配。

### Settings provider/config-center 模块分配

[`frontend-copilot/src/workbench/settings/domains/provider-profiles/`](frontend-copilot/src/workbench/settings/domains/provider-profiles/) 负责 provider profiles 子域。列表辅助逻辑、profiles 数据映射、编辑器相关领域装配、secret 相关领域协同，都应尽量在这个子域中闭合，减少 [`frontend-copilot/src/workbench/settings/ProviderProfilesSection.tsx`](frontend-copilot/src/workbench/settings/ProviderProfilesSection.tsx) 对底层细节的直接感知。

[`frontend-copilot/src/workbench/settings/domains/config-center/`](frontend-copilot/src/workbench/settings/domains/config-center/) 负责 config-center 公共字段子域。公共字段状态、领域规则、视图模型与 hook 状态整理应在这里聚合，避免继续散落在 section 入口和通用 settings 工具文件之间。

[`frontend-copilot/src/workbench/settings/ProviderProfilesSectionShell.tsx`](frontend-copilot/src/workbench/settings/ProviderProfilesSectionShell.tsx) 继续承担 provider profiles 相关页面壳层职责，但应逐步退回到区域编排和子模块装配，不继续吸附领域控制逻辑。

[`frontend-copilot/src/workbench/settings/test-support/`](frontend-copilot/src/workbench/settings/test-support/) 负责 settings 中 provider/config-center 链路的测试支撑。测试桥、测试 DOM、fixtures 与更高层 test support 应集中维护，并随着领域拆分同步收口。

## 兼容性策略

本轮采用激进拆分路线，但兼容性策略保持保守。

- 原入口文件继续保留，例如 [`frontend-copilot/src/features/copilot/CopilotChatPanel.tsx`](frontend-copilot/src/features/copilot/CopilotChatPanel.tsx) 与 settings 旧路径下的 section、hook、domain 入口文件不直接删除。
- 旧入口文件改为薄兼容入口，只负责转发导出、挂接新壳层或做最小装配，不继续承载混杂职责。
- 模块迁移期间，对外导出面、调用方式、测试可见行为与运行时可观察行为都保持不变。
- 薄兼容入口只作为本轮重构的变更缓冲层，不作为长期并行结构的理由。等第二波稳定落地后，再评估后续是否进入清理阶段。

兼容策略的底线很明确：可以重组内部模块与测试结构，但不能改变前端可观察行为，也不能让调用侧承担超出本轮必要范围的迁移成本。

## 测试策略

测试策略已经批准为“行为不变、源码与测试同步拆分、分波次测试”。本轮按以下节奏执行。

- 先围绕 [`frontend-copilot/src/features/copilot/CopilotChatPanel.tsx`](frontend-copilot/src/features/copilot/CopilotChatPanel.tsx) 链路完成拆分，并优先运行与聊天面板直接相关的 vitest，确认聊天主链路在结构变化后行为保持稳定。
- 再围绕 [`frontend-copilot/src/workbench/settings/`](frontend-copilot/src/workbench/settings/) 中 provider/config-center 相关链路完成拆分，并运行对应 vitest，重点覆盖 provider profiles、编辑器、secrets、config-center 公共字段与 settings 工作区相关装配场景。
- 两组对象都完成拆分后，再补一轮覆盖这两组对象的前端回归测试，用于验证内部重组没有引起跨模块行为漂移。
- 测试文件与测试 support 必须跟随源码同步拆分，避免出现源码已经进入新子域、测试仍长期依赖旧装配结构的情况。
- 测试命名和测试落点应尽量对应新的模块边界，让失败信号能够更快指向 `shell/`、`state/`、`composer/`、`messages/`、`domains/` 或 `test-support/` 的具体问题。

本设计只定义测试策略与顺序，不在本文中规定具体命令、测试参数或 CI 细节。

## 命名规范

本轮建立统一命名规范，命名优先表达职责。

- 页面或区域壳层优先采用 `*Shell.tsx`，例如 [`CopilotChatPanelShell.tsx`](frontend-copilot/src/features/copilot/shell/CopilotChatPanelShell.tsx) 与 [`ProviderProfilesSectionShell.tsx`](frontend-copilot/src/workbench/settings/ProviderProfilesSectionShell.tsx)。
- 状态聚合 hook 优先采用 `use*State.ts`，例如 [`useCopilotChatPanelState.ts`](frontend-copilot/src/features/copilot/state/useCopilotChatPanelState.ts) 与 [`useConfigCenterPublicFieldState.ts`](frontend-copilot/src/workbench/settings/domains/config-center/useConfigCenterPublicFieldState.ts)。
- 视图模型优先采用 `*ViewModel.ts`，例如 [`CopilotChatPanelViewModel.ts`](frontend-copilot/src/features/copilot/state/CopilotChatPanelViewModel.ts) 与 [`ProviderProfilesViewModel.ts`](frontend-copilot/src/workbench/settings/domains/provider-profiles/ProviderProfilesViewModel.ts)。
- 测试支撑模块优先采用 `*TestSupport.tsx`，例如 [`CopilotChatPanelTestSupport.tsx`](frontend-copilot/src/features/copilot/test-support/CopilotChatPanelTestSupport.tsx) 与 [`SettingsWorkspaceTestSupport.tsx`](frontend-copilot/src/workbench/settings/test-support/SettingsWorkspaceTestSupport.tsx)。
- 领域规则与领域装配文件优先采用 `*Domain.ts`，例如 [`CopilotComposerDomain.ts`](frontend-copilot/src/features/copilot/composer/CopilotComposerDomain.ts) 与 [`ConfigCenterPublicFieldDomain.ts`](frontend-copilot/src/workbench/settings/domains/config-center/ConfigCenterPublicFieldDomain.ts)。
- 兼容入口维持原有公共名称，但内部职责应被压缩到最薄，避免“名称保留而巨石仍在”。

统一命名的目的，是让文件职责在目录树中直接可读，减少阅读者依赖历史背景猜测模块用途的成本。

## 实施波次建议

### 第二波-A：CopilotChatPanel 主骨架落位

先围绕 [`frontend-copilot/src/features/copilot/CopilotChatPanel.tsx`](frontend-copilot/src/features/copilot/CopilotChatPanel.tsx) 切开壳层与状态聚合边界。入口文件先收薄，页面编排进入 `shell/`，面板级状态整理进入 `state/`。这一阶段的目标是建立聊天面板的新主骨架。

### 第二波-B：CopilotChatPanel 子域与测试同步下沉

在主骨架稳定后，将输入区职责继续拆向 `composer/`，消息展示职责继续拆向 `messages/`，并同步整理 `test-support/`。这一阶段应尽量让输入区和消息子域各自闭合，减少聊天面板壳层对内部细节的直接感知。

### 第二波-C：Settings provider-profiles/config-center 领域收口

随后处理 [`frontend-copilot/src/workbench/settings/`](frontend-copilot/src/workbench/settings/) 中 provider-profiles 与 config-center 链路。已有的 shell、state、test-support 落位继续保留，但领域逻辑进一步沉入 `domains/provider-profiles/` 与 `domains/config-center/`，并同步让旧入口退化为薄兼容层。

### 第二波-D：测试收口与回归确认

最后统一检查聊天面板链路与 settings provider/config-center 链路中的兼容入口是否都已足够薄，并完成一轮覆盖两组对象的前端回归测试。这个阶段的重点是验证结构重组已经稳定落地，而不是继续扩大拆分范围。

## 风险与回滚思路

### 主要风险

- 聊天面板拆分后，`shell/`、`state/`、`composer/`、`messages/` 之间的依赖方向如果没有提前收紧，容易出现新的循环依赖或跨层回流。
- provider-profiles 与 config-center 领域继续下沉时，如果旧入口与新子域长期并存，可能形成“双重真实来源”，增加维护难度。
- 大测试文件同步拆分时，如果测试 fixtures、测试桥和真实装配层之间的对应关系没有一起收口，测试信号会变得更难解释。
- 命名虽然统一，但如果职责边界没有同步收紧，新的文件名会掩盖旧的结构问题，形成“名称更清晰、内部耦合依旧很高”的假改善。

### 风险控制思路

- 每次只围绕一个清晰子域推进迁移，先建立语义边界，再继续向内拆分，避免多个关注点同时大搬迁。
- 兼容入口始终保留到对应子域稳定之后，再决定是否进入后续清理阶段。
- 测试 support 与源码按同一波次迁移，减少新旧结构长期混用。
- 优先让壳层、状态、领域规则和测试支撑各自形成稳定落点，再处理更细粒度的内部抽取。

### 回滚思路

如果某一阶段拆分后复杂度上升、测试信号失真，回滚策略应限定在该阶段的边界内。

- 优先回滚新增子域中的落位调整，而不否定第二波聚焦对象本身。
- 保留的薄兼容入口可以作为短期缓冲层，让模块临时回挂到旧入口之下。
- 如果某个新子域暂时无法形成清晰闭环，可以退回“保留旧入口名义位置、只抽出最明确职责”的较保守方案。
- 只要前端可观察行为不变这一底线出现风险，就应暂停继续扩拆，先恢复结构稳定和测试可信度。

## 预期结果

完成本轮拆分后，前端代码库应达到以下状态。

- [`frontend-copilot/src/features/copilot/CopilotChatPanel.tsx`](frontend-copilot/src/features/copilot/CopilotChatPanel.tsx) 退化为薄兼容入口，聊天面板的壳层、状态、输入区、消息与测试支撑形成更清晰的子域边界。
- [`frontend-copilot/src/workbench/settings/`](frontend-copilot/src/workbench/settings/) 中 provider-profiles 与 config-center 相关逻辑形成稳定的领域目录，旧入口文件不再承担混杂职责。
- 测试文件与测试 support 跟随源码结构同步演进，大测试文件的拆分方向与产品模块边界保持一致。
- 命名规范在第二波中进一步固化，后续前端拆分可以直接复用这一套命名与兼容入口模式。
- 整个过程只重组内部模块与测试结构，不改变前端可观察行为。
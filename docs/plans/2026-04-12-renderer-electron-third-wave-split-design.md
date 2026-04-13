# renderer + electron 第三波巨石拆分设计

## 背景与目标

本轮设计聚焦 renderer 与 electron 并行推进的一波高风险巨石拆分，范围限定为三组对象及其直接相关的大测试文件、测试支撑文件。

- [`frontend-copilot/src/workbench/settings/domains/SettingsWorkspaceSectionsDomain.ts`](frontend-copilot/src/workbench/settings/domains/SettingsWorkspaceSectionsDomain.ts) 的剩余 section 装配链路。
- [`frontend-copilot/electron/config-center/service.ts`](frontend-copilot/electron/config-center/service.ts) 链路。
- [`frontend-copilot/electron/settings-workspace/service.ts`](frontend-copilot/electron/settings-workspace/service.ts) 链路。

若实施中确认必须联动，可以将 [`frontend-copilot/electron/config-center/main-process.ts`](frontend-copilot/electron/config-center/main-process.ts) 与 [`frontend-copilot/electron/settings-workspace/main-process.ts`](frontend-copilot/electron/settings-workspace/main-process.ts) 纳入同一波处理，并沿用同一套拆分规范。

本轮设计延续“职责混杂优先”的判定原则。优先级的依据不是文件行数，而是单个入口是否同时承接领域装配、持久化协调、补丁应用、订阅分发、IPC 协调、测试支撑等多类职责。一旦这些职责长期堆叠在同一位置，任何局部调整都会扩大改动半径，也会让测试继续依赖历史巨石入口。

本轮还明确采用激进拆分路线。拆分对象不只包括源码文件，还包括 renderer 与 electron 的目录结构、命名规范、测试支撑落点，以及过渡期所需的薄兼容入口文件。整个过程只重组内部模块与测试结构，不改变 renderer 与 electron 的可观察行为，不改变现有对外导出面、状态语义、交互结果和运行时契约。

本文只描述结构重组方案、职责落位方案、兼容策略、测试策略与实施节奏，不包含任何代码实现细节，也不引入行为变更。

## 范围与边界

本轮实际重构范围如下。

- [`frontend-copilot/src/workbench/settings/domains/SettingsWorkspaceSectionsDomain.ts`](frontend-copilot/src/workbench/settings/domains/SettingsWorkspaceSectionsDomain.ts) 及其直接关联的 section 视图、section 装配测试与测试支撑。
- [`frontend-copilot/electron/config-center/service.ts`](frontend-copilot/electron/config-center/service.ts) 及其直接关联的 bootstrap、persistence、patching、snapshot subscription、IPC 协调、大测试与测试支撑。
- [`frontend-copilot/electron/settings-workspace/service.ts`](frontend-copilot/electron/settings-workspace/service.ts) 及其直接关联的 bootstrap、persistence、patching、snapshot subscription、IPC 协调、大测试与测试支撑。
- 若拆分过程中无法避免，则将 [`frontend-copilot/electron/config-center/main-process.ts`](frontend-copilot/electron/config-center/main-process.ts) 与 [`frontend-copilot/electron/settings-workspace/main-process.ts`](frontend-copilot/electron/settings-workspace/main-process.ts) 一并纳入，并按相同规范收薄为兼容入口。

本轮明确不处理下列事项。

- 不借本轮拆分调整 renderer 页面结构、设置项含义、保存时机、错误提示策略或 electron 运行时行为。
- 不顺带引入新的产品能力、状态模型重定义、IPC 契约改造或配置协议变更。
- 不把范围扩展到与这三组对象无直接关系的 renderer 或 electron 模块。
- 不在本文中规定实现代码、具体命令、CI 细节或任何落地脚本。

## 候选文件与问题概述

### renderer settings section 装配组

[`frontend-copilot/src/workbench/settings/domains/SettingsWorkspaceSectionsDomain.ts`](frontend-copilot/src/workbench/settings/domains/SettingsWorkspaceSectionsDomain.ts) 处在 settings 工作区 section 装配链路的关键位置。它连接 [`frontend-copilot/src/workbench/settings/SettingsWorkspaceSections.tsx`](frontend-copilot/src/workbench/settings/SettingsWorkspaceSections.tsx)、[`frontend-copilot/src/workbench/settings/SettingsWorkspace.tsx`](frontend-copilot/src/workbench/settings/SettingsWorkspace.tsx) 与多个 section 视图文件，例如 [`frontend-copilot/src/workbench/settings/GeneralSettingsSection.tsx`](frontend-copilot/src/workbench/settings/GeneralSettingsSection.tsx)、[`frontend-copilot/src/workbench/settings/SearchSettingsSection.tsx`](frontend-copilot/src/workbench/settings/SearchSettingsSection.tsx)、[`frontend-copilot/src/workbench/settings/MemorySettingsSection.tsx`](frontend-copilot/src/workbench/settings/MemorySettingsSection.tsx)、[`frontend-copilot/src/workbench/settings/McpSettingsSection.tsx`](frontend-copilot/src/workbench/settings/McpSettingsSection.tsx)、[`frontend-copilot/src/workbench/settings/ExternalSourcesSection.tsx`](frontend-copilot/src/workbench/settings/ExternalSourcesSection.tsx)、[`frontend-copilot/src/workbench/settings/MiscSettingsSections.tsx`](frontend-copilot/src/workbench/settings/MiscSettingsSections.tsx) 与 [`frontend-copilot/src/workbench/settings/SustechInfoSection.tsx`](frontend-copilot/src/workbench/settings/SustechInfoSection.tsx)。

这组对象的主要问题，不在于“还有多少行代码”，而在于剩余 section 装配仍然容易把 section 列表生成、条件判断、派生字段拼装、跨 section 依赖串接和测试挂接堆在同一层。结果是 section 视图虽然已经分散到多个文件，真正的装配职责却还没有按 section 子域切开，后续任何一个 section 的调整都可能回流到同一个 domain 入口。

与之直接相关的测试与测试支撑也容易围绕旧入口集中，例如 [`frontend-copilot/src/workbench/settings/SettingsWorkspace.structure.test.tsx`](frontend-copilot/src/workbench/settings/SettingsWorkspace.structure.test.tsx)、[`frontend-copilot/src/workbench/settings/SettingsWorkspace.test-support.tsx`](frontend-copilot/src/workbench/settings/SettingsWorkspace.test-support.tsx) 以及 [`frontend-copilot/src/workbench/settings/test-support/`](frontend-copilot/src/workbench/settings/test-support/) 中的支撑文件。这些文件若不跟随源码一起整理，拆分后的模块边界就很难真正稳定下来。

### electron config-center service 组

[`frontend-copilot/electron/config-center/service.ts`](frontend-copilot/electron/config-center/service.ts) 是 config-center 领域的重要服务入口。按照已批准方向，这条链路将围绕 bootstrap、persistence、patching、snapshot subscription、IPC 或 main-process 协调、test-support 分层收口。

这组对象的风险来自服务入口同时承接多个运行阶段的职责。初始化、状态存取、补丁写入、快照广播、订阅管理以及主进程协调一旦长期共处于同一个 service 文件，结构上就会形成“单入口知道一切”的局面。这样的文件即使没有夸张的体量，也会在后续演进中持续吸附新职责。

如果实施中确认 [`frontend-copilot/electron/config-center/main-process.ts`](frontend-copilot/electron/config-center/main-process.ts) 与 service 链路存在紧耦合，也需要一并处理。原因很直接：服务拆分后，如果 main-process 仍保留旧式大装配逻辑，职责只会从一个巨石回流到另一个巨石。

### electron settings-workspace service 组

[`frontend-copilot/electron/settings-workspace/service.ts`](frontend-copilot/electron/settings-workspace/service.ts) 与 config-center service 组具备相似风险，但它直接面向 settings-workspace 的状态装配与主进程协调，因此更容易和 renderer settings 链路形成跨端联动。

这组对象如果继续把 bootstrap、持久化读写、patch 合成、snapshot 订阅、IPC 协调和测试支撑留在同一个 service 入口中，后续 renderer settings 调整就很容易穿透到 electron 内部组织方式。结构上看，这正是“renderer 与 electron 并行巨石”最典型的一种表现：表面上是两端分离，内部却都围绕单个入口堆积复杂职责。

若实施中确认 [`frontend-copilot/electron/settings-workspace/main-process.ts`](frontend-copilot/electron/settings-workspace/main-process.ts) 与 service 链路无法分开推进，也应按同样标准收薄并下沉实际协调职责。

## 为何选择这三组作为当前波次

当前波次选择上述三组对象，原因仍然来自“职责混杂优先”的判定原则。

首先，这三组都位于高频变更、跨层串接最密集的位置。renderer 侧的 section 装配链路处在 settings 工作区编排中心，electron 侧的两条 service 链路处在配置与 settings workspace 的运行中心。它们的结构清晰度会直接影响后续开发成本。

其次，这三组同时覆盖 renderer 与 electron 两端，而且边界关系天然对应。renderer 侧需要把 section 装配按职责切开，electron 侧需要把 service 按生命周期与领域职责切开。两端一起推进，能够形成一套更一致的拆分模板，而不是只在单侧局部优化。

再次，这三组都能带出大测试文件和测试支撑文件的同步重组。单纯处理源码而不处理测试支撑，旧巨石入口仍然会通过测试装配继续存在。把源码、测试和 test-support 一起纳入，才能真正消除结构回流。

最后，这三组都已经具备清晰的目录级承接方向。renderer 侧已经明确要继续下沉为更清楚的 section-domain 模块；electron 侧已经明确围绕 bootstrap、persistence、patching、snapshot subscription、IPC 或 main-process 协调、test-support 建立子域。大方向已经确定，本轮文档的重点是把这套方向落成可执行的结构设计。

## 目标目录结构

### renderer settings section 方向

[`frontend-copilot/src/workbench/settings/domains/SettingsWorkspaceSectionsDomain.ts`](frontend-copilot/src/workbench/settings/domains/SettingsWorkspaceSectionsDomain.ts) 继续保留为薄兼容入口，对外维持原有导出面。实际的剩余 section 装配职责继续下沉到更明确的 section-domain 模块。

建议形成如下结构。

- [`frontend-copilot/src/workbench/settings/domains/SettingsWorkspaceSectionsDomain.ts`](frontend-copilot/src/workbench/settings/domains/SettingsWorkspaceSectionsDomain.ts) 继续保留为兼容入口。
- [`frontend-copilot/src/workbench/settings/domains/sections/GeneralSettingsSectionDomain.ts`](frontend-copilot/src/workbench/settings/domains/sections/GeneralSettingsSectionDomain.ts) 负责 general section 的装配。
- [`frontend-copilot/src/workbench/settings/domains/sections/SearchSettingsSectionDomain.ts`](frontend-copilot/src/workbench/settings/domains/sections/SearchSettingsSectionDomain.ts) 负责 search section 的装配。
- [`frontend-copilot/src/workbench/settings/domains/sections/MemorySettingsSectionDomain.ts`](frontend-copilot/src/workbench/settings/domains/sections/MemorySettingsSectionDomain.ts) 负责 memory section 的装配。
- [`frontend-copilot/src/workbench/settings/domains/sections/McpSettingsSectionDomain.ts`](frontend-copilot/src/workbench/settings/domains/sections/McpSettingsSectionDomain.ts) 负责 MCP section 的装配。
- [`frontend-copilot/src/workbench/settings/domains/sections/ExternalSourcesSectionDomain.ts`](frontend-copilot/src/workbench/settings/domains/sections/ExternalSourcesSectionDomain.ts) 负责 external sources section 的装配。
- [`frontend-copilot/src/workbench/settings/domains/sections/SustechInfoSectionDomain.ts`](frontend-copilot/src/workbench/settings/domains/sections/SustechInfoSectionDomain.ts) 负责 sustech info section 的装配。
- [`frontend-copilot/src/workbench/settings/domains/sections/MiscSettingsSectionDomain.ts`](frontend-copilot/src/workbench/settings/domains/sections/MiscSettingsSectionDomain.ts) 用于承接 misc 区域中仍然需要保留的单一职责装配；如果 misc 当前仍混合多个零散区块，应继续往更细的单个 section 拆开。
- [`frontend-copilot/src/workbench/settings/test-support/sections/SettingsWorkspaceSectionsTestSupport.tsx`](frontend-copilot/src/workbench/settings/test-support/sections/SettingsWorkspaceSectionsTestSupport.tsx) 用于承接 section 装配级测试支撑。
- [`frontend-copilot/src/workbench/settings/test-support/sections/settings-workspace-sections-test-fixtures.ts`](frontend-copilot/src/workbench/settings/test-support/sections/settings-workspace-sections-test-fixtures.ts) 用于承接 section 装配级测试夹具。

这里的重点不是继续增加一个新的聚合层，而是让每个 section 拥有独立、可识别的 domain 模块。旧的 [`frontend-copilot/src/workbench/settings/domains/SettingsWorkspaceSectionsDomain.ts`](frontend-copilot/src/workbench/settings/domains/SettingsWorkspaceSectionsDomain.ts) 只保留最薄的装配入口和兼容导出，不再承担跨 section 的混杂职责。

### electron config-center 方向

[`frontend-copilot/electron/config-center/service.ts`](frontend-copilot/electron/config-center/service.ts) 继续保留为薄兼容入口，对外维持原服务入口名称。实际职责拆向分层子域。

建议形成如下结构。

- [`frontend-copilot/electron/config-center/service.ts`](frontend-copilot/electron/config-center/service.ts) 继续保留为兼容入口。
- [`frontend-copilot/electron/config-center/bootstrap/ConfigCenterBootstrapService.ts`](frontend-copilot/electron/config-center/bootstrap/ConfigCenterBootstrapService.ts) 负责初始化阶段装配。
- [`frontend-copilot/electron/config-center/persistence/ConfigCenterStore.ts`](frontend-copilot/electron/config-center/persistence/ConfigCenterStore.ts) 负责持久化读写与存储边界。
- [`frontend-copilot/electron/config-center/patching/ConfigCenterPatchService.ts`](frontend-copilot/electron/config-center/patching/ConfigCenterPatchService.ts) 负责补丁应用、补丁合成与写入前后的规则整理。
- [`frontend-copilot/electron/config-center/subscriptions/ConfigCenterSnapshotSubscription.ts`](frontend-copilot/electron/config-center/subscriptions/ConfigCenterSnapshotSubscription.ts) 负责快照订阅与广播。
- [`frontend-copilot/electron/config-center/ipc/ConfigCenterMainProcess.ts`](frontend-copilot/electron/config-center/ipc/ConfigCenterMainProcess.ts) 负责 IPC 或 main-process 协调逻辑。
- [`frontend-copilot/electron/config-center/test-support/ConfigCenterTestSupport.ts`](frontend-copilot/electron/config-center/test-support/ConfigCenterTestSupport.ts) 负责 config-center 链路的测试支撑。
- [`frontend-copilot/electron/config-center/test-support/config-center-test-fixtures.ts`](frontend-copilot/electron/config-center/test-support/config-center-test-fixtures.ts) 负责 config-center 链路的测试夹具。

若 [`frontend-copilot/electron/config-center/main-process.ts`](frontend-copilot/electron/config-center/main-process.ts) 必须联动，则它继续保留为薄兼容入口，内部协调逻辑转发到 [`frontend-copilot/electron/config-center/ipc/ConfigCenterMainProcess.ts`](frontend-copilot/electron/config-center/ipc/ConfigCenterMainProcess.ts)。

### electron settings-workspace 方向

[`frontend-copilot/electron/settings-workspace/service.ts`](frontend-copilot/electron/settings-workspace/service.ts) 继续保留为薄兼容入口，对外维持原有服务入口名称。实际职责拆向分层子域。

建议形成如下结构。

- [`frontend-copilot/electron/settings-workspace/service.ts`](frontend-copilot/electron/settings-workspace/service.ts) 继续保留为兼容入口。
- [`frontend-copilot/electron/settings-workspace/bootstrap/SettingsWorkspaceBootstrapService.ts`](frontend-copilot/electron/settings-workspace/bootstrap/SettingsWorkspaceBootstrapService.ts) 负责初始化阶段装配。
- [`frontend-copilot/electron/settings-workspace/persistence/SettingsWorkspaceStore.ts`](frontend-copilot/electron/settings-workspace/persistence/SettingsWorkspaceStore.ts) 负责 settings workspace 的持久化读写与存储边界。
- [`frontend-copilot/electron/settings-workspace/patching/SettingsWorkspacePatchService.ts`](frontend-copilot/electron/settings-workspace/patching/SettingsWorkspacePatchService.ts) 负责 patch 应用与状态写入协同。
- [`frontend-copilot/electron/settings-workspace/subscriptions/SettingsWorkspaceSnapshotSubscription.ts`](frontend-copilot/electron/settings-workspace/subscriptions/SettingsWorkspaceSnapshotSubscription.ts) 负责快照订阅与广播。
- [`frontend-copilot/electron/settings-workspace/ipc/SettingsWorkspaceMainProcess.ts`](frontend-copilot/electron/settings-workspace/ipc/SettingsWorkspaceMainProcess.ts) 负责 IPC 或 main-process 协调逻辑。
- [`frontend-copilot/electron/settings-workspace/test-support/SettingsWorkspaceTestSupport.ts`](frontend-copilot/electron/settings-workspace/test-support/SettingsWorkspaceTestSupport.ts) 负责 settings-workspace 链路的测试支撑。
- [`frontend-copilot/electron/settings-workspace/test-support/settings-workspace-test-fixtures.ts`](frontend-copilot/electron/settings-workspace/test-support/settings-workspace-test-fixtures.ts) 负责 settings-workspace 链路的测试夹具。

若 [`frontend-copilot/electron/settings-workspace/main-process.ts`](frontend-copilot/electron/settings-workspace/main-process.ts) 必须联动，则它继续保留为薄兼容入口，内部协调逻辑转发到 [`frontend-copilot/electron/settings-workspace/ipc/SettingsWorkspaceMainProcess.ts`](frontend-copilot/electron/settings-workspace/ipc/SettingsWorkspaceMainProcess.ts)。

## 模块职责分配

### renderer 侧 section-domain 模块分配

[`frontend-copilot/src/workbench/settings/domains/SettingsWorkspaceSectionsDomain.ts`](frontend-copilot/src/workbench/settings/domains/SettingsWorkspaceSectionsDomain.ts) 只负责兼容导出和最薄的聚合转发。它可以维持既有调用点不变，但不再继续承接复杂 section 细节。

各个 `*SectionDomain.ts` 文件负责本 section 的装配职责，包括 section 描述生成、字段映射、局部派生状态、与相邻依赖的最小化串接，以及本 section 所需的直接测试支撑接口。每个模块应尽量只服务一个 section，不再让剩余 section 逻辑重新汇聚成新的巨石。

[`frontend-copilot/src/workbench/settings/test-support/sections/SettingsWorkspaceSectionsTestSupport.tsx`](frontend-copilot/src/workbench/settings/test-support/sections/SettingsWorkspaceSectionsTestSupport.tsx) 负责 section 装配级测试支撑。测试夹具和测试 DOM 支撑应围绕新 section-domain 边界收口，减少对旧总装配入口的依赖。

### electron config-center 子域分配

[`frontend-copilot/electron/config-center/bootstrap/ConfigCenterBootstrapService.ts`](frontend-copilot/electron/config-center/bootstrap/ConfigCenterBootstrapService.ts) 负责 config-center 启动阶段的初始化装配。这里处理启动时所需的初始化顺序和依赖协同，但不负责长期持有状态写入或订阅分发逻辑。

[`frontend-copilot/electron/config-center/persistence/ConfigCenterStore.ts`](frontend-copilot/electron/config-center/persistence/ConfigCenterStore.ts) 负责持久化边界，包括读取、写入、序列化与底层存储交互。它不处理 IPC 协调，不承担高层领域装配。

[`frontend-copilot/electron/config-center/patching/ConfigCenterPatchService.ts`](frontend-copilot/electron/config-center/patching/ConfigCenterPatchService.ts) 负责补丁应用与补丁相关规则，避免补丁逻辑继续散落在 bootstrap、存储或主进程协调层中。

[`frontend-copilot/electron/config-center/subscriptions/ConfigCenterSnapshotSubscription.ts`](frontend-copilot/electron/config-center/subscriptions/ConfigCenterSnapshotSubscription.ts) 负责 snapshot 订阅和广播，明确区分“状态如何被存取”和“状态如何被通知”。

[`frontend-copilot/electron/config-center/ipc/ConfigCenterMainProcess.ts`](frontend-copilot/electron/config-center/ipc/ConfigCenterMainProcess.ts) 负责对接主进程或 IPC 协调。它只负责通信边界和调用编排，不内嵌持久化规则和补丁细节。

[`frontend-copilot/electron/config-center/test-support/ConfigCenterTestSupport.ts`](frontend-copilot/electron/config-center/test-support/ConfigCenterTestSupport.ts) 负责 config-center 的测试支撑，让服务测试不必继续依赖单体入口进行全量装配。

### electron settings-workspace 子域分配

[`frontend-copilot/electron/settings-workspace/bootstrap/SettingsWorkspaceBootstrapService.ts`](frontend-copilot/electron/settings-workspace/bootstrap/SettingsWorkspaceBootstrapService.ts) 负责 settings-workspace 启动阶段的初始化装配，处理启动时必需的依赖串接和顺序控制。

[`frontend-copilot/electron/settings-workspace/persistence/SettingsWorkspaceStore.ts`](frontend-copilot/electron/settings-workspace/persistence/SettingsWorkspaceStore.ts) 负责 settings workspace 的状态读写和存储边界，让持久化职责从 service 入口中剥离出来。

[`frontend-copilot/electron/settings-workspace/patching/SettingsWorkspacePatchService.ts`](frontend-copilot/electron/settings-workspace/patching/SettingsWorkspacePatchService.ts) 负责 patch 应用、状态变更合成和写入前后的规则整理。

[`frontend-copilot/electron/settings-workspace/subscriptions/SettingsWorkspaceSnapshotSubscription.ts`](frontend-copilot/electron/settings-workspace/subscriptions/SettingsWorkspaceSnapshotSubscription.ts) 负责 snapshot 订阅与广播，让状态变更通知从 service 入口中独立出来。

[`frontend-copilot/electron/settings-workspace/ipc/SettingsWorkspaceMainProcess.ts`](frontend-copilot/electron/settings-workspace/ipc/SettingsWorkspaceMainProcess.ts) 负责 IPC 或 main-process 协调逻辑，保证通信边界和内部领域规则分离。

[`frontend-copilot/electron/settings-workspace/test-support/SettingsWorkspaceTestSupport.ts`](frontend-copilot/electron/settings-workspace/test-support/SettingsWorkspaceTestSupport.ts) 负责 settings-workspace 链路的测试支撑，使大测试文件能够跟随分层结构同步拆分。

## 兼容性策略

本轮采用激进拆分路线，但兼容策略保持保守。

- [`frontend-copilot/src/workbench/settings/domains/SettingsWorkspaceSectionsDomain.ts`](frontend-copilot/src/workbench/settings/domains/SettingsWorkspaceSectionsDomain.ts)、[`frontend-copilot/electron/config-center/service.ts`](frontend-copilot/electron/config-center/service.ts) 与 [`frontend-copilot/electron/settings-workspace/service.ts`](frontend-copilot/electron/settings-workspace/service.ts) 继续保留为薄兼容入口。
- 若纳入 main-process 联动，则 [`frontend-copilot/electron/config-center/main-process.ts`](frontend-copilot/electron/config-center/main-process.ts) 与 [`frontend-copilot/electron/settings-workspace/main-process.ts`](frontend-copilot/electron/settings-workspace/main-process.ts) 也继续保留为薄兼容入口。
- 旧入口文件只负责转发导出、调用新模块或做最小装配，不再继续承载混杂职责。
- 对外导出面、调用方式、事件语义、保存行为、渲染结果、IPC 可观察行为与测试可见行为都保持不变。
- 兼容入口只作为本轮重组的缓冲层，不作为长期保留双重结构的理由。等这波拆分稳定后，再评估是否进入后续清理阶段。

兼容策略的底线很明确：内部组织方式可以重组，测试结构可以重组，但 renderer 与 electron 的可观察行为不能变化。

## 测试策略

测试策略已经批准为“行为不变、源码与直接相关测试或测试支撑同步拆分、分波次测试”。本轮按以下节奏组织。

### 第一阶段

先处理 renderer settings 相关 vitest。重点覆盖 [`frontend-copilot/src/workbench/settings/domains/SettingsWorkspaceSectionsDomain.ts`](frontend-copilot/src/workbench/settings/domains/SettingsWorkspaceSectionsDomain.ts) 链路及其直接相关的大测试、测试支撑，确认 section 装配拆分后页面结构、字段行为和 section 呈现语义保持稳定。

### 第二阶段

再处理 electron config-center 与 settings-workspace 相关测试。重点覆盖 [`frontend-copilot/electron/config-center/service.ts`](frontend-copilot/electron/config-center/service.ts) 与 [`frontend-copilot/electron/settings-workspace/service.ts`](frontend-copilot/electron/settings-workspace/service.ts) 拆分后的 bootstrap、persistence、patching、snapshot subscription、IPC 协调与测试支撑边界，确认结构重组没有改变服务行为。

### 第三阶段

最后补一轮 renderer + electron 联合回归测试，验证 renderer settings 与 electron settings-workspace 或 config-center 之间的协同保持稳定，确保跨端结构调整没有带来行为漂移。

### 测试落位要求

- 测试文件与测试支撑必须跟随源码同步拆分，不允许源码进入新结构后，测试仍长期依赖旧巨石装配。
- 大测试文件应优先按新模块边界收口，让失败信号能够更快指向 section-domain、bootstrap、store、patch、subscription、main-process 或 test-support 层。
- 任何测试重组都只服务于结构清晰度与可维护性提升，不改变断言语义，不改变业务行为预期。

本文只定义测试策略与顺序，不规定具体命令、测试参数或 CI 实现。

## 命名规范

本轮建立统一命名规范，命名优先表达职责。

- section 装配模块优先采用 `*SectionDomain.ts`，例如 [`GeneralSettingsSectionDomain.ts`](frontend-copilot/src/workbench/settings/domains/sections/GeneralSettingsSectionDomain.ts) 与 [`SearchSettingsSectionDomain.ts`](frontend-copilot/src/workbench/settings/domains/sections/SearchSettingsSectionDomain.ts)。
- 服务模块优先采用 `*Service.ts`，例如 [`ConfigCenterBootstrapService.ts`](frontend-copilot/electron/config-center/bootstrap/ConfigCenterBootstrapService.ts) 与 [`SettingsWorkspacePatchService.ts`](frontend-copilot/electron/settings-workspace/patching/SettingsWorkspacePatchService.ts)。
- 持久化边界优先采用 `*Store.ts`，例如 [`ConfigCenterStore.ts`](frontend-copilot/electron/config-center/persistence/ConfigCenterStore.ts) 与 [`SettingsWorkspaceStore.ts`](frontend-copilot/electron/settings-workspace/persistence/SettingsWorkspaceStore.ts)。
- 快照订阅模块优先采用 `*Subscription.ts`，例如 [`ConfigCenterSnapshotSubscription.ts`](frontend-copilot/electron/config-center/subscriptions/ConfigCenterSnapshotSubscription.ts) 与 [`SettingsWorkspaceSnapshotSubscription.ts`](frontend-copilot/electron/settings-workspace/subscriptions/SettingsWorkspaceSnapshotSubscription.ts)。
- 测试支撑模块优先采用 `*TestSupport.ts` 或 `*TestSupport.tsx`，例如 [`ConfigCenterTestSupport.ts`](frontend-copilot/electron/config-center/test-support/ConfigCenterTestSupport.ts) 与 [`SettingsWorkspaceSectionsTestSupport.tsx`](frontend-copilot/src/workbench/settings/test-support/sections/SettingsWorkspaceSectionsTestSupport.tsx)。
- 主进程协调模块优先采用 `*MainProcess.ts`，例如 [`ConfigCenterMainProcess.ts`](frontend-copilot/electron/config-center/ipc/ConfigCenterMainProcess.ts) 与 [`SettingsWorkspaceMainProcess.ts`](frontend-copilot/electron/settings-workspace/ipc/SettingsWorkspaceMainProcess.ts)。
- 兼容入口维持原有公共名称，例如 [`SettingsWorkspaceSectionsDomain.ts`](frontend-copilot/src/workbench/settings/domains/SettingsWorkspaceSectionsDomain.ts)、[`service.ts`](frontend-copilot/electron/config-center/service.ts) 与 [`service.ts`](frontend-copilot/electron/settings-workspace/service.ts)，但内部职责必须压缩到最薄。

统一命名的目的，是让阅读者在目录树中就能看懂职责分层，不必依赖历史背景去猜测文件用途。

## 实施波次建议

### 第三波-A：renderer 剩余 section 装配下沉

先围绕 [`frontend-copilot/src/workbench/settings/domains/SettingsWorkspaceSectionsDomain.ts`](frontend-copilot/src/workbench/settings/domains/SettingsWorkspaceSectionsDomain.ts) 建立新的 section-domain 边界。旧入口先收薄，再把剩余 section 装配逐步下沉到 `domains/sections/`。这一阶段同步整理直接相关的大测试和 section 测试支撑。

### 第三波-B：electron config-center service 分层

随后处理 [`frontend-copilot/electron/config-center/service.ts`](frontend-copilot/electron/config-center/service.ts) 链路，优先切开 bootstrap、store、patch、subscription 的职责边界，再根据需要处理主进程协调与 test-support 落位。这个阶段的重点是让 config-center service 不再作为单体总入口存在。

### 第三波-C：electron settings-workspace service 分层

接着处理 [`frontend-copilot/electron/settings-workspace/service.ts`](frontend-copilot/electron/settings-workspace/service.ts) 链路，沿用和 config-center 相同的分层标准。由于它与 renderer settings 更容易形成跨端联动，这一阶段应特别关注状态写入、快照广播与 IPC 协调之间的边界。

### 第三波-D：按需纳入 main-process 薄化

如果实施过程中确认 [`frontend-copilot/electron/config-center/main-process.ts`](frontend-copilot/electron/config-center/main-process.ts) 或 [`frontend-copilot/electron/settings-workspace/main-process.ts`](frontend-copilot/electron/settings-workspace/main-process.ts) 与 service 分层强耦合，就在这一阶段将它们同步收薄，并把内部协调逻辑迁入 `ipc/` 目录下的 `*MainProcess.ts` 模块。

### 第三波-E：联合回归与兼容入口复核

最后统一复核 renderer 与 electron 三组对象的兼容入口是否都已经足够薄，并完成一轮联合回归测试，确认结构重组已经稳定落地，且没有改变任何可观察行为。

## 风险与回滚思路

### 主要风险

- renderer section 装配拆分后，如果各个 `*SectionDomain.ts` 之间仍然保留过多跨域依赖，旧的聚合复杂度可能从一个入口分散成多个隐性耦合点。
- config-center 与 settings-workspace service 拆分后，如果 bootstrap、store、patch、subscription、IPC 协调之间的依赖方向没有收紧，容易出现新的循环依赖或职责回流。
- 若 main-process 与 service 只拆一半，旧式大装配可能从 [`service.ts`](frontend-copilot/electron/config-center/service.ts) 回流到 [`main-process.ts`](frontend-copilot/electron/config-center/main-process.ts)，或者从 [`service.ts`](frontend-copilot/electron/settings-workspace/service.ts) 回流到 [`main-process.ts`](frontend-copilot/electron/settings-workspace/main-process.ts)。
- 大测试文件迁移时，如果 fixtures、test-support 与真实装配边界没有同步调整，测试信号会变得更难解释。
- 名称看起来更清楚，并不自动代表结构已经健康。如果兼容入口之外的新模块仍然持续吸附混杂职责，新的目录树只会掩盖旧问题。

### 风险控制思路

- 每次只围绕一个清楚的职责面推进迁移，先切开边界，再继续向内细化，不在同一阶段同时搬动过多关注点。
- 兼容入口始终保留到对应子域稳定之后，再考虑后续清理，从而控制调用侧改动半径。
- 测试与 test-support 跟随源码同波次迁移，减少新旧结构长期并存。
- 优先保证依赖方向清楚，尤其要避免 section-domain 反向依赖总装配入口，也要避免 IPC 协调层重新直接掌握持久化和 patch 细节。

### 回滚思路

如果某个阶段拆分后复杂度上升、测试信号失真或行为稳定性出现风险，回滚策略应限定在该阶段边界内。

- 优先回滚新子域中的落位调整，不否定第三波聚焦对象本身。
- 依托保留的薄兼容入口，可以在短期内把个别职责临时回挂到旧入口之下，先恢复结构稳定和测试可信度。
- 若某个新子域暂时无法形成清楚闭环，可以退回“只抽出最明确职责”的较保守方案，但仍保持总方向不变。
- 只要 renderer 或 electron 的可观察行为出现变化风险，就应暂停继续扩拆，先恢复行为稳定，再决定是否继续下一波。

## 预期结果

完成本轮拆分设计后，预期达到以下状态。

- [`frontend-copilot/src/workbench/settings/domains/SettingsWorkspaceSectionsDomain.ts`](frontend-copilot/src/workbench/settings/domains/SettingsWorkspaceSectionsDomain.ts) 退化为薄兼容入口，剩余 section 装配形成更清楚的 section-domain 边界。
- [`frontend-copilot/electron/config-center/service.ts`](frontend-copilot/electron/config-center/service.ts) 与 [`frontend-copilot/electron/settings-workspace/service.ts`](frontend-copilot/electron/settings-workspace/service.ts) 退化为薄兼容入口，内部职责分别沉入 bootstrap、persistence、patching、snapshot subscription、IPC 协调与 test-support 子域。
- 若必须联动，[`frontend-copilot/electron/config-center/main-process.ts`](frontend-copilot/electron/config-center/main-process.ts) 与 [`frontend-copilot/electron/settings-workspace/main-process.ts`](frontend-copilot/electron/settings-workspace/main-process.ts) 也只保留薄兼容职责。
- 直接相关的大测试文件与测试支撑文件跟随源码同步拆分，测试边界与模块边界保持一致。
- 本轮只重组内部模块与测试结构，不改变 renderer 与 electron 的可观察行为。

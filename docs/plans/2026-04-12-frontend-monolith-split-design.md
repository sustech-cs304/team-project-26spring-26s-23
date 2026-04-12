# 前端第一波巨石拆分设计

## 背景与目标

本轮设计聚焦前端第一波巨石拆分，目标对象限定为 [`frontend-copilot/src/workbench/settings/SettingsWorkspace.tsx`](frontend-copilot/src/workbench/settings/SettingsWorkspace.tsx) 与 [`frontend-copilot/src/CopilotAppRoot.tsx`](frontend-copilot/src/CopilotAppRoot.tsx)，以及与这两组对象直接耦合的测试文件和支持文件。

本轮工作的核心目标有三点。

1. 需要拆开职责混杂的前端巨石文件，让页面壳层、领域装配、状态管理、启动流程与测试支持有更清晰的边界。
2. 需要同步整理目录结构与命名，使后续模块继续拆分时具备稳定、可延续的落点。
3. 需要在不改变前端可观察行为的前提下，只重组内部模块与测试结构，为后续持续演进创造条件。

本设计只覆盖结构重组方案，不包含任何代码实现细节，不引入行为变更，也不调整产品交互语义。

## 范围与边界

本轮实际重构范围如下。

- [`frontend-copilot/src/workbench/settings/SettingsWorkspace.tsx`](frontend-copilot/src/workbench/settings/SettingsWorkspace.tsx) 及其直接耦合的测试与 support 文件。
- [`frontend-copilot/src/CopilotAppRoot.tsx`](frontend-copilot/src/CopilotAppRoot.tsx) 及其直接耦合的测试与 support 文件。
- 如果在实施中确认 [`frontend-copilot/src/workbench/settings/useSettingsWorkspaceState.ts`](frontend-copilot/src/workbench/settings/useSettingsWorkspaceState.ts) 是完成拆分所必需的组成部分，则允许将其纳入同一轮重构。

本轮明确不处理下列事项。

- 不以全量前端目录为范围开展普遍性重命名。
- 不顺带改造无直接耦合关系的工作台模块。
- 不借本轮重构调整用户可见的交互、渲染结果、状态语义、缓存策略或启动时序。

## 候选文件与问题概述

### SettingsWorkspace 组

[`frontend-copilot/src/workbench/settings/SettingsWorkspace.tsx`](frontend-copilot/src/workbench/settings/SettingsWorkspace.tsx) 作为设置工作区入口，天然容易吸附多类职责。结合当前目录形态可以预见，这一组对象通常同时承担以下内容。

- 页面壳层与区域编排。
- 设置领域模块的装配与依赖串联。
- 复杂状态读取、派生与事件分发。
- provider、secret、form、hydration、save sideflow 等控制逻辑的汇聚。
- 大体量测试夹具、测试 DOM 桥接、交互 support 的集中挂载。

这类文件的问题不只是体量大，更关键的是职责交叉。一旦页面壳层、状态拼装、领域控制和测试支持长期堆在同一层，后续任何一个局部改动都容易穿透多个关注点，测试也会越来越依赖“全量装配”场景。

### CopilotAppRoot 组

[`frontend-copilot/src/CopilotAppRoot.tsx`](frontend-copilot/src/CopilotAppRoot.tsx) 处于应用启动链路上，通常同时承担以下职责。

- 启动期状态初始化。
- 缓存或启动资源预热。
- 边界层装配，例如错误边界、恢复边界或启动屏障。
- tracing、日志或启动观测逻辑。
- 根级渲染装配与测试支撑。

启动根组件如果同时承载状态、缓存、边界与 tracing，不仅维护成本高，也会让测试切面难以独立验证。任何启动链路调整都容易引发根文件级别的大面积改动。

## 为何选择这两组作为第一波

第一波选择 [`frontend-copilot/src/workbench/settings/SettingsWorkspace.tsx`](frontend-copilot/src/workbench/settings/SettingsWorkspace.tsx) 与 [`frontend-copilot/src/CopilotAppRoot.tsx`](frontend-copilot/src/CopilotAppRoot.tsx)，原因在于它们符合“职责混杂优先”的判定原则。

首先，这两组对象都处在高耦合入口位置。一个位于设置工作区主装配层，一个位于应用启动根装配层。它们天然会与多个子模块发生连接，拆分收益直接影响后续改造效率。

其次，这两组对象都带有明显的横切关注点。设置工作区横跨页面编排、领域控制与测试支撑；应用根组件横跨启动状态、缓存、边界与 tracing。相比单纯行数较大但职责单一的文件，这类对象更适合作为第一波拆分目标。

再次，这两组对象都拥有清晰的目录级承接方向。设置工作区可以向 `shell/`、`state/`、`domains/`、`test-support/` 下沉；应用根组件可以向 `bootstrap/` 子域拆开。目录边界已经明确，实施时不需要先争论结构方向。

最后，这两组对象一旦拆开，能够形成一套命名和兼容入口模式，为第二波重构提供模板，减少后续重复设计成本。

## 目标目录结构

### SettingsWorkspace 方向

[`frontend-copilot/src/workbench/settings/`](frontend-copilot/src/workbench/settings/) 下建议逐步形成如下结构。

```text
frontend-copilot/src/workbench/settings/
  SettingsWorkspace.tsx
  useSettingsWorkspaceState.ts
  shell/
    SettingsWorkspaceShell.tsx
    ProviderProfilesSectionShell.tsx
    ProviderProfileDetailsShell.tsx
  state/
    useSettingsWorkspaceState.ts
    settings-workspace-form-state.ts
    settings-workspace-hydration.ts
    settings-workspace-sideflows.ts
  domains/
    provider-profiles/
      ProviderProfilesSectionDomain.ts
      provider-profile-list-helpers.ts
      provider-profiles.ts
    providers/
      settings-workspace-provider-controller.ts
      settings-workspace-provider-helpers.ts
      settings-workspace-provider-list.ts
      settings-workspace-provider-model-editor.ts
      settings-workspace-provider-secrets.ts
    config-center/
      config-center-public-field-definitions.ts
      config-center-public-field-state.ts
      config-center-public-field-card-keydown.ts
  test-support/
    SettingsWorkspaceTestSupport.tsx
    settings-workspace-test-dom.tsx
    settings-workspace-test-fixtures.ts
    settings-workspace-test-bridge.ts
```

其中 [`frontend-copilot/src/workbench/settings/SettingsWorkspace.tsx`](frontend-copilot/src/workbench/settings/SettingsWorkspace.tsx) 继续作为薄兼容入口保留，对外维持原导出面；真正的页面壳层逻辑下沉到 [`frontend-copilot/src/workbench/settings/shell/SettingsWorkspaceShell.tsx`](frontend-copilot/src/workbench/settings/shell/SettingsWorkspaceShell.tsx)。如果 [`frontend-copilot/src/workbench/settings/useSettingsWorkspaceState.ts`](frontend-copilot/src/workbench/settings/useSettingsWorkspaceState.ts) 在实施中确认必须同步调整，则也应优先迁入 `state/`，再通过兼容入口保持旧路径可用。

### CopilotAppRoot 方向

[`frontend-copilot/src/`](frontend-copilot/src/) 下建议新增 `bootstrap/` 子域，形成如下结构。

```text
frontend-copilot/src/
  CopilotAppRoot.tsx
  bootstrap/
    CopilotAppRootShell.tsx
    bootstrap-state.ts
    bootstrap-cache.ts
    bootstrap-boundary.tsx
    startup-tracing.ts
    bootstrap-test-support.tsx
```

其中 [`frontend-copilot/src/CopilotAppRoot.tsx`](frontend-copilot/src/CopilotAppRoot.tsx) 继续保留为薄兼容入口，内部仅负责装配新的根壳层或转发导出。启动状态、缓存处理、边界组件与 tracing 从根文件中剥离，分别落入命名直接表达职责的模块。

## 模块职责分配

### SettingsWorkspace 模块分配

[`frontend-copilot/src/workbench/settings/shell/SettingsWorkspaceShell.tsx`](frontend-copilot/src/workbench/settings/shell/SettingsWorkspaceShell.tsx) 负责页面壳层与区域编排。这个模块应专注于视图层结构、区域装配和子 section 组合，不承载深层状态推导与副作用控制。

[`frontend-copilot/src/workbench/settings/state/useSettingsWorkspaceState.ts`](frontend-copilot/src/workbench/settings/state/useSettingsWorkspaceState.ts) 负责聚合设置工作区状态。它需要提供视图层所需的稳定状态接口，并统一组织 hydration、form state、保存 sideflow 与事件回调。

[`frontend-copilot/src/workbench/settings/domains/`](frontend-copilot/src/workbench/settings/domains/) 下的模块负责按领域划分装配逻辑。provider profiles、provider 管理、config center 公共字段等内容分别归属各自子域，从而降低“设置首页级别文件”对所有内部细节的直接感知。

[`frontend-copilot/src/workbench/settings/test-support/`](frontend-copilot/src/workbench/settings/test-support/) 负责测试支撑对象。测试 DOM、fixtures、bridge 与更高层测试 support 组件集中放置，避免测试依赖散落在产品模块周围，也方便测试跟随源码同步拆分。

### CopilotAppRoot 模块分配

[`frontend-copilot/src/bootstrap/CopilotAppRootShell.tsx`](frontend-copilot/src/bootstrap/CopilotAppRootShell.tsx) 负责根级装配壳层。它承担启动链路的视图编排，但不吞并所有初始化细节。

[`frontend-copilot/src/bootstrap/bootstrap-state.ts`](frontend-copilot/src/bootstrap/bootstrap-state.ts) 负责启动期状态准备与根装配需要的状态聚合。

[`frontend-copilot/src/bootstrap/bootstrap-cache.ts`](frontend-copilot/src/bootstrap/bootstrap-cache.ts) 负责启动缓存、资源预热或初始化缓存交互，避免缓存逻辑混在根组件渲染路径里。

[`frontend-copilot/src/bootstrap/bootstrap-boundary.tsx`](frontend-copilot/src/bootstrap/bootstrap-boundary.tsx) 负责错误边界、恢复边界或启动期保护边界的独立封装。

[`frontend-copilot/src/bootstrap/startup-tracing.ts`](frontend-copilot/src/bootstrap/startup-tracing.ts) 负责启动链路 tracing 与观测逻辑，减少根组件对日志和追踪细节的直接依赖。

[`frontend-copilot/src/bootstrap/bootstrap-test-support.tsx`](frontend-copilot/src/bootstrap/bootstrap-test-support.tsx) 负责应用根级测试支撑，便于 [`frontend-copilot/src/CopilotAppRoot.test.tsx`](frontend-copilot/src/CopilotAppRoot.test.tsx) 等测试在更小粒度下复用装配能力。

## 兼容性策略

本轮采用激进拆分路线，但兼容性策略必须保守。

- 原入口文件继续保留，例如 [`frontend-copilot/src/workbench/settings/SettingsWorkspace.tsx`](frontend-copilot/src/workbench/settings/SettingsWorkspace.tsx) 与 [`frontend-copilot/src/CopilotAppRoot.tsx`](frontend-copilot/src/CopilotAppRoot.tsx) 不直接删除。
- 旧入口改为薄兼容入口，只做转发导出、根壳层挂接或最小装配，不继续堆积职责。
- 如果 [`frontend-copilot/src/workbench/settings/useSettingsWorkspaceState.ts`](frontend-copilot/src/workbench/settings/useSettingsWorkspaceState.ts) 被迁入 `state/`，则原路径同样保留兼容入口，以降低一次性改动半径。
- 对外导出面、调用方式、测试可见行为与运行时可观察行为都保持不变。

兼容入口的存在不是为了长期维持双轨结构，而是为了在本轮重构中控制变更半径。等后续目录稳定后，再评估是否进入第二阶段清理。

## 测试策略

测试策略已经明确为“源码与测试同步拆分，行为不变”。本轮设计按以下原则执行。

- 每当 [`frontend-copilot/src/workbench/settings/SettingsWorkspace.tsx`](frontend-copilot/src/workbench/settings/SettingsWorkspace.tsx) 相关模块完成一轮拆分，就运行对应 vitest，优先覆盖结构、provider、secrets、persistence 等直接关联链路。
- [`frontend-copilot/src/CopilotAppRoot.tsx`](frontend-copilot/src/CopilotAppRoot.tsx) 链路拆分完成后，再运行与根启动装配直接相关的测试。
- 两组对象完成拆分后，补一轮前端相关回归测试，确认内部重组没有引入行为漂移。
- 测试 support 与 fixtures 必须跟随源码一起迁移，避免源码已经拆开而测试仍依赖旧式巨石装配。
- 测试命名和落点应贴近新的模块边界，使失败信号能够直接指向对应壳层、状态或领域模块。

本设计只定义测试策略与节奏，不在本轮文档中规定具体命令或 CI 实现细节。

## 命名规范

本轮建立统一命名规范，命名优先表达职责，而不是沿用含混的历史名称。

- 视图壳层统一优先采用 `*Shell.tsx`，例如 [`SettingsWorkspaceShell.tsx`](frontend-copilot/src/workbench/settings/shell/SettingsWorkspaceShell.tsx) 与 [`CopilotAppRootShell.tsx`](frontend-copilot/src/bootstrap/CopilotAppRootShell.tsx)。
- 边界组件统一优先采用 `*Boundary.tsx`，例如 [`bootstrap-boundary.tsx`](frontend-copilot/src/bootstrap/bootstrap-boundary.tsx)。
- 状态聚合 hook 统一优先采用 `use*State.ts`，例如 [`useSettingsWorkspaceState.ts`](frontend-copilot/src/workbench/settings/state/useSettingsWorkspaceState.ts)。
- 测试支撑模块统一优先采用 `*TestSupport.tsx` 或相近形式，例如 [`SettingsWorkspaceTestSupport.tsx`](frontend-copilot/src/workbench/settings/test-support/SettingsWorkspaceTestSupport.tsx)。
- 领域装配或领域规则文件统一优先采用 `*Domain.ts`，例如 [`ProviderProfilesSectionDomain.ts`](frontend-copilot/src/workbench/settings/domains/provider-profiles/ProviderProfilesSectionDomain.ts)。
- 启动链路相关模块统一优先采用 `*Bootstrap.ts` 或 `bootstrap-*` 族命名，例如 [`bootstrap-state.ts`](frontend-copilot/src/bootstrap/bootstrap-state.ts) 与 [`bootstrap-cache.ts`](frontend-copilot/src/bootstrap/bootstrap-cache.ts)。

统一命名的目标是让文件职责在目录树中一眼可读，降低“必须打开文件才能知道它大概做什么”的成本。

## 实施波次建议

### 第一波-A：SettingsWorkspace 壳层与状态边界落位

先围绕 [`frontend-copilot/src/workbench/settings/SettingsWorkspace.tsx`](frontend-copilot/src/workbench/settings/SettingsWorkspace.tsx) 切开壳层与状态边界。页面编排逻辑先迁往 `shell/`，状态聚合逻辑视情况迁往 `state/`。这一阶段重点是让入口文件变薄，建立新的主目录骨架。

### 第一波-B：SettingsWorkspace 领域与测试支持同步下沉

在主骨架稳定后，再将 provider profiles、provider 管理、config center 相关逻辑继续拆向 `domains/`，并同步调整 `test-support/` 下的测试桥接、fixtures 与 support 组件。此阶段每完成一个可闭合模块，就执行对应 vitest 以确认行为稳定。

### 第一波-C：CopilotAppRoot 启动链路拆分

随后处理 [`frontend-copilot/src/CopilotAppRoot.tsx`](frontend-copilot/src/CopilotAppRoot.tsx)，按 `bootstrap/` 子域切开状态、缓存、边界与 tracing。根组件保留薄入口，根装配壳层单独命名和承接。

### 第一波-D：兼容入口收口与前端回归验证

最后统一检查兼容入口是否都已收敛为薄层，并完成一轮前端相关回归验证。此阶段不追求继续扩大战果，重点是收口、校验和稳定落地。

## 风险与回滚思路

### 主要风险

- 入口文件虽然变薄，但内部 import 图可能在初期短暂变复杂，需要防止出现循环依赖。
- 测试 support 迁移时，如果路径与装配层次调整过快，容易导致测试夹具与真实装配脱节。
- [`frontend-copilot/src/workbench/settings/useSettingsWorkspaceState.ts`](frontend-copilot/src/workbench/settings/useSettingsWorkspaceState.ts) 是否纳入范围，可能在实施中改变拆分顺序，需要提前为兼容入口预留方案。
- `bootstrap/` 领域拆分时，如果边界、缓存、tracing 之间的调用顺序没有被稳定表达，可能造成启动链路阅读成本在短期内上升。

### 风险控制思路

- 每次只围绕一个清晰边界迁移文件，避免跨多个子域同时大搬迁。
- 兼容入口始终最后收薄，不在中途删除旧路径。
- 测试 support 与源码同批迁移，减少“源码新结构 + 测试旧结构”并存时间。
- 通过命名先建立语义边界，再做细颗粒模块移动，降低读者理解成本。

### 回滚思路

如果某一阶段拆分导致复杂度上升或测试信号失真，回滚策略应限定在该阶段边界内。

- 优先回滚新增子域中的落位调整，而不撤销整个第一波方向。
- 保留的薄兼容入口可以作为短期缓冲层，使模块能够临时回挂到旧入口之下。
- 如果 [`frontend-copilot/src/workbench/settings/useSettingsWorkspaceState.ts`](frontend-copilot/src/workbench/settings/useSettingsWorkspaceState.ts) 的同步迁移收益不足，可以退回“保持原位置 + 提供最小适配”的较保守方案。
- 只要前端可观察行为不变这一底线受到威胁，就应停止继续扩拆，优先恢复稳定结构。

## 预期结果

完成本轮拆分后，前端代码库应达到以下状态。

- [`frontend-copilot/src/workbench/settings/SettingsWorkspace.tsx`](frontend-copilot/src/workbench/settings/SettingsWorkspace.tsx) 与 [`frontend-copilot/src/CopilotAppRoot.tsx`](frontend-copilot/src/CopilotAppRoot.tsx) 不再承担多类混杂职责，而是退化为薄兼容入口。
- 设置工作区与应用启动链路形成更清晰的子域目录与职责边界。
- 测试文件和测试 support 与源码结构保持同步演进。
- 命名规则在第一波中落地，后续拆分可以直接复用。
- 整个过程只重组内部模块与测试结构，不改变前端可观察行为。

# 全仓剩余可拆分文件收尾设计

## 背景与目标

此前几轮拆分已经分别处理了后端、前端 renderer 与 electron 中最早暴露出的巨石入口，并形成了按领域下沉、保留薄兼容入口、让源码与直接相关测试同步治理的基本路线。当前仓库仍有一批“剩余可拆分文件”，但本轮收尾的判断标准继续落在职责混杂程度、变更风险与后续维护收益上，而不是单纯追求单文件越来越少。

本轮目标聚焦三点。

- 本轮要把仓内仍然承担多重职责、已经持续抬高改动半径的剩余巨石与混杂文件收口，覆盖 [`backend/`](backend/)、[`frontend-copilot/src/`](frontend-copilot/src/) 与 [`frontend-copilot/electron/`](frontend-copilot/electron/) 三个实现面。
- 本轮继续采用已批准的 B 路线，也就是先按子系统分波收尾，再在每个子系统内部按领域分层拆分，并保留薄兼容入口，控制旧导入路径与旧调用点的失效风险。
- 本轮所有设计都以可观察行为稳定为前提，要求 HTTP 行为、renderer 交互行为、electron IPC 与 runtime 行为、既有测试语义与仓内稳定入口路径保持不变。

本轮的完成标准，落在剩余真正高风险的巨石与职责混杂文件已经形成稳定边界。边界已经清晰、职责已经单一、只是在体量或命名上不够“整齐”的小文件，维持现状即可，不列入本轮实现主体。

## 与此前几轮拆分的承接关系

本设计直接承接以下几份已批准设计文档。

- [`docs/plans/2026-04-12-backend-monolith-split-design.md`](docs/plans/2026-04-12-backend-monolith-split-design.md) 已经为后端建立了按运行域、传输层、共享层拆分的方向，并确立了薄入口兼容策略。
- [`docs/plans/2026-04-12-frontend-monolith-split-design.md`](docs/plans/2026-04-12-frontend-monolith-split-design.md) 已经为 renderer 第一波建立了 shell、state、domains、test-support 这一套前端拆分骨架。
- [`docs/plans/2026-04-12-frontend-second-wave-split-design.md`](docs/plans/2026-04-12-frontend-second-wave-split-design.md) 已经把聊天面板链路与 settings 中 provider、config-center 领域继续往子域目录下沉。
- [`docs/plans/2026-04-12-renderer-electron-third-wave-split-design.md`](docs/plans/2026-04-12-renderer-electron-third-wave-split-design.md) 已经把 renderer settings section 装配与 electron 中 config-center、settings-workspace 的服务分层模式固定下来。

本文件不推翻前述设计，而是把它们收束为一份全仓收尾方案。前几轮文档已经解决了“如何拆”的方向问题；本轮文档解决的是“仓内还剩哪些真正值得继续拆的对象、按什么波次收尾、如何把测试和提交门禁一起卡住”的问题。

因此，本轮所有新增拆分都应复用此前几轮已经确立的结构语言。

- 后端继续沿用按处理层、服务层、映射层、流层与共享层收口的思路。
- renderer 继续沿用 shell、state、view-model、domain 与 test-support 的分层方式。
- electron 继续沿用 bootstrap、service、store、subscription、main-process、test-support 这些稳定命名与职责边界。

## 全仓收尾范围与非范围

### 收尾范围

本轮收尾范围覆盖以下目录与对象。

- [`backend/`](backend/) 纳入本轮实现主体，重点处理仍然承担多条测试主线、报告整理、夹具拼装、数据采样、运行编排、映射转换、持久化协调等混杂职责的剩余文件。
- [`frontend-copilot/src/`](frontend-copilot/src/) 纳入本轮实现主体，重点处理仍然同时承担页面壳层、状态编排、交互副作用、测试夹具与大测试装配的 renderer 文件。
- [`frontend-copilot/electron/`](frontend-copilot/electron/) 纳入本轮实现主体，重点处理仍然同时承担 service、IPC、subscription、runtime 协调、preload 暴露与测试支撑的高耦合入口文件。
- 与以上三处直接相关的大测试文件、测试桥、测试夹具、测试 DOM 支撑与必要脚本支撑，跟随对应波次同步治理。

### 非范围

以下对象不进入本轮实现主体。

- [`docs/`](docs/) 与 [`website/`](website/) 在本轮只做扫描与记录，除本设计文档这类必须的方案记录外，不主动进行结构重构。
- 与三大子系统没有直接耦合关系的周边模块，不借本轮顺带展开普遍性整理。
- 行为层面的调整不在本轮范围内。界面交互、接口契约、IPC 语义、运行时策略、数据格式与用户可见结果都维持现状。
- 边界已经清晰的小文件不纳入本轮“为了统一而拆”的对象池。本轮只处理真正还在混杂职责的剩余文件。

## 总体收尾原则

本轮全仓收尾统一遵守以下原则。

- 判断优先级时，始终把职责混杂程度放在文件体量之前。只要一个文件同时承接多个稳定性敏感职责，就应优先排入收尾范围。
- 子系统之间按波次顺序推进，子系统内部按领域分层拆分，避免一次性全仓并行改造造成定位困难。
- 原有稳定导入路径、稳定入口文件与被仓内广泛依赖的总装配点，继续保留为薄兼容入口。
- 源码、直接相关大测试与测试支撑必须同波次治理，避免源码已经分层而测试仍长期依赖历史巨石入口。
- 每一波都以测试通过作为进入提交阶段的前提。测试未通过时，该波次工作可以继续修正，但不能形成提交，也不能进入下一波。

## 三个子系统的剩余高风险候选类型与重点方向

### [`backend/`](backend/)

后端在此前几轮之后，剩余的高风险对象主要集中在“大测试仍兼具多条主线”和“少量模块仍混合编排、映射与持久化职责”这两类位置。

- [`backend/tests/integration/test_comprehensive_live.py`](backend/tests/integration/test_comprehensive_live.py) 这一类 live integration 文件仍然是本轮最优先对象。此类文件通常同时承接用例编排、报告整理、夹具拼装、数据采样与断言聚合，任何一个场景变化都可能牵动整份测试入口。
- 部分后端测试支撑仍可能把报告生成、夹具构造、测试数据选择与环境准备叠在同一文件中。这类对象适合沿着场景模块、夹具模块、报告辅助模块与公共测试支撑模块继续切开。
- 少量业务模块若仍同时承担运行编排、领域对象映射与持久化协调，也应在这一波中收尾，让流程控制、结构转换和存储边界各自落位。

后端收尾的重点方向，是把“测试主线”“夹具与采样支撑”“报告或断言聚合”“服务编排与映射协调”从单一入口里拆开，同时保留稳定的测试入口或模块级兼容导出，避免仓内旧引用与旧测试路径立刻失效。

### [`frontend-copilot/src/`](frontend-copilot/src/)

renderer 侧本轮优先对象，集中在仍然同时承接页面壳层、状态编排、交互副作用与测试夹具的剩余链路。

- [`frontend-copilot/src/workbench/assistant/`](frontend-copilot/src/workbench/assistant/) 链路应作为重点扫描对象。凡是仍同时连接页面壳层、会话状态、动作分发、副作用调用和测试挂接的文件，都应进入本轮候选清单。
- [`frontend-copilot/src/workbench/settings/`](frontend-copilot/src/workbench/settings/) 中尚未收口的 settings 支撑文件也属于优先方向。尤其是那些仍然同时承担 section 装配、状态桥接、领域规则与测试辅助的支撑入口，仍有继续下沉空间。
- 尚未分域的大测试文件同样纳入本轮。只要测试仍依赖“大而全”的 renderer 装配入口，就应跟随产品模块边界一起下沉到更清晰的 test-support 或领域测试模块。

renderer 收尾的重点方向，是继续把剩余链路压缩为页面壳层、状态层、领域层与测试支撑层四个稳定落点，让页面入口只负责挂接，而让真正变化频繁的状态编排与交互副作用落回各自子域。

### [`frontend-copilot/electron/`](frontend-copilot/electron/)

electron 侧在 config-center 与 settings-workspace 已经完成主要分层后，剩余高风险对象主要集中在仍然掌握多个跨端职责的外层入口。

- [`frontend-copilot/electron/preload.ts`](frontend-copilot/electron/preload.ts) 需要重点检查。只要文件仍同时承担 preload 暴露、bridge 组装、订阅绑定、运行时代理与测试支撑挂接，就应继续往更细的暴露层、桥接层和测试支撑层收口。
- [`frontend-copilot/electron/renderer-ipc.ts`](frontend-copilot/electron/renderer-ipc.ts) 需要重点检查。只要文件仍同时掌握 IPC 协议整理、transport 注册、domain handler 协调与测试夹具，就应继续按 contract、registration、transport、test-support 等职责下沉。
- [`frontend-copilot/electron/main-services.ts`](frontend-copilot/electron/main-services.ts) 需要重点检查。只要文件仍同时管理 runtime 服务装配、生命周期协调、跨 service 聚合与测试支撑，就应继续把服务初始化、运行时协调与公共服务注册分层。
- 除了上述高耦合入口，仍然承担 service、IPC、subscription、runtime 协调、preload 暴露和测试支撑混合职责的 electron 文件，都属于本轮同类对象。

electron 收尾的重点方向，是在已经形成的 service 分层模板外，再把高耦合外层入口收薄，让 preload、renderer IPC、主进程服务装配与测试支撑形成更清楚的边界。

## 三波执行架构

本轮执行顺序已经批准为三波串行推进，任何一波未完成门禁验证时，后续波次都不进入实现阶段。

### 第一波

第一波专门处理 [`backend/`](backend/)。

- 这一波只收尾后端剩余高风险对象，以及与之直接相关的大测试、测试夹具、报告辅助与必要测试支撑。
- 这一波的重点是优先收口 [`backend/tests/integration/test_comprehensive_live.py`](backend/tests/integration/test_comprehensive_live.py) 一类文件，并同步处理仍兼具编排、映射、持久化职责的少量后端模块。
- 这一波完成后，先运行后端相关回归。只有回归通过，才允许形成第 1 次提交。

### 第二波

第二波专门处理 [`frontend-copilot/src/`](frontend-copilot/src/)。

- 这一波只收尾 renderer 剩余高风险对象，以及与之直接相关的大测试、测试夹具、测试桥与测试支撑。
- 这一波的重点是 assistant 链路、剩余 settings 支撑文件以及尚未分域的大测试文件。
- 这一波完成后，先运行 renderer 相关回归。只有回归通过，才允许形成第 2 次提交。

### 第三波

第三波专门处理 [`frontend-copilot/electron/`](frontend-copilot/electron/)。

- 这一波只收尾 electron 剩余高风险对象，以及与之直接相关的测试、测试支撑与必要脚本收尾。
- 这一波的重点是 preload、renderer IPC、main services 一类高耦合入口，以及它们与 runtime 协调、IPC 注册、订阅分发、测试支撑之间的残余混杂职责。
- 这一波完成后，先运行 electron 与前端联合回归。只有回归通过，才允许形成第 3 次提交。

这三波的顺序不能颠倒，也不应交叉混入。原因很直接：后端、renderer、electron 的测试边界不同，提交边界也不同，串行推进更容易把问题压缩在单个子系统内定位。

## 命名规范与薄兼容入口策略

### 命名规范

本轮继续沿用此前几轮已经稳定下来的命名规则，并把它们推广到全仓剩余收尾对象。

- 后端中，处理入口优先采用 handler 族命名，服务编排优先采用 service 族命名，结构转换优先采用 mapper 族命名，流式逻辑优先采用 stream 族命名，共享依赖、错误与模型继续放在共享目录中。
- renderer 中，页面或区域壳层优先采用 Shell 族命名，状态聚合优先采用 use 开头、State 结尾的命名，视图模型优先采用 ViewModel 族命名，领域装配优先采用 Domain 族命名，测试支撑优先采用 TestSupport 族命名。
- electron 中，初始化装配优先采用 BootstrapService 族命名，持久化边界优先采用 Store 族命名，订阅广播优先采用 Subscription 族命名，主进程协调优先采用 MainProcess 族命名，测试支撑优先采用 TestSupport 族命名。

命名规范的核心目的，是让阅读者仅通过目录树就能判断职责落点，从而压缩“打开文件才能猜边界”的成本，也降低未来继续回流到巨石入口的概率。

### 薄兼容入口策略

本轮所有拆分对象都继续保留薄兼容入口，但薄入口只承担最小职责。

- 原有稳定公共路径继续保留。例如 [`frontend-copilot/electron/preload.ts`](frontend-copilot/electron/preload.ts)、[`frontend-copilot/electron/renderer-ipc.ts`](frontend-copilot/electron/renderer-ipc.ts) 与 [`frontend-copilot/electron/main-services.ts`](frontend-copilot/electron/main-services.ts) 这类高耦合入口，在收尾后仍可保留原文件路径，对外继续承担兼容导出或最小顶层装配。
- 兼容入口内部只允许保留转发导出、最小装配和稳定入口语义，不再继续吸附领域规则、映射细节、测试夹具与副作用协同。
- 如果某个大测试文件已经承担仓内稳定入口角色，则可以保留一个聚合型薄测试入口，把具体场景、夹具和测试支撑下沉到更细模块；如果没有路径兼容需求，则直接按新边界落位即可。
- 兼容入口属于本轮重构的缓冲层，不属于长期双轨结构。待本轮收尾稳定后，再由后续工作决定是否清理。

## 测试与提交门禁策略

本轮的测试与提交门禁按照波次严格执行。

- 每一波都必须让源码、直接相关大测试与测试支撑同步调整，再运行该波次对应回归，确认结构变化没有引入行为漂移。
- 第一波的门禁落在后端相关回归。后端测试未通过时，第一波不能提交，也不能进入第二波。
- 第二波的门禁落在 renderer 相关回归。renderer 测试未通过时，第二波不能提交，也不能进入第三波。
- 第三波的门禁落在 electron 与前端联合回归。跨端协同测试未通过时，第三波不能提交。
- 任一波次若存在测试失败、断言语义漂移、路径兼容破坏或可观察行为变化风险，都应停留在该波次内修正，不得带着未收敛问题推进后续工作。

门禁的重点不只是“有测试结果”，而是让每一波都具备清楚的收口条件。只有当该子系统的结构调整已经通过本子系统回归验证，提交边界才是可信的。

## Git 分批次提交策略

本轮后续实现阶段采用三次提交的分批策略，提交边界与波次边界完全一致。

- 第 1 次提交只包含 [`backend/`](backend/) 波次结果，以及与这一波直接相关的测试与测试支撑变更。
- 第 2 次提交只包含 [`frontend-copilot/src/`](frontend-copilot/src/) 波次结果，以及与这一波直接相关的测试与测试支撑变更。
- 第 3 次提交只包含 [`frontend-copilot/electron/`](frontend-copilot/electron/) 波次结果，以及与这一波直接相关、确有必要的测试或脚本收尾。

三次提交之间不混入“下一波已开始但尚未完成”的改动，也不把 [`docs/`](docs/) 与 [`website/`](website/) 作为实现主体的一部分带入提交。当前这份 [`docs/plans/2026-04-12-final-repo-sweep-design.md`](docs/plans/2026-04-12-final-repo-sweep-design.md) 只承担方案记录职责，不能被理解为本轮要顺带重构文档站点或网站目录。

提交信息保持项目既有风格，建议继续使用短而明确的表达。例如，后端波次可使用“refactor(backend): split remaining mixed live tests and services.”这一类风格；renderer 与 electron 波次也沿用同样的短句结构。

## 风险、回滚与剩余技术债处理原则

### 主要风险

- 若某一波只切开文件，却没有同步切开依赖方向，新的目录树可能只是把旧耦合分散到更多文件里，阅读成本反而上升。
- 若源码拆分后测试仍长期依赖历史大入口，测试表面上仍然通过，但结构回流会在后续迭代中重新出现。
- 若 electron 外层入口只做了一半拆分，旧的混杂职责可能从一个入口回流到另一个入口，尤其容易在 preload、IPC 与主进程服务装配之间反复聚集。
- 若后端 live 大测试拆分时没有同步收口夹具、报告与数据采样支撑，测试文件会从单体巨石变成“多文件但仍强耦合”的假拆分状态。
- 若提交边界和波次边界混杂，回滚时就很难按子系统整体恢复，风险会直接扩大到后续波次。

### 回滚原则

- 回滚以波次为单位执行，不采用跨多个波次的零散撤回方式。
- 如果某一波测试迟迟不能收敛，就整体回退该波，而不是在多个新旧文件之间局部拼补。
- 后续波次必须建立在前一波已经通过门禁、提交边界清楚的前提上。前一波未收敛时，后续波次保持冻结状态。
- 薄兼容入口可以作为短期缓冲层，让部分职责临时回挂到旧入口下，以便优先恢复行为稳定和测试可信度。

### 剩余技术债处理原则

- 本轮结束后，仍然边界清楚的小文件可以继续保留。它们不因“风格统一”进入下一轮强制拆分。
- 本轮扫描时若发现 [`docs/`](docs/) 或 [`website/`](website/) 中存在结构问题，只记录为观察项，不并入本轮实现主体。
- 某些对象若在本轮中无法在不放大行为风险的前提下安全拆分，可以缩小落地范围，并把问题登记为剩余技术债，等后续出现明确收益时再处理。
- 未来是否继续追加拆分，应继续以职责混杂、改动频率和测试定位成本作为判断依据，而不是把“零巨石”理解成形式上的统一要求。

## 结论

本轮全仓收尾的核心任务，是把 [`backend/`](backend/)、[`frontend-copilot/src/`](frontend-copilot/src/) 与 [`frontend-copilot/electron/`](frontend-copilot/electron/) 中仍然真正高风险、职责仍然混杂的剩余文件收口，并通过三波串行推进、薄兼容入口、测试门禁与分批提交，把最后一轮可拆分对象控制在可回滚、可验证、可持续维护的范围内。

收尾完成后，仓库可以接受“仍然存在少量边界清楚的小文件”这一状态；真正需要被消化的对象，是那些继续把多类职责压在同一个入口里的剩余巨石文件。
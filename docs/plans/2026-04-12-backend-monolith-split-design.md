# 后端巨石文件拆分设计

## 背景与目标
当前后端存在少量职责明显混杂的巨石文件，它们同时承担路由编排、运行时控制、协议转换、应用装配与安全边界等多类职责，已经开始提高理解成本、修改风险与测试定位难度。本轮设计只针对三处优先级最高的后端文件展开首波拆分规划：[`backend/app/copilot_runtime/message_runs.py`](backend/app/copilot_runtime/message_runs.py)、[`backend/app/copilot_runtime/router.py`](backend/app/copilot_runtime/router.py) 和 [`backend/app/desktop_runtime/server.py`](backend/app/desktop_runtime/server.py)。

这次重构的核心目标是重组内部模块边界，降低单文件职责密度，并借机建立更清晰的目录组织与命名规范。整个方案明确保持外部 HTTP 行为、运行时行为、兼容导入路径与对接方式不变，避免将结构调整演变成行为变更。

本轮不追求一次性消除所有历史结构问题，也不以文件行数作为唯一判断标准。优先级判断以职责混杂程度为核心：只要一个文件同时承载多类稳定性敏感职责，即使行数仍可接受，也优先纳入拆分范围。

## 候选文件与问题概述
### `backend/app/copilot_runtime/message_runs.py`
该文件通常处于消息运行主流程中心，容易同时混入运行编排、请求解析、流式响应组织、状态映射、异常处理和对外返回格式等逻辑。问题不在于代码长短本身，而在于单次修改经常需要跨越多个逻辑层，导致测试粒度不清，代码审阅时也难以快速判断边界是否被破坏。

### `backend/app/copilot_runtime/router.py`
该文件往往既承担 API 注册职责，也夹带请求入口的参数整形、依赖拼装、响应封装和少量运行时策略判断。随着接口逐步扩展，路由层会逐渐从“声明入口”演化成“入口加半个业务层”，后续任何协议调整或运行时扩展都会继续挤压文件边界。

### `backend/app/desktop_runtime/server.py`
该文件大概率承担应用创建、生命周期挂载、中间件配置、诊断路由、安全相关处理和兼容导出等职责。它的典型问题是应用装配逻辑与具体能力实现纠缠在一起，使得新增安全策略、调整诊断接口或替换中间件时，都需要在同一个入口文件内修改，回归面过大。

### 其他候选文件为何暂缓
本轮只实际重构三处文件，不代表其他文件没有问题，而是因为这三处文件已经覆盖两个关键后端域：`copilot_runtime` 与 `desktop_runtime`。它们同时具备职责混杂明显、变更收益高、拆分后能建立目录范式三项条件，因此更适合作为第一波。

## 为何选择这 3 个文件作为第一波
第一，这三处文件都位于后端运行链路核心位置，任何后续功能迭代几乎都会触达其中至少一处，先拆开可以直接降低后续开发阻力。

第二，它们的问题是“职责混杂优先”的典型样本。`message_runs.py` 反映运行主流程与协议组织混杂，`router.py` 反映入口声明与业务编排混杂，`server.py` 反映应用装配与安全诊断能力混杂。三者合起来覆盖了当前巨石化最明显的几类成因。

第三，这三处文件适合承接一次激进拆分。此次已批准顺带整理目录结构，因此不必局限于保守的函数搬迁，而是可以同步建立子域目录、薄入口兼容层和统一命名规范，为后续继续拆分类似文件提供模板。

第四，三处文件的拆分收益可被较清晰地验证。它们都存在明确的对外行为边界，因此可以坚持“内部重组，外部行为不变”的原则，用现有测试与回归用例进行确认。

## 目标目录结构
本轮目标不是机械地把大文件切成更多小文件，而是围绕职责边界重排目录。建议结构如下。

### `backend/app/copilot_runtime`
```text
backend/app/copilot_runtime/
  __init__.py
  router.py                      # 薄入口，保留兼容导出
  message_runs.py                # 薄入口，保留兼容导出
  runs/
    __init__.py
    message_run_handlers.py
    message_run_services.py
    message_run_mappers.py
    message_run_stream.py
  transport/
    __init__.py
    http_handlers.py
    request_mappers.py
    response_mappers.py
  shared/
    __init__.py
    dependencies.py
    errors.py
    models.py
```

### `backend/app/desktop_runtime`
```text
backend/app/desktop_runtime/
  __init__.py
  server.py                      # 薄入口，保留兼容导出
  app_factory.py
  middlewares.py
  security.py
  routes/
    __init__.py
    diagnostics.py
```

上面的结构体现两个原则。其一，目录划分优先表达子域，而不是简单按技术动作切散。其二，原始巨石文件保留为薄入口文件，继续承担兼容导入与聚合导出职责，避免一次改动撬动过多上游引用。

## 模块职责分配
### `copilot_runtime` 拆分建议
[`backend/app/copilot_runtime/message_runs.py`](backend/app/copilot_runtime/message_runs.py) 拆分后，建议由四类模块承接原有职责。

- `message_run_handlers.py` 负责运行相关入口处理逻辑，承接接近接口入口但仍属于运行域的协调代码。
- `message_run_services.py` 负责运行主流程编排、跨组件调用顺序与业务层级的控制逻辑。
- `message_run_mappers.py` 负责领域对象与对外响应结构之间的转换，减少映射细节散落在处理流程中。
- `message_run_stream.py` 负责流式输出相关逻辑，包括事件构造、流包装和与主流程解耦的流式适配代码。

[`backend/app/copilot_runtime/router.py`](backend/app/copilot_runtime/router.py) 拆分后，建议更多承担路由装配与兼容导出职责，具体入口细节转入 `transport/`。

- `http_handlers.py` 负责 HTTP 入口处理函数，保持路由声明层简洁。
- `request_mappers.py` 负责请求参数解析、默认值整理与输入结构标准化。
- `response_mappers.py` 负责统一输出结构转换，避免在多个入口重复拼装响应。
- `shared/dependencies.py` 负责公共依赖注入对象或依赖获取逻辑，减少路由层与运行层直接耦合。
- `shared/errors.py` 负责共享异常定义或错误转换规则，使入口层与服务层能复用一致的错误边界。

这样调整后，`runs/` 聚焦运行域内部流程，`transport/` 聚焦外部协议交互，`shared/` 聚焦可复用公共件，边界更清晰，后续新增运行能力或新增传输协议时也更容易落位。

### `desktop_runtime` 拆分建议
[`backend/app/desktop_runtime/server.py`](backend/app/desktop_runtime/server.py) 拆分后，建议按“应用装配、横切能力、路由能力、安全边界”四层组织。

- [`backend/app/desktop_runtime/app_factory.py`](backend/app/desktop_runtime/app_factory.py) 负责应用实例创建、生命周期挂载和总体装配顺序。
- [`backend/app/desktop_runtime/middlewares.py`](backend/app/desktop_runtime/middlewares.py) 负责中间件注册逻辑，让跨请求横切行为独立演进。
- [`backend/app/desktop_runtime/routes/diagnostics.py`](backend/app/desktop_runtime/routes/diagnostics.py) 负责诊断类接口定义和与诊断能力相关的响应组织。
- [`backend/app/desktop_runtime/security.py`](backend/app/desktop_runtime/security.py) 负责安全策略、校验逻辑或安全相关辅助函数。
- [`backend/app/desktop_runtime/server.py`](backend/app/desktop_runtime/server.py) 继续作为薄入口，负责兼容导出与少量顶层拼装，不再承载细节实现。

这种划分有助于把“如何创建应用”和“应用提供什么能力”分开，也有利于在不动主入口的情况下独立扩展安全与诊断能力。

## 兼容性策略
本轮设计的硬约束是只重组内部模块，不改变外部行为。兼容性策略需要同时覆盖导入兼容、HTTP 行为兼容和运行时语义兼容。

- 原始文件 [`backend/app/copilot_runtime/message_runs.py`](backend/app/copilot_runtime/message_runs.py)、[`backend/app/copilot_runtime/router.py`](backend/app/copilot_runtime/router.py) 和 [`backend/app/desktop_runtime/server.py`](backend/app/desktop_runtime/server.py) 保留存在，作为薄入口文件继续暴露既有公共符号。
- 对外可见的路由路径、请求参数契约、响应结构、状态码、流式事件顺序和错误表现保持不变。
- 应用启动方式、服务器创建入口与上游导入路径保持兼容，避免要求调用方同步修改。
- 新增内部目录与模块仅作为实现承载层，不直接对外宣布新的公共 API。
- 若某些历史导出名语义不够理想，也应先通过兼容转发保留，再在后续独立清理波次处理。

兼容性设计的关键不在于“旧文件还在”，而在于外部调用者不需要知道内部重组已经发生。只要行为边界稳定，后续子任务就可以在受控范围内持续推进。

## 测试策略
验证策略已经明确：外部 HTTP 与运行时行为必须保持不变，且每完成一个拆分波次都要有对应验证，最后再做一轮后端最终回归。

建议测试节奏如下。

- 每完成一个后端拆分波次，就运行与该波次直接相关的测试，优先验证受影响路由、运行流程和桌面运行时入口行为。
- `copilot_runtime` 波次中，重点验证消息运行主流程、路由入口、流式输出和错误返回是否与拆分前一致。
- `desktop_runtime` 波次中，重点验证应用创建、诊断接口、中间件链路和安全校验相关行为是否保持一致。
- 全部波次完成后，再执行一轮后端最终回归测试，确认跨模块整合后的整体行为没有偏移。

测试策略的重点不是追求更多测试种类，而是确保每个拆分动作都能被局部验证，并在最终阶段再被整体验证，形成“波次内收敛、收尾再总检”的节奏。

## 命名规范
这次拆分不只是移动文件，也要建立一套后续可复用的命名规范。文件命名优先表达职责边界，而不是笼统使用 `utils.py`、`helpers.py` 一类低信息量名称。

建议规范如下。

- 入口处理逻辑优先使用 `*_handlers.py`。
- 服务编排逻辑优先使用 `*_services.py`。
- 结构转换与对象映射优先使用 `*_mappers.py`。
- 流式输出或流控制逻辑优先使用 `*_stream.py`。
- 路由集合优先放入 `routes/` 目录，并用语义化名称命名文件，例如 [`backend/app/desktop_runtime/routes/diagnostics.py`](backend/app/desktop_runtime/routes/diagnostics.py)。
- 共享依赖、错误与公共模型放入 `shared/` 目录，文件名直接表达内容，例如 [`backend/app/copilot_runtime/shared/dependencies.py`](backend/app/copilot_runtime/shared/dependencies.py)。

命名规则的目的，是让后续开发者仅通过文件名就能快速判断它属于入口层、服务层、映射层还是共享层，从而减少继续堆积回巨石文件的概率。

## 实施波次建议
本轮建议采用三波推进，每波范围清晰，便于代码子任务承接。

### 第一波：`copilot_runtime/message_runs.py`
先从运行主流程文件开始，将最混杂的运行编排、映射与流式逻辑拆入 `runs/` 子域。该波优先建立 `message_run_handlers.py`、`message_run_services.py`、`message_run_mappers.py`、`message_run_stream.py` 的基本边界，同时让原始 [`backend/app/copilot_runtime/message_runs.py`](backend/app/copilot_runtime/message_runs.py) 收敛为薄入口。

### 第二波：`copilot_runtime/router.py`
在 `runs/` 边界初步稳定后，再拆路由入口层。该波重点建立 `transport/` 与 `shared/` 目录，让路由声明、HTTP 入口处理、请求映射和共享依赖各自落位，并让 [`backend/app/copilot_runtime/router.py`](backend/app/copilot_runtime/router.py) 退化为装配与兼容导出层。

### 第三波：`desktop_runtime/server.py`
最后处理桌面运行时服务入口。该波要同步完成 `app_factory.py`、`middlewares.py`、`routes/diagnostics.py`、`security.py` 的拆分，并保留 [`backend/app/desktop_runtime/server.py`](backend/app/desktop_runtime/server.py) 作为薄入口。之所以放在第三波，是因为该文件涉及应用装配总入口，放在前两波之后更便于复用已经形成的拆分模式与命名规范。

每一波结束后都应立即进行对应测试，避免多波叠加后再集中排查问题，从而放大定位成本。

## 风险与回滚思路
### 主要风险
- 内部符号搬迁后，可能出现遗漏的导入路径更新，导致运行期才暴露问题。
- 路由层与服务层重新分配职责时，容易把少量协议细节误留在错误层级，造成边界回退。
- 流式逻辑拆分时，如果事件组装顺序或异常传播路径处理不一致，外部行为可能发生细微偏移。
- `desktop_runtime` 的应用装配逻辑拆开后，如果初始化顺序变化，可能带来中间件或诊断能力注册顺序差异。

### 风险控制
- 每个波次尽量先搬迁、后整理，避免在同一步内同时做结构改造与语义优化。
- 原始入口文件保留兼容转发，减少上游改动面。
- 让映射、流式、依赖获取等高风险细节进入独立模块，便于定向测试与审阅。
- 拆分过程中坚持对外行为逐项对照，尤其关注状态码、响应结构、流式输出和应用启动入口。

### 回滚思路
如果某一波拆分验证失败，回滚应以波次为单位进行，而不是在多个拆分文件间零散撤回。原因很简单：目录重组与职责迁移具有联动性，局部回滚容易留下半完成状态。具体做法上，应保留每一波可独立恢复的提交边界，一旦测试无法在短时间内收敛，就整体回退该波，把问题留在更小范围内重新处理。

## 结论
本设计将首波后端巨石拆分收敛到三个职责混杂最明显的文件，通过激进但受控的目录重组，建立 `copilot_runtime` 与 `desktop_runtime` 两个域内更清晰的模块边界，同时保留薄入口文件维持兼容。后续代码子任务应严格围绕本设计推进，核心原则始终不变：只重组内部模块，不改变外部行为。
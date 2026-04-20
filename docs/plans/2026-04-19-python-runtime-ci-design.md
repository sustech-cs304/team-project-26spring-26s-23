# Python Runtime 打包 CI 设计

## 背景

当前桌面端已经具备 bundled runtime 的基本契约，Electron 安装包在运行时会从 `resources/python-runtime/` 目录读取后端运行时资源，并通过 `backend-runtime-manifest.json` 找到 Python 可执行文件、后端入口模块与 `PYTHONPATH` 布局。这个契约已经体现在 [`frontend-copilot/scripts/prepare-bundled-runtime.mjs`](../../frontend-copilot/scripts/prepare-bundled-runtime.mjs) 的 staging 逻辑、[`frontend-copilot/electron-builder.json5`](../../frontend-copilot/electron-builder.json5) 的 `extraResources` 配置，以及 [`frontend-copilot/electron/runtime/python-runtime-resolver-bundled.ts`](../../frontend-copilot/electron/runtime/python-runtime-resolver-bundled.ts) 的启动逻辑中。

目前的缺口不在运行时协议本身，而在于打包流程还没有被整理成一条可以稳定复现的 CI 链路。现阶段需要把“准备可分发 Python runtime、安装锁定依赖、复制后端代码、生成 manifest、导出 Electron 安装包”这几步收敛为一个可在原生平台 runner 上直接执行的流程。

这份文档记录 2026-04-19 已确认的首版方案，目标是为 implementation planning 提供稳定边界，而不是直接落地 CI 代码。

## 目标与非目标

### 目标

首版方案需要满足下面四项目标：

1. CI 覆盖 Windows x64、macOS x64、macOS arm64、Linux x64 四个平台组合。
2. 每个平台 job 都直接完成从 distributable Python runtime 准备到 Electron 安装包导出的全流程。
3. 首版允许在 CI 中在线下载 Python 与 PyPI 依赖，不要求离线镜像或预热仓库。
4. 成功标准是稳定产出各平台测试安装包，并且安装包内真实携带可运行的 bundled backend runtime。

### 非目标

首版方案明确不处理下面这些事项：

1. 不处理代码签名、macOS 公证与发布渠道接入。
2. 不处理离线构建、私有 PyPI 镜像或 Python 二进制镜像。
3. 不拆分为 runtime 工件流水线与 installer 工件流水线两层架构。
4. 不追求跨平台交叉构建，首版优先使用目标平台原生 runner。
5. 不改变现有桌面端 bundled runtime 契约。

## 现状约束

### 现有脚本与配置边界

当前方案必须建立在已有项目结构之上，几个关键锚点已经固定：

| 作用 | 文件 | 当前约束 |
| --- | --- | --- |
| Electron 打包入口 | [`frontend-copilot/package.json`](../../frontend-copilot/package.json) | 已定义 `stage:bundled-runtime`、`package:desktop`、`package:desktop:smoke` 与 `prepackage:desktop`。 |
| bundled runtime staging | [`frontend-copilot/scripts/prepare-bundled-runtime.mjs`](../../frontend-copilot/scripts/prepare-bundled-runtime.mjs) | staging 布局已经固定为 `python/`、`python-packages/`、`backend/`、`metadata/` 与 `backend-runtime-manifest.json`。 |
| 安装包资源纳入方式 | [`frontend-copilot/electron-builder.json5`](../../frontend-copilot/electron-builder.json5) | `extraResources` 已将 `.bundled-runtime/staging` 打入安装包内的 `python-runtime/`。 |
| Python 版本约束 | [`backend/pyproject.toml`](../../backend/pyproject.toml)、[`backend/.python-version`](../../backend/.python-version) | 当前后端要求 Python `>=3.12`，并约定主版本线为 `3.12`。 |
| 依赖锁定来源 | [`backend/uv.lock`](../../backend/uv.lock) | 锁文件已经存在，CI 需要依据它导出依赖并安装到 staging。 |

### 运行时契约保持不变

首版 CI 不重写 runtime contract，而是继续沿用当前设计：

1. packaged runtime 根目录仍然是 `resources/python-runtime/`。
2. manifest 文件仍然是 `backend-runtime-manifest.json`。
3. 后端入口仍然是 `app.desktop_runtime`。
4. staging 继续由 [`frontend-copilot/scripts/prepare-bundled-runtime.mjs`](../../frontend-copilot/scripts/prepare-bundled-runtime.mjs) 生成。
5. 安装包继续由 [`frontend-copilot/electron-builder.json5`](../../frontend-copilot/electron-builder.json5) 的 `extraResources` 纳入 runtime。

这条边界很重要，因为 [`frontend-copilot/electron/runtime/python-runtime-resolver-bundled.ts`](../../frontend-copilot/electron/runtime/python-runtime-resolver-bundled.ts) 运行时会读取 manifest，并依赖 manifest 中的 `pythonPathRelativePaths` 拼接 `PYTHONPATH` 后直接启动 bundled Python。CI 只负责稳定地产出这份资源，不负责重定义运行时装载方式。

## 候选方案简述与选型结论

### 方案 A：复用 CI runner 预装 Python

这个方案看起来最省事，但问题很明显：

1. runner 镜像会变化，预装 Python 的路径、补丁版本与附带组件都不稳定。
2. 预装 Python 通常服务于构建环境，不天然等于适合随安装包分发的 runtime。
3. 不同平台 runner 的预装布局差异很大，后续校验和问题排查会比较混乱。

这个方案不满足首版需要的可追溯性与可复制性。

### 方案 B：复制开发机 Python 或 venv 进入安装包

这个方案不应采用，原因更直接：

1. 开发机 Python 或 venv 很容易混入本地绝对路径、符号链接、用户级站点包和临时状态。
2. venv 往往绑定创建时的宿主路径、平台 ABI 与文件权限，复制到 CI 或安装包后可移植性很差。
3. 这种做法会把“开发环境状态”直接变成“用户运行时内容”，后续任何一个开发机差异都可能进入发行物。
4. 它很难和当前 manifest + `PYTHONPATH` 的 bundled runtime 契约保持一致，最终会让排错边界变得模糊。

结论很明确：不能复制开发机 Python，更不能复制开发机 venv。

### 方案 C：每个平台原生 runner 显式下载对应平台与架构的 distributable Python

这个方案被选为首版实现方式，理由有三点：

1. 目标平台与目标架构可以在 job 中被显式声明，打包输入更清楚。
2. 下载源、Python 版本与解压目录都可以纳入校验，故障定位更直接。
3. 这种方案天然适配当前 staging 布局，不需要修改 Electron 启动契约。

### 选型结论

首版采用“每个平台原生 runner 显式下载对应平台与架构的可分发 Python”方案。CI 不复用 runner 预装 Python，也不复制开发机 Python 或 venv。[`backend/uv.lock`](../../backend/uv.lock) 对应的 [`uv`](../../backend/uv.lock) 仅作为构建期工具安装在 runner 上，用于解析锁文件、导出 requirements，并把第三方包安装到 staging 的 `python-packages/`。最终进包内容是 distributable Python runtime、[`backend/app`](../../backend/app)、staging 生成的 `python-packages`、manifest，以及用于追溯构建输入的 metadata 文件。

## 目标架构

首版目标架构可以概括为一条单向流水线：

1. CI job 在目标平台原生 runner 上下载当前平台可分发 Python。
2. job 安装构建期 [`uv`](../../backend/uv.lock)，并读取 [`backend/uv.lock`](../../backend/uv.lock) 导出锁定依赖集。
3. [`frontend-copilot/scripts/prepare-bundled-runtime.mjs`](../../frontend-copilot/scripts/prepare-bundled-runtime.mjs) 将下载到的 Python 复制到 staging 的 `python/`，再把第三方依赖安装到 `python-packages/`，并复制 [`backend/app`](../../backend/app) 到 `backend/`。
4. staging 脚本生成 `backend-runtime-manifest.json`，记录 Python 可执行文件、入口模块 `app.desktop_runtime`、后端工作目录与 `PYTHONPATH` 布局。
5. [`frontend-copilot/electron-builder.json5`](../../frontend-copilot/electron-builder.json5) 通过 `extraResources` 将整个 staging 目录纳入安装包的 `python-runtime/`。
6. 已安装应用启动时，由 [`frontend-copilot/electron/runtime/python-runtime-resolver-bundled.ts`](../../frontend-copilot/electron/runtime/python-runtime-resolver-bundled.ts) 根据 manifest 定位 runtime 并拉起后端。

对应的目标资源布局如下：

```text
resources/
  python-runtime/
    backend-runtime-manifest.json
    python/
    python-packages/
    backend/
      app/
    metadata/
      backend-requirements.txt
```

这个布局与现有 runtime resolver 的工作方式完全一致，因此首版设计重点放在“稳定构造上述目录”，而不是重新设计目录结构。

## CI job 结构

### 工作流分层选择

首版采用“单工作流 + 多平台原生 job”的结构：

1. Windows x64 job。
2. macOS x64 job。
3. macOS arm64 job。
4. Linux x64 job。

不采用首版 runtime 工件与 installer 工件分层流水线。原因很简单：当前系统的风险主要集中在“目标平台 Python 运行时是否能完成 staging 并真正进入安装包”，这时再拆成两层流水线，会引入更多跨 job 工件协议、缓存命名和平台差异处理，复杂度高于收益。

### 每个平台 job 的标准步骤

每个平台 job 都遵循同一套标准步骤：

1. checkout 仓库。
2. 安装 Node 依赖。
3. 安装构建期 [`uv`](../../backend/uv.lock)。
4. 下载当前平台与架构的 distributable Python 到明确目录。
5. 校验 Python 可执行文件存在，并且版本满足 [`backend/pyproject.toml`](../../backend/pyproject.toml) 与 [`backend/.python-version`](../../backend/.python-version) 的约束。
6. 通过环境变量 `CANDUE_BUNDLED_PYTHON_DIR` 将 Python 源目录传给 [`frontend-copilot/scripts/prepare-bundled-runtime.mjs`](../../frontend-copilot/scripts/prepare-bundled-runtime.mjs)。必要时可以一并传入 `CANDUE_BUNDLED_PYTHON_EXECUTABLE_RELATIVE` 与 `CANDUE_BUNDLED_PYTHON_VERSION`。
7. 执行 [`frontend-copilot/package.json`](../../frontend-copilot/package.json) 中定义的 `npm run package:desktop`。
8. 上传当前平台安装包产物与必要的诊断日志。

在这套结构里，CI 的统一入口是 [`frontend-copilot/package.json`](../../frontend-copilot/package.json) 现有脚本，而不是为每个平台另起一套独立构建命令。这样可以让本地构建与 CI 构建保持同一条打包主线。

## Runtime 准备流程

### staging 的标准布局

首版继续使用现有 staging 布局：

1. `python/` 用来承载可分发 Python runtime 本体。
2. `python-packages/` 用来承载通过锁文件解析后安装得到的第三方依赖。
3. `backend/` 用来承载项目后端源码，当前核心内容是 [`backend/app`](../../backend/app)。
4. `backend-runtime-manifest.json` 用来声明入口与路径关系。
5. `metadata/` 用来保存构建追溯信息，当前至少包括导出的 requirements 文件。

### 标准准备过程

[`frontend-copilot/scripts/prepare-bundled-runtime.mjs`](../../frontend-copilot/scripts/prepare-bundled-runtime.mjs) 的运行过程应被 CI 视为规范流程：

1. 读取 `CANDUE_BUNDLED_PYTHON_DIR`，定位源 Python 目录。
2. 将源 Python 目录完整复制到 staging 的 `python/`。
3. 调用 [`uv`](../../backend/uv.lock) 基于 [`backend/uv.lock`](../../backend/uv.lock) 导出锁定依赖集。
4. 使用 staged Python 作为解释器，把第三方依赖安装到 `python-packages/`。
5. 复制 [`backend/app`](../../backend/app) 到 staging 的 `backend/app/`。
6. 生成 `backend-runtime-manifest.json`，写入 Python 可执行文件路径、`app.desktop_runtime` 入口模块、后端工作目录，以及 `pythonPathRelativePaths` 与 `sitePackagesRelativePaths`。
7. 对 staging 结果执行存在性校验，确认 Python、backend 入口、requirements 文件和 Python path 条目都存在。

### 为什么不把依赖预装进源 Python 目录

首版明确不建议把依赖预装进“源 Python 目录”后整体打包。原因有四点：

1. 当前运行时解析逻辑已经约定通过 manifest + `PYTHONPATH` 组合加载 `backend/` 与 `python-packages/`。
2. 把依赖直接塞进源 Python 目录，会让 runtime 本体与项目依赖混在一起，边界不清楚。
3. staging 阶段就失去了对第三方依赖目录的独立校验能力，排查问题时更难判断是 Python 本体问题还是依赖安装问题。
4. 分离布局更接近当前 resolver 的真实运行方式，也更利于后续做缓存、增量校验或工件拆分。

换句话说，首版不是在追求“目录越少越好”，而是在维持一个可验证、可调试的结构化运行时布局。

## 失败处理与验证策略

### fail-fast 原则

首版 CI 需要在几个关键点上尽早失败，避免把错误拖到安装包导出之后：

1. Python 来源校验失败时立即停止，包括下载地址、解压目录、可执行文件与版本不匹配等情况。
2. 依赖安装可行性校验失败时立即停止，包括 [`uv`](../../backend/uv.lock) 导出失败、锁定依赖无法解析、某个平台缺少可用 wheel 或本地编译失败等情况。
3. staging 结果校验失败时立即停止，包括 manifest 引用路径不存在、入口模块缺失或 `python-packages/` 缺失。
4. 目录打包校验失败时立即停止，可以使用 [`frontend-copilot/package.json`](../../frontend-copilot/package.json) 中的 `package:desktop:smoke`，或者采用等价的目录打包校验手段。
5. 最终安装包内容校验失败时立即停止，至少要确认安装包或解包目录内包含 `python-runtime/backend-runtime-manifest.json` 以及对应的 Python runtime 目录。

### 推荐校验层次

可以把验证分成四层：

1. 输入层校验：确认下载到的 distributable Python 与目标平台、目标架构、目标版本一致。
2. 构造层校验：确认 staging 脚本完整执行，并且生成的 manifest 与目录结构自洽。
3. 打包层校验：确认 `package:desktop:smoke` 或等价目录打包结果中已经出现 `resources/python-runtime/`。
4. 产物层校验：确认最终安装包确实携带 bundled runtime，而不是只携带 Electron 前端资源。

这套验证链路的重点，是让失败位置尽量靠近根因，而不是等最终用户安装后才发现后端无法启动。

## 风险与后续演进

### 首版接受的风险与约束

当前已经明确接受下面这些首版约束：

1. 优先原生平台构建，不处理复杂交叉编译场景。
2. [`backend/uv.lock`](../../backend/uv.lock) 锁定版本，但不保证所有平台都有现成 wheel；某些平台可能需要回到依赖选型或版本锁定上做调整。
3. Python 下载逻辑按平台分别实现，首版不强行抽象成完全统一的一套下载器。
4. 暂不处理代码签名与公证，因此首版产物定位为测试安装包。

### 后续演进方向

等首版稳定后，可以再考虑下面这些演进方向：

1. 为 Python 下载与校验补充更严格的来源校验，例如校验和或发布源白名单。
2. 增加 Node、Python 压缩包与 [`uv`](../../backend/uv.lock) 依赖缓存，缩短 CI 耗时。
3. 在运行时布局稳定后，再考虑把 runtime 工件与 installer 工件拆成两层流水线。
4. 为 macOS 与 Windows 接入签名、公证与正式发布流程。
5. 根据平台兼容性结果，反向调整 [`backend/uv.lock`](../../backend/uv.lock) 中的依赖版本策略。

## 结论

当前项目最稳妥的方向，是在每个平台原生 runner 上显式下载对应平台与架构的 distributable Python，再复用现有 [`frontend-copilot/scripts/prepare-bundled-runtime.mjs`](../../frontend-copilot/scripts/prepare-bundled-runtime.mjs) 与 [`frontend-copilot/electron-builder.json5`](../../frontend-copilot/electron-builder.json5) 完成 staging 和安装包导出。这条路径与现有 bundled runtime 契约一致，也能把失败位置控制在可诊断范围内。

有两个结论需要单独强调：

1. 不应复制开发机 Python 或 venv。开发机环境天然携带本地状态、宿主路径、权限差异和平台偶然性，把它直接塞进发行物，只会让可复现性、可验证性与可维护性一起下降。
2. runner 上安装的 [`uv`](../../backend/uv.lock) 只是构建期工具，而不是用户依赖。它只在 CI 中负责读取 [`backend/uv.lock`](../../backend/uv.lock)、导出依赖并把第三方包安装到 staging。真正进入安装包并在用户机器上运行的，是 bundled Python、本项目后端源码、安装好的第三方包与 manifest，用户运行时并不需要 [`uv`](../../backend/uv.lock)。

在上述边界下，当前设计没有阻止进入 implementation planning 的未决问题。首版仍有平台依赖兼容性和签名流程等后续事项，但这些都属于已知演进方向，不影响继续推进实现规划。

# Frontend Copilot 快速上手

## 这是什么

[frontend-copilot](./) 是这个仓库里当前的桌面前端实验实现。它的目标不是先把所有业务做完，而是先把“桌面应用壳 + 多工作区界面 + Copilot 最小接入链路”搭起来，方便后续继续接真实聊天、真实配置和真实后端能力。

可以把它先理解成：

- 一个用 Electron 包起来的桌面前端
- 一个用 React 写的工作台界面
- 一个已经能读取本地 Copilot 配置、并据此决定是否初始化 Copilot 外层能力的前端骨架

## 先看结论

- 这是一个 **Electron + React + TypeScript + Vite** 的桌面前端，不是单纯的网页原型。
- 当前最明确、最能依赖的前端事实，是 **只存在两个真正生效的 Copilot 配置字段：`runtimeUrl` 和 `agentName`**。
- 应用启动时会先读取本地配置；只有这两个字段都齐了，前端才会把它们传给 Copilot 外层能力。
- 现在最完整的界面是工作区结构、助手切换、会话列表骨架和设置页外观；**真实聊天 UI 还没有接上**。
- 设置页里很多字段虽然能点、能改、能切换，但大多数还只是前端本地交互，**不能当成已经生效的配置能力**。

## 怎么安装

在仓库根目录执行：

```bash
cd frontend-copilot
npm install
```

## 怎么启动开发环境

在 `frontend-copilot` 目录执行：

```bash
npm run dev
```

这个项目使用 Electron 和 Vite 的集成开发方式。当前 `dev` 脚本会走 Vite 开发流程，并由现有插件配置带起桌面端开发链路。

当前阶段中，Electron 主进程启动后会自动尝试托管本地 Python 桌面运行时。开发态会优先使用 `../backend/.venv/` 里的解释器（Windows 常见为 `../backend/.venv/Scripts/python.exe`，macOS / Linux 常见为 `../backend/.venv/bin/python`）；如果项目虚拟环境不存在，则再探测命令行中明确可用的解释器：Windows 依次尝试 `py -3`、`python`、`python3`，macOS / Linux 依次尝试 `python3`、`python`，并直接执行 `-m app.desktop_runtime`。Electron 运行链路本身不再依赖 `uv`。

当前 renderer 首屏会先由 [`frontend-copilot/index.html`](frontend-copilot/index.html) 直接渲染静态启动壳，再由 [`frontend-copilot/src/main.tsx`](frontend-copilot/src/main.tsx:12) 首次挂载立即接管，最后再按需加载完整工作台与 Copilot provider，避免开发态在首轮模块编译期间长时间白屏。

当前桌面运行目录会固定落在 Electron `userData` 下的 [`desktop-runtime`](frontend-copilot/electron/runtime/runtime-paths.ts:4) 目录，并按职责拆分为：

- `config/`：保存 [`copilot-settings.json`](frontend-copilot/electron/runtime/runtime-paths.ts:10)
- `logs/`：保存 Electron 主进程日志，以及 Python 子进程 stdout / stderr 日志
- `database/`：保存桌面后端数据库或其他业务数据
- `state/`：保存运行态快照和最近失败摘要

如果本机还保留旧位置的 `userData/copilot-settings.json`，主进程会在首次读取时迁移到新的 `config/` 目录。

开发机需要满足两个前提：

- 已安装 Node.js 依赖（在 [`frontend-copilot/package.json`](frontend-copilot/package.json) 所在目录执行过 `npm install`）
- 已准备好 `../backend/.venv/`（推荐），或至少让受支持的 Python 解释器可从命令行直接调用：Windows 为 `py -3` / `python` / `python3` 之一，macOS / Linux 为 `python3` / `python` 之一，以便主进程在开发态拉起 [`backend/app/desktop_runtime/`](backend/app/desktop_runtime/)

## 怎么预览构建后的前端页面

在 `frontend-copilot` 目录执行：

```bash
npm run preview
```

这个命令更适合单独确认 renderer（也就是 React 界面层）的构建结果。

## 怎么构建桌面应用

在 `frontend-copilot` 目录执行：

```bash
npm run build
```

如果只想先验证 bundled runtime staging，可以执行：

```bash
npm run stage:bundled-runtime
```

构建机必须显式提供一个可分发的 Python runtime 目录；最少需要准备这些环境变量：

- `CANDUE_BUNDLED_PYTHON_DIR`：必填，指向可分发 Python runtime 根目录
- `CANDUE_BUNDLED_PYTHON_EXECUTABLE_RELATIVE`：可选，指定解释器相对路径；Windows 常见值是 `python.exe`
- `CANDUE_BUNDLED_PYTHON_VERSION`：可选，覆盖 staging 脚本自动探测到的版本文本

当前桌面构建/打包链路会顺序执行：

1. `npm run build:app`：执行 TypeScript 类型检查与 Vite 构建
2. `npm run stage:bundled-runtime`：从构建机提供的 Python runtime 与 `../backend/uv.lock` 生成 `.bundled-runtime/staging/`（这里的 `uv` 只属于构建期辅助工具，不参与最终桌面应用运行时）
3. `npm run package:desktop`：触发 `electron-builder`，并通过 `extraResources` 将 staging 内容复制到安装包的 `resources/python-runtime/`

打包后，发布态资源布局约定为：

- `resources/python-runtime/backend-runtime-manifest.json`
- `resources/python-runtime/python/`
- `resources/python-runtime/backend/app/`
- `resources/python-runtime/python-packages/`
- `resources/python-runtime/metadata/backend-requirements.txt`

Electron 主进程在 packaged 模式下会从 `process.resourcesPath/python-runtime/` 读取 manifest，解析 Python 可执行文件、后端工作目录与 `PYTHONPATH`；因此打包后的桌面应用运行时不再依赖 `uv`、工作区源码或用户机器预装 Python。

## 怎么跑主进程托管层测试

在 `frontend-copilot` 目录执行：

```bash
npm run test
```

当前新增测试主要覆盖 [`frontend-copilot/electron/runtime/`](frontend-copilot/electron/runtime/) 下的纯模块，包括开发态路径解析、bundled runtime manifest 解析、packaged resolver、运行时启动参数生成、失败摘要与状态流转。

## 怎么做代码检查

在 `frontend-copilot` 目录执行：

```bash
npx tsc --noEmit
npm run test
npm run lint
```

## 阶段 6：最小测试与发布验收

### 已在当前仓库 / 环境里实际验证通过的事项

以下链路已经在当前仓库中实际执行并通过：

1. 后端桌面运行时单元测试：

   ```bash
   cd backend
   uv run --extra test pytest tests/unit/desktop_runtime -q
   ```

   结果：`7 passed`

2. 前端 TypeScript 类型检查：

   ```bash
   cd frontend-copilot
   npx tsc --noEmit
   ```

3. 前端 Vitest 纯模块测试：

   ```bash
   cd frontend-copilot
   npm run test
   ```

   当前测试覆盖 [`frontend-copilot/electron/runtime/`](frontend-copilot/electron/runtime/) 与 [`frontend-copilot/src/features/copilot/config.test.ts`](frontend-copilot/src/features/copilot/config.test.ts) 的纯模块基线，共 `18 passed`。

   说明：Windows 下直接调用 `vitest run` 时，当前环境曾出现盘符大小写相关的基线问题，表现为测试收集阶段报 `Cannot read properties of undefined (reading 'config')`。目前 [`frontend-copilot/package.json`](frontend-copilot/package.json) 已将 `test` 脚本切换为 [`frontend-copilot/scripts/run-vitest.mjs`](frontend-copilot/scripts/run-vitest.mjs)，先统一项目目录盘符大小写，再调用本地 Vitest CLI，确保现有测试链路可稳定复现。

4. 前端 lint：

   ```bash
   cd frontend-copilot
   npm run lint
   ```

5. bundled runtime staging：

   `cmd.exe` 下可以直接执行：

   ```bat
   set "CANDUE_BUNDLED_PYTHON_DIR=C:\Python312" && set "CANDUE_BUNDLED_PYTHON_EXECUTABLE_RELATIVE=python.exe" && npm run stage:bundled-runtime
   ```

   如果使用 PowerShell，请改用：

   ```powershell
   $env:CANDUE_BUNDLED_PYTHON_DIR = 'C:\Python312'
   $env:CANDUE_BUNDLED_PYTHON_EXECUTABLE_RELATIVE = 'python.exe'
   npm run stage:bundled-runtime
   ```

   结果：已生成 [`.bundled-runtime/staging/backend-runtime-manifest.json`](frontend-copilot/.bundled-runtime/staging/backend-runtime-manifest.json) 与 `python/`、`backend/`、`python-packages/`、`metadata/` 目录。

6. 打包产物准备验证：

   ```bat
   cmd /d /c "set CANDUE_BUNDLED_PYTHON_DIR=C:\Python312&& set CANDUE_BUNDLED_PYTHON_EXECUTABLE_RELATIVE=python.exe&& npm run package:desktop -- --dir"
   ```

   当前环境已实际生成：

   - [`frontend-copilot/release/0.0.0/win-unpacked/`](frontend-copilot/release/0.0.0/win-unpacked/)
   - [`frontend-copilot/release/0.0.0/赶渡 CanDue-Windows-0.0.0-Setup.exe`](frontend-copilot/release/0.0.0/%E8%B5%B6%E6%B8%A1%20CanDue-Windows-0.0.0-Setup.exe)
   - [`frontend-copilot/release/0.0.0/win-unpacked/resources/python-runtime/`](frontend-copilot/release/0.0.0/win-unpacked/resources/python-runtime/)

   并确认 packaged 资源目录内包含：

   - [`backend-runtime-manifest.json`](frontend-copilot/release/0.0.0/win-unpacked/resources/python-runtime/backend-runtime-manifest.json)
   - [`backend/`](frontend-copilot/release/0.0.0/win-unpacked/resources/python-runtime/backend/)
   - [`metadata/`](frontend-copilot/release/0.0.0/win-unpacked/resources/python-runtime/metadata/)
   - [`python/`](frontend-copilot/release/0.0.0/win-unpacked/resources/python-runtime/python/)
   - [`python-packages/`](frontend-copilot/release/0.0.0/win-unpacked/resources/python-runtime/python-packages/)

### 最小验收步骤

#### 1. 开发态 hosted backend 验收步骤

1. 在 [`frontend-copilot/package.json`](frontend-copilot/package.json) 所在目录完成 `npm install`。
2. 优先准备 [`backend/.venv/`](../backend/.venv/)；若不使用项目虚拟环境，则确认命令行中存在受支持的解释器：Windows 为 `py -3` / `python` / `python3` 之一，macOS / Linux 为 `python3` / `python` 之一。
3. 执行：

   ```bash
   npm run dev
   ```

4. 若启动成功，应继续确认：
   - Electron 主窗口出现；
   - 本地后端进入 `ready`；
   - Electron `userData/desktop-runtime/` 下出现 `logs/` 与 `state/`；
   - [`electron-host.log`](frontend-copilot/electron/runtime/runtime-paths.ts:11)、[`backend.stdout.log`](frontend-copilot/electron/runtime/runtime-paths.ts:12)、[`backend.stderr.log`](frontend-copilot/electron/runtime/runtime-paths.ts:13)、[`runtime-snapshot.json`](frontend-copilot/electron/runtime/runtime-paths.ts:14)、[`last-failure.json`](frontend-copilot/electron/runtime/runtime-paths.ts:15) 可定位。

#### 2. packaged 资源准备验收步骤

1. 先执行 `npm run build:app`，确认前端构建完成。
2. 再执行上面的 `stage:bundled-runtime` 命令。
3. 打开 [`.bundled-runtime/staging/backend-runtime-manifest.json`](frontend-copilot/.bundled-runtime/staging/backend-runtime-manifest.json)，至少确认：
   - `runtimeMode` 为 `bundled`；
   - `python.executableRelativePath` 指向 `python/python.exe`；
   - `backend.entryModule` 为 `app.desktop_runtime`；
   - `backend.pythonPathRelativePaths` 同时包含 `backend` 与 `python-packages`。

#### 3. 打包前发布验收步骤

1. 以同样的 bundled Python 环境变量执行 `npm run package:desktop -- --dir`。
2. 确认 [`frontend-copilot/release/0.0.0/`](frontend-copilot/release/0.0.0/) 已生成 `win-unpacked` 与安装包文件。
3. 确认 [`frontend-copilot/release/0.0.0/win-unpacked/resources/python-runtime/`](frontend-copilot/release/0.0.0/win-unpacked/resources/python-runtime/) 的布局与 staging 一致。

### 当前环境未完成、但已具备脚本与文档前提的事项

以下事项在本阶段已形成验证步骤，但没有在当前环境里宣称实测通过：

- 开发态 `npm run dev` 的 hosted backend 冒烟未通过。当前环境里实际观测到 Electron 主进程编译产物在加载 [`frontend-copilot/electron/main.ts`](frontend-copilot/electron/main.ts:1) 时以 `Node.js v24.14.0` 报出 `electron` ESM named export 错误，因此该项需要在后续真实 Electron 开发环境中复测。
- 打包后的安装包“首次启动 → runtime ready → 关闭无残留进程”冒烟未在本阶段人工走完整链路。
- 当前 staging / packaging 验证使用的是本机 [`C:\Python312`](frontend-copilot/.bundled-runtime/staging/python/) 作为 bundled runtime 输入；这足以验证脚本、manifest、资源布局和打包链路，但不等同于已经验证过最终发布要分发的专用 Python runtime 产物。

### 本阶段非阻塞观察

- `npm run build:app` 期间出现了 Vite 的大 chunk 警告，但构建与打包均已完成；本阶段将其记录为后续性能优化项，而不是发布验收阻塞项。

## 现在做到哪一步了

### 当前已经能确认的代码事实

- 已经有 Electron 桌面壳，可以作为桌面应用启动和打包的基础。
- Electron 主进程已新增本地 Python 桌面运行时托管层，会在开发态尝试拉起 [`backend/app/desktop_runtime/`](../backend/app/desktop_runtime/) 并等待就绪。
- 已经有稳定的前端启动链路：`src/main.tsx` → `src/CopilotAppRoot.tsx` → `src/App.tsx`。
- 已经有左侧工作区导航，当前工作区包括：`assistant`、`capabilities`、`files`、`developer`、`settings`。
- `assistant` 工作区已经有三段式骨架：助手类型列、话题列、右侧主内容区。
- 应用启动时会先读取本地 Copilot 配置；只有 `runtimeUrl` 和 `agentName` 都完整时，才会把这两个值传给 Copilot 外层能力。
- 这两个字段现在保存在 Electron `userData/desktop-runtime/config/copilot-settings.json` 文件里；旧版 `userData/copilot-settings.json` 会在读取时迁移。
- Electron 主进程与 Python 托管层会把关键运行事件、stdout / stderr、运行态快照与最近失败摘要落到 `userData/desktop-runtime/` 下的 `logs/` 与 `state/` 目录。
- 前端已经能区分 `loading`、`empty`、`incomplete`、`ready`、`error` 这些运行态，并在聊天面板里给出不同提示。

### 当前只是前端交互、占位或骨架的部分

- 右侧聊天区现在还是“状态说明面板 + 占位文案”，不是完整聊天窗口。
- 会话列表、助手类型、能力中心、文件工作区、开发工作区，当前主要使用前端本地静态数据。
- 设置页里大部分内容——比如模型服务、默认模型、网络搜索、全局记忆、API 服务器——目前主要由 React 本地 state 驱动。
- 设置页虽然出现了“测试连接”“保存配置”等按钮，但当前代码并没有把这些设置正式接成可依赖的后端配置能力。
- 当前前端里虽然存在 Copilot 设置的底层读写封装，但**现有设置界面并没有提供 `runtimeUrl` 和 `agentName` 的正式编辑入口**。

## 不要误解的地方

- `ready` 的意思只是“前端最小配置条件齐了”，**不是**“真实聊天能力已经做完了”。
- 设置页里看到的字段很多，**不等于**这些字段已经被保存、已经接到后端、或者已经形成接口规范。
- 当前文档只会写代码里能确认的事实，不会补写还不存在的 HTTP 路径、请求体、响应体或认证流程。

## 如果你刚接手前端，推荐这样继续看

### 先顺着读

1. [../docs/frontend/README.md](../docs/frontend/README.md)：前端文档总入口，先建立阅读地图。
2. [../docs/frontend/ui-current-state.md](../docs/frontend/ui-current-state.md)：看懂界面现在到底长什么样、哪些区域能交互。
3. [../docs/frontend/backend-connection-contract.md](../docs/frontend/backend-connection-contract.md)：看懂前端现在到底怎样连接后端。
4. [../docs/frontend/roadmap-and-placeholders.md](../docs/frontend/roadmap-and-placeholders.md)：看懂哪些已实现，哪些还是占位，下一步通常先补哪一块。

### 需要查表时再看

- [../docs/frontend/reference-current-fields.md](../docs/frontend/reference-current-fields.md)：查当前真正生效的字段。
- [../docs/frontend/reference-runtime-states.md](../docs/frontend/reference-runtime-states.md)：查 `loading` / `empty` / `incomplete` / `ready` / `error` 的含义。
- [../docs/frontend/reference-page-capabilities.md](../docs/frontend/reference-page-capabilities.md)：查各工作区当前的数据来源、交互程度和接通情况。
- [../docs/frontend/future-backend-api-draft.md](../docs/frontend/future-backend-api-draft.md)：看未来可能需要讨论的后端接口主题，但这份是草案，不是当前实现。

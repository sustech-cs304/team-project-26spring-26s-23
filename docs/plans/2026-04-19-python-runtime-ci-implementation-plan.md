# Python Runtime 打包 CI 实施计划

> 关联设计文档：[`2026-04-19-python-runtime-ci-design.md`](./2026-04-19-python-runtime-ci-design.md)

## 目标说明

本文档把已确认的设计结论转成可执行的 implementation plan，只覆盖 **CI 工作流、CI 辅助脚本、验证与回滚策略**，不改写设计结论，也不提前实现 CI。

首版目标保持与设计文档一致：

1. 在原生平台 runner 上完成 Windows x64、macOS x64、macOS arm64、Linux x64 四个目标组合的打包。
2. 每个 job 直接完成“下载 distributable Python runtime → 安装锁定依赖 → 生成 bundled runtime staging → 导出 Electron 安装包”的全流程。
3. 保持 packaged runtime 契约不变，继续使用 `resources/python-runtime/` + `backend-runtime-manifest.json`。
4. `uv` 只作为构建期工具；首版不做签名、公证、离线源或双层流水线拆分。

## 范围与成功标准

### 范围内

- 新增桌面端打包 CI 工作流。
- 新增 CI 用的 Python 下载/解压辅助脚本。
- 新增 bundled runtime 布局校验脚本。
- 按阶段调整现有 `frontend-validation` 工作流，避免保留与设计不一致的打包路径。
- 补充失败诊断产物与日志策略。

### 范围外

- 不实现代码签名、macOS 公证、发布渠道上传。
- 不重构现有 runtime resolver 或 manifest 契约。
- 不把 runtime 工件与 installer 工件拆成两层流水线。
- 不改动后端依赖版本策略，除非在实施阶段暴露平台兼容性问题并另行决策。
- 不实现离线 Python 镜像、私有 PyPI 镜像或预热 wheel 仓库。

### 首版完成标准

当下列条件同时满足时，认为 implementation 完成：

1. 新工作流可在四个目标组合上运行。
2. 每个 target 都能成功执行 `npm run package:desktop` 并上传安装包产物。
3. 每个 target 都有一条独立的目录打包或等价 smoke 校验，确认 unpacked 结果内存在：
   - `resources/python-runtime/backend-runtime-manifest.json`
   - `resources/python-runtime/python/`
   - `resources/python-runtime/python-packages/`
   - `resources/python-runtime/backend/app/desktop_runtime/__main__.py`
4. 失败时能够回收到足够诊断信息，而不是只看到 Electron 打包失败。

## 计划中的文件清单

## 1. 新增文件

| 文件 | 类型 | 计划改动点 | 原因 |
| --- | --- | --- | --- |
| `.github/workflows/desktop-bundled-runtime-packaging.yml` | 新增 | 新建多平台原生 runner 工作流；定义四目标 matrix；串联 Node 安装、`uv` 安装、Python 下载、runtime staging、`package:desktop:smoke`、`package:desktop`、artifact upload | 作为首版 CI 主入口，承接从 runtime 准备到安装包导出的完整链路 |
| `.github/scripts/download-distributable-python.sh` | 新增 | 为 Linux/macOS 下载、解压、标准化输出 distributable Python 目录；输出 `python_dir`、`python_executable_relative`、`python_version` 等 | 避免把平台下载逻辑全部塞进 YAML；便于本地与 CI 复现 |
| `.github/scripts/download-distributable-python.ps1` | 新增 | 为 Windows 下载、解压、标准化输出 distributable Python 目录；输出与 POSIX 脚本一致的结果键 | Windows 下载、解压和路径处理与 POSIX 差异较大，单独脚本更稳定 |
| `frontend-copilot/scripts/verify-bundled-runtime-layout.mjs` | 新增 | 以脚本方式校验 staging 目录与 unpacked app 目录中的 `python-runtime/` 内容，检查 manifest、Python 可执行文件、`python-packages/`、backend 入口与 metadata | 让 fail-fast 校验从 workflow YAML 中抽离，形成可复用、可本地重跑的验证工具 |
| `docs/plans/2026-04-19-python-runtime-ci-implementation-plan.md` | 新增 | 记录实施阶段、文件改动点、验证方式、回滚策略与首版边界 | 让设计与实施计划分离，避免修改已确认设计结论 |

## 2. 需要修改的现有文件

| 文件 | 类型 | 计划改动点 | 原因 |
| --- | --- | --- | --- |
| `.github/workflows/frontend-validation.yml` | 修改 | 在新 workflow 稳定后，移除当前基于 `actions/setup-python` + `pythonLocation` 的 `desktop-packaging-smoke` job；保留纯前端验证职责 | 当前 smoke job 依赖 runner 工具链路径，与已确认设计的“显式下载 distributable Python”主线不一致，后续会形成双轨 CI |

## 3. 明确复用、首版不改动的锚点文件

| 文件 | 处理方式 | 说明 |
| --- | --- | --- |
| `frontend-copilot/package.json` | 复用现有脚本 | 直接复用 `stage:bundled-runtime`、`package:desktop`、`package:desktop:smoke`，首版不建议新增额外 npm 包装层 |
| `frontend-copilot/scripts/prepare-bundled-runtime.mjs` | 保持契约不变 | 继续作为 staging 唯一入口；首版不修改布局契约，只通过 CI 环境变量驱动 |
| `frontend-copilot/electron-builder.json5` | 保持不变 | `extraResources` 已满足 `python-runtime/` 入包需求 |
| `backend/pyproject.toml` | 作为输入约束 | 继续提供 `requires-python` 与 backend version 元信息 |
| `backend/uv.lock` | 作为输入约束 | 继续作为 CI 导出锁定依赖和安装 third-party packages 的唯一锁定来源 |
| `backend/.python-version` | 作为输入约束 | 继续作为 Python 主版本线校验依据 |

## 工作流与脚本设计建议

## 1. 主工作流：`desktop-bundled-runtime-packaging.yml`

### 1.1 触发条件

建议首版触发方式：

- `workflow_dispatch`
- `push`：当以下路径变动时触发
  - `.github/workflows/desktop-bundled-runtime-packaging.yml`
  - `.github/scripts/**`
  - `frontend-copilot/**`
  - `backend/app/**`
  - `backend/pyproject.toml`
  - `backend/uv.lock`
  - `backend/.python-version`
- `pull_request`：沿用相同 path filters

### 1.2 job 组织

建议采用单工作流、四 target matrix：

| targetId | runner 建议 | arch | 产物 |
| --- | --- | --- | --- |
| `windows-x64` | `windows-2022` | `x64` | NSIS `.exe` |
| `linux-x64` | `ubuntu-22.04` | `x64` | `AppImage` |
| `macos-x64` | `macos-13` 或等价 Intel runner | `x64` | `.dmg` |
| `macos-arm64` | `macos-14` 或等价 Apple Silicon runner | `arm64` | `.dmg` |

> 备注：runner label 需要在实际实施前最终 pin 一次；这属于执行参数，不是架构阻塞项。

### 1.3 每个 job 的标准步骤

1. checkout 仓库。
2. setup Node 22，并缓存 `frontend-copilot/package-lock.json`。
3. `npm ci`。
4. setup `uv`。
5. 执行平台对应的 Python 下载脚本，显式下载并解压 distributable Python。
6. 使用下载脚本输出的目录和可执行文件相对路径，设置：
   - `CANDUE_BUNDLED_PYTHON_DIR`
   - `CANDUE_BUNDLED_PYTHON_EXECUTABLE_RELATIVE`
   - `CANDUE_BUNDLED_PYTHON_VERSION`
7. 先执行 `npm run stage:bundled-runtime`。
8. 执行 `node ./scripts/verify-bundled-runtime-layout.mjs --mode staging`。
9. 执行 `npm run package:desktop:smoke`。
10. 执行 `node ./scripts/verify-bundled-runtime-layout.mjs --mode unpacked`。
11. 执行 `npm run package:desktop`。
12. 上传安装包、目录打包输出、manifest、requirements、关键日志。

### 1.4 matrix 需要显式参数化的字段

每个 target 建议至少显式声明：

- `targetId`
- `runner`
- `platform`
- `arch`
- `pythonVersion`
- `pythonDownloadUrl`
- `pythonArchiveKind`（zip / tar.gz / tar.zst / pkg-extract 等）
- `pythonExecutableRelative`
- `expectedArtifactGlob`

这样可以把“平台差异”收敛到 matrix 数据，而不是散落在 workflow 条件分支里。

## 2. Python 下载辅助脚本

### 2.1 目标职责

`.github/scripts/download-distributable-python.sh` 与 `.github/scripts/download-distributable-python.ps1` 的职责应保持克制，只负责：

1. 下载并解压指定平台与架构的 distributable Python。
2. 输出一个稳定的 runtime 根目录。
3. 校验 Python 可执行文件存在。
4. 执行 `python --version` 并与 matrix / `backend/.python-version` / `backend/pyproject.toml` 对齐。
5. 通过 GitHub Actions step outputs 或环境文件，把下列值返回给 workflow：
   - `python_dir`
   - `python_executable_relative`
   - `python_version`
   - `python_source_label`

### 2.2 不应该放进下载脚本的职责

以下事项不建议塞进下载脚本：

- 不在下载脚本里安装 backend 依赖。
- 不在下载脚本里复制 backend 源码。
- 不在下载脚本里直接生成 manifest。
- 不在下载脚本里调用 Electron 打包。

原因是这些都属于 `prepare-bundled-runtime.mjs` 或 workflow 编排层，不应与“下载 Python”混在一起。

## 3. 布局校验脚本：`verify-bundled-runtime-layout.mjs`

建议支持至少两种模式：

### 3.1 `--mode staging`

输入 `frontend-copilot/.bundled-runtime/staging`，校验：

- `backend-runtime-manifest.json` 存在且可解析。
- manifest 中的 `python.executableRelativePath` 可落到 staging 内真实文件。
- `backend.workingDirectoryRelativePath` 存在。
- `backend/app/desktop_runtime/__main__.py` 存在。
- `metadata/backend-requirements.txt` 存在。
- `pythonPathRelativePaths` 与 `sitePackagesRelativePaths` 对应路径存在。

### 3.2 `--mode unpacked`

输入各平台 `package:desktop:smoke` 生成的 unpacked 目录，定位其 `resources/python-runtime/` 后校验与 staging 同样的关键资源是否仍然存在。

### 3.3 脚本输出要求

脚本应输出结构化结果，至少包含：

- 校验模式
- 发现的 runtime 根目录
- manifest 路径
- Python 可执行文件路径
- 缺失项列表

这样失败时不必回头阅读 Electron Builder 的长日志才能定位问题。

## 分阶段实施顺序与里程碑

## 阶段 0：冻结执行参数与迁移策略

### 目标

在开始写 workflow 之前，把实施路径固定，避免边写边改目标矩阵。

### 任务

1. 确认四个 target 的 runner label。
2. 确认每个 target 的 Python 分发来源、下载 URL 模板、解压格式与可执行文件相对路径。
3. 确认 artifact 命名与上传保留策略。
4. 确认 `frontend-validation.yml` 中旧 smoke job 的退场方式：
   - 推荐：新 workflow 稳定后移除该 job。
   - 临时策略：在新 workflow 合入初期保留它作为回滚垫片，但不再继续增强。

### 验证方式

- 通过设计 review / issue checklist 确认 matrix 字段完整。
- 输出一份 target 参数表，可直接映射到 workflow matrix。

### 里程碑

- **M0：四个 target 的下载输入与 runner 选择已冻结。**

## 阶段 1：搭建主工作流骨架

### 目标

先把“可运行但不做全量打包”的 workflow 骨架立起来。

### 任务

1. 新建 `.github/workflows/desktop-bundled-runtime-packaging.yml`。
2. 接入 `workflow_dispatch` 与 path filters。
3. 实现 matrix 和 job 基本结构。
4. 完成 `checkout`、Node 安装、`npm ci`、`uv` 安装。
5. 接入平台下载脚本，但此阶段先只做到：下载 Python → 版本校验 → 输出路径。

### 变更文件

- `.github/workflows/desktop-bundled-runtime-packaging.yml`
- `.github/scripts/download-distributable-python.sh`
- `.github/scripts/download-distributable-python.ps1`

### 验证方式

- 先按 **Windows x64 → Linux x64 → macOS x64 → macOS arm64** 的顺序逐个启用 target。
- 每个 target 只验证：
  - Python 目录存在
  - 可执行文件存在
  - `python --version` 与约束一致

### 里程碑

- **M1：四个 target 都能稳定获得 distributable Python，并把路径参数传给 workflow。**

## 阶段 2：接通 staging 与 fail-fast 布局校验

### 目标

把下载到的 Python 真正送入现有 staging 主线，并在 Electron 打包前就发现问题。

### 任务

1. 在 workflow 中注入 `CANDUE_BUNDLED_PYTHON_*` 环境变量。
2. 调用 `npm run stage:bundled-runtime`。
3. 新增 `frontend-copilot/scripts/verify-bundled-runtime-layout.mjs`。
4. 在 workflow 中增加 `--mode staging` 校验步骤。
5. 失败时上传：
   - manifest
   - requirements
   - 版本输出
   - staging 文件树摘要

### 变更文件

- `.github/workflows/desktop-bundled-runtime-packaging.yml`
- `frontend-copilot/scripts/verify-bundled-runtime-layout.mjs`

### 验证方式

- 对每个 target 检查 `.bundled-runtime/staging` 布局。
- 人工 spot check manifest 中：
  - `entryModule` 仍是 `app.desktop_runtime`
  - `pythonPathRelativePaths` 仍指向 `backend/` 与 `python-packages/`

### 里程碑

- **M2：四个 target 都能稳定生成自洽的 staging 目录。**

## 阶段 3：接通目录打包 smoke 与 unpacked 内容校验

### 目标

先验证“被打进 app 的内容正确”，再做正式安装包导出。

### 任务

1. 在 workflow 中执行 `npm run package:desktop:smoke`。
2. 扩展 `verify-bundled-runtime-layout.mjs`，支持 `--mode unpacked`。
3. 让脚本自动定位各平台 unpacked 目录下的 `resources/python-runtime/`。
4. 对 unpacked 结果执行内容校验。

### 变更文件

- `.github/workflows/desktop-bundled-runtime-packaging.yml`
- `frontend-copilot/scripts/verify-bundled-runtime-layout.mjs`

### 验证方式

- Windows：验证 `win-unpacked/resources/python-runtime/`
- Linux：验证 `linux-unpacked/resources/python-runtime/`
- macOS：验证 `.app/Contents/Resources/python-runtime/`

### 里程碑

- **M3：四个 target 的目录打包结果都已确认真实携带 bundled runtime。**

## 阶段 4：接通正式安装包导出与产物上传

### 目标

在已有 smoke 校验通过的前提下，导出真正的安装包产物。

### 任务

1. 在 workflow 中执行 `npm run package:desktop`。
2. 上传正式安装包与对应 release 目录。
3. 上传最小必要诊断附件：
   - `backend-runtime-manifest.json`
   - `metadata/backend-requirements.txt`
   - `python --version` / `uv --version` / `node --version`
   - stage 与 unpacked 验证日志
4. 确认产物命名与电子包类型符合 `electron-builder.json5`。

### 变更文件

- `.github/workflows/desktop-bundled-runtime-packaging.yml`

### 验证方式

- 检查每个 target 至少产生一个预期安装包文件。
- 检查 release 目录非空、artifact 上传成功。
- 确认 full package 导出发生在 dir smoke 校验之后。

### 里程碑

- **M4：四个 target 都能在 CI 中产出安装包并上传产物。**

## 阶段 5：清理旧路径并稳定化

### 目标

避免仓库中同时存在两条含义不同的桌面打包 CI 路径。

### 任务

1. 修改 `.github/workflows/frontend-validation.yml`，移除当前 `desktop-packaging-smoke` job。
2. 让 `frontend-validation` 回归前端校验职责。
3. 保留新的 `desktop-bundled-runtime-packaging.yml` 作为唯一桌面安装包主线。
4. 根据前几阶段真实日志，补充失败诊断说明与维护约定。

### 验证方式

- 修改前端非打包文件时，不触发新的桌面打包 workflow。
- 修改 runtime 相关输入时，新的桌面打包 workflow 会触发。
- 仓库内不再存在基于 runner 预装 Python 的桌面打包 job。

### 里程碑

- **M5：仓库 CI 中只保留一条与设计一致的桌面打包主线。**

## 推荐实施顺序

推荐按以下顺序推进，而不是一次性四平台同时落地：

1. **Windows x64**：现有仓库已有 Windows 桌面 smoke 经验，最适合作为第一条新链路。
2. **Linux x64**：POSIX 路径和解压逻辑可与 macOS 共享一部分实现，但 Electron 产物校验相对简单。
3. **macOS x64**：验证 DMG 导出路径与 `.app` 资源布局。
4. **macOS arm64**：最后接入 runner/架构差异最大的目标，减少前期变量叠加。

## 各阶段验证方法汇总

| 阶段 | 必做验证 | 通过标准 |
| --- | --- | --- |
| 阶段 1 | Python 下载与版本校验 | 可执行文件存在，版本满足 `3.12` 主版本线与 `>=3.12` 约束 |
| 阶段 2 | staging 布局校验 | manifest、自定义 `PYTHONPATH`、backend 入口、requirements 均存在 |
| 阶段 3 | unpacked app 内容校验 | `resources/python-runtime/` 在 dir smoke 结果中存在且结构完整 |
| 阶段 4 | 正式安装包导出校验 | 预期扩展名安装包成功输出并上传 artifact |
| 阶段 5 | CI 路径收敛校验 | 旧 Windows-only 预装 Python smoke job 被移除，主线唯一 |

## 失败回滚与诊断策略

## 1. 回滚策略

### 1.1 变更集回滚原则

首版实施应尽量把改动收敛在：

- 新 workflow 文件
- 新下载脚本
- 新校验脚本
- 对 `frontend-validation.yml` 的一次收尾修改

这样当新流程失效时，可以：

1. 先回滚新 workflow 与辅助脚本，不影响现有桌面运行时契约。
2. 若仅某一平台失败，先在 matrix 中临时移除该平台，而不是整体撤回全部目标。
3. 在新 workflow 稳定前，不急于第一时间删除旧 smoke job，把它当作过渡期保险丝。

### 1.2 平台级回滚

如果某个新增平台连续失败：

- 优先临时 `exclude` 该 matrix row。
- 保持其他已稳定平台继续产出安装包。
- 在独立 issue 中追踪平台兼容性问题，而不是让整条流水线回退到旧架构。

## 2. 诊断策略

### 2.1 必须保留的诊断信息

每个 job 至少保留：

- `node --version`
- `uv --version`
- `python --version`
- 下载到的 Python 根目录与可执行文件相对路径
- `.bundled-runtime/staging/backend-runtime-manifest.json`
- `.bundled-runtime/staging/metadata/backend-requirements.txt`
- staging 文件树摘要
- unpacked app 下 `resources/python-runtime/` 文件树摘要
- `electron-builder` 核心日志

### 2.2 常见失败点与首选诊断方向

| 失败点 | 典型症状 | 首选诊断方向 |
| --- | --- | --- |
| Python 下载失败 | 404、解压失败、可执行文件找不到 | 检查 matrix URL、压缩格式、runner 自带解压工具可用性 |
| Python 版本不匹配 | staging 前 fail-fast | 检查下载源版本、`backend/.python-version`、`pyproject.toml` 约束 |
| `uv export` 失败 | requirements 未生成 | 检查 `uv.lock`、项目元数据、网络连通性 |
| `uv pip install` 失败 | 某平台 wheel 缺失或尝试本地编译失败 | 从 `uv.lock` 中定位出问题包，确认平台 wheel 可用性 |
| staging 校验失败 | manifest 路径存在但文件缺失 | 检查 `prepare-bundled-runtime.mjs` 输入环境变量与复制结果 |
| dir smoke 校验失败 | unpacked app 中缺少 `python-runtime/` | 检查 `electron-builder.json5` 的 `extraResources` 是否实际生效 |
| 正式安装包导出失败 | `electron-builder` 在收尾阶段退出 | 检查目标平台打包依赖、磁盘空间、默认输出目录内容 |

## 首版边界与后续增强项

## 首版必须完成的部分

1. 原生 runner 四目标矩阵。
2. 在线下载 distributable Python。
3. 使用 `uv` 导出锁定依赖并安装到 `python-packages/`。
4. 基于现有 `prepare-bundled-runtime.mjs` 生成 staging。
5. 基于 `package:desktop:smoke` 做 unpacked 内容校验。
6. 导出正式安装包并上传 artifact。
7. 失败时保留必要诊断信息。

## 首版明确不做的部分

1. 签名、公证、发布渠道接入。
2. 安装后真实启动应用并运行后端联通性 smoke。
3. 对安装包二进制本体做深度解包校验。
4. Python 归档校验和白名单强校验。
5. Node / Python / wheel 的重度缓存优化。
6. runtime 工件与 installer 工件拆分。

## 后续增强建议

1. 为 Python 下载补充校验和校验与来源白名单。
2. 给 Node 依赖、Python 压缩包、`uv` 解析结果增加缓存。
3. 视稳定性把下载脚本收敛成 composite action 或 reusable workflow。
4. 增加安装后启动 smoke，确认 packaged runtime 实际可启动后端。
5. 在首版稳定后，再接入 Windows 签名、macOS 签名/公证。
6. 如平台 wheel 兼容性暴露问题，再针对 `backend/uv.lock` 做依赖治理。

## 最先应执行的 3 个具体实现步骤

1. **冻结四个 target 的 matrix 参数表**：明确 runner label、Python 下载源、归档格式、可执行文件相对路径、预期安装包扩展名。
2. **新建桌面打包主工作流骨架**：先只打通 `checkout`、Node/`uv` 安装、Python 下载、版本校验，不急于第一步就接入 Electron 打包。
3. **新增 bundled runtime 布局校验脚本并接入 staging smoke**：先确保 `.bundled-runtime/staging` 自洽，再接入 `package:desktop:smoke` 和正式安装包导出。

## 是否存在阻塞实现的开放问题

当前**没有阻塞 implementation planning 的开放问题**。可以继续进入实施。

但有三项需要在实施开始前一次性钉住的执行参数，它们属于**非阻塞执行决策**，不是架构阻塞：

1. 四个 target 采用的具体 Python 分发来源与 URL 模板。
2. `macOS x64` 与 `macOS arm64` 的最终 runner label。
3. 新 workflow 稳定前，旧 `frontend-validation.yml` 中 Windows smoke job 的保留时长。

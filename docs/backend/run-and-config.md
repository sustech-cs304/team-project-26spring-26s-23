---
title: 后端运行与配置
description: 说明 desktop runtime 的启动方式、配置来源，以及 CLI 与 Electron 宿主管理下的路径差异。
sidebar_position: 3
---

# 后端运行与配置

这页只说明当前 Python `desktop_runtime` 怎样启动、怎样取配置，以及同一套 runtime 在两种运行语境下会落到什么路径上。目录边界请看[后端模块布局](./module-layout.md)，端点与方法请看[后端暴露契约与前端接入点](./frontend-connection.md)。

## 先分清两种运行语境

当前桌面后端虽然只有一套 Python runtime，但实际有两种很不同的运行语境。

| 语境 | 谁发起启动 | 路径从哪里来 | 当前更常见的场景 |
| --- | --- | --- | --- |
| 直接用 CLI 运行 | 开发者手动执行 `python -m app.desktop_runtime` | runtime 自己按 CLI 参数、环境变量和默认值解析 | 后端开发、联调、单独验证 runtime |
| Electron 宿主管理运行 | Electron 主进程启动 Python 子进程 | 主进程先根据 `CanDue` 的 `userData` 派生路径，再显式传给 runtime | 正式桌面应用、打包运行、宿主托管 |

如果不先把这两种语境拆开，文档很容易被写成“后端永远落在 `backend/data`”这一条单一路径叙事，而这和桌面正式运行现状并不一致。

## CLI 直接运行时，runtime 仍然按自己的配置规则工作

直接运行 Python runtime 时，当前入口仍然是：

```bash
uv run --directory backend python -m app.desktop_runtime
```

这条路径下，runtime 会自己解析配置。当前优先级很明确：

1. CLI 参数优先。
2. 环境变量其次。
3. 默认值最后兜底。

### CLI 直接运行时的默认路径

如果没有显式传入目录参数，runtime 当前会按下面这组默认值工作：

| 项目 | 默认值 |
| --- | --- |
| `userDataDir` | `backend/data` |
| `runtimeRootDir` | `backend/data/desktop-runtime` |
| `configDir` | `backend/data/desktop-runtime/config` |
| `logsDir` | `backend/data/desktop-runtime/logs` |
| `databaseDir` | `backend/data/desktop-runtime/database` |
| `stateDir` | `backend/data/desktop-runtime/state` |
| `settingsFile` | `backend/data/desktop-runtime/config/copilot-settings.json` |

因此，`backend/data` 这套路径叙事只适用于“你没有额外传参，并且直接用 CLI 启动 Python runtime”这一类场景。

## Electron 宿主管理运行时，路径先由主进程决定

正式桌面应用里，启动顺序是另一套逻辑。

Electron 主进程会先统一产品名 `CanDue`，再从宿主 `userData` 根目录派生出 hosted runtime 路径，然后把这些路径显式传给 Python 子进程。当前主进程派生出来的目录结构是：

```text
{userData}/
└── desktop-runtime/
    ├── config/
    ├── logs/
    ├── database/
    └── state/
```

这意味着桌面正式运行时，Python runtime 并不会靠自己的默认 `backend/data` 去猜目录。更常见的实际情况是：主进程已经把 `--user-data-dir`、`--root-dir`、`--config-dir`、`--logs-dir`、`--database-dir` 和 `--state-dir` 一并传进来了。

### Electron 语境下的关键路径

| 项目 | 当前宿主做法 |
| --- | --- |
| `userDataDir` | 取自 Electron 的 `app.getPath('userData')` |
| `runtimeRootDir` | `{userData}/desktop-runtime` |
| `configDir` | `{runtimeRootDir}/config` |
| `logsDir` | `{runtimeRootDir}/logs` |
| `databaseDir` | `{runtimeRootDir}/database` |
| `stateDir` | `{runtimeRootDir}/state` |
| `settingsFile` | `{configDir}/copilot-settings.json` |
| `legacyCopilotSettingsFile` | `{userData}/copilot-settings.json` |

这里还有一条容易漏写的事实：宿主兼容迁移时，会同时关注 `configDir` 里的 `copilot-settings.json` 和 `userData` 根目录下的旧文件。它们现在主要服务主进程侧迁移与兼容，不是当前 Python runtime 的正式配置真源。

## 当前配置 owner 在 Electron 主进程，不在 Python runtime

后端今天仍然会解释 CLI 参数、环境变量和默认值，但统一配置中心已经不在 Python runtime 这一侧。

当前更准确的分工是：

- Electron 主进程负责统一配置中心文档。
- Electron 主进程也负责 settings workspace 的状态文档和 secrets 文档。
- Python runtime 继续只解释启动参数与环境变量。
- 前端 renderer 通过 preload 读取公开配置快照和 runtime 快照，而不是直接去读 Python 目录里的对象。

### 当前这些文件的 owner 是谁

| 路径 | 当前 owner | 当前角色 |
| --- | --- | --- |
| `config-center/*.json` | Electron 主进程 | 统一配置中心分域文档 |
| `config-center/settings-workspace-state.json` | Electron 主进程 | 设置工作区普通状态持久化 |
| `config-center/settings-workspace-secrets.json` | Electron 主进程 | 设置工作区 secrets 持久化 |
| `runtime-snapshot.json` | Electron 主进程与 runtime 生命周期 | 运行态快照 |
| `last-failure.json` | Electron 主进程与 runtime 生命周期 | 最近失败摘要 |

其中 `runtime-snapshot.json` 和 `last-failure.json` 是观测产物，不是配置源。

## Electron 主进程在后端视角下承担三件事

### 它是配置 owner

主进程维护统一配置中心和 settings workspace 文档，并决定哪些字段可以进入公开快照，哪些字段只留在 secrets 存储里。

### 它是 runtime launcher

主进程负责准备目录、构造启动参数、拉起 Python 子进程，并整理 hosted backend 的状态快照给 renderer 使用。

### 它是参数投影者

主进程可以把宿主层已有的配置字段投影为 Python runtime 的启动参数。当前最典型的一条链路是 `backendExposed.model`。

## 模型配置现在有两层语义

当前文档里最容易写错的一点，就是把“宿主给 runtime 的启动模型”与“聊天请求里的本次模型”写成同一层。

### 启动层的模型

Electron 主进程启动 Python runtime 时，会先做一层模型解析：

1. 显式传入的 runtime 模型优先。
2. 然后才是配置中心里的 `backendExposed.model`。
3. 最后才回退到环境变量兼容键。

解析完成后，主进程会把结果投影为 `--model` 传给 Python runtime。

### 请求层的模型与工具策略

当前正式聊天主路径里，`message/send` 仍然会在请求体里显式带上本次 `model` 和 `enabledTools`。这说明：

- 启动时的 `--model` 仍然有 runtime 默认值和兼容入口的意义。
- 当前正式聊天请求仍然采用请求级模型和工具策略。
- 文档不适合把启动参数和每次消息的执行策略写成一层配置。

## 当前安全与宿主边界

### 服务仍然只监听 loopback

runtime 当前只允许 `127.0.0.1`、`localhost` 和 `::1` 这类 loopback 地址。非 loopback 地址会在启动阶段直接被拒绝。

### diagnostics 可以受 local token 保护

如果启动时带了 `--local-token`，`/diagnostics` 和 `/diagnostics/runtime-info` 需要请求头 `X-Local-Token`。这个 token 不会作为公开配置快照的一部分暴露给 renderer。

### Electron 打包场景有单独的 CORS 处理

服务端会允许桌面场景需要的 loopback origin，并对打包应用中常见的 `Origin: null` 做额外校验。这里只保留结论，完整生命周期请看[运行时生命周期](../system/runtime-lifecycle.md)。

## 直接运行时最常用的命令

### 最小启动

```bash
uv run --directory backend python -m app.desktop_runtime
```

### 显式指定模型和目录

```bash
uv run --directory backend python -m app.desktop_runtime --host 127.0.0.1 --port 8771 --root-dir ./backend/data/desktop-runtime-cli --model test
```

### 验证控制面

```text
http://127.0.0.1:8765/health
http://127.0.0.1:8765/ready
http://127.0.0.1:8765/version
http://127.0.0.1:8765/diagnostics
```

## 这页想帮助你先建立什么判断

- `backend/data` 只是一种 CLI 默认语境，不代表桌面正式运行路径。
- 桌面正式运行时，路径更常由 Electron 主进程根据 `CanDue` 的 `userData` 派生并显式传入。
- Python runtime 当前不会直接读取统一配置中心或 settings workspace 文档。
- 当前正式聊天主路径仍然保留请求级模型和工具策略，不会被启动参数合并成一层。

## 相关文档

- [后端模块布局](./module-layout.md)
- [后端暴露契约与前端接入点](./frontend-connection.md)
- [运行与配置参考](./reference-run-and-config.md)
- [运行时生命周期](../system/runtime-lifecycle.md)

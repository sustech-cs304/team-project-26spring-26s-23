---
title: 后端运行与配置
description: 说明 desktop runtime 的启动方式、配置来源，以及 CLI 与 Electron 宿主管理下的路径、thread/run 主链与调试边界。
sidebar_position: 3
---

# 后端运行与配置

这页只说明当前 Python `desktop_runtime` 怎样启动、怎样取配置，以及同一套 runtime 在两种运行语境下会落到什么路径和边界上。目录边界见 [后端模块布局](./module-layout.md)，HTTP 方法与前端接入方式见 [后端暴露契约与前端接入点](./frontend-connection.md)。

## 先分清两种运行语境

当前桌面后端虽然只有一套 Python runtime，但实际有两种不同的运行语境。

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
| `chatDatabaseFile` | `backend/data/desktop-runtime/database/copilot-chat.db` |
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
| `chatDatabaseFile` | `{runtimeRootDir}/database/copilot-chat.db` |
| `stateDir` | `{runtimeRootDir}/state` |
| `settingsFile` | `{configDir}/copilot-settings.json` |
| `legacyCopilotSettingsFile` | `{userData}/copilot-settings.json` |

这里还有一条容易漏写的事实：宿主兼容迁移时，会同时关注 `configDir` 里的 `copilot-settings.json` 和 `userData` 根目录下的旧文件。它们现在主要服务路径兼容、迁移或诊断，不是当前聊天执行配置真源。

### 聊天持久化数据库文件与运维动作

当前持久化聊天真源是 SQLite 文件 `copilot-chat.db`。无论是 CLI 默认语境还是 Electron 宿主管理语境，真正的线程、run、event 以及 projection 都落在各自 `databaseDir` 下的这个文件里，而不是仓库内文档或 renderer 本地状态里。

当前 runtime 已直接暴露与该文件相关的最小运维动作：

- `DELETE /history/threads/{threadId}`：软删除线程；默认线程列表会隐藏该线程，但在 purge 前仍可按 id 读取明细。
- `DELETE /history/threads/{threadId}/purge`：硬删除线程及其级联 truth / projection 行。
- `POST /history/database/backup`：对当前 SQLite 数据库做文件级备份；未显式指定 `targetPath` 时，会在 `databaseDir` 下生成带时间戳的备份文件。
- `POST /history/database/restore`：从外部备份文件恢复当前数据库；恢复前会关闭当前 SQLite 连接并清理 `-wal` / `-shm` sidecar 文件，然后再重建连接。

这些动作都走 desktop runtime 的 loopback 控制面，并继续受本地 token 保护；不要把备份文件、数据库文件或运行时产物重新放回仓库跟踪。

## 当前配置 owner 在 Electron 主进程，不在 Python runtime

后端今天仍然会解释 CLI 参数、环境变量和默认值，但统一配置中心与 settings workspace 已经不在 Python runtime 这一侧。

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

### 它是宿主私桥 owner

主进程当前还会创建宿主私有 provider route bridge。Python runtime 不会直接读取 settings workspace 文档，而是在每次 run 执行前通过私桥解析：

- 当前 `providerProfileId` 对应的 provider profile 是否存在。
- 请求中的路由快照是否仍与本地配置一致。
- 当前 provider profile 是否具备可用 API key。

## 启动层当前只保留运行边界参数

### 启动参数现在主要承载这些内容

Electron 主进程启动 Python runtime 时，当前主要传递：

- host 与 port。
- `app_mode` 与 `environment`。
- 各类目录与文件路径。
- `--local-token`。
- `--host-model-route-bridge-url`。
- `--host-model-route-bridge-token`。

### startup `model` 参数已经退出聊天主线

当前正式聊天主路径里，模型不再在 startup 阶段固定，也不再通过 `--model` 传给 Python runtime。对应测试已经明确验证：启动参数列表中不会再出现 `--model`。

这意味着：

- 聊天模型只在请求级表达，不再由 runtime 启动参数兜底。
- 启动参数层只负责运行边界，不负责本次消息使用哪个 provider 和模型。
- 宿主负责在请求执行时通过 provider route bridge 校验并解析凭据。

## 聊天模型现在只保留请求层语义

当前正式主链里，前端发送 `run/start` 时会显式带上：

- `policy.modelRoute`
- `policy.enabledTools`
- `policy.requestOptions`

兼容层 [`message/send`](../system/chat-runtime-contract.md) 也映射到同一请求语义。其中 `modelRoute` 已经固定为“稳定 ID + 路由快照”的对象，不再是单一字符串 `model`。这说明：

- 聊天模型只在请求级表达。
- provider 路由解析与取密钥发生在执行阶段。
- 工具策略仍然是每次消息请求的显式输入。

## 当前安全与宿主边界

### 服务仍然只监听 loopback

runtime 当前只允许 `127.0.0.1`、`localhost` 和 `::1` 这类 loopback 地址。非 loopback 地址会在启动阶段直接被拒绝。

### diagnostics 可以受 local token 保护

如果启动时带了 `--local-token`，`/diagnostics` 和 `/diagnostics/runtime-info` 需要请求头 `X-Local-Token`。这个 token 不会作为公开配置快照的一部分暴露给 renderer。

### provider secrets 不会通过启动参数下发

当前宿主只会下发 provider route bridge 的 bootstrap 信息，而不会把 API key 或 provider 配置快照整体塞进启动参数。Python runtime 在执行阶段按需请求宿主，拿到本轮最小必要结果。

## 直接运行时最常用的命令

### 最小启动

```bash
uv run --directory backend python -m app.desktop_runtime
```

### 显式指定目录

```bash
uv run --directory backend python -m app.desktop_runtime --host 127.0.0.1 --port 8771 --root-dir ./backend/data/desktop-runtime-cli
```

### 验证控制面

```text
http://127.0.0.1:8765/health
http://127.0.0.1:8765/ready
http://127.0.0.1:8765/version
http://127.0.0.1:8765/diagnostics
```

### 验证真实流式聊天主线

```bash
cd frontend-copilot
node ./scripts/smoke-thread-run-chat.mjs --provider-profile-id custom-provider-1
node ./scripts/smoke-thread-run-chat.mjs --provider-profile-id custom-provider-1 --enable-weather-tool
node ./scripts/smoke-streaming-chat.mjs --provider-profile-id custom-provider-1
```

当前 smoke 是双轨。`smoke-thread-run-chat.mjs` 直接验证 thread/run 主链；`smoke-streaming-chat.mjs` 验证兼容壳。它们都会在本地创建宿主私桥、拉起 Python runtime，并验证真实 provider、请求级模型路由、宿主取密钥与流式事件主线。启用 `--enable-weather-tool` 后，脚本会额外校验真实工具闭环，要求事件序列包含 `run_started → tool_event(started) → tool_event(completed) → text_delta → run_completed`。

## 这页想帮助你先建立什么判断

- `backend/data` 只是一种 CLI 默认语境，不代表桌面正式运行路径。
- 桌面正式运行时，路径更常由 Electron 主进程根据 `CanDue` 的 `userData` 派生并显式传入。
- Python runtime 当前不会直接读取统一配置中心或 settings workspace 文档。
- 当前正式聊天主路径已经不再使用 startup `model` 参数。
- thread/run 是真实主链，`session/create`、`capabilities/get`、`message/send` 是兼容壳。
- 后端默认 collector 已切到 provider-native raw stream，`result.stream_text()` 仅作 fallback。
- 当观察到 raw tool-call 参数完备却没有真实工具执行时，运行时会输出诊断并失败收口。
- provider secrets 仍然留在宿主真源，Python runtime 只在执行阶段通过私桥按需解析。

## 相关文档

- [后端模块布局](./module-layout.md)
- [后端暴露契约与前端接入点](./frontend-connection.md)
- [运行与配置参考](./reference-run-and-config.md)
- [运行时生命周期](../system/runtime-lifecycle.md)

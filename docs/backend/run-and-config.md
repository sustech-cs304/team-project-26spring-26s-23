---
title: 后端运行与配置
description: 说明 desktop runtime 的启动方式、配置来源、运行目录，以及它与统一配置中心和当前聊天主路径的关系。
sidebar_position: 3
---

# 后端运行与配置

本文档解释当前 Python desktop runtime 怎样启动、怎样取配置、运行目录长什么样，以及它和 Electron 宿主配置中心之间现在怎样配合。

## 先给结论

当前后端运行方式可以概括成一句话：

> **Python runtime 继续以 CLI 参数、环境变量和默认值解释配置；Electron 主进程负责统一配置中心、宿主治理与参数投影；两者之间不是“runtime 直接读取配置中心文件”的关系。**

这句话里最容易被写错的有两点：

1. 统一配置中心已经正式落在 Electron 主进程侧。
2. Python runtime 当前并不会直接读取 `config-center/*.json`。

## 文档范围

本文档覆盖：

- desktop runtime 的启动入口
- CLI 参数、环境变量和默认值的优先级
- 运行目录与落盘路径
- 配置中心与 Python runtime 的关系
- 当前聊天主路径在后端侧需要哪些基础条件

本文档不展开：

- Electron 到 Python 的完整跨进程生命周期
- 控制面和聊天端点的完整 HTTP 契约
- Blackboard / TIS 业务能力本身

## 启动入口

### 主要启动路径

当前后端的主要启动入口是：

- `python -m app.desktop_runtime`

从仓库根目录更推荐这样跑：

```bash
uv run --directory backend python -m app.desktop_runtime
```

这样做的好处是：

- 运行目录更清楚
- 更容易显式传路径和模型参数
- 更接近宿主最终调用方式

### 配置解析入口

当前运行配置由 `parse_runtime_config()` 解析，解析顺序是：

1. CLI 参数
2. 环境变量
3. 默认值

最终会生成 desktop runtime 配置对象，再交给服务器入口继续启动。

### 服务器入口会做什么

服务器启动时当前会：

- 创建 FastAPI 应用
- 注册 `/health`、`/ready`、`/version`、`/build-info`、`/diagnostics`、`/diagnostics/runtime-info`
- 注册统一的聊天根端点 `POST /`
- 配置 loopback-only 安全边界
- 挂上 runtime 生命周期管理

## 配置来源与优先级

### 当前优先级

配置来源按这个顺序生效：

1. **CLI 参数**
2. **环境变量**
3. **默认值**

因此当前推荐写法仍然是：

- 开发和联调时优先显式传 CLI 参数
- 环境变量主要保留给兼容回退和宿主内部传递

## 关键参数类别

### 1. 网络参数

| 参数 | CLI 标志 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| Host | `--host` | `COPILOT_DESKTOP_RUNTIME_HOST` | `127.0.0.1` | 仅允许 loopback 地址 |
| Port | `--port` | `COPILOT_DESKTOP_RUNTIME_PORT` | `8765` | 本地监听端口 |

当前 host 必须是 loopback 地址，例如：

- `127.0.0.1`
- `localhost`
- `::1`

否则启动会失败。

### 2. 运行模式参数

| 参数 | CLI 标志 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| App Mode | `--app-mode` | `COPILOT_DESKTOP_RUNTIME_APP_MODE` | `desktop` | 应用模式标识 |
| Environment | `--environment` | `COPILOT_DESKTOP_RUNTIME_ENVIRONMENT` | `development` | 运行环境标识 |

### 3. 目录参数

| 参数 | CLI 标志 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| User Data Dir | `--user-data-dir` | `COPILOT_DESKTOP_RUNTIME_USER_DATA_DIR` | `backend/data` | userData 根目录；Electron 宿主会传入自己的 userData |
| Runtime Root Dir | `--root-dir` | `COPILOT_DESKTOP_RUNTIME_ROOT_DIR` | `{user_data_dir}/desktop-runtime` | 运行时根目录 |
| Config Dir | `--config-dir` | `COPILOT_DESKTOP_RUNTIME_CONFIG_DIR` | `{runtime_root_dir}/config` | 配置目录 |
| Logs Dir | `--logs-dir` | `COPILOT_DESKTOP_RUNTIME_LOGS_DIR` | `{runtime_root_dir}/logs` | 日志目录 |
| Database Dir | `--database-dir` | `COPILOT_DESKTOP_RUNTIME_DATABASE_DIR` | `{runtime_root_dir}/database` | 数据目录 |
| State Dir | `--state-dir` | `COPILOT_DESKTOP_RUNTIME_STATE_DIR` | `{runtime_root_dir}/state` | 状态与诊断目录 |

### 4. 文件路径参数

| 参数 | CLI 标志 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| Settings File | `--settings-file` | `COPILOT_DESKTOP_RUNTIME_SETTINGS_FILE` | `{config_dir}/copilot-settings.json` | 旧设置文件路径；当前主要保留给宿主内部迁移输入 |
| Host Log File | `--host-log-file` | `COPILOT_DESKTOP_RUNTIME_HOST_LOG_FILE` | `{logs_dir}/electron-host.log` | Electron 主进程日志 |
| Backend Stdout Log | `--backend-stdout-log-file` | `COPILOT_DESKTOP_RUNTIME_BACKEND_STDOUT_LOG_FILE` | `{logs_dir}/backend.stdout.log` | Python stdout 日志 |
| Backend Stderr Log | `--backend-stderr-log-file` | `COPILOT_DESKTOP_RUNTIME_BACKEND_STDERR_LOG_FILE` | `{logs_dir}/backend.stderr.log` | Python stderr 日志 |
| Runtime Snapshot | `--runtime-snapshot-file` | `COPILOT_DESKTOP_RUNTIME_SNAPSHOT_FILE` | `{state_dir}/runtime-snapshot.json` | 运行态快照 |
| Last Failure | `--last-failure-file` | `COPILOT_DESKTOP_RUNTIME_LAST_FAILURE_FILE` | `{state_dir}/last-failure.json` | 最近失败摘要 |

### 5. 模型与认证参数

| 参数 | CLI 标志 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| Model | `--model` | `COPILOT_RUNTIME_MODEL`、`COPILOT_MODEL` | `None` | runtime 默认模型 |
| Local Token | `--local-token` | `COPILOT_DESKTOP_RUNTIME_LOCAL_TOKEN` | `None` | diagnostics 保护令牌 |

当前模型参数最准确的理解是：

- `--model` 仍然是 runtime 最直接的模型入口
- Electron 宿主可以把配置中心里的 `backendExposed.model` 投影成这个参数
- 聊天面板里的每次消息模型选择，不会回写这里的启动参数

## 运行目录与产物

### 默认目录结构

默认情况下，运行目录大致是：

```text
backend/data/
└── desktop-runtime/
    ├── config/
    │   ├── config-center/
    │   │   ├── frontend-preferences.json
    │   │   ├── assistant-behavior.json
    │   │   ├── host-config.json
    │   │   ├── backend-exposed.json
    │   │   ├── settings-workspace-state.json
    │   │   └── settings-workspace-secrets.json
    │   └── copilot-settings.json
    ├── logs/
    │   ├── electron-host.log
    │   ├── backend.stdout.log
    │   └── backend.stderr.log
    ├── database/
    └── state/
        ├── runtime-snapshot.json
        └── last-failure.json
```

### 这些目录和文件现在分别代表什么

| 路径 | 当前角色 |
| --- | --- |
| `config-center/*.json` | 正式统一配置中心分域文档 |
| `config-center/settings-workspace-state.json` | 设置页工作区的状态持久化文档，由 Electron 主进程 owner |
| `config-center/settings-workspace-secrets.json` | 设置页 secrets 持久化文档，由 Electron 主进程 owner |
| `copilot-settings.json` | legacy 设置文件路径，主要作为迁移输入 |
| `logs/*` | Electron 主进程与 Python 子进程日志 |
| `runtime-snapshot.json` | 宿主运行态快照 |
| `last-failure.json` | 最近失败摘要 |

这里最关键的一条边界是：

- `runtime-snapshot.json` 和 `last-failure.json` 是观测产物，不是配置源。

## 统一配置中心与 Python runtime 的关系

这是当前后端文档里最需要写准的一节。

### 当前真正的分工

当前系统里：

- Electron 主进程负责统一配置中心
- Electron 主进程也负责 settings workspace 的状态文档与 secrets 文档
- renderer 通过 preload 消费公共快照与公共补丁
- Python runtime 继续只解释 CLI 参数、环境变量和默认值

因此现在不能写成：

- “Python runtime 直接读取统一配置中心分域文件”
- “Python runtime 直接读取 settings workspace 持久化文档”

### settings workspace 在这条边界里的位置

settings workspace 已经为设置页提供了大范围持久化层，但这层当前仍然属于 Electron 主进程 owner。

这意味着：

- renderer 可以通过 preload 读写这些设置页状态与 secret 状态
- 主进程负责把它们保存到 `config-center/settings-workspace-state.json` 和 `config-center/settings-workspace-secrets.json`
- Python runtime 当前不会自己读取这些文档来决定运行参数

因此现在不能把“设置页很多字段已经能保存”直接写成“后端运行时已经直接采用这些字段”。

### `copilot-settings.json` 现在还剩什么作用

旧 `copilot-settings.json` 当前主要只剩：

- 主进程内部迁移输入源

也就是说：

- 它不是 renderer 当前正式接口
- 也不是 runtime 当前正式配置源
- 它只是帮助新配置中心首次落盘时承接旧字段

### `backendExposed.model` 现在怎样进入 runtime

这条链路当前是：

1. 设置页把值写入配置中心 `backendExposed.model`
2. Electron 主进程读取这个字段
3. 宿主在下一次完整启动时决定是否把它投影为 `--model`
4. Python runtime 继续像处理普通 CLI 参数一样处理它

所以这里增加的是：

- **宿主参数投影层**

不是：

- **runtime 自己去读配置文件层**

### secrets 当前仍然属于主进程 owner 范围

provider API key 和 SUSTech CAS password 当前都保存在 settings workspace secrets 文档里。

这层边界需要继续写清楚：

- secret 当前由 Electron 主进程读写和保管
- secret 不进入公开配置快照
- secret 也不是当前 Python runtime 诊断响应里的公开配置来源

## 当前聊天主路径对后端意味着什么

当前前端正式聊天主路径已经是：

- `agents/list`
- `session/create`
- `capabilities/get`
- `message/send`

这对后端的含义是：

### 1. 智能体目录真源在后端

runtime 现在需要对外提供当前智能体目录，而不是默认前端自己写死一份主路径真源。

### 2. 会话要绑定智能体

一旦会话创建成功，该会话就和 `boundAgent` 绑定。后续消息如果携带不一致的 agent 校验值，会报错。

### 3. 模型与工具是请求级策略

当前每条 `message/send` 请求都可以显式给出：

- `model`
- `enabledTools`
- `requestOptions`

因此当前运行时默认模型只是“启动时默认条件”的一部分，不等于每次消息的最终执行模型。

## 安全边界

### Loopback-only

当前 runtime 仍然强制 loopback-only：

- 只允许绑定 `127.0.0.1`、`localhost`、`::1`
- 非 loopback 地址会直接被拒绝

### CORS 与 Electron 场景

当前服务端会对桌面场景做专门处理：

- 只允许 loopback origin
- 对 Electron 打包应用常见的 `Origin: null` 做专门判断
- 不会把任意 `null` origin 都放行

### Local Token

如果配置了 `--local-token`：

- `/diagnostics` 和 `/diagnostics/runtime-info` 需要 `X-Local-Token`
- token 不会写进诊断响应和日志明文

## 开发运行示例

### 最小启动

```bash
uv run --directory backend python -m app.desktop_runtime
```

### 显式指定模型与目录

```bash
uv run --directory backend python -m app.desktop_runtime --host 127.0.0.1 --port 8771 --root-dir ./backend/data/desktop-runtime-cli --model test
```

### 验证运行状态

启动后可以访问：

- `http://127.0.0.1:8765/health`
- `http://127.0.0.1:8765/ready`
- `http://127.0.0.1:8765/version`
- `http://127.0.0.1:8765/diagnostics`

## 当前不要再写成这些说法

下面这些说法当前都不准确：

- “Python runtime 会直接读取统一配置中心文件。”
- “Python runtime 会直接读取 settings workspace state / secrets 文档。”
- “`copilot-settings.json` 仍然是现行正式配置文件。”
- “所有前端设置都已经进入后端运行时配置。”
- “provider API key 和 CAS password 会出现在公开配置快照里。”
- “前端每次消息使用的模型等同于 runtime 启动时的 `--model`。”
- “当前聊天主路径仍然主要是旧 `agent/run`。”

## 相关文档

- [聊天运行时契约](../system/chat-runtime-contract.md)
- [系统架构总览](../system/architecture-overview.md)
- [会话与状态模型](../system/session-and-state-model.md)
- [前端路线图与占位说明](../frontend/roadmap-and-placeholders.md)
- [当前可观察契约参考](./reference-current-contracts.md)

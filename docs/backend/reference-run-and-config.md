---
title: 运行与配置参考
description: 查表式汇总 desktop runtime 的命令、参数、环境变量与两种路径语境。
sidebar_position: 5
---

# 运行与配置参考

这页服务于[后端运行与配置](./run-and-config.md)。正文只保留已经确认的命令、参数、环境变量和路径映射，方便联调时快速查表。

## 当前已确认的启动入口

### 直接运行 desktop runtime

```bash
uv run --directory backend python -m app.desktop_runtime --help
uv run --directory backend python -m app.desktop_runtime
uv run --directory backend python -m app.desktop_runtime --host 127.0.0.1 --port 8771 --root-dir ./backend/data/desktop-runtime-cli --model test
```

### Electron 宿主管理启动

桌面应用正式运行时，不需要手动输入 Python 命令。Electron 主进程会先准备 hosted runtime 路径，再把 host、port、各类目录、`--model` 和 `--local-token` 一并传给 Python 子进程。

## desktop runtime 当前参数参考

### 网络与模式参数

| 参数 | CLI 标志 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| Host | `--host` | `COPILOT_DESKTOP_RUNTIME_HOST` | `127.0.0.1` | 仅允许 loopback 地址。 |
| Port | `--port` | `COPILOT_DESKTOP_RUNTIME_PORT` | `8765` | 本地监听端口。 |
| App Mode | `--app-mode` | `COPILOT_DESKTOP_RUNTIME_APP_MODE` | `desktop` | 应用模式标识。 |
| Environment | `--environment` | `COPILOT_DESKTOP_RUNTIME_ENVIRONMENT` | `development` | 运行环境标识。 |
| Local Token | `--local-token` | `COPILOT_DESKTOP_RUNTIME_LOCAL_TOKEN` | 无 | 保护 diagnostics 端点。 |
| Model | `--model` | `COPILOT_RUNTIME_MODEL`、`COPILOT_MODEL` | 无 | runtime 启动层模型入口。 |

### 目录参数

| 参数 | CLI 标志 | 环境变量 | CLI 直接运行默认值 | Electron 宿主管理下的常见值 |
| --- | --- | --- | --- | --- |
| User Data Dir | `--user-data-dir` | `COPILOT_DESKTOP_RUNTIME_USER_DATA_DIR` | `backend/data` | `CanDue` 的 `userData` 根目录 |
| Runtime Root Dir | `--root-dir` | `COPILOT_DESKTOP_RUNTIME_ROOT_DIR` | `{userDataDir}/desktop-runtime` | `{userDataDir}/desktop-runtime` |
| Config Dir | `--config-dir` | `COPILOT_DESKTOP_RUNTIME_CONFIG_DIR` | `{runtimeRootDir}/config` | `{runtimeRootDir}/config` |
| Logs Dir | `--logs-dir` | `COPILOT_DESKTOP_RUNTIME_LOGS_DIR` | `{runtimeRootDir}/logs` | `{runtimeRootDir}/logs` |
| Database Dir | `--database-dir` | `COPILOT_DESKTOP_RUNTIME_DATABASE_DIR` | `{runtimeRootDir}/database` | `{runtimeRootDir}/database` |
| State Dir | `--state-dir` | `COPILOT_DESKTOP_RUNTIME_STATE_DIR` | `{runtimeRootDir}/state` | `{runtimeRootDir}/state` |

### 文件路径参数

| 参数 | CLI 标志 | 环境变量 | CLI 直接运行默认值 | Electron 宿主管理下的常见值 |
| --- | --- | --- | --- | --- |
| Settings File | `--settings-file` | `COPILOT_DESKTOP_RUNTIME_SETTINGS_FILE` | `{configDir}/copilot-settings.json` | `{configDir}/copilot-settings.json` |
| Host Log File | `--host-log-file` | `COPILOT_DESKTOP_RUNTIME_HOST_LOG_FILE` | `{logsDir}/electron-host.log` | `{logsDir}/electron-host.log` |
| Backend Stdout Log | `--backend-stdout-log-file` | `COPILOT_DESKTOP_RUNTIME_BACKEND_STDOUT_LOG_FILE` | `{logsDir}/backend.stdout.log` | `{logsDir}/backend.stdout.log` |
| Backend Stderr Log | `--backend-stderr-log-file` | `COPILOT_DESKTOP_RUNTIME_BACKEND_STDERR_LOG_FILE` | `{logsDir}/backend.stderr.log` | `{logsDir}/backend.stderr.log` |
| Runtime Snapshot | `--runtime-snapshot-file` | `COPILOT_DESKTOP_RUNTIME_SNAPSHOT_FILE` | `{stateDir}/runtime-snapshot.json` | `{stateDir}/runtime-snapshot.json` |
| Last Failure | `--last-failure-file` | `COPILOT_DESKTOP_RUNTIME_LAST_FAILURE_FILE` | `{stateDir}/last-failure.json` | `{stateDir}/last-failure.json` |

## 两种路径语境对照

| 项目 | CLI 直接运行时的默认值 | Electron 宿主管理下的实际来源 |
| --- | --- | --- |
| `userDataDir` | `backend/data` | Electron `app.getPath('userData')` |
| `runtimeRootDir` | `backend/data/desktop-runtime` | `{userDataDir}/desktop-runtime` |
| `configDir` | `backend/data/desktop-runtime/config` | `{runtimeRootDir}/config` |
| `logsDir` | `backend/data/desktop-runtime/logs` | `{runtimeRootDir}/logs` |
| `databaseDir` | `backend/data/desktop-runtime/database` | `{runtimeRootDir}/database` |
| `stateDir` | `backend/data/desktop-runtime/state` | `{runtimeRootDir}/state` |
| `copilotSettingsFile` | `{configDir}/copilot-settings.json` | `{configDir}/copilot-settings.json` |
| `legacyCopilotSettingsFile` | 不涉及 | `{userDataDir}/copilot-settings.json` |

## Electron 主进程持有的配置文档位置

| 路径 | 当前角色 |
| --- | --- |
| `{configDir}/config-center/frontend-preferences.json` | 公开前端偏好文档 |
| `{configDir}/config-center/assistant-behavior.json` | 助手行为相关公开文档 |
| `{configDir}/config-center/host-config.json` | 宿主公开配置文档 |
| `{configDir}/config-center/backend-exposed.json` | 后端可投影字段文档 |
| `{configDir}/config-center/settings-workspace-state.json` | 设置工作区普通状态 |
| `{configDir}/config-center/settings-workspace-secrets.json` | 设置工作区 secrets |

## 模型解析顺序参考

### Python runtime 自己的配置顺序

Python runtime 解析配置时，顺序仍然是：

1. CLI 参数。
2. 环境变量。
3. 默认值。

### Electron 宿主在启动前的模型解析顺序

Electron 主进程决定是否传 `--model` 时，当前顺序是：

1. 显式 runtime 模型。
2. 配置中心里的 `backendExposed.model`。
3. 兼容环境变量键。

这层解析发生在宿主侧，随后才把结果作为启动参数传给 Python runtime。

## 当前已确认的控制面端点

| 端点 | 作用 |
| --- | --- |
| `GET /health` | 最小健康检查。 |
| `GET /ready` | 启动完成度与最近错误摘要。 |
| `GET /version` | 版本、Python 版本与运行模式。 |
| `GET /build-info` | 当前与 `GET /version` 同形。 |
| `GET /diagnostics` | 运行目录、配置摘要与能力摘要。 |
| `GET /diagnostics/runtime-info` | 当前与 `GET /diagnostics` 同形。 |

## 其他已确认的 Python 入口

这些入口已经存在，但它们不属于 Electron 宿主管理下的 hosted backend 主路径。

### Blackboard 课程目录搜索 CLI

```bash
cd backend
python -m app.blackboard.provider.cli.search_course_catalog --keyword 计算机 --preview 5
```

### Blackboard 日历 ICS 同步 CLI

```bash
cd backend
python -m app.blackboard.provider.cli.sync_calendar_ics --save-json
```

## 快速结论

- `backend/data` 只代表 CLI 直接运行时的默认路径语境。
- 正式桌面运行通常落在 `CanDue` 的 `userData` 派生路径下。
- 统一配置中心和 settings workspace 文档由 Electron 主进程持有。
- `copilot-settings.json` 当前主要保留给宿主兼容与迁移路径。

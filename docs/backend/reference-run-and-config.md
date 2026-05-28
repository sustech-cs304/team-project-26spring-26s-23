---
title: 运行与配置参考
description: 查表式汇总 desktop runtime 的命令、参数、环境变量与运行边界。
sidebar_position: 5
---

# 运行与配置参考

服务于 [后端运行与配置](./run-and-config.md)。正文只保留已确认的命令、参数、环境变量和路径映射，方便联调时快速查表。

## 已确认的启动入口

### 直接运行 desktop runtime

```bash
uv run --directory backend python -m app.desktop_runtime --help
uv run --directory backend python -m app.desktop_runtime
uv run --directory backend python -m app.desktop_runtime --host 127.0.0.1 --port 8771 --root-dir ./backend/data/desktop-runtime-cli
```

### Electron 宿主管理启动

桌面应用正式运行时不需要手动输入 Python 命令。Electron 主进程准备 hosted runtime 路径，再把 host、port、各类目录、`--local-token` 和宿主私桥 bootstrap 一并传给 Python 子进程。

## desktop runtime 参数参考

### 网络与模式参数

| 参数 | CLI 标志 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| Host | `--host` | `COPILOT_DESKTOP_RUNTIME_HOST` | `127.0.0.1` | 仅允许 loopback 地址。 |
| Port | `--port` | `COPILOT_DESKTOP_RUNTIME_PORT` | `8765` | 本地监听端口。 |
| App Mode | `--app-mode` | `COPILOT_DESKTOP_RUNTIME_APP_MODE` | `desktop` | 应用模式标识。 |
| Environment | `--environment` | `COPILOT_DESKTOP_RUNTIME_ENVIRONMENT` | `development` | 运行环境标识。 |
| Local Token | `--local-token` | `COPILOT_DESKTOP_RUNTIME_LOCAL_TOKEN` | 无 | 保护 diagnostics 端点。 |

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

### 调试日志参数

| 参数 | CLI 标志 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| Debug Log DB File | `--debug-log-database-file` | `COPILOT_DESKTOP_RUNTIME_DEBUG_LOG_DATABASE_FILE` | `{databaseDir}/copilot-debug-log.db` | 调试日志数据库文件路径。 |
| Debug Log Retention Days | `--debug-log-retention-days` | `COPILOT_DESKTOP_RUNTIME_DEBUG_LOG_RETENTION_DAYS` | `14` | 调试日志保留天数。 |
| Debug Log Auto Cleanup | `--debug-log-auto-cleanup-enabled` | `COPILOT_DESKTOP_RUNTIME_DEBUG_LOG_AUTO_CLEANUP_ENABLED` | `true` | 是否启用自动清理。 |
| Debug Log Min Cleanup Interval | `--debug-log-min-cleanup-interval-seconds` | `COPILOT_DESKTOP_RUNTIME_DEBUG_LOG_MIN_CLEANUP_INTERVAL_SECONDS` | `21600` | 自动清理最小间隔（秒）。 |
| Debug Log Snapshot Retention | `--debug-log-snapshot-retention-days` | `COPILOT_DESKTOP_RUNTIME_DEBUG_LOG_SNAPSHOT_RETENTION_DAYS` | 无 | 快照保留天数。 |

### 宿主私桥 bootstrap 参数

| 参数 | CLI 标志 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| Host Capability Bridge URL | `--host-capability-bridge-url` | `COPILOT_DESKTOP_RUNTIME_HOST_CAPABILITY_BRIDGE_URL` | 无 | 指向宿主私有 capability bridge 的地址。 |
| Host Capability Bridge Token | `--host-capability-bridge-token` | `COPILOT_DESKTOP_RUNTIME_HOST_CAPABILITY_BRIDGE_TOKEN` | 无 | 供 Python runtime 调宿主桥时使用的访问令牌。 |

这两个参数只负责让 Python runtime 访问宿主私桥，不承载聊天模型、provider 配置或 secret。

### 后端版本标识

| 参数 | CLI 标志 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| Backend Version | `--backend-version` | `COPILOT_DESKTOP_RUNTIME_BACKEND_VERSION` | 无 | 后端版本标识，供 Electron 主进程比对。 |

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

| 路径 | 角色 |
| --- | --- |
| `{configDir}/config-center/frontend-preferences.json` | 公开前端偏好文档 |
| `{configDir}/config-center/assistant-behavior.json` | 助手行为相关公开文档 |
| `{configDir}/config-center/host-config.json` | 宿主公开配置文档 |
| `{configDir}/config-center/backend-exposed.json` | 公开兼容字段文档 |
| `{configDir}/config-center/settings-workspace-state.json` | 设置工作区普通状态 |
| `{configDir}/config-center/settings-workspace-secrets.json` | 设置工作区 secrets |

这些文档都由 Electron 主进程持有。Python runtime 不会直接读取。

## 运行参数解析顺序参考

### Python runtime 的配置顺序

1. CLI 参数。
2. 环境变量。
3. 默认值。

### 聊天模型定位

聊天模型不由 startup 参数解析。模型选择在 `run/start` 的请求体里通过 `modelRoute` 表达，执行阶段由宿主私桥校验与解析；兼容入口 [`message/send`](../system/chat-runtime-contract.md) 映射到同一语义。

### 已退役的 startup model 路径

- 启动参数中不再出现 `--model`。
- 启动配置的 sanitized 结果中不再暴露 `modelConfigured` 一类字段。
- 统一配置中心里的 `backendExposed.model` 仍然存在，但它不是聊天主线模型配置。

## 已确认的控制面端点

| 端点 | 作用 |
| --- | --- |
| `GET /health` | 最小健康检查。 |
| `GET /ready` | 启动完成度与最近错误摘要。 |
| `GET /version` | 版本、Python 版本与运行模式。 |
| `GET /build-info` | 与 `GET /version` 同形。 |
| `GET /diagnostics` | 运行目录、配置摘要与能力摘要。 |
| `GET /diagnostics/runtime-info` | 与 `GET /diagnostics` 同形。 |

## 本地主线验收命令

### `thread/run` 聊天 smoke 验收

```bash
cd frontend-copilot
node ./scripts/smoke-thread-run-chat.mjs --provider-profile-id custom-provider-1
```

这条脚本：

1. 从 settings workspace 文档读取 provider profiles 与 secrets。
2. 在本地创建宿主私桥。
3. 拉起 Python runtime。
4. 执行 `thread/create`。
5. 执行 `run/start` 与 `run/stream`，校验最终事件为 `run_completed`。

## 其他已确认的 Python 入口

不属于 Electron 宿主管理下的 hosted backend 主路径。

### Blackboard 课程目录搜索 CLI

```bash
cd backend
python -m app.integrations.sustech.blackboard.provider.cli.search_course_catalog --keyword 计算机 --preview 5
```

### Blackboard 日历 ICS 同步 CLI

```bash
cd backend
python -m app.integrations.sustech.blackboard.provider.cli.sync_calendar_ics --save-json
```

## 快速结论

- `backend/data` 只代表 CLI 直接运行时的默认路径语境。
- 正式桌面运行落在 `CanDue` 的 `userData` 派生路径下。
- 统一配置中心和 settings workspace 文档由 Electron 主进程持有。
- Python runtime 通过宿主私桥解析请求级 provider 路由与密钥。
- startup `model` 参数已退出聊天主线。

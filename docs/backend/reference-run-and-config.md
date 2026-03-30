---
title: 运行与配置参考
description: 结构化汇总当前后端命令、参数、环境变量、默认路径与测试分层事实。
sidebar_position: 7
---

# 运行与配置参考

这份附录服务于 [运行与配置](./run-and-config.md)。它只整理当前已经确认的命令、参数、环境变量和默认路径，方便查表时快速定位。

## 1. 当前已确认的运行入口

### 1.1 已实现入口

| 入口 | 位置 | 当前说明 |
| --- | --- | --- |
| Blackboard 课程目录搜索 CLI | `app.blackboard.provider.cli.search_course_catalog` | 需要凭据；可终端预览；可保存 JSON 报告 |
| Blackboard ICS 同步 CLI | `app.blackboard.provider.cli.sync_calendar_ics` | 需要 feed URL；可写 SQLite；可保存 JSON 报告 |
| Desktop runtime 本地 HTTP 服务 | `app.desktop_runtime` | 仅监听 loopback；提供控制面端点和聊天根端点 |

### 1.2 代码里可调用但不是正式入口

| 入口 | 位置 | 当前说明 |
| --- | --- | --- |
| Blackboard 工具层：课程目录搜索 | `app.blackboard.provider.tools.agent_tools.search_course_catalog` | 返回字典，不是 HTTP 响应 |
| Blackboard 工具层：ICS 刷新 | `app.blackboard.provider.tools.agent_tools.refresh_calendar_ics` | 返回字典，不是 HTTP 响应 |
| Blackboard 工具层：snapshot 同步 | `app.blackboard.provider.tools.agent_tools.sync_blackboard_snapshot` | 返回抓取、同步和校验结果字典 |
| Blackboard snapshot use case | `app.blackboard.provider.use_cases.snapshot_sync.run_blackboard_snapshot_sync` | 内部用例编排，不是正式入口 |
| TIS 诊断 / 成绩 / 学分绩 / 已选课程 use case | `app.teaching_information_system.provider.use_cases.*` | 内部可调用能力，不是正式 HTTP 入口 |

## 2. 常用命令参考

### 2.1 课程目录搜索 CLI

```bash
cd backend
python -m app.blackboard.provider.cli.search_course_catalog --help
python -m app.blackboard.provider.cli.search_course_catalog --keyword 计算机 --preview 5
python -m app.blackboard.provider.cli.search_course_catalog --keyword 数据库 --limit 20 --save-json
```

### 主要参数

| 参数 | 是否必需 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `--keyword` | 必需 | 无 | 搜索关键词 |
| `--field` | 可选 | `CourseName` | 搜索字段 |
| `--operator` | 可选 | `Contains` | 搜索操作符 |
| `--limit` | 可选 | `0` | `<=0` 代表不限制条数 |
| `--preview` | 可选 | `10` | 终端预览条数 |
| `--save-json` | 可选 | 关闭 | 写入 `data/reports/` |

### 2.2 ICS 同步 CLI

```bash
cd backend
python -m app.blackboard.provider.cli.sync_calendar_ics --help
python -m app.blackboard.provider.cli.sync_calendar_ics --save-json
python -m app.blackboard.provider.cli.sync_calendar_ics --feed-url https://example.com/calendar.ics --db-path data/custom.db --save-json
```

### 主要参数

| 参数 | 是否必需 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `--feed-url` | 可选 | 无 | 未传入时按环境变量优先级读取 |
| `--db-path` | 可选 | 无 | 未传入时读环境变量，再回退默认路径 |
| `--save-json` | 可选 | 关闭 | 写同步统计和事件快照 |

### feed URL 解析优先级

1. `--feed-url`
2. `BLACKBOARD_CALENDAR_FEED_URL`
3. `CALENDAR_FEED_URL`

### 数据库路径解析优先级

1. `--db-path`
2. `SUSTECH_DB_PATH`
3. `data/sustech.db`

### 2.3 Desktop runtime

推荐从仓库根目录执行：

```bash
uv run --directory backend python -m app.desktop_runtime --help
uv run --directory backend python -m app.desktop_runtime --model test
uv run --directory backend python -m app.desktop_runtime --host 127.0.0.1 --port 8771 --root-dir ./backend/data/desktop-runtime-cli --model test
```

### 主要参数

| 参数 | 是否必需 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `--host` | 可选 | `127.0.0.1` | 仅允许 loopback 地址 |
| `--port` | 可选 | `8765` | 本地监听端口 |
| `--app-mode` | 可选 | `desktop` | 应用模式 |
| `--environment` | 可选 | `development` | 运行环境 |
| `--user-data-dir` | 可选 | `data` | userData 根目录 |
| `--root-dir` | 可选 | `data/desktop-runtime` | runtime 根目录 |
| `--config-dir` | 可选 | `data/desktop-runtime/config` | 配置目录 |
| `--logs-dir` | 可选 | `data/desktop-runtime/logs` | 日志目录 |
| `--database-dir` | 可选 | `data/desktop-runtime/database` | 数据目录 |
| `--state-dir` | 可选 | `data/desktop-runtime/state` | 状态目录 |
| `--settings-file` | 可选 | `data/desktop-runtime/config/copilot-settings.json` | 旧设置文件路径，当前主要保留给迁移输入 |
| `--host-log-file` | 可选 | `data/desktop-runtime/logs/electron-host.log` | Electron 主进程日志 |
| `--backend-stdout-log-file` | 可选 | `data/desktop-runtime/logs/backend.stdout.log` | Python stdout 日志 |
| `--backend-stderr-log-file` | 可选 | `data/desktop-runtime/logs/backend.stderr.log` | Python stderr 日志 |
| `--runtime-snapshot-file` | 可选 | `data/desktop-runtime/state/runtime-snapshot.json` | 运行态快照 |
| `--last-failure-file` | 可选 | `data/desktop-runtime/state/last-failure.json` | 最近失败摘要 |
| `--model` | 可选 | 无 | runtime 默认模型 |
| `--local-token` | 可选 | 无 | diagnostics 保护令牌 |

### 当前可观察控制面端点

- `GET /health`
- `GET /ready`
- `GET /version`
- `GET /build-info`
- `GET /diagnostics`
- `GET /diagnostics/runtime-info`

### 当前正式聊天方法

- `agents/list`
- `session/create`
- `capabilities/get`
- `message/send`

## 3. 环境变量参考

### 3.1 `.env.example` 中明确给出的变量

| 变量名 | 用途 | 当前适用范围 |
| --- | --- | --- |
| `SUSTECH_USERNAME` | 统一登录用户名 | Blackboard CLI、TIS 调用、live 测试 |
| `SUSTECH_PASSWORD` | 统一登录密码 | Blackboard CLI、TIS 调用、live 测试 |
| `BLACKBOARD_CALENDAR_FEED_URL` | ICS 订阅地址 | ICS CLI |
| `SUSTECH_DB_PATH` | SQLite 数据库路径 | Blackboard / TIS 持久化相关能力 |

### 3.2 Desktop runtime 环境变量

| 变量名 | 用途 | 默认说明 |
| --- | --- | --- |
| `COPILOT_DESKTOP_RUNTIME_HOST` | loopback 监听地址 | 默认 `127.0.0.1` |
| `COPILOT_DESKTOP_RUNTIME_PORT` | 本地监听端口 | 默认 `8765` |
| `COPILOT_DESKTOP_RUNTIME_LOCAL_TOKEN` | diagnostics 令牌 | 默认无 |
| `COPILOT_DESKTOP_RUNTIME_USER_DATA_DIR` | userData 根目录 | 默认 `data` |
| `COPILOT_DESKTOP_RUNTIME_ROOT_DIR` | runtime 根目录 | 默认 `data/desktop-runtime` |
| `COPILOT_DESKTOP_RUNTIME_CONFIG_DIR` | 配置目录 | 默认 `data/desktop-runtime/config` |
| `COPILOT_DESKTOP_RUNTIME_LOGS_DIR` | 日志目录 | 默认 `data/desktop-runtime/logs` |
| `COPILOT_DESKTOP_RUNTIME_DATABASE_DIR` | 数据目录 | 默认 `data/desktop-runtime/database` |
| `COPILOT_DESKTOP_RUNTIME_STATE_DIR` | 状态目录 | 默认 `data/desktop-runtime/state` |
| `COPILOT_DESKTOP_RUNTIME_SETTINGS_FILE` | 旧设置文件路径 | 默认 `data/desktop-runtime/config/copilot-settings.json` |
| `COPILOT_DESKTOP_RUNTIME_HOST_LOG_FILE` | Electron 主进程日志 | 默认 `data/desktop-runtime/logs/electron-host.log` |
| `COPILOT_DESKTOP_RUNTIME_BACKEND_STDOUT_LOG_FILE` | Python stdout 日志 | 默认 `data/desktop-runtime/logs/backend.stdout.log` |
| `COPILOT_DESKTOP_RUNTIME_BACKEND_STDERR_LOG_FILE` | Python stderr 日志 | 默认 `data/desktop-runtime/logs/backend.stderr.log` |
| `COPILOT_DESKTOP_RUNTIME_SNAPSHOT_FILE` | 运行态快照文件 | 默认 `data/desktop-runtime/state/runtime-snapshot.json` |
| `COPILOT_DESKTOP_RUNTIME_LAST_FAILURE_FILE` | 最近失败摘要文件 | 默认 `data/desktop-runtime/state/last-failure.json` |
| `COPILOT_DESKTOP_RUNTIME_APP_MODE` | 应用模式 | 默认 `desktop` |
| `COPILOT_DESKTOP_RUNTIME_ENVIRONMENT` | 运行环境 | 默认 `development` |

### 3.3 代码中额外兼容读取的变量

| 变量名 | 当前含义 | 说明 |
| --- | --- | --- |
| `CALENDAR_FEED_URL` | ICS 订阅地址兼容键 | 仍可用，但主文档以 `BLACKBOARD_CALENDAR_FEED_URL` 为主 |
| `COPILOT_RUNTIME_MODEL` | runtime 模型兼容键 | 仍会读取，但更推荐显式传 `--model` |
| `COPILOT_MODEL` | runtime 模型 legacy 兼容键 | 仍会读取，但更推荐显式传 `--model` |
| `TIS_ROLE_CODE` | TIS 角色代码 | 不在 `.env.example` 基础展示里 |
| `ROLE_CODE` | TIS 角色代码兼容键 | 不在 `.env.example` 基础展示里 |

## 4. 默认路径与落盘位置

| 路径 | 当前用途 |
| --- | --- |
| `backend/.env` | 本地运行配置 |
| `backend/data/sustech.db` | 默认 SQLite 路径 |
| `backend/data/reports/` | CLI JSON 报告目录 |
| `backend/data/desktop-runtime/` | runtime 根目录 |
| `backend/data/desktop-runtime/config/config-center/` | 正式统一配置中心分域文档目录 |
| `backend/data/desktop-runtime/config/copilot-settings.json` | 旧设置文件路径，主要保留给迁移输入 |
| `backend/data/desktop-runtime/logs/` | 日志目录 |
| `backend/data/desktop-runtime/state/` | runtime 快照和失败摘要目录 |
| `backend/tests/` | 测试目录 |

## 5. 当前测试分层

| 目录 | 当前说明 |
| --- | --- |
| `tests/unit/` | 本地逻辑单元测试 |
| `tests/integration/` | 模块协作与 HTTP 集成测试 |
| `tests/e2e/` | 整链路测试 |

### pytest 标记

| 标记 | 含义 |
| --- | --- |
| `live` | 需要真实凭据和网络 |
| `e2e` | Blackboard snapshot sync 端到端验证 |

### 常见测试命令

```bash
cd backend
pytest
pytest -m "not live"
pytest -m live
pytest tests/unit
uv run pytest tests/unit/desktop_runtime -q
```

## 6. 快速结论

- Blackboard CLI：已实现，可直接运行
- Desktop runtime：已实现，推荐用显式 CLI 参数启动
- 配置中心：正式配置在 `config-center/*.json`，旧 `copilot-settings.json` 主要保留给迁移输入
- 聊天主路径：当前正式方法是 `agents/list`、`session/create`、`capabilities/get`、`message/send`
- Blackboard / TIS 复杂业务 API：当前仍不能写成已实现

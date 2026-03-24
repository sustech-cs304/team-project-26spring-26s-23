# 运行与配置参考

> 这份附录服务于 [运行与配置](./run-and-config.md)。它只整理当前已经确认的命令、配置项、默认路径和测试分层事实，不替代正文解释。

## 1. 当前已确认的运行入口

### 1.1 已实现的入口

| 入口 | 位置 | 当前状态 | 说明 |
| --- | --- | --- | --- |
| Blackboard 课程目录搜索 CLI | `app.blackboard.provider.cli.search_course_catalog` | 已实现 | 需要凭据；可终端预览；可保存 JSON 报告。 |
| Blackboard ICS 同步 CLI | `app.blackboard.provider.cli.sync_calendar_ics` | 已实现 | 需要 feed URL；可写 SQLite；可保存 JSON 报告。 |
| Desktop runtime 本地 HTTP 入口 | `app.desktop_runtime` | 已实现 | 仅监听 loopback；提供 `/health`、`/ready`、`/version`、`/build-info`、`/diagnostics`、`/diagnostics/runtime-info` 最小契约。 |

### 1.2 代码里可调用但不是正式入口

| 入口 | 位置 | 当前状态 | 说明 |
| --- | --- | --- | --- |
| Blackboard 工具层：课程目录搜索 | `app.blackboard.provider.tools.agent_tools.search_course_catalog` | 可调用但不是正式入口 | 返回字典，不是 HTTP 响应。 |
| Blackboard 工具层：ICS 刷新 | `app.blackboard.provider.tools.agent_tools.refresh_calendar_ics` | 可调用但不是正式入口 | 返回字典，不是 HTTP 响应。 |
| Blackboard 工具层：snapshot 同步 | `app.blackboard.provider.tools.agent_tools.sync_blackboard_snapshot` | 可调用但不是正式入口 | 返回抓取、同步和校验结果字典。 |
| Blackboard snapshot use case | `app.blackboard.provider.use_cases.snapshot_sync.run_blackboard_snapshot_sync` | 可调用但不是正式入口 | 会抓取、构建 payload、同步数据库、做完整性检查。 |
| TIS 链路诊断 | `app.teaching_information_system.provider.use_cases.diagnostics.run_tis_link_diagnostic` | 可调用但不是正式入口 | 主要用于验证登录、首页分析、候选接口探测。 |
| TIS 个人成绩 | `app.teaching_information_system.provider.use_cases.personal_grades.fetch_personal_grades_with_credentials` | 可调用但不是正式入口 | 可选持久化。 |
| TIS 学分绩 | `app.teaching_information_system.provider.use_cases.credit_gpa.fetch_credit_gpa_with_credentials` | 可调用但不是正式入口 | 可选持久化。 |
| TIS 已选课程 | `app.teaching_information_system.provider.use_cases.selected_courses.fetch_selected_courses_with_credentials` | 可调用但不是正式入口 | 可选持久化。 |

### 1.3 当前还未完成的服务入口

| 形态 | 当前状态 | 说明 |
| --- | --- | --- |
| 面向前端的复杂业务 HTTP API 服务 | 未完成正式收敛 | 当前阶段只补齐桌面运行时最小契约，不暴露 Blackboard / TIS 复杂业务 API。 |

## 2. CLI 命令参考

> 以下命令都应在 `backend/` 目录下执行。

### 2.1 课程目录搜索 CLI

```bash
python -m app.blackboard.provider.cli.search_course_catalog --help
python -m app.blackboard.provider.cli.search_course_catalog --keyword 计算机 --preview 5
python -m app.blackboard.provider.cli.search_course_catalog --keyword 数据库 --limit 20 --save-json
```

#### 主要参数

| 参数 | 是否必需 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `--keyword` | 必需 | 无 | 搜索关键词。 |
| `--field` | 可选 | `CourseName` | 搜索字段。 |
| `--operator` | 可选 | `Contains` | 搜索操作符。 |
| `--limit` | 可选 | `0` | `<=0` 代表不限制返回条数。 |
| `--preview` | 可选 | `10` | 终端预览条数。 |
| `--save-json` | 可选 | 关闭 | 将结果写入 `data/reports/`。 |

#### 运行前提

- 需要 `SUSTECH_USERNAME`
- 需要 `SUSTECH_PASSWORD`

#### 主要输出

- 终端日志
- 结果预览
- 可选 JSON 报告：`data/reports/course_catalog_search_时间戳.json`

### 2.2 ICS 同步 CLI

```bash
python -m app.blackboard.provider.cli.sync_calendar_ics --help
python -m app.blackboard.provider.cli.sync_calendar_ics --save-json
python -m app.blackboard.provider.cli.sync_calendar_ics --feed-url https://example.com/calendar.ics --db-path data/custom.db --save-json
```

#### 主要参数

| 参数 | 是否必需 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `--feed-url` | 可选 | 无 | 未传入时按环境变量优先级读取。 |
| `--db-path` | 可选 | 无 | 未传入时读取环境变量，再退回默认路径。 |
| `--save-json` | 可选 | 关闭 | 将同步统计与事件快照写入 `data/reports/`。 |

#### feed URL 解析优先级

1. `--feed-url`
2. `BLACKBOARD_CALENDAR_FEED_URL`
3. `CALENDAR_FEED_URL`

#### 数据库路径解析优先级

1. `--db-path`
2. `SUSTECH_DB_PATH`
3. 默认值 `data/sustech.db`

#### 主要输出

- 终端日志
- 同步统计
- 可选 JSON 报告：`data/reports/calendar_ics_sync_时间戳.json`

### 2.3 Desktop runtime 本地 HTTP 入口

```bash
uv run python -m app.desktop_runtime --host 127.0.0.1 --port 8765
```

#### 主要参数

| 参数 | 是否必需 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `--host` | 可选 | `127.0.0.1` | 仅允许 loopback 地址，例如 `127.0.0.1`、`localhost`、`::1`。 |
| `--port` | 可选 | `8765` | 本地监听端口。 |
| `--local-token` | 可选 | 无 | 若提供，则 diagnostics 端点要求 `X-Local-Token`。 |
| `--user-data-dir` | 可选 | `data` | Electron `userData` 根目录。 |
| `--runtime-root-dir` | 可选 | `data/desktop-runtime` | 桌面运行时根目录。 |
| `--config-dir` | 可选 | `data/desktop-runtime/config` | 桌面运行时配置目录。 |
| `--logs-dir` | 可选 | `data/desktop-runtime/logs` | 运行时日志目录。 |
| `--database-dir` | 可选 | `data/desktop-runtime/database` | 运行时数据库目录。 |
| `--state-dir` | 可选 | `data/desktop-runtime/state` | 运行态快照与失败摘要目录。 |
| `--settings-file` | 可选 | `data/desktop-runtime/config/copilot-settings.json` | Copilot 设置文件路径。 |
| `--host-log-file` | 可选 | `data/desktop-runtime/logs/electron-host.log` | Electron 主进程日志文件路径。 |
| `--backend-stdout-log-file` | 可选 | `data/desktop-runtime/logs/backend.stdout.log` | Python 子进程 stdout 日志文件路径。 |
| `--backend-stderr-log-file` | 可选 | `data/desktop-runtime/logs/backend.stderr.log` | Python 子进程 stderr 日志文件路径。 |
| `--runtime-snapshot-file` | 可选 | `data/desktop-runtime/state/runtime-snapshot.json` | 运行态快照文件路径。 |
| `--last-failure-file` | 可选 | `data/desktop-runtime/state/last-failure.json` | 最近失败摘要文件路径。 |
| `--app-mode` | 可选 | `desktop` | 应用模式。 |
| `--environment` | 可选 | `development` | 运行环境。 |

#### 最小契约端点

- `GET /health`
- `GET /ready`
- `GET /version`
- `GET /build-info`
- `GET /diagnostics`
- `GET /diagnostics/runtime-info`

#### 主要输出

- health / ready 状态
- 版本与入口信息
- 不包含敏感值的运行目录与配置摘要

## 3. 当前已确认环境变量

### 3.1 `.env.example` 中明确给出的变量

| 变量名 | 用途 | 当前适用范围 | 是否建议优先配置 |
| --- | --- | --- | --- |
| `SUSTECH_USERNAME` | 统一登录用户名 | Blackboard CLI、TIS 调用、live 测试 | 是 |
| `SUSTECH_PASSWORD` | 统一登录密码 | Blackboard CLI、TIS 调用、live 测试 | 是 |
| `BLACKBOARD_CALENDAR_FEED_URL` | Blackboard ICS 订阅地址 | ICS CLI | 跑 ICS 时是 |
| `SUSTECH_DB_PATH` | SQLite 数据库路径 | Blackboard / TIS 持久化相关能力 | 视需要 |

### 3.2 Desktop runtime 运行时变量

| 变量名 | 用途 | 当前适用范围 | 说明 |
| --- | --- | --- | --- |
| `COPILOT_DESKTOP_RUNTIME_HOST` | loopback 监听地址 | Desktop runtime | 仅允许 `127.0.0.1`、`localhost`、`::1`。 |
| `COPILOT_DESKTOP_RUNTIME_PORT` | 本地监听端口 | Desktop runtime | 默认 `8765`。 |
| `COPILOT_DESKTOP_RUNTIME_LOCAL_TOKEN` | 本地调用令牌 | Desktop runtime | 当前可选；配置后保护 diagnostics 端点。 |
| `COPILOT_DESKTOP_RUNTIME_USER_DATA_DIR` | 用户数据根目录 | Desktop runtime | 默认 `data`。 |
| `COPILOT_DESKTOP_RUNTIME_ROOT_DIR` | 桌面运行时根目录 | Desktop runtime | 默认 `data/desktop-runtime`。 |
| `COPILOT_DESKTOP_RUNTIME_CONFIG_DIR` | 配置目录 | Desktop runtime | 默认 `data/desktop-runtime/config`。 |
| `COPILOT_DESKTOP_RUNTIME_LOGS_DIR` | 日志目录 | Desktop runtime | 默认 `data/desktop-runtime/logs`。 |
| `COPILOT_DESKTOP_RUNTIME_DATABASE_DIR` | 数据库目录 | Desktop runtime | 默认 `data/desktop-runtime/database`。 |
| `COPILOT_DESKTOP_RUNTIME_STATE_DIR` | 运行态目录 | Desktop runtime | 默认 `data/desktop-runtime/state`。 |
| `COPILOT_DESKTOP_RUNTIME_SETTINGS_FILE` | Copilot 设置文件 | Desktop runtime | 默认 `data/desktop-runtime/config/copilot-settings.json`。 |
| `COPILOT_DESKTOP_RUNTIME_HOST_LOG_FILE` | Electron 主进程日志文件 | Desktop runtime | 默认 `data/desktop-runtime/logs/electron-host.log`。 |
| `COPILOT_DESKTOP_RUNTIME_BACKEND_STDOUT_LOG_FILE` | Python stdout 日志文件 | Desktop runtime | 默认 `data/desktop-runtime/logs/backend.stdout.log`。 |
| `COPILOT_DESKTOP_RUNTIME_BACKEND_STDERR_LOG_FILE` | Python stderr 日志文件 | Desktop runtime | 默认 `data/desktop-runtime/logs/backend.stderr.log`。 |
| `COPILOT_DESKTOP_RUNTIME_SNAPSHOT_FILE` | 运行态快照文件 | Desktop runtime | 默认 `data/desktop-runtime/state/runtime-snapshot.json`。 |
| `COPILOT_DESKTOP_RUNTIME_LAST_FAILURE_FILE` | 最近失败摘要文件 | Desktop runtime | 默认 `data/desktop-runtime/state/last-failure.json`。 |
| `COPILOT_DESKTOP_RUNTIME_APP_MODE` | 应用模式 | Desktop runtime | 默认 `desktop`。 |
| `COPILOT_DESKTOP_RUNTIME_ENVIRONMENT` | 运行环境 | Desktop runtime | 默认 `development`。 |

### 3.3 代码中额外兼容读取的变量

| 变量名 | 出现位置 | 当前含义 | 说明 |
| --- | --- | --- | --- |
| `CALENDAR_FEED_URL` | ICS CLI | Blackboard ICS 订阅地址兼容键 | 可用，但主文档仍以 `BLACKBOARD_CALENDAR_FEED_URL` 为主。 |
| `TIS_ROLE_CODE` | TIS 诊断 from env | TIS 角色代码 | 不在 `.env.example` 基础展示里。 |
| `ROLE_CODE` | TIS 诊断 from env | TIS 角色代码兼容键 | 不在 `.env.example` 基础展示里。 |

## 4. 默认路径与落盘位置

| 路径 | 当前用途 | 说明 |
| --- | --- | --- |
| `backend/.env` | 本地运行配置 | CLI 和测试会读取。 |
| `backend/data/sustech.db` | 默认 SQLite 路径 | 当 `SUSTECH_DB_PATH` 未提供时使用。 |
| `backend/data/reports/` | CLI JSON 报告目录 | 课程目录搜索和 ICS 同步会创建并写入。 |
| `backend/data/` | Desktop runtime userData 根目录回退值 | 未显式指定 `user data dir` 时使用。 |
| `backend/data/desktop-runtime/` | Desktop runtime 根目录 | 未显式指定 `runtime root dir` 时使用。 |
| `backend/data/desktop-runtime/config/` | Desktop runtime 配置目录 | 默认保存 `copilot-settings.json`。 |
| `backend/data/desktop-runtime/logs/` | Desktop runtime 日志目录 | 默认保存 `electron-host.log`、`backend.stdout.log`、`backend.stderr.log`。 |
| `backend/data/desktop-runtime/database/` | Desktop runtime 数据目录 | 未显式指定 `database dir` 时使用。 |
| `backend/data/desktop-runtime/state/` | Desktop runtime 状态目录 | 默认保存 `runtime-snapshot.json` 和 `last-failure.json`。 |
| `backend/tests/` | 测试目录 | 已按 unit / integration / e2e 分层。 |

## 5. 测试分层现状

| 目录 | 当前状态 | 说明 |
| --- | --- | --- |
| `tests/unit/` | 已实现 | 覆盖解析、DTO、provider、data 同步等本地逻辑。 |
| `tests/integration/` | 已实现 | 多个测试带 `live` 标记，依赖真实凭据和网络。 |
| `tests/e2e/` | 已实现 | 当前包含 Blackboard snapshot sync 的整链路验证；同样依赖 `live`。 |

### pytest 标记

`pyproject.toml` 中已确认的标记：

| 标记 | 含义 |
| --- | --- |
| `live` | 需要真实 Blackboard/TIS 凭据和网络环境。 |
| `e2e` | 用于 Blackboard snapshot sync 的端到端验证。 |

### 常见测试命令

```bash
pytest
pytest -m "not live"
pytest -m live
pytest tests/unit
uv run pytest tests/unit/desktop_runtime -q
```

## 6. 当前配置与运行边界的简写结论

- Blackboard CLI：**已实现，可直接运行。**
- Desktop runtime 本地 HTTP 入口：**已实现，但只覆盖最小桌面宿主契约。**
- Blackboard 工具层与 snapshot use case：**可调用，但不是正式入口。**
- TIS provider use case：**可调用，但不是正式入口。**
- 复杂业务 Web API：**当前仍不能写成已实现。**

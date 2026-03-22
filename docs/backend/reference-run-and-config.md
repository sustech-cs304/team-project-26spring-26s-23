# 运行与配置参考

> 这份附录服务于 [运行与配置](./run-and-config.md)。它只整理当前已经确认的命令、配置项、默认路径和测试分层事实，不替代正文解释。

## 1. 当前已确认的运行入口

### 1.1 已实现的 CLI 入口

| 入口 | 位置 | 当前状态 | 说明 |
| --- | --- | --- | --- |
| Blackboard 课程目录搜索 CLI | `app.blackboard.provider.cli.search_course_catalog` | 已实现 | 需要凭据；可终端预览；可保存 JSON 报告。 |
| Blackboard ICS 同步 CLI | `app.blackboard.provider.cli.sync_calendar_ics` | 已实现 | 需要 feed URL；可写 SQLite；可保存 JSON 报告。 |

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

### 1.3 当前未确认的入口

| 形态 | 当前状态 | 说明 |
| --- | --- | --- |
| FastAPI 应用启动入口 | 未确认存在 | 代码中未检索到可直接启动的 `FastAPI(...)` / 路由注册 / `uvicorn.run(...)` 入口。 |
| 面向前端的 HTTP API 服务 | 未实现为当前正式入口 | 不能因为依赖表出现 `fastapi`、`uvicorn` 就写成已有服务。 |

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

## 3. 当前已确认环境变量

### 3.1 `.env.example` 中明确给出的变量

| 变量名 | 用途 | 当前适用范围 | 是否建议优先配置 |
| --- | --- | --- | --- |
| `SUSTECH_USERNAME` | 统一登录用户名 | Blackboard CLI、TIS 调用、live 测试 | 是 |
| `SUSTECH_PASSWORD` | 统一登录密码 | Blackboard CLI、TIS 调用、live 测试 | 是 |
| `BLACKBOARD_CALENDAR_FEED_URL` | Blackboard ICS 订阅地址 | ICS CLI | 跑 ICS 时是 |
| `SUSTECH_DB_PATH` | SQLite 数据库路径 | Blackboard / TIS 持久化相关能力 | 视需要 |

### 3.2 代码中额外兼容读取的变量

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
```

## 6. 当前配置与运行边界的简写结论

- Blackboard CLI：**已实现，可直接运行。**
- Blackboard 工具层与 snapshot use case：**可调用，但不是正式入口。**
- TIS provider use case：**可调用，但不是正式入口。**
- Web API 服务启动：**当前不能写成已实现。**

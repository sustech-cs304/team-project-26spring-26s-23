# backend

这个目录当前更接近 **Python 能力库 + CLI + 数据同步/持久化层**，而不是一个已经成型、可以直接对外提供 HTTP 接口的 Web 服务。

如果你是第一次接手这个后端，先记住下面这句话：**现在最清楚、最容易跑起来的入口是 Blackboard 相关 CLI；TIS 目前更多停留在 provider 可调用层。**

## 先看结论

### 已实现

- Blackboard 课程目录搜索 CLI，可以用账号密码登录后搜索课程，并可选择保存 JSON 报告。
- Blackboard 日历 ICS 同步 CLI，可以把订阅地址中的事件刷新到本地 SQLite，并可选择保存 JSON 报告。
- Blackboard 的抓取、同步、落库流程已经形成一条比较完整的能力链，包含 provider、data 和测试覆盖。
- 测试目录已经按 unit / integration / e2e 分层；其中 live 类测试依赖真实凭据和网络环境。

### 代码里可调用，但不是正式入口

- Blackboard 的工具层函数可以直接在 Python 里调用，返回字典结果。
- Blackboard snapshot 同步能力可以在 provider use case 中直接调用，并会给出同步统计、表计数和完整性检查结果。
- TIS 已有诊断、个人成绩、学分绩、已选课程等 provider use case；这些能力可以在 Python 内调用，部分还能选择持久化到数据库。

### 现在不要默认它已经有的东西

- 不要因为依赖里出现 FastAPI / uvicorn，就把它理解成“已经有现成 Web API 服务”。当前仓库里看不到可直接启动的 HTTP 服务入口。
- 不要把 `app/blackboard/api/` 或 `app/teaching_information_system/api/` 直接理解成“给前端调用的 HTTP API 层”。这里的 `api` 更像是对上游系统的抓取、请求、解析代码。
- 不要把 `app/services/` 目录名直接理解成“已经完成的服务层编排”。目前这里只是一个占位 package。
- 不要把 Blackboard 和 TIS 写成同样成熟。**Blackboard 的运行面更明确，TIS 目前主要是 provider 可调用层。**

## 这个后端现在是什么

从代码组织看，这个后端主要解决的是三件事：

1. 登录上游系统并抓取数据；
2. 把抓到的数据整理成较稳定的 Python 结果对象；
3. 在需要时把结果同步到本地 SQLite，或导出成 JSON 报告。

因此，当前更贴近“后端能力底座”，而不是“已经封装好的服务端产品”。

对外最容易观察到的契约，也还不是 HTTP 响应，而是：

- CLI 运行后的终端输出；
- CLI 生成的 JSON 报告；
- 工具函数返回的字典结果。

## 现在能跑什么

### 1. Blackboard 课程目录搜索 CLI

进入 `backend/` 后，可以运行：

```bash
python -m app.blackboard.provider.cli.search_course_catalog --keyword 计算机 --preview 5
```

这个命令会：

- 读取 `SUSTECH_USERNAME` 和 `SUSTECH_PASSWORD`；
- 登录 Blackboard；
- 按关键词搜索课程目录；
- 在终端输出预览；
- 如果加上 `--save-json`，会把完整结果写到 `backend/data/reports/`。

### 2. Blackboard 日历 ICS 同步 CLI

进入 `backend/` 后，可以运行：

```bash
python -m app.blackboard.provider.cli.sync_calendar_ics --save-json
```

这个命令会：

- 读取 `BLACKBOARD_CALENDAR_FEED_URL`（也兼容 `CALENDAR_FEED_URL`）；
- 使用 `SUSTECH_DB_PATH` 或默认数据库路径；
- 刷新 ICS 订阅并同步到本地 SQLite；
- 如果加上 `--save-json`，把同步统计和事件快照写到 `backend/data/reports/`。

### 3. Blackboard 的可调用工具层

如果你不是先跑 CLI，而是想在 Python 里直接拿结果，当前可调用的入口主要在 Blackboard provider 工具层。它们返回的是字典，不是 HTTP 响应。

适合这样理解：

- `search_course_catalog(...)`：返回课程目录搜索结果；
- `refresh_calendar_ics(...)`：返回 ICS 同步结果；
- `sync_blackboard_snapshot(...)`：返回 snapshot 抓取、落库和完整性检查结果。

这类入口已经能调用，但**还不应被写成正式对外接口**。

### 4. TIS provider 可调用能力

TIS 目前已有几条可调用 use case，包括：

- 链路诊断；
- 个人成绩；
- 学分绩；
- 已选课程。

这些能力说明 TIS 侧并不是空的，但它当前更像“代码里已经能抓、能解析、部分能持久化”，而不是已经形成明确运行入口的产品面。现在没有像 Blackboard CLI 那样清楚的正式命令入口。

## 最快上手方式

### 1. 准备 Python 和依赖

项目要求 Python `>=3.12`。建议使用 `uv` 管理依赖。

进入 `backend/` 后执行：

```bash
uv sync
```

### 2. 准备环境变量

把 `.env.example` 复制成 `.env`，至少补全下面几项：

- `SUSTECH_USERNAME`
- `SUSTECH_PASSWORD`
- `BLACKBOARD_CALENDAR_FEED_URL`（如果要跑 ICS 同步）
- `SUSTECH_DB_PATH`（如果你想改默认数据库位置）

默认数据库路径是：

```text
data/sustech.db
```

### 3. 先跑 Blackboard CLI，不要先找“服务启动命令”

如果你的目标是先确认“现在到底有没有可运行面”，优先跑前面两个 Blackboard CLI。它们比去猜测某个 HTTP 服务入口要可靠得多。

## 测试怎么理解

测试目录已经分层：

- `tests/unit/`：偏本地、偏离线的单元测试；
- `tests/integration/`：带 `live` 标记，依赖真实凭据和网络；
- `tests/e2e/`：目前也依赖 `live`，用于更完整的 Blackboard snapshot 同步验证。

常见运行方式：

```bash
pytest
pytest -m "not live"
pytest -m live
```

如果本地没有真实凭据，live 测试会因为缺少环境变量而跳过或不适合执行。

## 接下来该看哪里

仓库级后端文档统一放在 `docs/backend/`，不以 `backend/docs/` 作为正式入口。

建议按下面顺序继续阅读：

1. [`docs/backend/README.md`](../docs/backend/README.md)：后端文档导航。
2. [`docs/backend/module-layout.md`](../docs/backend/module-layout.md)：理解目录和分层到底代表什么。
3. [`docs/backend/run-and-config.md`](../docs/backend/run-and-config.md)：理解现在怎么跑、配置怎么影响运行。
4. [`docs/backend/roadmap-and-boundaries.md`](../docs/backend/roadmap-and-boundaries.md)：避免把“已实现 / 可调用但不是正式入口 / 未来草案”混在一起。
5. [`docs/backend/reference-current-contracts.md`](../docs/backend/reference-current-contracts.md)：查看当前真正可观察到的输出契约。

## 一句话总结

现在的 `backend/` 适合被理解为：**已经有一部分真实可运行能力，尤其是 Blackboard CLI 与同步/落库链路；但它还不是一个已经完成服务化封装的 Web API 后端。**

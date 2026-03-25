# 运行与配置

这篇文档回答的是最实际的问题：**现在这个后端到底怎么跑，运行会依赖哪些配置，哪些路径是今天就能用的，哪些还不适合当成正式入口。**

先说结论：当前除了 Blackboard CLI 之外，已经补齐了一个供桌面宿主使用的最小本地 HTTP 服务入口；但它只覆盖 health / ready / version / diagnostics 等基础契约，并不等于完整业务 Web API 已成型。如果你要验证业务抓取链路，仍然优先跑 Blackboard CLI；如果你要验证后续 Electron 可托管的运行时边界，再运行 desktop runtime 入口。

## 当前最值得优先理解的运行面

### 已实现

当前已经有两类可运行入口：

- Blackboard 课程目录搜索 CLI；
- Blackboard 日历 ICS 同步 CLI；
- 桌面宿主本地 HTTP 最小入口。

前两者更适合验证现有业务抓取 / 同步链路；第三者更适合验证 Electron 后续需要托管的 loopback HTTP 运行时边界。

### 代码里可调用，但不是正式入口

除了 CLI 之外，当前还有一批 Python 内部可调用能力：

- Blackboard 工具层函数，返回字典；
- Blackboard snapshot 抓取与同步 use case；
- TIS 诊断、个人成绩、学分绩、已选课程 use case。

这些能力对开发很重要，但今天不宜写成“用户只要启动一个服务就能调用”的形态。

### 当前不要误认为已经存在的运行方式

- 现在已经有可直接运行的 FastAPI 应用入口，但它是**桌面宿主使用的最小 loopback 服务**，不是完整业务 API 面；
- 仍然没有确认到已经面向前端开放的复杂业务 HTTP API 服务；
- 也不应把 `app/blackboard/api/`、`app/teaching_information_system/api/` 直接理解为给前端调用的 HTTP 路由层。

依赖表里出现 `fastapi`、`uvicorn`，曾经只能说明相关包被加入过依赖；而现在真正落地的，也只是最小桌面运行时入口，而不是全面服务化改造。

## 环境准备

### Python 版本

`pyproject.toml` 要求 Python `>=3.12`。如果版本不对，后续依赖安装和类型特性都可能出问题。

### 依赖安装

建议在 `backend/` 目录下使用 `uv`：

```bash
uv sync
```

这一步会按 `pyproject.toml` 和锁文件准备依赖环境。当前依赖里可以看到抓取、解析、环境变量、数据库、测试，以及一些未来可能用于服务化或集成的包。

但需要再次强调：**依赖里有某个框架，不等于仓库里已经形成对应运行入口。**

## 环境变量怎么理解

当前 `.env.example` 至少给出了三类直接相关配置：

### 1. 统一认证凭据

- `SUSTECH_USERNAME`
- `SUSTECH_PASSWORD`

这两个值既会影响 Blackboard CLI，也会影响 TIS 相关 live 测试和 provider 调用。没有它们，很多真实链路都无法建立。

### 2. Blackboard ICS 订阅地址

- `BLACKBOARD_CALENDAR_FEED_URL`

Blackboard ICS CLI 会优先读这个值；代码里还兼容 `CALENDAR_FEED_URL`，但 `.env.example` 中明确展示的是 Blackboard 专用命名。文档里可以把兼容键写进参考页，但主文应优先讲清当前推荐配置名。

### 3. 本地 SQLite 路径

- `SUSTECH_DB_PATH`

这个值决定本地数据库落盘路径。若未显式提供，Blackboard ICS CLI 会退回默认路径 `backend/data/sustech.db` 对应的项目内位置。

### 4. 桌面宿主本地运行时变量（阶段 1）

下面这组变量通常由后续的 Electron 主进程注入，而不是要求终端用户长期手工维护：

- `COPILOT_DESKTOP_RUNTIME_HOST`
- `COPILOT_DESKTOP_RUNTIME_PORT`
- `COPILOT_DESKTOP_RUNTIME_LOCAL_TOKEN`
- `COPILOT_DESKTOP_RUNTIME_USER_DATA_DIR`
- `COPILOT_DESKTOP_RUNTIME_LOGS_DIR`
- `COPILOT_DESKTOP_RUNTIME_DATABASE_DIR`
- `COPILOT_DESKTOP_RUNTIME_APP_MODE`
- `COPILOT_DESKTOP_RUNTIME_ENVIRONMENT`

其中 `host` 只允许 loopback 地址，例如 `127.0.0.1`、`localhost`、`::1`；`local token` 当前可以不传，但接口边界已经预留好，配置后会保护 diagnostics 端点。

## 推荐的 `.env` 准备方式

先把 `.env.example` 复制成 `.env`，再按用途补值。

### 只想跑 Blackboard 课程目录搜索

至少需要：

- `SUSTECH_USERNAME`
- `SUSTECH_PASSWORD`

### 想跑 Blackboard ICS 同步

至少需要：

- `BLACKBOARD_CALENDAR_FEED_URL`

如果同时需要写本地数据库，还建议确认：

- `SUSTECH_DB_PATH`

### 想做 live 测试或 TIS provider 调用

至少需要：

- `SUSTECH_USERNAME`
- `SUSTECH_PASSWORD`

有些 TIS 场景还会读取 role code 相关值，但它不在当前 `.env.example` 的基础展示里，因此更适合放在参考页说明，而不在入口文里写成“每个人都必须先配”。

## 今天就能直接跑的命令

### Blackboard 课程目录搜索 CLI

在 `backend/` 下运行：

```bash
python -m app.blackboard.provider.cli.search_course_catalog --keyword 计算机 --preview 5
```

这个命令会做几件事：

- 加载 `backend/.env`；
- 检查账号密码是否存在；
- 调用 Blackboard 课程目录搜索 use case；
- 在终端打印结果预览；
- 如果加 `--save-json`，在 `backend/data/reports/` 下生成报告文件。

这条 CLI 的输出重点不是“服务返回码”，而是：

- 终端日志；
- 预览结果；
- 可选 JSON 报告。

### Blackboard ICS 同步 CLI

在 `backend/` 下运行：

```bash
python -m app.blackboard.provider.cli.sync_calendar_ics --save-json
```

它会：

- 从命令行参数或环境变量解析 feed URL；
- 解析数据库路径；
- 调用 ICS 刷新 use case；
- 输出同步统计；
- 可选保存 JSON 报告。

如果 feed URL 没提供，它会明确报错并提示应该配置哪些环境变量。这说明它已经是一个对使用者比较友好的真实入口。

### Desktop runtime 本地 HTTP 最小入口

在 `backend/` 下运行：

```bash
uv run python -m app.desktop_runtime --host 127.0.0.1 --port 8765
```

它会：

- 构造一个仅监听 loopback 地址的 FastAPI 应用；
- 解析 `host`、`port`、`local token`、`user data dir`、`logs dir`、`database dir`、`app mode`、`environment`；
- 暴露 `/health`、`/ready`、`/version`、`/build-info`、`/diagnostics`、`/diagnostics/runtime-info`；
- 在根路径 `/` 挂载最小 Copilot runtime single-endpoint 接口，支持 `info`、`agent/connect`、`agent/run`；
- 在配置 `local token` 时，仅对 diagnostics 端点要求 `X-Local-Token` 请求头；
- 对来自 loopback 开发源的聊天请求提供最小 CORS 支持，供 Electron / Vite 开发态联调使用；
- 在启动时准备运行时目录，但此阶段仍只覆盖**最小聊天 MVP**，不是完整业务接口面。

如果你只是想验证入口最小契约，优先访问 `/health`、`/ready` 与 `/version`；如果要看目录与配置摘要，再访问 diagnostics 端点。若要验证最小聊天链路，还需要额外满足：

- 设置 `COPILOT_RUNTIME_MODEL` 或 `COPILOT_MODEL`；开发态纯协议联调可先用 `test`。
- 前端传入的 agent 名称需要与当前单 agent 默认值 `default` 一致。

## Python 内部可调用的运行路径

除了 CLI，当前还存在几条“更像能力接口”的调用路径。

### Blackboard 工具层

`provider/tools/agent_tools.py` 中的几个函数会把 use case 结果整理成字典：

- 课程目录搜索结果字典；
- ICS 同步结果字典；
- snapshot 同步结果字典。

从测试看，这些返回结构已经被当成“稳定形状”在校验，因此它们是当前很重要的可观察输出。

但要注意文档口径：**这是 Python 工具层，不是 HTTP API。**

### Blackboard snapshot 同步

`snapshot_sync` use case 能完成较完整的一条链：

1. 登录 Blackboard；
2. 抓课程列表；
3. 逐课抓作业、成绩；
4. 按策略抓部分课程资源；
5. 抓公告；
6. 构建同步 payload；
7. 同步数据库；
8. 计算表计数与预期活跃数；
9. 可选执行第二次同步校验。

这说明它已经不只是“抓点数据”，而是很接近一个完整任务流程。但它当前仍属于 provider use case，不是外部正式入口。

### TIS provider use cases

TIS 当前有几条核心调用路径：

- 链路诊断；
- 个人成绩抓取；
- 学分绩抓取；
- 已选课程抓取。

这些 use case 往往会：

- 建立 TIS/CAS 会话；
- 访问首页或具体接口；
- 分析页面和候选接口；
- 生成结构化结果；
- 在需要时写入本地数据库。

它们对后续开发非常有价值，但目前缺的是对第一次接手者一眼就能跑起来的统一入口。因此现在更适合把它们写成“开发可调用能力”。

## 本地数据与输出会落到哪里

### SQLite 数据库

当前本地持久化默认围绕 SQLite 展开。数据库路径由 `SUSTECH_DB_PATH` 或默认值决定。

这意味着当前后端不只是“请求时抓一下”，而是已经具备“抓取后同步到本地数据层”的能力。

### JSON 报告

Blackboard 两个 CLI 都支持把结果写到 `backend/data/reports/`：

- 课程目录搜索会生成搜索结果 JSON；
- ICS 同步会生成统计与事件快照 JSON。

这类 JSON 报告非常重要，因为它们构成了当前最容易被其他角色观察和复用的输出之一。

## 测试怎么跑，测试结果代表什么

当前 `tests/` 已按类型分层：

### `tests/unit/`

主要是偏本地、偏离线的验证，覆盖解析、DTO、provider、data 同步等逻辑。对第一次接手者来说，这一层最适合快速确认“核心代码形状是不是还正常”。阶段 1 新增的 `tests/unit/desktop_runtime/` 也属于这一层，用来覆盖配置解析与最小 HTTP 契约。

### `tests/integration/`

这里已经有多组 `live` 标记测试，会依赖：

- 真实凭据；
- 网络；
- 上游系统可访问。

因此它们更适合用来验证真实链路，而不是每次都在本地无条件执行。

### `tests/e2e/`

当前也有 Blackboard snapshot sync 的 e2e 测试，同样依赖 `live`。这说明仓库已经开始把“抓取 + 同步 + 校验”当成整链路能力来验证。

## 建议的实际使用顺序

如果你今天接手这个后端，建议这样走：

1. 在 `backend/` 下执行 `uv sync`；
2. 准备 `.env`；
3. 先跑 Blackboard 课程目录搜索 CLI；
4. 再跑 Blackboard ICS 同步 CLI；
5. 如果你的目标是验证桌面宿主运行时边界，再运行 `uv run python -m app.desktop_runtime --host 127.0.0.1 --port 8765`；
6. 如需理解数据层，再看 snapshot use case；
7. 如需扩展 TIS，再进入对应 provider use case。

这个顺序的好处是，你会先建立对“已实现运行面”的真实认知，而不是直接掉进一堆目录名和未来设想里。

## 和参考页的关系

这篇文档主要负责解释“为什么现在应该这样运行和理解配置”。如果你需要更快查命令、环境变量和测试分层事实，可以继续看 [运行与配置参考](./reference-run-and-config.md)。

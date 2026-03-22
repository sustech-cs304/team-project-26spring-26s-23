# 运行与配置

这篇文档回答的是最实际的问题：**现在这个后端到底怎么跑，运行会依赖哪些配置，哪些路径是今天就能用的，哪些还不适合当成正式入口。**

先说结论：如果你今天只想验证“这个后端有没有真实可运行面”，优先跑 Blackboard CLI，而不是先去找某个“服务启动命令”。当前仓库里没有明确可启动的 HTTP 服务入口，最清楚的运行方式仍然是命令行和 Python 内部调用。

## 当前最值得优先理解的运行面

### 已实现

当前最明确、最适合作为日常验证入口的，是两个 Blackboard CLI：

- 课程目录搜索；
- 日历 ICS 同步。

它们已经具备比较完整的运行要素：命令行参数、`.env` 读取、日志输出、可选 JSON 报告、与 provider use case 的连接。

### 代码里可调用，但不是正式入口

除了 CLI 之外，当前还有一批 Python 内部可调用能力：

- Blackboard 工具层函数，返回字典；
- Blackboard snapshot 抓取与同步 use case；
- TIS 诊断、个人成绩、学分绩、已选课程 use case。

这些能力对开发很重要，但今天不宜写成“用户只要启动一个服务就能调用”的形态。

### 当前不要误认为已经存在的运行方式

- 没有确认到可直接运行的 FastAPI 应用入口；
- 没有确认到 `uvicorn` 启动脚本；
- 没有确认到已经面向前端开放的 HTTP API 服务。

依赖表里出现 `fastapi`、`uvicorn`，只能说明相关包被加入过依赖，不能代表服务化入口已经落地。

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

主要是偏本地、偏离线的验证，覆盖解析、DTO、provider、data 同步等逻辑。对第一次接手者来说，这一层最适合快速确认“核心代码形状是不是还正常”。

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
5. 如需理解数据层，再看 snapshot use case；
6. 如需扩展 TIS，再进入对应 provider use case。

这个顺序的好处是，你会先建立对“已实现运行面”的真实认知，而不是直接掉进一堆目录名和未来设想里。

## 和参考页的关系

这篇文档主要负责解释“为什么现在应该这样运行和理解配置”。如果你需要更快查命令、环境变量和测试分层事实，可以继续看 [运行与配置参考](./reference-run-and-config.md)。

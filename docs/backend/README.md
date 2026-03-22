# 后端文档

这组文档不是为了把当前 `backend/` 包装成一个比现实更完整的系统，而是为了让第一次接手的人先看清楚三件事：**它现在是什么、现在能跑什么、现在还不能当成什么**。

当前后端更适合被理解为：**Python 能力库 + CLI + 数据同步/持久化层**。其中 Blackboard 方向已经有较明确的运行面；TIS 方向目前更多停留在 provider 可调用层。仓库里虽然出现了 `api`、`services`、`fastapi` 等名字，但它们不能直接等同于“已经存在面向前端的 HTTP 服务”。

## 建议阅读顺序

如果你是第一次接手，建议按下面顺序读：

1. [`backend/README.md`](../../backend/README.md)：先建立整体判断，避免一上来就把这个目录误认成成熟 Web 服务。
2. [模块布局](./module-layout.md)：看清 Blackboard、TIS、provider、data、shared 这些目录到底各自负责什么。
3. [运行与配置](./run-and-config.md)：确认现在应该怎么跑、哪些环境变量真的会影响运行。
4. [边界与路线图](./roadmap-and-boundaries.md)：明确区分“已实现 / 代码里可调用但不是正式入口 / 未来草案”。
5. [前后端连接现状说明](./frontend-connection.md)：只在需要和前端对齐预期时再看，不要把它当成现成接口文档。

## 文档分层

这套文档分成两层：**说明型专题** 和 **结构化附录**。

说明型专题负责回答“现在应该怎么理解这个后端”，重点是解释背景、边界和阅读方式：

- [模块布局](./module-layout.md)
- [运行与配置](./run-and-config.md)
- [边界与路线图](./roadmap-and-boundaries.md)
- [前后端连接现状说明](./frontend-connection.md)

结构化附录负责把已经确认的命令、配置项、输出契约和未来草案整理成便于查阅的参考页：

- [运行与配置参考](./reference-run-and-config.md)
- [当前可观察契约参考](./reference-current-contracts.md)
- [未来 API 草案参考](./reference-future-api-draft.md)

## 读这些文档时，先带着这三个判断

### 1. 已实现

当前已经比较明确的，是 Blackboard 方向的 CLI、provider、同步与本地持久化链路，以及对应的测试分层。

### 2. 代码里可调用，但不是正式入口

Blackboard 的工具函数、snapshot use case，以及 TIS 的诊断/成绩/学分绩/已选课程 use case，都属于这类内容。它们已经能在 Python 里调用，但还没有形成统一、稳定、面向外部使用者的正式运行入口。

### 3. 未来草案

凡是涉及“未来怎样接前端”“未来可能怎样包装成 HTTP API”的内容，都只作为草案保留。它们服务于协作讨论，不代表当前实现承诺。

## 这组文档刻意避免的误解

阅读过程中如果遇到下面这些名字，请特别注意不要望文生义：

- `app/blackboard/api/` 和 `app/teaching_information_system/api/`：这里更接近“访问上游系统并解析结果”的代码，不是给前端直接调用的现成 HTTP API。
- `app/services/`：当前只是占位 package，不表示已经形成服务层编排。
- `fastapi` / `uvicorn` 依赖：只能说明依赖表里出现过相关包，不能反推出仓库里已经有可启动的 Web 服务。
- `provider/tools/agent_tools.py` 里的函数：它们当前返回的是字典结果，不是现成 HTTP 接口。

## 文档放置规则

仓库级后端文档统一放在 `docs/backend/`。当前不把 `backend/docs/` 作为正式文档入口，也不把模块目录里的命名直接当成系统成熟度证明。

## 如果你只打算看一篇专题

优先看 [边界与路线图](./roadmap-and-boundaries.md)。它最直接回答“哪些东西已经能依赖，哪些只能当内部能力，哪些还只是草案”。

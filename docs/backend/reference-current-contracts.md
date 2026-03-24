# 当前可观察契约参考

> 这份附录服务于 [前后端连接现状说明](./frontend-connection.md) 和 [边界与路线图](./roadmap-and-boundaries.md)。这里整理的是**当前已经能被外部观察到的输出形态**，包括阶段 1 新增的 desktop runtime 最小 HTTP 契约，但它仍不是完整业务 HTTP API 规范。

## 1. 先说明这份附录在说什么

当前后端可观察到的“契约”主要包括下面几类输出：

1. Desktop runtime 的本地 HTTP 最小契约；
2. Blackboard CLI 生成的 JSON 报告；
3. Blackboard 工具层函数返回的字典；
4. provider use case 返回的结构化结果对象；
5. 数据同步后的统计结果。

因此，这份附录的关键词仍然是：**可观察输出**。其中新增的 HTTP 部分只覆盖桌面宿主控制面，不代表 Blackboard / TIS 复杂业务 API 已经冻结成正式协议。

## 2. 已实现的当前契约形态

### 2.1 Desktop runtime 本地 HTTP 最小契约

来源：`app.desktop_runtime`。

#### 当前已确认的端点

| 端点 | 含义 | 当前稳定度判断 |
| --- | --- | --- |
| `GET /health` | 基础健康检查，返回服务名、状态与 `ready` 布尔值 | 较高 |
| `GET /ready` | readiness 状态，返回 `startup_complete` 与最近错误摘要 | 较高 |
| `GET /version` | 返回版本、Python 版本、app mode、environment 与入口信息 | 较高 |
| `GET /build-info` | 当前与 `/version` 返回同形内容 | 中等偏高 |
| `GET /diagnostics` | 返回运行目录、配置摘要、鉴权摘要与能力摘要 | 中等偏高 |
| `GET /diagnostics/runtime-info` | 当前与 `/diagnostics` 返回同形内容 | 中等偏高 |

#### 当前已确认的边界

- 只监听 loopback 地址；
- diagnostics 响应只返回配置摘要，不直接回显敏感 token；
- 若配置本地 token，只有 diagnostics 端点需要 `X-Local-Token`；
- 当前只提供桌面宿主控制面契约，不暴露 Blackboard / TIS 复杂业务 API。

### 2.2 Blackboard 课程目录搜索 CLI JSON 报告

来源：课程目录搜索 CLI 在开启 `--save-json` 时写入 `backend/data/reports/`。

#### 当前已确认的顶层字段

| 字段 | 类型方向 | 含义 | 稳定度判断 |
| --- | --- | --- | --- |
| `run_at` | 字符串 | 运行时间 | 较高 |
| `keyword` | 字符串 | 搜索关键词 | 较高 |
| `field` | 字符串 | 搜索字段 | 较高 |
| `operator` | 字符串 | 搜索操作符 | 较高 |
| `limit` | 数字或空 | 搜索限制条数 | 较高 |
| `total` | 数字 | 返回结果总数 | 较高 |
| `results` | 数组 | 搜索结果列表 | 较高 |

#### 结果数组的理解方式

`results` 来自 DTO 的 `to_dict()`，因此字段整体已经结构化，但具体子字段仍更适合作为“当前实现输出”理解，而不是长期冻结协议。

更稳妥的说法是：

- 结果对象已经有较清楚的形状；
- 适合当前联调、调试、人工审查参考；
- 若未来对前端正式开放，仍应再做契约收敛。

### 2.3 Blackboard ICS 同步 CLI JSON 报告

来源：ICS CLI 在开启 `--save-json` 时写入 `backend/data/reports/`。

#### 当前已确认的顶层字段

| 字段 | 类型方向 | 含义 | 稳定度判断 |
| --- | --- | --- | --- |
| `run_at` | 字符串 | 运行时间 | 较高 |
| `feed_url` | 字符串 | 实际使用的 ICS 地址 | 较高 |
| `stats` | 对象 | 同步统计信息 | 较高 |
| `events` | 数组 | 当前事件快照 | 中等偏高 |

#### `stats` 的当前已知方向

从 use case 与工具层测试可确认，统计信息至少会围绕下面这些量展开：

- `parsed`
- `inserted`
- `updated`
- `deleted`
- 时间类字段（会被序列化为 ISO 字符串）

其中“有多少条被解析、插入、更新、删除”属于当前比较值得依赖的统计维度。

### 2.4 Blackboard 工具层返回字典

来源：`agent_tools.py`。

这部分已经有单元测试验证返回形状，因此是当前最有代表性的“代码外可观察契约”之一。

#### a. 课程目录搜索工具返回

当前顶层字段可确认包括：

| 字段 | 含义 |
| --- | --- |
| `keyword` | 搜索关键词 |
| `field` | 搜索字段 |
| `operator` | 搜索操作符 |
| `limit` | 条数限制 |
| `total` | 结果总数 |
| `results` | 搜索结果数组 |
| `logs` | 运行日志数组 |
| `log_summary` | 日志汇总 |

#### b. ICS 刷新工具返回

当前顶层字段可确认包括：

| 字段 | 含义 |
| --- | --- |
| `feed_url` | 实际使用的订阅地址 |
| `db_path` | 数据库路径，已转为字符串 |
| `stats` | 同步统计 |
| `active_event_count` | 当前活跃事件数 |
| `all_event_count` | 全部事件数 |
| `active_events` | 活跃事件列表 |
| `logs` | 日志数组 |
| `log_summary` | 日志汇总 |

#### c. Blackboard snapshot 同步工具返回

当前顶层字段可确认包括：

| 字段 | 含义 |
| --- | --- |
| `db_path` | 数据库路径 |
| `resource_course_limit` | 资源抓取课程数限制 |
| `scraped_counts` | 实时抓取数量汇总 |
| `first_sync_stats` | 首次同步统计 |
| `second_sync_stats` | 第二次同步统计 |
| `table_counts` | 数据表计数 |
| `expected_active_counts` | 预期活跃记录数 |
| `integrity_ok` | 完整性检查是否通过 |
| `second_sync_has_no_new_records` | 第二次同步是否没有新增 |
| `second_sync_has_no_deleted_records` | 第二次同步是否没有删除 |
| `logs` | 日志数组 |
| `log_summary` | 日志汇总 |

这一组字段很重要，因为它已经把“抓取、同步、校验”的结果以结构化字典方式暴露出来了。

## 3. 代码里可调用但不是正式入口的契约形态

### 3.1 provider use case 返回对象

Blackboard 和 TIS 的 provider use case 普遍会返回命名明确的结果对象，而不是散乱元组或裸字典。例如：

- 课程目录搜索结果对象；
- ICS 同步结果对象；
- Blackboard snapshot 报告对象；
- TIS 个人成绩、学分绩、已选课程结果对象。

这说明项目内部已经在朝“结构化返回”靠拢。

但当前对外文档仍应保持克制：

- 这些对象适合当作内部能力与未来接口设计参考；
- 还不应被写成对前端承诺的正式协议。

### 3.2 日志与摘要

Blackboard 工具层返回中显式暴露了：

- `logs`
- `log_summary`

这表示日志本身也已经是当前输出的一部分，而不只是终端噪声。对于调试和联调来说，这很有价值；但如果未来要服务化，是否继续直接暴露这些日志字段，还需要重新设计。

## 4. 当前哪些字段更适合视为较稳定参考

在当前阶段，下面这些内容更适合当作“相对稳定的契约方向”：

- 搜索类输出中的 `keyword`、`field`、`operator`、`limit`、`total`；
- 同步类输出中的 `feed_url`、`db_path`、`stats`；
- snapshot 输出中的 `scraped_counts`、`first_sync_stats`、`second_sync_stats`、`table_counts`、`expected_active_counts`、`integrity_ok`；
- 通用的 `logs` 与 `log_summary` 顶层存在性。

这些字段共同特点是：

- 已经直接出现在 CLI 报告或工具返回中；
- 在测试里也有一定程度的形状约束；
- 语义比较清楚，不依赖实现细枝末节才能理解。

## 5. 当前哪些内容更适合视为实现细节

下面这些内容虽然现在能看到，但更适合保留为“当前实现输出”，不宜过早当成长期稳定协议：

- DTO 内部的全部细枝末节字段；
- 日志事件里每一个明细键名；
- 某些统计对象里未来可能扩展的附加字段；
- 具体错误文案的逐字内容。

原因很简单：这些内容在未来服务化时，很可能会被重新组织。

## 6. 当前契约与 HTTP API 的边界

这里再次强调一次，避免误读：

- 当前已经存在一组 **desktop runtime 控制面 HTTP 契约**；
- 但 Blackboard / TIS 复杂业务能力仍主要表现为 CLI、工具层和结果对象输出；
- 现在还没有已经承诺给前端长期依赖的完整业务 HTTP API 规范。

如果后续要做前端正式联调，应把这里的内容作为输入，重新整理为服务端 API 契约，而不是直接照搬现有字典、报告文件或阶段 1 的控制面端点。

## 7. 快速结论

### 已实现

- Desktop runtime 本地 HTTP 最小契约；
- Blackboard CLI JSON 报告；
- Blackboard 工具层返回字典；
- provider use case 的结构化结果对象；
- snapshot 同步统计和完整性输出。

### 代码里可调用但不是正式入口

- TIS provider 结果对象；
- Blackboard/TIS 更细粒度 DTO 与日志明细；
- Blackboard / TIS 复杂业务能力的正式 HTTP 暴露面。

### 未来草案

- 把这些输出进一步收束为真正的业务 HTTP API 响应规范。

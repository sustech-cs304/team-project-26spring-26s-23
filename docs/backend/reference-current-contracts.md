---
title: 当前可观察契约参考
description: 整理当前已经能从代码外观察到的 runtime、CLI 和工具输出形态，重点补充当前 session-first 聊天契约的可观察面。
sidebar_position: 6
---

# 当前可观察契约参考

这份附录只做一件事：

> 把当前已经能从代码外观察到的后端输出形态整理出来，方便联调、排错和文档核对。

它不是完整业务 API 规范，也不会把未来设计讨论写成已实现事实。

## 先给结论

当前后端对外最值得关注的可观察契约有三类：

1. **desktop runtime 的本地 HTTP 契约**
2. **Blackboard / TIS 相关 CLI 与工具输出**
3. **当前 session-first 聊天主路径的 4 个方法输出**

其中第三类是这次文档最需要更新的部分：

- `agents/list`
- `session/create`
- `capabilities/get`
- `message/send`

它们现在已经构成当前前端真正使用的聊天主路径。

## 文档范围

本文档覆盖：

- desktop runtime 控制面端点
- 当前可观察的聊天方法输出形态
- Blackboard CLI 报告与工具层返回字典
- 当前哪些输出更适合当作稳定参考，哪些仍更像实现细节

本文档不覆盖：

- 完整业务 API 规范
- 未来接口草案
- Electron 到 Python 的启动细节

## 1. Desktop runtime 控制面契约

### 当前已确认端点

| 端点 | 作用 | 当前稳定度 |
| --- | --- | --- |
| `GET /health` | 基础健康检查 | 较高 |
| `GET /ready` | 启动完成度与最近错误摘要 | 较高 |
| `GET /version` | 版本、Python 版本、运行模式与入口信息 | 较高 |
| `GET /build-info` | 当前与 `GET /version` 同形 | 中等偏高 |
| `GET /diagnostics` | 运行目录、配置摘要、鉴权摘要与能力摘要 | 中等偏高 |
| `GET /diagnostics/runtime-info` | 当前与 `GET /diagnostics` 同形 | 中等偏高 |

### 当前已确认边界

- 只监听 loopback 地址。
- diagnostics 不直接回显敏感 token。
- 如果配置了 local token，只有 diagnostics 端点要求 `X-Local-Token`。
- 这组端点属于桌面宿主控制面，不等于 Blackboard / TIS 复杂业务 HTTP API。

## 2. 当前聊天契约的可观察输出

当前聊天对外仍统一走：

- `POST /`

但主路径已经是 session-first，不再把旧 `agent/connect` / `agent/run` 当正式前端主流程。

### 2.1 `agents/list`

#### 当前用途

- 读取 runtime 暴露的智能体目录。

#### 当前可观察到的关键字段

| 字段 | 含义 | 当前稳定度判断 |
| --- | --- | --- |
| `ok` | 请求是否成功 | 较高 |
| `directoryVersion` | 当前目录版本号 | 较高 |
| `defaultAgentId` | 默认智能体建议项 | 较高 |
| `agents[]` | 智能体目录数组 | 较高 |

#### `agents[]` 中当前值得依赖的字段

| 字段 | 含义 |
| --- | --- |
| `agentId` | 智能体唯一标识 |
| `status` | 当前状态 |
| `recommendedTools` | 推荐工具集合 |
| `defaultModelPreference` | 默认模型偏好提示 |
| `displayName` | 展示名称 |
| `description` | 文本说明 |
| `iconKey` | 图标提示键 |

### 2.2 `session/create`

#### 当前用途

- 创建会话，并把选中的智能体绑定到该会话。

#### 当前可观察到的关键字段

| 字段 | 含义 | 当前稳定度判断 |
| --- | --- | --- |
| `ok` | 请求是否成功 | 较高 |
| `sessionId` | 当前会话 ID | 较高 |
| `boundAgent` | 当前会话绑定的智能体视图 | 较高 |
| `createdAt` | 创建时间 | 较高 |
| `updatedAt` | 最近更新时间 | 较高 |
| `recommendedTools` | 推荐工具集合 | 中等偏高 |
| `defaultModelPreference` | 默认模型偏好提示 | 中等偏高 |
| `capabilities.tools.selectionMode` | 工具选择模式提示 | 中等偏高 |

#### 当前更值得关注的语义

- `sessionId` 已经成为当前前端主路径里的正式会话标识。
- `boundAgent` 说明会话级智能体绑定已经进入正式契约。
- 后续消息如果携带不一致的 agent 校验值，会触发 `agent_mismatch`。

### 2.3 `capabilities/get`

#### 当前用途

- 读取某个会话对应的能力面。

#### 当前可观察到的关键字段

| 字段 | 含义 | 当前稳定度判断 |
| --- | --- | --- |
| `ok` | 请求是否成功 | 较高 |
| `sessionId` | 当前会话 ID | 较高 |
| `boundAgent` | 当前绑定智能体 | 较高 |
| `capabilitiesVersion` | 当前能力面版本 | 较高 |
| `tools[]` | 当前可见工具目录 | 较高 |
| `recommendedTools` | 推荐工具集 | 中等偏高 |
| `toolSelectionMode` | 工具选择模式 | 中等偏高 |
| `defaultModelPreference` | 默认模型偏好提示 | 中等偏高 |

#### `tools[]` 中当前值得依赖的字段

| 字段 | 含义 |
| --- | --- |
| `toolId` | 工具唯一标识 |
| `kind` | 工具类型 |
| `availability` | 当前可用状态 |
| `displayName` | 展示名称 |
| `description` | 文本说明 |

### 2.4 `message/send`

#### 当前用途

- 发送一条消息，并为这一次执行显式给出模型和工具策略。

#### 当前请求侧最值得关注的字段

| 字段 | 含义 |
| --- | --- |
| `sessionId` | 目标会话 ID |
| `agent` | 可选的会话绑定校验值 |
| `message.role` | 当前必须是 `user` |
| `message.content` | 当前用户消息文本 |
| `model` | 本次请求使用的模型 |
| `enabledTools` | 本次启用的工具列表 |
| `requestOptions` | 本次请求附带选项 |

#### 当前响应侧最值得关注的字段

| 字段 | 含义 | 当前稳定度判断 |
| --- | --- | --- |
| `ok` | 请求是否成功 | 较高 |
| `sessionId` | 当前会话 ID | 较高 |
| `boundAgent` | 当前绑定智能体 | 较高 |
| `assistantMessage` | 助手返回文本 | 较高 |
| `resolvedModelId` | 后端最终接受的模型 ID | 较高 |
| `resolvedToolIds` | 后端最终接受并启用的工具 ID | 较高 |
| `requestOptions` | 实际回显的请求选项 | 中等偏高 |

#### 为什么这条方法很重要

因为它现在把三件事正式拆开了：

- 会话绑定的是智能体
- 每次请求单独选择模型
- 每次请求单独选择工具

所以当前更适合依赖的，是：

- `sessionId`
- `boundAgent`
- `resolvedModelId`
- `resolvedToolIds`

而不是旧时代的“全局 agentName + 固定模型”理解方式。

## 3. 旧聊天桥方法现在怎样看

runtime 当前仍然保留这些旧兼容方法：

- `info`
- `agent/connect`
- `agent/run`

它们现在更准确的定位是：

- 兼容调用仍可见
- 某些旧测试和旧路径仍可观察到它们
- 但当前正式前端主路径已经不再依赖它们

因此在“当前可观察契约”里，可以继续记录它们存在；但在“当前正式前端主路径”里，不应再把它们写成主流程。

## 4. Blackboard CLI JSON 报告

### 4.1 课程目录搜索 CLI 报告

来源：开启 `--save-json` 后写入 `backend/data/reports/`。

当前较值得依赖的顶层字段包括：

- `run_at`
- `keyword`
- `field`
- `operator`
- `limit`
- `total`
- `results`

这些字段当前已经足够适合：

- 联调
- 调试
- 人工审查

但还不应直接等同于长期对前端承诺的正式业务 API schema。

### 4.2 ICS 同步 CLI 报告

当前较值得依赖的顶层字段包括：

- `run_at`
- `feed_url`
- `stats`
- `events`

其中 `stats` 当前至少会围绕这些量展开：

- `parsed`
- `inserted`
- `updated`
- `deleted`

## 5. Blackboard 工具层返回字典

这部分已经有较明确的测试约束，因此也是当前很有参考价值的“代码外可观察输出”。

### 5.1 课程目录搜索工具

当前顶层字段可确认包括：

- `keyword`
- `field`
- `operator`
- `limit`
- `total`
- `results`
- `logs`
- `log_summary`

### 5.2 ICS 刷新工具

当前顶层字段可确认包括：

- `feed_url`
- `db_path`
- `stats`
- `active_event_count`
- `all_event_count`
- `active_events`
- `logs`
- `log_summary`

### 5.3 Blackboard snapshot 同步工具

当前顶层字段可确认包括：

- `db_path`
- `resource_course_limit`
- `scraped_counts`
- `first_sync_stats`
- `second_sync_stats`
- `table_counts`
- `expected_active_counts`
- `integrity_ok`
- `second_sync_has_no_new_records`
- `second_sync_has_no_deleted_records`
- `logs`
- `log_summary`

## 6. 当前哪些内容更适合当作稳定参考

在当前阶段，更适合作为“相对稳定可观察契约方向”的包括：

- runtime 控制面端点的存在性与用途
- `agents/list`、`session/create`、`capabilities/get`、`message/send` 的顶层字段
- `sessionId`、`boundAgent`、`resolvedModelId`、`resolvedToolIds` 这类当前聊天主路径核心字段
- Blackboard CLI 报告中的搜索与同步顶层字段
- 工具层返回中的 `logs` 与 `log_summary`

## 7. 当前哪些内容更适合保留为实现细节

下面这些内容现在虽然可见，但更适合写成“当前实现输出”，而不是长期冻结协议：

- DTO 内部所有细枝末节字段
- 日志事件里每一个明细键名
- 某些统计对象未来可能继续扩展的附加字段
- 具体错误文案的逐字内容

## 8. 当前边界

这里再强调一次，避免误读：

- 当前已经存在 desktop runtime 控制面 HTTP 契约。
- 当前已经存在 session-first 聊天主路径的 4 个正式方法。
- 但 Blackboard / TIS 复杂业务能力，仍主要表现为 CLI、工具层和结果对象输出。
- 现在还没有面向前端长期承诺的完整业务 Web API 规范。

## 9. 快速结论

### 当前已实现并可被外部观察到的输出

- desktop runtime 控制面端点
- session-first 聊天主路径 4 方法输出
- Blackboard CLI JSON 报告
- Blackboard 工具层返回字典
- provider use case 的结构化结果对象

### 当前仍不应写成正式业务 API 的内容

- Blackboard / TIS 复杂业务 Web API
- 更细粒度 DTO 内部结构
- 所有日志明细字段
- 未来设计草案中的完整接口规范

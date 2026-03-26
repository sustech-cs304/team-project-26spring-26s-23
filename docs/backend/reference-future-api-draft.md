---
title: 未来 API 草案参考
description: 草拟未来后端可能收束出的 API 资源方向，不代表当前实现承诺。
sidebar_position: 8
---

# 未来 API 草案参考

> 这是一份**未来草案**，不是当前已经实现或已经承诺的接口规范。
>
> 这份附录服务于 [前后端连接现状说明](./frontend-connection.md)。它只回答一件事：**如果未来需要把当前后端能力整理成正式服务接口，最自然的资源方向可能是什么。**

## 1. 使用这份草案前先确认边界

当前仓库里的现实情况是：

- 已有 Blackboard CLI、工具层、provider use case、数据同步链路；
- TIS 已有若干 provider use case；
- 但还没有确认到可直接启动的 HTTP 服务入口。

因此，下面所有内容都只能按“未来可能的整理方向”理解，不能当成：

- 当前已开放接口；
- 已冻结字段；
- 已承诺 URL 设计；
- 已确定鉴权和错误码方案。

## 2. 草案设计原则

如果未来要从当前代码形态走向正式 API，比较合理的原则应是：

1. 先沿用现在已经真实存在的能力边界；
2. 优先把当前 CLI 输出和工具返回字典收束成资源接口；
3. 不把内部 DTO 和日志明细原样暴露给前端；
4. Blackboard 与 TIS 分开建模，不假装它们成熟度完全一致；
5. 先覆盖最明确的已实现能力，再考虑扩展。

## 3. Blackboard 方向的草案资源

### 3.1 课程目录搜索

#### 对应当前事实

- 已有课程目录搜索 CLI；
- 已有工具层字典返回；
- 已有结构化结果对象。

#### 草案资源方向

```text
GET /api/blackboard/course-catalog/search
```

#### 草案查询参数

| 参数 | 含义 | 来源依据 |
| --- | --- | --- |
| `keyword` | 搜索关键词 | 当前 CLI 必填参数 |
| `field` | 搜索字段 | 当前 CLI / 工具层已支持 |
| `operator` | 搜索操作符 | 当前 CLI / 工具层已支持 |
| `limit` | 限制返回条数 | 当前 CLI / 工具层已支持 |

#### 草案响应方向

```json
{
  "keyword": "数据库",
  "field": "CourseName",
  "operator": "Contains",
  "limit": 20,
  "total": 3,
  "results": [
    {
      "course_id": "...",
      "course_identifier": "CS305",
      "course_name": "数据库系统",
      "instructor": "...",
      "description": "..."
    }
  ]
}
```

#### 草案说明

这里之所以优先从搜索做起，是因为这条能力当前已经同时具备 CLI、工具返回和结果结构，最容易收束成稳定接口。

### 3.2 日历 ICS 刷新与事件视图

#### 对应当前事实

- 已有 ICS CLI；
- 已有工具层字典返回；
- 已有本地数据库同步。

#### 草案资源方向 A：触发刷新

```text
POST /api/blackboard/calendar/refresh
```

#### 草案请求方向

```json
{
  "feed_url": "https://example.com/calendar.ics",
  "reset_schema": false
}
```

#### 草案响应方向

```json
{
  "feed_url": "https://example.com/calendar.ics",
  "db_path": "data/sustech.db",
  "stats": {
    "parsed": 12,
    "inserted": 5,
    "updated": 3,
    "deleted": 1
  },
  "active_event_count": 10,
  "all_event_count": 12,
  "active_events": []
}
```

#### 草案资源方向 B：读取事件

```text
GET /api/blackboard/calendar/events
```

#### 草案说明

当前代码最明确的是“刷新并同步”。未来如果真要给前端接日历视图，通常还需要补一个“读取已同步事件”的资源层。这部分当前代码事实还不足以写成现状接口，所以这里只保留方向。

### 3.3 Blackboard snapshot 同步

#### 对应当前事实

- 已有完整 snapshot 抓取与同步 use case；
- 已有工具层字典返回；
- 已有同步统计、完整性检查和第二次同步校验。

#### 草案资源方向

```text
POST /api/blackboard/snapshots/sync
```

#### 草案请求方向

```json
{
  "resource_course_limit": 3,
  "verify_second_sync": true,
  "reset_schema": false
}
```

#### 草案响应方向

```json
{
  "db_path": "data/sustech.db",
  "resource_course_limit": 3,
  "scraped_counts": {
    "courses": 10,
    "assignments": 50,
    "resources": 20,
    "grades": 45,
    "announcements": 8
  },
  "first_sync_stats": {},
  "second_sync_stats": {},
  "table_counts": {},
  "expected_active_counts": {},
  "integrity_ok": true,
  "second_sync_has_no_new_records": true,
  "second_sync_has_no_deleted_records": true
}
```

#### 草案说明

这类能力更像“后台同步任务”而不是普通列表接口。未来若服务化，可能还需要再引入任务状态、异步执行或审计记录机制。当前文档不把这些扩展写死，只保留方向。

## 4. TIS 方向的草案资源

TIS 当前的事实基础弱于 Blackboard CLI 面，因此这里更应保持克制。

### 4.1 个人成绩

#### 对应当前事实

- 已有 provider use case；
- 已有结构化结果；
- 可选持久化。

#### 草案资源方向

```text
GET /api/tis/personal-grades
```

#### 草案响应方向

```json
{
  "success": true,
  "resolved_role_code": "01",
  "source_url": "...",
  "grade_records": []
}
```

### 4.2 学分绩

#### 草案资源方向

```text
GET /api/tis/credit-gpa
```

#### 草案响应方向

```json
{
  "success": true,
  "resolved_role_code": "01",
  "summary": {
    "average_credit_gpa": 3.8,
    "rank": "..."
  },
  "term_records": [],
  "year_records": []
}
```

### 4.3 已选课程

#### 草案资源方向

```text
GET /api/tis/selected-courses
```

#### 草案查询参数

| 参数 | 含义 |
| --- | --- |
| `semester` | 指定学期；不传时可回退到当前学期 |
| `page_num` | 页码 |
| `page_size` | 每页数量 |

#### 草案响应方向

```json
{
  "success": true,
  "resolved_role_code": "01",
  "semester_source": "default-current-term",
  "courses": [],
  "summary": {
    "total_credits": 18
  }
}
```

### 4.4 TIS 诊断

#### 草案资源方向

```text
POST /api/tis/diagnostics/link-check
```

#### 草案说明

这类接口更适合内部诊断或运维工具使用，不一定应该直接暴露给普通前端页面。保留这个草案，是因为它在当前 provider 能力里已经有比较清楚的阶段性输出。

## 5. 未来如果真的做 HTTP API，还需要补什么

这些内容当前都**没有在代码中形成正式实现**，所以这里只作为提醒：

- 统一鉴权方式；
- 错误码和失败响应格式；
- 是否同步执行还是异步任务；
- 字段版本管理；
- 哪些日志/调试信息允许暴露给前端；
- 本地 SQLite 与正式服务部署之间的关系。

如果这些基础问题没先补齐，就算把 URL 写出来，也还谈不上真正可依赖的 API。

## 6. 当前文档中应该如何引用这份草案

正确引用方式应类似：

- “未来若服务化，可优先考虑这些资源方向。”
- “以下字段仅为草案参考，不代表当前接口承诺。”
- “当前真实契约仍以 CLI JSON 和工具返回字典为主。”

不正确的引用方式则包括：

- “后端当前提供以下 API”；
- “前端可直接按以下接口联调”；
- “以下为正式接口规范”。

## 7. 快速结论

### 已实现

- Blackboard CLI 与工具输出；
- Blackboard snapshot 同步能力；
- TIS 若干 provider use case。

### 可作为未来接口设计输入

- Blackboard 搜索、ICS、snapshot 输出结构；
- TIS 个人成绩、学分绩、已选课程、诊断结果结构。

### 未来草案

- `/api/blackboard/...` 与 `/api/tis/...` 形式的正式 HTTP 服务接口。

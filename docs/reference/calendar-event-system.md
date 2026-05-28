---
title: 日历与事件系统说明
description: 说明 CanDue 的日历事件系统架构，包括数据来源（Blackboard、WakeUP、自定义）、统一存储（timeline.db）、API 端点和前端视图。
sidebar_position: 7
---

# 日历与事件系统说明

- 这页给谁看：需要理解日历事件怎样在 CanDue 中汇聚、存储和展示的使用者和开发者。
- 这页解决什么问题：把日历事件从数据源到前端视图的完整链路统一说明，避免把 Blackboard 日历、WakeUP ICS 和自定义事件这三条路径分散在不同页面中理解。
- 当前覆盖到哪：覆盖当前 Blackboard 同步、WakeUP ICS 导入、timeline.db 统一存储、HTTP API 和前端日历视图。不支持跨设备同步和云端托管。
- 当前状态：已可用（基础链路）/ 部分接通（产品化体验）。

## 先说结论

CanDue 的日历事件系统遵循**统一存储、多源汇聚**的设计：

1. 数据来自三个渠道：Blackboard 日历同步、WakeUP ICS 导入、用户自定义事件。
2. 所有事件统一存储在 `timeline.db`（SQLite），Electron 主进程和 Python 后端都可以读写。
3. 前端通过 Electron IPC 或 HTTP API 查询和操作事件。
4. 前端「日历」工作区提供 Gantt 图和看板两种视图。

## 数据来源

### Blackboard 日历

Blackboard 日历事件通过后端的 `blackboard.calendar.refresh` 能力同步：

1. 后端抓取 Blackboard 的 ICS 日历订阅源。
2. 解析后写入 Blackboard 本地数据库（`sustech.db`）。
3. 通过 `sync_blackboard_to_unified()` 映射到统一事件格式，写入 `timeline.db`。
4. 同时 `sync_blackboard_assignments_to_unified()` 将作业截止日期也作为事件同步（`source="bb"`，`source_id="assignment:<id>"`）。

触发方式：智能体调用 `blackboard.calendar.refresh` 工具。

### WakeUP ICS 导入

用户可以通过 WakeUP 分享链接导入课程表：

1. 用户在「设置 → 外部源」或智能体对话中触发 WakeUP ICS 导入。
2. ICS 文本通过 `POST /api/wakeup/import/ics` 发送到后端。
3. 后端解析 RFC 5545 ICS（支持 `RRULE` 周重复、`EXDATE` 排除日期），展开为事件列表。
4. 写入 `timeline.db`，`source="wakeup"`。

ICS 解析能力：
- 支持 `FREQ=WEEKLY` 重复规则，含 `INTERVAL`、`BYDAY`、`COUNT`、`UNTIL`。
- 支持 `EXDATE` 排除日期。
- 最多展开 512 个重复事件。
- 也可通过 `POST /api/wakeup/parse/ics` 先预览解析结果再决定是否导入。

### 自定义事件

用户在日历工作区中可以直接创建、编辑和删除事件。这些事件会直接写入 `timeline.db`，`source="custom"`，不经过后端。

## 统一存储：timeline.db

### 表结构

```sql
CREATE TABLE timeline_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    source          TEXT NOT NULL,          -- 'bb', 'wakeup', 'custom'
    source_id       TEXT,                   -- 外部唯一标识
    title           TEXT NOT NULL,
    description     TEXT,
    start_time      TEXT NOT NULL,          -- ISO-8601
    end_time        TEXT,
    is_all_day      INTEGER DEFAULT 0,
    location        TEXT,
    status          TEXT DEFAULT 'not_started',  -- 'not_started'|'in_progress'|'completed'
    metadata_payload TEXT,                  -- JSON blob
    progress        REAL DEFAULT 0,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 双重访问

`timeline.db` 同时被两个进程访问：

- **Electron 主进程**（Node.js，通过 `better-sqlite3`）：前端 CRUD 操作、本地事件读写。
- **Python 后端**（通过 `sqlite3`）：Blackboard 同步写入、WakeUP 导入写入、HTTP API 查询。

`backend/app/timeline_db.py` 提供了 `resolve_timeline_db_path()`、`query_timeline_events()`、`insert_timeline_event()`、`upsert_timeline_event()`、`update_timeline_event()`、`delete_timeline_event()`、`sync_timeline_events()` 等工具函数。

## API 端点

### 后端 HTTP API

| 端点 | 方法 | 用途 |
| --- | --- | --- |
| `GET /calendar/events` | GET | 从 timeline.db 列出所有事件，返回 `{"items": [...]}` |
| `POST /api/wakeup/import/ics` | POST | 导入 ICS 日历文本，解析后写入 timeline.db |
| `POST /api/wakeup/parse/ics` | POST | 仅解析 ICS 日历，返回预览结果，不写入 |

### Electron IPC 通道

| 通道 | 方向 | 用途 |
| --- | --- | --- |
| `timeline-database:load-events` | renderer → main | 加载事件（本地 + 远程合并） |
| `timeline-database:add-event` | renderer → main | 创建事件 |
| `timeline-database:update-event` | renderer → main | 更新事件 |
| `timeline-database:delete-event` | renderer → main | 删除事件 |

### 事件加载流程

1. `HubWorkspace` 调用 `window.timelineDatabase.loadEvents()`。
2. Electron 主进程读取本地 `timeline.db` 事件。
3. 同时通过 HTTP `GET {runtimeUrl}/calendar/events` 从后端拉取远程事件。
4. 合并去重（按 `source:source_id` 或 `source:title:start_time` 复合键）。
5. 返回统一事件列表给前端。

## 前端视图

日历工作区（左侧入口栏的「日历」）包含以下组件：

### Gantt 图视图（CalendarGanttView）

基于 `frappe-gantt` 库提供的时间轴视图：

- 时间刻度按需切换（小时 → 年）。
- 事件条按来源（`source`）分配颜色。
- 拖拽事件条边缘可调整日期。
- 拖拽进度手柄可调整完成百分比。
- 滚轮平移（无修饰键）/ 纵向滚动（Shift）/ 缩放（Ctrl/Cmd）。
- 右键菜单提供编辑、状态切换和删除。
- 支持切换 WakeUP 课程事件的可见性。

### 看板视图（KanbanTracker）

三列看板：「未开始」/「进行中」/「已完成」：

- 排除 `source="wakeup"` 事件（避免干扰）。
- 每个列支持「+ 新建事件」。
- 卡片显示标题、来源标签和进度百分比。
- 右键菜单与 Gantt 图共享。

### 数据模型

`UnifiedCalendarEvent` 包含：

- `id`、`source`、`source_id`
- `title`、`description`、`location`
- `start_time`、`end_time`、`is_all_day`
- `status`、`progress`、`metadata_payload`

## 事件同步规则

| 来源 | 同步方式 | 冲突处理 |
| --- | --- | --- |
| Blackboard 日历（`bb`） | `sync_blackboard_to_unified()` 全量替换 | 先删除所有 `source="bb"` 事件，再写入新数据 |
| Blackboard 作业（`bb`，`assignment`） | `sync_blackboard_assignments_to_unified()` 增量追加 | 按 `source_id` 去重，仅插入缺失项，不删除已有项 |
| WakeUP（`wakeup`） | `import/ics` 端点写入 | 按 `source_id` upsert |
| 自定义（`custom`） | 用户手动 CRUD | 直接写入 timeline.db，不走后端 |

## 当前边界

- timeline.db 是本地单机存储，**不支持**跨设备同步或云端备份。
- 事件通过 `source` 标签区分来源，但前端未提供按来源批量管理的能力。
- Blackboard 同步需要通过智能体工具触发，还没有定时自动刷新机制。
- WakeUP ICS 导入后的事件不可反向同步回 WakeUP。

## 相关页面

- [术语表](./glossary.md)
- [运行时接口 / 事件参考](./runtime-events.md)
- [能力边界 / 状态总表](./capabilities.md)
- [MCP 集成说明](./mcp-integration.md)

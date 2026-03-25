# 项目文档

## 这个项目现在是什么

这是一个 Electron 桌面应用项目，目标是为 SUSTech 学生提供统一的课程管理与智能助手工具。当前项目包含：

- **桌面前端**（[`frontend-copilot/`](../frontend-copilot/)）：Electron + React + TypeScript 实现的桌面应用壳，已接入最小 Copilot 聊天链路
- **Python 后端**（[`backend/`](../backend/)）：能力库 + CLI + 数据同步层，包含 Blackboard 与教务系统（TIS）的抓取、解析与本地持久化能力
- **桌面运行时**：Electron 主进程托管的本地 Python HTTP 服务，提供最小聊天运行时契约

当前阶段重点是"先把基础设施搭起来"，而不是"先把所有业务做完"。

## 推荐阅读顺序

### 如果你是第一次接手项目

1. **快速上手**
   - [`frontend-copilot/README.md`](../frontend-copilot/README.md)：前端快速上手，了解怎么安装、启动、构建
   - [`backend/README.md`](../backend/README.md)：后端快速上手，了解现在能跑什么

2. **理解系统全貌**（推荐顺序）
   - [`docs/system/architecture-overview.md`](system/architecture-overview.md)：系统架构总览
   - [`docs/system/runtime-lifecycle.md`](system/runtime-lifecycle.md)：运行时启动与生命周期
   - [`docs/system/chat-runtime-contract.md`](system/chat-runtime-contract.md)：聊天运行时契约
   - [`docs/system/session-and-state-model.md`](system/session-and-state-model.md)：session 与状态模型

3. **深入子系统实现**
   - 后端开发：[`docs/backend/README.md`](backend/README.md) → 后端分册
   - 前端开发：[`docs/frontend/README.md`](frontend/README.md) → 前端分册

### 如果你只想快速确认某个具体问题

直接查阅对应子系统的参考文档：

- 后端运行与配置：[`docs/backend/reference-run-and-config.md`](backend/reference-run-and-config.md)
- 后端当前契约：[`docs/backend/reference-current-contracts.md`](backend/reference-current-contracts.md)
- 前端生效字段：[`docs/frontend/reference-current-fields.md`](frontend/reference-current-fields.md)
- 前端运行态：[`docs/frontend/reference-runtime-states.md`](frontend/reference-runtime-states.md)
- 前端页面能力：[`docs/frontend/reference-page-capabilities.md`](frontend/reference-page-capabilities.md)

## 文档体系结构

### 主阅读路径

这些文档构成项目的正式文档主路径，适合作为稳定参考：

- **[`docs/system/`](system/)**：跨前后端的系统专题层，覆盖架构、运行时、聊天契约、session 模型
- **[`docs/backend/`](backend/)**：后端子系统分册，包含模块布局、运行配置、边界与路线图、契约参考
- **[`docs/frontend/`](frontend/)**：前端子系统分册，包含 UI 现状、连接契约、运行态、页面能力

### 非主路径材料

以下目录不属于正式文档主阅读路径，仅在特定场景下查阅：

- **[`docs/plans/`](plans/)**：临时计划文档，用于设计与实施规划，不属于稳定手册
- **[`docs/meetings/`](meetings/)**：团队内部会议存根，与项目正式文档主路径关联不大

这些材料服务于团队内部协作与历史追溯，但不应被当作项目当前状态的权威说明。

## 代码仓库与文档的关系

### 子系统 README 与 `docs/` 体系的分工

- **[`backend/README.md`](../backend/README.md)** 和 **[`frontend-copilot/README.md`](../frontend-copilot/README.md)**：快速上手入口，重点回答"这是什么、怎么跑起来、现在做到哪一步"
- **`docs/backend/` 和 `docs/frontend/`**：详细说明与参考附录，重点回答"模块怎么组织、边界在哪里、哪些能力已实现、哪些还是占位"

两者互为补充：子系统 README 负责"快速建立认识"，`docs/` 体系负责"深入理解细节"。

### 文档更新原则

1. **事实锚定**：所有正式文档必须基于当前仓库代码事实，不虚构未来能力
2. **分层清晰**：区分系统总览层（`docs/system/`）与子系统实现层（`docs/backend/`、`docs/frontend/`）
3. **主路径优先**：优先维护主阅读路径文档，临时材料不纳入稳定手册
4. **避免重复**：跨前后端的系统概念统一在 `docs/system/` 中描述，子系统文档聚焦各自实现细节

## 当前项目边界

### 已实现

- Electron 桌面应用壳与工作区导航
- Electron 主进程托管的 Python 桌面运行时
- Blackboard 课程目录搜索与日历 ICS 同步 CLI
- 最小 Copilot 聊天链路（单 agent、纯文本、多轮上下文）
- 本地 SQLite 数据持久化与同步链路
- 分层测试覆盖（unit / integration / e2e）

### 代码里可调用，但不是正式入口

- Blackboard 的工具层函数与 snapshot use case
- TIS 的诊断、个人成绩、学分绩、已选课程 use case
- 设置页的大部分字段（当前主要由前端本地 state 驱动）

### 未来草案

- 完整的前后端 HTTP API 规范
- 工具调用与确认机制
- 完整的会话产品化
- 多 agent 支持

## 继续阅读

- 系统架构总览：[`docs/system/architecture-overview.md`](system/architecture-overview.md)
- 后端文档入口：[`docs/backend/README.md`](backend/README.md)
- 前端文档入口：[`docs/frontend/README.md`](frontend/README.md)

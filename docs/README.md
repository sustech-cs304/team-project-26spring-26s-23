---
title: 项目文档
description: 项目文档总入口，概览阅读顺序、文档结构与当前系统边界。
sidebar_position: 1
sidebar_label: 文档首页
slug: /
---

# 项目文档

这份首页文档的目标很简单：

- 帮你先建立整个项目的全局印象
- 告诉你应该先读哪几篇正式文档
- 区分正式手册与计划材料

## 这个项目现在是什么

当前项目是一个 Electron 桌面应用，目标是把课程相关能力、桌面运行时和智能助手体验整合到同一个工作台里。

它当前主要由三部分组成：

- **桌面前端**：`frontend-copilot/`
  - Electron + React + TypeScript
  - 已进入统一配置中心与 session-first 聊天主路径

- **Python 后端**：`backend/`
  - desktop runtime
  - copilot runtime
  - Blackboard / TIS 领域能力

- **项目文档**：`docs/`
  - 系统总览
  - 前端分册
  - 后端分册
  - 参考附录与未来草案

## 当前项目最重要的三条主线

如果你最近才接手项目，先记住下面三件事就够了：

1. **统一配置中心已经正式落地**
   - 配置已不是单一 settings 文件思路
   - 当前已经是多文件 JSON、可读、带迁移的持久化系统

2. **聊天主路径已经切到 session-first**
   - 后端目录是真源
   - 会话绑定智能体
   - 每次消息再决定模型和工具策略

3. **UI 已经完成一轮当前形态收敛**
   - 启动页主题已进入正式外观
   - 聊天面板已有稳定布局
   - 模型选择器、工具选择器与设置页正式入口已经形成当前版本

## 推荐阅读顺序

### 如果你第一次接手项目

建议按这个顺序阅读：

1. **先看两篇子系统入口**
   - `docs/frontend/README.md`
   - `docs/backend/README.md`

2. **再看系统专题层**
   - `docs/system/architecture-overview.md`
   - `docs/system/runtime-lifecycle.md`
   - `docs/system/chat-runtime-contract.md`
   - `docs/system/session-and-state-model.md`

3. **最后按角色深入**
   - 前端开发：继续读 `docs/frontend/`
   - 后端开发：继续读 `docs/backend/`

### 如果你只想快速确认某个问题

可以直接看这些参考文档：

- 后端运行与配置：`docs/backend/reference-run-and-config.md`
- 后端当前可观察契约：`docs/backend/reference-current-contracts.md`
- 前端当前生效字段：`docs/frontend/reference-current-fields.md`
- 前端运行时状态：`docs/frontend/reference-runtime-states.md`
- 前端页面能力：`docs/frontend/reference-page-capabilities.md`
- 前端当前 UI：`docs/frontend/ui-current-state.md`

## 当前文档体系怎么分层

### 1. 系统专题层

`docs/system/` 负责跨前后端的系统概念，例如：

- 整体架构
- runtime 生命周期
- 聊天运行时契约
- 会话与状态模型

### 2. 前端分册

`docs/frontend/` 主要回答：

- renderer 当前负责什么
- 配置中心哪些字段已正式生效
- 当前 UI 长什么样
- 页面成熟度到哪一步

### 3. 后端分册

`docs/backend/` 主要回答：

- desktop runtime 和 copilot runtime 怎么组织
- 后端怎么启动、怎么取配置
- 当前可观察契约是什么
- Blackboard / TIS 还处在哪个成熟度阶段

## 正式文档与非正式材料的区别

### 正式文档主路径

下面这些目录和文档属于正式手册的一部分：

- `docs/system/`
- `docs/frontend/`
- `docs/backend/`
- 本页 `docs/README.md`

### 非正式或辅助材料

下面这些内容不应当被当作当前系统事实的权威说明：

- `docs/plans/`
  - 计划文档
  - 只用于设计、排期和方案讨论
  - 不属于正式文档主路径

- `docs/meetings/`
  - 会议记录或会议附件
  - 主要用于历史追溯

## 当前项目边界

### 已实现

- Electron 桌面工作台
- 主进程托管的 Python desktop runtime
- 统一配置中心正式链路
- session-first 聊天主路径
- Blackboard CLI 与本地同步链路
- TIS 若干 provider 能力
- 分层测试覆盖

### 代码里可调用，但不是正式入口

- Blackboard 工具层函数与 snapshot use case
- TIS provider use case
- 设置页中大量仍未进入正式配置链路的表单项

### 未来方向

- 更完整的会话恢复与历史回放
- Blackboard / TIS 业务接口进一步服务化
- 更完整的工具调用与权限机制
- 其余工作区的数据面补齐

## 文档更新原则

正式文档当前遵循这些原则：

1. **先写当前代码事实**，不把草案写成已实现
2. **先维护权威文档**，避免平行重复说明
3. **跨层概念统一收敛到系统专题**
4. **计划材料不替代正式手册**

## 继续阅读

- 系统架构总览：`docs/system/architecture-overview.md`
- 前端文档入口：`docs/frontend/README.md`
- 后端文档入口：`docs/backend/README.md`

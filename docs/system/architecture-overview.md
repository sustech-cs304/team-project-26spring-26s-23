---
title: 系统架构总览
description: 从系统级视角说明 Electron、统一配置中心、Python runtime 与 Renderer 的组件关系和主数据流。
sidebar_position: 1
---

# 系统架构总览

## 文档目标

本文档帮助新成员在一篇文档中建立当前系统全貌，重点回答：

- 统一配置中心现在放在系统的哪一层
- renderer、preload、main process、runtime 现在怎样分工
- 当前哪些配置在前端显示层生效，哪些配置会被宿主投影给 runtime
- 旧 `copilot-settings.json` 现在还剩什么语义

## 系统定位

赶渡 CanDue 是一个基于 Electron 的桌面应用，当前处于**最小聊天 MVP + 统一配置中心最小切片已落地**的阶段。

系统仍然采用“**Electron 宿主 + Python desktop runtime**”架构，但前端配置链路已经从旧的单文件 settings 方案，演进为“**主进程统一配置中心 + renderer 公共快照消费**”模型。

## 核心组件关系

### 组件拓扑

```
┌─────────────────────────────────────────────────────────────┐
│ Electron 主进程                                             │
│  - 管理窗口生命周期                                          │
│  - 管理统一配置中心主服务                                    │
│  - 启动/停止 Python runtime                                  │
│  - 提供 renderer 所需 IPC（配置中心公共接口 + runtime 接口） │
└────────────┬────────────────────────────────────────────────┘
             │
             │ spawn 子进程
             ↓
┌─────────────────────────────────────────────────────────────┐
│ Python Desktop Runtime                                      │
│  - FastAPI HTTP 服务                                         │
│  - 提供 /health、/ready、/diagnostics 等管理端点             │
│  - 挂载 Copilot Runtime 单端点路由                           │
└────────────┬────────────────────────────────────────────────┘
             │
             │ HTTP / SSE
             ↓
┌─────────────────────────────────────────────────────────────┐
│ Electron Renderer                                           │
│  - React 工作台                                              │
│  - 通过 preload 读取配置中心公共快照与 runtime 快照          │
│  - 根据 bootstrap 状态决定是否注入 CopilotKit Provider       │
│  - 在设置页中编辑少量已正式接入的配置字段                    │
└─────────────────────────────────────────────────────────────┘
```

### 统一配置中心在系统中的位置

当前统一配置中心位于 **Electron 主进程层**。

它当前负责：

- 管理配置域文档
- 处理默认值和归一化
- 从旧磁盘 settings 文件做一次性迁移输入
- 把可由 renderer 消费的部分投影为公共快照
- 把可由 renderer 写入的部分通过公共补丁受控修改
- 把可投影给 runtime 的字段交给宿主启动参数组装逻辑

这意味着当前系统中有一个很重要的 owner 边界：

- **renderer 不直接拥有底层配置存储**
- **Python runtime 不直接读取统一配置中心文档**
- **Electron 主进程是统一配置中心和 runtime owner 的连接层**

## 当前主数据流

### 1. 配置读取流

当前配置读取已经不是“renderer 直接读旧 settings 文件”，而是：

1. 主进程读取统一配置中心分域文件
2. 如分域文件还不存在，则尝试从 legacy `copilot-settings.json` 提取可迁移字段
3. 主进程投影出配置中心公共快照
4. preload 向 renderer 暴露公共快照读取和订阅接口
5. renderer 读取公共快照，并从中取出当前真正需要的字段

### 2. 配置写入流

当前配置写入链路是：

1. 设置页发起配置中心公共补丁
2. preload 把补丁转发给主进程
3. 主进程把补丁应用到统一配置中心
4. 主进程写回对应域文档
5. 主进程向所有窗口广播新的公共快照
6. renderer 订阅方收到更新后同步 UI 或重新计算 bootstrap 状态

### 3. 聊天连接流

当前聊天连接链路是：

1. renderer 读取配置中心公共快照
2. renderer 从中取出 `agentName` 和开发态 `runtimeUrl`
3. renderer 同时读取 hosted runtime 快照
4. renderer 把“配置中心 bootstrap fields + hosted runtime 事实”归并成最终连接状态
5. 只有在连接条件满足时，才会注入 CopilotKit Provider 并连接 Python runtime

### 4. Runtime 投影流

当前统一配置中心里已经有一个最小的 runtime 投影样板：

- `backendExposed.model`

但它的工作方式不是“Python runtime 自己去读配置文件”，而是：

1. 主进程读取配置中心中的 `model`
2. 宿主在组装 Python 启动参数时决定是否把它投影为 `--model`
3. Python runtime 继续只解释 CLI 参数 / 环境变量 / 默认值

所以当前应理解为：

- **统一配置中心新增的是宿主治理层**
- **不是 Python runtime 的直接配置文件系统**

## 当前正式配置域

当前统一配置中心按 4 个稳定域组织：

| 配置域 | 主要角色 | 当前字段 |
| --- | --- | --- |
| `frontend-preferences` | 纯前端偏好 | `theme` |
| `assistant-behavior` | assistant 使用行为 | `agentName` |
| `host-config` | 宿主拥有的连接配置 | `runtimeUrl` |
| `backend-exposed` | 宿主可安全投影给 runtime 的字段样板 | `model` |

### 当前各字段在系统中的作用

| 字段 | 当前由谁消费 | 当前作用 |
| --- | --- | --- |
| `theme` | renderer | 控制工作台浅色 / 深色主题，并支持即时生效 |
| `agentName` | renderer | 决定聊天 bootstrap 状态是否完整 |
| `runtimeUrl` | renderer | 在开发态下作为 runtime override 参与连接选择 |
| `model` | main process | 作为 runtime 参数投影样板参与 Python `--model` 解析 |

## 关键子系统说明

### 1. Electron 主进程

**职责**：

- 管理 BrowserWindow 生命周期
- 管理统一配置中心主服务
- 管理 hosted backend 的启动、停止、失败与重试
- 注册 renderer 当前真正需要的 IPC 接口：
  - 配置中心公共快照读取
  - 配置中心公共补丁写入
  - 配置中心公共快照更新广播
  - runtime 快照读取
  - runtime 重试
- 在 `before-quit` 时优雅关闭 Python runtime

**当前重要事实**：

- renderer 侧旧 settings API 已经退场
- 旧 `copilot-settings.json` 只保留主进程内部 legacy migration 语义
- `backendExposed.model` 当前由主进程读取，而不是由 renderer 或 Python runtime 直接读取

### 2. Preload

**职责**：

- 通过 `contextBridge` 暴露最小桥接面
- 屏蔽底层存储路径、spawn 参数和文件系统细节
- 只把 renderer 当前真正需要的接口交给前端

**当前桥接面**：

- `configCenterPublicSnapshot.load()`
- `configCenterPublicSnapshotSubscription.subscribe()`
- `configCenterPublicPatch.apply()`
- `copilotRuntime.load()`
- `copilotRuntime.retry()`

### 3. Electron Renderer

**职责**：

- 读取配置中心公共快照和 hosted runtime 快照
- 计算 bootstrap 状态
- 决定是否加载 CopilotKit Provider
- 提供工作台与设置页 UI
- 在设置页中编辑当前少量正式接入的字段

**当前重要事实**：

- renderer 当前真正参与聊天连接判断的字段只有 `agentName` 和 `runtimeUrl`
- `theme` 只影响前端显示，不参与聊天连接判断
- `model` 已在配置中心中存在，但不是 renderer bootstrap 字段

### 4. Python Desktop Runtime

**职责**：

- 提供本地 HTTP 服务
- 提供 `/health`、`/ready`、`/diagnostics` 等管理端点
- 挂载 Copilot Runtime 路由到 `POST /`
- 解释来自宿主的 CLI 参数

**当前重要事实**：

- Python runtime 继续以 CLI 参数 / 环境变量 / 默认值解释配置
- 不直接读取统一配置中心分域文件
- 宿主传给它的 `--model`，可能来自显式主进程参数，也可能来自配置中心的 `backendExposed.model`

### 5. Copilot Runtime

**职责**：

- 提供单端点聊天 runtime（`POST /`）
- 支持 `info`、`agent/connect`、`agent/run`
- 返回 SSE 流式响应
- 管理内存态 session store

### 6. Session Store

**职责**：

- 维护 `threadId` → `RuntimeSessionRecord` 的映射
- 保留用户 / 助手消息历史
- 为多轮上下文提供最小会话记忆

**当前限制**：

- 当前仍为 `InMemorySessionStore`
- Python runtime 重启后历史丢失

## 运行时产物与目录

### 当前目录结构

默认情况下，Electron 宿主会在 `userData/desktop-runtime/` 下管理运行时目录：

```
<userData>/
└── desktop-runtime/
    ├── config/
    │   ├── config-center/
    │   │   ├── frontend-preferences.json
    │   │   ├── assistant-behavior.json
    │   │   ├── host-config.json
    │   │   └── backend-exposed.json
    │   └── copilot-settings.json      # legacy migration 输入路径
    ├── logs/
    │   ├── electron-host.log
    │   ├── backend.stdout.log
    │   └── backend.stderr.log
    ├── database/
    └── state/
        ├── runtime-snapshot.json
        └── last-failure.json
```

### 这些文件当前分别是什么语义

- `config-center/*.json`：当前正式统一配置中心域文档
- `copilot-settings.json`：旧磁盘格式路径，当前主要保留 migration 输入语义
- `runtime-snapshot.json` / `last-failure.json`：运行观测与失败诊断，不是配置源

## 当前边界与非目标

### 已实现

- ✅ Electron 宿主 + Python runtime 基础架构
- ✅ 单端点聊天 runtime
- ✅ 最小统一配置中心主链路
- ✅ 配置中心公共快照 / 公共补丁 / 公共订阅
- ✅ `theme`、`agentName`、`runtimeUrl`、`model` 四个最小字段切片
- ✅ 主题即时生效
- ✅ 配置更新后根装配层重算 bootstrap 状态

### 当前限制

- ⚠️ 设置页大多数字段仍未纳入统一配置中心
- ⚠️ `model` 当前只有主进程投影样板语义，暂无正式设置页入口
- ⚠️ runtime 状态本身还没有形成完整实时推送流
- ⚠️ Session 仍是内存态
- ⚠️ 默认仍是单 agent

### 当前不要误写成已实现的事

- ❌ Python runtime 直接读取统一配置中心文件
- ❌ renderer 仍以旧 `CopilotSettings` 作为正式接口
- ❌ 后端可暴露字段方案已经完整完成
- ❌ 设置页所有分区都已接入正式配置链路

## 相关文档

- [运行时生命周期](./runtime-lifecycle.md)
- [聊天 Runtime 契约](./chat-runtime-contract.md)
- [会话与状态模型](./session-and-state-model.md)
- [后端运行与配置](../backend/run-and-config.md)
- [前端分册入口](../frontend/README.md)

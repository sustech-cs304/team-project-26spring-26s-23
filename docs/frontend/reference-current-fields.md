---
title: 当前生效字段参考
description: 汇总统一配置中心当前已经正式落地的字段、分域边界、UI 入口与生效方式。
sidebar_position: 3
---

# 当前生效字段参考

这份附录专门用来回答一个经常被问到的问题：

> 统一配置中心现在到底已经接住了哪些字段？哪些是正式生效的？哪些还只是设置页表单？

如果你在评审文档、联调前核对事实，或者准备继续接配置字段，建议先看这篇。

## 先给结论

当前统一配置中心已经不是设计草案，而是一套正式可用的持久化系统。它具备这些特点：

- **按域拆分为多个 JSON 文件**
- **磁盘文件可直接阅读**
- **主进程负责默认值归一化与写回**
- **第一次读取时可从旧 `copilot-settings.json` 迁移已有字段**
- **renderer 通过公共快照、公共补丁和更新订阅消费它**

当前已经正式落地的字段共有 5 个：

- `theme`
- `animationsEnabled`
- `agentName`
- `runtimeUrl`
- `model`

但这 5 个字段的作用并不完全一样。

## 先看分域

当前统一配置中心按 4 个稳定域组织：

| 配置域 | 当前正式字段 | 当前作用 | 默认存储文件 |
| --- | --- | --- | --- |
| `frontend-preferences` | `theme`、`animationsEnabled` | 前端显示偏好 | `userData/desktop-runtime/config/config-center/frontend-preferences.json` |
| `assistant-behavior` | `agentName` | assistant 行为偏好 | `userData/desktop-runtime/config/config-center/assistant-behavior.json` |
| `host-config` | `runtimeUrl` | 宿主持有的开发态连接覆盖配置 | `userData/desktop-runtime/config/config-center/host-config.json` |
| `backend-exposed` | `model` | 宿主可安全投影给 runtime 的后端默认模型字段 | `userData/desktop-runtime/config/config-center/backend-exposed.json` |

这样拆分的意义很直接：

- 前端显示偏好和宿主连接配置不会混在一起。
- 可以清楚看出哪个字段主要影响 UI，哪个字段主要影响 runtime。
- 后续继续接字段时，不需要回到单一大对象配置文件。

## 当前正式字段总表

| 字段 | 所属域 | 当前 UI 入口 | 当前作用 | 生效方式 | 需要注意什么 |
| --- | --- | --- | --- | --- | --- |
| `theme` | `frontend-preferences` | 显示设置 | 控制浅色 / 深色主题 | 立即生效 | 启动时先应用系统兜底主题，再被正式主题覆盖 |
| `animationsEnabled` | `frontend-preferences` | 显示设置 | 控制轻量动画开关 | 立即生效 | 和主题一样，属于正式前端偏好字段 |
| `agentName` | `assistant-behavior` | 常规设置 | 保存默认 agent 名称偏好 | 保存后立即进入配置快照 | 当前不会再作为聊天 readiness 的硬门槛 |
| `runtimeUrl` | `host-config` | API 服务器 | 保存开发态运行时覆盖地址 | 保存后可参与下一次状态重算 | 它不是发布态默认后端地址 |
| `model` | `backend-exposed` | 默认模型 | 保存后端默认模型字段 | 保存后需重启整个程序才进入下一次 runtime 启动参数 | 它不是当前每条消息最终使用的模型 |

## 逐个字段解释

### 1. `theme`

这是当前最成熟的正式字段之一。

它已经形成完整闭环：

1. 启动时从配置中心读取。
2. 应用到 `document.documentElement.dataset.theme`。
3. 设置页切换时先本地应用，避免界面闪动。
4. 再通过配置中心公共补丁写回主进程。
5. 写入失败会回滚。
6. 其他订阅方会收到公共快照更新。

当前支持：

- `light`
- `dark`

### 2. `animationsEnabled`

这个字段现在也已经进入正式链路，而不是旧文档里常见的“动画只是本地 UI 开关”。

当前行为是：

- 启动时从配置中心读取
- 设置页可直接切换
- 会立即反映到工作台根节点数据属性
- 写入失败会回滚

因此现在更准确的说法是：

- 显示设置里正式接入的字段不只有主题，还有动画开关

### 3. `agentName`

这个字段现在最容易被旧说法误导。

当前准确理解应该是：

- 它仍然是一个正式配置字段
- 它仍然会持久化，也有设置页入口
- 它仍然会进入前端装配状态与配置摘要
- 但它现在**不会代替会话创建流程自动决定当前聊天智能体**

换句话说：

- 以前常见的“全局 agentName 就是聊天入口前提”已经不成立
- 当前真正的聊天智能体绑定发生在 `session/create` 之后

因此文档里更适合把它写成：

- assistant 行为偏好字段
- 兼容旧配置迁移时仍有价值的字段

而不是：

- 当前聊天 readiness 的硬门槛字段

### 4. `runtimeUrl`

这个字段也经常被旧文档写错。

当前更准确的说法是：

- 它是**开发态运行时覆盖地址**
- 只有宿主没有给出可用地址、且当前满足开发态条件时，才会被拿来当连接地址

因此现在不能再把它写成：

- 普通用户在发布态总要手填的正式后端地址

### 5. `model`

这个字段现在已经正式接入，而且已经有设置页入口。

当前它的工作方式是：

1. 设置页中的“后端模型”卡片把值写入 `backendExposed.model`
2. 主进程在组装下一次 Python runtime 启动参数时读取它
3. 如需要，会把它投影为 Python `--model`

它当前最重要的边界是：

- **保存后不会立刻切换当前运行中的后端模型**
- **需要重启整个程序，下一次 runtime 启动才会生效**

这也是为什么默认模型页里要把它和聊天面板中的模型选择器分开理解。

## 当前哪些字段已经形成“UI + 行为闭环”

可以直接分成两类看。

### 已有正式 UI，也已有明确行为闭环

- `theme`
- `animationsEnabled`
- `agentName`
- `runtimeUrl`
- `model`

但这 5 个字段里，又要继续细分：

- **立即影响前端界面**：`theme`、`animationsEnabled`
- **会影响宿主连接或配置摘要**：`agentName`、`runtimeUrl`
- **只会影响下一次后端启动**：`model`

### 当前不要混写的两组语义

#### `model` 不是聊天面板里的“本次发送模型”

聊天面板中的模型选择器用于 `message/send`，属于**请求级选择**。

而 `backendExposed.model` 属于：

- 宿主层的后端默认模型字段
- 下一次后端启动时才生效

#### `agentName` 不是当前会话绑定智能体

当前会话绑定智能体来自：

- 后端目录中的选项
- `session/create` 创建出来的 `boundAgent`

而不是：

- 配置中心中的全局 `agentName`

## 谁负责这些字段

### 主进程负责什么

主进程负责：

- 读取和写回分域配置文件
- 默认值归一化
- 首次读取时尝试 legacy migration
- 向 renderer 暴露公共快照与公共补丁
- 读取 `backendExposed.model` 并参与 runtime 启动参数组装

### Renderer 负责什么

renderer 负责：

- 读取公共快照
- 在设置页提供正式入口
- 订阅快照更新后同步 UI
- 在连接状态装配时消费 `runtimeUrl`、`agentName`

不过当前对连接判断真正关键的，是可用的 `runtimeUrl`，不是全局 `agentName`。

### Python runtime 负责什么

Python runtime 继续负责：

- 解释 CLI 参数、环境变量和默认值
- 提供本地 HTTP 服务
- 维护会话与消息历史

它当前**不会直接读取**配置中心分域文件。

## 旧 `copilot-settings.json` 现在还剩什么语义

当前准确说法只有一条：

- 它现在主要是主进程内部的迁移输入源

这意味着：

- renderer 侧旧 `copilot settings` 语义已经退场
- 统一配置中心才是当前正式主入口
- 旧文件仍然保留，是为了从历史版本迁移旧字段

因此不要再把它写成：

- renderer 当前正式读写入口
- 长期双写配置外观

## 当前还没有纳入统一配置中心的范围

下面这些内容虽然很多已经有界面，但当前还不能写成“已进入正式配置闭环”：

- 模型服务商中的大多数服务商信息与模型清单编辑
- 默认模型页里的主助手模型 / 快速执行模型路由下拉框
- 常规设置中的语言、代理、通知、自动备份
- 显示设置中的字号、界面密度
- 数据、MCP、搜索、记忆、文档处理页的大多数字段
- API 服务器页中的后端地址、重连策略、健康检查轮询

所以判断一项配置是否已经落地，不能看页面外观，而要看它有没有进入这条正式链路：

- 配置中心分域文档
- 公共快照 / 公共补丁
- 明确的生效行为

## 当前不要再写成这些说法

下面这些说法当前都不准确：

- “显示设置里只有主题接入了正式配置。”
- “`model` 还没有正式 UI 入口。”
- “`agentName` 仍然是聊天 readiness 的必需字段。”
- “`runtimeUrl` 是发布态默认连接方式。”
- “旧 `copilot-settings.json` 仍然是 renderer 正式接口。”
- “Python runtime 会直接读取统一配置中心文件。”

## 相关文档

- [前端分册入口](./README.md)
- [前端现在怎样连接后端](./backend-connection-contract.md)
- [前端运行时状态参考](./reference-runtime-states.md)
- [前端当前 UI 状态说明](./ui-current-state.md)
- [系统架构总览](../system/architecture-overview.md)
- [后端运行与配置](../backend/run-and-config.md)

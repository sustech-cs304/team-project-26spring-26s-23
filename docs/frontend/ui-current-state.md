---
title: 前端当前 UI 状态说明
description: 说明 Electron renderer 中当前已落地的界面结构、统一配置中心接入点与聊天入口状态。
sidebar_position: 6
sidebar_label: UI 当前状态
---

# 前端当前 UI 状态说明

本文档描述 Electron renderer 中当前用户实际能看到和操作的内容，重点回答两个问题：

- 统一配置中心已经在界面里接到了哪里
- 当前哪些地方已经有真实运行行为，哪些地方仍然只是前端交互或页面骨架

## 应用启动与 Bootstrap 阶段

### 启动流程

应用启动由 `CopilotAppRoot` 统一协调，经历以下阶段：

1. **配置装配阶段**（`status: 'loading'`）
   - 显示 `BootstrapScreen` 加载屏
   - 根层并行读取：
     - 配置中心公共快照
     - hosted runtime 快照
   - 然后把两者归并成当前 bootstrap 状态

2. **本地后端启动阶段**（`status: 'starting'`）
   - 显示“正在连接本地服务…”
   - Electron 主进程正在启动 hosted backend

3. **Provider 注入阶段**（connectable 状态下）
   - 按需懒加载 `@copilotkit/react-core`
   - 只有当前连接信息完整时，才会注入 CopilotKit Provider

4. **工作台加载阶段**
   - 懒加载工作台壳层 `App.tsx`
   - 使用统一的 `BootstrapScreen` 作为 fallback

### 启动失败场景

根层当前会统一处理启动失败，避免无解释白屏：

- **配置读取失败**（`status: 'error'`）：显示“运行态装配失败”，提供重试按钮
- **Provider 注入失败**：显示“Copilot Provider 注入失败”，可重试或暂时进入无 Provider 工作台
- **工作台加载失败**：由 `RecoverableErrorBoundary` 捕获，显示“工作台壳层加载失败”

## 工作台主界面结构

### 整体布局

工作台由 `App.tsx` 提供，采用左侧图标栏 + 主内容区布局：

```
┌─────┬──────────────────────────────────┐
│ 图  │                                  │
│ 标  │        工作区主内容区            │
│ 栏  │                                  │
└─────┴──────────────────────────────────┘
```

### 图标栏（Rail）

左侧垂直图标栏提供工作区切换：

**主要区域**：
- 助手（Assistant）
- 能力（Capabilities）
- 文件（Files）

**次要区域**：
- 开发（Developer）
- 设置（Settings）

所有工作区都已经有独立入口，但成熟度并不相同。

## 主题切换

当前主题切换已经不只是前端本地状态，而是统一配置中心里最完整的一条 UI 闭环。

### 当前行为

- App 启动时会从配置中心公共快照读取当前主题
- 当前只支持 `light` / `dark` 两种主题
- 主题通过 `document.documentElement.dataset.theme` 应用到全局
- 设置页的“显示设置”分区提供正式主题入口
- 切换主题时会先本地应用，再通过配置中心公共补丁持久化
- 如果写入失败，会回滚到旧主题
- 如果其他地方更新了主题，App 也会通过公共快照订阅收到同步更新

### 当前边界

下面这些显示类字段当前还没有纳入统一配置中心：

- 字号
- 界面密度
- 微动画开关

所以显示设置现在是“**主题已正式接入，其他显示项仍主要是本地交互**”。

## 助手工作区（Assistant Workspace）

### 布局结构

`AssistantWorkspace` 当前仍采用三栏布局：

```
┌──────────┬──────────┬────────────────────┐
│ 智能体   │  话题列  │   聊天主内容区     │
│ 类型列   │          │                    │
└──────────┴──────────┴────────────────────┘
```

### 左侧两栏

- 智能体类型列表当前仍是前端静态项
- 话题列表当前仍是前端静态项
- “新建话题”按钮当前仍为占位

因此，左侧两栏现在还不是统一配置中心的承载位置。

### 聊天主内容区

右侧聊天区由 `CopilotChatPanel` 提供。

当前它会直接消费根层已经归并好的 bootstrap 状态，而不是自己重复读取配置。

## 聊天面板状态与行为

### 状态指示器

聊天面板顶部当前会区分：

- `loading`
- `empty`
- `incomplete`
- `starting`
- `ready`
- `failed`
- `degraded`
- `error`

这些状态里，和统一配置中心关系最直接的是：

- `agentName`
- `runtimeUrl`

它们当前都来自配置中心公共快照，再和 hosted runtime 快照一起决定最终连接状态。

### 未连接状态（`empty` / `incomplete`）

会显示 `NotConnectedNotice`：

- **`empty`**：既没有宿主提供的可用地址，也没有 dev override，且 `agentName` 缺失
- **`incomplete`**：已读取到部分信息，但仍缺少 `runtimeUrl` 或 `agentName`

这些状态下不会挂载聊天区域。

### 启动中状态（`starting`）

会显示：

- 宿主正在启动本地后端
- 当前 hosted 状态、模式、runtime 来源等诊断摘要

### 启动失败状态（`failed`）

会显示：

- 宿主启动失败的说明
- 最小失败摘要
- “重试启动宿主后端”按钮（仅在失败可重试时可用）

### 降级状态（`degraded`）

会显示：

- 宿主已经降级的提示
- 失败摘要与诊断信息
- 但如果仍保留可用 runtime URL，聊天区域依然可挂载

### 就绪状态（`ready`）

会显示：

- 当前 Runtime URL
- Runtime 来源（宿主管理 / 开发态 override）
- Agent 名称
- Agent 来源（配置中心 / 缺失）
- 存储状态
- 运行模式

### 当前对统一配置中心的依赖

聊天入口当前真正依赖的配置中心字段只有：

- `assistantBehavior.agentName`
- `hostConfig.runtimeUrl`

其中：

- `agentName` 缺失时，哪怕宿主已经 ready，UI 仍会落到 `incomplete`
- `runtimeUrl` 只有在开发态 fallback 场景下才会使用配置中心里的 override 值

## Hub 工作区（Capabilities / Files / Developer）

`HubWorkspace` 为能力、文件、开发三个工作区提供统一占位布局。

### 当前成熟度

- 主要仍是静态展示内容
- 有独立入口和页面结构
- 还没有真实数据回流
- 当前不属于统一配置中心正式接入点

因此这三页目前更适合被理解为“结构雏形”，而不是“已经接上配置中心或后端的业务页”。

## 设置工作区（Settings Workspace）

设置工作区是当前最容易被误解的地方。

它现在已经不是“全部都只是本地 state”，但也远没有“整页都已正式接入”。

更准确的理解是：**设置页已经开始承载统一配置中心正式入口，但当前只接入了一小部分关键字段。**

### 设置分类

左侧导航当前包括：

- 模型服务商（Model Service）
- 默认模型（Default Model）
- 常规设置（General）
- 显示设置（Display）
- 数据设置（Data）
- MCP 服务器（MCP）
- 搜索设置（Search）
- 全局记忆（Memory）
- API 服务器（API）
- 文档处理（Docs）

### 当前已经接入统一配置中心的 UI

#### 1. 显示设置：主题

- 主题下拉框已经接到统一配置中心
- 当前会真实影响工作台主题
- 是当前最完整的“设置页改动 → 持久化 → UI 生效”闭环

#### 2. 常规设置：Assistant 行为配置卡片

- 已提供 `agentName` 的正式设置入口
- 保存后会写入 `assistant-behavior` 域
- 会直接影响聊天 bootstrap 状态

#### 3. API 服务器：宿主配置卡片

- 已提供 `runtimeUrl` 的正式设置入口
- 保存后会写入 `host-config` 域
- 当前语义是**开发态运行时覆盖地址**
- 同页还会显示根层 bootstrap 摘要和统一重试动作

### 当前仍主要是本地交互的 UI

下面这些分区虽然交互完整，但大多数仍主要停留在前端本地 state：

- 模型服务商
- 默认模型
- 常规设置中的语言 / 代理 / 通知 / 备份
- 显示设置中的字号 / 密度 / 动画
- 数据设置
- MCP
- 搜索
- 记忆
- API 服务器中的“后端地址”“重连策略”“健康检查轮询”占位项
- 文档处理

所以现在不能把设置页写成“全部都已经由统一配置中心驱动”。

### API 服务器页面当前应怎样理解

“API 服务器”页现在混合了两类内容：

1. **已经接入正式链路的内容**
   - `runtimeUrl` 配置卡片
   - 根层 bootstrap 状态摘要
   - 根层统一 retry 动作

2. **仍然只是占位或未来方向的内容**
   - 后端地址输入框
   - 重连策略
   - 健康检查轮询开关

因此这页当前最准确的说法是：

- 已经开始承载宿主配置与状态说明
- 但还不是完整的 API 配置产品页

## 错误边界与恢复机制

### RecoverableErrorBoundary

当前在多个层级提供错误捕获：

1. 根层工作台加载
2. 工作区切换
3. 聊天区域挂载

目标仍然是：

- 不出现无解释白屏
- 给出清晰的错误信息
- 提供可操作的恢复路径

## 当前能力边界总结

### 已经成立的 UI 事实

- ✅ 工作台壳与多工作区结构已稳定
- ✅ 根层统一装配 bootstrap 状态
- ✅ 聊天面板按连接状态渲染不同界面
- ✅ 设置页已有统一配置中心正式入口
- ✅ `theme`、`agentName`、`runtimeUrl` 已在界面中形成正式入口
- ✅ 主题切换已即时生效并持久化
- ✅ 配置中心公共快照更新已能影响当前界面状态

### 当前还不能夸大的地方

- ⚠️ 设置页大多数字段仍未进入统一配置中心
- ⚠️ `model` 虽已在配置中心中存在，但当前没有正式 UI 入口
- ⚠️ API 服务器页中很多表单仍是占位
- ⚠️ 左侧助手类型和话题列表仍是静态数据
- ⚠️ capabilities / files / developer 仍主要是结构占位页

## 相关文档

- [前端分册入口](./README.md)
- [当前生效字段参考](./reference-current-fields.md)
- [前端现在怎样连接后端](./backend-connection-contract.md)
- [前端运行时状态参考](./reference-runtime-states.md)
- [会话与状态模型](../system/session-and-state-model.md)
- [后端运行与配置](../backend/run-and-config.md)

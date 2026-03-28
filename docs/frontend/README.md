---
title: 前端分册入口
description: 前端正式文档入口，帮助读者理解当前桌面前端、统一配置中心、session-first 聊天主路径和设置页现状。
sidebar_position: 1
sidebar_label: 总览
---

# 前端分册入口

如果你只打算先读一篇前端总览，建议先看这篇。

它主要回答这些问题：

- 当前桌面前端到底负责什么。
- 统一配置中心现在已经落到什么程度。
- 聊天主路径为什么已经不再是早期的全局 agent 方案。
- 设置页里哪些内容已经进入正式链路，哪些还只是页面交互。
- 现在应该去哪里找相关实现。

## 先用一句话认识当前前端

当前前端不是通用浏览器里的网页，而是一个运行在 Electron 桌面宿主中的 React renderer。

它现在最重要的三条主线是：

1. **统一配置中心**：前端偏好、宿主连接信息和后端默认模型已经进入一套正式持久化系统。
2. **session-first 聊天壳**：聊天不再依赖“全局选一个 agent”，而是先看后端目录、再建会话、再按请求选择模型和工具。
3. **工作台 UI 收敛**：启动页主题、聊天面板布局、模型选择器、工具选择器、设置页入口都已经形成当前外观。

## 当前前端负责什么

### 1. 承载桌面工作台

当前前端提供：

- 左侧主图标栏
- 助手工作区
- 设置工作区
- 能力、文件、开发三个扩展工作区

其中，真正接近主路径的仍然是：

- 助手工作区
- 设置工作区

### 2. 消费主进程暴露的最小能力

renderer 现在不会自己直接读底层配置文件，也不会直接拿到 Python 启动参数、日志文件或任意文件系统访问能力。

它当前主要通过 preload 消费：

- 配置中心公共快照
- 配置中心公共补丁
- 配置中心公共快照更新订阅
- hosted runtime 快照
- runtime retry 动作

### 3. 负责当前聊天 UI 主路径

当前聊天主路径已经变成：

1. 先确认有可用 runtime URL。
2. 从后端拉智能体目录。
3. 选择一个智能体。
4. 创建会话。
5. 读取这个会话的能力面。
6. 发送消息时，再显式给出本次模型和工具选择。

这和早期文档里常见的“全局 agentName + 直接开聊”已经不是一回事了。

### 4. 承载已经正式接入的设置入口

设置页现在已经不只是静态表单。

当前已进入正式链路的字段包括：

- `theme`
- `animationsEnabled`
- `agentName`
- `runtimeUrl`
- `model`

但这些字段的作用并不一样：

- `theme` 和 `animationsEnabled` 直接影响前端显示。
- `runtimeUrl` 是开发态运行时覆盖地址。
- `model` 是宿主投影给后端 runtime 的默认模型字段。
- `agentName` 仍然保留在配置中心里，但当前聊天 readiness 已不再以它为硬门槛。

## 现在系统是怎么工作的

### 问题 1：配置现在从哪里来

答案是：**从主进程统一配置中心来。**

当前已经不是 renderer 直接围着旧 `copilot settings` 语义读写，而是：

1. 主进程读取按域拆分的 JSON 文档。
2. 如新文档还不存在，再尝试从旧 `copilot-settings.json` 迁移可用字段。
3. 主进程把可公开部分整理成公共快照。
4. renderer 只消费这份公共快照。

### 问题 2：聊天现在靠什么进入可用状态

答案是：**先看有没有可用 runtime URL，再继续走 session-first 链路。**

当前前端根装配层会把：

- 配置中心公共快照
- hosted runtime 快照

合并成 bootstrap 状态。

这里当前真正影响 connectable 的关键条件，是有没有可用的 runtime URL。`agentName` 虽然仍然存在于配置中心中，但不再阻止助手工作区继续进入“目录 → 会话 → 消息”的主路径。

### 问题 3：聊天为什么叫 session-first

因为现在系统把三件事拆开了：

- **后端目录**告诉前端有哪些智能体。
- **会话**决定当前绑定的是哪个智能体。
- **消息请求**决定本次使用哪个模型、哪些工具。

这样做的结果是：

- 智能体目录以后台返回为准。
- 会话切换有了明确的边界。
- 模型选择器和工具选择器真正进入了消息级策略，而不是只停留在页面装饰层。

## 现在应该怎么读设置页

### 已经接上正式链路的部分

优先看这几块：

1. **显示设置**
   - 主题切换已持久化并立即生效。
   - 微动画开关已持久化并立即生效。

2. **常规设置**
   - `agentName` 已接入配置中心。
   - 但它现在更适合作为 assistant 偏好字段理解，而不是聊天必填项。

3. **默认模型**
   - 已提供后端默认模型卡片，对应 `backendExposed.model`。
   - 保存后需要重启整个程序，下一次后端启动才会吃到新的默认模型。

4. **API 服务器**
   - 已提供开发态 `runtimeUrl` 正式入口。
   - 同页会展示根装配层状态摘要和统一 retry 动作。

### 仍然主要是本地交互的部分

设置页里大量表单目前还只是前端交互，例如：

- 模型服务商编辑器
- 默认模型路由下的主助手模型 / 快速执行模型下拉框
- 字号和界面密度
- 数据、MCP、搜索、记忆、文档处理页面的大多数字段
- API 页面中的后端地址、重连策略、健康检查轮询

所以不能因为页面已经做得很完整，就把所有字段都写成正式配置事实。

## 当前 UI 已经发生了哪些关键变化

### 1. 启动页主题已经先于 React 主界面生效

启动时会先根据系统主题给出一个浅色或深色的兜底外观，然后再用配置中心里的正式主题覆盖。

这意味着：

- 冷启动时不再总是固定白底。
- 夜间模式现在已经进入正式启动体验，而不是工作台渲染完以后才切。

### 2. 助手工作区已经是 session-first 三栏布局

当前三栏分别是：

- 左侧：后端智能体目录
- 中间：当前窗口内存中的会话创建与切换列表
- 右侧：聊天面板

这里和旧文档最不同的地方是：

- 智能体列表不再写成前端静态真源。
- 中间列也不再是纯占位，它已经承担建会话和切换会话的动作。

### 3. 聊天面板已经有现代化的消息区和输入区布局

当前聊天区已经包括：

- 可滚动消息流
- 空会话占位提示
- 底部粘性输入区
- 发送按钮
- 模型选择器
- 工具选择器

### 4. 模型选择器与工具选择器都已经进入当前主界面

但它们的语义不同：

- **模型选择器**：当前是前端维护的请求级模型选择 UI，用于 `message/send`。
- **工具选择器**：当前读取会话能力面返回的工具目录，用于 `message/send` 的 `enabledTools`。

不要把它们和设置页里的 `backendExposed.model` 混为一谈。

## 当前最值得优先看的实现位置

### 前端入口与装配

- `frontend-copilot/src/main.tsx`
- `frontend-copilot/src/CopilotAppRoot.tsx`
- `frontend-copilot/src/App.tsx`

### 统一配置中心相关

- `frontend-copilot/electron/config-center/`
- `frontend-copilot/src/features/copilot/config-center.ts`
- `frontend-copilot/src/workbench/theme-config.ts`
- `frontend-copilot/src/workbench/animation-config.ts`

### 运行时与连接状态相关

- `frontend-copilot/electron/runtime/`
- `frontend-copilot/src/features/copilot/config.ts`
- `frontend-copilot/src/features/copilot/runtime.ts`

### 聊天主路径相关

- `frontend-copilot/src/workbench/assistant/AssistantWorkspace.tsx`
- `frontend-copilot/src/features/copilot/chat-contract.ts`
- `frontend-copilot/src/features/copilot/CopilotChatPanel.tsx`
- `frontend-copilot/src/features/copilot/components/ModelPicker.tsx`
- `frontend-copilot/src/features/copilot/components/ToolPicker.tsx`

### 设置页相关

- `frontend-copilot/src/workbench/settings/SettingsWorkspace.tsx`
- `frontend-copilot/src/workbench/settings/ConfigCenterPublicFieldCards.tsx`

## 推荐阅读顺序

### 如果你想先看配置中心现在到底做到哪一步

1. [当前生效字段参考](./reference-current-fields.md)
2. [前端现在怎样连接后端](./backend-connection-contract.md)
3. [前端运行时状态参考](./reference-runtime-states.md)

### 如果你想先看当前 UI 长什么样、哪些已经接上正式链路

1. [前端当前 UI 状态说明](./ui-current-state.md)
2. [页面能力参考](./reference-page-capabilities.md)
3. [已实现、占位与下一步](./roadmap-and-placeholders.md)

### 如果你想跨层理解聊天和配置

1. [系统架构总览](../system/architecture-overview.md)
2. [聊天运行时契约](../system/chat-runtime-contract.md)
3. [会话与状态模型](../system/session-and-state-model.md)
4. [后端运行与配置](../backend/run-and-config.md)

## 阅读这组文档时的一个提醒

当前最容易误判的地方有两个：

1. **不要把旧 renderer 侧 `copilot settings` 当成现行主入口。**
2. **不要把设置页里所有看起来完整的表单都当成已经生效的正式配置。**

先看配置中心正式字段、再看聊天主路径、最后再看占位页面，最容易读清当前系统事实。

---
title: 前端分册入口
description: 前端正式文档入口，帮助读者快速理解当前桌面前端、session-first 聊天主路径，以及公开配置中心与 settings workspace 的分层现状。
sidebar_position: 1
sidebar_label: 总览
---

# 前端分册入口

如果你只准备先读一篇前端文档，建议从这里开始。

这篇总览主要帮助读者快速建立四个认识：

1. 当前前端到底是什么形态。
2. 现在有哪些正式持久化层。
3. 聊天入口为什么已经变成 session-first。
4. 设置页最近一轮收敛之后，页面重点落在什么地方。

## 先用一句话认识当前前端

当前前端是一个运行在 Electron 宿主中的 React renderer。

今天再描述它，最值得先抓住的主线有三条：

1. **聊天主路径已经稳定成 session-first。**
2. **设置页已经形成公开配置中心与 settings workspace 两层正式持久化。**
3. **当前 UI 已经完成一轮明显收敛，页面分区和入口都比早期版本更清晰。**

## 当前前端有哪些正式持久化层

理解前端现状时，先把持久化层分开，会比直接看页面更容易建立整体认识。

### 第一层：公开配置中心

这一层负责少量、公开、需要进入系统主链路的字段。

它当前的特点是：

- 按域拆分成多份 JSON 文档
- 主进程负责读取、归一化和迁移
- renderer 通过公共快照、公共补丁和更新订阅消费它
- 当前公开字段数量仍然比较克制

目前这层最值得记住的字段包括：

- `theme`
- `animationsEnabled`
- `agentName`
- `runtimeUrl`
- `model`

阅读这些字段时，可以先把它们看成“公开配置接口中的关键入口”。其中：

- `theme` 直接影响启动壳与工作台主题
- `runtimeUrl` 直接参与当前连接判断
- `agentName` 仍保留为 assistant 偏好字段
- `model` 继续作为宿主公开给后端的默认模型字段存在

### 第二层：settings workspace 专用持久化

这一层是当前设置页最重要的新增认识。

设置工作区已经拥有自己的正式持久化层，至少包括：

- 普通状态文档
- secret 文档

它承载的范围比公开配置中心更大，覆盖：

- `SUSTech 信息`
- 模型服务商列表与模型清单
- 默认模型路由
- 常规、数据、MCP、搜索、记忆、文档处理等页面的大量字段
- provider API key、CAS 密码等 secret 字段
- `外部源` 页中的 WakeUP 分享链接

从阅读角度看，可以把这层理解成“设置工作区自己的正式存储层”。它回答的是：设置页里这些更丰富的工作区字段，现在记到哪里去。

### 第三层：运行态与窗口内状态

除了配置文档，前端还有一层非常重要的运行态信息，例如：

- 根层 bootstrap 状态
- hosted backend 状态
- 当前窗口内的会话列表

这一层主要服务当前界面与聊天过程本身，帮助前端判断：

- 能否连上后端
- 是否已经具备继续创建会话和发送消息的条件

## 当前聊天入口为什么叫 session-first

当前聊天主路径可以按下面的顺序理解：

1. 先确认有可用 runtime URL。
2. 从后端拉智能体目录。
3. 选择一个智能体。
4. 创建会话。
5. 读取这个会话的能力面。
6. 发送消息时，再给出本次模型和工具选择。

这个结构带来了三点很直观的变化：

- **智能体目录以后台返回为准。**
- **会话成为聊天体验里的清晰边界。**
- **模型选择器与工具选择器真正进入了消息发送过程。**

因此今天理解聊天入口时，更适合从“目录 → 会话 → 消息”这条路径切入。

## 当前聊天 UI 已经收敛成什么样

### 1. 启动页主题已经进入正式体验

当前启动时会先根据系统主题给出浅色 / 深色兜底外观，再用正式主题覆盖。

同时，启动壳完成首屏绘制后，窗口再进入显示阶段。

从用户体验角度看，这意味着：

- 冷启动时可以更自然地进入当前主题
- 启动壳与工作台之间的主题体验已经连成一体

### 2. 助手工作区已经稳定成三栏结构

当前三栏分别是：

- 左侧：后端智能体目录
- 中间：会话创建与切换列
- 右侧：聊天主内容区

中间列已经承担：

- 创建会话
- 切换会话
- 排序会话
- 打开会话右键菜单

### 3. 聊天发送区已经成为完整 composer

当前聊天区已经包括：

- 可滚动消息流
- 空会话占位
- 底部输入区
- 模型选择器
- 工具选择器
- 发送按钮
- 输入区高度调节

其中：

- **模型选择器**支持搜索、标签筛选和分组展示
- **工具选择器**支持搜索、全选、反选和推荐工具集

## 现在应该怎样理解设置页

设置工作区已经形成一组稳定导航，当前左侧分区包括：

- `SUSTech 信息`
- `模型服务`
- `默认模型`
- `常规设置`
- `显示设置`
- `数据设置`
- `MCP 服务器`
- `网络搜索`
- `全局记忆`
- `API 服务器`
- `文档处理`
- `外部源`

这组导航本身就能帮助读者建立一个整体画面：设置页已经覆盖前端工作区中的大部分长期设置，并开始把公开配置入口与工作区专用状态放进同一套稳定布局中。

### 当前最值得优先认识的几个设置页变化

#### 常规页现在聚焦基础偏好

当前常规页主要承载：

- 界面语言
- 代理模式
- 助手消息通知
- 自动备份

因此它更像一个面向工作区使用习惯的基础偏好页。

#### 显示页现在聚焦主题

当前显示页中的可见主入口是：

- 主题

这让显示页的角色变得很清晰：它当前主要承担主题外观入口。

#### 默认模型页现在聚焦模型路由

当前默认模型页中的核心内容是：

- 主助手模型
- 快速执行模型

因此这页更适合作为“默认模型路由页”来阅读。

#### 模型服务页已经进入成熟工作区形态

当前模型服务页已经支持：

- 服务商搜索
- 右键菜单
- 复制服务商
- 删除服务商
- 拖动排序
- 无服务商时的空状态
- provider secrets 回填
- 模型列表管理与模型编辑弹层

它已经是设置工作区里最成熟的一部分之一。

#### 新页面入口已经补齐

当前还值得特别记住两个已经出现的页面：

- `SUSTech 信息`
- `外部源`

其中 `外部源` 已经包含 WakeUP 链接解析入口，后续会继续承载外部来源接入逻辑。

## 最近一轮最重要的 UI 收敛，可以怎样概括

如果只想抓最关键的变化，可以先记住下面这些：

1. **启动页已经纳入正式主题体验。**
2. **聊天入口已经稳定成 session-first 三栏壳。**
3. **模型选择器与工具选择器已经进入消息发送主路径。**
4. **设置页已经扩展为更大的 settings workspace。**
5. **`SUSTech 信息`、`外部源`、WakeUP 解析入口都已经出现。**
6. **常规页、显示页和默认模型页的页面职责都比早期版本更清晰。**

## 现在最值得优先看的实现位置

### 配置与持久化

- `frontend-copilot/electron/config-center/`
- `frontend-copilot/electron/settings-workspace/`
- `frontend-copilot/src/features/copilot/config-center.ts`

### 聊天主路径

- `frontend-copilot/src/workbench/assistant/AssistantWorkspace.tsx`
- `frontend-copilot/src/features/copilot/CopilotChatPanel.tsx`
- `frontend-copilot/src/features/copilot/components/ModelPicker.tsx`
- `frontend-copilot/src/features/copilot/components/ToolPicker.tsx`

### 设置工作区

- `frontend-copilot/src/workbench/settings/SettingsWorkspace.tsx`
- `frontend-copilot/src/workbench/settings/ProviderProfileList.tsx`
- `frontend-copilot/src/workbench/settings/ProviderProfilesSection.tsx`
- `frontend-copilot/src/workbench/settings/workspace-state.ts`

## 推荐阅读顺序

### 如果你想先弄清“字段到底存到哪里”

1. [当前生效字段参考](./reference-current-fields.md)
2. [页面能力参考](./reference-page-capabilities.md)
3. [前端运行时状态参考](./reference-runtime-states.md)

### 如果你想先看“当前界面到底长什么样”

1. [前端当前 UI 状态说明](./ui-current-state.md)
2. [页面能力参考](./reference-page-capabilities.md)
3. [已实现、占位与下一步](./roadmap-and-placeholders.md)

### 如果你想跨层看聊天与运行时

1. [系统架构总览](../system/architecture-overview.md)
2. [聊天运行时契约](../system/chat-runtime-contract.md)
3. [会话与状态模型](../system/session-and-state-model.md)
4. [后端运行与配置](../backend/run-and-config.md)

## 阅读这一组文档时，建议先带着两个问题

1. 当前这个页面或字段，属于公开配置中心，还是属于 settings workspace。
2. 当前这块内容，主要承担主路径能力，还是承担工作区持久化与结构承载。

只要沿着这两个问题往下读，当前前端的结构就会比较清楚。

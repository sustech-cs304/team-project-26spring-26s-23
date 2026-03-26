---
title: 前端当前 UI 状态说明
description: 说明 Electron renderer 中当前已落地的界面结构、启动阶段与聊天面板状态。
sidebar_position: 6
sidebar_label: UI 当前状态
---

# 前端当前 UI 状态说明

本文档描述 Electron renderer 中当前已落地的界面状态，帮助读者理解用户实际能在界面中看到和操作的内容。

## 应用启动与 Bootstrap 阶段

### 启动流程

应用启动由 [`CopilotAppRoot`](../../frontend-copilot/src/CopilotAppRoot.tsx) 统一协调，经历以下阶段：

1. **配置读取阶段**（`status: 'loading'`）
   - 显示 [`BootstrapScreen`](../../frontend-copilot/src/components/BootstrapScreen.tsx) 加载屏幕
   - 消息："正在准备桌面界面…"
   - 根层从 Electron preload 桥接读取运行态摘要

2. **后端启动阶段**（`status: 'starting'`）
   - 显示 BootstrapScreen 连接屏幕
   - 消息："正在连接本地服务…"
   - Electron 主进程正在启动 hosted backend

3. **Provider 注入阶段**（connectable 状态下）
   - 显示 BootstrapScreen 准备屏幕
   - 按需懒加载 `@copilotkit/react-core` 模块
   - 完成后注入 `CopilotKit` Provider

4. **工作台加载阶段**
   - 懒加载 [`App.tsx`](../../frontend-copilot/src/App.tsx) 工作台外壳
   - 显示 BootstrapScreen 准备屏幕作为 Suspense fallback

### 启动失败场景

根层统一处理启动失败，避免无解释白屏：

- **配置读取失败**（`status: 'error'`）：显示"运行态装配失败"错误屏，提供重试按钮
- **Provider 注入失败**：显示"Copilot Provider 注入失败"错误屏，提供重试或继续进入工作台选项
- **工作台加载失败**：由 [`RecoverableErrorBoundary`](../../frontend-copilot/src/components/RecoverableErrorBoundary.tsx) 捕获，显示"工作台壳层加载失败"错误屏

所有错误屏均使用 BootstrapScreen 组件，保持一致的错误呈现风格。

## 工作台主界面结构

### 整体布局

工作台由 [`App.tsx`](../../frontend-copilot/src/App.tsx) 提供，采用左侧图标栏 + 主内容区的经典布局：

```
┌─────┬──────────────────────────────────┐
│ 图  │                                  │
│ 标  │        工作区主内容区            │
│ 栏  │                                  │
└─────┴──────────────────────────────────┘
```

### 图标栏（Rail）

左侧垂直图标栏提供工作区切换：

**主要区域**（上方）：
- 助手（Assistant）：默认首屏工作区
- 能力（Capabilities）：Hub 工作区，展示占位内容
- 文件（Files）：Hub 工作区，展示占位内容

**次要区域**（下方）：
- 开发（Developer）：Hub 工作区，展示占位内容
- 设置（Settings）：设置工作区，提供可交互配置界面

所有图标栏按钮均可点击切换，切换时触发对应工作区的懒加载。

### 主题切换

工作台支持浅色/深色主题切换：
- 主题状态由 App 组件管理
- 通过 `document.documentElement.dataset.theme` 应用到全局
- 设置工作区提供主题选择下拉框

## 助手工作区（Assistant Workspace）

### 布局结构

[`AssistantWorkspace`](../../frontend-copilot/src/workbench/assistant/AssistantWorkspace.tsx) 采用三栏布局：

```
┌──────────┬──────────┬────────────────────┐
│ 智能体   │  话题列  │   聊天主内容区     │
│ 类型列   │          │                    │
└──────────┴──────────┴────────────────────┘
```

### 智能体类型列（左侧第一栏）

- 显示固定的智能体类型列表（General、Blackboard、TIS）
- 每个类型显示图标和标签
- 点击切换智能体类型，同时切换对应的话题列表

### 话题列（左侧第二栏）

- 显示当前智能体类型下的话题列表
- 顶部有"新建话题"按钮（当前为占位，无实际功能）
- 每个话题显示标题和更新时间
- 点击切换当前活跃话题

### 聊天主内容区（右侧）

由 [`CopilotChatPanel`](../../frontend-copilot/src/features/copilot/CopilotChatPanel.tsx) 提供，根据运行态状态显示不同内容。

## 聊天面板状态与行为

### 状态指示器

聊天面板顶部显示当前运行态状态：
- `loading`：读取中
- `empty`：未配置
- `incomplete`：配置缺失
- `starting`：启动中
- `ready`：已连接（绿色）
- `failed`：启动失败（红色）
- `degraded`：运行降级（黄色）
- `error`：读取失败（红色）

### 未连接状态（empty / incomplete）

显示 [`NotConnectedNotice`](../../frontend-copilot/src/features/copilot/components/NotConnectedNotice.tsx) 组件：

- **empty 状态**：
  - 标题："尚未获得可用运行时"
  - 说明当前既没有宿主运行时地址，也没有开发态覆盖地址
  - 列出缺失字段：Runtime URL、Agent 名称

- **incomplete 状态**：
  - 标题："连接信息仍不完整"
  - 说明宿主运行态与本地设置已读取，但缺少必需字段
  - 列出缺失字段

这些状态下不显示聊天区域，用户无法发送消息。

### 启动中状态（starting）

显示信息卡片：
- 标题："宿主正在启动本地后端"
- 说明 Electron 主进程正在托管 hosted backend
- 显示诊断详情网格（宿主状态、运行模式、Runtime 来源等）

### 启动失败状态（failed）

显示错误卡片：
- 标题："宿主启动后端失败"
- 说明未拿到可用的 hosted backend 运行地址
- 显示诊断详情网格
- 显示失败摘要（失败代码、阶段、消息、退出码等）
- 提供"重试启动宿主后端"按钮（仅当 `retryable: true` 时可用）

### 降级状态（degraded）

显示警告卡片 + 聊天区域：
- 标题："宿主运行态已降级"
- 说明 hosted backend 曾成功提供地址，但记录到异常退出或降级
- 显示诊断详情和失败摘要
- **聊天区域仍然可用**：若保留的 runtime URL 仍可连接，CopilotKit 继续使用

### 就绪状态（ready）

显示就绪卡片 + 聊天区域：
- 标题："Copilot 连接入口已就绪"
- 显示详细信息：
  - 当前 Runtime URL
  - Runtime 来源（宿主管理 / 开发态 override）
  - Agent 名称
  - Agent 来源（本地设置 / 未提供）
  - 存储状态
  - 运行模式

### 聊天区域（ConnectedChatSurface）

仅在 `ready` 和 `degraded` 状态下显示，提供完整聊天功能：

**元信息栏**：
- 显示当前 threadId（来自工作区选中的话题 ID）
- 显示连接可用性状态："聊天已连接" / "聊天连接中" / "回复生成中"

**消息流区域**：
- 空状态：显示"最小聊天已挂载"提示
- 用户消息：显示"You"标签 + 消息文本
- 助手消息：显示"Assistant"标签 + 消息文本
- 加载状态：显示"正在生成回复…"占位消息
- **错误消息**：以红色内联消息显示运行时错误（`copilot-chat__message--error`）

**输入区域**：
- 多行文本框（3 行）
- 占位符根据连接状态变化
- 发送按钮（连接中或加载时禁用）
- 底部提示：错误时显示修复提示，正常时显示"当前仅支持最小纯文本聊天 MVP"

### 错误呈现语义

聊天面板中的红色错误消息有两种来源：

1. **运行时错误**（bannerError）：
   - 来自 CopilotKit 的 `useCopilotContext().bannerError`
   - 显示在消息流中，标签为"运行时错误"
   - 例如：agent 执行失败、模型崩溃等
   - 用户可继续在当前线程重试

2. **聊天区域异常**：
   - 由 RecoverableErrorBoundary 捕获的渲染错误
   - 显示"聊天运行时错误"标签 + 错误消息
   - 提供"重新挂载聊天区域"按钮

这些错误不会导致整个面板崩溃，保持可解释的失败态。

## Hub 工作区（Capabilities / Files / Developer）

[`HubWorkspace`](../../frontend-copilot/src/workbench/hub/HubWorkspace.tsx) 为能力、文件、开发三个工作区提供统一的占位布局：

### 布局结构

```
┌──────────┬────────────────────────────┐
│  侧栏    │      主内容区              │
│          │                            │
└──────────┴────────────────────────────┘
```

### 当前成熟度

- **纯展示性占位**：所有内容均为静态占位数据
- 侧栏显示条目列表（无交互）
- 主内容区显示高亮卡片和条目网格（无交互）
- 不承载实际业务功能，仅用于演示布局结构

### 占位内容示例

- **Capabilities**：显示"工具能力"、"搜索能力"等占位条目
- **Files**：显示"项目文件"、"最近文档"等占位条目
- **Developer**：显示"调试工具"、"日志查看"等占位条目

## 设置工作区（Settings Workspace）

[`SettingsWorkspace`](../../frontend-copilot/src/workbench/settings/SettingsWorkspace.tsx) 提供可交互的设置界面，是当前成熟度最高的非聊天工作区。

### 布局结构

```
┌──────────┬────────────────────────────┐
│ 设置导航 │    设置主内容区            │
│  列      │                            │
└──────────┴────────────────────────────┘
```

### 设置分类

左侧导航列显示以下设置分类：
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

### 交互能力

**模型服务商页面**：
- 左右分栏布局，左侧列表 + 右侧详情
- 可搜索服务商、地址或模型
- 可添加自定义服务商
- 可编辑服务商基础信息（名称、协议、API 地址、密钥等）
- 可管理模型列表（添加、编辑、删除模型）
- 模型编辑器为模态弹层，支持键盘导航和焦点陷阱

**其他设置页面**：
- 提供真实可交互的表单控件
- 下拉选择框（SelectField）
- 文本输入框（TextField）
- 多行文本框（TextareaField）
- 开关按钮（ToggleSwitch）
- 所有控件均有 label、description 和占位符

**API 服务器页面**：
- 显示根层启动状态摘要
- 显示当前状态和重试动作状态
- 提供"重试读取运行态"按钮，调用根层统一的 retry 动作

### 持久化状态

**当前限制**：
- 所有设置值仅保存在组件 state 中
- 刷新页面后恢复为初始值
- 不与 Electron 主进程或本地存储同步

**未来方向**：
- 需要接入 Electron IPC 桥接
- 需要定义设置持久化契约
- 需要与后端配置系统对齐

## 错误边界与恢复机制

### RecoverableErrorBoundary

[`RecoverableErrorBoundary`](../../frontend-copilot/src/components/RecoverableErrorBoundary.tsx) 在多个层级提供错误捕获：

1. **根层工作台加载**：捕获 App 懒加载或渲染错误
2. **工作区切换**：捕获各工作区模块加载或渲染错误
3. **聊天区域挂载**：捕获聊天组件渲染错误

所有错误边界均提供：
- 清晰的错误消息展示
- 重试或回退操作按钮
- 通过 `resetKeys` 自动重置

### 错误呈现一致性

所有错误场景均遵循以下原则：
- 不出现无解释白屏
- 提供明确的错误原因
- 提供可操作的恢复路径
- 保持界面结构完整性

## 当前能力边界总结

### 可用聊天闭环

- ✅ 助手工作区的聊天面板
- ✅ 纯文本消息发送与接收
- ✅ 多话题切换（threadId 绑定）
- ✅ 运行时错误内联显示
- ✅ 连接状态实时反馈

### 占位或未完成区域

- ⚠️ Hub 工作区（Capabilities / Files / Developer）：纯展示占位
- ⚠️ 新建话题按钮：UI 已存在，无实际功能
- ⚠️ 设置持久化：仅内存状态，不保存到磁盘
- ⚠️ 智能体类型切换：UI 可切换，但所有类型共享相同后端 agent

### 已落地核心能力

- ✅ 根层统一运行态装配
- ✅ 启动失败可解释与可重试
- ✅ CopilotKit Provider 按需注入
- ✅ 工作区懒加载与错误恢复
- ✅ 主题切换
- ✅ 设置界面交互（内存状态）

## 相关文档

- [前端分册入口](./README.md)：前端文档导航
- [运行态状态参考](./reference-runtime-states.md)：详细状态字段说明
- [系统架构概览](../system/architecture-overview.md)：整体架构设计
- [运行时生命周期](../system/runtime-lifecycle.md)：启动与状态转换
- [聊天运行时契约](../system/chat-runtime-contract.md)：前后端 HTTP 契约

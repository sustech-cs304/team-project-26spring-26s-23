# 当前界面实现现状

## 文档目的

本文档用于说明当前 [frontend-copilot/src/App.tsx](../../frontend-copilot/src/App.tsx) 所承载的桌面前端界面骨架，重点区分以下几类状态：

- 已经具备结构与交互的界面部分
- 仅使用本地静态数据展示的部分
- 仅提供前端交互反馈、但尚未接入持久化或后端的部分
- 明确仍为占位的工作区与聊天区域

本文只描述当前代码已经体现的事实，不把演示性 UI 写成已完成业务功能。

## 整体工作区结构

当前主界面由左侧窄栏驱动整体工作区切换。可切换的工作区包括：

- `assistant`
- `capabilities`
- `files`
- `developer`
- `settings`

对应实现位于 [frontend-copilot/src/App.tsx](../../frontend-copilot/src/App.tsx:27) 与 [frontend-copilot/src/App.tsx](../../frontend-copilot/src/App.tsx:146)。

### 左侧窄栏的职责

左侧窄栏当前承担以下作用：

1. 在不同工作区之间切换
2. 将“设置”与其余主工作区分开摆放
3. 维持桌面应用整体的工作台导航感

其中：

- 主工作区入口包括“助手 / 能力 / 文件 / 开发”
- “设置”位于次级区域，作为独立工作区进入

这说明当前 UI 已经形成清晰的“工作台式”信息架构，而不是单页聊天界面。

## assistant 工作区

## 布局结构

`assistant` 是当前最完整的主工作区，采用三段布局：

1. 左列：助手类型列
2. 中列：话题 / 会话列
3. 右列：主内容区

相关主结构可见 [frontend-copilot/src/App.tsx](../../frontend-copilot/src/App.tsx:491) 附近及 [frontend-copilot/src/App.tsx](../../frontend-copilot/src/App.tsx:684)。

### 1. 助手类型列

当前助手类型为固定的三类：

- General
- Blackboard
- TIS

其定义位于 [frontend-copilot/src/App.tsx](../../frontend-copilot/src/App.tsx:155)。

这三类助手当前的特点是：

- 类型列表已实现可点击切换
- 每个类型带有名称、简短标识、说明与图标
- 类型本身是前端静态定义，不来自后端或配置中心

因此，当前“助手类型”属于**已实现的前端导航结构**，但**不是动态拉取的真实助手注册表**。

### 2. 话题 / 会话列

话题列表当前按助手类型分组显示，对应数据定义位于 [frontend-copilot/src/App.tsx](../../frontend-copilot/src/App.tsx:179)。

当前可以确认：

- 每类助手下都预置了若干会话项
- 每个会话项包含标题、摘要、更新时间与状态
- 会话状态包括 `active`、`idle`、`attention`
- 当前数据是本地静态常量，不是实时会话数据

因此，这一列已经具备“会话列表 UI 骨架”，但还没有接通真实会话存储、后端同步或聊天历史接口。

### 3. 右侧主内容区

右侧主内容区当前承载 [CopilotChatPanel()](../../frontend-copilot/src/features/copilot/CopilotChatPanel.tsx:18) 的渲染结果，挂载位置可见 [frontend-copilot/src/App.tsx](../../frontend-copilot/src/App.tsx:684)。

当前这里并不是已经完成的真实聊天窗口，而是一个**基于配置状态的说明与占位面板**。其行为见 [frontend-copilot/src/features/copilot/CopilotChatPanel.tsx](../../frontend-copilot/src/features/copilot/CopilotChatPanel.tsx:65)。

## Copilot 聊天区域当前状态

当前聊天区域会根据配置状态显示不同内容：

- `loading`：正在读取配置
- `empty`：未连接
- `incomplete`：配置不完整
- `ready`：骨架就绪
- `error`：读取失败

状态标签定义位于 [frontend-copilot/src/features/copilot/CopilotChatPanel.tsx](../../frontend-copilot/src/features/copilot/CopilotChatPanel.tsx:10)。

### 当前已实现的部分

当前聊天区域已实现：

- 启动时读取 Copilot 配置
- 根据配置状态切换不同面板内容
- 在 `ready` 状态下展示 `runtimeUrl`、`agentName` 与存储状态
- 在 `empty` / `incomplete` 状态下明确提示“尚未连接后端智能体”
- 在 `error` 状态下明确提示这是“读取配置失败”，与未配置不同

### 当前未实现的部分

当前聊天区域尚未实现：

- 基于 [@copilotkit/react-ui](../../frontend-copilot/package.json:14) 的真实聊天界面
- 消息列表
- 输入框驱动的真实对话请求
- 会话持久化
- 与后端运行时的真实交互反馈 UI

因此，当前右侧区域应理解为**聊天面板骨架**，而不是完整聊天产品能力。

## settings 工作区

## 独立布局特征

`settings` 工作区采用独立布局，不复用 assistant 工作区中的“助手类型 / 会话”语义。相关入口和分支可见 [frontend-copilot/src/App.tsx](../../frontend-copilot/src/App.tsx:689)。

当前设置工作区包含：

- 左侧设置导航列
- 右侧设置主内容区

设置导航项定义位于 [frontend-copilot/src/App.tsx](../../frontend-copilot/src/App.tsx:251)。当前包含以下分区：

- 模型服务
- 默认模型
- 常规设置
- 显示设置
- 数据设置
- MCP 服务器
- 网络搜索
- 全局记忆
- API 服务器
- 文档处理

### 设置页当前的交互现状

设置页内部大量交互已经具备前端点击与编辑反馈，包括：

- 服务商列表切换
- 新增服务商按钮
- 下拉选择
- 输入框编辑
- 文本域编辑
- 开关切换

这些交互主要由 [frontend-copilot/src/App.tsx](../../frontend-copilot/src/App.tsx:809) 中的本地 React state 驱动。

### 哪些内容只是本地前端状态

根据当前实现，设置页中的大量字段虽然“可点击、可切换、可输入”，但多数仍属于本地 React state，包括但不限于：

- 模型服务商列表及其详情字段
- 默认模型选择
- 常规设置中的语言、代理与通知类选项
- 显示设置中的主题、字号、动画类选项
- 数据、MCP、搜索、记忆、API、文档处理等分区中的表单值

这意味着：

- 它们当前主要用于展示未来可配置能力的界面形态
- 它们不应被视为已经接通 Electron 持久化
- 更不应被视为已经形成与后端联调的正式契约

## 设置页中真正已接通底层链路的范围

当前真正已接通 Electron 配置持久化底层链路的 Copilot 字段只有：

- `runtimeUrl`
- `agentName`

这部分读取 / 保存桥接来自 [frontend-copilot/electron/preload.ts](../../frontend-copilot/electron/preload.ts:31) 与 [frontend-copilot/src/features/copilot/settings.ts](../../frontend-copilot/src/features/copilot/settings.ts:11)。

需要特别说明：即使设置工作区里出现了更多“API 服务器”“模型服务商”等字段，它们在当前代码中大多仍未形成已生效持久化链路。

## capabilities / files / developer 工作区

除了 `assistant` 与 `settings` 外，其余三个工作区当前均可进入，但本质上仍属于占位型工作区。

### capabilities

`capabilities` 工作区目前用于展示“能力中心”的信息架构，占位内容定义位于 [frontend-copilot/src/App.tsx](../../frontend-copilot/src/App.tsx:264)。

当前特征：

- 有标题、说明、亮点与条目列表
- 条目围绕 MCP、联网搜索、本地项目操作等主题组织
- 展示的是前端结构化说明，而非真实能力检测结果

### files

`files` 工作区当前用于展示“知识文件与资料入口”的概念布局，相关内容同样定义在 [frontend-copilot/src/App.tsx](../../frontend-copilot/src/App.tsx:295)。

当前特征：

- 展示课件目录、个人笔记区、对话附件等条目
- 用于表达未来文件工作区的组织方式
- 暂无真实文件索引、导入列表或后端数据接入

### developer

`developer` 工作区当前用于展示“开发工作台”的概念占位，其数据项定义位于 [frontend-copilot/src/App.tsx](../../frontend-copilot/src/App.tsx:325)。

当前特征：

- 重点表达后续开发调试与工具编排的工作区方向
- 暂无真实开发日志、运行状态、任务面板或调试结果接入

## 静态内容与可交互内容的边界

为了避免误解，当前界面可以按以下方式理解：

| 类别 | 当前状态 | 说明 |
| --- | --- | --- |
| 工作区切换 | 已实现 | 左侧窄栏可在多个工作区间切换 |
| 助手类型切换 | 已实现 | 可在 General / Blackboard / TIS 间切换 |
| 会话列表展示 | 静态展示 | 数据为本地常量，不是实时会话 |
| 聊天主区域 | 状态面板 | 依据配置状态显示说明，不是完整聊天 UI |
| 设置页表单交互 | 已实现前端交互 | 大量字段可编辑，但多数仅存在于本地 state |
| Copilot 连接字段持久化 | 已实现底层链路 | 当前仅确认 `runtimeUrl`、`agentName` 接通 Electron 存储 |
| capabilities / files / developer | 占位工作区 | 有结构化展示，但尚无真实数据能力 |

## 当前 UI 文档结论

当前前端界面最准确的描述是：

- 已完成桌面工作台的基础信息架构
- 已形成 assistant、settings 以及多个扩展工作区的整体布局
- 已提供较完整的设置页交互外观
- 已完成 Copilot 连接状态驱动的聊天面板骨架
- 但除 `runtimeUrl` 与 `agentName` 外，大多数设置和工作区数据仍未形成真实业务闭环

因此，当前界面适合用于：

- 明确产品信息架构
- 评审桌面端工作流
- 逐步接入真实后端与持久化能力

但不应将其解读为：

- 已完成真实聊天体验
- 已完成设置页所有配置项的正式生效
- 已完成能力中心、文件中心、开发工作台的真实功能实现

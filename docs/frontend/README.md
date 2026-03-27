---
title: 前端分册入口
description: 前端文档入口，汇总桌面前端职责、统一配置中心现状、页面成熟度与推荐阅读路径。
sidebar_position: 1
sidebar_label: 总览
---

# 前端分册入口

## 文档目标

本文档作为前端分册的权威入口，帮助读者快速回答下面几个问题：

- 当前桌面前端到底负责什么
- 统一配置中心现在已经做到哪一步
- 设置页里哪些内容已经接上正式链路，哪些还只是前端交互
- renderer、preload、main process 和 hosted runtime 现在怎样分工

如果你只看一篇前端总览，建议先看这篇。

## 前端子系统定位

当前前端不是通用浏览器里的单页应用，而是一个运行在 Electron 桌面宿主中的 React renderer。

它当前主要负责：

- 提供工作台界面和页面路由
- 通过 preload 消费主进程暴露的最小 IPC 能力
- 根据配置中心公共快照与 hosted runtime 快照，决定当前聊天入口是否可用
- 在连接条件满足时，把 `runtimeUrl` 与 `agentName` 交给 CopilotKit 挂载最小聊天链路
- 承载设置页，并逐步把真正需要长期生效的字段接入统一配置中心

## 前端快速上手

### 安装依赖

在 `frontend-copilot/` 目录执行：

```bash
cd frontend-copilot
npm install
```

### 启动开发环境

常用开发命令：

```bash
cd frontend-copilot
npm run dev
npm run dev -- -- --runtime-model test
npm run dev:hosted
```

当前开发态会优先尝试由 Electron 主进程托管本地 Python desktop runtime。

如果你要做最小联调，建议先记住这几个事实：

- 连接状态现在由“配置中心公共快照 + hosted runtime 快照”共同决定
- `runtimeUrl` 在当前实现里主要表示**开发态运行时覆盖地址**
- `agentName` 仍然是进入 `ready` / `degraded` 聊天入口的必需字段之一
- renderer 已经不再直接读取旧 `copilot-settings` 接口

### 构建、测试与检查

```bash
cd frontend-copilot
npm run build
npm run preview
npm run test
npm run lint
npx tsc --noEmit
```

如果你需要验证 bundled runtime staging，还可以执行：

```bash
cd frontend-copilot
npm run stage:bundled-runtime
```

## 先看统一配置中心当前事实

### 当前已经正式落地了什么

当前前端已经有一套正式可用的统一配置中心主链路：

1. **主进程**按域读取和写回配置文档。
2. **preload**向 renderer 暴露公共快照、公共补丁和公共快照订阅接口。
3. **renderer**不再依赖旧 renderer settings API，而是统一消费配置中心公共快照。
4. **设置页**已经接入一小部分真正生效的字段，而不是整页都还停留在占位阶段。

这条链路现在已经能支撑三类事实：

- 前端偏好持久化：`theme`
- 聊天 bootstrap 字段：`agentName`、`runtimeUrl`
- 一个最小的 runtime 投影样板：`model`

### 当前分域

当前统一配置中心按 4 个稳定域组织：

| 配置域 | 当前作用 | 当前字段 |
| --- | --- | --- |
| `frontend-preferences` | 前端显示偏好 | `theme` |
| `assistant-behavior` | assistant 使用行为 | `agentName` |
| `host-config` | 宿主持有的连接配置 | `runtimeUrl` |
| `backend-exposed` | 允许宿主安全投影给 runtime 的字段样板 | `model` |

这些域的重点不是“多拆几个文件”，而是把 owner、编辑权限和生效边界分开。

### 当前正式字段做到哪一步

| 字段 | 当前状态 | 说明 |
| --- | --- | --- |
| `theme` | 已有 UI、已持久化、已即时生效 | 设置页切换后会立即更新工作台主题，并写入配置中心 |
| `agentName` | 已有 UI、已持久化、已参与连接判断 | 缺失时 renderer 会落到 `incomplete` |
| `runtimeUrl` | 已有 UI、已持久化、已参与连接判断 | 当前主要作为开发态 override，而不是发布态默认主来源 |
| `model` | 已纳入配置中心与主进程投影逻辑，但暂无正式 UI | 不应写成“后端可暴露字段样板已经全面完成” |

### 当前还没有做到什么

下面这些内容现在还不能写成“已经纳入统一配置中心”：

- 设置页里大多数模型服务配置
- 默认模型页里的模型路由 UI
- 常规设置中的语言、代理、通知等字段
- 显示设置中的字号、密度、动画等字段
- 数据、MCP、搜索、记忆、文档处理页里的大多数表单项
- API 服务器页里“后端地址”“重连策略”“健康检查轮询”等占位项

换句话说，**设置页已经开始接统一配置中心，但还远没有全部收编完成。**

## 旧设置链路现在怎么理解

需要把下面两件事分开看：

1. **renderer 侧**：旧的 settings 读写 API 已经移除，renderer 现在只消费配置中心公共接口。
2. **main process 内部**：仍保留从旧 `copilot-settings.json` 迁移 `runtimeUrl` / `agentName` 的语义。

所以当前准确说法是：

- 旧设置格式仍有 **legacy disk migration** 价值；
- 但它已经不是 renderer 的正式接口，也不是未来长期配置外观。

## 现在设置页该怎么读

### 已经接上正式链路的部分

设置页当前最值得优先看的，是这三块：

1. **显示设置中的主题切换**
   - 现在已经走统一配置中心
   - 修改后会立即作用到工作台主题
   - 失败时会回滚，而不是只改内存状态

2. **常规设置中的 Assistant 行为配置卡片**
   - 当前提供 `agentName` 正式入口
   - 会直接影响聊天入口的 bootstrap 状态

3. **API 服务器页中的宿主配置卡片**
   - 当前提供 `runtimeUrl` 正式入口
   - 该字段当前语义是开发态 override
   - 同页还会显示根层 bootstrap 摘要和统一重试动作

### 仍然主要是前端本地交互的部分

其余大多数字段仍然主要是：

- 有页面结构
- 能输入、切换、选择
- 但还没有进入统一配置中心正式持久化闭环
- 也没有形成稳定的后端连接契约

因此读设置页时不要按“页面外观很完整”来判断是否已经落地。

## renderer / preload / main process / runtime 现在怎样分工

### 1. Main process

**代码位置**：`frontend-copilot/electron/`

主进程当前负责：

- 创建窗口、管理生命周期
- 维护统一配置中心主服务
- 维护 hosted runtime 启动、停止和重试
- 读取 `backend-exposed.model` 这类可投影字段，并参与 Python 启动参数组装
- 把配置中心公共快照更新广播给 renderer

### 2. Preload

**代码位置**：`frontend-copilot/electron/preload.ts`

preload 当前只暴露最小桥接面：

- 读取配置中心公共快照
- 订阅配置中心公共快照更新
- 发送配置中心公共补丁
- 读取 hosted runtime 快照
- 触发 runtime 重试

它不会把底层文件路径、spawn 参数或任意文件系统访问能力直接交给 renderer。

### 3. Renderer 根装配层

**代码位置**：`frontend-copilot/src/CopilotAppRoot.tsx`

根装配层当前负责：

- 统一读取 bootstrap 状态
- 在配置中心公共快照更新后重新计算 bootstrap 状态
- 决定是否加载 CopilotKit Provider
- 统一持有“重试读取运行态”的动作

这里的关键变化是：renderer 已不再自己维护一套旧设置读取入口，而是统一消费公共快照。

### 4. Runtime

**代码位置**：`frontend-copilot/electron/runtime/` 与 `backend/app/desktop_runtime/`

当前 runtime 仍保持原有 owner 分层：

- Electron 负责把宿主条件和可投影字段翻译成 Python 启动参数
- Python 侧继续负责解释运行参数并启动 HTTP 服务
- Python runtime 当前不会直接读取配置中心分域文件

这也意味着：统一配置中心新增的是**字段治理与宿主聚合层**，不是改写 Electron → Python 的 owner 分层。

## 前端组成部分

### 1. Electron 主进程层

- `main.ts`：主进程入口、统一配置中心服务接入、runtime 启停、IPC handlers 注册
- `renderer-ipc.ts`：注册 renderer 当前真正需要的 IPC 通道
- `config-center/`：统一配置中心 schema、存储路径、主进程服务、公共快照与公共补丁解析
- `runtime/`：hosted backend 启动配置、状态、诊断、日志与进程管理

### 2. Renderer 配置与聊天层

- `src/features/copilot/config-center.ts`：renderer 侧配置中心公共 API 封装
- `src/features/copilot/config.ts`：把 bootstrap fields 与 runtime 快照归并成最终连接状态
- `src/features/copilot/runtime.ts`：runtime 快照读取与重试封装
- `src/features/copilot/CopilotChatPanel.tsx`：按状态渲染聊天区域

### 3. 工作台与设置层

- `src/App.tsx`：工作台外壳与主题应用
- `src/workbench/theme-config.ts`：主题读取、保存与订阅
- `src/workbench/settings/ConfigCenterPublicFieldCards.tsx`：当前已接入统一配置中心的设置卡片
- `src/workbench/settings/SettingsWorkspace.tsx`：设置页工作区与各分区页面

## 当前已实现什么

### 已落地能力

- ✅ Electron 桌面工作台和多工作区结构
- ✅ Hosted Python runtime 启停与状态读取
- ✅ 配置中心分域存储与主进程聚合
- ✅ 公共快照 / 公共补丁 / 公共订阅桥接
- ✅ renderer 统一消费 bootstrap fields
- ✅ `theme`、`agentName`、`runtimeUrl` 的正式接入
- ✅ `model` 进入配置中心 schema 和主进程 runtime 投影链路
- ✅ 主题即时生效与失败回滚
- ✅ 配置变更后根装配层重新计算 bootstrap 状态

### 当前边界

- ⚠️ 不是完整配置管理产品：设置页大多数分区仍是本地交互
- ⚠️ 不是完整聊天产品：当前仍聚焦最小聊天主路径
- ⚠️ 不是“后端可暴露字段”完整落地：目前只有 `model` 一个样板字段接入到正式链路
- ⚠️ 不是 runtime 直接读配置文件：宿主 owner 分层仍然存在

## 推荐阅读顺序

### 如果你想先看统一配置中心做到哪一步

1. [当前生效字段参考](./reference-current-fields.md)
2. [前端现在怎样连接后端](./backend-connection-contract.md)
3. [前端当前 UI 状态说明](./ui-current-state.md)
4. [前端运行时状态参考](./reference-runtime-states.md)

### 如果你想理解跨层状态关系

1. [会话与状态模型](../system/session-and-state-model.md)
2. [运行时生命周期](../system/runtime-lifecycle.md)
3. [后端运行与配置](../backend/run-and-config.md)

### 如果你想评估还有哪些内容没接完

1. [页面能力参考](./reference-page-capabilities.md)
2. [已实现、占位与下一步](./roadmap-and-placeholders.md)

## 重要提醒

阅读当前前端文档时，请优先按下面的顺序判断事实：

1. 先看统一配置中心正式字段有没有接入
2. 再看这些字段有没有真正进入运行行为或界面行为
3. 最后再看设置页里还有哪些内容只是占位

这样最容易回答“现在这个配置系统到底做到哪一步了”。

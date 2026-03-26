# 当前生效字段参考

## 文档用途

这份附录专门用于回答一个很具体的问题：**现阶段前端里，哪些字段是真的会影响启动和连接判断，哪些只是界面上看起来像配置，但当前其实还没有生效。**

它适合在以下场景使用：

- 联调前确认当前最小字段范围
- 审查文档时核对“这是不是当前事实”
- 开发时快速确认字段的存储位置、读取时机和界面接入情况

## 使用边界

- 本文只记录当前代码里已经能确认的事实。
- 本文优先列出“真正生效的字段”，不会把设置页里的展示字段都算进去。
- 本文不补写后端 HTTP 细节，也不把未来规划字段写成当前实现。
- 如果你想看运行态而不是字段，请改看 [reference-runtime-states.md](./reference-runtime-states.md)。

## 核心表格

### 1. 当前真正生效的字段

| 字段名 | 当前作用 | 存储位置 | 读取时机 | 是否为进入 `ready` 的必填项 | 是否已接到界面 | 当前事实说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `runtimeUrl` | 指定前端准备交给 Copilot 外层能力的运行时地址 | Electron `userData/desktop-runtime/config/copilot-settings.json` | 应用启动阶段由根层统一读取 settings/runtime，并通过状态注入供子组件消费 | 是 | 否，当前设置页没有正式编辑入口；仅在聊天骨架的 `ready` 面板中展示根层注入结果 | 当前会被归一化、参与状态判断，并在 `ready` 时传入 Copilot 外层能力 |
| `agentName` | 指定前端准备使用的智能体名称 | Electron `userData/desktop-runtime/config/copilot-settings.json` | 应用启动阶段由根层统一读取 settings/runtime，并通过状态注入供子组件消费 | 是 | 否，当前设置页没有正式编辑入口；仅在聊天骨架的 `ready` 面板中展示根层注入结果 | 当前会被归一化、参与状态判断，并在 `ready` 时传入 Copilot 外层能力 |

### 2. 当前存储结构里实际存在的字段范围

| 范围 | 当前情况 | 说明 |
| --- | --- | --- |
| Electron 持久化配置对象 | 只有 `runtimeUrl`、`agentName` | 当前 [`frontend-copilot/electron/copilot-settings.ts`](../../frontend-copilot/electron/copilot-settings.ts) 中定义的配置结构只有这两个字段 |
| Renderer 读取后参与状态解析的字段 | 只有 `runtimeUrl`、`agentName` | 当前归一化和缺失判断只围绕这两个字段进行 |
| 启动时真正传给 Copilot 外层能力的字段 | 只有 `runtimeUrl`、`agentName` | 仅在状态为 `ready` 时使用 |

### 3. 当前“看起来像配置，但不应当算作生效字段”的范围

| 界面分区 / 字段类别 | 当前是否属于真正生效字段 | 当前状态 | 说明 |
| --- | --- | --- | --- |
| 模型服务中的服务商、协议、端点、密钥、模型等字段 | 否 | 前端本地交互 | 当前主要由 React state 驱动 |
| 默认模型中的任务模型路由 | 否 | 前端本地交互 | 当前没有进入 Electron 持久化或启动判断 |
| 常规设置中的语言、代理、通知 | 否 | 前端本地交互 | 当前没有形成后端连接契约 |
| 显示设置中的主题、字号、动画 | 否 | 前端本地交互 | 当前只影响展示交互外观，不进入后端连接逻辑 |
| 数据设置中的数据目录、备份周期等 | 否 | 前端本地交互 | 当前只是界面示例值和切换反馈 |
| MCP、搜索、记忆、文档处理分区中的表单项 | 否 | 前端本地交互 | 当前未形成统一持久化闭环 |
| API 服务器中的后端地址、重连策略、健康检查轮询 | 否 | 前端占位 | 当前页面已展示，但仍明确属于未接通状态 |

## 必要说明

### 1. 为什么只有两个字段

因为当前 Electron 配置结构、renderer 归一化逻辑、缺失字段判断和启动时的 Copilot 外层能力注入，全部都只围绕 `runtimeUrl` 和 `agentName` 展开。

换句话说，不是“文档只挑了两个写”，而是“当前代码真正生效的就只有两个”。

### 2. 什么叫“已接到界面”

这里的“已接到界面”指的是：用户能在现有设置界面里直接编辑这个字段，并让这个编辑结果进入当前已生效链路。

按这个标准，当前答案是：**没有。**

虽然聊天骨架在 `ready` 状态下会把 `runtimeUrl` 和 `agentName` 展示出来，但那是“读取结果展示”，不是“设置页正式编辑入口”。

### 3. 读取时机为什么写成根层统一读取

因为当前代码里，配置与运行态摘要已经收敛到根装配层统一读取：

- 应用启动时，[`loadInitialConfigState()`](../../frontend-copilot/src/CopilotAppRoot.tsx#L84) 会调用 [`loadCopilotConfigState()`](../../frontend-copilot/src/features/copilot/config.ts#L196)，并统一读取 settings 与 runtime
- [`CopilotAppRoot()`](../../frontend-copilot/src/CopilotAppRoot.tsx#L132) 会缓存并注入这份状态，供子组件消费
- [`CopilotChatPanel()`](../../frontend-copilot/src/features/copilot/CopilotChatPanel.tsx#L22) 当前只消费注入状态与重试动作，不再自行重复读取

所以当前字段事实既影响启动阶段的连接判断，也影响聊天骨架最终展示的状态和字段值，但读取入口已经统一到根层。

## 当前已实现 / 未实现说明

### 当前已实现

- 已有 Electron 本地配置文件承载 `runtimeUrl` 和 `agentName`
- 该配置文件当前落在 `userData/desktop-runtime/config/`，并兼容从旧版 `userData/copilot-settings.json` 迁移
- 已有 preload 桥接供 renderer 读取 / 保存配置
- 已有字段归一化逻辑
- 已有缺失字段判断逻辑
- 已有基于这两个字段进入 `ready` 的判断逻辑
- 已有在 `ready` 状态下展示字段值的聊天骨架

### 当前未实现

- 设置页中针对 `runtimeUrl` 和 `agentName` 的正式编辑入口
- 超出这两个字段之外的统一持久化配置结构
- 把模型服务、API 服务器、MCP、搜索、记忆等字段接入当前生效链路
- 可当作已生效后端契约依赖的更多字段集合

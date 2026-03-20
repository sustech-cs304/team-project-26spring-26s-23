# 后端连接契约与当前生效边界

## 文档目的

本文档用于说明当前前端与后端连接时，**已经在代码中生效的最小契约**，以及哪些设置项仍只是界面占位，不能被误写为正式接口规范。

本文重点回答以下问题：

- 当前前端真正依赖哪些后端连接字段
- 这些字段如何进入启动链路
- 配置状态 `empty` / `incomplete` / `ready` / `error` 以及启动期 `loading` 分别表示什么
- “尚未连接后端智能体”和“读取配置异常”有何区别
- 当前前端对后端运行时的最低预期是什么
- 设置页里哪些字段**不能**视为已生效契约

## 一、当前已生效的连接字段

基于当前代码，前端真正会消费并影响 Copilot 启动行为的字段只有两个：

- [`runtimeUrl`](../../frontend-copilot/electron/copilot-settings.ts:5)
- [`agentName`](../../frontend-copilot/electron/copilot-settings.ts:6)

这两个字段同时出现在 Electron 存储定义、renderer 配置解析以及 Copilot Provider 包裹逻辑中，因此它们是当前唯一可以明确确认的“已生效连接契约”。

### 结论

当前前端对后端连接的已生效依赖，**仅限于**：

1. 一个可由 [`runtimeUrl`](../../frontend-copilot/electron/copilot-settings.ts:5) 指向的可访问运行时端点
2. 一个可由 [`agentName`](../../frontend-copilot/electron/copilot-settings.ts:6) 指定的智能体名称

除这两个字段之外，前端代码没有体现出更多已经稳定生效的后端连接参数。

## 二、配置持久化与加载链路

当前 Copilot 配置通过 Electron 持久化到本地文件，配置文件名为 [`copilot-settings.json`](../../frontend-copilot/electron/main.ts:1)，保存位置在 Electron 的 `userData` 目录下。

需要注意：虽然本文不展开主进程实现细节，但根据调研结论，当前持久化链路已经明确限定在上述本地配置文件与 Electron `userData` 目录。

### preload 暴露的桥接接口

preload 向 renderer 暴露的接口位于 [`window.copilotSettings.load()`](../../frontend-copilot/electron/preload.ts:32) 与 [`window.copilotSettings.save()`](../../frontend-copilot/electron/preload.ts:35)。

底层对应两个 IPC 通道：

- [`copilot-settings:load`](../../frontend-copilot/electron/copilot-settings.ts:1)
- [`copilot-settings:save`](../../frontend-copilot/electron/copilot-settings.ts:2)

renderer 侧通过 [`loadCopilotSettings()`](../../frontend-copilot/src/features/copilot/settings.ts:11) 与 [`saveCopilotSettings()`](../../frontend-copilot/src/features/copilot/settings.ts:24) 统一调用桥接 API。

### 启动时的配置读取链路

应用启动后，会先通过 [`loadCopilotConfigState()`](../../frontend-copilot/src/features/copilot/config.ts:74) 解析配置状态，再由 [`CopilotAppRoot()`](../../frontend-copilot/src/CopilotAppRoot.tsx:10) 决定是否包裹 Copilot Provider。

可将当前链路理解为：

1. preload 暴露配置读取 / 保存接口
2. renderer 调用读取接口获取本地设置
3. 前端将设置归一化为配置状态
4. 只有在状态为 `ready` 时，才将连接参数传入 CopilotKit

这说明当前的连接契约首先是“本地配置驱动”，而不是“设置页任意字段自动生效”。

## 三、`ready` 状态下真正传入 CopilotKit 的值

当前包裹逻辑位于 [`renderAppWithCopilotProvider()`](../../frontend-copilot/src/CopilotAppRoot.tsx:43)。

只有当配置状态为 `ready` 时，前端才会执行以下传参：

- 将 [`configState.runtimeUrl`](../../frontend-copilot/src/CopilotAppRoot.tsx:51) 传给 CopilotKit 的 [`runtimeUrl`](../../frontend-copilot/src/CopilotAppRoot.tsx:51)
- 将 [`configState.agentName`](../../frontend-copilot/src/CopilotAppRoot.tsx:51) 传给 CopilotKit 的 [`agent`](../../frontend-copilot/src/CopilotAppRoot.tsx:51)

也就是说，当前真正进入 CopilotKit 的连接参数只有这两个值。

### 必须明确的事实

- 已生效字段：[`runtimeUrl`](../../frontend-copilot/src/CopilotAppRoot.tsx:51)、[`agent`](../../frontend-copilot/src/CopilotAppRoot.tsx:51) 对应的来源值
- 未体现为已生效字段：认证令牌、请求头、自定义 schema、健康检查地址、模型服务商配置等

因此，任何超出这两个字段的后端接口说明，都不能在当前文档中写成既成事实。

## 四、配置状态语义

当前配置状态由 [`resolveCopilotConfigState()`](../../frontend-copilot/src/features/copilot/config.ts:35) 统一解析，状态类型定义位于 [`CopilotConfigState`](../../frontend-copilot/src/features/copilot/types.ts:48)。

### 状态总览

| 状态 | 含义 | 是否表示已连接后端智能体 |
| --- | --- | --- |
| `loading` | 启动期，正在读取配置 | 否 |
| `empty` | 两个关键字段都缺失 | 否 |
| `incomplete` | 已有部分配置，但关键字段未填写完整 | 否 |
| `ready` | 两个关键字段齐备，可用于包裹 CopilotKit | 是（达到前端最小连接前提） |
| `error` | 读取配置链路异常 | 不能按“未配置”处理 |

### `empty` 与 `incomplete`

当 [`runtimeUrl`](../../frontend-copilot/src/features/copilot/config.ts:24) 与 [`agentName`](../../frontend-copilot/src/features/copilot/config.ts:28) 缺失时，前端会把状态解析为 `empty` 或 `incomplete`。

这两种状态的共同点是：

- 都表示尚未完成连接配置
- 都不应该包裹 CopilotKit Provider
- 聊天区域会显示“尚未连接后端智能体”相关提示

对应展示逻辑位于 [`renderCopilotPanelContent()`](../../frontend-copilot/src/features/copilot/CopilotChatPanel.tsx:65)。

### `error`

`error` 表示配置读取链路本身发生异常，例如 renderer 无法正常拿到 Electron 暴露的设置读取结果。

这一状态的关键含义是：

- 它不等于“还没填配置”
- 它表示读取路径可能存在故障
- 处理优先级应高于“提醒用户去填写连接信息”

当前聊天面板已明确把“读取失败”与“未连接”区分开，见 [`CopilotChatPanel()`](../../frontend-copilot/src/features/copilot/CopilotChatPanel.tsx:91)。

### `loading`

`loading` 只出现在启动读取过程中，用于表示配置状态尚未确定。相关定义见 [`CopilotBootstrapState`](../../frontend-copilot/src/CopilotAppRoot.tsx:8) 与 [`CopilotPanelState`](../../frontend-copilot/src/features/copilot/CopilotChatPanel.tsx:8)。

它不表示连接成功，也不表示连接失败，而是前置加载阶段。

## 五、“未连接”与“读取异常”的区别

这是当前联调文档中必须明确的一条边界。

| 场景 | 实际含义 | 应如何理解 |
| --- | --- | --- |
| `empty` / `incomplete` | 用户尚未完成最小连接配置 | 属于“未连接后端智能体” |
| `error` | 配置读取过程本身出错 | 属于“读取链路异常”，不应当被当作未配置 |

这一区分非常重要，因为它决定了后续问题排查方向：

- 如果是 `empty` / `incomplete`，应先检查配置是否填写完整
- 如果是 `error`，应优先检查 Electron / preload / renderer 的设置读取链路

## 六、当前前端对后端的最低预期

在不虚构接口细节的前提下，当前前端对后端仅能提出如下最低预期：

### 1. 运行时端点可被访问

前端需要一个能被 [`runtimeUrl`](../../frontend-copilot/src/CopilotAppRoot.tsx:51) 指向的可访问运行时端点。

当前文档只能确认“前端会把该值交给 CopilotKit”，但**不能**进一步写成：

- 一定使用某个固定 HTTP 路径
- 一定使用某种固定请求体结构
- 一定存在某种认证头或令牌字段

因为这些细节并未在当前前端代码中形成可验证契约。

### 2. 智能体名称可被匹配

前端需要一个与 [`agentName`](../../frontend-copilot/src/CopilotAppRoot.tsx:51) 对应的智能体名称。

当前文档只能确认前端会把该值传给 CopilotKit 的 `agent` 参数，不能进一步推导：

- 后端的智能体注册格式
- 智能体枚举接口
- 智能体元数据 schema
- 智能体发现机制

### 3. 只以最小连接字段为当前联调基础

当前进行前后端联调时，最稳妥的方式应是：

- 只围绕 [`runtimeUrl`](../../frontend-copilot/electron/copilot-settings.ts:5) 与 [`agentName`](../../frontend-copilot/electron/copilot-settings.ts:6) 这两个字段建立最小闭环
- 不把设置页中其他展示项提前当作必须实现的后端契约

## 七、哪些设置项目前不能视为后端契约

虽然设置页中已经展示了大量字段与分区，但根据当前实现，下列内容大多仍属于前端展示 / 交互占位：

- “API 服务器”分区中的地址、健康检查、自动重连相关设置
- “模型服务”分区中的服务商、协议、端点、密钥、默认模型等字段
- “默认模型”分区中的任务模型路由
- “网络搜索”“全局记忆”“MCP 服务器”“文档处理”等分区中的表单项

这些内容当前的准确定位应为：

- 界面上已有交互形态
- 多数仍由本地 React state 驱动
- 尚未形成 Electron 持久化闭环
- 尚未形成前端真实消费的后端连接契约

因此，文档中**不能**把这些字段写成：

- 已经被前端读取并生效
- 已经被后端接口正式消费
- 已经完成认证、模型切换或服务健康检查

## 八、当前契约边界的推荐表述方式

为了避免文档失真，建议在项目文档、接口讨论和联调说明中统一采用以下表述原则：

### 可以这样写

- 当前前端真正生效的连接字段只有 [`runtimeUrl`](../../frontend-copilot/electron/copilot-settings.ts:5) 与 [`agentName`](../../frontend-copilot/electron/copilot-settings.ts:6)
- 当状态为 `ready` 时，这两个值会传给 [`CopilotKit`](../../frontend-copilot/src/CopilotAppRoot.tsx:51)
- 当前聊天区域仍以状态说明与占位面板为主
- 设置页中大量字段目前仍是展示性或交互性占位

### 不应这样写

- 前端已经支持完整 API 服务器配置契约
- 前端已经接入模型服务商管理并正式生效
- 前端已经定义了后端 HTTP 请求 / 响应 schema
- 前端已经支持健康检查、认证流程或自动重连闭环

## 九、小结

当前前端与后端连接的最小、明确、已生效契约只有两项：

- [`runtimeUrl`](../../frontend-copilot/electron/copilot-settings.ts:5)
- [`agentName`](../../frontend-copilot/electron/copilot-settings.ts:6)

它们通过 Electron 本地持久化、preload 桥接、renderer 配置解析以及 [`CopilotKit`](../../frontend-copilot/src/CopilotAppRoot.tsx:51) 条件包裹逻辑进入启动链路。

与此同时，必须明确区分：

- `empty` / `incomplete`：未完成连接配置
- `error`：读取链路异常
- `loading`：启动加载阶段

除上述最小契约外，设置页中的大多数字段目前仍应视为前端占位或未来计划，不能写成已经成立的前后端接口规范。

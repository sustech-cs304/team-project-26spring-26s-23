# 前端现在怎样连接后端

## 这篇文档适合谁看

这篇文档适合：

- 准备做前后端联调，但想先知道“当前前端到底靠什么连接后端”的人
- 需要区分“当前代码事实”和“设置页占位”的人
- 刚接手前端、想先弄清最小接入链路的人

如果你想直接查字段表或状态表，可以优先看：

- [reference-current-fields.md](./reference-current-fields.md)
- [reference-runtime-states.md](./reference-runtime-states.md)

## 这篇文档回答什么问题

这篇文档主要回答：

- 当前前端真正会用到哪些后端连接信息
- 这些信息是从哪里来的，什么时候被读取
- 前端在什么情况下才算“达到最小连接条件”
- 为什么设置页里很多字段现在不能当成已生效的后端配置
- 联调时，哪些内容可以当当前事实，哪些不能

## 先给结论

- 当前前端真正已经生效、并参与启动判断的连接字段，只有 `runtimeUrl` 和 `agentName` 两个。
- 这两个值不是从设置页大表单里直接来的，而是从 Electron 本地配置文件读取，再通过 preload 桥接给 renderer。
- 应用启动时会先读取这两个字段，并把结果整理成 `loading`、`empty`、`incomplete`、`ready`、`error` 这些状态；只有到 `ready`，前端才会把连接信息交给 Copilot 外层能力。
- 设置页里像“API 服务器”“模型服务”“健康检查”“重连策略”这类内容，现在大多还只是前端界面或本地交互，不能写成已生效后端契约。
- 现阶段做联调，最稳妥的做法是只围绕 `runtimeUrl` 和 `agentName` 这两个字段讨论；更细的字段和状态请直接查附录。

## 再展开说明

### 先从“前端怎么拿到连接信息”说起

当前前端读取后端连接信息的方式很简单：先从 Electron 本地配置里读，再交给 renderer 使用。

白话一点说，就是：

1. Electron 主进程负责从本地文件读取 Copilot 配置
2. preload 把“读取 / 保存配置”的桥接接口暴露给 renderer
3. renderer 启动时调用这个桥接接口
4. renderer 根据读取结果判断当前到底是“没配”“配了一半”“可以继续了”还是“读取失败”

当前本地配置文件名是 `copilot-settings.json`，位置在 Electron 的 `userData` 目录下。

这条链路的重点不是“设置页看起来有多少字段”，而是“当前真正被启动逻辑消费的字段到底有几个”。答案目前只有两个：

- `runtimeUrl`
- `agentName`

如果你只想快速查这两个字段的存储位置、读取时机和是否接到界面，请直接看 [reference-current-fields.md](./reference-current-fields.md)。

### 什么叫“达到最小连接条件”

当前前端并不是只要打开应用就默认算“已连接后端”。

它会先检查两个关键字段：

- `runtimeUrl`：可以把它理解成“前端准备把请求交给哪个运行时地址”
- `agentName`：可以把它理解成“前端准备使用哪个智能体名字”

只有这两个字段都存在，而且不是空字符串，前端才会把状态判断为 `ready`。

如果两个都没有，就是 `empty`；如果只填了一部分，就是 `incomplete`；如果读取配置本身出错，就是 `error`。

这里最重要的一点是：

- `empty` / `incomplete` 表示“最小连接信息没配完整”
- `error` 表示“读取链路出问题了”

这两类情况不能混为一谈。需要详细查表时，请看 [reference-runtime-states.md](./reference-runtime-states.md)。

### 应用启动时实际会发生什么

从启动链路看，当前前端会按下面的顺序工作：

1. 应用启动
2. renderer 读取本地 Copilot 配置
3. 前端把读取结果归一化，也就是把空白值整理干净
4. 前端判断当前状态是 `empty`、`incomplete`、`ready` 或 `error`
5. 只有在 `ready` 时，前端才会把 `runtimeUrl` 和 `agentName` 传给 Copilot 外层能力

这说明当前前端的后端连接逻辑，本质上是一条“本地配置驱动的最小接入链路”。

它已经不是纯展示页面，但也还远远谈不上完整聊天闭环。

### 为什么说“已经有最小接入链路”，但还不能说“聊天已经接通”

这里很容易误解。

当前代码里，应用在 `ready` 状态下确实会把 `runtimeUrl` 和 `agentName` 交给 Copilot 外层能力。这是当前可以确认的代码事实。

但与此同时，用户看到的聊天区域仍然只是一个状态骨架面板，而不是完整聊天 UI。也就是说：

- **当前事实**：启动链路会在 `ready` 时交出最小连接参数
- **当前还不是事实**：已经有完整对话输入、消息列表、流式返回和联调后的成熟聊天体验

所以现在最准确的表述是：

- 前端已经有“最小连接入口”
- 但还没有“完整聊天产品能力”

### 为什么设置页里的很多内容现在不能当后端配置事实

当前设置页里确实已经有很多看起来像正式配置的内容，比如：

- 模型服务商
- 默认模型
- 网络搜索
- MCP 服务器
- API 服务器
- 健康检查轮询
- 重连策略

但根据当前代码，这些内容大多仍然只是：

- 前端本地 state
- 页面交互演示
- 未来配置方向的界面占位

这意味着它们现在大多不能写成：

- 已经持久化
- 已经参与启动判断
- 已经形成前后端联调契约
- 已经具备稳定的 HTTP 语义

尤其是 `API 服务器` 分区，虽然页面上已经出现“后端地址”“重连策略”“健康检查轮询”等字段，但当前仍应视为前端占位，不要写成已生效能力。

### 现阶段联调时，最稳妥的理解方式

如果现在要讨论前后端联调，最稳妥的方式是把范围收得很小。

也就是只先确认下面这些事实：

- 前端当前只明确依赖 `runtimeUrl` 和 `agentName`
- 这两个值来自 Electron 本地配置
- 只有在状态为 `ready` 时，它们才会进入启动链路
- 其他设置页字段当前大多不应提前算入联调范围

这样做的好处是：

- 不会把前端展示字段误当成真实接口要求
- 不会在文档里虚构后端 HTTP 细节
- 能把当前事实、前端占位和未来讨论明确分开

## 高频事实放到哪里查

这篇文档主要负责讲白话版现状，不把所有表格都塞在正文里。高频事实建议按下面的方式查：

| 你要查什么 | 去哪里看 |
| --- | --- |
| 当前真正生效的字段 | [reference-current-fields.md](./reference-current-fields.md) |
| `loading` / `empty` / `incomplete` / `ready` / `error` 的区别 | [reference-runtime-states.md](./reference-runtime-states.md) |
| 五个工作区当前是否接后端 | [reference-page-capabilities.md](./reference-page-capabilities.md) |
| 未来可能需要讨论哪些接口主题 | [future-backend-api-draft.md](./future-backend-api-draft.md) |

## 当前边界 / 不要误解的地方

- 当前文档不能补写固定 HTTP 路径、请求体、响应体或认证流程，因为这些内容并没有在当前前端代码里形成已生效事实。
- `ready` 的意思是“最小连接条件齐了”，不是“完整聊天体验已经完成”。
- 设置页里出现的很多配置项，当前仍然只是前端界面和本地交互，不等于已经参与后端连接。
- `error` 不是“还没配”，而是“读取配置这条链路本身出了问题”。
- [future-backend-api-draft.md](./future-backend-api-draft.md) 只能当未来讨论草案，不能反向当作当前联调依据。

## 继续阅读

- 先查当前字段：[reference-current-fields.md](./reference-current-fields.md)
- 先查运行态：[reference-runtime-states.md](./reference-runtime-states.md)
- 看界面里哪些是占位：[ui-current-state.md](./ui-current-state.md)
- 看已实现 / 占位 / 下一步：[roadmap-and-placeholders.md](./roadmap-and-placeholders.md)

---
title: 当前生效字段参考
description: 汇总统一配置中心当前已经正式落地的字段、分域边界与生效程度。
sidebar_position: 3
---

# 当前生效字段参考

## 文档用途

这份附录专门回答一个现在很常见的问题：**统一配置中心已经做到哪一步了，哪些字段真的已经被系统接住，哪些还只是设置页上的占位表单。**

它适合在这些场景使用：

- 联调前快速确认当前正式字段范围
- 文档评审时核对“这是不是已经落地的事实”
- 开发时确认字段属于哪个域、放在哪个文件里、由谁读取、什么时候生效

## 先给结论

当前统一配置中心已经有一套正式的**分域多文件 + 主进程聚合 + renderer 公共快照**链路，正式字段共有 4 个：

- `theme`
- `agentName`
- `runtimeUrl`
- `model`

但这 4 个字段的落地程度并不完全一样：

1. **`theme`**：已经形成“设置页可改、界面即时生效、配置中心持久化、跨窗口订阅更新”的闭环。
2. **`agentName`**：已经进入统一配置中心，也已经有设置页入口；它会直接影响 renderer 的连接状态判断。
3. **`runtimeUrl`**：已经进入统一配置中心，也已经有设置页入口；但它现在的角色是**开发态运行时覆盖地址**，不是发布态默认主路径。
4. **`model`**：已经进入统一配置中心 schema，也会被主进程读取并参与 hosted runtime 启动参数解析；**但当前没有正式设置页入口**，不能把它写成“后端可暴露字段方案已经完整完成”。

另外还有两个边界需要先记住：

- renderer 侧旧的 `CopilotSettings` 读写 API 已经移除，renderer 现在只消费配置中心公共快照与公共补丁接口。
- 旧 `copilot-settings.json` 没有被当作长期接口保留；它现在只承担**主进程内部 legacy disk migration 输入源**的语义。

## 使用边界

- 本文只写当前仓库里已经能确认的事实。
- 本文优先解释“已经纳入统一配置中心的字段”，不会把设置页里所有可交互表单都算成正式字段。
- 本文不把未来设计草案写成已实现事实。
- 如果你想看连接状态而不是字段，请改看 [前端运行时状态参考](./reference-runtime-states.md)。

## 当前正式分域

当前统一配置中心按 4 个稳定域存储：

| 配置域 | 当前用途 | 当前正式字段 | 当前存储文件 |
| --- | --- | --- | --- |
| `frontend-preferences` | 纯前端体验偏好 | `theme` | `userData/desktop-runtime/config/config-center/frontend-preferences.json` |
| `assistant-behavior` | assistant 使用方式相关配置 | `agentName` | `userData/desktop-runtime/config/config-center/assistant-behavior.json` |
| `host-config` | 宿主拥有的本地连接配置 | `runtimeUrl` | `userData/desktop-runtime/config/config-center/host-config.json` |
| `backend-exposed` | 允许宿主安全投影给 runtime 的字段样板 | `model` | `userData/desktop-runtime/config/config-center/backend-exposed.json` |

白话理解可以这样记：

- **前端偏好域**：改了以后主要影响界面体验，不直接改后端 owner。
- **assistant 行为域**：改的是“这个桌面助手要怎么用”。
- **宿主配置域**：改的是 Electron 宿主层持有的连接信息。
- **后端可暴露域**：当前只放了一个最小样板字段，用来验证投影边界，不等于这整类能力已经产品化完成。

## 核心表格

### 1. 当前已经纳入统一配置中心的字段

| 字段名 | 所属域 | 当前作用 | 当前 UI 入口 | 当前运行行为 | 生效级别 | 当前事实说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `theme` | `frontend-preferences` | 控制工作台浅色 / 深色主题 | 有，在“显示设置”页的主题下拉框 | App 启动时读取；修改时先本地应用，再写入配置中心；主进程广播公共快照更新后其余订阅方同步刷新 | 立即生效 | 当前是统一配置中心里最完整的前端偏好字段 |
| `agentName` | `assistant-behavior` | 指定当前聊天入口使用的 agent 名称 | 有，在“常规设置”页的“Assistant 行为配置”卡片 | renderer 启动时把它当作 bootstrap field；缺失时会落到 `incomplete`，存在时才可能进入 `ready` / `degraded` | 立即生效 | 当前设置页已经有正式入口，不再需要手动改 legacy settings 文件 |
| `runtimeUrl` | `host-config` | 指定开发态运行时覆盖地址 | 有，在“API 服务器”页的“宿主配置（开发态）”卡片 | hosted runtime 为 `ready` / `starting` / `degraded` 时优先使用宿主地址；只有 hosted 为 `failed` / `stopped` 且处于开发态时，才把该字段当作 dev override | 重启相关模块 | 它仍然很重要，但语义已经不是“发布态用户手填后端地址” |
| `model` | `backend-exposed` | 为 hosted runtime 提供一个可投影的默认模型字段样板 | 暂无 | 主进程创建 hosted backend service 时会读取该值，并按“显式 CLI 参数 > 配置中心 `model` > 环境变量”参与 Python `--model` 参数解析 | 重启整个程序 | 字段本身已进入配置中心与 runtime 投影链路，但当前没有正式 UI，不应把“后端可暴露字段方案”写成已经完整完成 |

### 2. 当前哪些字段已经形成“UI / 行为闭环”

| 类型 | 字段 |
| --- | --- |
| 已有 UI，也已有明确运行或显示行为 | `theme`、`agentName`、`runtimeUrl` |
| 已纳入统一配置中心，但当前还没有正式 UI 入口 | `model` |

这里要特别注意：`model` 不能写成“完全没做”，因为它确实已经存在于 schema、公共快照结构和主进程启动参数投影逻辑里；但也不能写成“已经做完”，因为当前还没有正式设置入口，也没有把“后端可暴露字段”这一整类能力收敛成稳定产品语义。

## 这几个字段分别由谁负责

### Main process

主进程负责：

- 读取统一配置中心分域文件
- 在分域文件不存在时，尝试从 legacy `copilot-settings.json` 提取可迁移字段
- 对 renderer 暴露公共快照加载、公共补丁写入和快照更新广播
- 在启动 hosted runtime 时，读取可投影字段（当前是 `model`）

### Preload

preload 负责把主进程能力裁成 renderer 可消费的最小桥接面：

- `configCenterPublicSnapshot.load()`
- `configCenterPublicSnapshotSubscription.subscribe()`
- `configCenterPublicPatch.apply()`
- `copilotRuntime.load()`
- `copilotRuntime.retry()`

也就是说，renderer 不再直接拥有旧 `copilotSettings` 接口。

### Renderer

renderer 当前主要做两件事：

1. 从配置中心公共快照里读取 bootstrap fields：
   - `agentName`
   - `runtimeUrl`
2. 再把这两个字段与 hosted runtime snapshot 合并，决定当前连接状态。

另外，renderer 里还有一条纯前端偏好主线：`theme` 通过配置中心持久化后，直接驱动工作台主题切换。

### Runtime

当前 runtime 并不会直接读取统一配置中心分域文件。

它当前真正收到的是**宿主翻译后的启动参数**。就统一配置中心而言，已经进入这条投影链路的正式字段只有：

- `model`

因此现在不能把“统一配置中心”理解成“Python runtime 直接读配置目录”。当前 owner 仍然在 Electron 主进程。

## 主题字段为什么能即时生效

`theme` 的即时生效不是因为 renderer 自己偷偷保了一个长期本地状态，而是因为现在已经有一条明确链路：

1. App 启动时读取配置中心公共快照，得到当前主题。
2. App 把主题应用到 `document.documentElement.dataset.theme` 和工作台根节点。
3. 用户在设置页切换主题时，renderer 先做一次乐观本地应用，避免界面发卡。
4. 随后 renderer 通过公共补丁写入 `frontend-preferences.theme`。
5. 主进程写盘后广播新的公共快照。
6. 订阅方收到更新后再把主题与持久化结果对齐；如果写入失败，则回滚到旧主题。

因此它既有“马上看到效果”的体验，也有“最终还是以配置中心持久化结果为准”的约束。

## 旧 `copilot-settings.json` 现在还剩什么语义

旧 `copilot-settings.json` 现在还有两层意义，但都在**主进程内部**：

1. `userData/desktop-runtime/config/copilot-settings.json`
2. 更早期的 `userData/copilot-settings.json`

如果统一配置中心分域文档还不存在，主进程会尝试从这两个旧位置读取 `runtimeUrl` 和 `agentName`，提取可迁移字段后写入新的分域文件。

这意味着：

- **迁移语义还在**；
- **renderer 侧旧接口已经退场**；
- **新结构才是后续正式配置来源**。

所以文档里应写成：

- “主进程内部仍保留 legacy disk migration 语义”

而不应写成：

- “前端现在仍然依赖旧 `CopilotSettings` 接口”
- “系统长期双读双写旧 settings 文件”

## 当前还没有纳入统一配置中心的范围

下面这些内容虽然很多已经出现在设置页里，但当前还不能写成“已纳入统一配置中心”：

- 模型服务中的服务商、协议、端点、密钥、模型清单
- 默认模型页里的主模型 / 快速模型路由 UI
- 常规设置中的语言、代理、通知、拼写检查、自动备份
- 显示设置中的字号、界面密度、动画开关
- 数据设置中的数据目录、备份周期、启动同步
- MCP、搜索、记忆、文档处理页面中的表单项
- API 服务器页面中的“后端地址”“重连策略”“健康检查轮询”等占位字段

可以简单理解成：

- **统一配置中心当前已经开始接入设置页**，但**还没有把整个设置页收编完成**。

## 当前不要误写成已实现的事

下面这些说法当前都不准确：

- “设置页所有分区都已经接到统一配置中心”
- “后端可暴露字段方案已经完成”
- “Python runtime 会直接读取统一配置中心文件”
- “旧 `copilot-settings.json` 仍是 renderer 正式读写入口”
- “`runtimeUrl` 现在是发布态默认连接方式”

## 相关文档

- [前端分册入口](./README.md)
- [前端现在怎样连接后端](./backend-connection-contract.md)
- [前端运行时状态参考](./reference-runtime-states.md)
- [前端当前 UI 状态说明](./ui-current-state.md)
- [会话与状态模型](../system/session-and-state-model.md)
- [后端运行与配置](../backend/run-and-config.md)

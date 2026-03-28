---
title: 前端运行时状态参考
description: 汇总配置中心字段、hosted runtime 状态与 renderer 当前 bootstrap 状态之间的关系。
sidebar_position: 4
---

# 前端运行时状态参考

这份文档专门回答一个问题：

> 前端现在看到的这些 `loading`、`empty`、`starting`、`ready`、`degraded`，到底是怎么来的？

如果不把“配置状态”“宿主运行态”“助手工作区状态”分开，后面就很容易把问题写混。

## 先给结论

当前前端运行时状态至少分成两层：

1. **宿主层状态**：本地 Python runtime 现在是什么状态。
2. **renderer 层状态**：把配置中心公共快照和宿主快照合并后得出的 bootstrap 状态。

当前 bootstrap 判断最重要的条件，是：

- 有没有可用 `runtimeUrl`

而不是：

- 有没有全局 `agentName`

这点和早期文档已经不同。

## 第一层：hosted runtime 状态

这部分由 Electron 主进程维护，表示“宿主托管的本地后端现在如何”。

### 当前状态值

- `stopped`
- `starting`
- `ready`
- `failed`
- `degraded`

### 这层状态回答什么问题

它主要回答：

- 后端有没有启动。
- 当前有没有可用地址。
- 当前运行模式是什么。
- 最近一次失败是什么。
- 当前是不是打包态。

### `failed` 和 `degraded` 的区别

这两个状态最容易混淆。

- `failed`：宿主当前没有形成稳定可用的 hosted 入口。
- `degraded`：宿主曾经 ready，后来出现异常，但当前仍保留了可继续尝试的地址。

## 第二层：renderer bootstrap 状态

这部分由 renderer 计算，表示“当前工作台接下来应该怎么走”。

### 当前状态值

- `loading`
- `empty`
- `incomplete`
- `starting`
- `ready`
- `failed`
- `degraded`
- `error`

### 这些状态当前分别表示什么

| 状态 | 当前含义 |
| --- | --- |
| `loading` | 根装配层还在读取配置中心公共快照和 hosted runtime 快照 |
| `empty` | 当前没有可用 runtime URL，且宿主也没有提供可用地址 |
| `incomplete` | 当前还缺继续进入主路径所需的关键连接条件，主要仍是 runtime URL |
| `starting` | 宿主正在启动本地后端 |
| `ready` | 已有可用 runtime URL，可继续进入助手工作区主路径 |
| `failed` | 宿主启动失败，且当前没有可用开发态 override |
| `degraded` | 宿主已降级，但仍保留可用 runtime URL |
| `error` | 配置或运行态读取链路本身失败 |

## 当前状态流怎么走

可以用这张简图理解：

```text
配置中心公共快照
  └─ 提供 theme / animationsEnabled / agentName / runtimeUrl / model

hosted runtime 快照
  └─ 提供 stopped / starting / ready / failed / degraded 以及 runtimeUrl

Renderer 根装配层
  └─ 合并上面两类输入
       └─ 生成 CopilotBootstrapState
            └─ 交给工作台和助手工作区继续使用
```

## 配置中心里哪些字段会进入状态装配

### 当前公共快照字段

当前公共快照里有这些正式字段：

- `frontendPreferences.theme`
- `frontendPreferences.animationsEnabled`
- `assistantBehavior.agentName`
- `hostConfig.runtimeUrl`
- `backendExposed.model`

### 真正影响 bootstrap 连接判断的字段

当前真正直接影响 bootstrap 连接判断的，是：

- `hostConfig.runtimeUrl`

### 当前不再作为 readiness 硬门槛的字段

- `assistantBehavior.agentName`

它仍然会进入前端状态对象，也仍然有来源标记和配置入口，但当前不会再因为它缺失就阻止助手工作区继续走 session-first 主路径。

### 不参与聊天连接判断、但仍然是正式字段的内容

- `theme`
- `animationsEnabled`
- `model`

它们的作用分别是：

- `theme`：影响主题
- `animationsEnabled`：影响动画开关
- `model`：影响后端下次启动时的默认模型投影

## `runtimeUrl` 现在怎么选出来

当前 renderer 不会无条件把配置中心里的 `runtimeUrl` 当成正式连接地址。

### 情况 1：宿主状态为 `ready` / `starting` / `degraded`

此时直接使用 hosted runtime 给出的地址。

来源记为：

- `hosted`

### 情况 2：宿主状态为 `failed` / `stopped`

只有同时满足下面条件时，才允许使用配置中心中的 `hostConfig.runtimeUrl`：

- 当前不是打包态
- 当前运行模式是 development
- 配置中心里已经填写了 `runtimeUrl`

来源记为：

- `dev-override`

### 情况 3：以上两条都不满足

则当前没有可用地址：

- `runtimeSource = 'none'`
- `runtimeUrl = null`

## 当前 bootstrap 状态归并规则

可以直接按这张表理解：

| Hosted 状态 | 是否拿到可用 runtime URL | 最终 renderer 状态 |
| --- | --- | --- |
| `ready` | 是 | `ready` |
| `ready` | 否 | `incomplete` |
| `starting` | 无论是否完整 | `starting` |
| `degraded` | 是 | `degraded` |
| `degraded` | 否 | `incomplete` |
| `failed` | 有 dev override | `ready` |
| `failed` | 无 dev override | `failed` |
| `stopped` | 有 dev override | `ready` |
| `stopped` | 无 dev override | `empty` |

这里最关键的是：

- 当前 `missingFields` 实际只围绕 `runtimeUrl`
- 不再把 `agentName` 缺失写成 readiness blocker

## `loading`、`error`、`starting` 应该怎么区分

### `loading`

表示根装配层还没完成第一次装配。

这时候前端还在读取：

- 配置中心公共快照
- hosted runtime 快照

### `error`

表示读取链路本身出了问题。

典型情况是：

- preload 暴露接口不可用
- 配置中心公共快照读取失败
- hosted runtime 快照读取失败

### `starting`

表示读取链路本身没有坏，宿主只是还在启动本地后端。

所以：

- `error` 是“读不到”
- `starting` 是“读到了，但后端还没 ready”

## 当前状态对象里还有哪些辅助信息

除了 `status` 本身，当前状态里还会带上：

- `runtimeSource`
- `runtimeUrl`
- `agentName`
- `agentNameSource`
- `diagnostics`
- `storageState`
- `devOverrideAllowed`
- `devOverrideConfigured`

### 这些字段现在怎么理解

#### `runtimeSource`

表示当前实际使用的 runtime 地址来自哪里：

- `hosted`
- `dev-override`
- `none`

#### `agentNameSource`

表示配置中心里当前是否有 `agentName`：

- `config-center`
- `missing`

这个字段当前更适合做状态说明，而不是连接门槛判断。

#### `storageState`

当前主要区分：

- `empty`
- `stored`

它现在主要反映 runtime override 这类连接字段是否有持久化值，不代表整个配置中心是否为空。

## 哪些更新会自动反映到界面

### 配置中心更新：会自动同步

当前配置中心公共快照已经有订阅更新机制。

因此这些字段变化后，根装配层会收到更新并重新计算状态：

- `theme`
- `animationsEnabled`
- `agentName`
- `runtimeUrl`
- `model`

其中：

- `theme`、`animationsEnabled` 会影响工作台显示
- `runtimeUrl` 会影响 bootstrap 连接判断
- `model` 会更新配置，但要到下次完整启动才真正影响后端
- `agentName` 会更新配置摘要，但当前不再阻止聊天主路径

### runtime 运行事实：当前还不是完整持续推送

另一半边界也要记住：

- 配置中心更新已经可以推送到前端
- 但 runtime 运行事实当前还主要是快照式读取

所以现在不能把系统写成“所有运行态变化都会自动实时流式推送到 renderer”。

## 这些状态在 UI 中怎么被消费

### 根装配层

根装配层负责：

- 首次读取 bootstrap 状态
- 在配置中心更新后重新计算 bootstrap 状态
- 对工作台统一提供 retry 动作
- 在根级失败时保持可解释的启动壳

### 助手工作区

助手工作区只会在 connectable 状态下继续：

- 拉后端智能体目录
- 创建会话
- 获取能力面
- 渲染消息发送壳

### 聊天面板

聊天面板会根据 bootstrap 状态渲染：

- `loading`：等待装配
- `empty`：还没有可用运行时
- `incomplete`：当前连接信息仍不完整
- `starting`：宿主正在启动
- `failed`：宿主启动失败
- `degraded`：宿主降级但仍可继续
- `ready`：进入 session-first 聊天壳
- `error`：读取链路失败

## 典型场景

### 场景 1：宿主正常启动

1. 主进程启动 Python runtime
2. hosted 状态从 `starting` 进入 `ready`
3. renderer 拿到 hosted URL
4. bootstrap 状态进入 `ready`
5. 助手工作区开始拉智能体目录并允许用户创建会话

### 场景 2：宿主失败，但开发态 override 可用

1. hosted 状态为 `failed`
2. 配置中心里已经填写开发态 `runtimeUrl`
3. 当前环境允许 dev override
4. bootstrap 仍可进入 `ready`
5. 当前 `runtimeSource = 'dev-override'`

### 场景 3：宿主 ready，但 `agentName` 缺失

当前和旧文档最不一样的地方就在这里。

现在更准确的结果是：

1. 宿主已经给出可用 runtime URL
2. `agentName` 可以缺失
3. bootstrap 仍可进入 `ready`
4. 后续聊天智能体由后端目录选择和会话创建来决定

### 场景 4：读取链路本身失败

1. 配置中心公共快照或 runtime 快照读取失败
2. 根装配层进入 `error`
3. 工作台不会继续误判成“只是后端没启动”

## 当前不要再写成这些说法

下面这些说法现在都不准确：

- “`agentName` 仍然是前端进入 `ready` 的硬条件。”
- “只要 runtime ready 且有 `agentName`，就会直接进入聊天。”
- “前端启动成功后主要是在等旧 Provider 注入。”
- “聊天 readiness 现在仍主要围绕全局 agent 展开。”

## 相关文档

- [前端分册入口](./README.md)
- [前端现在怎样连接后端](./backend-connection-contract.md)
- [前端当前 UI 状态说明](./ui-current-state.md)
- [系统架构总览](../system/architecture-overview.md)
- [会话与状态模型](../system/session-and-state-model.md)

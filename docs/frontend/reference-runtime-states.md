---
title: 前端运行时状态参考
description: 汇总统一配置中心 bootstrap 字段、hosted runtime 状态与 renderer 侧连接状态的关系。
sidebar_position: 4
---

# 前端运行时状态参考

## 文档用途

本文档是前端运行时状态的权威说明，帮助读者理解：

- renderer 现在怎样把配置中心公共快照和 hosted runtime 快照合并起来
- 为什么会显示 `loading`、`empty`、`incomplete`、`starting`、`ready`、`failed`、`degraded`、`error`
- 哪些字段真正决定聊天入口是否能挂起来
- 配置改动以后，哪些状态会跟着更新，哪些还不会自动推送

## 使用边界

- 本文聚焦运行时与连接状态，不展开完整聊天协议。
- 本文只写当前仓库里已经存在的状态与行为。
- 本文不会把未来状态机或未来联动写成当前事实。

如果你想先看字段范围，请先看 [当前生效字段参考](./reference-current-fields.md)。

## 先给结论

当前前端运行时状态有两层：

1. **主进程层**：hosted backend 的生命周期状态
2. **renderer 层**：把 bootstrap fields 与 hosted runtime 快照归并后的连接状态

其中 renderer 当前真正用来判断聊天入口的 bootstrap fields 只有两个：

- `assistantBehavior.agentName`
- `hostConfig.runtimeUrl`

它们都来自统一配置中心公共快照，而不是旧 renderer settings API。

## 状态层次概览

### 第一层：Hosted backend 状态

这部分由 Electron 主进程维护，表示“本地 Python runtime 现在是什么状态”。

当前状态值为：

- `stopped`
- `starting`
- `ready`
- `failed`
- `degraded`

### 第二层：Renderer 连接状态

这部分由 renderer 计算，表示“当前聊天入口能不能挂起来，以及应该怎么解释当前情况”。

当前状态值为：

- `loading`
- `empty`
- `incomplete`
- `starting`
- `ready`
- `failed`
- `degraded`
- `error`

## 数据流怎么走

当前状态流转路径可以简单理解成：

```
Electron 主进程
  └─> Hosted runtime 快照
        └─> 通过 preload 暴露给 renderer

配置中心主服务
  └─> 公共快照
        └─> 通过 preload 暴露给 renderer

Renderer
  └─> 读取 bootstrap fields（agentName / runtimeUrl）
        + hosted runtime 快照
        └─> resolveCopilotConfigState()
              └─> CopilotBootstrapState
                    └─> UI 消费
```

## Bootstrap fields 当前来自哪里

### 当前来源

renderer 当前通过配置中心公共快照读取 bootstrap fields：

- `snapshot.domains.assistantBehavior.agentName`
- `snapshot.domains.hostConfig.runtimeUrl`

然后由 `loadBootstrapFieldsFromConfigCenterPublicSnapshot()` 把这两个字段整理成统一结构。

### 当前不参与聊天连接判断的公共字段

公共快照里虽然还有：

- `frontendPreferences.theme`
- `backendExposed.model`

但它们当前**不参与聊天连接状态判断**：

- `theme` 用于前端显示偏好
- `model` 由主进程读取后参与 runtime 参数投影

## Hosted backend 状态语义

### 状态定义

| 状态 | 当前语义 |
| --- | --- |
| `stopped` | 初始状态或已停止 |
| `starting` | 子进程已启动，正在等待 `/ready` |
| `ready` | 本地 runtime 已就绪，可提供 hosted 地址 |
| `failed` | 启动失败或运行中遇到不可恢复错误 |
| `degraded` | 曾经 ready，但后续异常退出；当前仍保留 base URL 供 renderer 继续尝试 |

### `failed` 和 `degraded` 的区别

这是最容易混淆的一组状态：

- **`failed`**：当前没有形成稳定可用的 hosted 入口
- **`degraded`**：曾经形成过 hosted 入口，只是后续记录到了异常退出；当前可能仍能继续尝试连接

## Renderer 连接状态语义

### `loading`

表示根装配层还在读取：

- 配置中心公共快照
- hosted runtime 快照

这时还没有完成状态归并。

### `error`

表示读取链路本身失败，例如：

- 配置中心公共快照读取失败
- hosted runtime 快照读取失败
- preload 暴露接口不可用

### `empty`

表示当前两项 bootstrap fields 都缺失：

- `runtimeUrl`
- `agentName`

并且宿主当前也没有提供可用 hosted 地址。

### `incomplete`

表示已经读到部分连接信息，但还缺少至少一个关键字段。

最常见的情况是：

- 宿主 ready，但 `agentName` 为空
- 或开发态填写了 `runtimeUrl`，但 `agentName` 为空

### `starting`

表示宿主正在启动本地后端。

### `ready`

表示当前连接信息完整，可以挂载聊天入口。

这时必须满足：

- 最终选定的 `runtimeUrl` 不为空
- `agentName` 不为空

### `failed`

表示宿主启动失败，并且当前没有可用的 dev override 可以回退。

### `degraded`

表示宿主运行态已经降级，但仍保留可用 URL，因此前端仍然允许挂载聊天入口。

## Runtime URL 是怎么选出来的

renderer 不会直接把配置中心里的 `runtimeUrl` 无脑当正式地址使用。

当前选择规则是：

### 宿主状态为 `ready` / `starting` / `degraded`

直接使用 hosted runtime 提供的 `runtimeUrl`。

此时来源标记为：

- `hosted`

### 宿主状态为 `failed` / `stopped`

只有在以下条件同时满足时，才允许使用配置中心中的 `hostConfig.runtimeUrl`：

- 当前是开发模式
- 当前不是打包态
- 配置中心里已经填写了 `runtimeUrl`

此时来源标记为：

- `dev-override`

### 其他情况

如果两条路径都拿不到地址，则：

- `runtimeSource = 'none'`
- `runtimeUrl = null`

## 状态归并规则

当前归并逻辑可以概括成下面这张表：

| Hosted 状态 | bootstrap fields 是否完整 | 最终 renderer 状态 |
| --- | --- | --- |
| `ready` | 完整 | `ready` |
| `ready` | 不完整 | `incomplete` |
| `starting` | 无论是否完整 | `starting` |
| `degraded` | 完整 | `degraded` |
| `degraded` | 不完整 | `incomplete` |
| `failed` | 可用 dev override 且完整 | `ready` |
| `failed` | 无可用 dev override | `failed` |
| `stopped` | 可用 dev override 且完整 | `ready` |
| `stopped` | 两项都缺失 | `empty` |
| `stopped` | 只缺一部分 | `incomplete` |

## `ready` / `degraded` 为什么还要看 `agentName`

这点很关键。

当前聊天入口不是“只要有 URL 就能挂起来”，而是至少还要知道当前使用哪个 agent。

所以现在：

- 宿主 `ready` 不等于聊天入口一定 `ready`
- `agentName` 缺失时，前端仍会落到 `incomplete`

## 哪些更新会自动反映到界面

### 会自动反映的

配置中心公共快照现在已经有订阅更新机制。

因此这些字段变化后，根装配层会收到更新并重新计算 bootstrap 状态：

- `agentName`
- `runtimeUrl`
- `theme`

其中：

- `agentName` / `runtimeUrl` 会影响连接状态
- `theme` 会影响界面显示，但不影响聊天连接状态

### 当前还不会主动推送的

hosted runtime 状态本身当前仍然主要是快照式读取。

也就是说：

- 配置中心字段更新现在可以推送到 renderer
- 但 runtime 运行事实本身还没有形成完整的持续推送链路

因此文档里不能写成“所有运行态变化都会实时推送到前端”。

## UI 当前怎样消费这些状态

### 根装配层

根装配层负责：

- 首次读取 bootstrap 状态
- 在配置中心公共快照更新后重新计算 bootstrap 状态
- 决定是否加载 CopilotKit Provider
- 统一提供 retry 动作

### 聊天面板

聊天面板根据最终状态渲染：

- `loading`：等待装配
- `error`：读取失败
- `empty`：未获得可用运行时
- `incomplete`：连接信息不完整
- `starting`：宿主正在启动
- `failed`：宿主启动失败，可显示失败摘要与重试
- `degraded`：显示降级警告，但仍可挂载聊天区
- `ready`：显示连接详情并挂载聊天区

## 典型场景

### 场景 1：宿主正常启动

1. 主进程启动 Python runtime
2. hosted 状态从 `starting` 进入 `ready`
3. renderer 读到 hosted URL 和配置中心中的 `agentName`
4. 最终状态为 `ready`

### 场景 2：宿主失败，但开发态 override 可用

1. hosted 状态为 `failed`
2. 配置中心里已填写开发态 `runtimeUrl`
3. `agentName` 也存在
4. 最终 renderer 状态仍可进入 `ready`
5. 此时 `runtimeSource = 'dev-override'`

### 场景 3：宿主 ready，但 `agentName` 缺失

1. hosted runtime 已就绪
2. `assistantBehavior.agentName` 为空
3. 最终状态不是 `ready`，而是 `incomplete`

### 场景 4：主题更新

1. 设置页修改 `theme`
2. 主进程写盘并广播公共快照
3. App 收到更新后同步主题
4. 但聊天连接状态本身不会因为 `theme` 改变而变化

## 常见误解

### 误解 1：`runtimeUrl` 现在总是来自配置中心

不对。

当前优先级仍然是：

1. hosted runtime 提供的地址
2. 开发态 override

### 误解 2：公共快照里的所有字段都会影响聊天连接状态

不对。

当前真正参与聊天连接判断的只有：

- `agentName`
- `runtimeUrl`

### 误解 3：配置中心接入以后，runtime 状态也变成实时推送了

不对。

当前有推送的是**配置中心公共快照更新**，不是完整的 runtime 状态流。

### 误解 4：`model` 现在也是进入 `ready` 的必填项

不对。

`model` 当前属于主进程向 runtime 投影的样板字段，不属于 renderer bootstrap 判断字段。

## 相关文档

- [当前生效字段参考](./reference-current-fields.md)
- [前端现在怎样连接后端](./backend-connection-contract.md)
- [前端当前 UI 状态说明](./ui-current-state.md)
- [会话与状态模型](../system/session-and-state-model.md)
- [运行时生命周期](../system/runtime-lifecycle.md)

---
title: Provider 与模型路由说明
description: 统一说明 provider catalog、provider profile、默认模型路由、请求级模型路由和宿主解析边界。
sidebar_position: 2
---

# Provider 与模型路由说明

- 这页给谁看：需要理解模型配置、Provider 选择和运行时路由解析的人，包括普通使用者和开发者。
- 这页解决什么问题：把 provider catalog、provider profile、model route、默认模型路由、请求级模型路由和宿主私有解析边界一次说清楚。
- 当前覆盖到哪：覆盖当前代码里已经落地的主链，不讨论旧的 active provider 心智，也不把未来草案写成现状。
- 当前状态：已可用。

## 先说结论

当前模型链路已经不是“先选一个全局 active provider，再由系统替你猜模型”。

现在更准确的理解是：

1. provider catalog 定义共享 Provider 事实。
2. provider profile 保存用户自己的具体配置。
3. settings workspace 可以保存默认模型路由。
4. 每次运行时请求还可以显式携带请求级模型路由。
5. 宿主负责把 route 解析成 runtime 真正可执行的 resolved route。

## 先分清四层对象

| 层级 | 主要作用 | 谁持有 | 当前状态 |
| --- | --- | --- | --- |
| provider catalog | 定义 providerId、认证方式、地址策略、runtimeStatus、能力提示等共享事实。 | 共享清单 | 已可用 |
| provider profile | 保存某个用户真正要用的 Provider 配置、模型列表和 secret 状态。 | settings workspace | 已可用 |
| 默认模型路由 | 给聊天草稿和默认选择提供首选 route。 | settings workspace | 已可用 |
| 请求级模型路由 | 决定这次 run 真正走哪条 route。 | 每次运行时请求 | 已可用 |

## provider catalog 负责什么

provider catalog 是共享清单。它现在至少会定义这些字段：

- `providerId`
- `displayName`
- `endpointType`
- `runtimeStatus`
- `adapterId`
- `authSchema`
- `baseUrlPolicy`
- `modelConfigPolicy`
- `capabilityHints`
- `catalogRevision`

它回答的是“这个 Provider 在系统里怎么被描述”，不是“这个用户现在实际要连哪个账号”。

## provider profile 负责什么

provider profile 是用户自己的具体配置。它通常会补齐这些信息：

- 这条 profile 绑定哪个 Provider。
- 可选模型列表是什么。
- base URL 是默认值还是自定义值。
- secret 是否已经保存。
- 这条 profile 当前是否还能用于 runtime 执行。

最关键的一点是：provider profile 的普通状态和 secret 状态都由 Electron 主进程持有，不由 Python runtime 直接读取本地设置文件。

## runtimeStatus 现在怎么理解

provider catalog 里的 `runtimeStatus` 会直接影响这条 Provider 能不能被解析成运行时路由。

| runtimeStatus | 现在怎么理解 | 当前状态 |
| --- | --- | --- |
| `enabled` | 当前可以进入 runtime 执行链路。 | 已可用 |
| `catalog-only` | 目前只保留目录层或数据层事实，不能直接解析为 runtime 执行。 | 部分接通 |
| `legacy-unsupported` | 只保留历史兼容语义，不应再作为当前执行路径。 | 部分接通 |

最容易写错的一点是：目录里有条目，不等于当前就能执行。

## 默认模型路由和请求级模型路由是什么关系

默认模型路由解决的是“如果用户没有临时改动，系统先拿哪条 route 作为默认值”。

请求级模型路由解决的是“这次 run 真正走哪条 route”。

所以当前正确关系是：

- 默认模型路由可以提供默认选择。
- 真正执行时，仍以请求体里显式携带的 route 为准。
- 这也是为什么当前不应该再用“全局 active provider”去代替整条链路。

## 当前 route 的主形态是什么

当前最核心的 route 形态是 `provider-model`。它至少包含：

```json
{
  "routeKind": "provider-model",
  "profileId": "provider-openai",
  "modelId": "gpt-4.1"
}
```

在运行时请求里，它会再和 `providerProfileId` 一起出现，用来稳定定位这次执行要走的 profile 和 model。

## 宿主现在怎样解析 route

当前宿主解析链路会重点检查这些问题：

1. 这条 provider profile 是否存在。
2. 它引用的 Provider 是否在 provider catalog 里。
3. 这条 profile 是否被标记为 legacy 或 unsupported。
4. Provider 的 `runtimeStatus` 是否允许执行。
5. 请求里的 `modelId` 是否真在这条 profile 下定义。
6. 如果请求方带了 `catalogRevision`，它是否和当前 catalog 一致。
7. 当前需要的 API key 是否已经保存。

只有这些条件都通过，宿主才会产出 resolved route，并把私有认证信息按运行时边界注入。

## 为什么 secret 不会进公开快照

因为这条链路现在已经明确分层：

- 公开快照用于 renderer 根装配和非敏感显示。
- settings workspace secret 状态保存敏感值。
- 宿主在真正执行前，通过私有边界把认证信息注入 runtime。

这样可以避免把 Provider API key 当成普通页面状态到处传。

## 首次进入为什么允许是空白配置

当前首次状态允许：

- provider profile 为空。
- 默认模型路由为空。
- 用户从空白模型配置开始。

所以这套系统现在不承诺“首次进入就带好一组默认 Provider 和默认模型”。如果文档写成默认已经预置完整模型链路，就会和当前实现不一致。

## 什么时候最该看这页

- 你在配置模型，但不确定应该看 provider profile、默认模型路由还是请求级 route。
- 你在读代码，但看到 catalog、profile、route、resolved route 混在一起。
- 你需要判断某个 Provider 为什么能显示在列表里，却不能真正执行。

## 相关页面

- [术语表](./glossary.md)
- [Thinking 能力说明](./thinking.md)
- [能力边界 / 状态总表](./capabilities.md)
- [运行时接口 / 事件参考](./runtime-events.md)

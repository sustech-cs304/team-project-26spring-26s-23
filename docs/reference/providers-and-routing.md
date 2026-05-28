---
title: Provider 与模型路由说明
description: 说明模型服务商（Provider）、用户配置（Profile）、模型路径（Route）之间的关系。
sidebar_position: 2
---

# Provider 与模型路由说明

## 四层关系

当前模型配置分成四层，从公共信息到每次请求逐层细化：

| 层级 | 作用 | 谁持有 |
| --- | --- | --- |
| provider catalog | 项目自带的 Provider 清单，定义每个服务商的公共信息（接入方式、认证方式、能力提示等） | 项目仓库 `provider-catalog/registry.json` |
| provider profile | 用户保存的一条具体模型服务配置，引用某个 catalog 条目，填上地址、密钥和模型列表 | 用户设置（settings workspace） |
| 默认模型路由 | 用户保存的首选模型路径（如"主助手模型"），提供默认值 | 用户设置（settings workspace） |
| 请求级模型路由 | 每次 `run/start` 请求里显式指定的模型路径，真正以这个为准 | 每次聊天请求 |

### provider catalog

`provider-catalog/registry.json` 是项目自带的共享清单，定义：

- `providerId` — 服务商标识
- `endpointType` — 接入方式（如 openai-compatible）
- `runtimeStatus` — `enabled`（可执行）、`catalog-only`（仅目录）、`legacy-unsupported`（仅兼容）
- `authSchema` — 认证方式（如 api-key）
- `baseUrlPolicy` — 地址策略
- `capabilityHints` — 能力提示（流式、工具调用、视觉等）

catalog 只回答"这个 Provider 在系统里怎么被描述"，不回答"用户现在实际要连哪个账号"。

### provider profile

用户自己在设置页保存的配置。每条 profile 包含：

- 引用哪个 Provider
- base URL（自定义或使用默认值）
- 可用模型列表
- API Key 保存状态
- 是否可用于执行

普通信息和 API Key 分开保存。API Key 存在 secrets 层，不进公开配置。

### 默认模型路由 vs 请求级模型路由

- **默认模型路由**：设置页里保存的默认值，给聊天草稿提供一个初始选择。
- **请求级模型路由**：每次 `run/start` 请求里显式携带的模型路径。最终执行以这个为准。

两者不冲突：默认值提供便利，请求值决定执行。

### 模型路径格式

请求里的 `modelRoute` 格式：

```json
{
  "routeKind": "provider-model",
  "profileId": "provider-openai",
  "modelId": "gpt-4.1"
}
```

核心是 `profileId + modelId`：用哪个配置下的哪个模型。

## 宿主怎样解析模型路径

Electron 主进程负责检查这条路径是否可用。它会依次检查：

1. 这个 `profileId` 对应的配置是否存在
2. 它引用的 Provider 是否在 catalog 里
3. 这个 Provider 的 `runtimeStatus` 是否允许执行
4. 请求里的 `modelId` 是否真实存在
5. 如果请求带了 `catalogRevision`，是否和当前 catalog 版本一致
6. API Key 是否已经保存

全部通过后，宿主把解析结果（含认证信息）交给 Python 后端执行。API Key 不会进入 Python 后端的启动参数，只在执行时按需注入。

## 首次进入为什么是空白

CanDue 不默认预置任何模型配置。首次打开时：

- provider profile 是空的
- 默认模型路由是空的
- 聊天区可能提示"尚未配置模型"

这是正常行为，不是错误。

## 常见误解

- **目录里有条目 ≠ 当前就能执行**。有些 Provider 只保留在 catalog 里作为信息参考，实际不可用。
- **能新建配置 ≠ 已经可执行**。地址、密钥、模型列表都必须完整，聊天区才会出现可选模型。
- **API Key 不进请求体**。密钥只在 Electron 主进程内保存，通过宿主桥按需注入。

## 继续阅读

- [术语表](./glossary.md)
- [Thinking 能力说明](./thinking.md)
- [能力边界 / 状态总表](./capabilities.md)
- [运行时接口 / 事件参考](./runtime-events.md)

---
title: Thinking 能力说明
description: 说明 thinking 的概念、请求方式、能力查询和显示边界。
sidebar_position: 3
---

# Thinking 能力说明

## 先说结论

thinking 已经是当前能力的一部分，但不同模型路线的体验并不统一。正确的理解是：

1. 先查当前模型支持哪些 thinking 选项。
2. 用 `thinkingSelection` 提交本次选择（格式为 `series + value`）。
3. 运行时把请求值和实际应用值都记入 run 元数据。
4. 前端按当前路由和显示规则决定是否展示推理过程。

## 怎样请求 thinking

请求格式是 `series + value`：

```json
{
  "policy": {
    "thinkingSelection": {
      "series": "unified-4-level-v1",
      "value": {
        "valueType": "code",
        "code": "medium",
        "labelZh": "中"
      }
    }
  }
}
```

- `series` 表示使用哪组模板（如开/关、四档、预算）。
- `value` 表示在这组模板里选了哪一项。

## 为什么不统一成一套选项

不同模型和 Provider 的 thinking 能力不一样：

- 有的只有开/关。
- 有的分四档或六档。
- 有的按预算控制。

所以当前先承认它们属于不同 `series`，再由前端和运行时在需要时做有限统一。

## 能力查询

发送 `thinking/capability/get` 可以查当前模型路由的 thinking 能力：

- 是否支持 thinking。
- 属于哪种 series。
- 允许哪些值。
- 默认值是什么。

这避免用户选了不支持的选项才发现不行。

## run 元数据

thinking 相关元数据包括：

| 字段 | 含义 |
| --- | --- |
| `requestedThinkingSelection` | 你请求的选项 |
| `appliedThinkingSelection` | 运行时实际应用的选项（可能被调整） |
| `thinkingCapabilitySnapshot` | 运行时看到的 capability 快照 |
| `thinkingSeriesDecision` | 运行时对这次请求的映射/接受/调整/拒绝结果 |
| `reasoningSuppressionBasis` | 如果没有显示推理过程，依据是什么 |

## 用户能观察到什么

- 在支持的模型上，可以选择 thinking 强度或模式。（已可用）
- 如果模型与 Provider 组合的 API 输出推理内容，界面会通过 `reasoning_delta` 事件流式展示推理过程。（已可用）
- 如果组合不支持展示推理，运行时会在 run 元数据中给出 `reasoningSuppressionBasis` 说明原因。

## 常见 series 示例

前端已内置多组 series 模板：

- 思考开关
- 四档思考
- 六档思考
- 思考预算

具体哪条路由对应哪组 series，以 capability 查询结果为准。

## 当前边界

- 旧字段 `thinkingLevelIntent` 不再使用，当前主字段是 `policy.thinkingSelection`。
- 不同 Provider、不同模型的 thinking 体验不完全一致。
- 推理过程展示由运行时统一通过 `reasoning_delta` 事件流处理；是否输出推理内容取决于模型/Provider 的 API。

| 主题 | 状态 |
| --- | --- |
| capability 查询 | 已可用 |
| `thinkingSelection` 请求 | 已可用 |
| run 元数据回传 | 已可用 |
| 跨 Provider 统一体验 | 部分接通 |
| reasoning 展示 | 已可用 |

## 继续阅读

- [术语表](./glossary.md)
- [Provider 与模型路由说明](./providers-and-routing.md)
- [能力边界 / 状态总表](./capabilities.md)
- [运行时接口 / 事件参考](./runtime-events.md)

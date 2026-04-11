---
title: Thinking 能力说明
description: 说明当前 thinking 的概念、请求方式、能力查询方式、可见行为和边界。
sidebar_position: 3
---

# Thinking 能力说明

- 这页给谁看：想知道 thinking 现在到底是什么、怎样请求、为什么不同模型表现不同的使用者和开发者。
- 这页解决什么问题：统一说明 thinking 的当前口径，避免继续把旧的 intent / 档位叙事当成现状。
- 当前覆盖到哪：覆盖当前代码和测试已经落地的 thinking 查询、请求、元数据和显示边界，不扩展未来草案。
- 当前状态：thinking 基础能力已可用；跨 Provider 统一体验部分接通。

## 先说结论

thinking 已经是当前能力的一部分，但它并不是一套所有模型都一样的固定选项。当前更准确的理解是：

- 先按当前模型路由查询 capability。
- 再用 `thinkingSelection` 提交本次选择。
- 运行时把 requested 和 applied 的结果写进 run 元数据。
- 前端按当前路由和展示规则决定要不要显示 reasoning 信息。

## 当前请求口径是什么

现在推荐理解为：一次 thinking 请求由 `series + value` 组成。

示意结构如下：

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

这代表：

- `series` 说明你在使用哪一组 thinking 选择模板。
- `value` 说明你在这组模板里实际选了哪一项。

## 为什么不再用旧 intent 口径

原因很简单：不同 Provider、不同模型路由的 thinking 选项并不完全一样。

- 有的更像开关。
- 有的更像离散档位。
- 有的更像预算控制。

所以当前更可靠的表达方式，是先承认它们属于不同 series，再由前端和运行时在需要时做有限统一。

## 当前 capability 怎么查

当前可以单独查询 thinking capability。它回答的是：

- 这条模型路由支不支持 thinking。
- 支持的话，属于哪种 series。
- 允许哪些值。
- 默认值是什么。

这一步能避免“用户先选了一个值，发请求时才发现根本不支持”的情况。

## run 元数据里现在会留下什么

当前 thinking 相关元数据至少会围绕下面几项展开：

- `requestedThinkingSelection`
- `appliedThinkingSelection`
- `thinkingCapabilitySnapshot`
- `thinkingSeriesDecision`
- `reasoningSuppressionBasis`

它们分别回答的是：

- 你原本请求了什么。
- 运行时最后真正用了什么。
- 运行时当时看到的 capability 快照是什么。
- 这次映射、接受、调整或拒绝的公开结果是什么。
- 如果 reasoning 没有展示出来，依据是什么。

## 使用者现在能观察到什么

从使用者视角，thinking 现在更适合这样理解：

- 你可以在支持的模型路由上选择 thinking 强度或模式。状态：已可用。
- 某些路由会产生更明确的 reasoning 可见行为。状态：部分接通。
- 某些路由虽然支持 thinking 请求，但不会把 reasoning 直接完整展示出来。状态：部分接通。

所以“thinking 已接上”和“thinking 在所有路由上都呈现同样的可见效果”不是一回事。

## 当前常见的 series 例子

前端当前已经内置了多组常见 series 模板，例如：

- 思考开关。
- 四档思考。
- 六档思考。
- 思考预算。

这些例子说明当前系统已经准备好了按 series 建模 thinking 的主框架。但具体哪一条模型路由对应哪组 series，仍然要以那条 route 的 capability 为准。

## 当前边界最容易误写的地方

### 不要再把 `thinkingLevelIntent` 写成现行主字段

当前主字段是 `policy.thinkingSelection`。旧的 intent 口径不能再当主路径继续写。

### 不要把所有模型都写成同一种 thinking 体验

当前只能说 thinking 能力框架已经接上，不能说所有 Provider、所有模型、所有显示效果都完全统一。

### 不要把“能请求 thinking”和“能稳定显示 reasoning”写成同一个结论

前者更多是请求和路由层事实。后者还会受模型、映射结果和显示策略影响。

## 当前状态小结

| 主题 | 当前状态 | 说明 |
| --- | --- | --- |
| capability 查询 | 已可用 | 可以按当前模型路由判断支持情况。 |
| `thinkingSelection` 请求 | 已可用 | 主路径已经按 `series + value` 组织。 |
| run 元数据回传 | 已可用 | requested、applied、capability 快照和 decision 都已进入主链。 |
| 跨 Provider 统一体验 | 部分接通 | 有统一框架，但不同 route 的行为和显示仍有差异。 |
| 旧口径继续作为主路径 | 规划中 | 这一项表示不会回退到旧主路径。 |

## 相关页面

- [术语表](./glossary.md)
- [Provider 与模型路由说明](./providers-and-routing.md)
- [能力边界 / 状态总表](./capabilities.md)
- [运行时接口 / 事件参考](./runtime-events.md)

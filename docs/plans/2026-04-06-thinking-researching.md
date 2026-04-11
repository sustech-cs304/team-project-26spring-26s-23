各家把“reasoning 挡位”做成了**至少 8 类不同的表达方式**，而且很多家其实不止一个维度，常把这几件事混在一起：

1. **是否开启 reasoning**
2. **reasoning 深度/强度**
3. **reasoning 是否自动决定（auto/adaptive/dynamic）**
4. **reasoning 是否按 token 预算控制**
5. **reasoning 是否可见、是 raw 还是 summary**

所以你看到“无 / auto”“无 / 有”“无 / low / medium / high”“无 / low / medium / high / xhigh”，本质上往往不是同一维度。

---

# 一、最核心结论

## 结论 1：主流模型的 reasoning 控制，当前大致分成这 8 种“格式”

### 1) **完全没有挡位，模型固定会推理**
典型：
- **DeepSeek `deepseek-reasoner`**
- **Mistral `magistral-small-latest` / `magistral-medium-latest`**
- **Kimi `kimi-k2-thinking`**

特点：
- 没有 low/medium/high
- 直接就是 reasoning model，**默认且强制开启**
- 有的会返回 reasoning trace / reasoning_content

---

### 2) **纯二值开关：有 / 无**
典型：
- **Qwen3**：`enable_thinking=true/false`
- **Kimi `kimi-k2.5`**：thinking 默认开，也可 `disabled`
- **Anthropic Claude**：`thinking.type = disabled / enabled`

特点：
- 只有开和关
- 不是分档位，而是 mode switch

---

### 3) **关 / 自动（off / auto 或 dynamic）**
典型：
- **Gemini 2.5 Flash / Flash-Lite**：`thinkingBudget=0` 关闭，`-1` 表示 dynamic
- **Anthropic Claude 4.6 adaptive**：`thinking.type="adaptive"`，由模型自己决定要不要想、想多少

特点：
- 不是手动 low/medium/high
- 而是**关掉**，或**交给模型自动决定**

---

### 4) **2 档离散枚举**
典型：
- **xAI `grok-3-mini`**：`low / high`
- **Mistral `mistral-small-latest` adjustable reasoning**：`none / high`

特点：
- 档位很少
- 更像“快 / 深”两档

---

### 5) **4 档离散枚举**
典型：
- **Gemini 3**：`minimal / low / medium / high`

特点：
- 这类看起来最像传统“挡位”
- 但要注意：
  - Gemini 3 的 `minimal` **不等于严格关闭**
  - 某些 Gemini 3 模型甚至**不支持完全关闭 thinking**

---

### 6) **5 档表达**
典型：
- **Anthropic Claude adaptive thinking**
  从使用视角可以抽象成：
  - `disabled`
  - `low`
  - `medium`
  - `high`
  - `max`（Opus 4.6 才有）

特点：
- 严格说 Anthropic 不是把它做成一个单一枚举字段
- 而是 `thinking.type=adaptive` + `effort`
- 但从产品语义上，确实可以看成“无 + 4 档”

---

### 7) **6 档离散枚举**
典型：
- **OpenAI GPT-5 系列的总超集**：
  - `none`
  - `minimal`
  - `low`
  - `medium`
  - `high`
  - `xhigh`

特点：
- 这是目前我查到的**最细的离散档位体系之一**
- 但注意：**不是每个 OpenAI 模型都支持这 6 档**
  - 有些只支持 `low/medium/high`
  - 有些支持 `none`
  - 有些只支持 `high`
  - `xhigh` 只在个别模型支持

---

### 8) **连续 token 预算型**
典型：
- **Anthropic Claude manual thinking**：`budget_tokens = N`
- **Gemini 2.5**：`thinkingBudget = N`

特点：
- 不是 low/medium/high
- 而是给一个整数预算
- 本质上是**连续型 reasoning 档位**

---

# 二、按厂商/模型看，当前能归纳成什么样

下面是我整理后的“当前主流模型 reasoning 格式表”。

| 厂商 | 代表模型 | 控制方式 | 当前格式 |
|---|---|---|---|
| OpenAI | GPT-5 / GPT-5.1 / GPT-5.2 / codex / o 系列 | `reasoning.effort` / `reasoning_effort` | **总超集：none / minimal / low / medium / high / xhigh**，但**单模型只支持子集** |
| Anthropic | Claude 4.6 / 4.5 / 4 / 3.7 | `thinking.type` + `effort` 或 `budget_tokens` | **disabled / adaptive(low/medium/high/max)** 或 **enabled + budget_tokens** |
| Google | Gemini 3 | `thinkingLevel` | **minimal / low / medium / high** |
| Google | Gemini 2.5 | `thinkingBudget` | **0=off / -1=dynamic / 正整数 budget** |
| xAI | grok-3-mini | `reasoning_effort` | **low / high** |
| xAI | grok-3 / grok-4 / grok-4-fast-reasoning | 无该参数 | **无可调档位** |
| DeepSeek | deepseek-reasoner | 固定推理模型 | **始终 reasoning，无 effort 档位** |
| Mistral | mistral-small-latest | `reasoning_effort` | **none / high** |
| Mistral | magistral-small / medium | 原生 reasoning model | **始终 reasoning，无档位** |
| Kimi | kimi-k2-thinking | 固定推理模型 | **始终 reasoning** |
| Kimi | kimi-k2.5 | thinking 开关 | **enabled / disabled**（默认 enabled） |
| Qwen | Qwen3 | `enable_thinking` | **true / false**；还支持 `/think` 与 `/no_think` |

---

# 三、几个特别重要的细节

## 1) OpenAI 其实不是“只有一种格式”
这是最容易被误解的。

### OpenAI 当前不是单一枚举，而是“每个模型支持不同子集”
我查到的官方说明可以归纳成：

- **老一些的 reasoning 模型 / o 系列**：常见是
  `low / medium / high`
- **原始 GPT-5 reasoning 模型**：支持
  `minimal / low / medium / high`
- **GPT-5.1 / 5.2 某些模型**：支持
  `none / low / medium / high`
- **`gpt-5-pro`**：只支持
  `high`
- **`gpt-5.1-codex-max`**：额外支持
  `xhigh`

所以如果你问“OpenAI 到底几档”，**正确答案不是一个数字**，而是：

> **OpenAI 家族的 reasoning effort 总超集是 6 档，但单个模型通常只支持其中一部分。**

---

## 2) Anthropic 不是“low/medium/high”那么简单
Claude 当前至少有两套 thinking 机制：

### A. 老/通用手动模式
- `thinking.type = enabled`
- `budget_tokens = N`

这不是离散档位，而是**预算型**

### B. Claude 4.6 的 adaptive 模式
- `thinking.type = adaptive`
- `effort = low / medium / high / max`

此外还存在：
- `disabled`

所以 Anthropic 更像：
> **mode + effort**
而不是单一 `reasoning_effort enum`

---

## 3) Gemini 2.5 和 Gemini 3 是两套体系
这个也很容易混。

### Gemini 3
- `thinkingLevel = minimal / low / medium / high`

### Gemini 2.5
- `thinkingBudget = N`
- `0 = off`
- `-1 = dynamic`

也就是说，Google 自家内部就已经有：
- **离散档位制**
- **token 预算制**
两套并存。

---

## 4) “auto” 往往不是 reasoning 档位，而是自动决策模式
你提到有些产品是“无和 auto”，这个现象我现在的判断是：

很多时候这个 **auto 并不是 reasoning depth 档位**，而是下面几种之一：

- **自动决定是否思考**
  例如 Anthropic adaptive / Gemini dynamic
- **自动决定 summary 详细程度**
  例如 OpenAI 的 `reasoning.summary = auto`
- **UI 层的抽象选项**
  平台自己把多个底层参数折叠成 `off / auto / on`

所以：
> **“auto” 常常不应和 low/medium/high 放在同一个维度里比较。**

---

# 四、如果只按“你能看到多少档”来统计

这是最贴近你原问题的版本。

## 当前我确认到的“reasoning 档位格式”有：

### A. 1 种状态
- **始终 reasoning**
- 例子：DeepSeek reasoner / Magistral / kimi-k2-thinking

### B. 2 种状态
- **有 / 无**
- **off / auto**
- **low / high**
- **none / high**

也就是说，“2 档”其实还有**多种不同语义**。

### C. 4 种状态
- `minimal / low / medium / high`
- 例子：Gemini 3

### D. 5 种状态
- `disabled / low / medium / high / max`
- 例子：Claude adaptive 的使用视角

### E. 6 种状态
- `none / minimal / low / medium / high / xhigh`
- 例子：OpenAI GPT-5 家族总超集

### F. 非离散状态
- `budget_tokens = N`
- `thinkingBudget = N`
- 连续预算型

---

# 五、我认为最靠谱的统一抽象

如果你后面要做多模型统一接入，**不要把 reasoning 只抽象成一个枚举字段**。
更合理的是拆成 4 个维度：

```ts
type ReasoningMode =
  | "off"        // 不推理
  | "on"         // 明确开启
  | "auto"       // 自动决定是否推理
  | "forced";    // 模型天然就是 reasoning model

type ReasoningLevel =
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "max"
  | "xhigh"
  | null;

type ReasoningBudget = number | null; // token budget

type ReasoningVisibility =
  | "hidden"     // 不返回推理内容
  | "summary"    // 返回摘要
  | "raw"        // 返回原始 reasoning_content
  | "encrypted"; // 返回签名/加密内容
```

这样才能同时覆盖：
- OpenAI 的 effort 档位
- Claude 的 adaptive + budget_tokens
- Gemini 的 thinkingLevel / thinkingBudget
- DeepSeek/Kimi 的 reasoning_content
- Qwen 的 enable_thinking

---

# 六、最终版结论

如果一句话总结：

> **“reasoning 挡位”目前并没有行业统一标准。**
> 我查到的主流模型中，至少存在 **8 类表示格式**：
> **固定开启、二值开关、off/auto、2 档枚举、4 档枚举、5 档枚举、6 档枚举、连续 token 预算**。
> 其中最常见的离散形式是：
> **2 档、4 档、5 档、6 档**；
> 而 **Anthropic / Gemini** 还大量使用 **auto/adaptive 或 budget**，
> **DeepSeek / Magistral / kimi-k2-thinking** 则属于**固定 reasoning 模型**。

---
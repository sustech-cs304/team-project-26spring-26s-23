# 🌌 大模型统一“思考挡位” UI 组件设计与实现

## 一、 背景与设计缘由（Design Rationale）

随着 OpenAI o 系列、DeepSeek-R1、Claude 3.7 等带有“推理/思考”能力的模型爆发，各大模型厂商对“思考强度”的控制参数呈现出**极度碎片化**的乱象。

根据前期的 API 调研结论，目前市面上至少存在 **8 种完全不同的控制格式**：从 OpenAI 复杂的 6 档枚举（`none` 到 `xhigh`），到 Claude 的自适应模式（`adaptive`），再到 Gemini 2.5 的连续 Token 预算（`budget`），甚至还有 DeepSeek 这种强制固定的推理模型。

如果将这些乱象直接暴露给用户，会造成极大的认知负担。因此，本组件的设计初衷是：**在极其复杂的底层逻辑之上，构建一个视觉统一、操作直觉、专业克制的全局单选控制中心。**

### 1. 为什么采用“下拉框 + 动态展现”的布局？
最初的设计是平铺卡片或直角列表，但 8 大分类全部平铺会占用过大面积，使得界面显得臃肿杂乱。
改为**定制化下拉框**后，界面回归了“专业、冷静”的极简主义。用户在下拉框中选择“派系风格”，下方区域则“按需分配”对应格式的控件（胶囊或滑块）。这种空间复用不仅降低了视觉噪音，也确立了“全局有且仅有一种风格生效”的直觉设定。

### 2. 为什么需要非线性 Token 滑块？
对于“连续 Token 预算型”控制，Token 数的跨度极大（从 0 到 1,000,000+）。如果使用常规的线性滑块，用户根本无法精准选到 4K 或 32K 这样的常用阈值。因此，我们必须在视觉上将其等距切分，但在数据逻辑上采用**多段非线性映射**，以满足人类对指数级数据的直觉操作需求。

---

## 二、 核心设计细节（Design Details）

本组件采用 **原生 HTML + CSS + JS** 零依赖开发，确保了极致的加载速度与跨框架的易移植性。

### 1. 视觉风格：暗黑极客风与双重光晕
*   **配色系统**：背景采用深邃的 `#1a1c23` 与面板色 `#21252d`，营造专业开发工具的沉浸感。

### 2. 信息层级：昵称与真实代码的融合
胶囊内采用了**双排版设计**：
*   左侧常规字体：展示易读的中文昵称（如“超高”、“无”）。
*   右侧等宽字体：展示对应的真实 API 参数值（如 `xhigh`、`none`），采用更小的字号与 `0.55` 的透明度。
这种排版既满足了普通用户的一目了然，又满足了极客/开发者核对底层参数的严谨需求，无需多余的解释说明（Tooltips）。

### 3. 动效体验：级联进场与丝滑过渡
*   当下拉框切换时，底部的胶囊不会生硬地瞬间出现。通过 JS 动态注入递增的 `animationDelay`，胶囊会呈现出**从左至右依次淡入并放大（Scale）的级联加载特效**，赋予了界面灵动的高级感。
*   下拉框本身也完全由 DIV 模拟绘制，拥有原生 `<select>` 无法实现的悬停变色、选中高亮以及外发光动画。

### 4. 连续滑块：非线性分段与微磁吸（Snapping）
连续预算滑块是技术实现最为精妙的部分：
*   **视觉等分**：滑块轨道在 UI 上被等分为 4 段（0, 25%, 50%, 75%, 100%）。
*   **分段线性插值**：通过 JS 中的 `getTokensFromProgress` 函数，将进度百分比映射为真实的 Token 值：
    *   `0~25%` 映射 `0 ~ 4,096`
    *   `25%~50%` 映射 `4,096 ~ 32,768`
    *   `50%~75%` 映射 `32,768 ~ 131,072`
    *   `75%~100%` 映射 `131,072 ~ 1,048,576`
*   **磁吸交互**：在代码逻辑中加入了 `snap = 1.5` 的阈值判断。当用户的拖动非常接近这几个核心锚点时，数值会自动吸附到极度规整的边缘值（如正好落在 32,768），极大提升了操作手感。

---

## 三、 完整 HTML 源码示例 (Source Code)

注意，需要做适配和调整才能应用到实际项目中

当前仅有夜间模式的视效，需要自行适配日间等等

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>思考挡位风格 - 完整版</title>
    <style>
        /* ================= 颜色与变量定义 ================= */
        :root {
            --bg-color: #1a1c23;        
            --panel-bg: #21252d;        
            --input-bg: #15171e;        
            --border-color: #333945;    
            --hover-bg: #282c35;        
          
            --text-primary: #f8f9fa;    
            --text-regular: #d1d5db;    
          
            --active-color: #c7bbf5;    
            --active-bg: #30284b;       
            --active-border: #7c68e3;   
            --active-shadow: rgba(124, 104, 227, 0.35); 
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            background-color: var(--bg-color);
            font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", Arial, sans-serif;
            display: flex;
            justify-content: center;
            padding: 60px 20px;
            min-height: 100vh;
        }

        /* ================= 面板与下拉框 ================= */
        .settings-panel {
            width: 100%;
            max-width: 720px;
            background-color: var(--panel-bg);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 24px 32px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
        }

        .setting-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 20px;
        }

        .panel-title {
            font-size: 15px;
            font-weight: 500;
            color: var(--text-primary);
            white-space: nowrap;
        }

        .custom-select-wrapper {
            position: relative;
            width: 340px;
            user-select: none;
        }

        .select-trigger {
            background-color: var(--input-bg);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 10px 16px;
            font-size: 14px;
            color: var(--text-regular);
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            align-items: center;
            transition: all 0.2s ease;
        }

        .custom-select-wrapper.open .select-trigger {
            border-color: var(--active-border);
            box-shadow: 0 0 0 2px rgba(124, 104, 227, 0.2);
        }

        .arrow-icon {
            width: 12px;
            height: 12px;
            fill: none;
            stroke: #8b92a5;
            stroke-width: 2;
            transition: transform 0.3s ease;
        }

        .custom-select-wrapper.open .arrow-icon {
            transform: rotate(180deg);
            stroke: var(--active-color);
        }

        .select-options {
            position: absolute;
            top: calc(100% + 8px);
            left: 0; right: 0;
            background-color: var(--panel-bg);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
            opacity: 0; visibility: hidden;
            transform: translateY(-10px);
            transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
            z-index: 100;
            max-height: 320px; overflow-y: auto;
        }

        .select-options::-webkit-scrollbar { width: 6px; }
        .select-options::-webkit-scrollbar-thumb { background: #4b5563; border-radius: 3px; }

        .custom-select-wrapper.open .select-options {
            opacity: 1; visibility: visible; transform: translateY(0);
        }

        .select-option {
            padding: 12px 16px;
            font-size: 14px;
            color: var(--text-regular);
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .select-option:hover {
            background-color: var(--hover-bg);
            color: var(--text-primary);
        }

        .select-option.selected {
            background-color: rgba(124, 104, 227, 0.1);
            color: var(--active-color);
            font-weight: 500;
        }

        /* ================= 底部内容区 ================= */
        .content-area {
            margin-top: 24px;
            padding-top: 24px;
            border-top: 1px dashed var(--border-color);
            min-height: 52px;
        }

        /* ----- 发光挡位胶囊 (离散型) ----- */
        .pills-container {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
            justify-content: flex-end;
        }

        .pill {
            display: inline-flex; align-items: baseline; gap: 6px; 
            background-color: var(--active-bg);
            border: 1px solid var(--active-border);
            color: var(--active-color);
            box-shadow: 0 0 12px var(--active-shadow), 0 0 0 1px var(--active-border) inset;
            padding: 6px 16px; border-radius: 9999px;
            animation: fadeInPill 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
            opacity: 0; transform: scale(0.95);
        }

        .pill-name { font-size: 13px; font-weight: 500; }
        .pill-code {
            font-family: "SFMono-Regular", Consolas, monospace;
            font-size: 11px; opacity: 0.55; font-weight: 400;
        }

        @keyframes fadeInPill {
            to { opacity: 1; transform: scale(1); }
        }

        /* ----- 多段滑块 (连续型) ----- */
        .slider-ui {
            display: none; 
            animation: fadeInPill 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
            padding: 0 10px;
        }

        .slider-header {
            display: flex; justify-content: space-between; align-items: center;
            margin-bottom: 24px;
        }

        .slider-title {
            font-size: 14px; color: var(--text-regular); font-weight: 500;
        }

        .slider-value-display {
            font-family: "SFMono-Regular", Consolas, monospace;
            font-size: 14px; color: var(--active-color); font-weight: 600;
            background-color: rgba(124, 104, 227, 0.1);
            border: 1px solid rgba(124, 104, 227, 0.3);
            padding: 6px 12px; border-radius: 6px;
        }

        .slider-body { position: relative; height: 50px; }

        .track-bounds {
            position: absolute; top: 12px; left: 10px; right: 10px;
            height: 6px; pointer-events: none;
        }

        .track-bg {
            position: absolute; top: 0; left: 0; right: 0; bottom: 0;
            background-color: var(--input-bg); border: 1px solid var(--border-color); border-radius: 4px;
        }

        .track-fill {
            position: absolute; top: 0; left: 0; bottom: 0;
            background-color: var(--active-border); border-radius: 4px;
            box-shadow: 0 0 8px var(--active-shadow);
            transition: width 0.1s linear;
        }

        .slider-dot {
            position: absolute; top: 3px;
            width: 10px; height: 10px;
            background-color: var(--panel-bg); border: 2px solid var(--border-color);
            border-radius: 50%; transform: translate(-50%, -50%);
            z-index: 2; transition: all 0.2s;
        }

        .slider-dot.active {
            border-color: var(--active-border); background-color: var(--active-color);
            box-shadow: 0 0 6px var(--active-shadow);
        }

        .slider-label {
            position: absolute; top: 24px; transform: translateX(-50%);
            font-size: 11px; color: var(--text-regular);
            font-family: "SFMono-Regular", Consolas, monospace;
            opacity: 0.5; transition: all 0.2s;
        }

        .slider-label.active {
            color: var(--active-color); font-weight: 600; opacity: 1;
        }

        /* 原生滑块透明叠放，提供原生阻尼交互 */
        input[type=range].custom-range {
            -webkit-appearance: none; appearance: none;
            width: 100%; height: 30px; background: transparent; margin: 0;
            position: absolute; top: 0; left: 0; z-index: 5; cursor: pointer;
        }
        input[type=range].custom-range:focus { outline: none; }

        input[type=range].custom-range::-webkit-slider-runnable-track { width: 100%; height: 30px; background: transparent; border: none; }
        input[type=range].custom-range::-webkit-slider-thumb {
            -webkit-appearance: none; height: 20px; width: 20px; border-radius: 50%;
            background: #eef2f6; border: 4px solid var(--active-border);
            box-shadow: 0 0 10px var(--active-shadow);
            margin-top: 5px; transition: transform 0.1s;
        }
        input[type=range].custom-range::-webkit-slider-thumb:active { transform: scale(1.15); }

        input[type=range].custom-range::-moz-range-track { width: 100%; height: 30px; background: transparent; border: none; }
        input[type=range].custom-range::-moz-range-thumb {
            height: 12px; width: 12px; border-radius: 50%;
            background: #eef2f6; border: 4px solid var(--active-border);
            box-shadow: 0 0 10px var(--active-shadow); transition: transform 0.1s;
        }
        input[type=range].custom-range::-moz-range-thumb:active { transform: scale(1.15); }

    </style>
</head>
<body>

<div class="settings-panel">
    <div class="setting-row">
        <div class="panel-title">思考挡位风格</div>
      
        <div class="custom-select-wrapper" id="customSelect">
            <div class="select-trigger" onclick="toggleDropdown()">
                <span id="triggerText">OpenAI 5.xx+ 系总超集</span>
                <svg class="arrow-icon" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </div>
            <div class="select-options" id="optionsContainer"></div>
        </div>
    </div>

    <div class="content-area">
        <!-- 正常离散枚举的挡位胶囊 -->
        <div class="pills-container" id="pillsContainer"></div>

        <!-- 连续预算型独占的多段滑块 -->
        <div class="slider-ui" id="sliderContainer">
            <div class="slider-header">
                <span class="slider-title">精确推理 Token 预算</span>
                <span class="slider-value-display"><span id="tokenValue">4,096</span> Tokens</span>
            </div>
            <div class="slider-body">
                <div class="track-bounds">
                    <div class="track-bg"></div>
                    <div class="track-fill" id="trackFill" style="width: 25%;"></div>
                  
                    <div class="slider-dot active" style="left: 0%;"></div>
                    <div class="slider-dot active" style="left: 25%;"></div>
                    <div class="slider-dot" style="left: 50%;"></div>
                    <div class="slider-dot" style="left: 75%;"></div>
                    <div class="slider-dot" style="left: 100%;"></div>
                  
                    <div class="slider-label active" style="left: 0%;">0</div>
                    <div class="slider-label active" style="left: 25%;">4K</div>
                    <div class="slider-label" style="left: 50%;">32K</div>
                    <div class="slider-label" style="left: 75%;">128K</div>
                    <div class="slider-label" style="left: 100%;">1M</div>
                </div>
                <input type="range" class="custom-range" id="budgetRange" min="0" max="100" value="25" step="0.1">
            </div>
        </div>
    </div>
</div>

<script>
    // 完整 8 大核心数据模型映射
    const seriesData = [
        { 
            id: "openai", name: "OpenAI 5.xx+ 系总超集", type: "pills",
            pills: [
                { name: "无", code: "none" }, 
                { name: "极低", code: "minimal" }, 
                { name: "低", code: "low" }, 
                { name: "中", code: "medium" }, 
                { name: "高", code: "high" }, 
                { name: "超高", code: "xhigh" }
            ] 
        },
        { 
            id: "anthropic", name: "Anthropic Claude Adaptive", type: "pills",
            pills: [
                { name: "关闭", code: "disabled" }, 
                { name: "低", code: "low" }, 
                { name: "中", code: "medium" }, 
                { name: "高", code: "high" }, 
                { name: "最大", code: "max" }
            ] 
        },
        { 
            id: "gemini3", name: "Gemini 3 系", type: "pills",
            pills: [
                { name: "极低", code: "minimal" }, 
                { name: "低", code: "low" }, 
                { name: "中", code: "medium" }, 
                { name: "高", code: "high" }
            ] 
        },
        { 
            id: "auto", name: "自动决策型 (Gemini / Claude)", type: "pills",
            pills: [
                { name: "关闭", code: "0 / off" }, 
                { name: "自动", code: "dynamic / adaptive" }
            ] 
        },
        { 
            id: "two-tier", name: "两档枚举型 (xAI / Mistral)", type: "pills",
            pills: [
                { name: "低 / 无", code: "low / none" }, 
                { name: "高", code: "high" }
            ] 
        },
        { 
            id: "switch", name: "纯二值开关 (Qwen3 / Kimi)", type: "pills",
            pills: [
                { name: "关闭", code: "false / disabled" }, 
                { name: "开启", code: "true / enabled" }
            ] 
        },
        { 
            id: "fixed", name: "固定推理型 (DeepSeek 等)", type: "pills",
            pills: [
                { name: "始终推理", code: "fixed / auto" }
            ] 
        },
        { 
            id: "budget", name: "连续 Token 预算型", type: "slider" 
        }
    ];

    let currentSelectedId = "openai";

    const selectWrapper = document.getElementById('customSelect');
    const triggerText = document.getElementById('triggerText');
    const optionsContainer = document.getElementById('optionsContainer');
    const pillsContainer = document.getElementById('pillsContainer');
    const sliderContainer = document.getElementById('sliderContainer');
    const budgetRange = document.getElementById('budgetRange');

    function init() {
        seriesData.forEach(item => {
            const div = document.createElement('div');
            div.className = `select-option ${item.id === currentSelectedId ? 'selected' : ''}`;
            div.textContent = item.name;
            div.onclick = () => selectOption(item.id, item.name);
            optionsContainer.appendChild(div);
        });
        renderContent(currentSelectedId);
    }

    function toggleDropdown() { selectWrapper.classList.toggle('open'); }

    function selectOption(id, name) {
        currentSelectedId = id;
        triggerText.textContent = name;
        Array.from(optionsContainer.children).forEach(child => {
            child.classList.toggle('selected', child.textContent === name);
        });
        selectWrapper.classList.remove('open');
        renderContent(id);
    }

    function renderContent(id) {
        const targetData = seriesData.find(item => item.id === id);
        if (!targetData) return;

        if (targetData.type === 'slider') {
            pillsContainer.style.display = 'none';
            sliderContainer.style.display = 'block';
            updateSliderUI(budgetRange.value); 
        } else {
            sliderContainer.style.display = 'none';
            pillsContainer.style.display = 'flex';
            pillsContainer.innerHTML = '';
          
            targetData.pills.forEach((pillObj, index) => {
                const pillContainer = document.createElement('div');
                pillContainer.className = 'pill';
                pillContainer.style.animationDelay = `${index * 0.05}s`; 
              
                pillContainer.innerHTML = `
                    <span class="pill-name">${pillObj.name}</span>
                    <span class="pill-code">${pillObj.code}</span>
                `;
                pillsContainer.appendChild(pillContainer);
            });
        }
    }

    // ========== 连续滑块非线性映射逻辑 ==========
    function getTokensFromProgress(p) {
        // 微磁吸效果：靠近节点时吸附为标准值
        const snap = 1.5; 
        if (Math.abs(p - 0) < snap) return 0;
        if (Math.abs(p - 25) < snap) return 4096;
        if (Math.abs(p - 50) < snap) return 32768;
        if (Math.abs(p - 75) < snap) return 131072;
        if (Math.abs(p - 100) < snap) return 1048576;

        if (p <= 25) {
            return Math.round(0 + (p / 25) * 4096);
        } else if (p <= 50) {
            return Math.round(4096 + ((p - 25) / 25) * (32768 - 4096));
        } else if (p <= 75) {
            return Math.round(32768 + ((p - 50) / 25) * (131072 - 32768));
        } else {
            return Math.round(131072 + ((p - 75) / 25) * (1048576 - 131072));
        }
    }

    function updateSliderUI(val) {
        const p = parseFloat(val);
        document.getElementById('trackFill').style.width = p + '%';
      
        const dots = document.querySelectorAll('.slider-dot');
        const labels = document.querySelectorAll('.slider-label');
        [0, 25, 50, 75, 100].forEach((threshold, index) => {
            const isActive = p >= threshold;
            dots[index].classList.toggle('active', isActive);
            labels[index].classList.toggle('active', isActive);
        });

        const tokens = getTokensFromProgress(p);
        document.getElementById('tokenValue').textContent = tokens.toLocaleString();
    }

    budgetRange.addEventListener('input', (e) => updateSliderUI(e.target.value));
  
    document.addEventListener('click', (e) => {
        if (!selectWrapper.contains(e.target)) selectWrapper.classList.remove('open');
    });

    init();
</script>

</body>
</html>
```

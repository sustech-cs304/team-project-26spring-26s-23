"""Constants, localized copy, and schemas for the Copilot runtime tool registry."""

from __future__ import annotations

from typing import Any

from app.tooling.file_tools import (
    FILE_TOOL_EDIT_ID,
    FILE_TOOL_GLOB_ID,
    FILE_TOOL_GREP_ID,
    FILE_TOOL_NOTEBOOK_EDIT_ID,
    FILE_TOOL_READ_ID,
    FILE_TOOL_SWITCH_ROOT_ID,
    FILE_TOOL_WRITE_ID,
)

DEFAULT_TOOLSET_NAME = "default"
DEFAULT_TOOLSET_LABEL = "Default"
DEFAULT_TOOLSET_DESCRIPTION = (
    "Builtin Copilot runtime tools exposed as the default toolset directory."
)
DEFAULT_TOOL_DIRECTORY_VERSION = "tools-v1"
DEFAULT_TOOL_KIND = "builtin"
DEFAULT_TOOL_AVAILABILITY = "available"
DEFAULT_TOOL_CATALOG_LANGUAGE = "zh-CN"

FILE_CONVERT_TOOL_ID = "tool.file-convert"
FILE_CONVERT_TOOL_DISPLAY_NAME = "File Convert"
FILE_CONVERT_TOOL_DESCRIPTION = "Convert DOCX, PDF, and PPTX files into text."
FILE_CONVERT_TOOL_PROMPT = (
    "Use this tool to convert DOCX, PDF, or PPTX files into plain text before analysis."
)

WEATHER_CURRENT_TOOL_ID = "tool.weather-current"
WEATHER_CURRENT_TOOL_DISPLAY_NAME = "Current Weather"
WEATHER_CURRENT_TOOL_DESCRIPTION = (
    "Return a placeholder current-weather result for a requested location."
)
WEATHER_CURRENT_TOOL_PROMPT = (
    "Use this tool to retrieve a simple current weather summary for a location."
)

REQUEST_USER_FORM_TOOL_ID = "tool.request-user-form"
REQUEST_USER_FORM_TOOL_DISPLAY_NAME = "Request User Form"
REQUEST_USER_FORM_TOOL_DESCRIPTION = (
    "Request a controlled inline form in chat to collect structured user input needed to continue. "
    "Prefer it when structured fields, options, preferences, constraints, confirmations, or parameters would be clearer than free-text follow-up, even for a single field."
)
REQUEST_USER_FORM_TOOL_PROMPT = (
    "Use this tool proactively when the next step depends on user-provided structured information and a form would be clearer than another natural-language question. "
    "A single-field form is acceptable if it helps the user answer more clearly; multiple related fields should usually be grouped into one form. "
    "The submitted form will arrive as the user's next message so the conversation can continue. "
    "Write a short user-facing title and description that explain why the information is needed, use natural-language labels and concrete placeholders, mark only truly required fields as required, use select for choices from a fixed list, use checkbox only for a single boolean confirmation without options, and use text or textarea for open explanations. "
    "Do not request file uploads, secrets, passwords, or tokens, and do not expose protocol details such as form ids, field counts, JSON, or field type internals to the user."
)

BROWSER_OPEN_TOOL_ID = "browser.open"
BROWSER_OPEN_TOOL_DISPLAY_NAME = "Browser Open"
BROWSER_OPEN_TOOL_DESCRIPTION = "Open a URL in the desktop runtime browser window."
BROWSER_OPEN_TOOL_PROMPT = (
    "Use this tool to open a URL in the desktop runtime browser window and inspect the resulting page."
)

BROWSER_SCREENSHOT_TOOL_ID = "browser.screenshot"
BROWSER_SCREENSHOT_TOOL_DISPLAY_NAME = "Browser Screenshot"
BROWSER_SCREENSHOT_TOOL_DESCRIPTION = "Capture a screenshot from the desktop runtime browser window."
BROWSER_SCREENSHOT_TOOL_PROMPT = (
    "Use this tool to capture the current browser page as an artifact when visual inspection is needed."
)

BROWSER_SNAPSHOT_TOOL_ID = "browser.snapshot"
BROWSER_SNAPSHOT_TOOL_DISPLAY_NAME = "Browser Snapshot"
BROWSER_SNAPSHOT_TOOL_DESCRIPTION = "Capture an AI-friendly text snapshot from the desktop runtime browser window."
BROWSER_SNAPSHOT_TOOL_PROMPT = (
    "Use this tool to capture a compact text snapshot of the current browser page, including numbered references for interactive elements when page understanding is needed."
)

SKILL_ACTIVATE_TOOL_ID = "tool.skill-activate"
SKILL_ACTIVATE_TOOL_DISPLAY_NAME = "Skill Activate"
SKILL_ACTIVATE_TOOL_DESCRIPTION = (
    "Read the SKILL.md entry instructions and resource summaries for an enabled Skill."
)
SKILL_ACTIVATE_TOOL_PROMPT = (
    "Use this tool after checking the Available Skills list when a Skill matches the task. "
    "Pass the skill id or display name from the list."
)

SKILL_READ_RESOURCE_TOOL_ID = "tool.skill-read-resource"
SKILL_READ_RESOURCE_TOOL_DISPLAY_NAME = "Skill Read Resource"
SKILL_READ_RESOURCE_TOOL_DESCRIPTION = "Read a UTF-8 text resource listed by an enabled Skill without requiring prior activation."
SKILL_READ_RESOURCE_TOOL_PROMPT = (
    "Use this tool when you need a relative resource path listed in a Skill's resource summaries. "
    "Pass the skill id or display name plus the listed resource path."
)

FILE_TOOL_READ_DISPLAY_NAME = "File Read"
FILE_TOOL_READ_DESCRIPTION = (
    "Read UTF-8 text files from the workspace with line-based pagination."
)
FILE_TOOL_READ_PROMPT = "Use this tool to inspect workspace text files in paginated line ranges before making edits."
FILE_TOOL_WRITE_DISPLAY_NAME = "File Write"
FILE_TOOL_WRITE_DESCRIPTION = "Create or overwrite UTF-8 text files in the workspace with guarded overwrite semantics."
FILE_TOOL_WRITE_PROMPT = "Use this tool to create or replace a workspace text file when you know the full target content."
FILE_TOOL_EDIT_DISPLAY_NAME = "File Edit"
FILE_TOOL_EDIT_DESCRIPTION = (
    "Edit UTF-8 text files in the workspace using exact replacement semantics."
)
FILE_TOOL_EDIT_PROMPT = "Use this tool to replace exact text in a workspace UTF-8 file when you know the current snippet to match."
FILE_TOOL_GLOB_DISPLAY_NAME = "File Glob"
FILE_TOOL_GLOB_DESCRIPTION = (
    "Discover workspace files and directories by glob pattern without reading contents."
)
FILE_TOOL_GLOB_PROMPT = "Use this tool to discover workspace files or folders by glob pattern before reading them."
FILE_TOOL_GREP_DISPLAY_NAME = "File Grep"
FILE_TOOL_GREP_DESCRIPTION = (
    "Search workspace text files by literal or regex pattern with bounded line context."
)
FILE_TOOL_GREP_PROMPT = "Use this tool to search workspace text files and inspect nearby lines before reading or editing."
FILE_TOOL_NOTEBOOK_EDIT_DISPLAY_NAME = "Notebook Edit"
FILE_TOOL_NOTEBOOK_EDIT_DESCRIPTION = (
    "Edit workspace notebooks with transactional cell operations."
)
FILE_TOOL_NOTEBOOK_EDIT_PROMPT = "Use this tool to replace, insert, or delete notebook cells transactionally after inspecting notebook structure."
FILE_TOOL_SWITCH_ROOT_DISPLAY_NAME = "File Switch Root"
FILE_TOOL_SWITCH_ROOT_DESCRIPTION = (
    "Validate and resolve a new default file root directory for later tool calls."
)
FILE_TOOL_SWITCH_ROOT_PROMPT = "Use this tool to validate a directory as the next default root for subsequent file tool calls."

BUILTIN_TOOL_LOCALES: dict[str, dict[str, dict[str, str]]] = {
    "zh-CN": {
        FILE_CONVERT_TOOL_ID: {
            "displayName": "文件转换",
            "description": "将 DOCX、PDF 和 PPTX 文件转换为纯文本。",
            "prompt": "在分析前使用此工具将 DOCX、PDF 或 PPTX 文件转换为纯文本。",
        },
        FILE_TOOL_READ_ID: {
            "displayName": "文件读取",
            "description": "按行分页读取工作区内 UTF-8 文本文件。",
            "prompt": "使用此工具先读取工作区文本文件，再继续分析或修改。",
        },
        FILE_TOOL_WRITE_ID: {
            "displayName": "文件写入",
            "description": "在工作区内创建或覆写 UTF-8 文本文件，并带有保护性覆写语义。",
            "prompt": "使用此工具在已知完整目标内容时创建或整体覆写工作区文本文件。",
        },
        FILE_TOOL_EDIT_ID: {
            "displayName": "文件编辑",
            "description": "按精确字符串替换语义编辑工作区内 UTF-8 文本文件。",
            "prompt": "使用此工具基于 oldString/newString 对工作区文本文件执行精确替换，并可携带哈希与匹配次数保护。",
        },
        FILE_TOOL_GLOB_ID: {
            "displayName": "文件发现",
            "description": "按 glob 模式发现工作区内文件与目录，不读取内容。",
            "prompt": "使用此工具先发现匹配路径，再决定是否进一步读取。",
        },
        FILE_TOOL_GREP_ID: {
            "displayName": "文件搜索",
            "description": "按字面量或正则搜索工作区文本文件，并返回有限行上下文。",
            "prompt": "使用此工具在读取前先搜索工作区文本内容，并查看匹配附近的上下文。",
        },
        FILE_TOOL_NOTEBOOK_EDIT_ID: {
            "displayName": "Notebook 编辑",
            "description": "按 cell 级事务语义编辑工作区 notebook。",
            "prompt": "使用此工具对 notebook 执行 replace、insert、delete 等 cell 级事务编辑。",
        },
        FILE_TOOL_SWITCH_ROOT_ID: {
            "displayName": "文件根切换",
            "description": "验证并解析后续文件工具可使用的新默认根目录。",
            "prompt": "使用此工具校验某个目录能否作为后续文件工具调用的默认根。",
        },
        WEATHER_CURRENT_TOOL_ID: {
            "displayName": "当前天气",
            "description": "返回指定地点的占位当前天气结果。",
            "prompt": "使用此工具获取某个地点的简要当前天气摘要。",
        },
        REQUEST_USER_FORM_TOOL_ID: {
            "displayName": "请求用户表单",
            "description": "在聊天中请求用户填写受控内联表单，以收集继续任务所需的结构化信息；当结构化字段、选项、偏好、约束、确认或参数比自由文本追问更清晰时，应优先考虑使用，即使只有一个字段也可以。",
            "prompt": "当下一步依赖用户补充结构化信息，且表单比自然语言追问更清晰时，主动使用此工具。单字段表单也可以；多个相关字段更应合并为一个表单。表单提交后会作为用户下一条消息继续对话。标题和描述应面向用户并解释为何需要这些信息；字段标签使用自然语言，placeholder 给出具体示例，只把真正阻塞继续执行的字段标为必填；固定列表选项使用 select，checkbox 只用于单个布尔确认且不得携带 options，开放说明用 text 或 textarea。不要请求文件上传，也不要请求 secret、password、token 等敏感凭据；不要向用户暴露 form id、字段数量、JSON 或协议细节。",
        },
        BROWSER_OPEN_TOOL_ID: {
            "displayName": "浏览器打开",
            "description": "在桌面运行时的浏览器窗口中打开一个 URL。",
            "prompt": "使用此工具在桌面运行时的浏览器窗口中打开指定 URL，并检查页面结果。",
        },
        BROWSER_SCREENSHOT_TOOL_ID: {
            "displayName": "浏览器截图",
            "description": "从桌面运行时浏览器窗口捕获截图。",
            "prompt": "当需要视觉检查时，使用此工具捕获当前浏览器页面为工件。",
        },
        BROWSER_SNAPSHOT_TOOL_ID: {
            "displayName": "浏览器快照",
            "description": "从桌面运行时浏览器窗口捕获适合 AI 阅读的文本快照。",
            "prompt": "当需要理解当前页面结构与可交互元素时，使用此工具获取紧凑文本快照，并带编号引用。",
        },
        SKILL_ACTIVATE_TOOL_ID: {
            "displayName": "Skill 激活",
            "description": "读取已启用 Skill 的 SKILL.md 入口说明和资源摘要。",
            "prompt": "先查看 Available Skills 清单；当某个 Skill 适合任务时，用此工具传入清单中的 skill id 或显示名称。",
        },
        SKILL_READ_RESOURCE_TOOL_ID: {
            "displayName": "Skill 资源读取",
            "description": "读取已启用 Skill 资源索引中的 UTF-8 文本资源，不要求先激活。",
            "prompt": "需要 Skill 资源摘要中列出的相对路径时，用此工具传入 skill id 或显示名称以及该资源路径。",
        },
    },
    "en-US": {
        FILE_CONVERT_TOOL_ID: {
            "displayName": FILE_CONVERT_TOOL_DISPLAY_NAME,
            "description": FILE_CONVERT_TOOL_DESCRIPTION,
            "prompt": FILE_CONVERT_TOOL_PROMPT,
        },
        FILE_TOOL_READ_ID: {
            "displayName": FILE_TOOL_READ_DISPLAY_NAME,
            "description": FILE_TOOL_READ_DESCRIPTION,
            "prompt": FILE_TOOL_READ_PROMPT,
        },
        FILE_TOOL_WRITE_ID: {
            "displayName": FILE_TOOL_WRITE_DISPLAY_NAME,
            "description": FILE_TOOL_WRITE_DESCRIPTION,
            "prompt": FILE_TOOL_WRITE_PROMPT,
        },
        FILE_TOOL_EDIT_ID: {
            "displayName": FILE_TOOL_EDIT_DISPLAY_NAME,
            "description": FILE_TOOL_EDIT_DESCRIPTION,
            "prompt": FILE_TOOL_EDIT_PROMPT,
        },
        FILE_TOOL_GLOB_ID: {
            "displayName": FILE_TOOL_GLOB_DISPLAY_NAME,
            "description": FILE_TOOL_GLOB_DESCRIPTION,
            "prompt": FILE_TOOL_GLOB_PROMPT,
        },
        FILE_TOOL_GREP_ID: {
            "displayName": FILE_TOOL_GREP_DISPLAY_NAME,
            "description": FILE_TOOL_GREP_DESCRIPTION,
            "prompt": FILE_TOOL_GREP_PROMPT,
        },
        FILE_TOOL_NOTEBOOK_EDIT_ID: {
            "displayName": FILE_TOOL_NOTEBOOK_EDIT_DISPLAY_NAME,
            "description": FILE_TOOL_NOTEBOOK_EDIT_DESCRIPTION,
            "prompt": FILE_TOOL_NOTEBOOK_EDIT_PROMPT,
        },
        FILE_TOOL_SWITCH_ROOT_ID: {
            "displayName": FILE_TOOL_SWITCH_ROOT_DISPLAY_NAME,
            "description": FILE_TOOL_SWITCH_ROOT_DESCRIPTION,
            "prompt": FILE_TOOL_SWITCH_ROOT_PROMPT,
        },
        WEATHER_CURRENT_TOOL_ID: {
            "displayName": WEATHER_CURRENT_TOOL_DISPLAY_NAME,
            "description": WEATHER_CURRENT_TOOL_DESCRIPTION,
            "prompt": WEATHER_CURRENT_TOOL_PROMPT,
        },
        REQUEST_USER_FORM_TOOL_ID: {
            "displayName": REQUEST_USER_FORM_TOOL_DISPLAY_NAME,
            "description": REQUEST_USER_FORM_TOOL_DESCRIPTION,
            "prompt": REQUEST_USER_FORM_TOOL_PROMPT,
        },
        BROWSER_OPEN_TOOL_ID: {
            "displayName": BROWSER_OPEN_TOOL_DISPLAY_NAME,
            "description": BROWSER_OPEN_TOOL_DESCRIPTION,
            "prompt": BROWSER_OPEN_TOOL_PROMPT,
        },
        BROWSER_SCREENSHOT_TOOL_ID: {
            "displayName": BROWSER_SCREENSHOT_TOOL_DISPLAY_NAME,
            "description": BROWSER_SCREENSHOT_TOOL_DESCRIPTION,
            "prompt": BROWSER_SCREENSHOT_TOOL_PROMPT,
        },
        BROWSER_SNAPSHOT_TOOL_ID: {
            "displayName": BROWSER_SNAPSHOT_TOOL_DISPLAY_NAME,
            "description": BROWSER_SNAPSHOT_TOOL_DESCRIPTION,
            "prompt": BROWSER_SNAPSHOT_TOOL_PROMPT,
        },
        SKILL_ACTIVATE_TOOL_ID: {
            "displayName": SKILL_ACTIVATE_TOOL_DISPLAY_NAME,
            "description": SKILL_ACTIVATE_TOOL_DESCRIPTION,
            "prompt": SKILL_ACTIVATE_TOOL_PROMPT,
        },
        SKILL_READ_RESOURCE_TOOL_ID: {
            "displayName": SKILL_READ_RESOURCE_TOOL_DISPLAY_NAME,
            "description": SKILL_READ_RESOURCE_TOOL_DESCRIPTION,
            "prompt": SKILL_READ_RESOURCE_TOOL_PROMPT,
        },
    },
}

DEFAULT_WEATHER_LOCATION = "Shenzhen"
WEATHER_SAMPLE_RESULTS: tuple[dict[str, Any], ...] = (
    {
        "condition": "晴",
        "temperatureC": 24,
        "humidity": 60,
        "summary": "体感舒适，适合外出。",
    },
    {
        "condition": "多云",
        "temperatureC": 22,
        "humidity": 68,
        "summary": "云量较多，气温平稳。",
    },
    {
        "condition": "小雨",
        "temperatureC": 19,
        "humidity": 84,
        "summary": "空气偏湿润，出门建议带伞。",
    },
)

REDACTED_TOOL_ARGUMENT_VALUE = "***"
MAX_TOOL_ARGUMENT_VALUE_LENGTH = 120
MAX_TOOL_ARGUMENT_SUMMARY_LENGTH = 512
MAX_TOOL_RESULT_SUMMARY_LENGTH = 320
SENSITIVE_TOOL_ARGUMENT_KEYWORDS = frozenset(
    {
        "apikey",
        "authorization",
        "cookie",
        "credential",
        "password",
        "secret",
        "session",
        "token",
    }
)

SKILL_ACTIVATE_PARAMETERS_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "skill_id": {
            "type": "string",
            "minLength": 1,
            "description": "Skill id or display name from the Available Skills list.",
        }
    },
    "required": ["skill_id"],
}

SKILL_READ_RESOURCE_PARAMETERS_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "skill_id": {
            "type": "string",
            "minLength": 1,
            "description": "Skill id or display name from the Available Skills list.",
        },
        "path": {
            "type": "string",
            "minLength": 1,
            "description": "Safe relative resource path listed in the Skill resource summaries.",
        },
    },
    "required": ["skill_id", "path"],
}

REQUEST_USER_FORM_PARAMETERS_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "form_id": {
            "type": "string",
            "minLength": 1,
            "description": "Internal stable form identifier for the runtime protocol. Keep it machine-friendly and do not mention or display it to the user.",
        },
        "title": {
            "type": "string",
            "minLength": 1,
            "description": "Short user-facing form title that clearly states what the user should provide.",
        },
        "description": {
            "type": "string",
            "description": "Optional user-facing explanation of why this information is needed to continue. Do not describe JSON, protocol details, or implementation internals.",
        },
        "submit_label": {
            "type": "string",
            "description": "Optional short user-facing submit button label such as 'Continue' or 'Confirm'.",
        },
        "fields": {
            "type": "array",
            "minItems": 1,
            "description": "One or more user-facing fields to collect the missing information. A single-field form is valid when it is clearer than a free-text follow-up. Group related fields into the same form when that helps the user answer in one pass.",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "name": {
                        "type": "string",
                        "minLength": 1,
                        "description": "Internal machine-friendly field key used in the submitted payload. Do not expose this identifier as protocol detail to the user.",
                    },
                    "label": {
                        "type": "string",
                        "minLength": 1,
                        "description": "Natural-language field label shown to the user. Make it specific and easy to understand.",
                    },
                    "type": {
                        "type": "string",
                        "enum": ["text", "textarea", "number", "select", "checkbox"],
                        "description": "Choose the simplest supported field type. Use select for fixed lists of choices, use checkbox only for a single boolean confirmation, and use text or textarea for open-ended input. Do not imply unsupported file-upload inputs.",
                    },
                    "description": {
                        "type": "string",
                        "description": "Optional short helper text for the user. Explain what good input looks like, not runtime or protocol mechanics.",
                    },
                    "placeholder": {
                        "type": "string",
                        "description": "Optional concrete example input that helps the user answer clearly.",
                    },
                    "required": {
                        "type": "boolean",
                        "description": "Mark true only when this field is necessary to continue safely or correctly.",
                    },
                    "options": {
                        "type": "array",
                        "description": "Allowed choices for select fields only. Provide a non-empty array when type is select. Do not use options with checkbox fields because checkbox represents a single boolean confirmation.",
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "properties": {
                                "value": {
                                    "type": "string",
                                    "description": "Machine-friendly submitted value for this option.",
                                },
                                "label": {
                                    "type": "string",
                                    "description": "User-facing option label written in natural language.",
                                },
                            },
                            "required": ["value", "label"],
                        },
                    },
                },
                "required": ["name", "label", "type"],
                "allOf": [
                    {
                        "if": {
                            "properties": {
                                "type": {"const": "select"},
                            },
                            "required": ["type"],
                        },
                        "then": {
                            "required": ["options"],
                            "properties": {
                                "options": {
                                    "minItems": 1,
                                }
                            },
                        },
                    },
                    {
                        "if": {
                            "properties": {
                                "type": {"const": "checkbox"},
                            },
                            "required": ["type"],
                        },
                        "then": {
                            "not": {
                                "required": ["options"],
                            }
                        },
                    },
                ],
            },
        },
    },
    "required": ["form_id", "title", "fields"],
}

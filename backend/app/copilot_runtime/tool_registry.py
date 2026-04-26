"""Tool metadata registry and executable bindings for the Copilot runtime."""

from __future__ import annotations

import json
import random
from collections.abc import Awaitable, Callable, Iterable, Mapping
from dataclasses import dataclass
from typing import Any, TypedDict

from pathlib import Path

from app.tools.file_convert import convert_file_to_str
from app.tooling.file_tools import (
    FILE_TOOL_EDIT_ID,
    FILE_TOOL_GLOB_ID,
    FILE_TOOL_GREP_ID,
    FILE_TOOL_NOTEBOOK_EDIT_ID,
    FILE_TOOL_READ_ID,
    FILE_TOOL_SWITCH_ROOT_ID,
    FILE_TOOL_WRITE_ID,
    build_file_tool_edit_runtime_binding,
    build_file_tool_glob_runtime_binding,
    build_file_tool_grep_runtime_binding,
    build_file_tool_notebook_edit_runtime_binding,
    build_file_tool_read_runtime_binding,
    build_file_tool_switch_root_runtime_binding,
    build_file_tool_write_runtime_binding,
)
from app.tooling.runtime_adapter.copilot_runtime import (
    ToolHostCapabilitiesFactory,
    build_default_contract_runtime_bindings,
)
from app.copilot_runtime.skill_snapshot_provider import (
    SKILL_ACTIVATE_FUNCTION_NAME,
    SKILL_ACTIVATE_TOOL_ID,
    SKILL_READ_RESOURCE_FUNCTION_NAME,
    SKILL_READ_RESOURCE_TOOL_ID,
    execute_skill_activate_tool,
    execute_skill_read_resource_tool,
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
REQUEST_USER_FORM_TOOL_ID = "tool.request-user-form"
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
WEATHER_CURRENT_TOOL_DISPLAY_NAME = "Current Weather"
WEATHER_CURRENT_TOOL_DESCRIPTION = (
    "Return a placeholder current-weather result for a requested location."
)
WEATHER_CURRENT_TOOL_PROMPT = (
    "Use this tool to retrieve a simple current weather summary for a location."
)
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
SKILL_ACTIVATE_TOOL_DISPLAY_NAME = "Skill Activate"
SKILL_ACTIVATE_TOOL_DESCRIPTION = (
    "Read the SKILL.md entry instructions and resource summaries for an enabled Skill."
)
SKILL_ACTIVATE_TOOL_PROMPT = (
    "Use this tool after checking the Available Skills list when a Skill matches the task. "
    "Pass the skill id or display name from the list."
)
SKILL_READ_RESOURCE_TOOL_DISPLAY_NAME = "Skill Read Resource"
SKILL_READ_RESOURCE_TOOL_DESCRIPTION = "Read a UTF-8 text resource listed by an enabled Skill without requiring prior activation."
SKILL_READ_RESOURCE_TOOL_PROMPT = (
    "Use this tool when you need a relative resource path listed in a Skill's resource summaries. "
    "Pass the skill id or display name plus the listed resource path."
)


class FileConvertToolResult(TypedDict, total=False):
    path: str
    suffix: str
    content: str
    notice: str


_BUILTIN_TOOL_LOCALES: dict[str, dict[str, dict[str, str]]] = {
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
_WEATHER_SAMPLE_RESULTS: tuple[dict[str, Any], ...] = (
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
_REDACTED_TOOL_ARGUMENT_VALUE = "***"
_MAX_TOOL_ARGUMENT_VALUE_LENGTH = 120
_MAX_TOOL_ARGUMENT_SUMMARY_LENGTH = 512
_MAX_TOOL_RESULT_SUMMARY_LENGTH = 320
_SENSITIVE_TOOL_ARGUMENT_KEYWORDS = frozenset(
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

ToolExecutor = Callable[[Mapping[str, Any] | None], Awaitable[dict[str, Any]]]
DynamicToolLoader = Callable[[str | None], tuple["ExecutableTool", ...]]


@dataclass(frozen=True, slots=True)
class ToolPresentationGroup:
    group_id: str
    label_zh: str
    label_en: str
    order: int
    source_kind: str

    def build_catalog_view(self, language: str | None = None) -> dict[str, Any]:
        return {
            "id": self.group_id,
            "label": self.label_en
            if normalize_tool_catalog_language(language) == "en-US"
            else self.label_zh,
            "labelZh": self.label_zh,
            "labelEn": self.label_en,
            "order": self.order,
            "sourceKind": self.source_kind,
        }


@dataclass(frozen=True, slots=True)
class ToolPresentation:
    display_name_zh: str | None = None
    display_name_en: str | None = None
    description_zh: str | None = None
    description_en: str | None = None
    group: ToolPresentationGroup | None = None

    def build_catalog_view(self, language: str | None = None) -> dict[str, Any]:
        normalized_language = normalize_tool_catalog_language(language)
        display_name = (
            self.display_name_en
            if normalized_language == "en-US"
            else self.display_name_zh
        )
        description = (
            self.description_en
            if normalized_language == "en-US"
            else self.description_zh
        )
        entry: dict[str, Any] = {
            "displayNameZh": self.display_name_zh,
            "displayNameEn": self.display_name_en,
            "descriptionZh": self.description_zh,
            "descriptionEn": self.description_en,
        }
        if display_name is not None:
            entry["displayName"] = display_name
        if description is not None:
            entry["description"] = description
        if self.group is not None:
            entry["group"] = self.group.build_catalog_view(language)
        return entry


@dataclass(frozen=True, slots=True)
class ToolDescriptor:
    """Stable tool contract fields are centered on `tool_id`; display fields are hints only."""

    tool_id: str
    kind: str = DEFAULT_TOOL_KIND
    display_name: str | None = None
    description: str | None = None
    availability: str = DEFAULT_TOOL_AVAILABILITY
    prompt: str | None = None
    presentation: ToolPresentation | None = None

    def build_catalog_entry(self) -> dict[str, Any]:
        entry: dict[str, Any] = {
            "toolId": self.tool_id,
            "kind": self.kind,
            "availability": self.availability,
        }
        if self.display_name is not None:
            entry["displayName"] = self.display_name
        if self.description is not None:
            entry["description"] = self.description
        if self.prompt is not None:
            entry["prompt"] = self.prompt
        if self.presentation is not None:
            entry.update(self.presentation.build_catalog_view())
        return entry

    def build_catalog_entry_for_language(
        self, language: str | None = None
    ) -> dict[str, Any]:
        entry = self.build_catalog_entry()
        if self.kind == DEFAULT_TOOL_KIND:
            localized_fields = _resolve_builtin_tool_locale(self.tool_id, language)
            entry["displayName"] = localized_fields["displayName"]
            entry["description"] = localized_fields["description"]
            entry["prompt"] = localized_fields["prompt"]
        elif self.presentation is not None:
            entry.update(self.presentation.build_catalog_view(language))
        return entry

    def build_summary(self) -> dict[str, Any]:
        return {
            "toolId": self.tool_id,
            "kind": self.kind,
            "availability": self.availability,
            "displayName": self.display_name,
            "description": self.description,
            "prompt": self.prompt,
            "presentation": (
                None
                if self.presentation is None
                else self.presentation.build_catalog_view()
            ),
        }


@dataclass(frozen=True, slots=True)
class ExecutableTool:
    descriptor: ToolDescriptor
    execute: ToolExecutor
    function_name: str | None = None
    parameters_json_schema: dict[str, Any] | None = None

    @property
    def tool_id(self) -> str:
        return self.descriptor.tool_id


@dataclass(frozen=True, slots=True)
class ToolsetDescriptor:
    name: str
    label: str
    description: str
    tools: tuple[ExecutableTool, ...]
    default: bool = False

    def build_summary(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "label": self.label,
            "description": self.description,
            "default": self.default,
            "toolCount": len(self.tools),
            "tools": [tool.descriptor.build_summary() for tool in self.tools],
        }


class ToolRegistry:
    def __init__(
        self,
        toolsets: Iterable[ToolsetDescriptor] | None = None,
        *,
        workspace_root: Path | None = None,
        dynamic_tool_loader: DynamicToolLoader | None = None,
    ) -> None:
        self._toolsets: dict[str, ToolsetDescriptor] = {}
        self._default_name: str | None = None
        self._workspace_root = (
            None if workspace_root is None else workspace_root.resolve(strict=False)
        )
        self._dynamic_tool_loader = dynamic_tool_loader
        if toolsets is not None:
            for toolset in toolsets:
                self.register(toolset)

    @property
    def directory_version(self) -> str:
        return DEFAULT_TOOL_DIRECTORY_VERSION

    @property
    def workspace_root(self) -> Path | None:
        return self._workspace_root

    def register(self, toolset: ToolsetDescriptor) -> None:
        if toolset.name in self._toolsets:
            raise ValueError(f"Toolset '{toolset.name}' is already registered.")
        if toolset.default:
            if self._default_name is not None:
                raise ValueError("Only one toolset can be marked as default.")
            self._default_name = toolset.name
        self._toolsets[toolset.name] = toolset

    def supports(self, name: str) -> bool:
        return name in self._toolsets

    def get_default(self) -> ToolsetDescriptor:
        if self._default_name is None:
            raise LookupError("No default toolset is registered.")
        return self._toolsets[self._default_name]

    def resolve_tool(
        self, tool_id: str, *, toolset_name: str | None = None
    ) -> ExecutableTool:
        toolset = (
            self.get_default() if toolset_name is None else self._toolsets[toolset_name]
        )
        for tool in toolset.tools:
            if tool.tool_id == tool_id:
                return tool
        for tool in self._load_dynamic_tools(toolset_name=toolset.name):
            if tool.tool_id == tool_id:
                return tool
        raise LookupError(
            f"Tool '{tool_id}' is not registered in toolset '{toolset.name}'."
        )

    def list_tool_ids(self, *, toolset_name: str | None = None) -> tuple[str, ...]:
        toolset = (
            self.get_default() if toolset_name is None else self._toolsets[toolset_name]
        )
        tool_ids = [tool.tool_id for tool in toolset.tools]
        for tool in self._load_dynamic_tools(toolset_name=toolset.name):
            if tool.tool_id not in tool_ids:
                tool_ids.append(tool.tool_id)
        return tuple(tool_ids)

    def build_view(self) -> dict[str, dict[str, Any]]:
        return {
            toolset.name: {
                "name": toolset.name,
                "description": toolset.description,
                "toolCount": len(toolset.tools),
            }
            for toolset in self._toolsets.values()
        }

    def build_tool_catalog(
        self,
        toolset_name: str | None = None,
        *,
        language: str | None = None,
    ) -> list[dict[str, Any]]:
        toolset = (
            self.get_default() if toolset_name is None else self._toolsets[toolset_name]
        )
        catalog: list[dict[str, Any]] = []
        seen_tool_ids: set[str] = set()
        for tool in toolset.tools:
            catalog.append(tool.descriptor.build_catalog_entry_for_language(language))
            seen_tool_ids.add(tool.tool_id)
        for tool in self._load_dynamic_tools(
            toolset_name=toolset.name, language=language
        ):
            if tool.tool_id in seen_tool_ids:
                continue
            catalog.append(tool.descriptor.build_catalog_entry_for_language(language))
            seen_tool_ids.add(tool.tool_id)
        return catalog

    def build_diagnostics_summary(self) -> dict[str, Any]:
        default_toolset_name = self.get_default().name
        dynamic_tools = self._load_dynamic_tools(toolset_name=default_toolset_name)
        return {
            "available_toolsets": list(self._toolsets.keys()),
            "default_toolset": self._default_name,
            "tool_directory_version": DEFAULT_TOOL_DIRECTORY_VERSION,
            "toolset_summaries": [
                toolset.build_summary() for toolset in self._toolsets.values()
            ],
            "dynamic_tool_ids": [tool.tool_id for tool in dynamic_tools],
            "dynamic_tool_count": len(dynamic_tools),
        }

    def _load_dynamic_tools(
        self,
        *,
        toolset_name: str,
        language: str | None = None,
    ) -> tuple[ExecutableTool, ...]:
        if self._dynamic_tool_loader is None:
            return ()
        if toolset_name != self.get_default().name:
            return ()
        return tuple(self._dynamic_tool_loader(language))


async def _execute_default_file_convert_tool(
    arguments: Mapping[str, Any] | None,
) -> dict[str, Any]:
    payload = dict(arguments or {})
    file_path = payload.get("path")
    if not isinstance(file_path, str) or file_path.strip() == "":
        raise ValueError("path must be a non-empty string")
    normalized: FileConvertToolResult = {
        "path": file_path,
        "suffix": Path(file_path).suffix.lower(),
        "content": convert_file_to_str(file_path),
    }
    return dict(normalized)


async def execute_weather_current_tool(
    arguments: Mapping[str, Any] | None,
    *,
    rng: random.Random | None = None,
) -> dict[str, Any]:
    payload = dict(arguments or {})
    raw_location = payload.get("location")
    location = (
        raw_location.strip()
        if isinstance(raw_location, str) and raw_location.strip() != ""
        else DEFAULT_WEATHER_LOCATION
    )
    # Placeholder weather sampling is not security-sensitive.
    selected_rng = rng or random.Random()  # nosec B311
    sample = selected_rng.choice(_WEATHER_SAMPLE_RESULTS)
    return {
        "location": location,
        "condition": sample["condition"],
        "temperatureC": sample["temperatureC"],
        "humidity": sample["humidity"],
        "summary": sample["summary"],
    }


async def _execute_default_weather_tool(
    arguments: Mapping[str, Any] | None,
) -> dict[str, Any]:
    return await execute_weather_current_tool(arguments)


def _normalize_optional_text_argument(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _normalize_required_text_argument(value: Any, *, field_name: str) -> str:
    normalized = _normalize_optional_text_argument(value)
    if normalized is None:
        raise ValueError(f"{field_name} must be a non-empty string")
    return normalized


def _normalize_form_field_option(value: Any) -> dict[str, str]:
    if not isinstance(value, Mapping):
        raise ValueError("field options must be objects")
    return {
        "value": _normalize_required_text_argument(value.get("value"), field_name="field.options[].value"),
        "label": _normalize_required_text_argument(value.get("label"), field_name="field.options[].label"),
    }


def _normalize_form_field(value: Any) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError("fields must contain only objects")
    field_type = _normalize_required_text_argument(value.get("type"), field_name="field.type")
    if field_type not in {"text", "textarea", "number", "select", "checkbox"}:
        raise ValueError("field.type must be one of text, textarea, number, select, checkbox")

    normalized: dict[str, Any] = {
        "name": _normalize_required_text_argument(value.get("name"), field_name="field.name"),
        "label": _normalize_required_text_argument(value.get("label"), field_name="field.label"),
        "type": field_type,
    }
    description = _normalize_optional_text_argument(value.get("description"))
    placeholder = _normalize_optional_text_argument(value.get("placeholder"))
    if description is not None:
        normalized["description"] = description
    if placeholder is not None:
        normalized["placeholder"] = placeholder
    if isinstance(value.get("required"), bool):
        normalized["required"] = value.get("required")
    if field_type == "select":
        options = value.get("options")
        if not isinstance(options, list) or len(options) == 0:
            raise ValueError("select fields require a non-empty options array")
        normalized["options"] = [_normalize_form_field_option(option) for option in options]
    elif "options" in value:
        raise ValueError("checkbox fields do not support options")
    return normalized


async def _execute_request_user_form_tool(
    arguments: Mapping[str, Any] | None,
) -> dict[str, Any]:
    payload = dict(arguments or {})
    raw_fields = payload.get("fields")
    if not isinstance(raw_fields, list) or len(raw_fields) == 0:
        raise ValueError("fields must be a non-empty array")

    form_request: dict[str, Any] = {
        "formId": _normalize_required_text_argument(payload.get("form_id"), field_name="form_id"),
        "title": _normalize_required_text_argument(payload.get("title"), field_name="title"),
        "fields": [_normalize_form_field(field) for field in raw_fields],
    }
    description = _normalize_optional_text_argument(payload.get("description"))
    submit_label = _normalize_optional_text_argument(payload.get("submit_label"))
    if description is not None:
        form_request["description"] = description
    if submit_label is not None:
        form_request["submitLabel"] = submit_label

    return {
        "summary": description or f"请填写表单：{form_request['title']}",
        "formRequest": form_request,
    }


_BUILTIN_TOOL_GROUP = ToolPresentationGroup(
    group_id="builtin-core",
    label_zh="内置基础工具",
    label_en="Built-in Core Tools",
    order=0,
    source_kind="builtin",
)
_BLACKBOARD_TOOL_GROUP = ToolPresentationGroup(
    group_id="blackboard",
    label_zh="Blackboard 工具",
    label_en="Blackboard Tools",
    order=10,
    source_kind="sustech-blackboard",
)
_TIS_TOOL_GROUP = ToolPresentationGroup(
    group_id="tis",
    label_zh="TIS 工具",
    label_en="TIS Tools",
    order=20,
    source_kind="sustech-tis",
)
_SKILL_TOOL_GROUP = ToolPresentationGroup(
    group_id="runtime-skill",
    label_zh="Skill 工具",
    label_en="Skill Tools",
    order=5,
    source_kind="runtime-skill",
)
_TOOL_PRESENTATION_GROUPS_BY_ID: dict[str, ToolPresentationGroup] = {
    FILE_CONVERT_TOOL_ID: _BUILTIN_TOOL_GROUP,
    FILE_TOOL_READ_ID: _BUILTIN_TOOL_GROUP,
    FILE_TOOL_WRITE_ID: _BUILTIN_TOOL_GROUP,
    FILE_TOOL_EDIT_ID: _BUILTIN_TOOL_GROUP,
    FILE_TOOL_GLOB_ID: _BUILTIN_TOOL_GROUP,
    FILE_TOOL_GREP_ID: _BUILTIN_TOOL_GROUP,
    FILE_TOOL_NOTEBOOK_EDIT_ID: _BUILTIN_TOOL_GROUP,
    FILE_TOOL_SWITCH_ROOT_ID: _BUILTIN_TOOL_GROUP,
    WEATHER_CURRENT_TOOL_ID: _BUILTIN_TOOL_GROUP,
    REQUEST_USER_FORM_TOOL_ID: _BUILTIN_TOOL_GROUP,
    SKILL_ACTIVATE_TOOL_ID: _SKILL_TOOL_GROUP,
    SKILL_READ_RESOURCE_TOOL_ID: _SKILL_TOOL_GROUP,
    "blackboard.sql.query": _BLACKBOARD_TOOL_GROUP,
    "blackboard.course_catalog.search": _BLACKBOARD_TOOL_GROUP,
    "blackboard.calendar.refresh": _BLACKBOARD_TOOL_GROUP,
    "blackboard.snapshot.sync": _BLACKBOARD_TOOL_GROUP,
    "blackboard.course_resources.sync": _BLACKBOARD_TOOL_GROUP,
    "tis.sql.query": _TIS_TOOL_GROUP,
    "tis.personal_grades.fetch": _TIS_TOOL_GROUP,
    "tis.credit_gpa.fetch": _TIS_TOOL_GROUP,
    "tis.selected_courses.fetch": _TIS_TOOL_GROUP,
}

_TOOL_PRESENTATION_COPY_BY_ID: dict[str, dict[str, str]] = {
    FILE_CONVERT_TOOL_ID: {
        "display_name_zh": "文件转换",
        "display_name_en": FILE_CONVERT_TOOL_DISPLAY_NAME,
        "description_zh": "将 DOCX、PDF 和 PPTX 文件转换为纯文本。",
        "description_en": FILE_CONVERT_TOOL_DESCRIPTION,
    },
    FILE_TOOL_READ_ID: {
        "display_name_zh": "文件读取",
        "display_name_en": FILE_TOOL_READ_DISPLAY_NAME,
        "description_zh": "按行分页读取工作区内 UTF-8 文本文件。",
        "description_en": FILE_TOOL_READ_DESCRIPTION,
    },
    FILE_TOOL_WRITE_ID: {
        "display_name_zh": "文件写入",
        "display_name_en": FILE_TOOL_WRITE_DISPLAY_NAME,
        "description_zh": "在工作区内创建或覆写 UTF-8 文本文件，并带有保护性覆写语义。",
        "description_en": FILE_TOOL_WRITE_DESCRIPTION,
    },
    FILE_TOOL_EDIT_ID: {
        "display_name_zh": "文件编辑",
        "display_name_en": FILE_TOOL_EDIT_DISPLAY_NAME,
        "description_zh": "按精确字符串替换语义编辑工作区内 UTF-8 文本文件。",
        "description_en": FILE_TOOL_EDIT_DESCRIPTION,
    },
    FILE_TOOL_GLOB_ID: {
        "display_name_zh": "文件发现",
        "display_name_en": FILE_TOOL_GLOB_DISPLAY_NAME,
        "description_zh": "按 glob 模式发现工作区内文件与目录，不读取内容。",
        "description_en": FILE_TOOL_GLOB_DESCRIPTION,
    },
    FILE_TOOL_GREP_ID: {
        "display_name_zh": "文件搜索",
        "display_name_en": FILE_TOOL_GREP_DISPLAY_NAME,
        "description_zh": "按字面量或正则搜索工作区文本文件，并返回有限行上下文。",
        "description_en": FILE_TOOL_GREP_DESCRIPTION,
    },
    FILE_TOOL_NOTEBOOK_EDIT_ID: {
        "display_name_zh": "Notebook 编辑",
        "display_name_en": FILE_TOOL_NOTEBOOK_EDIT_DISPLAY_NAME,
        "description_zh": "按 cell 级事务语义编辑工作区 notebook。",
        "description_en": FILE_TOOL_NOTEBOOK_EDIT_DESCRIPTION,
    },
    FILE_TOOL_SWITCH_ROOT_ID: {
        "display_name_zh": "文件根切换",
        "display_name_en": FILE_TOOL_SWITCH_ROOT_DISPLAY_NAME,
        "description_zh": "验证并解析后续文件工具可使用的新默认根目录。",
        "description_en": FILE_TOOL_SWITCH_ROOT_DESCRIPTION,
    },
    WEATHER_CURRENT_TOOL_ID: {
        "display_name_zh": "当前天气",
        "display_name_en": WEATHER_CURRENT_TOOL_DISPLAY_NAME,
        "description_zh": "返回指定地点的占位当前天气结果。",
        "description_en": WEATHER_CURRENT_TOOL_DESCRIPTION,
    },
    REQUEST_USER_FORM_TOOL_ID: {
        "display_name_zh": "请求用户表单",
        "display_name_en": REQUEST_USER_FORM_TOOL_DISPLAY_NAME,
        "description_zh": "在聊天中请求用户填写受控内联表单，以收集继续任务所需的结构化信息；当结构化字段、选项、偏好、约束、确认或参数比自由文本追问更清晰时，应优先考虑使用，即使只有一个字段也可以。",
        "description_en": REQUEST_USER_FORM_TOOL_DESCRIPTION,
    },
    SKILL_ACTIVATE_TOOL_ID: {
        "display_name_zh": "Skill 激活",
        "display_name_en": SKILL_ACTIVATE_TOOL_DISPLAY_NAME,
        "description_zh": "读取已启用 Skill 的 SKILL.md 入口说明和资源摘要。",
        "description_en": SKILL_ACTIVATE_TOOL_DESCRIPTION,
    },
    SKILL_READ_RESOURCE_TOOL_ID: {
        "display_name_zh": "Skill 资源读取",
        "display_name_en": SKILL_READ_RESOURCE_TOOL_DISPLAY_NAME,
        "description_zh": "读取已启用 Skill 资源索引中的 UTF-8 文本资源，不要求先激活。",
        "description_en": SKILL_READ_RESOURCE_TOOL_DESCRIPTION,
    },
    "blackboard.sql.query": {
        "display_name_zh": "Blackboard 数据查询",
        "display_name_en": "Blackboard SQL Query",
        "description_zh": "查询 Blackboard 本地数据。",
        "description_en": "Query Blackboard local data.",
    },
    "blackboard.course_catalog.search": {
        "display_name_zh": "课程目录搜索",
        "display_name_en": "Course Catalog Search",
        "description_zh": "搜索 Blackboard 课程目录。",
        "description_en": "Search Blackboard course catalog.",
    },
    "blackboard.calendar.refresh": {
        "display_name_zh": "日历刷新",
        "display_name_en": "Calendar Refresh",
        "description_zh": "刷新 Blackboard 课程日历。",
        "description_en": "Refresh Blackboard course calendar.",
    },
    "blackboard.snapshot.sync": {
        "display_name_zh": "快照同步",
        "display_name_en": "Snapshot Sync",
        "description_zh": "同步 Blackboard 基础快照。",
        "description_en": "Sync Blackboard base snapshots.",
    },
    "blackboard.course_resources.sync": {
        "display_name_zh": "课程资源同步",
        "display_name_en": "Course Resources Sync",
        "description_zh": "同步指定课程资源。",
        "description_en": "Sync resources for a selected Blackboard course.",
    },
    "tis.sql.query": {
        "display_name_zh": "TIS 数据查询",
        "display_name_en": "TIS SQL Query",
        "description_zh": "查询 TIS 本地数据。",
        "description_en": "Query TIS local data.",
    },
    "tis.personal_grades.fetch": {
        "display_name_zh": "成绩获取",
        "display_name_en": "Personal Grades Fetch",
        "description_zh": "获取个人成绩记录。",
        "description_en": "Fetch personal grade records.",
    },
    "tis.credit_gpa.fetch": {
        "display_name_zh": "绩点概览",
        "display_name_en": "Credit GPA Overview",
        "description_zh": "获取学分与绩点概览。",
        "description_en": "Fetch credit and GPA overview.",
    },
    "tis.selected_courses.fetch": {
        "display_name_zh": "已选课程",
        "display_name_en": "Selected Courses",
        "description_zh": "获取当前已选课程。",
        "description_en": "Fetch currently selected courses.",
    },
}

_TOOL_PRESENTATION_BY_ID: dict[str, ToolPresentation] = {
    tool_id: ToolPresentation(group=_TOOL_PRESENTATION_GROUPS_BY_ID[tool_id], **copy)
    for tool_id, copy in _TOOL_PRESENTATION_COPY_BY_ID.items()
}


_SKILL_ACTIVATE_PARAMETERS_JSON_SCHEMA: dict[str, Any] = {
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
_SKILL_READ_RESOURCE_PARAMETERS_JSON_SCHEMA: dict[str, Any] = {
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
_REQUEST_USER_FORM_PARAMETERS_JSON_SCHEMA: dict[str, Any] = {
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


def _build_contract_runtime_executable_tools(
    *,
    host_capabilities_factory: ToolHostCapabilitiesFactory | None = None,
) -> tuple[ExecutableTool, ...]:
    return tuple(
        ExecutableTool(
            descriptor=ToolDescriptor(
                tool_id=binding.tool_id,
                kind=binding.kind,
                display_name=binding.display_name,
                description=binding.description,
                availability=binding.availability,
                presentation=_TOOL_PRESENTATION_BY_ID.get(binding.tool_id),
            ),
            execute=binding.execute,
            function_name=binding.function_name,
            parameters_json_schema=binding.parameters_json_schema,
        )
        for binding in build_default_contract_runtime_bindings(
            host_capabilities_factory=host_capabilities_factory,
        )
    )


def build_default_tool_registry(
    *,
    host_capabilities_factory: ToolHostCapabilitiesFactory | None = None,
    workspace_root: Path | None = None,
    dynamic_tool_loader: DynamicToolLoader | None = None,
) -> ToolRegistry:
    resolved_workspace_root = (workspace_root or Path.cwd()).resolve(strict=False)
    file_read_binding = build_file_tool_read_runtime_binding(
        workspace_root=resolved_workspace_root,
    )
    file_write_binding = build_file_tool_write_runtime_binding(
        workspace_root=resolved_workspace_root,
    )
    file_edit_binding = build_file_tool_edit_runtime_binding(
        workspace_root=resolved_workspace_root,
    )
    file_glob_binding = build_file_tool_glob_runtime_binding(
        workspace_root=resolved_workspace_root,
    )
    file_grep_binding = build_file_tool_grep_runtime_binding(
        workspace_root=resolved_workspace_root,
    )
    file_notebook_edit_binding = build_file_tool_notebook_edit_runtime_binding(
        workspace_root=resolved_workspace_root,
    )
    file_switch_root_binding = build_file_tool_switch_root_runtime_binding(
        workspace_root=resolved_workspace_root,
    )
    registry = ToolRegistry(
        workspace_root=resolved_workspace_root,
        dynamic_tool_loader=dynamic_tool_loader,
    )
    registry.register(
        ToolsetDescriptor(
            name=DEFAULT_TOOLSET_NAME,
            label=DEFAULT_TOOLSET_LABEL,
            description=DEFAULT_TOOLSET_DESCRIPTION,
            default=True,
            tools=(
                ExecutableTool(
                    descriptor=ToolDescriptor(
                        tool_id=FILE_TOOL_READ_ID,
                        kind=DEFAULT_TOOL_KIND,
                        display_name=FILE_TOOL_READ_DISPLAY_NAME,
                        description=FILE_TOOL_READ_DESCRIPTION,
                        availability=DEFAULT_TOOL_AVAILABILITY,
                        prompt=FILE_TOOL_READ_PROMPT,
                        presentation=_TOOL_PRESENTATION_BY_ID[FILE_TOOL_READ_ID],
                    ),
                    execute=file_read_binding.execute,
                    function_name=file_read_binding.function_name,
                    parameters_json_schema=file_read_binding.parameters_json_schema,
                ),
                ExecutableTool(
                    descriptor=ToolDescriptor(
                        tool_id=FILE_TOOL_WRITE_ID,
                        kind=DEFAULT_TOOL_KIND,
                        display_name=FILE_TOOL_WRITE_DISPLAY_NAME,
                        description=FILE_TOOL_WRITE_DESCRIPTION,
                        availability=DEFAULT_TOOL_AVAILABILITY,
                        prompt=FILE_TOOL_WRITE_PROMPT,
                        presentation=_TOOL_PRESENTATION_BY_ID[FILE_TOOL_WRITE_ID],
                    ),
                    execute=file_write_binding.execute,
                    function_name=file_write_binding.function_name,
                    parameters_json_schema=file_write_binding.parameters_json_schema,
                ),
                ExecutableTool(
                    descriptor=ToolDescriptor(
                        tool_id=FILE_TOOL_EDIT_ID,
                        kind=DEFAULT_TOOL_KIND,
                        display_name=FILE_TOOL_EDIT_DISPLAY_NAME,
                        description=FILE_TOOL_EDIT_DESCRIPTION,
                        availability=DEFAULT_TOOL_AVAILABILITY,
                        prompt=FILE_TOOL_EDIT_PROMPT,
                        presentation=_TOOL_PRESENTATION_BY_ID[FILE_TOOL_EDIT_ID],
                    ),
                    execute=file_edit_binding.execute,
                    function_name=file_edit_binding.function_name,
                    parameters_json_schema=file_edit_binding.parameters_json_schema,
                ),
                ExecutableTool(
                    descriptor=ToolDescriptor(
                        tool_id=FILE_TOOL_GLOB_ID,
                        kind=DEFAULT_TOOL_KIND,
                        display_name=FILE_TOOL_GLOB_DISPLAY_NAME,
                        description=FILE_TOOL_GLOB_DESCRIPTION,
                        availability=DEFAULT_TOOL_AVAILABILITY,
                        prompt=FILE_TOOL_GLOB_PROMPT,
                        presentation=_TOOL_PRESENTATION_BY_ID[FILE_TOOL_GLOB_ID],
                    ),
                    execute=file_glob_binding.execute,
                    function_name=file_glob_binding.function_name,
                    parameters_json_schema=file_glob_binding.parameters_json_schema,
                ),
                ExecutableTool(
                    descriptor=ToolDescriptor(
                        tool_id=FILE_TOOL_GREP_ID,
                        kind=DEFAULT_TOOL_KIND,
                        display_name=FILE_TOOL_GREP_DISPLAY_NAME,
                        description=FILE_TOOL_GREP_DESCRIPTION,
                        availability=DEFAULT_TOOL_AVAILABILITY,
                        prompt=FILE_TOOL_GREP_PROMPT,
                        presentation=_TOOL_PRESENTATION_BY_ID[FILE_TOOL_GREP_ID],
                    ),
                    execute=file_grep_binding.execute,
                    function_name=file_grep_binding.function_name,
                    parameters_json_schema=file_grep_binding.parameters_json_schema,
                ),
                ExecutableTool(
                    descriptor=ToolDescriptor(
                        tool_id=FILE_TOOL_NOTEBOOK_EDIT_ID,
                        kind=DEFAULT_TOOL_KIND,
                        display_name=FILE_TOOL_NOTEBOOK_EDIT_DISPLAY_NAME,
                        description=FILE_TOOL_NOTEBOOK_EDIT_DESCRIPTION,
                        availability=DEFAULT_TOOL_AVAILABILITY,
                        prompt=FILE_TOOL_NOTEBOOK_EDIT_PROMPT,
                        presentation=_TOOL_PRESENTATION_BY_ID[
                            FILE_TOOL_NOTEBOOK_EDIT_ID
                        ],
                    ),
                    execute=file_notebook_edit_binding.execute,
                    function_name=file_notebook_edit_binding.function_name,
                    parameters_json_schema=file_notebook_edit_binding.parameters_json_schema,
                ),
                ExecutableTool(
                    descriptor=ToolDescriptor(
                        tool_id=FILE_TOOL_SWITCH_ROOT_ID,
                        kind=DEFAULT_TOOL_KIND,
                        display_name=FILE_TOOL_SWITCH_ROOT_DISPLAY_NAME,
                        description=FILE_TOOL_SWITCH_ROOT_DESCRIPTION,
                        availability=DEFAULT_TOOL_AVAILABILITY,
                        prompt=FILE_TOOL_SWITCH_ROOT_PROMPT,
                        presentation=_TOOL_PRESENTATION_BY_ID[FILE_TOOL_SWITCH_ROOT_ID],
                    ),
                    execute=file_switch_root_binding.execute,
                    function_name=file_switch_root_binding.function_name,
                    parameters_json_schema=file_switch_root_binding.parameters_json_schema,
                ),
                ExecutableTool(
                    descriptor=ToolDescriptor(
                        tool_id=FILE_CONVERT_TOOL_ID,
                        kind=DEFAULT_TOOL_KIND,
                        display_name=FILE_CONVERT_TOOL_DISPLAY_NAME,
                        description=FILE_CONVERT_TOOL_DESCRIPTION,
                        availability=DEFAULT_TOOL_AVAILABILITY,
                        prompt=FILE_CONVERT_TOOL_PROMPT,
                        presentation=_TOOL_PRESENTATION_BY_ID[FILE_CONVERT_TOOL_ID],
                    ),
                    execute=_execute_default_file_convert_tool,
                ),
                ExecutableTool(
                    descriptor=ToolDescriptor(
                        tool_id=WEATHER_CURRENT_TOOL_ID,
                        kind=DEFAULT_TOOL_KIND,
                        display_name=WEATHER_CURRENT_TOOL_DISPLAY_NAME,
                        description=WEATHER_CURRENT_TOOL_DESCRIPTION,
                        availability=DEFAULT_TOOL_AVAILABILITY,
                        prompt=WEATHER_CURRENT_TOOL_PROMPT,
                        presentation=_TOOL_PRESENTATION_BY_ID[WEATHER_CURRENT_TOOL_ID],
                    ),
                    execute=_execute_default_weather_tool,
                ),
                ExecutableTool(
                    descriptor=ToolDescriptor(
                        tool_id=REQUEST_USER_FORM_TOOL_ID,
                        kind=DEFAULT_TOOL_KIND,
                        display_name=REQUEST_USER_FORM_TOOL_DISPLAY_NAME,
                        description=REQUEST_USER_FORM_TOOL_DESCRIPTION,
                        availability=DEFAULT_TOOL_AVAILABILITY,
                        prompt=REQUEST_USER_FORM_TOOL_PROMPT,
                        presentation=_TOOL_PRESENTATION_BY_ID[REQUEST_USER_FORM_TOOL_ID],
                    ),
                    execute=_execute_request_user_form_tool,
                    function_name="request_user_form",
                    parameters_json_schema=_REQUEST_USER_FORM_PARAMETERS_JSON_SCHEMA,
                ),
                ExecutableTool(
                    descriptor=ToolDescriptor(
                        tool_id=SKILL_ACTIVATE_TOOL_ID,
                        kind=DEFAULT_TOOL_KIND,
                        display_name=SKILL_ACTIVATE_TOOL_DISPLAY_NAME,
                        description=SKILL_ACTIVATE_TOOL_DESCRIPTION,
                        availability=DEFAULT_TOOL_AVAILABILITY,
                        prompt=SKILL_ACTIVATE_TOOL_PROMPT,
                        presentation=_TOOL_PRESENTATION_BY_ID[SKILL_ACTIVATE_TOOL_ID],
                    ),
                    execute=execute_skill_activate_tool,
                    function_name=SKILL_ACTIVATE_FUNCTION_NAME,
                    parameters_json_schema=_SKILL_ACTIVATE_PARAMETERS_JSON_SCHEMA,
                ),
                ExecutableTool(
                    descriptor=ToolDescriptor(
                        tool_id=SKILL_READ_RESOURCE_TOOL_ID,
                        kind=DEFAULT_TOOL_KIND,
                        display_name=SKILL_READ_RESOURCE_TOOL_DISPLAY_NAME,
                        description=SKILL_READ_RESOURCE_TOOL_DESCRIPTION,
                        availability=DEFAULT_TOOL_AVAILABILITY,
                        prompt=SKILL_READ_RESOURCE_TOOL_PROMPT,
                        presentation=_TOOL_PRESENTATION_BY_ID[
                            SKILL_READ_RESOURCE_TOOL_ID
                        ],
                    ),
                    execute=execute_skill_read_resource_tool,
                    function_name=SKILL_READ_RESOURCE_FUNCTION_NAME,
                    parameters_json_schema=_SKILL_READ_RESOURCE_PARAMETERS_JSON_SCHEMA,
                ),
                *_build_contract_runtime_executable_tools(
                    host_capabilities_factory=host_capabilities_factory,
                ),
            ),
        )
    )
    return registry


def normalize_tool_catalog_language(language: str | None) -> str:
    normalized = (language or "").strip().lower()
    if normalized.startswith("en"):
        return "en-US"
    return DEFAULT_TOOL_CATALOG_LANGUAGE


def _resolve_builtin_tool_locale(tool_id: str, language: str | None) -> dict[str, str]:
    normalized_language = normalize_tool_catalog_language(language)
    localized_tools = _BUILTIN_TOOL_LOCALES.get(normalized_language)
    if localized_tools is None:
        localized_tools = _BUILTIN_TOOL_LOCALES[DEFAULT_TOOL_CATALOG_LANGUAGE]
    localized_fields = localized_tools.get(tool_id)
    if localized_fields is None:
        return {
            "displayName": tool_id,
            "description": "",
            "prompt": "",
        }
    return dict(localized_fields)


def summarize_tool_arguments(arguments: Mapping[str, Any] | None) -> str | None:
    if arguments is None:
        return None
    normalized = {str(key): value for key, value in arguments.items()}
    if not normalized:
        return None

    sanitized = _sanitize_tool_argument_value(normalized)
    try:
        summary = json.dumps(sanitized, ensure_ascii=False, sort_keys=True)
    except TypeError:
        summary = str(sanitized)
    return _truncate_tool_argument_text(
        summary,
        limit=_MAX_TOOL_ARGUMENT_SUMMARY_LENGTH,
    )


def _sanitize_tool_argument_value(value: Any) -> Any:
    if isinstance(value, Mapping):
        sanitized: dict[str, Any] = {}
        for key, nested_value in value.items():
            normalized_key = str(key)
            if _is_sensitive_tool_argument_key(normalized_key):
                sanitized[normalized_key] = _REDACTED_TOOL_ARGUMENT_VALUE
            else:
                sanitized[normalized_key] = _sanitize_tool_argument_value(nested_value)
        return sanitized
    if isinstance(value, list):
        return [_sanitize_tool_argument_value(item) for item in value]
    if isinstance(value, tuple):
        return tuple(_sanitize_tool_argument_value(item) for item in value)
    if isinstance(value, str):
        return _truncate_tool_argument_text(
            value, limit=_MAX_TOOL_ARGUMENT_VALUE_LENGTH
        )
    return value


def summarize_tool_result(result: Any) -> str | None:
    if result is None:
        return None
    try:
        summary = json.dumps(result, ensure_ascii=False, sort_keys=True)
    except TypeError:
        summary = str(result)
    return _truncate_tool_argument_text(summary, limit=_MAX_TOOL_RESULT_SUMMARY_LENGTH)


def _truncate_tool_argument_text(value: str, *, limit: int) -> str:
    if len(value) <= limit:
        return value
    return f"{value[: max(0, limit - 1)]}…"


def _is_sensitive_tool_argument_key(key: str) -> bool:
    normalized = key.strip().lower().replace("_", "").replace("-", "")
    return any(keyword in normalized for keyword in _SENSITIVE_TOOL_ARGUMENT_KEYWORDS)


__all__ = [
    "DEFAULT_WEATHER_LOCATION",
    "ExecutableTool",
    "FILE_CONVERT_TOOL_DESCRIPTION",
    "FILE_CONVERT_TOOL_DISPLAY_NAME",
    "FILE_CONVERT_TOOL_ID",
    "FILE_TOOL_EDIT_DESCRIPTION",
    "FILE_TOOL_EDIT_DISPLAY_NAME",
    "FILE_TOOL_GLOB_DESCRIPTION",
    "FILE_TOOL_GLOB_DISPLAY_NAME",
    "FILE_TOOL_NOTEBOOK_EDIT_DESCRIPTION",
    "FILE_TOOL_NOTEBOOK_EDIT_DISPLAY_NAME",
    "FILE_TOOL_READ_DESCRIPTION",
    "FILE_TOOL_READ_DISPLAY_NAME",
    "FILE_TOOL_WRITE_DESCRIPTION",
    "FILE_TOOL_WRITE_DISPLAY_NAME",
    "SKILL_ACTIVATE_TOOL_DESCRIPTION",
    "SKILL_ACTIVATE_TOOL_DISPLAY_NAME",
    "SKILL_ACTIVATE_TOOL_ID",
    "SKILL_READ_RESOURCE_TOOL_DESCRIPTION",
    "SKILL_READ_RESOURCE_TOOL_DISPLAY_NAME",
    "SKILL_READ_RESOURCE_TOOL_ID",
    "ToolDescriptor",
    "ToolPresentation",
    "ToolPresentationGroup",
    "ToolRegistry",
    "ToolsetDescriptor",
    "WEATHER_CURRENT_TOOL_DESCRIPTION",
    "WEATHER_CURRENT_TOOL_DISPLAY_NAME",
    "WEATHER_CURRENT_TOOL_ID",
    "DynamicToolLoader",
    "build_default_tool_registry",
    "execute_weather_current_tool",
    "normalize_tool_catalog_language",
    "summarize_tool_arguments",
    "summarize_tool_result",
]

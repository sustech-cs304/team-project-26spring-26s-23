"""Tool metadata registry and executable bindings for the Copilot runtime."""

from __future__ import annotations

import json
import random
from collections.abc import Awaitable, Callable, Iterable, Mapping
from dataclasses import dataclass
from typing import Any

from app.tools.file_convert import convert_file_to_str
from app.tooling.runtime_adapter.copilot_runtime import (
    ToolHostCapabilitiesFactory,
    build_default_contract_runtime_bindings,
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
FILE_CONVERT_TOOL_PROMPT = "Use this tool to convert DOCX, PDF, or PPTX files into plain text before analysis."
WEATHER_CURRENT_TOOL_ID = "tool.weather-current"
WEATHER_CURRENT_TOOL_DISPLAY_NAME = "Current Weather"
WEATHER_CURRENT_TOOL_DESCRIPTION = (
    "Return a placeholder current-weather result for a requested location."
)
WEATHER_CURRENT_TOOL_PROMPT = "Use this tool to retrieve a simple current weather summary for a location."

_BUILTIN_TOOL_LOCALES: dict[str, dict[str, dict[str, str]]] = {
    "zh-CN": {
        FILE_CONVERT_TOOL_ID: {
            "displayName": "文件转换",
            "description": "将 DOCX、PDF 和 PPTX 文件转换为纯文本。",
            "prompt": "在分析前使用此工具将 DOCX、PDF 或 PPTX 文件转换为纯文本。",
        },
        WEATHER_CURRENT_TOOL_ID: {
            "displayName": "当前天气",
            "description": "返回指定地点的占位当前天气结果。",
            "prompt": "使用此工具获取某个地点的简要当前天气摘要。",
        },
    },
    "en-US": {
        FILE_CONVERT_TOOL_ID: {
            "displayName": FILE_CONVERT_TOOL_DISPLAY_NAME,
            "description": FILE_CONVERT_TOOL_DESCRIPTION,
            "prompt": FILE_CONVERT_TOOL_PROMPT,
        },
        WEATHER_CURRENT_TOOL_ID: {
            "displayName": WEATHER_CURRENT_TOOL_DISPLAY_NAME,
            "description": WEATHER_CURRENT_TOOL_DESCRIPTION,
            "prompt": WEATHER_CURRENT_TOOL_PROMPT,
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
            "label": self.label_en if normalize_tool_catalog_language(language) == "en-US" else self.label_zh,
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
        display_name = self.display_name_en if normalized_language == "en-US" else self.display_name_zh
        description = self.description_en if normalized_language == "en-US" else self.description_zh
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

    def build_catalog_entry_for_language(self, language: str | None = None) -> dict[str, Any]:
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
                None if self.presentation is None else self.presentation.build_catalog_view()
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

    def build_catalog_entry(self) -> dict[str, Any]:
        return self.descriptor.build_catalog_entry()

    def build_catalog_entry_for_language(self, language: str | None = None) -> dict[str, Any]:
        return self.descriptor.build_catalog_entry_for_language(language)

    def build_summary(self) -> dict[str, Any]:
        return self.descriptor.build_summary()


@dataclass(frozen=True, slots=True)
class ToolsetDescriptor:
    name: str
    label: str
    description: str
    default: bool = False
    tools: tuple[ToolDescriptor | ExecutableTool, ...] = ()

    def build_view(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "toolCount": len(self.tools),
        }

    def build_diagnostics_summary(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "label": self.label,
            "description": self.description,
            "default": self.default,
            "toolCount": len(self.tools),
            "tools": [tool.build_summary() for tool in self.tools],
        }


class ToolRegistry:
    def __init__(self, descriptors: Iterable[ToolsetDescriptor] = ()) -> None:
        self._descriptors_by_name: dict[str, ToolsetDescriptor] = {}
        self._default_toolset_name: str | None = None
        self._tools_by_id_by_toolset: dict[str, dict[str, ExecutableTool]] = {}
        for descriptor in descriptors:
            self.register(descriptor)

    @property
    def directory_version(self) -> str:
        return DEFAULT_TOOL_DIRECTORY_VERSION

    def register(self, descriptor: ToolsetDescriptor) -> ToolsetDescriptor:
        if descriptor.name.strip() == "":
            raise ValueError("Toolset name must be a non-empty string.")
        if descriptor.name in self._descriptors_by_name:
            raise ValueError(f"Toolset '{descriptor.name}' is already registered.")
        self._validate_tools(descriptor)
        if descriptor.default:
            if self._default_toolset_name is not None:
                raise ValueError(
                    f"Default toolset is already registered as '{self._default_toolset_name}'."
                )
            self._default_toolset_name = descriptor.name

        self._descriptors_by_name[descriptor.name] = descriptor
        self._tools_by_id_by_toolset[descriptor.name] = {
            tool.tool_id: self._as_executable_tool(tool) for tool in descriptor.tools
        }
        return descriptor

    def get(self, name: str) -> ToolsetDescriptor | None:
        return self._descriptors_by_name.get(name)

    def get_default(self) -> ToolsetDescriptor:
        if self._default_toolset_name is None:
            raise LookupError("No default toolset is registered.")
        return self._descriptors_by_name[self._default_toolset_name]

    def supports(self, name: str) -> bool:
        return name in self._descriptors_by_name

    def build_view(self) -> dict[str, dict[str, Any]]:
        return {
            name: descriptor.build_view()
            for name, descriptor in self._descriptors_by_name.items()
        }

    def build_tool_catalog(
        self,
        toolset_name: str | None = None,
        *,
        language: str | None = None,
    ) -> tuple[dict[str, Any], ...]:
        descriptor = self.get_default() if toolset_name is None else self.get(toolset_name)
        if descriptor is None:
            raise LookupError(f"Unknown toolset '{toolset_name}'.")
        return tuple(tool.build_catalog_entry_for_language(language) for tool in descriptor.tools)

    def list_tool_ids(self, toolset_name: str | None = None) -> tuple[str, ...]:
        descriptor = self.get_default() if toolset_name is None else self.get(toolset_name)
        if descriptor is None:
            raise LookupError(f"Unknown toolset '{toolset_name}'.")
        return tuple(tool.tool_id for tool in descriptor.tools)

    def resolve_tool(self, tool_id: str, toolset_name: str | None = None) -> ExecutableTool:
        resolved_toolset_name = self.get_default().name if toolset_name is None else toolset_name
        try:
            return self._tools_by_id_by_toolset[resolved_toolset_name][tool_id]
        except KeyError as exc:
            raise LookupError(f"Unknown tool '{tool_id}'.") from exc

    def build_diagnostics_summary(self) -> dict[str, Any]:
        return {
            "available_toolsets": [
                descriptor.name for descriptor in self._descriptors_by_name.values()
            ],
            "default_toolset": self._default_toolset_name,
            "tool_directory_version": self.directory_version,
            "toolset_summaries": [
                descriptor.build_diagnostics_summary()
                for descriptor in self._descriptors_by_name.values()
            ],
        }

    def _validate_tools(self, descriptor: ToolsetDescriptor) -> None:
        tool_ids: set[str] = set()
        for tool in descriptor.tools:
            if tool.tool_id.strip() == "":
                raise ValueError(
                    f"Toolset '{descriptor.name}' contains a tool with an empty tool_id."
                )
            if tool.tool_id in tool_ids:
                raise ValueError(
                    f"Toolset '{descriptor.name}' contains duplicate tool id '{tool.tool_id}'."
                )
            tool_ids.add(tool.tool_id)

    def _as_executable_tool(self, tool: ToolDescriptor | ExecutableTool) -> ExecutableTool:
        if isinstance(tool, ExecutableTool):
            return tool
        return ExecutableTool(
            descriptor=tool,
            execute=_execute_unimplemented_tool,
        )


async def _execute_unimplemented_tool(_arguments: Mapping[str, Any] | None) -> dict[str, Any]:
    raise RuntimeError("Tool execution is not implemented for this tool.")


async def _execute_default_file_convert_tool(
    arguments: Mapping[str, Any] | None,
) -> dict[str, Any]:
    payload = dict(arguments or {})
    raw_path = payload.get("path")
    if not isinstance(raw_path, str) or raw_path.strip() == "":
        raise ValueError("File Convert tool requires a non-empty 'path' string argument.")

    path = raw_path.strip()
    raw_suffix = payload.get("suffix")
    suffix = (
        raw_suffix.strip()
        if isinstance(raw_suffix, str) and raw_suffix.strip() != ""
        else None
    )
    result: dict[str, Any] = {
        "path": path,
        "text": convert_file_to_str(path, suffix=suffix),
    }
    if suffix is not None:
        result["suffix"] = suffix
    return result


async def execute_weather_current_tool(
    arguments: Mapping[str, Any] | None,
    *,
    rng: random.Random | None = None,
) -> dict[str, Any]:
    payload = dict(arguments or {})
    raw_location = payload.get("location")
    if isinstance(raw_location, str):
        location = raw_location.strip() or DEFAULT_WEATHER_LOCATION
    else:
        location = DEFAULT_WEATHER_LOCATION

    random_source = rng or random.Random()
    sample = dict(random_source.choice(_WEATHER_SAMPLE_RESULTS))
    return {
        "location": location,
        "condition": sample["condition"],
        "temperatureC": sample["temperatureC"],
        "humidity": sample["humidity"],
        "summary": sample["summary"],
    }


async def _execute_default_weather_tool(arguments: Mapping[str, Any] | None) -> dict[str, Any]:
    return await execute_weather_current_tool(arguments)


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
_MCP_TOOL_GROUP = ToolPresentationGroup(
    group_id="mcp",
    label_zh="MCP 工具",
    label_en="MCP Tools",
    order=100,
    source_kind="mcp-server",
)

_TOOL_PRESENTATION_GROUPS_BY_ID: dict[str, ToolPresentationGroup] = {
    FILE_CONVERT_TOOL_ID: _BUILTIN_TOOL_GROUP,
    WEATHER_CURRENT_TOOL_ID: _BUILTIN_TOOL_GROUP,
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
    WEATHER_CURRENT_TOOL_ID: {
        "display_name_zh": "当前天气",
        "display_name_en": WEATHER_CURRENT_TOOL_DISPLAY_NAME,
        "description_zh": "返回指定地点的占位当前天气结果。",
        "description_en": WEATHER_CURRENT_TOOL_DESCRIPTION,
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
) -> ToolRegistry:
    registry = ToolRegistry()
    registry.register(
        ToolsetDescriptor(
            name=DEFAULT_TOOLSET_NAME,
            label=DEFAULT_TOOLSET_LABEL,
            description=DEFAULT_TOOLSET_DESCRIPTION,
            default=True,
            tools=(
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
            value,
            limit=_MAX_TOOL_ARGUMENT_VALUE_LENGTH,
        )
    return value


def _is_sensitive_tool_argument_key(key: str) -> bool:
    normalized_key = "".join(character for character in key.lower() if character.isalnum())
    return any(
        keyword in normalized_key
        for keyword in _SENSITIVE_TOOL_ARGUMENT_KEYWORDS
    )


def _truncate_tool_argument_text(value: str, *, limit: int) -> str:
    if len(value) <= limit:
        return value
    if limit <= 1:
        return value[:limit]
    return f"{value[: limit - 1]}…"


def _truncate_tool_result_text(value: str) -> str:
    return _truncate_tool_argument_text(
        value,
        limit=_MAX_TOOL_RESULT_SUMMARY_LENGTH,
    )



def _serialize_tool_result_value(value: Any) -> str:
    try:
        if isinstance(value, Mapping):
            return json.dumps(dict(value), ensure_ascii=False, sort_keys=True)
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    except TypeError:
        if isinstance(value, Mapping):
            return str(dict(value))
        return str(value)



def _compact_tool_result_text(value: Any) -> str:
    return _truncate_tool_result_text(_serialize_tool_result_value(value))



def _as_non_empty_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None



def _persistence_detail(output: Mapping[str, Any]) -> str | None:
    persistence = output.get("persistence")
    if not isinstance(persistence, Mapping) or not persistence:
        return None
    return "含持久化摘要"



def _format_named_counts(
    counts: Mapping[str, Any],
    *,
    keys: tuple[str, ...],
) -> str | None:
    parts: list[str] = []
    for key in keys:
        value = counts.get(key)
        if isinstance(value, bool):
            continue
        if isinstance(value, (int, float)):
            parts.append(f"{key} {int(value)}")
    if not parts:
        return None
    return "、".join(parts)



def _format_semester_label(value: Any) -> str | None:
    if not isinstance(value, Mapping):
        return None
    label = _as_non_empty_text(value.get("label"))
    if label is not None:
        return label
    academic_year = _as_non_empty_text(value.get("academic_year"))
    term_code = _as_non_empty_text(value.get("term_code"))
    if academic_year is None and term_code is None:
        return None
    if academic_year is None:
        return term_code
    if term_code is None:
        return academic_year
    return f"{academic_year}-{term_code}"



def _summarize_weather_mapping(result: Mapping[str, Any]) -> str | None:
    location = result.get("location")
    condition = result.get("condition")
    temperature = result.get("temperatureC")
    humidity = result.get("humidity")
    if all(value is not None for value in (location, condition, temperature, humidity)):
        return _truncate_tool_result_text(
            f"{location}：{condition} / {temperature}°C / 湿度 {humidity}%"
        )
    return None



def _infer_compact_tool_id(output: Mapping[str, Any]) -> str | None:
    if "scrapedCounts" in output and "integrityOk" in output:
        return "blackboard.snapshot.sync"
    if "totalRecords" in output and "sourceUrl" in output:
        return "tis.personal_grades.fetch"
    if "courseCount" in output and "semester" in output:
        return "tis.selected_courses.fetch"
    if "summary" in output and "sourceUrl" in output:
        return "tis.credit_gpa.fetch"
    return None



def _summarize_blackboard_snapshot_output(output: Mapping[str, Any]) -> str | None:
    details: list[str] = []
    db_path = _as_non_empty_text(output.get("dbPath"))
    if db_path is not None:
        details.append(f"db={db_path}")
    scraped_counts = output.get("scrapedCounts")
    if isinstance(scraped_counts, Mapping):
        counts_summary = _format_named_counts(
            scraped_counts,
            keys=("courses", "assignments", "resources", "grades", "announcements"),
        )
        if counts_summary is not None:
            details.append(counts_summary)
    integrity_ok = output.get("integrityOk")
    if integrity_ok is True:
        details.append("完整性校验通过")
    elif integrity_ok is False:
        details.append("完整性校验未通过")
    second_sync_no_new = output.get("secondSyncHasNoNewRecords")
    second_sync_no_deleted = output.get("secondSyncHasNoDeletedRecords")
    if second_sync_no_new is True and second_sync_no_deleted is True:
        details.append("二次同步无新增且无删除")
    elif second_sync_no_new is True:
        details.append("二次同步无新增")
    elif second_sync_no_deleted is True:
        details.append("二次同步无删除")
    if not details:
        return None
    return _truncate_tool_result_text(
        f"Blackboard snapshot 同步完成；{'；'.join(details)}"
    )



def _summarize_tis_personal_grades_output(output: Mapping[str, Any]) -> str | None:
    details: list[str] = []
    total_records = output.get("totalRecords")
    if isinstance(total_records, bool):
        total_records = None
    if isinstance(total_records, (int, float)):
        details.append(f"{int(total_records)} 条记录")
    role_code = _as_non_empty_text(output.get("resolvedRoleCode"))
    if role_code is not None:
        details.append(f"role={role_code}")
    persistence_detail = _persistence_detail(output)
    if persistence_detail is not None:
        details.append(persistence_detail)
    if not details:
        return None
    return _truncate_tool_result_text(
        f"TIS 成绩抓取完成；{'；'.join(details)}"
    )



def _summarize_tis_credit_gpa_output(output: Mapping[str, Any]) -> str | None:
    details: list[str] = []
    summary = output.get("summary")
    if isinstance(summary, Mapping):
        average_credit_gpa = summary.get("average_credit_gpa")
        if not isinstance(average_credit_gpa, bool) and isinstance(
            average_credit_gpa,
            (int, float),
        ):
            details.append(f"均绩 {average_credit_gpa:g}")
        rank = _as_non_empty_text(summary.get("rank"))
        if rank is not None:
            details.append(f"排名 {rank}")
    role_code = _as_non_empty_text(output.get("resolvedRoleCode"))
    if role_code is not None:
        details.append(f"role={role_code}")
    persistence_detail = _persistence_detail(output)
    if persistence_detail is not None:
        details.append(persistence_detail)
    if not details:
        return None
    return _truncate_tool_result_text(
        f"TIS 绩点摘要抓取完成；{'；'.join(details)}"
    )



def _summarize_tis_selected_courses_output(output: Mapping[str, Any]) -> str | None:
    details: list[str] = []
    semester_label = _format_semester_label(output.get("semester"))
    if semester_label is not None:
        details.append(semester_label)
    course_count = output.get("courseCount")
    if not isinstance(course_count, bool) and isinstance(course_count, (int, float)):
        details.append(f"{int(course_count)} 门课程")
    role_code = _as_non_empty_text(output.get("resolvedRoleCode"))
    if role_code is not None:
        details.append(f"role={role_code}")
    persistence_detail = _persistence_detail(output)
    if persistence_detail is not None:
        details.append(persistence_detail)
    if not details:
        return None
    return _truncate_tool_result_text(
        f"TIS 选课抓取完成；{'；'.join(details)}"
    )



def _summarize_known_tool_output(
    *,
    tool_id: str | None,
    output: Mapping[str, Any],
) -> str | None:
    resolved_tool_id = tool_id or _infer_compact_tool_id(output)
    if resolved_tool_id == "blackboard.snapshot.sync":
        return _summarize_blackboard_snapshot_output(output)
    if resolved_tool_id == "tis.personal_grades.fetch":
        return _summarize_tis_personal_grades_output(output)
    if resolved_tool_id == "tis.credit_gpa.fetch":
        return _summarize_tis_credit_gpa_output(output)
    if resolved_tool_id == "tis.selected_courses.fetch":
        return _summarize_tis_selected_courses_output(output)
    return None



def _summarize_tool_output_value(*, tool_id: str | None, output: Any) -> str | None:
    if output is None:
        return None
    if isinstance(output, str):
        value = output.strip()
        return _truncate_tool_result_text(value) if value else None
    if isinstance(output, Mapping):
        summary = _summarize_known_tool_output(tool_id=tool_id, output=output)
        if summary is not None:
            return summary
        weather_summary = _summarize_weather_mapping(output)
        if weather_summary is not None:
            return weather_summary
        return _compact_tool_result_text(output)
    return _compact_tool_result_text(output)



def summarize_tool_result(result: Any) -> str | None:
    if result is None:
        return None
    if isinstance(result, str):
        value = result.strip()
        return _truncate_tool_result_text(value) if value else None
    if isinstance(result, Mapping):
        if result.get("status") == "success":
            metadata = result.get("metadata")
            tool_id = (
                _as_non_empty_text(metadata.get("toolId"))
                if isinstance(metadata, Mapping)
                else None
            )
            output_summary = _summarize_tool_output_value(
                tool_id=tool_id,
                output=result.get("output"),
            )
            if output_summary is not None:
                return output_summary
        weather_summary = _summarize_weather_mapping(result)
        if weather_summary is not None:
            return weather_summary
        return _compact_tool_result_text(result)
    return _compact_tool_result_text(result)


__all__ = [
    "DEFAULT_TOOLSET_DESCRIPTION",
    "DEFAULT_TOOLSET_LABEL",
    "DEFAULT_TOOLSET_NAME",
    "DEFAULT_TOOL_DIRECTORY_VERSION",
    "DEFAULT_TOOL_AVAILABILITY",
    "DEFAULT_TOOL_KIND",
    "DEFAULT_WEATHER_LOCATION",
    "ExecutableTool",
    "FILE_CONVERT_TOOL_DESCRIPTION",
    "FILE_CONVERT_TOOL_DISPLAY_NAME",
    "FILE_CONVERT_TOOL_ID",
    "ToolDescriptor",
    "ToolExecutor",
    "ToolPresentation",
    "ToolPresentationGroup",
    "ToolRegistry",
    "ToolsetDescriptor",
    "WEATHER_CURRENT_TOOL_DESCRIPTION",
    "WEATHER_CURRENT_TOOL_DISPLAY_NAME",
    "WEATHER_CURRENT_TOOL_ID",
    "build_default_tool_registry",
    "execute_weather_current_tool",
    "summarize_tool_arguments",
    "summarize_tool_result",
]

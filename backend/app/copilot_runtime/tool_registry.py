"""Tool metadata registry and executable bindings for the Copilot runtime."""

from __future__ import annotations

import json
import random
from collections.abc import Awaitable, Callable, Iterable, Mapping
from dataclasses import dataclass
from enum import Enum
from typing import Any

from app.tools.file_convert import convert_file_to_str

DEFAULT_TOOLSET_NAME = "default"
DEFAULT_TOOLSET_LABEL = "Default"
DEFAULT_TOOLSET_DESCRIPTION = (
    "Builtin Copilot runtime tools exposed as the default toolset directory."
)
DEFAULT_TOOL_DIRECTORY_VERSION = "tools-v1"
DEFAULT_TOOL_KIND = "builtin"
DEFAULT_TOOL_AVAILABILITY = "available"
FILE_CONVERT_TOOL_ID = "tool.file-convert"
FILE_CONVERT_TOOL_DISPLAY_NAME = "File Convert"
FILE_CONVERT_TOOL_DESCRIPTION = "Convert DOCX, PDF, and PPTX files into text."
WEATHER_CURRENT_TOOL_ID = "tool.weather-current"
WEATHER_CURRENT_TOOL_DISPLAY_NAME = "Current Weather"
WEATHER_CURRENT_TOOL_DESCRIPTION = (
    "Return a placeholder current-weather result for a requested location."
)
DEFAULT_WEATHER_LOCATION = "Shenzhen"
DEMO_DANGEROUS_TOOL_ID = "tool.demo-dangerous"
DEMO_DANGEROUS_TOOL_DISPLAY_NAME = "Dangerous Action"
DEMO_DANGEROUS_TOOL_DESCRIPTION = "A demo dangerous tool for testing the interceptor/approval flow."

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

class RiskLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"

@dataclass(frozen=True, slots=True)
class ToolSecurityConfig:
    risk_level: RiskLevel = RiskLevel.HIGH
    approval_method: str = "button_click"

ToolExecutor = Callable[[Mapping[str, Any] | None], Awaitable[dict[str, Any]]]


@dataclass(frozen=True, slots=True)
class ToolDescriptor:
    """Stable tool contract fields are centered on `tool_id`; display fields are hints only."""

    tool_id: str
    kind: str = DEFAULT_TOOL_KIND
    display_name: str | None = None
    description: str | None = None
    availability: str = DEFAULT_TOOL_AVAILABILITY
    security: ToolSecurityConfig = ToolSecurityConfig()

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
        return entry

    def build_summary(self) -> dict[str, Any]:
        return {
            "toolId": self.tool_id,
            "kind": self.kind,
            "availability": self.availability,
            "security": {"riskLevel": self.security.risk_level.value, "approvalMethod": self.security.approval_method},
            "displayName": self.display_name,
            "description": self.description,
        }


@dataclass(frozen=True, slots=True)
class ExecutableTool:
    descriptor: ToolDescriptor
    execute: ToolExecutor

    @property
    def tool_id(self) -> str:
        return self.descriptor.tool_id

    def build_catalog_entry(self) -> dict[str, Any]:
        return self.descriptor.build_catalog_entry()

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

    def build_tool_catalog(self, toolset_name: str | None = None) -> tuple[dict[str, Any], ...]:
        descriptor = self.get_default() if toolset_name is None else self.get(toolset_name)
        if descriptor is None:
            raise LookupError(f"Unknown toolset '{toolset_name}'.")
        return tuple(tool.build_catalog_entry() for tool in descriptor.tools)

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


async def _execute_demo_dangerous_tool(arguments: Mapping[str, Any] | None) -> dict[str, Any]:
    return {"status": "danger_action_completed", "message": "I did something dangerous!"}

DEMO_DANGEROUS_EXECUTABLE_TOOL = ExecutableTool(
    descriptor=ToolDescriptor(
        tool_id=DEMO_DANGEROUS_TOOL_ID,
        kind=DEFAULT_TOOL_KIND,
        display_name=DEMO_DANGEROUS_TOOL_DISPLAY_NAME,
        description=DEMO_DANGEROUS_TOOL_DESCRIPTION,
        availability=DEFAULT_TOOL_AVAILABILITY,
        security=ToolSecurityConfig(risk_level=RiskLevel.HIGH)
    ),
    execute=_execute_demo_dangerous_tool,
)

def build_default_tool_registry() -> ToolRegistry:
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
                    ),
                    execute=_execute_default_weather_tool,
                ),
            ),
        )
    )
    return registry


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


def summarize_tool_result(result: Any) -> str | None:
    if result is None:
        return None
    if isinstance(result, str):
        value = result.strip()
        return value or None
    if isinstance(result, Mapping):
        location = result.get("location")
        condition = result.get("condition")
        temperature = result.get("temperatureC")
        humidity = result.get("humidity")
        if all(value is not None for value in (location, condition, temperature, humidity)):
            return (
                f"{location}：{condition} / {temperature}°C / 湿度 {humidity}%"
            )
        try:
            return json.dumps(dict(result), ensure_ascii=False, sort_keys=True)
        except TypeError:
            return str(dict(result))
    try:
        return json.dumps(result, ensure_ascii=False, sort_keys=True)
    except TypeError:
        return str(result)


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

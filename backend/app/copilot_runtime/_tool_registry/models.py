"""Core registry dataclasses and container types for the tool registry."""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .constants import (
    DEFAULT_TOOL_AVAILABILITY,
    DEFAULT_TOOL_DIRECTORY_VERSION,
    DEFAULT_TOOL_KIND,
    INTERNAL_TOOL_IDS,
)
from .helpers import normalize_tool_catalog_language, resolve_builtin_tool_locale

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
            localized_fields = resolve_builtin_tool_locale(self.tool_id, language)
            display_name = localized_fields.get("displayName") or self.tool_id
            description = localized_fields.get("description") or ""
            prompt = localized_fields.get("prompt")
            entry["displayName"] = display_name
            entry["description"] = description
            if prompt is not None:
                normalized_prompt = prompt.strip()
                if normalized_prompt != "":
                    entry["prompt"] = normalized_prompt
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
        visible_tools = tuple(
            tool for tool in self.tools if tool.tool_id not in INTERNAL_TOOL_IDS
        )
        return {
            "name": self.name,
            "label": self.label,
            "description": self.description,
            "default": self.default,
            "toolCount": len(visible_tools),
            "tools": [tool.descriptor.build_summary() for tool in visible_tools],
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

    def list_tool_ids(
        self, *, toolset_name: str | None = None, include_internal: bool = False
    ) -> tuple[str, ...]:
        toolset = (
            self.get_default() if toolset_name is None else self._toolsets[toolset_name]
        )
        tool_ids = [
            tool.tool_id
            for tool in toolset.tools
            if include_internal or tool.tool_id not in INTERNAL_TOOL_IDS
        ]
        for tool in self._load_dynamic_tools(toolset_name=toolset.name):
            if tool.tool_id not in tool_ids:
                if not include_internal and tool.tool_id in INTERNAL_TOOL_IDS:
                    continue
                tool_ids.append(tool.tool_id)
        return tuple(tool_ids)

    def build_view(self) -> dict[str, dict[str, Any]]:
        def _visible_count(toolset: ToolsetDescriptor) -> int:
            return sum(1 for tool in toolset.tools if tool.tool_id not in INTERNAL_TOOL_IDS)

        return {
            toolset.name: {
                "name": toolset.name,
                "description": toolset.description,
                "toolCount": _visible_count(toolset),
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
            if tool.tool_id in INTERNAL_TOOL_IDS:
                continue
            catalog.append(tool.descriptor.build_catalog_entry_for_language(language))
            seen_tool_ids.add(tool.tool_id)
        for tool in self._load_dynamic_tools(
            toolset_name=toolset.name, language=language
        ):
            if tool.tool_id in seen_tool_ids:
                continue
            if tool.tool_id in INTERNAL_TOOL_IDS:
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

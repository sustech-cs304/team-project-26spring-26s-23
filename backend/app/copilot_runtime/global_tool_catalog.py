from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .contracts import RuntimeContract, RuntimeToolDirectoryEntry, RuntimeScaffold
from .tool_registry import normalize_tool_catalog_language

GLOBAL_TOOL_CATALOG_GET_METHOD = "tools/catalog/get"


@dataclass(frozen=True, slots=True)
class RuntimeGlobalToolCatalogResponse(RuntimeContract):
    ok: bool
    directoryVersion: str
    defaultToolset: str
    tools: tuple[RuntimeToolDirectoryEntry, ...]


def build_global_tool_catalog_response(
    scaffold: RuntimeScaffold,
    *,
    language: str | None = None,
) -> RuntimeGlobalToolCatalogResponse:
    resolved_language = normalize_tool_catalog_language(language)
    return RuntimeGlobalToolCatalogResponse(
        ok=True,
        directoryVersion=scaffold.tool_directory_version,
        defaultToolset=scaffold.default_toolset,
        language=resolved_language,
        tools=scaffold.get_global_tool_catalog(language=resolved_language),
    )


__all__ = [
    "GLOBAL_TOOL_CATALOG_GET_METHOD",
    "RuntimeGlobalToolCatalogResponse",
    "build_global_tool_catalog_response",
]

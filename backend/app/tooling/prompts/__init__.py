"""Prompt utilities for agent-facing system text."""

from __future__ import annotations

from dataclasses import dataclass

from app.copilot_runtime._tool_registry.constants import (
    BUILTIN_TOOL_LOCALES,
    DEFAULT_TOOL_CATALOG_LANGUAGE,
)


class _SafeFormatDict(dict[str, str]):
    def __missing__(self, key: str) -> str:
        return "{" + key + "}"


@dataclass(frozen=True, slots=True)
class PromptContext:
    current_month_year: str | None = None

    def inject(self, template: str) -> str:
        payload: dict[str, str] = {}
        if self.current_month_year is not None:
            payload["current_month_year"] = self.current_month_year
        return template.format_map(_SafeFormatDict(payload))


def get_tool_description(tool_id: str, *, language: str | None = None) -> str | None:
    resolved_language = language or DEFAULT_TOOL_CATALOG_LANGUAGE
    locale = BUILTIN_TOOL_LOCALES.get(resolved_language) or BUILTIN_TOOL_LOCALES.get(
        "en-US", {}
    )
    entry = locale.get(tool_id)
    if entry is None:
        return None
    description = entry.get("description")
    if description is None:
        return None
    normalized = description.strip()
    return normalized or None

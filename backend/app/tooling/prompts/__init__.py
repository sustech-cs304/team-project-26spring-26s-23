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
"""Public API for the tool prompts package."""

from __future__ import annotations

from typing import Any

from ._base import ToolPrompt
from ._context import PromptContext

# ---------------------------------------------------------------------------
# Global registry — all tool prompts indexed by tool_id
# ---------------------------------------------------------------------------

_registry: dict[str, ToolPrompt] = {}


def register_tool_prompt(prompt: ToolPrompt) -> None:
    """Register a tool prompt in the global registry.

    Later registrations for the same tool_id overwrite earlier ones
    (useful for MCP tool prompt overrides).
    """
    _registry[prompt.tool_id] = prompt


def register_tool_prompts(prompts: tuple[ToolPrompt, ...]) -> None:
    """Bulk-register multiple tool prompts."""
    for prompt in prompts:
        register_tool_prompt(prompt)


def get_tool_prompt(tool_id: str) -> ToolPrompt | None:
    """Get a single tool's structured prompt."""
    return _registry.get(tool_id)


def get_all_tool_prompts() -> dict[str, ToolPrompt]:
    """Return a shallow copy of the registry."""
    return dict(_registry)


def get_tool_description(tool_id: str, *, context: PromptContext | None = None) -> str | None:
    """Get the rendered description string for a tool.

    This is the primary entry point for adapters that need to send tool
    descriptions to the LLM.
    """
    prompt = _registry.get(tool_id)
    if prompt is None:
        return None
    return prompt.render(context=context)


def get_all_tool_descriptions(
    *, context: PromptContext | None = None
) -> dict[str, str]:
    """Get rendered descriptions for all registered tools."""
    result: dict[str, str] = {}
    for tool_id, prompt in _registry.items():
        result[tool_id] = prompt.render(context=context)
    return result


def get_tool_prompts_as_dicts(
    *, context: PromptContext | None = None
) -> list[dict[str, Any]]:
    """Get all tool prompts as serializable dicts for frontend transport.

    Includes the rendered description and the structured sections.
    """
    result: list[dict[str, Any]] = []
    for tool_id, prompt in sorted(_registry.items()):
        entry = prompt.to_dict()
        entry["renderedDescription"] = prompt.render(context=context)
        result.append(entry)
    return result


def clear_registry() -> None:
    """Clear all registered tool prompts (useful for testing)."""
    _registry.clear()


# ---------------------------------------------------------------------------
# Bootstrap — load all bundled tool prompts
# ---------------------------------------------------------------------------


def _bootstrap() -> None:
    """Load all bundled tool prompts into the registry.

    Called once at module import time. Idempotent — subsequent calls
    will overwrite existing entries safely.
    """
    from .file_tools import FILE_TOOL_PROMPTS
    from .domain.blackboard import BLACKBOARD_PROMPTS
    from .domain.tis import TIS_PROMPTS

    register_tool_prompts(FILE_TOOL_PROMPTS)
    register_tool_prompts(BLACKBOARD_PROMPTS)
    register_tool_prompts(TIS_PROMPTS)


_bootstrap()


__all__ = [
    "PromptContext",
    "ToolPrompt",
    "clear_registry",
    "get_all_tool_descriptions",
    "get_all_tool_prompts",
    "get_tool_description",
    "get_tool_prompt",
    "get_tool_prompts_as_dicts",
    "register_tool_prompt",
    "register_tool_prompts",
]

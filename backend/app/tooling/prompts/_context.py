"""Dynamic context injection for tool prompt rendering.

Mirrors Claude Code's pattern of injecting runtime values (timeout, sandbox
config, current month/year) into otherwise static tool prompts.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True, slots=True)
class PromptContext:
    """Runtime context available for tool prompt rendering.

    Fields are intentionally minimal to avoid coupling tool prompts to
    specific runtime implementations. Extend via metadata dict when needed.
    """

    workspace_root: str | None = None
    max_read_lines: int = 2000
    max_glob_results: int = 500
    max_grep_results: int = 100
    default_timeout_ms: int = 600_000
    max_timeout_ms: int = 600_000
    available_tool_ids: tuple[str, ...] = ()
    database_path: str | None = None
    current_month_year: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    # ------------------------------------------------------------------
    # Template variable injection
    # ------------------------------------------------------------------

    _TEMPLATE_VARIABLES: tuple[str, ...] = (
        "workspace_root",
        "max_read_lines",
        "max_glob_results",
        "max_grep_results",
        "default_timeout_ms",
        "max_timeout_ms",
        "database_path",
        "current_month_year",
    )

    def inject(self, text: str) -> str:
        """Replace known template variables in the prompt text.

        Supports:
        - {{workspace_root}}
        - {{max_read_lines}}
        - {{max_glob_results}}
        - {{max_grep_results}}
        - {{default_timeout_ms}}
        - {{max_timeout_ms}}
        - {{database_path}}
        - {{current_month_year}}
        """
        result = text
        for var_name in self._TEMPLATE_VARIABLES:
            placeholder = f"{{{{{var_name}}}}}"
            value = getattr(self, var_name, None)
            if value is not None and placeholder in result:
                result = result.replace(placeholder, str(value))
        return result

    # ------------------------------------------------------------------
    # Factory
    # ------------------------------------------------------------------

    @classmethod
    def empty(cls) -> PromptContext:
        """Create a context with all defaults."""
        return cls()


__all__ = ["PromptContext"]

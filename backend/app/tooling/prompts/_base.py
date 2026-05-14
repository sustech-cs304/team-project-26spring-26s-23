"""Base abstractions for structured tool prompts designed for LLM function-calling accuracy.

Each ToolPrompt follows a six-section structure inspired by Claude Code's tool
prompt design pattern, providing the model with comprehensive usage context
beyond what JSON Schema alone can convey.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ._context import PromptContext

# Default values that match the competitor's patterns
DEFAULT_MAX_READ_LINES = 2000
DEFAULT_MAX_GLOB_RESULTS = 500
DEFAULT_MAX_GREP_RESULTS = 100


def _ensure_non_empty(text: str | None, *, field_name: str) -> str:
    if not text or not text.strip():
        raise ValueError(f"{field_name} must be a non-empty string.")
    return text.strip()


def _optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


@dataclass(frozen=True, slots=True)
class ToolPrompt:
    """Structured tool prompt designed for LLM function-calling accuracy.

    The six-section structure mirrors Claude Code's tool prompt design:
    1. description     — what the tool does (1-2 sentences)
    2. usage_guide     — when to use / when NOT to use / typical scenarios
    3. parameter_guide — parameter semantics beyond JSON Schema (constraints, tips)
    4. constraints     — preconditions, limits, guardrails
    5. relationships   — how this tool relates to other tools (prefer X over Y)
    6. examples        — concrete JSON invocation examples
    """

    tool_id: str
    description: str
    usage_guide: str = ""
    parameter_guide: str = ""
    constraints: str = ""
    relationships: str = ""
    examples: str = ""
    annotations: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(
            self, "tool_id", _ensure_non_empty(self.tool_id, field_name="tool_id")
        )
        object.__setattr__(
            self, "description", _ensure_non_empty(self.description, field_name="description")
        )
        object.__setattr__(self, "usage_guide", _optional_text(self.usage_guide) or "")
        object.__setattr__(self, "parameter_guide", _optional_text(self.parameter_guide) or "")
        object.__setattr__(self, "constraints", _optional_text(self.constraints) or "")
        object.__setattr__(self, "relationships", _optional_text(self.relationships) or "")
        object.__setattr__(self, "examples", _optional_text(self.examples) or "")
        object.__setattr__(self, "annotations", dict(self.annotations))

    # ------------------------------------------------------------------
    # Render modes — three levels of verbosity for different context budgets
    # ------------------------------------------------------------------

    def render_compact(self) -> str:
        """Minimal single-sentence description for tight context windows.

        Suitable for: combined tool list when context budget is limited.
        """
        return self.description

    def render(self, *, context: PromptContext | None = None) -> str:
        """Standard render with key sections — the default format for LLM tool
        description fields.

        This is the primary format used when sending tool definitions to
        the model via function-calling APIs.
        """
        sections: list[str] = [self.description]
        if self.usage_guide:
            sections.append(f"Usage:\n{self.usage_guide}")
        if self.parameter_guide:
            sections.append(f"Parameters:\n{self.parameter_guide}")
        if self.constraints:
            sections.append(f"Constraints:\n{self.constraints}")
        if self.relationships:
            sections.append(f"Relationships:\n{self.relationships}")
        if self.examples:
            sections.append(f"Examples:\n{self.examples}")
        rendered = "\n\n".join(sections)
        if context is not None:
            rendered = context.inject(rendered)
        return rendered

    def render_full(self, *, context: PromptContext | None = None) -> str:
        """Full tutorial-style prompt for maximum context windows.

        Suitable for: system prompt attachments or detailed tool documentation.
        """
        sections: list[str] = [
            f"## {self.tool_id}\n\n{self.description}",
        ]
        if self.usage_guide:
            sections.append(f"### When to Use\n{self.usage_guide}")
        if self.parameter_guide:
            sections.append(f"### Parameter Details\n{self.parameter_guide}")
        if self.constraints:
            sections.append(f"### Important Constraints\n{self.constraints}")
        if self.relationships:
            sections.append(f"### Relationship to Other Tools\n{self.relationships}")
        if self.examples:
            sections.append(f"### Examples\n{self.examples}")
        rendered = "\n\n".join(sections)
        if context is not None:
            rendered = context.inject(rendered)
        return rendered

    # ------------------------------------------------------------------
    # Factory helpers
    # ------------------------------------------------------------------

    @classmethod
    def minimal(cls, tool_id: str, description: str) -> ToolPrompt:
        """Create a minimal prompt with just the required fields."""
        return cls(tool_id=tool_id, description=description)

    def to_dict(self) -> dict[str, Any]:
        """Serialize to a dictionary suitable for JSON transmission to frontend."""
        return {
            "toolId": self.tool_id,
            "description": self.description,
            "usageGuide": self.usage_guide or None,
            "parameterGuide": self.parameter_guide or None,
            "constraints": self.constraints or None,
            "relationships": self.relationships or None,
            "examples": self.examples or None,
            "annotations": dict(self.annotations),
        }


__all__ = [
    "DEFAULT_MAX_GLOB_RESULTS",
    "DEFAULT_MAX_GREP_RESULTS",
    "DEFAULT_MAX_READ_LINES",
    "ToolPrompt",
]

"""Runtime tool permission resolution helpers for request-scoped visibility filtering."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    from .contracts import RuntimeToolPermissionPolicy

ResolvedToolPermissionMode = Literal["allow", "ask", "deny"]


@dataclass(frozen=True, slots=True)
class RuntimeToolPermissionResolver:
    """Resolve request policy overrides into per-tool runtime permission modes."""

    default_mode: ResolvedToolPermissionMode = "ask"
    tool_modes: dict[str, ResolvedToolPermissionMode] | None = None

    @classmethod
    def from_policy(
        cls,
        policy: RuntimeToolPermissionPolicy | None,
    ) -> "RuntimeToolPermissionResolver":
        if policy is None:
            return cls()
        return cls(default_mode=policy.defaultMode, tool_modes=dict(policy.toolModes))

    def resolve_mode(self, tool_id: str) -> ResolvedToolPermissionMode:
        if self.tool_modes is None:
            return self.default_mode
        return self.tool_modes.get(tool_id, self.default_mode)

    def is_visible(self, tool_id: str) -> bool:
        return self.resolve_mode(tool_id) != "deny"

    def filter_tool_ids(self, tool_ids: tuple[str, ...] | list[str]) -> tuple[str, ...]:
        return tuple(tool_id for tool_id in tool_ids if self.is_visible(tool_id))


__all__ = ["ResolvedToolPermissionMode", "RuntimeToolPermissionResolver"]

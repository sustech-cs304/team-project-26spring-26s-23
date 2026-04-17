"""Runtime tool permission resolution helpers for request-scoped visibility filtering."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal, cast

if TYPE_CHECKING:
    from .contracts import RuntimeToolPermissionPolicy

ResolvedToolPermissionMode = Literal["allow", "ask", "delay", "deny"]
ResolvedToolTimeoutAction = Literal["approve", "deny"]


def parse_tool_timeout_seconds(value: object) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value > 0 else None
    if isinstance(value, float):
        return int(value) if value > 0 and value.is_integer() else None
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if not normalized.isdigit():
        return None
    parsed = int(normalized)
    return parsed if parsed > 0 else None


@dataclass(frozen=True, slots=True)
class RuntimeToolPermissionResolver:
    """Resolve request policy overrides into per-tool runtime permission modes."""

    default_mode: ResolvedToolPermissionMode = "ask"
    tool_modes: dict[str, ResolvedToolPermissionMode] | None = None
    tool_timeout_seconds: dict[str, int] | None = None
    tool_timeout_actions: dict[str, ResolvedToolTimeoutAction] | None = None

    @classmethod
    def from_policy(
        cls,
        policy: RuntimeToolPermissionPolicy | None,
    ) -> "RuntimeToolPermissionResolver":
        if policy is None:
            return cls()
        return cls(
            default_mode=policy.defaultMode,
            tool_modes=dict(policy.toolModes),
            tool_timeout_seconds={
                tool_id: timeout_seconds
                for tool_id, raw_timeout_seconds in dict(policy.toolTimeoutSeconds or {}).items()
                if (timeout_seconds := parse_tool_timeout_seconds(raw_timeout_seconds)) is not None
            },
            tool_timeout_actions={
                tool_id: cast(ResolvedToolTimeoutAction, timeout_action)
                for tool_id, timeout_action in dict(policy.toolTimeoutActions or {}).items()
                if timeout_action in ("approve", "deny")
            },
        )

    def resolve_mode(self, tool_id: str) -> ResolvedToolPermissionMode:
        if self.tool_modes is None:
            return self.default_mode
        return self.tool_modes.get(tool_id, self.default_mode)

    def is_visible(self, tool_id: str) -> bool:
        return self.resolve_mode(tool_id) != "deny"

    def filter_tool_ids(self, tool_ids: tuple[str, ...] | list[str]) -> tuple[str, ...]:
        return tuple(tool_id for tool_id in tool_ids if self.is_visible(tool_id))

    def resolve_timeout_seconds(self, tool_id: str) -> int | None:
        if self.tool_timeout_seconds is None:
            return None
        return self.tool_timeout_seconds.get(tool_id)

    def resolve_timeout_action(self, tool_id: str) -> ResolvedToolTimeoutAction | None:
        if self.tool_timeout_actions is None:
            return None
        return self.tool_timeout_actions.get(tool_id)


__all__ = [
    "ResolvedToolPermissionMode",
    "ResolvedToolTimeoutAction",
    "RuntimeToolPermissionResolver",
    "parse_tool_timeout_seconds",
]

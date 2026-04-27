"""Session store record types extracted from session_store.py.

These are pure record/error types with no dependency on store logic.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal

from ..model_routes import RuntimeModelRouteRef

RuntimeMessageRole = Literal["user", "assistant"]
RuntimeRunStatus = Literal[
    "pending",
    "streaming",
    "cancellation_requested",
    "completed",
    "failed",
    "cancelled",
]


class BoundAgentMismatchError(RuntimeError):
    """Raised when an existing thread is accessed with a different bound agent."""

    def __init__(
        self,
        *,
        session_id: str,
        expected_agent_id: str,
        actual_agent_id: str,
    ) -> None:
        self.session_id = session_id
        self.expected_agent_id = expected_agent_id
        self.actual_agent_id = actual_agent_id
        super().__init__(
            "Session "
            f"'{session_id}' is bound to agent '{expected_agent_id}', "
            f"cannot use agent '{actual_agent_id}'."
        )


@dataclass(frozen=True, slots=True)
class RuntimeTextMessage:
    """Minimal projected text message rebuilt from completed thread runs."""

    role: RuntimeMessageRole
    content: str
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))


@dataclass(frozen=True, slots=True)
class RuntimeRunEventRecord:
    """Minimal persisted event record attached to a run."""

    event_type: str
    payload: dict[str, Any] = field(default_factory=dict)
    sequence: int | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))


@dataclass(slots=True)
class RuntimeThreadRecord:
    """Canonical per-thread record kept in process memory."""

    thread_id: str
    bound_agent_id: str
    metadata: dict[str, Any] = field(default_factory=dict)
    last_run_id: str | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    @property
    def session_id(self) -> str:
        return self.thread_id

    @property
    def agent_name(self) -> str:
        return self.bound_agent_id

    def touch(self, *, metadata: Mapping[str, Any] | None = None) -> None:
        if metadata:
            self.metadata = {**self.metadata, **dict(metadata)}
        self.updated_at = datetime.now(UTC)


@dataclass(frozen=True, slots=True)
class RuntimeStoredModelRoute:
    provider_profile_id: str
    route_ref: RuntimeModelRouteRef
    catalog_revision: str | None = None

    def __post_init__(self) -> None:
        if self.route_ref.profile_id != self.provider_profile_id:
            raise ValueError(
                "RuntimeStoredModelRoute.provider_profile_id must match route_ref.profile_id."
            )


@dataclass(frozen=True, slots=True)
class RuntimeStoredThinkingSelection:
    series: str
    mode: str | None = None
    level: str | None = None
    budget_tokens: int | None = None
    value_payload: dict[str, Any] | None = None


@dataclass(frozen=True, slots=True)
class RuntimeStoredRunPolicy:
    model_route: RuntimeStoredModelRoute
    thinking_selection: RuntimeStoredThinkingSelection | None = None
    thinking_level_intent: str | None = None
    thinking_capability_override: dict[str, Any] | None = None
    enabled_tools: tuple[str, ...] = ()
    tool_permission_policy: dict[str, Any] | None = None
    debug_mode_enabled: bool | None = None
    request_options: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class RuntimeStoredRunInput:
    message_role: RuntimeMessageRole
    message_content: str
    policy: RuntimeStoredRunPolicy
    message_structured_payload: dict[str, Any] | None = None
    agent_id: str | None = None

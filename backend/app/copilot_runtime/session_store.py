"""In-memory thread/run storage for the Copilot runtime."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal
from uuid import uuid4

RuntimeMessageRole = Literal["user", "assistant"]
RuntimeRunStatus = Literal[
    "pending",
    "streaming",
    "cancellation_requested",
    "completed",
    "failed",
    "cancelled",
]

_COMPAT_PROVIDER_PROFILE_ID = "compat-projection"
_COMPAT_PROVIDER = "compat"
_COMPAT_ENDPOINT_TYPE = "compat"
_COMPAT_BASE_URL = "compat://projection"
_COMPAT_MODEL_ID = "compat-projection"


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
    """Minimal projected text message visible to legacy session consumers."""

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


RuntimeSessionRecord = RuntimeThreadRecord


@dataclass(frozen=True, slots=True)
class RuntimeStoredModelRouteSnapshot:
    provider: str
    endpoint_type: str
    base_url: str
    model_id: str


@dataclass(frozen=True, slots=True)
class RuntimeStoredModelRoute:
    provider_profile_id: str
    snapshot: RuntimeStoredModelRouteSnapshot


@dataclass(frozen=True, slots=True)
class RuntimeStoredRunPolicy:
    model_route: RuntimeStoredModelRoute
    thinking_level_intent: str | None = None
    thinking_capability_override: dict[str, Any] | None = None
    enabled_tools: tuple[str, ...] = ()
    debug_mode_enabled: bool | None = None
    request_options: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class RuntimeStoredRunInput:
    message_role: RuntimeMessageRole
    message_content: str
    policy: RuntimeStoredRunPolicy
    agent_id: str | None = None


@dataclass(slots=True)
class RuntimeRunRecord:
    run_id: str
    thread_id: str
    request: RuntimeStoredRunInput
    status: RuntimeRunStatus = "pending"
    metadata: dict[str, Any] = field(default_factory=dict)
    cancel_requested: bool = False
    assistant_text: str | None = None
    event_log: list[RuntimeRunEventRecord] = field(default_factory=list)
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    started_at: datetime | None = None
    terminal_at: datetime | None = None

    @property
    def session_id(self) -> str:
        return self.thread_id

    @property
    def is_terminal(self) -> bool:
        return self.status in {"completed", "failed", "cancelled"}

    def touch(self, *, metadata: Mapping[str, Any] | None = None) -> None:
        if metadata:
            self.metadata = {**self.metadata, **dict(metadata)}
        self.updated_at = datetime.now(UTC)

    def append_event(
        self,
        *,
        event_type: str,
        payload: Mapping[str, Any] | None = None,
        sequence: int | None = None,
    ) -> RuntimeRunEventRecord:
        event = RuntimeRunEventRecord(
            event_type=event_type,
            payload=dict(payload or {}),
            sequence=sequence,
        )
        self.event_log.append(event)
        self.updated_at = event.created_at
        return event

    def mark_streaming(self, *, metadata: Mapping[str, Any] | None = None) -> None:
        if self.is_terminal:
            return
        now = datetime.now(UTC)
        self.status = "streaming"
        self.started_at = self.started_at or now
        if metadata:
            self.metadata = {**self.metadata, **dict(metadata)}
        self.updated_at = now

    def request_cancel(self) -> bool:
        if self.is_terminal:
            return False

        now = datetime.now(UTC)
        self.cancel_requested = True
        if self.status == "pending":
            self.status = "cancelled"
            self.terminal_at = now
        else:
            self.status = "cancellation_requested"
        self.updated_at = now
        return True

    def mark_completed(
        self,
        *,
        assistant_text: str | None = None,
        metadata: Mapping[str, Any] | None = None,
    ) -> None:
        self._mark_terminal(
            status="completed",
            assistant_text=assistant_text,
            metadata=metadata,
        )

    def mark_failed(self, *, metadata: Mapping[str, Any] | None = None) -> None:
        self._mark_terminal(status="failed", metadata=metadata)

    def mark_cancelled(self, *, metadata: Mapping[str, Any] | None = None) -> None:
        self.cancel_requested = True
        self._mark_terminal(status="cancelled", metadata=metadata)

    def projected_messages(self) -> tuple[RuntimeTextMessage, ...]:
        if self.status != "completed":
            return ()

        projected_user_text = _normalize_projected_text(self.request.message_content)
        projected_assistant_text = _normalize_projected_text(self.assistant_text)
        if projected_user_text is None or projected_assistant_text is None:
            return ()

        assistant_created_at = self.terminal_at or self.updated_at
        return (
            RuntimeTextMessage(
                role=self.request.message_role,
                content=projected_user_text,
                created_at=self.created_at,
            ),
            RuntimeTextMessage(
                role="assistant",
                content=projected_assistant_text,
                created_at=assistant_created_at,
            ),
        )

    def _mark_terminal(
        self,
        *,
        status: Literal["completed", "failed", "cancelled"],
        assistant_text: str | None = None,
        metadata: Mapping[str, Any] | None = None,
    ) -> None:
        now = datetime.now(UTC)
        self.status = status
        self.started_at = self.started_at or now
        self.terminal_at = now
        if assistant_text is not None:
            self.assistant_text = assistant_text
        if metadata:
            self.metadata = {**self.metadata, **dict(metadata)}
        self.updated_at = now


class InMemorySessionStore:
    """Canonical in-process thread/run store with compat session projections."""

    def __init__(self) -> None:
        self._threads: dict[str, RuntimeThreadRecord] = {}
        self._runs: dict[str, RuntimeRunRecord] = {}

    @property
    def storage_type(self) -> str:
        return "in-memory"

    def get_thread(self, thread_id: str) -> RuntimeThreadRecord | None:
        return self._threads.get(thread_id)

    def create_thread(
        self,
        *,
        bound_agent_id: str,
        metadata: Mapping[str, Any] | None = None,
        thread_id: str | None = None,
    ) -> RuntimeThreadRecord:
        resolved_agent_id = _require_non_empty_string(
            bound_agent_id,
            field_name="bound_agent_id",
        )
        resolved_thread_id = (
            _require_non_empty_string(thread_id, field_name="thread_id")
            if thread_id is not None
            else self._next_thread_id()
        )
        if resolved_thread_id in self._threads:
            raise ValueError(f"Thread '{resolved_thread_id}' already exists.")

        now = datetime.now(UTC)
        thread = RuntimeThreadRecord(
            thread_id=resolved_thread_id,
            bound_agent_id=resolved_agent_id,
            metadata=dict(metadata) if metadata is not None else {},
            created_at=now,
            updated_at=now,
        )
        self._threads[resolved_thread_id] = thread
        return thread

    def get_or_create_thread(
        self,
        *,
        thread_id: str,
        bound_agent_id: str,
        metadata: Mapping[str, Any] | None = None,
    ) -> tuple[RuntimeThreadRecord, bool]:
        resolved_thread_id = _require_non_empty_string(thread_id, field_name="thread_id")
        resolved_agent_id = _require_non_empty_string(
            bound_agent_id,
            field_name="bound_agent_id",
        )
        existing = self._threads.get(resolved_thread_id)
        if existing is not None:
            self._assert_bound_agent(existing, requested_agent_id=resolved_agent_id)
            existing.touch(metadata=metadata)
            return existing, False

        return (
            self.create_thread(
                thread_id=resolved_thread_id,
                bound_agent_id=resolved_agent_id,
                metadata=metadata,
            ),
            True,
        )

    def get_run(self, run_id: str) -> RuntimeRunRecord | None:
        return self._runs.get(run_id)

    def list_runs(self, thread_id: str) -> tuple[RuntimeRunRecord, ...]:
        resolved_thread_id = _require_non_empty_string(thread_id, field_name="thread_id")
        runs = [run for run in self._runs.values() if run.thread_id == resolved_thread_id]
        runs.sort(key=lambda run: (run.created_at, run.run_id))
        return tuple(runs)

    def list_run_events(self, run_id: str) -> tuple[RuntimeRunEventRecord, ...]:
        run = self._require_run(run_id)
        return tuple(run.event_log)

    def create_run(
        self,
        *,
        thread_id: str,
        request: RuntimeStoredRunInput,
        metadata: Mapping[str, Any] | None = None,
        run_id: str | None = None,
    ) -> RuntimeRunRecord:
        resolved_thread_id = _require_non_empty_string(thread_id, field_name="thread_id")
        resolved_run_id = (
            _require_non_empty_string(run_id, field_name="run_id")
            if run_id is not None
            else self._next_run_id()
        )
        if resolved_run_id in self._runs:
            raise ValueError(f"Run '{resolved_run_id}' already exists.")

        now = datetime.now(UTC)
        run = RuntimeRunRecord(
            run_id=resolved_run_id,
            thread_id=resolved_thread_id,
            request=request,
            metadata=dict(metadata) if metadata is not None else {},
            created_at=now,
            updated_at=now,
        )
        self._runs[resolved_run_id] = run

        self._touch_thread_for_run(run)
        return run

    def get_latest_run_for_thread(self, thread_id: str) -> RuntimeRunRecord | None:
        thread = self.get_thread(thread_id)
        if thread is not None and thread.last_run_id is not None:
            latest = self.get_run(thread.last_run_id)
            if latest is not None:
                return latest

        runs = self.list_runs(thread_id)
        if len(runs) == 0:
            return None
        return runs[-1]

    def record_run_event(
        self,
        run_id: str,
        *,
        event_type: str,
        payload: Mapping[str, Any] | None = None,
        sequence: int | None = None,
    ) -> RuntimeRunRecord:
        run = self._require_run(run_id)
        run.append_event(event_type=event_type, payload=payload, sequence=sequence)
        self._touch_thread_for_run(run)
        return run

    def mark_run_streaming(
        self,
        run_id: str,
        *,
        metadata: Mapping[str, Any] | None = None,
    ) -> RuntimeRunRecord:
        run = self._require_run(run_id)
        run.mark_streaming(metadata=metadata)
        self._touch_thread_for_run(run)
        return run

    def mark_run_completed(
        self,
        run_id: str,
        *,
        assistant_text: str | None = None,
        metadata: Mapping[str, Any] | None = None,
    ) -> RuntimeRunRecord:
        run = self._require_run(run_id)
        run.mark_completed(assistant_text=assistant_text, metadata=metadata)
        self._touch_thread_for_run(run)
        return run

    def mark_run_failed(
        self,
        run_id: str,
        *,
        metadata: Mapping[str, Any] | None = None,
    ) -> RuntimeRunRecord:
        run = self._require_run(run_id)
        run.mark_failed(metadata=metadata)
        self._touch_thread_for_run(run)
        return run

    def mark_run_cancelled(
        self,
        run_id: str,
        *,
        metadata: Mapping[str, Any] | None = None,
    ) -> RuntimeRunRecord:
        run = self._require_run(run_id)
        run.mark_cancelled(metadata=metadata)
        self._touch_thread_for_run(run)
        return run

    def request_run_cancel(self, run_id: str) -> tuple[RuntimeRunRecord, bool]:
        run = self._require_run(run_id)
        changed = run.request_cancel()
        self._touch_thread_for_run(run)
        return run, changed

    def get(self, session_id: str) -> RuntimeThreadRecord | None:
        return self.get_thread(session_id)

    def create(
        self,
        *,
        bound_agent_id: str,
        metadata: Mapping[str, Any] | None = None,
        session_id: str | None = None,
    ) -> RuntimeThreadRecord:
        return self.create_thread(
            bound_agent_id=bound_agent_id,
            metadata=metadata,
            thread_id=session_id or self._next_session_id(),
        )

    def get_or_create(
        self,
        *,
        session_id: str,
        bound_agent_id: str,
        metadata: Mapping[str, Any] | None = None,
    ) -> tuple[RuntimeThreadRecord, bool]:
        return self.get_or_create_thread(
            thread_id=session_id,
            bound_agent_id=bound_agent_id,
            metadata=metadata,
        )

    def list_messages(self, session_id: str) -> tuple[RuntimeTextMessage, ...]:
        session = self.get(session_id)
        if session is None:
            return ()

        projected_messages: list[RuntimeTextMessage] = []
        for run in self.list_runs(session.thread_id):
            projected_messages.extend(run.projected_messages())
        return tuple(projected_messages)

    def append_turn(
        self,
        *,
        session_id: str,
        bound_agent_id: str,
        user_text: str,
        assistant_text: str,
        metadata: Mapping[str, Any] | None = None,
    ) -> tuple[RuntimeThreadRecord, bool]:
        metadata_dict = dict(metadata) if metadata is not None else {}
        session, created = self.get_or_create(
            session_id=session_id,
            bound_agent_id=bound_agent_id,
            metadata=metadata_dict,
        )

        resolved_run_id = _normalize_optional_non_empty_string(metadata_dict.get("last_run_id"))
        run = None
        if resolved_run_id is not None:
            run = self._runs.get(resolved_run_id)
            if run is not None and run.thread_id != session.thread_id:
                raise ValueError(
                    f"Run '{resolved_run_id}' belongs to thread '{run.thread_id}', "
                    f"cannot project it into session '{session.thread_id}'."
                )

        if run is None:
            run = self.create_run(
                thread_id=session.thread_id,
                request=_build_compat_run_input(
                    user_text=user_text,
                    bound_agent_id=bound_agent_id,
                ),
                metadata=metadata_dict,
                run_id=resolved_run_id,
            )
        else:
            run.touch(metadata=metadata_dict)

        self.mark_run_completed(
            run.run_id,
            assistant_text=assistant_text,
            metadata=metadata_dict,
        )
        return session, created

    def _require_run(self, run_id: str) -> RuntimeRunRecord:
        resolved_run_id = _require_non_empty_string(run_id, field_name="run_id")
        run = self._runs.get(resolved_run_id)
        if run is None:
            raise LookupError(f"Run '{resolved_run_id}' does not exist.")
        return run

    def _touch_thread_for_run(self, run: RuntimeRunRecord) -> None:
        thread = self._threads.get(run.thread_id)
        if thread is None:
            return
        thread.last_run_id = run.run_id
        thread.touch(metadata={"last_run_id": run.run_id})

    def _assert_bound_agent(
        self,
        session: RuntimeThreadRecord,
        *,
        requested_agent_id: str,
    ) -> None:
        if session.bound_agent_id != requested_agent_id:
            raise BoundAgentMismatchError(
                session_id=session.session_id,
                expected_agent_id=session.bound_agent_id,
                actual_agent_id=requested_agent_id,
            )

    def _next_thread_id(self) -> str:
        while True:
            candidate = f"thread-{uuid4().hex}"
            if candidate not in self._threads:
                return candidate

    def _next_run_id(self) -> str:
        while True:
            candidate = f"run-{uuid4().hex}"
            if candidate not in self._runs:
                return candidate

    def _next_session_id(self) -> str:
        while True:
            candidate = f"session-{uuid4().hex}"
            if candidate not in self._threads:
                return candidate



def _build_compat_run_input(*, user_text: str, bound_agent_id: str) -> RuntimeStoredRunInput:
    return RuntimeStoredRunInput(
        message_role="user",
        message_content=_require_non_empty_string(user_text, field_name="user_text"),
        policy=RuntimeStoredRunPolicy(
            model_route=RuntimeStoredModelRoute(
                provider_profile_id=_COMPAT_PROVIDER_PROFILE_ID,
                snapshot=RuntimeStoredModelRouteSnapshot(
                    provider=_COMPAT_PROVIDER,
                    endpoint_type=_COMPAT_ENDPOINT_TYPE,
                    base_url=_COMPAT_BASE_URL,
                    model_id=_COMPAT_MODEL_ID,
                ),
            )
        ),
        agent_id=_require_non_empty_string(bound_agent_id, field_name="bound_agent_id"),
    )



def _normalize_projected_text(value: str | None) -> str | None:
    if not isinstance(value, str):
        return None
    normalized_value = value.strip()
    if normalized_value == "":
        return None
    return normalized_value



def _normalize_optional_non_empty_string(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized_value = value.strip()
    if normalized_value == "":
        return None
    return normalized_value



def _require_non_empty_string(value: str | None, *, field_name: str) -> str:
    if value is None or value.strip() == "":
        raise ValueError(f"Session store field '{field_name}' must be a non-empty string.")
    return value.strip()


__all__ = [
    "BoundAgentMismatchError",
    "InMemorySessionStore",
    "RuntimeMessageRole",
    "RuntimeRunEventRecord",
    "RuntimeRunRecord",
    "RuntimeRunStatus",
    "RuntimeSessionRecord",
    "RuntimeStoredModelRoute",
    "RuntimeStoredModelRouteSnapshot",
    "RuntimeStoredRunInput",
    "RuntimeStoredRunPolicy",
    "RuntimeTextMessage",
    "RuntimeThreadRecord",
]

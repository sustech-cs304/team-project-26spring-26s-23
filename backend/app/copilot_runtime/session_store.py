"""In-memory session storage for the Copilot runtime."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal
from uuid import uuid4

RuntimeMessageRole = Literal["user", "assistant"]


class BoundAgentMismatchError(RuntimeError):
    """Raised when an existing session is accessed with a different bound agent."""

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
    """Minimal persisted text message stored for a session."""

    role: RuntimeMessageRole
    content: str
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))


@dataclass(slots=True)
class RuntimeSessionRecord:
    """Minimal per-session record kept in process memory."""

    session_id: str
    bound_agent_id: str
    metadata: dict[str, Any] = field(default_factory=dict)
    messages: list[RuntimeTextMessage] = field(default_factory=list)
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    @property
    def thread_id(self) -> str:
        return self.session_id

    @property
    def agent_name(self) -> str:
        return self.bound_agent_id

    def touch(self, *, metadata: dict[str, Any] | None = None) -> None:
        if metadata:
            self.metadata = {**self.metadata, **metadata}
        self.updated_at = datetime.now(UTC)

    def append_message(self, *, role: RuntimeMessageRole, content: str) -> RuntimeTextMessage:
        normalized_content = content.strip()
        if normalized_content == "":
            raise ValueError("Session message content must be a non-empty string.")

        message = RuntimeTextMessage(role=role, content=normalized_content)
        self.messages.append(message)
        self.updated_at = message.created_at
        return message

    def append_turn(self, *, user_text: str, assistant_text: str) -> None:
        self.append_message(role="user", content=user_text)
        self.append_message(role="assistant", content=assistant_text)

    def message_history(self) -> tuple[RuntimeTextMessage, ...]:
        return tuple(self.messages)


class InMemorySessionStore:
    """Minimal in-process session store keyed by `session_id`."""

    def __init__(self) -> None:
        self._sessions: dict[str, RuntimeSessionRecord] = {}

    @property
    def storage_type(self) -> str:
        return "in-memory"

    def get(self, session_id: str) -> RuntimeSessionRecord | None:
        return self._sessions.get(session_id)

    def create(
        self,
        *,
        bound_agent_id: str,
        metadata: dict[str, Any] | None = None,
        session_id: str | None = None,
    ) -> RuntimeSessionRecord:
        resolved_agent_id = _require_non_empty_string(
            bound_agent_id,
            field_name="bound_agent_id",
        )
        resolved_session_id = (
            _require_non_empty_string(session_id, field_name="session_id")
            if session_id is not None
            else self._next_session_id()
        )
        if resolved_session_id in self._sessions:
            raise ValueError(f"Session '{resolved_session_id}' already exists.")

        now = datetime.now(UTC)
        session = RuntimeSessionRecord(
            session_id=resolved_session_id,
            bound_agent_id=resolved_agent_id,
            metadata=dict(metadata or {}),
            created_at=now,
            updated_at=now,
        )
        self._sessions[resolved_session_id] = session
        return session

    def get_or_create(
        self,
        *,
        session_id: str,
        bound_agent_id: str,
        metadata: dict[str, Any] | None = None,
    ) -> tuple[RuntimeSessionRecord, bool]:
        resolved_session_id = _require_non_empty_string(session_id, field_name="session_id")
        resolved_agent_id = _require_non_empty_string(
            bound_agent_id,
            field_name="bound_agent_id",
        )
        existing = self._sessions.get(resolved_session_id)
        if existing is not None:
            self._assert_bound_agent(existing, requested_agent_id=resolved_agent_id)
            existing.touch(metadata=metadata)
            return existing, False

        return (
            self.create(
                session_id=resolved_session_id,
                bound_agent_id=resolved_agent_id,
                metadata=metadata,
            ),
            True,
        )

    def list_messages(self, session_id: str) -> tuple[RuntimeTextMessage, ...]:
        session = self.get(session_id)
        if session is None:
            return ()
        return session.message_history()

    def append_turn(
        self,
        *,
        session_id: str,
        bound_agent_id: str,
        user_text: str,
        assistant_text: str,
        metadata: dict[str, Any] | None = None,
    ) -> tuple[RuntimeSessionRecord, bool]:
        session, created = self.get_or_create(
            session_id=session_id,
            bound_agent_id=bound_agent_id,
            metadata=metadata,
        )
        session.append_turn(user_text=user_text, assistant_text=assistant_text)
        return session, created

    def _assert_bound_agent(
        self,
        session: RuntimeSessionRecord,
        *,
        requested_agent_id: str,
    ) -> None:
        if session.bound_agent_id != requested_agent_id:
            raise BoundAgentMismatchError(
                session_id=session.session_id,
                expected_agent_id=session.bound_agent_id,
                actual_agent_id=requested_agent_id,
            )

    def _next_session_id(self) -> str:
        while True:
            candidate = f"session-{uuid4().hex}"
            if candidate not in self._sessions:
                return candidate



def _require_non_empty_string(value: str | None, *, field_name: str) -> str:
    if value is None or value.strip() == "":
        raise ValueError(f"Session store field '{field_name}' must be a non-empty string.")
    return value.strip()

"""In-memory session storage for the minimal Copilot runtime run bridge."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal

RuntimeMessageRole = Literal["user", "assistant"]


@dataclass(frozen=True, slots=True)
class RuntimeTextMessage:
    """Minimal persisted text message stored for a thread."""

    role: RuntimeMessageRole
    content: str
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))


@dataclass(slots=True)
class RuntimeSessionRecord:
    """Minimal per-thread session record kept in process memory."""

    thread_id: str
    agent_name: str
    metadata: dict[str, Any] = field(default_factory=dict)
    messages: list[RuntimeTextMessage] = field(default_factory=list)
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = field(default_factory=lambda: datetime.now(UTC))

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
    """Minimal in-process session store keyed by `thread_id`."""

    def __init__(self) -> None:
        self._sessions: dict[str, RuntimeSessionRecord] = {}

    @property
    def storage_type(self) -> str:
        return "in-memory"

    def get(self, thread_id: str) -> RuntimeSessionRecord | None:
        return self._sessions.get(thread_id)

    def get_or_create(
        self,
        *,
        thread_id: str,
        agent_name: str,
        metadata: dict[str, Any] | None = None,
    ) -> tuple[RuntimeSessionRecord, bool]:
        existing = self._sessions.get(thread_id)
        if existing is not None:
            existing.agent_name = agent_name
            existing.touch(metadata=metadata)
            return existing, False

        now = datetime.now(UTC)
        session = RuntimeSessionRecord(
            thread_id=thread_id,
            agent_name=agent_name,
            metadata=dict(metadata or {}),
            created_at=now,
            updated_at=now,
        )
        self._sessions[thread_id] = session
        return session, True

    def list_messages(self, thread_id: str) -> tuple[RuntimeTextMessage, ...]:
        session = self.get(thread_id)
        if session is None:
            return ()
        return session.message_history()

    def append_turn(
        self,
        *,
        thread_id: str,
        agent_name: str,
        user_text: str,
        assistant_text: str,
        metadata: dict[str, Any] | None = None,
    ) -> tuple[RuntimeSessionRecord, bool]:
        session, created = self.get_or_create(
            thread_id=thread_id,
            agent_name=agent_name,
            metadata=metadata,
        )
        session.append_turn(user_text=user_text, assistant_text=assistant_text)
        if metadata:
            session.metadata = {**session.metadata, **metadata}
        return session, created

"""In-memory session storage for the minimal Copilot runtime connect scaffold."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any


@dataclass(slots=True)
class RuntimeSessionRecord:
    """Minimal per-thread session record kept in process memory.

    This phase intentionally stores only lightweight metadata. Message history and
    turn persistence are reserved for the later run phase.
    """

    thread_id: str
    agent_name: str
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    def touch(self, *, metadata: dict[str, Any] | None = None) -> None:
        if metadata:
            self.metadata = {**self.metadata, **metadata}
        self.updated_at = datetime.now(UTC)


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

"""SQLite-backed runtime session store."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any
from uuid import uuid4

from .db import (
    create_session_factory,
    create_sqlite_engine,
    initialize_database,
    resolve_chat_database_path,
    upgrade_database,
)
from .repositories import run_lifecycle_transaction

from ..runtime_session_store import RuntimeSessionStore
from ..session_store import (
    BoundAgentMismatchError,
    RuntimeRunEventRecord,
    RuntimeRunRecord,
    RuntimeStoredRunInput,
    RuntimeTextMessage,
    RuntimeThreadRecord,
)

if TYPE_CHECKING:
    from app.desktop_runtime.config import DesktopRuntimeConfig


class SQLiteSessionStore(RuntimeSessionStore):
    """SQLite-backed implementation of the runtime session store contract."""

    def __init__(
        self,
        *,
        runtime_config: DesktopRuntimeConfig | None = None,
        db_path: str | Path | None = None,
        apply_migrations: bool = True,
    ) -> None:
        self.db_path = resolve_chat_database_path(runtime_config=runtime_config, db_path=db_path)
        if apply_migrations:
            upgrade_database(db_path=self.db_path)
        self.engine = create_sqlite_engine(db_path=self.db_path)
        initialize_database(self.engine)
        self._session_factory = create_session_factory(self.engine)

    @property
    def storage_type(self) -> str:
        return "sqlite"

    def get_thread(self, thread_id: str) -> RuntimeThreadRecord | None:
        with run_lifecycle_transaction(self._session_factory) as repositories:
            thread_model = repositories.threads.get(thread_id)
            if thread_model is None:
                return None
            return repositories.threads.to_runtime_record(thread_model)

    def create_thread(
        self,
        *,
        bound_agent_id: str,
        metadata: Mapping[str, Any] | None = None,
        thread_id: str | None = None,
    ) -> RuntimeThreadRecord:
        resolved_agent_id = _require_non_empty_string(bound_agent_id, field_name="bound_agent_id")
        resolved_thread_id = (
            _require_non_empty_string(thread_id, field_name="thread_id")
            if thread_id is not None
            else f"thread-{uuid4().hex}"
        )
        with run_lifecycle_transaction(self._session_factory) as repositories:
            if repositories.threads.get(resolved_thread_id) is not None:
                raise ValueError(f"Thread '{resolved_thread_id}' already exists.")
            now = datetime.now(UTC)
            thread = RuntimeThreadRecord(
                thread_id=resolved_thread_id,
                bound_agent_id=resolved_agent_id,
                metadata=dict(metadata) if metadata is not None else {},
                created_at=now,
                updated_at=now,
            )
            thread_model = repositories.threads.create_from_runtime_record(thread)
            return repositories.threads.to_runtime_record(thread_model)

    def get_or_create_thread(
        self,
        *,
        thread_id: str,
        bound_agent_id: str,
        metadata: Mapping[str, Any] | None = None,
    ) -> tuple[RuntimeThreadRecord, bool]:
        resolved_thread_id = _require_non_empty_string(thread_id, field_name="thread_id")
        resolved_agent_id = _require_non_empty_string(bound_agent_id, field_name="bound_agent_id")
        with run_lifecycle_transaction(self._session_factory) as repositories:
            existing = repositories.threads.get(resolved_thread_id)
            if existing is not None:
                runtime_thread = repositories.threads.to_runtime_record(existing)
                self._assert_bound_agent(runtime_thread, requested_agent_id=resolved_agent_id)
                runtime_thread.touch(metadata=metadata)
                repositories.threads.apply_runtime_record(existing, runtime_thread)
                return repositories.threads.to_runtime_record(existing), False

            now = datetime.now(UTC)
            created_thread = RuntimeThreadRecord(
                thread_id=resolved_thread_id,
                bound_agent_id=resolved_agent_id,
                metadata=dict(metadata) if metadata is not None else {},
                created_at=now,
                updated_at=now,
            )
            thread_model = repositories.threads.create_from_runtime_record(created_thread)
            return repositories.threads.to_runtime_record(thread_model), True

    def get_run(self, run_id: str) -> RuntimeRunRecord | None:
        with run_lifecycle_transaction(self._session_factory) as repositories:
            run_model = repositories.runs.get(run_id)
            if run_model is None:
                return None
            runtime_run = repositories.runs.to_runtime_record(run_model)
            runtime_run.event_log = [
                repositories.events.to_runtime_record(event_model)
                for event_model in repositories.events.list_for_run(run_id)
            ]
            return runtime_run

    def list_runs(self, thread_id: str) -> tuple[RuntimeRunRecord, ...]:
        with run_lifecycle_transaction(self._session_factory) as repositories:
            return tuple(
                repositories.runs.to_runtime_record(run_model)
                for run_model in repositories.runs.list_for_thread(thread_id)
            )

    def list_run_events(self, run_id: str) -> tuple[RuntimeRunEventRecord, ...]:
        with run_lifecycle_transaction(self._session_factory) as repositories:
            repositories.runs.require(run_id)
            return tuple(
                repositories.events.to_runtime_record(event_model)
                for event_model in repositories.events.list_for_run(run_id)
            )

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
            else f"run-{uuid4().hex}"
        )
        with run_lifecycle_transaction(self._session_factory) as repositories:
            repositories.threads.require(resolved_thread_id)
            if repositories.runs.get(resolved_run_id) is not None:
                raise ValueError(f"Run '{resolved_run_id}' already exists.")
            now = datetime.now(UTC)
            runtime_run = RuntimeRunRecord(
                run_id=resolved_run_id,
                thread_id=resolved_thread_id,
                request=request,
                metadata=dict(metadata) if metadata is not None else {},
                created_at=now,
                updated_at=now,
            )
            run_model = repositories.runs.create_from_runtime_record(runtime_run)
            thread_model = repositories.threads.require(resolved_thread_id)
            repositories.threads.touch_for_run(thread_model, runtime_run)
            return repositories.runs.to_runtime_record(run_model)

    def get_latest_run_for_thread(self, thread_id: str) -> RuntimeRunRecord | None:
        with run_lifecycle_transaction(self._session_factory) as repositories:
            thread_model = repositories.threads.get(thread_id)
            if thread_model is not None and thread_model.last_run_id is not None:
                latest_model = repositories.runs.get(thread_model.last_run_id)
                if latest_model is not None:
                    return repositories.runs.to_runtime_record(latest_model)
            latest_model = repositories.runs.latest_for_thread(thread_id)
            if latest_model is None:
                return None
            return repositories.runs.to_runtime_record(latest_model)

    def record_run_event(
        self,
        run_id: str,
        *,
        event_type: str,
        payload: Mapping[str, Any] | None = None,
        sequence: int | None = None,
    ) -> RuntimeRunRecord:
        _ = sequence
        with run_lifecycle_transaction(self._session_factory) as repositories:
            run_model = repositories.runs.require(run_id)
            event_model = repositories.events.append_event(
                run_id=run_id,
                event_type=event_type,
                payload=payload,
            )
            runtime_run = repositories.runs.to_runtime_record(run_model)
            runtime_run.updated_at = event_model.created_at
            repositories.runs.apply_runtime_record(run_model, runtime_run)
            thread_model = repositories.threads.require(runtime_run.thread_id)
            repositories.threads.touch_for_run(thread_model, runtime_run)
            return runtime_run

    def mark_run_streaming(
        self,
        run_id: str,
        *,
        metadata: Mapping[str, Any] | None = None,
    ) -> RuntimeRunRecord:
        return self._mutate_run(run_id, lambda run: run.mark_streaming(metadata=metadata))

    def mark_run_completed(
        self,
        run_id: str,
        *,
        assistant_text: str | None = None,
        metadata: Mapping[str, Any] | None = None,
    ) -> RuntimeRunRecord:
        return self._mutate_run(
            run_id,
            lambda run: run.mark_completed(assistant_text=assistant_text, metadata=metadata),
        )

    def mark_run_failed(
        self,
        run_id: str,
        *,
        metadata: Mapping[str, Any] | None = None,
    ) -> RuntimeRunRecord:
        return self._mutate_run(run_id, lambda run: run.mark_failed(metadata=metadata))

    def mark_run_cancelled(
        self,
        run_id: str,
        *,
        metadata: Mapping[str, Any] | None = None,
    ) -> RuntimeRunRecord:
        return self._mutate_run(run_id, lambda run: run.mark_cancelled(metadata=metadata))

    def touch_run(
        self,
        run_id: str,
        *,
        metadata: Mapping[str, Any] | None = None,
    ) -> RuntimeRunRecord:
        return self._mutate_run(run_id, lambda run: run.touch(metadata=metadata))

    def request_run_cancel(self, run_id: str) -> tuple[RuntimeRunRecord, bool]:
        with run_lifecycle_transaction(self._session_factory) as repositories:
            run_model = repositories.runs.require(run_id)
            runtime_run = repositories.runs.to_runtime_record(run_model)
            changed = runtime_run.request_cancel()
            repositories.runs.apply_runtime_record(run_model, runtime_run)
            thread_model = repositories.threads.require(runtime_run.thread_id)
            repositories.threads.touch_for_run(thread_model, runtime_run)
            return runtime_run, changed

    def list_messages(self, thread_id: str) -> tuple[RuntimeTextMessage, ...]:
        thread = self.get_thread(thread_id)
        if thread is None:
            return ()
        projected_messages: list[RuntimeTextMessage] = []
        for run in self.list_runs(thread.thread_id):
            projected_messages.extend(run.projected_messages())
        return tuple(projected_messages)

    def dispose(self) -> None:
        self.engine.dispose()

    def _mutate_run(self, run_id: str, mutation) -> RuntimeRunRecord:
        with run_lifecycle_transaction(self._session_factory) as repositories:
            run_model = repositories.runs.require(run_id)
            runtime_run = repositories.runs.to_runtime_record(run_model)
            mutation(runtime_run)
            repositories.runs.apply_runtime_record(run_model, runtime_run)
            thread_model = repositories.threads.require(runtime_run.thread_id)
            repositories.threads.touch_for_run(thread_model, runtime_run)
            return runtime_run

    def _assert_bound_agent(
        self,
        thread: RuntimeThreadRecord,
        *,
        requested_agent_id: str,
    ) -> None:
        if thread.bound_agent_id != requested_agent_id:
            raise BoundAgentMismatchError(
                session_id=thread.session_id,
                expected_agent_id=thread.bound_agent_id,
                actual_agent_id=requested_agent_id,
            )



def _require_non_empty_string(value: str | None, *, field_name: str) -> str:
    if value is None or value.strip() == "":
        raise ValueError(f"Session store field '{field_name}' must be a non-empty string.")
    return value.strip()


__all__ = ["SQLiteSessionStore"]

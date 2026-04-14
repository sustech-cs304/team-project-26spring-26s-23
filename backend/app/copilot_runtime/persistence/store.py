"""SQLite-backed runtime session store."""

from __future__ import annotations

import logging
import sqlite3
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any
from uuid import uuid4

from .db import (
    DEFAULT_SQLITE_BUSY_TIMEOUT_SECONDS,
    create_session_factory,
    create_sqlite_engine,
    initialize_database,
    resolve_chat_database_path,
    upgrade_database,
)
from .projections import ProjectionService
from .query_dtos import (
    PersistedDatabaseBackupResponse,
    PersistedDatabaseRestoreResponse,
    PersistedThreadDeleteResponse,
    PersistedThreadPurgeResponse,
)
from .queries import PersistedChatQueryService
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


_PERSISTENCE_LOGGER = logging.getLogger("uvicorn.error")


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
            ProjectionService.refresh_thread_in_transaction(repositories, resolved_thread_id)
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
                ProjectionService.refresh_thread_in_transaction(repositories, resolved_thread_id)
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
            ProjectionService.refresh_thread_in_transaction(repositories, resolved_thread_id)
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
            ProjectionService.refresh_run_in_transaction(repositories, resolved_run_id)
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
            ProjectionService.refresh_run_in_transaction(repositories, run_id)
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
            ProjectionService.refresh_run_in_transaction(repositories, run_id)
            return runtime_run, changed

    def list_messages(self, thread_id: str) -> tuple[RuntimeTextMessage, ...]:
        thread = self.get_thread(thread_id)
        if thread is None:
            return ()
        projected_messages: list[RuntimeTextMessage] = []
        for run in self.list_runs(thread.thread_id):
            projected_messages.extend(run.projected_messages())
        return tuple(projected_messages)

    def delete_thread(self, thread_id: str) -> PersistedThreadDeleteResponse:
        resolved_thread_id = _require_non_empty_string(thread_id, field_name="thread_id")
        with run_lifecycle_transaction(self._session_factory) as repositories:
            thread_model = repositories.threads.require(resolved_thread_id)
            deleted_at = thread_model.deleted_at or datetime.now(UTC)
            if thread_model.deleted_at is None:
                repositories.threads.soft_delete(resolved_thread_id, deleted_at=deleted_at)
            return PersistedThreadDeleteResponse(
                ok=True,
                threadId=resolved_thread_id,
                deletedAt=deleted_at,
            )

    def purge_thread(self, thread_id: str) -> PersistedThreadPurgeResponse:
        resolved_thread_id = _require_non_empty_string(thread_id, field_name="thread_id")
        purged_at = datetime.now(UTC)
        with run_lifecycle_transaction(self._session_factory) as repositories:
            thread_model = repositories.threads.require(resolved_thread_id)
            deleted_at = thread_model.deleted_at
            repositories.threads.hard_delete(resolved_thread_id)
            return PersistedThreadPurgeResponse(
                ok=True,
                threadId=resolved_thread_id,
                purgedAt=purged_at,
                deletedAt=deleted_at,
            )

    def backup_database(
        self,
        *,
        target_path: str | Path | None = None,
    ) -> PersistedDatabaseBackupResponse:
        requested_target_path = None if target_path is None else str(target_path)
        resolved_backup_path: Path | None = None
        try:
            created_at = datetime.now(UTC)
            resolved_backup_path = _resolve_database_operation_path(
                self.db_path,
                target_path,
                default_file_name=_build_default_backup_file_name(self.db_path, created_at),
            )
            _ensure_distinct_database_path(self.db_path, resolved_backup_path, operation_name="backup")
            resolved_backup_path.parent.mkdir(parents=True, exist_ok=True)
            with _open_sqlite_connection(self.db_path) as source_connection:
                with _open_sqlite_connection(resolved_backup_path) as destination_connection:
                    source_connection.backup(destination_connection)
            return PersistedDatabaseBackupResponse(
                ok=True,
                databasePath=str(self.db_path),
                backupPath=str(resolved_backup_path),
                createdAt=created_at,
            )
        except Exception as exc:
            _PERSISTENCE_LOGGER.error(
                "chat persistence backup failed db_path=%s requested_target_path=%s resolved_target_path=%s exception_type=%s exception_message=%s",
                self.db_path,
                requested_target_path,
                resolved_backup_path,
                type(exc).__name__,
                str(exc),
            )
            raise

    def restore_database(
        self,
        *,
        source_path: str | Path,
    ) -> PersistedDatabaseRestoreResponse:
        requested_source_path = str(source_path)
        resolved_source_path: Path | None = None
        try:
            resolved_source_path = _resolve_database_operation_path(self.db_path, source_path)
            if not resolved_source_path.is_file():
                raise ValueError(f"Restore source '{resolved_source_path}' does not exist.")
            _ensure_distinct_database_path(self.db_path, resolved_source_path, operation_name="restore")
            restored_at = datetime.now(UTC)
            self.engine.dispose()
            _remove_sqlite_sidecar_files(self.db_path)
            with _open_sqlite_connection(resolved_source_path) as source_connection:
                with _open_sqlite_connection(self.db_path) as destination_connection:
                    source_connection.backup(destination_connection)
            initialize_database(self.engine)
            return PersistedDatabaseRestoreResponse(
                ok=True,
                databasePath=str(self.db_path),
                sourcePath=str(resolved_source_path),
                restoredAt=restored_at,
            )
        except Exception as exc:
            _PERSISTENCE_LOGGER.error(
                "chat persistence restore failed db_path=%s requested_source_path=%s resolved_source_path=%s exception_type=%s exception_message=%s",
                self.db_path,
                requested_source_path,
                resolved_source_path,
                type(exc).__name__,
                str(exc),
            )
            raise

    def create_projection_service(self) -> ProjectionService:
        return ProjectionService(self._session_factory)

    def create_history_query_service(
        self,
        *,
        agent_registry=None,
        tool_registry=None,
        model_route_resolver=None,
        provider_adapter_registry=None,
    ) -> PersistedChatQueryService:
        return PersistedChatQueryService(
            self._session_factory,
            session_store=self,
            agent_registry=agent_registry,
            tool_registry=tool_registry,
            model_route_resolver=model_route_resolver,
            provider_adapter_registry=provider_adapter_registry,
        )

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
            ProjectionService.refresh_run_in_transaction(repositories, run_id)
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



def _build_default_backup_file_name(db_path: Path, created_at: datetime) -> str:
    suffix = db_path.suffix or ".db"
    timestamp = created_at.strftime("%Y%m%dT%H%M%SZ")
    return f"{db_path.stem}.backup.{timestamp}{suffix}"



def _resolve_database_operation_path(
    db_path: Path,
    path_value: str | Path | None,
    *,
    default_file_name: str | None = None,
) -> Path:
    if path_value is None:
        if default_file_name is None:
            raise ValueError("A database operation path is required.")
        candidate = db_path.parent / default_file_name
    else:
        candidate = Path(path_value)
        if not candidate.is_absolute():
            candidate = db_path.parent / candidate
    return candidate.resolve()



def _ensure_distinct_database_path(db_path: Path, candidate_path: Path, *, operation_name: str) -> None:
    if candidate_path == db_path:
        raise ValueError(f"Cannot {operation_name} the live database file in place.")



def _remove_sqlite_sidecar_files(db_path: Path) -> None:
    for suffix in ("-wal", "-shm"):
        sidecar_path = db_path.with_name(f"{db_path.name}{suffix}")
        if sidecar_path.exists():
            sidecar_path.unlink()



@contextmanager
def _open_sqlite_connection(path: Path) -> Iterator[sqlite3.Connection]:
    connection = sqlite3.connect(path, timeout=DEFAULT_SQLITE_BUSY_TIMEOUT_SECONDS)
    try:
        connection.execute(f"PRAGMA busy_timeout={int(DEFAULT_SQLITE_BUSY_TIMEOUT_SECONDS * 1000)};")
        yield connection
    finally:
        connection.close()


__all__ = ["SQLiteSessionStore"]

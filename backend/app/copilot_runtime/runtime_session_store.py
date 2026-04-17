"""Protocol for runtime session store backends."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Protocol

from .session_store import (
    RuntimeRunEventRecord,
    RuntimeRunRecord,
    RuntimeStoredRunInput,
    RuntimeTextMessage,
    RuntimeThreadRecord,
)


class RuntimeSessionStore(Protocol):
    @property
    def storage_type(self) -> str: ...

    def get_thread(self, thread_id: str) -> RuntimeThreadRecord | None: ...

    def create_thread(
        self,
        *,
        bound_agent_id: str,
        metadata: Mapping[str, Any] | None = None,
        thread_id: str | None = None,
    ) -> RuntimeThreadRecord: ...

    def get_or_create_thread(
        self,
        *,
        thread_id: str,
        bound_agent_id: str,
        metadata: Mapping[str, Any] | None = None,
    ) -> tuple[RuntimeThreadRecord, bool]: ...

    def get_run(self, run_id: str) -> RuntimeRunRecord | None: ...

    def list_runs(self, thread_id: str) -> tuple[RuntimeRunRecord, ...]: ...

    def list_run_events(self, run_id: str) -> tuple[RuntimeRunEventRecord, ...]: ...

    def create_run(
        self,
        *,
        thread_id: str,
        request: RuntimeStoredRunInput,
        metadata: Mapping[str, Any] | None = None,
        run_id: str | None = None,
    ) -> RuntimeRunRecord: ...

    def get_latest_run_for_thread(self, thread_id: str) -> RuntimeRunRecord | None: ...

    def record_run_event(
        self,
        run_id: str,
        *,
        event_type: str,
        payload: Mapping[str, Any] | None = None,
        sequence: int | None = None,
    ) -> RuntimeRunRecord: ...

    def mark_run_streaming(
        self,
        run_id: str,
        *,
        metadata: Mapping[str, Any] | None = None,
    ) -> RuntimeRunRecord: ...

    def mark_run_completed(
        self,
        run_id: str,
        *,
        assistant_text: str | None = None,
        metadata: Mapping[str, Any] | None = None,
    ) -> RuntimeRunRecord: ...

    def mark_run_failed(
        self,
        run_id: str,
        *,
        metadata: Mapping[str, Any] | None = None,
    ) -> RuntimeRunRecord: ...

    def mark_run_cancelled(
        self,
        run_id: str,
        *,
        metadata: Mapping[str, Any] | None = None,
    ) -> RuntimeRunRecord: ...

    def touch_run(
        self,
        run_id: str,
        *,
        metadata: Mapping[str, Any] | None = None,
    ) -> RuntimeRunRecord: ...

    def request_run_cancel(self, run_id: str) -> tuple[RuntimeRunRecord, bool]: ...

    def list_messages(self, thread_id: str) -> tuple[RuntimeTextMessage, ...]: ...


__all__ = ["RuntimeSessionStore"]

"""Runtime tool approval coordination for request-scoped tool execution gates."""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from .debug_logging import log_runtime_chain_debug
from .tool_permissions import ResolvedToolPermissionMode, ResolvedToolTimeoutAction

RuntimeToolApprovalDecision = Literal["approved", "rejected"]
RuntimeToolApprovalStatus = Literal["pending", "approved", "rejected", "timed_out"]


class ToolApprovalError(RuntimeError):
    """Base error raised by runtime tool approval coordination."""


class ToolApprovalNotFoundError(ToolApprovalError):
    """Raised when a pending approval cannot be located."""

    def __init__(self, *, run_id: str, tool_call_id: str) -> None:
        self.run_id = run_id
        self.tool_call_id = tool_call_id
        super().__init__(f"No pending approval exists for run '{run_id}' and tool call '{tool_call_id}'.")


class ToolApprovalConflictError(ToolApprovalError):
    """Raised when an approval decision targets a non-pending request."""

    def __init__(self, *, run_id: str, tool_call_id: str, status: RuntimeToolApprovalStatus) -> None:
        self.run_id = run_id
        self.tool_call_id = tool_call_id
        self.status = status
        super().__init__(
            f"Approval for run '{run_id}' and tool call '{tool_call_id}' is already {status}."
        )


@dataclass(frozen=True, slots=True)
class RuntimeToolApprovalRequest:
    run_id: str
    tool_call_id: str
    tool_id: str
    mode: ResolvedToolPermissionMode
    requested_at: datetime
    timeout_seconds: int | None = None
    timeout_action: ResolvedToolTimeoutAction | None = None
    timeout_at: datetime | None = None
    input_summary: str | None = None

    def to_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "runId": self.run_id,
            "toolCallId": self.tool_call_id,
            "toolId": self.tool_id,
            "mode": self.mode,
            "requestedAt": self.requested_at.isoformat(),
        }
        if self.input_summary is not None:
            payload["inputSummary"] = self.input_summary
        if self.timeout_seconds is not None:
            payload["timeoutSeconds"] = self.timeout_seconds
        if self.timeout_action is not None:
            payload["timeoutAction"] = self.timeout_action
        if self.timeout_at is not None:
            payload["timeoutAt"] = self.timeout_at.isoformat()
        return payload


@dataclass(frozen=True, slots=True)
class RuntimeToolApprovalResolution:
    run_id: str
    tool_call_id: str
    tool_id: str
    decision: RuntimeToolApprovalDecision
    status: RuntimeToolApprovalStatus
    source: Literal["manual", "timeout"]
    resolved_at: datetime
    mode: ResolvedToolPermissionMode
    timeout_action: ResolvedToolTimeoutAction | None = None

    def to_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "runId": self.run_id,
            "toolCallId": self.tool_call_id,
            "toolId": self.tool_id,
            "decision": self.decision,
            "status": self.status,
            "source": self.source,
            "resolvedAt": self.resolved_at.isoformat(),
            "mode": self.mode,
        }
        if self.timeout_action is not None:
            payload["timeoutAction"] = self.timeout_action
        return payload


@dataclass(slots=True)
class _PendingApproval:
    request: RuntimeToolApprovalRequest
    future: asyncio.Future[RuntimeToolApprovalResolution]
    status: RuntimeToolApprovalStatus = "pending"
    resolved_at: datetime | None = None
    resolution: RuntimeToolApprovalResolution | None = None
    timeout_handle: asyncio.TimerHandle | None = None
    debug_enabled: bool = False


@dataclass(slots=True)
class RuntimeToolApprovalCoordinator:
    """Manage in-flight tool approvals within the current process runtime."""

    _time_provider: Callable[[], datetime] = field(
        default=lambda: datetime.now(UTC),
        repr=False,
    )
    _loop_provider: Callable[[], asyncio.AbstractEventLoop] = field(
        default=asyncio.get_running_loop,
        repr=False,
    )
    _pending_by_key: dict[tuple[str, str], _PendingApproval] = field(default_factory=dict, init=False)

    def create_request(
        self,
        *,
        run_id: str,
        tool_call_id: str,
        tool_id: str,
        mode: ResolvedToolPermissionMode,
        input_summary: str | None = None,
        timeout_seconds: int | None = None,
        timeout_action: ResolvedToolTimeoutAction | None = None,
        debug_enabled: bool = False,
    ) -> tuple[RuntimeToolApprovalRequest, asyncio.Future[RuntimeToolApprovalResolution]]:
        requested_at = self._time_provider()
        resolved_timeout_seconds = timeout_seconds if timeout_seconds is not None else None
        resolved_timeout_action = timeout_action if timeout_action is not None else None
        timeout_at = None
        if resolved_timeout_seconds is not None:
            timeout_at = requested_at + timedelta(seconds=resolved_timeout_seconds)
        request = RuntimeToolApprovalRequest(
            run_id=run_id,
            tool_call_id=tool_call_id,
            tool_id=tool_id,
            mode=mode,
            requested_at=requested_at,
            timeout_seconds=resolved_timeout_seconds,
            timeout_action=resolved_timeout_action,
            timeout_at=timeout_at,
            input_summary=input_summary,
        )
        future: asyncio.Future[RuntimeToolApprovalResolution] = self._loop_provider().create_future()
        pending = _PendingApproval(request=request, future=future, debug_enabled=debug_enabled)
        if resolved_timeout_seconds is not None and resolved_timeout_action is not None:
            pending.timeout_handle = self._loop_provider().call_later(
                resolved_timeout_seconds,
                self._resolve_from_timeout,
                run_id,
                tool_call_id,
            )
        self._pending_by_key[(run_id, tool_call_id)] = pending
        log_runtime_chain_debug(
            "tool.approval_request.created",
            enabled=debug_enabled,
            runId=run_id,
            toolCallId=tool_call_id,
            toolId=tool_id,
            mode=mode,
            timeoutSeconds=resolved_timeout_seconds,
            timeoutAction=resolved_timeout_action,
            timeoutAt=None if timeout_at is None else timeout_at.isoformat(),
            timeoutScheduled=pending.timeout_handle is not None,
            pendingCount=len(self._pending_by_key),
        )
        return request, future

    async def wait_for_resolution(
        self,
        *,
        run_id: str,
        tool_call_id: str,
    ) -> RuntimeToolApprovalResolution:
        pending = self._require_pending(run_id=run_id, tool_call_id=tool_call_id)
        log_runtime_chain_debug(
            "tool.approval_request.waiting",
            enabled=pending.debug_enabled,
            runId=run_id,
            toolCallId=tool_call_id,
            toolId=pending.request.tool_id,
            mode=pending.request.mode,
            timeoutAt=(
                None if pending.request.timeout_at is None else pending.request.timeout_at.isoformat()
            ),
        )
        resolution = await pending.future
        log_runtime_chain_debug(
            "tool.approval_request.wait_resumed",
            enabled=pending.debug_enabled,
            runId=run_id,
            toolCallId=tool_call_id,
            resolution=resolution.to_payload(),
        )
        return resolution

    def resolve(
        self,
        *,
        run_id: str,
        tool_call_id: str,
        decision: RuntimeToolApprovalDecision,
    ) -> RuntimeToolApprovalResolution:
        pending = self._require_pending(run_id=run_id, tool_call_id=tool_call_id)
        log_runtime_chain_debug(
            "tool.approval_request.manual_resolution_requested",
            enabled=pending.debug_enabled,
            runId=run_id,
            toolCallId=tool_call_id,
            toolId=pending.request.tool_id,
            decision=decision,
        )
        return self._finalize_pending(
            pending,
            decision=decision,
            source="manual",
        )

    def get_request(
        self,
        *,
        run_id: str,
        tool_call_id: str,
    ) -> RuntimeToolApprovalRequest | None:
        pending = self._pending_by_key.get((run_id, tool_call_id))
        return None if pending is None else pending.request

    def snapshot(self) -> tuple[RuntimeToolApprovalRequest, ...]:
        return tuple(pending.request for pending in self._pending_by_key.values())

    def _resolve_from_timeout(self, run_id: str, tool_call_id: str) -> None:
        pending = self._pending_by_key.get((run_id, tool_call_id))
        if pending is None:
            log_runtime_chain_debug(
                "tool.approval_request.timeout_skipped",
                runId=run_id,
                toolCallId=tool_call_id,
                reason="missing_pending_request",
            )
            return
        if pending.status != "pending":
            log_runtime_chain_debug(
                "tool.approval_request.timeout_skipped",
                enabled=pending.debug_enabled,
                runId=run_id,
                toolCallId=tool_call_id,
                toolId=pending.request.tool_id,
                reason="request_not_pending",
                status=pending.status,
            )
            return
        timeout_action = pending.request.timeout_action
        if timeout_action is None:
            log_runtime_chain_debug(
                "tool.approval_request.timeout_skipped",
                enabled=pending.debug_enabled,
                runId=run_id,
                toolCallId=tool_call_id,
                toolId=pending.request.tool_id,
                reason="timeout_action_missing",
            )
            return
        decision: RuntimeToolApprovalDecision = (
            "approved" if timeout_action == "approve" else "rejected"
        )
        log_runtime_chain_debug(
            "tool.approval_request.timeout_fired",
            enabled=pending.debug_enabled,
            runId=run_id,
            toolCallId=tool_call_id,
            toolId=pending.request.tool_id,
            timeoutAction=timeout_action,
            decision=decision,
        )
        self._finalize_pending(
            pending,
            decision=decision,
            source="timeout",
        )

    def _finalize_pending(
        self,
        pending: _PendingApproval,
        *,
        decision: RuntimeToolApprovalDecision,
        source: Literal["manual", "timeout"],
    ) -> RuntimeToolApprovalResolution:
        if pending.status != "pending":
            raise ToolApprovalConflictError(
                run_id=pending.request.run_id,
                tool_call_id=pending.request.tool_call_id,
                status=pending.status,
            )
        resolved_at = self._time_provider()
        status: RuntimeToolApprovalStatus
        if source == "timeout":
            status = "timed_out"
        else:
            status = "approved" if decision == "approved" else "rejected"
        resolution = RuntimeToolApprovalResolution(
            run_id=pending.request.run_id,
            tool_call_id=pending.request.tool_call_id,
            tool_id=pending.request.tool_id,
            decision=decision,
            status=status,
            source=source,
            resolved_at=resolved_at,
            mode=pending.request.mode,
            timeout_action=pending.request.timeout_action,
        )
        pending.status = status
        pending.resolved_at = resolved_at
        pending.resolution = resolution
        if pending.timeout_handle is not None:
            pending.timeout_handle.cancel()
            pending.timeout_handle = None
        if not pending.future.done():
            pending.future.set_result(resolution)
        self._pending_by_key.pop((pending.request.run_id, pending.request.tool_call_id), None)
        log_runtime_chain_debug(
            "tool.approval_request.finalized",
            enabled=pending.debug_enabled,
            runId=pending.request.run_id,
            toolCallId=pending.request.tool_call_id,
            toolId=pending.request.tool_id,
            resolution=resolution.to_payload(),
            pendingCount=len(self._pending_by_key),
        )
        return resolution

    def _require_pending(self, *, run_id: str, tool_call_id: str) -> _PendingApproval:
        pending = self._pending_by_key.get((run_id, tool_call_id))
        if pending is None:
            raise ToolApprovalNotFoundError(run_id=run_id, tool_call_id=tool_call_id)
        if pending.status != "pending":
            raise ToolApprovalConflictError(
                run_id=run_id,
                tool_call_id=tool_call_id,
                status=pending.status,
            )
        return pending


__all__ = [
    "RuntimeToolApprovalCoordinator",
    "RuntimeToolApprovalDecision",
    "RuntimeToolApprovalRequest",
    "RuntimeToolApprovalResolution",
    "RuntimeToolApprovalStatus",
    "ToolApprovalConflictError",
    "ToolApprovalError",
    "ToolApprovalNotFoundError",
]

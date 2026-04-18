from __future__ import annotations

import asyncio
from datetime import UTC, datetime

import pytest

from app.copilot_runtime import (
    RuntimeToolApprovalCoordinator,
    RuntimeToolApprovalResolveRequest,
    RuntimeToolApprovalResolveResponse,
    RuntimeToolPermissionPolicy,
    ToolApprovalNotFoundError,
    parse_tool_timeout_seconds,
)
from app.copilot_runtime.tool_permissions import RuntimeToolPermissionResolver


class _FakeTimerHandle:
    def __init__(self, callback, args: tuple[object, ...]) -> None:
        self.callback = callback
        self.args = args
        self.cancelled = False

    def cancel(self) -> None:
        self.cancelled = True


class _FakeLoop:
    def __init__(self) -> None:
        self.handles: list[_FakeTimerHandle] = []
        self.loop = asyncio.new_event_loop()

    def create_future(self) -> asyncio.Future:
        return self.loop.create_future()

    def call_later(self, delay: float, callback, *args) -> _FakeTimerHandle:
        _ = delay
        handle = _FakeTimerHandle(callback, args)
        self.handles.append(handle)
        return handle


class _Clock:
    def __init__(self) -> None:
        self.current = datetime(2026, 4, 17, 15, 0, tzinfo=UTC)

    def now(self) -> datetime:
        return self.current

    def advance(self, *, seconds: int) -> None:
        self.current = self.current.replace(second=self.current.second + seconds)


@pytest.fixture
def fake_loop() -> _FakeLoop:
    loop = _FakeLoop()
    try:
        yield loop
    finally:
        loop.loop.close()


def test_create_pending_request_exposes_snapshot_and_payload(fake_loop: _FakeLoop) -> None:
    clock = _Clock()
    loop = fake_loop
    coordinator = RuntimeToolApprovalCoordinator(
        _time_provider=clock.now,
        _loop_provider=lambda: loop,
    )

    request, future = coordinator.create_request(
        run_id="run-1",
        tool_call_id="call-1",
        tool_id="tool.weather-current",
        mode="ask",
        input_summary="location=Shenzhen",
    )

    assert future.done() is False
    assert coordinator.get_request(run_id="run-1", tool_call_id="call-1") == request
    assert coordinator.snapshot() == (request,)
    assert request.to_payload() == {
        "runId": "run-1",
        "toolCallId": "call-1",
        "toolId": "tool.weather-current",
        "mode": "ask",
        "requestedAt": "2026-04-17T15:00:00+00:00",
        "inputSummary": "location=Shenzhen",
    }


def test_manual_approve_resolves_request_and_future(fake_loop: _FakeLoop) -> None:
    clock = _Clock()
    loop = fake_loop
    coordinator = RuntimeToolApprovalCoordinator(
        _time_provider=clock.now,
        _loop_provider=lambda: loop,
    )
    _, future = coordinator.create_request(
        run_id="run-1",
        tool_call_id="call-1",
        tool_id="tool.weather-current",
        mode="ask",
    )

    clock.advance(seconds=1)
    resolution = coordinator.resolve(
        run_id="run-1",
        tool_call_id="call-1",
        decision="approved",
    )

    assert resolution.status == "approved"
    assert resolution.decision == "approved"
    assert resolution.source == "manual"
    assert resolution.to_payload() == {
        "runId": "run-1",
        "toolCallId": "call-1",
        "toolId": "tool.weather-current",
        "decision": "approved",
        "status": "approved",
        "source": "manual",
        "resolvedAt": "2026-04-17T15:00:01+00:00",
        "mode": "ask",
    }
    assert future.done() is True
    assert future.result() == resolution
    assert coordinator.snapshot() == ()


def test_manual_reject_resolves_request(fake_loop: _FakeLoop) -> None:
    clock = _Clock()
    loop = fake_loop
    coordinator = RuntimeToolApprovalCoordinator(
        _time_provider=clock.now,
        _loop_provider=lambda: loop,
    )
    coordinator.create_request(
        run_id="run-2",
        tool_call_id="call-2",
        tool_id="tool.file-convert",
        mode="ask",
    )

    resolution = coordinator.resolve(
        run_id="run-2",
        tool_call_id="call-2",
        decision="rejected",
    )

    assert resolution.status == "rejected"
    assert resolution.decision == "rejected"
    assert coordinator.get_request(run_id="run-2", tool_call_id="call-2") is None


def test_resolve_missing_request_raises_not_found() -> None:
    coordinator = RuntimeToolApprovalCoordinator(
        _time_provider=_Clock().now,
        _loop_provider=lambda: _FakeLoop(),
    )

    with pytest.raises(ToolApprovalNotFoundError, match="No pending approval exists"):
        coordinator.resolve(
            run_id="run-missing",
            tool_call_id="call-missing",
            decision="approved",
        )


def test_duplicate_resolution_raises_not_found_after_completion(fake_loop: _FakeLoop) -> None:
    clock = _Clock()
    loop = fake_loop
    coordinator = RuntimeToolApprovalCoordinator(
        _time_provider=clock.now,
        _loop_provider=lambda: loop,
    )
    coordinator.create_request(
        run_id="run-3",
        tool_call_id="call-3",
        tool_id="tool.file-convert",
        mode="ask",
    )
    coordinator.resolve(
        run_id="run-3",
        tool_call_id="call-3",
        decision="approved",
    )

    with pytest.raises(ToolApprovalNotFoundError, match="No pending approval exists"):
        coordinator.resolve(
            run_id="run-3",
            tool_call_id="call-3",
            decision="rejected",
        )


def test_delay_timeout_auto_rejects_and_wait_for_resolution_observes_result(fake_loop: _FakeLoop) -> None:
    clock = _Clock()
    loop = fake_loop
    coordinator = RuntimeToolApprovalCoordinator(
        _time_provider=clock.now,
        _loop_provider=lambda: loop,
    )
    request, future = coordinator.create_request(
        run_id="run-4",
        tool_call_id="call-4",
        tool_id="tool.file-convert",
        mode="delay",
        timeout_seconds=5,
        timeout_action="deny",
    )

    assert request.timeout_at == datetime(2026, 4, 17, 15, 0, 5, tzinfo=UTC)
    assert len(loop.handles) == 1

    clock.advance(seconds=5)
    handle = loop.handles[0]
    handle.callback(*handle.args)

    assert future.done() is True
    resolution = future.result()
    assert resolution.status == "timed_out"
    assert resolution.decision == "rejected"
    assert resolution.source == "timeout"
    assert resolution.timeout_action == "deny"
    assert coordinator.snapshot() == ()
    assert handle.cancelled is True


def test_delay_timeout_auto_approves_when_configured(fake_loop: _FakeLoop) -> None:
    clock = _Clock()
    loop = fake_loop
    coordinator = RuntimeToolApprovalCoordinator(
        _time_provider=clock.now,
        _loop_provider=lambda: loop,
    )
    _, future = coordinator.create_request(
        run_id="run-5",
        tool_call_id="call-5",
        tool_id="tool.file-convert",
        mode="delay",
        timeout_seconds=7,
        timeout_action="approve",
    )

    clock.advance(seconds=7)
    handle = loop.handles[0]
    handle.callback(*handle.args)
    resolution = future.result()

    assert resolution.status == "timed_out"
    assert resolution.decision == "approved"
    assert resolution.timeout_action == "approve"



def test_manual_resolution_wins_over_later_timeout(fake_loop: _FakeLoop) -> None:
    clock = _Clock()
    loop = fake_loop
    coordinator = RuntimeToolApprovalCoordinator(
        _time_provider=clock.now,
        _loop_provider=lambda: loop,
    )
    _, future = coordinator.create_request(
        run_id="run-6",
        tool_call_id="call-6",
        tool_id="tool.file-convert",
        mode="delay",
        timeout_seconds=9,
        timeout_action="deny",
    )

    resolution = coordinator.resolve(
        run_id="run-6",
        tool_call_id="call-6",
        decision="approved",
    )
    handle = loop.handles[0]
    handle.callback(*handle.args)

    assert resolution.status == "approved"
    assert resolution.source == "manual"
    assert future.result() == resolution
    assert coordinator.snapshot() == ()
    assert handle.cancelled is True


@pytest.mark.parametrize(
    ("raw_value", "expected"),
    [
        (None, None),
        (False, None),
        (0, None),
        (-1, None),
        (3, 3),
        (4.0, 4),
        (4.5, None),
        ("", None),
        ("  ", None),
        ("0", None),
        ("15", 15),
        (" 8 ", 8),
        ("8s", None),
    ],
)
def test_parse_tool_timeout_seconds(raw_value: object, expected: int | None) -> None:
    assert parse_tool_timeout_seconds(raw_value) == expected


def test_permission_resolver_filters_invalid_timeout_policy_values() -> None:
    resolver = RuntimeToolPermissionResolver.from_policy(
        RuntimeToolPermissionPolicy(
            schemaVersion=1,
            defaultMode="delay",
            toolTimeoutSeconds={
                "tool.valid": "15",
                "tool.invalid": "bad",
                "tool.zero": 0,
            },
            toolTimeoutActions={
                "tool.valid": "approve",
                "tool.invalid": "deny",
            },
        )
    )

    assert resolver.resolve_timeout_seconds("tool.valid") == 15
    assert resolver.resolve_timeout_seconds("tool.invalid") is None
    assert resolver.resolve_timeout_seconds("tool.zero") is None
    assert resolver.resolve_timeout_action("tool.valid") == "approve"
    assert resolver.resolve_timeout_action("tool.invalid") == "deny"


def test_approval_contracts_serialize_status_fields() -> None:
    request_contract = RuntimeToolApprovalResolveRequest(
        run_id="run-6",
        tool_call_id="call-6",
        decision="approved",
    )
    response_contract = RuntimeToolApprovalResolveResponse(
        ok=True,
        runId="run-6",
        toolCallId="call-6",
        decision="approved",
        status="approved",
        resolvedAt=datetime(2026, 4, 17, 15, 0, tzinfo=UTC),
        source="manual",
    )

    assert request_contract.to_dict() == {
        "run_id": "run-6",
        "tool_call_id": "call-6",
        "decision": "approved",
    }
    assert response_contract.to_dict() == {
        "ok": True,
        "runId": "run-6",
        "toolCallId": "call-6",
        "decision": "approved",
        "status": "approved",
        "resolvedAt": "2026-04-17T15:00:00+00:00",
        "source": "manual",
        "details": {},
    }

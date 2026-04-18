"""Entry-oriented helpers for message run orchestration."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from ..contracts import RuntimeRunStartRequest
from ..debug_logging import (
    is_runtime_chain_debug_enabled,
    log_runtime_chain_debug,
    preview_text,
    summarize_runtime_run_event,
)
from ..execution_event_graph import RuntimeExecutionEventFactory
from ..legacy_event_projection import RuntimeRunEventProjector
from ..run_events import RuntimeRunEvent, RuntimeRunEventFactory


@dataclass(slots=True)
class MessageRunExecutionContext:
    run_id: str
    debug_enabled: bool
    assistant_message_id: str
    events: RuntimeRunEventFactory
    projector: RuntimeRunEventProjector
    execution_events: RuntimeExecutionEventFactory


def create_message_run_context(
    *,
    request: RuntimeRunStartRequest,
    run_id: str | None,
    next_run_id_factory: Callable[[], str],
) -> MessageRunExecutionContext:
    resolved_run_id = run_id or next_run_id_factory()
    request_debug_enabled = request.policy.debugModeEnabled
    debug_enabled = (
        is_runtime_chain_debug_enabled()
        if request_debug_enabled is None
        else request_debug_enabled
    )
    assistant_message_id = f"{resolved_run_id}:assistant"
    events = RuntimeRunEventFactory(
        session_id=request.thread_id, run_id=resolved_run_id
    )
    projector = RuntimeRunEventProjector(
        events=events,
        assistant_message_id=assistant_message_id,
    )
    execution_events = RuntimeExecutionEventFactory(run_id=resolved_run_id)
    return MessageRunExecutionContext(
        run_id=resolved_run_id,
        debug_enabled=debug_enabled,
        assistant_message_id=assistant_message_id,
        events=events,
        projector=projector,
        execution_events=execution_events,
    )


def build_run_started_event(
    *,
    context: MessageRunExecutionContext,
    request: RuntimeRunStartRequest,
) -> RuntimeRunEvent:
    run_started = context.projector.build_run_started()
    log_runtime_chain_debug(
        "orchestrator.run_started",
        enabled=context.debug_enabled,
        runId=context.run_id,
        threadId=request.thread_id,
        agentId=request.agent_id,
        userPromptPreview=preview_text(request.message.content),
        yieldedEvent=summarize_runtime_run_event(run_started),
    )
    return run_started


__all__ = [
    "MessageRunExecutionContext",
    "build_run_started_event",
    "create_message_run_context",
]

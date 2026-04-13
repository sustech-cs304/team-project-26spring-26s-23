"""Run-domain helpers for Copilot runtime message execution."""

from .message_run_handlers import (
    MessageRunExecutionContext,
    build_run_started_event,
    create_message_run_context,
)
from .message_run_mappers import (
    build_thinking_fail_fast_message,
    resolve_applied_thinking_selection,
    to_runtime_thinking_selection,
)
from .message_run_services import RuntimeMessageRunOrchestrator
from .message_run_stream import (
    RuntimeAgentExecutionEventStream,
    RuntimeStreamingAgentExecutor,
    build_failed_execution_events,
    next_run_id,
    open_execution_stream,
    raise_if_client_disconnected,
)

__all__ = [
    "MessageRunExecutionContext",
    "RuntimeAgentExecutionEventStream",
    "RuntimeMessageRunOrchestrator",
    "RuntimeStreamingAgentExecutor",
    "build_failed_execution_events",
    "build_run_started_event",
    "build_thinking_fail_fast_message",
    "create_message_run_context",
    "next_run_id",
    "open_execution_stream",
    "raise_if_client_disconnected",
    "resolve_applied_thinking_selection",
    "to_runtime_thinking_selection",
]

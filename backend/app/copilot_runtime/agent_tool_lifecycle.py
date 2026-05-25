"""Tool lifecycle event types and display helpers for the Copilot runtime agent."""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Callable, Literal, cast

from .execution_event_graph import (
    TOOL_COMPLETED_EVENT_TYPE,
    TOOL_FAILED_EVENT_TYPE,
    TOOL_STARTED_EVENT_TYPE,
    TOOL_WAITING_APPROVAL_EVENT_TYPE,
    RuntimeExecutionEvent,
    RuntimeExecutionEventType,
)
from .skill_snapshot_provider import (
    SKILL_ACTIVATE_TOOL_ID,
    SKILL_READ_RESOURCE_TOOL_ID,
)
from .tool_registry import (
    REQUEST_USER_FORM_TOOL_ID,
    sanitize_tool_result_for_summary,
)

ToolLifecyclePhase = Literal["started", "waiting_approval", "completed", "failed"]


@dataclass(frozen=True, slots=True)
class RuntimeToolLifecycleEvent:
    tool_call_id: str
    tool_id: str
    phase: ToolLifecyclePhase
    title: str
    summary: str
    input_summary: str | None = None
    result_summary: str | None = None
    error_summary: str | None = None
    approval: dict[str, Any] | None = None
    form_request: dict[str, Any] | None = None

    def to_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "toolCallId": self.tool_call_id,
            "toolId": self.tool_id,
            "phase": self.phase,
            "title": self.title,
            "summary": self.summary,
        }
        if self.input_summary is not None:
            payload["inputSummary"] = self.input_summary
        if self.result_summary is not None:
            payload["resultSummary"] = self.result_summary
        if self.error_summary is not None:
            payload["errorSummary"] = self.error_summary
        if self.approval is not None:
            payload["approval"] = dict(self.approval)
        if self.form_request is not None:
            payload["formRequest"] = dict(self.form_request)
        return payload


ToolLifecycleSink = Callable[[RuntimeToolLifecycleEvent], None]


def tool_lifecycle_event_to_execution_event(
    tool_event: RuntimeToolLifecycleEvent,
) -> RuntimeExecutionEvent:
    if tool_event.phase == "started":
        event_type: RuntimeExecutionEventType = TOOL_STARTED_EVENT_TYPE
    elif tool_event.phase == "waiting_approval":
        event_type = TOOL_WAITING_APPROVAL_EVENT_TYPE
    elif tool_event.phase == "completed":
        event_type = TOOL_COMPLETED_EVENT_TYPE
    else:
        event_type = TOOL_FAILED_EVENT_TYPE
    return RuntimeExecutionEvent(type=event_type, payload=tool_event.to_payload())


def _serialize_tool_result_for_display(result: Any) -> str:
    try:
        return json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True)
    except TypeError:
        return json.dumps(
            result, ensure_ascii=False, indent=2, sort_keys=True, default=str
        )


def _sanitize_tool_result_for_display(tool_id: str, result: dict[str, Any]) -> str:
    if tool_id == REQUEST_USER_FORM_TOOL_ID:
        summary = result.get("summary")
        if isinstance(summary, str) and summary.strip() != "":
            return summary.strip()
        form_request = result.get("formRequest")
        if isinstance(form_request, Mapping):
            title = str(form_request.get("title") or "用户表单").strip() or "用户表单"
            return f"需要你补充信息后才能继续：{title}"
        return _serialize_tool_result_for_display(result)

    if tool_id not in {SKILL_ACTIVATE_TOOL_ID, SKILL_READ_RESOURCE_TOOL_ID}:
        sanitized_result = sanitize_tool_result_for_summary(result, tool_id=tool_id)
        return _serialize_tool_result_for_display(sanitized_result)

    sanitized: dict[str, Any] = {
        "ok": result.get("ok"),
    }
    for key in ("skillId", "displayName", "path", "snapshotRevision", "errorCode"):
        if key in result:
            sanitized[key] = result[key]
    if isinstance(result.get("resources"), list):
        sanitized["resourceCount"] = len(cast(list[Any], result.get("resources")))
    if isinstance(result.get("entryContent"), str):
        sanitized["entryContentLength"] = len(cast(str, result.get("entryContent")))
    if isinstance(result.get("content"), str):
        sanitized["contentLength"] = len(cast(str, result.get("content")))
    return _serialize_tool_result_for_display(sanitized)

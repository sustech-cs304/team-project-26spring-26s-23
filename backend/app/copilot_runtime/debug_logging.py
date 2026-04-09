"""Structured debug logging helpers for Copilot runtime execution tracing."""

from __future__ import annotations

import json
import logging
import os
from collections.abc import Mapping, Sequence
from typing import Any

COPILOT_RUNTIME_CHAIN_DEBUG_ENV_VAR = "COPILOT_RUNTIME_CHAIN_DEBUG"
_RUNTIME_CHAIN_DEBUG_LOGGER_NAME = "app.copilot_runtime.chain_debug"
_TRUTHY_DEBUG_VALUES = frozenset({"1", "true", "yes", "on", "debug"})
_DEFAULT_PREVIEW_LIMIT = 120


def is_runtime_chain_debug_enabled(env: Mapping[str, str] | None = None) -> bool:
    source = os.environ if env is None else env
    raw_value = source.get(COPILOT_RUNTIME_CHAIN_DEBUG_ENV_VAR, "")
    return raw_value.strip().lower() in _TRUTHY_DEBUG_VALUES


def preview_text(value: Any, *, limit: int = _DEFAULT_PREVIEW_LIMIT) -> str | None:
    if value is None:
        return None
    text = str(value).replace("\r", "\\r").replace("\n", "\\n")
    normalized_limit = max(int(limit), 0)
    if len(text) <= normalized_limit:
        return text
    return f"{text[:normalized_limit]}…"


def summarize_exception(exc: BaseException | None) -> dict[str, Any] | None:
    if exc is None:
        return None
    return {
        "type": type(exc).__name__,
        "message": preview_text(str(exc), limit=240),
    }


def summarize_runtime_model_route(route: Any | None) -> dict[str, Any] | None:
    if route is None:
        return None
    summary = {
        "providerProfileId": _lookup_value(route, attr_name="provider_profile_id", key_name="providerProfileId"),
        "provider": _lookup_value(route, attr_name="provider", key_name="provider"),
        "providerId": _lookup_value(route, attr_name="provider_id", key_name="providerId"),
        "adapterId": _lookup_value(route, attr_name="adapter_id", key_name="adapterId"),
        "runtimeStatus": _lookup_value(route, attr_name="runtime_status", key_name="runtimeStatus"),
        "catalogRevision": _lookup_value(route, attr_name="catalog_revision", key_name="catalogRevision"),
        "endpointFamily": _lookup_value(route, attr_name="endpoint_family", key_name="endpointFamily"),
        "endpointType": _lookup_value(route, attr_name="endpoint_type", key_name="endpointType"),
        "baseUrl": _lookup_value(route, attr_name="base_url", key_name="baseUrl"),
        "modelId": _lookup_value(route, attr_name="model_id", key_name="modelId"),
        "authKind": _lookup_value(route, attr_name="auth_kind", key_name="authKind"),
    }
    return {key: value for key, value in summary.items() if value is not None}


def summarize_runtime_execution_event(event: Any | None) -> dict[str, Any] | None:
    if event is None:
        return None
    payload = _payload_mapping(event)
    summary: dict[str, Any] = {
        "type": _lookup_value(event, attr_name="type", key_name="type"),
    }
    segment_id = _lookup_mapping_value(payload, "segmentId")
    if segment_id is not None:
        summary["segmentId"] = segment_id
    delta = _lookup_mapping_value(payload, "delta")
    if delta not in (None, ""):
        summary["deltaLength"] = len(str(delta))
        summary["deltaPreview"] = preview_text(delta)
    tool_call_id = _lookup_mapping_value(payload, "toolCallId")
    if tool_call_id is not None:
        summary["toolCallId"] = tool_call_id
    tool_id = _lookup_mapping_value(payload, "toolId")
    if tool_id is not None:
        summary["toolId"] = tool_id
    phase = _lookup_mapping_value(payload, "phase")
    if phase is not None:
        summary["phase"] = phase
    input_summary = _lookup_mapping_value(payload, "inputSummary")
    if input_summary not in (None, ""):
        summary["inputSummary"] = preview_text(input_summary, limit=160)
    result_summary = _lookup_mapping_value(payload, "resultSummary")
    if result_summary not in (None, ""):
        summary["resultSummary"] = preview_text(result_summary, limit=160)
    error_summary = _lookup_mapping_value(payload, "errorSummary")
    if error_summary not in (None, ""):
        summary["errorSummary"] = preview_text(error_summary, limit=160)
    code = _lookup_mapping_value(payload, "code")
    if code is not None:
        summary["code"] = code
    stage = _lookup_mapping_value(payload, "stage")
    if stage is not None:
        summary["stage"] = stage
    reason = _lookup_mapping_value(payload, "reason")
    if reason is not None:
        summary["reason"] = reason
    assistant_text = _lookup_mapping_value(payload, "assistantText")
    if assistant_text not in (None, ""):
        summary["assistantTextLength"] = len(str(assistant_text))
        summary["assistantTextPreview"] = preview_text(assistant_text)
    return summary


def summarize_runtime_thinking_capability(capability: Any | None) -> dict[str, Any] | None:
    if capability is None:
        return None
    summary = {
        "status": _lookup_value(capability, attr_name="status", key_name="status"),
        "source": _lookup_value(capability, attr_name="source", key_name="source"),
        "supported": _lookup_value(capability, attr_name="supported", key_name="supported"),
        "defaultLevel": _lookup_value(capability, attr_name="default_level", key_name="defaultLevel"),
        "reasonCode": _lookup_value(capability, attr_name="reason_code", key_name="reasonCode"),
        "providerHint": _lookup_value(capability, attr_name="provider_hint", key_name="providerHint"),
    }
    supported_levels = _lookup_value(capability, attr_name="supported_levels", key_name="supportedLevels")
    if isinstance(supported_levels, Sequence) and not isinstance(supported_levels, str):
        summary["supportedLevels"] = [_sanitize_value(level) for level in supported_levels]
    route_fingerprint = _lookup_value(capability, attr_name="route_fingerprint", key_name="routeFingerprint")
    if isinstance(route_fingerprint, Mapping):
        summary["routeFingerprint"] = {
            str(key): _sanitize_value(value)
            for key, value in route_fingerprint.items()
        }
    override_levels = _lookup_value(capability, attr_name="override_levels", key_name="overrideLevels")
    if isinstance(override_levels, Sequence) and not isinstance(override_levels, str):
        summary["overrideLevels"] = [_sanitize_value(level) for level in override_levels]
    return summary


def summarize_runtime_run_event(event: Any | None) -> dict[str, Any] | None:
    if event is None:
        return None
    payload = _payload_mapping(event)
    summary: dict[str, Any] = {
        "type": _lookup_value(event, attr_name="type", key_name="type"),
        "sequence": _lookup_value(event, attr_name="sequence", key_name="sequence"),
    }
    assistant_message_id = _lookup_mapping_value(payload, "assistantMessageId")
    if assistant_message_id is not None:
        summary["assistantMessageId"] = assistant_message_id
    delta = _lookup_mapping_value(payload, "delta")
    if delta not in (None, ""):
        summary["deltaLength"] = len(str(delta))
        summary["deltaPreview"] = preview_text(delta)
    phase = _lookup_mapping_value(payload, "phase")
    if phase is not None:
        summary["phase"] = phase
    input_summary = _lookup_mapping_value(payload, "inputSummary")
    if input_summary not in (None, ""):
        summary["inputSummary"] = preview_text(input_summary, limit=160)
    result_summary = _lookup_mapping_value(payload, "resultSummary")
    if result_summary not in (None, ""):
        summary["resultSummary"] = preview_text(result_summary, limit=160)
    error_summary = _lookup_mapping_value(payload, "errorSummary")
    if error_summary not in (None, ""):
        summary["errorSummary"] = preview_text(error_summary, limit=160)
    tool_call_id = _lookup_mapping_value(payload, "toolCallId")
    if tool_call_id is not None:
        summary["toolCallId"] = tool_call_id
    tool_id = _lookup_mapping_value(payload, "toolId")
    if tool_id is not None:
        summary["toolId"] = tool_id
    code = _lookup_mapping_value(payload, "code")
    if code is not None:
        summary["code"] = code
    stage = _lookup_mapping_value(payload, "stage")
    if stage is not None:
        summary["stage"] = stage
    reason = _lookup_mapping_value(payload, "reason")
    if reason is not None:
        summary["reason"] = reason
    requested_thinking_level = _lookup_mapping_value(payload, "requestedThinkingLevel")
    if requested_thinking_level is not None:
        summary["requestedThinkingLevel"] = requested_thinking_level
    applied_thinking_level = _lookup_mapping_value(payload, "appliedThinkingLevel")
    if applied_thinking_level is not None:
        summary["appliedThinkingLevel"] = applied_thinking_level
    thinking_capability_snapshot = summarize_runtime_thinking_capability(
        _lookup_mapping_value(payload, "thinkingCapabilitySnapshot")
    )
    if thinking_capability_snapshot is not None:
        summary["thinkingCapability"] = thinking_capability_snapshot
    assistant_text = _lookup_mapping_value(payload, "assistantText")
    if assistant_text not in (None, ""):
        summary["assistantTextLength"] = len(str(assistant_text))
        summary["assistantTextPreview"] = preview_text(assistant_text)
    return summary


def summarize_runtime_tool_event(event: Any | None) -> dict[str, Any] | None:
    if event is None:
        return None
    summary = {
        "toolCallId": _lookup_value(event, attr_name="tool_call_id", key_name="toolCallId"),
        "toolId": _lookup_value(event, attr_name="tool_id", key_name="toolId"),
        "phase": _lookup_value(event, attr_name="phase", key_name="phase"),
        "title": _lookup_value(event, attr_name="title", key_name="title"),
        "summary": preview_text(_lookup_value(event, attr_name="summary", key_name="summary"), limit=160),
        "inputSummary": preview_text(_lookup_value(event, attr_name="input_summary", key_name="inputSummary"), limit=160),
        "resultSummary": preview_text(_lookup_value(event, attr_name="result_summary", key_name="resultSummary"), limit=160),
        "errorSummary": preview_text(_lookup_value(event, attr_name="error_summary", key_name="errorSummary"), limit=160),
    }
    return {key: value for key, value in summary.items() if value is not None}


def summarize_event_types(events: Sequence[Any]) -> list[str]:
    return [str(_lookup_value(event, attr_name="type", key_name="type") or "unknown") for event in events]


def log_runtime_chain_debug(event_name: str, *, enabled: bool | None = None, **payload: Any) -> None:
    debug_enabled = is_runtime_chain_debug_enabled() if enabled is None else enabled
    if not debug_enabled:
        return

    normalized_payload = {
        key: _sanitize_value(value)
        for key, value in payload.items()
        if value is not None
    }
    body = {
        "event": event_name,
        **normalized_payload,
    }
    logger = logging.getLogger(_RUNTIME_CHAIN_DEBUG_LOGGER_NAME)
    if logger.level == logging.NOTSET:
        logger.setLevel(logging.INFO)
    if not logger.hasHandlers():
        logger = logging.getLogger("uvicorn.error")
        if logger.level == logging.NOTSET:
            logger.setLevel(logging.INFO)
    logger.info(
        "copilot-runtime-chain %s",
        json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
    )


def _payload_mapping(event: Any) -> Mapping[str, Any]:
    payload = _lookup_value(event, attr_name="payload", key_name="payload")
    if isinstance(payload, Mapping):
        return payload
    return {}


def _lookup_value(value: Any, *, attr_name: str, key_name: str) -> Any:
    if value is None:
        return None
    if hasattr(value, attr_name):
        return getattr(value, attr_name)
    if isinstance(value, Mapping):
        return value.get(key_name)
    return None


def _lookup_mapping_value(value: Mapping[str, Any], key_name: str) -> Any:
    return value.get(key_name)


def _sanitize_value(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, Mapping):
        return {str(key): _sanitize_value(nested_value) for key, nested_value in value.items()}
    if isinstance(value, (list, tuple, set, frozenset)):
        return [_sanitize_value(item) for item in value]
    return str(value)


__all__ = [
    "COPILOT_RUNTIME_CHAIN_DEBUG_ENV_VAR",
    "is_runtime_chain_debug_enabled",
    "log_runtime_chain_debug",
    "preview_text",
    "summarize_event_types",
    "summarize_exception",
    "summarize_runtime_execution_event",
    "summarize_runtime_model_route",
    "summarize_runtime_run_event",
    "summarize_runtime_thinking_capability",
    "summarize_runtime_tool_event",
]

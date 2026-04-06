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
    return {
        "providerProfileId": _lookup_value(route, attr_name="provider_profile_id", key_name="providerProfileId"),
        "provider": _lookup_value(route, attr_name="provider", key_name="provider"),
        "endpointType": _lookup_value(route, attr_name="endpoint_type", key_name="endpointType"),
        "baseUrl": _lookup_value(route, attr_name="base_url", key_name="baseUrl"),
        "modelId": _lookup_value(route, attr_name="model_id", key_name="modelId"),
    }


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


def summarize_runtime_thinking_selection(selection: Any | None) -> dict[str, Any] | None:
    if selection is None:
        return None

    series = _lookup_value(selection, attr_name="series", key_name="series")
    mode = _lookup_value(selection, attr_name="mode", key_name="mode")
    level = _lookup_value(selection, attr_name="level", key_name="level")
    if series is not None or mode is not None or level is not None:
        summary = {
            "series": _sanitize_value(series),
            "mode": _sanitize_value(mode),
            "level": _sanitize_value(level),
        }
        budget_tokens = _lookup_value(selection, attr_name="budget_tokens", key_name="budgetTokens")
        summary["budgetTokens"] = _sanitize_value(budget_tokens)
        return summary

    summary = {
        "kind": _lookup_value(selection, attr_name="kind", key_name="kind"),
    }
    value = _lookup_value(selection, attr_name="value", key_name="value")
    if value is not None:
        summary["value"] = _sanitize_value(value)
    budget_tokens = _lookup_value(selection, attr_name="budget_tokens", key_name="budgetTokens")
    if budget_tokens is not None:
        summary["budgetTokens"] = _sanitize_value(budget_tokens)
    return summary


def summarize_runtime_thinking_control_spec(control_spec: Any | None) -> dict[str, Any] | None:
    if control_spec is None:
        return None
    summary = {
        "kind": _lookup_value(control_spec, attr_name="kind", key_name="kind"),
        "selectionKind": _lookup_value(control_spec, attr_name="selection_kind", key_name="selectionKind"),
    }
    if summary["selectionKind"] is None:
        summary["selectionKind"] = 'budget' if summary["kind"] == 'budget' else 'preset'

    preset_options = _lookup_value(control_spec, attr_name="preset_options", key_name="presetOptions")
    summarized_preset_options: list[dict[str, Any]] = []
    if isinstance(preset_options, Sequence) and not isinstance(preset_options, str):
        summarized_preset_options = [
            summarized
            for option in preset_options
            for summarized in [summarize_runtime_thinking_selection(option)]
            if summarized is not None
        ]
        summary["presetOptions"] = summarized_preset_options

    fixed_selection = summarize_runtime_thinking_selection(
        _lookup_value(control_spec, attr_name="fixed_selection", key_name="fixedSelection")
    )
    if fixed_selection is None and summary["kind"] == "fixed" and len(summarized_preset_options) > 0:
        fixed_selection = summarized_preset_options[0]
    if fixed_selection is not None:
        summary["fixedSelection"] = fixed_selection

    budget_value = _lookup_value(control_spec, attr_name="budget", key_name="budget")
    budget = budget_value if isinstance(budget_value, Mapping) else None
    budget_summary: dict[str, Any] = {}
    if budget is not None:
        for key in ("minTokens", "maxTokens", "stepTokens"):
            if key in budget:
                budget_summary[key] = _sanitize_value(budget[key])
    else:
        min_tokens = _lookup_value(control_spec, attr_name="budget_min_tokens", key_name="budgetMinTokens")
        max_tokens = _lookup_value(control_spec, attr_name="budget_max_tokens", key_name="budgetMaxTokens")
        step_tokens = _lookup_value(control_spec, attr_name="budget_step_tokens", key_name="budgetStepTokens")
        if min_tokens is not None:
            budget_summary["minTokens"] = _sanitize_value(min_tokens)
        if max_tokens is not None:
            budget_summary["maxTokens"] = _sanitize_value(max_tokens)
        if step_tokens is not None:
            budget_summary["stepTokens"] = _sanitize_value(step_tokens)
    if len(budget_summary) > 0:
        summary["budget"] = budget_summary
    return summary

def summarize_runtime_thinking_capability(capability: Any | None) -> dict[str, Any] | None:
    if capability is None:
        return None
    summary = {
        "status": _lookup_value(capability, attr_name="status", key_name="status"),
        "source": _lookup_value(capability, attr_name="source", key_name="source"),
        "supported": _lookup_value(capability, attr_name="supported", key_name="supported"),
        "series": _lookup_value(capability, attr_name="series", key_name="series"),
        "defaultLevel": _lookup_value(capability, attr_name="default_level", key_name="defaultLevel"),
        "reasonCode": _lookup_value(capability, attr_name="reason_code", key_name="reasonCode"),
        "providerHint": _lookup_value(capability, attr_name="provider_hint", key_name="providerHint"),
    }
    control_spec = summarize_runtime_thinking_control_spec(
        _lookup_value(capability, attr_name="control_spec", key_name="controlSpec")
    )
    if control_spec is not None:
        summary["controlSpec"] = control_spec
    default_selection = summarize_runtime_thinking_selection(
        _lookup_value(capability, attr_name="default_selection", key_name="defaultSelection")
    )
    if default_selection is not None:
        summary["defaultSelection"] = default_selection
    supported_levels = _lookup_value(capability, attr_name="supported_levels", key_name="supportedLevels")
    if isinstance(supported_levels, Sequence) and not isinstance(supported_levels, str):
        summary["supportedLevels"] = [_sanitize_value(level) for level in supported_levels]
    route_fingerprint = _lookup_value(capability, attr_name="route_fingerprint", key_name="routeFingerprint")
    if isinstance(route_fingerprint, Mapping):
        summary["routeFingerprint"] = {
            str(key): _sanitize_value(value)
            for key, value in route_fingerprint.items()
        }
    provenance = _lookup_value(capability, attr_name="provenance", key_name="provenance")
    if isinstance(provenance, Mapping):
        summary["provenance"] = _sanitize_value(provenance)
    elif provenance is not None:
        route_status = _lookup_value(provenance, attr_name="route_status", key_name="routeStatus")
        override = {
            "present": _lookup_value(provenance, attr_name="override_present", key_name="present"),
            "applied": _lookup_value(provenance, attr_name="override_applied", key_name="applied"),
            "source": _lookup_value(provenance, attr_name="override_source", key_name="source"),
            "format": _lookup_value(provenance, attr_name="override_format", key_name="format"),
        }
        summary["provenance"] = {
            "routeStatus": _sanitize_value(route_status),
            "override": _sanitize_value(override),
        }
    visibility = _lookup_value(capability, attr_name="visibility", key_name="visibility")
    if isinstance(visibility, Mapping):
        summary["visibility"] = _sanitize_value(visibility)
    elif visibility is not None:
        summary["visibility"] = {
            "reasoning": _sanitize_value(_lookup_value(visibility, attr_name="reasoning", key_name="reasoning")),
            "supportsSuppression": _sanitize_value(
                _lookup_value(visibility, attr_name="supports_suppression", key_name="supportsSuppression")
            ),
        }
    override_levels = _lookup_value(capability, attr_name="override_levels", key_name="overrideLevels")
    if isinstance(override_levels, Sequence) and not isinstance(override_levels, str):
        summary["overrideLevels"] = [_sanitize_value(level) for level in override_levels]
    return summary



def summarize_runtime_thinking_selection_result(result: Any | None) -> dict[str, Any] | None:
    if result is None:
        return None
    summary: dict[str, Any] = {
        "requestedSelection": summarize_runtime_thinking_selection(
            _lookup_value(result, attr_name="requested_selection", key_name="requestedSelection")
        ),
        "appliedSelection": summarize_runtime_thinking_selection(
            _lookup_value(result, attr_name="applied_selection", key_name="appliedSelection")
        ),
        "requestedThinkingLevel": _lookup_value(
            result,
            attr_name="requested_intent",
            key_name="requestedThinkingLevel",
        ),
        "appliedThinkingLevel": _lookup_value(
            result,
            attr_name="applied_intent",
            key_name="appliedThinkingLevel",
        ),
        "applied": _lookup_value(result, attr_name="applied", key_name="applied"),
        "reasonCode": _lookup_value(result, attr_name="reason", key_name="reasonCode"),
        "errorCode": _lookup_value(result, attr_name="error_code", key_name="errorCode"),
        "mappingReasonCode": _lookup_value(
            result,
            attr_name="mapping_reason_code",
            key_name="mappingReasonCode",
        ),
        "providerMapping": _lookup_value(result, attr_name="provider_mapping", key_name="providerMapping"),
        "capabilityStatus": _lookup_value(result, attr_name="capability_status", key_name="capabilityStatus"),
        "capabilitySource": _lookup_value(result, attr_name="capability_source", key_name="capabilitySource"),
        "capabilitySeries": _lookup_value(result, attr_name="capability_series", key_name="capabilitySeries"),
        "capabilityReasonCode": _lookup_value(
            result,
            attr_name="capability_reason_code",
            key_name="capabilityReasonCode",
        ),
        "overridePresent": _lookup_value(result, attr_name="override_present", key_name="overridePresent"),
        "overrideApplied": _lookup_value(result, attr_name="override_applied", key_name="overrideApplied"),
        "overrideSource": _lookup_value(result, attr_name="override_source", key_name="overrideSource"),
        "reasoningVisibility": _lookup_value(
            result,
            attr_name="reasoning_visibility",
            key_name="reasoningVisibility",
        ),
        "supportsSuppression": _lookup_value(
            result,
            attr_name="supports_suppression",
            key_name="supportsSuppression",
        ),
    }
    model_settings = _lookup_value(result, attr_name="model_settings", key_name="modelSettings")
    if model_settings is not None:
        summary["modelSettings"] = _sanitize_value(model_settings)
    return {key: value for key, value in summary.items() if value is not None}



def summarize_runtime_reasoning_suppression_basis(basis: Any | None) -> dict[str, Any] | None:
    if basis is None:
        return None
    summary = {
        "shouldSuppress": _lookup_value(basis, attr_name="should_suppress", key_name="shouldSuppress"),
        "source": _lookup_value(basis, attr_name="source", key_name="source"),
        "reasonCode": _lookup_value(basis, attr_name="reason_code", key_name="reasonCode"),
        "appliedThinkingLevel": _lookup_value(
            basis,
            attr_name="applied_thinking_level",
            key_name="appliedThinkingLevel",
        ),
        "reasoningVisibility": _lookup_value(
            basis,
            attr_name="reasoning_visibility",
            key_name="reasoningVisibility",
        ),
        "supportsSuppression": _lookup_value(
            basis,
            attr_name="supports_suppression",
            key_name="supportsSuppression",
        ),
        "capabilitySource": _lookup_value(basis, attr_name="capability_source", key_name="capabilitySource"),
        "capabilitySeries": _lookup_value(basis, attr_name="capability_series", key_name="capabilitySeries"),
    }
    return {key: value for key, value in summary.items() if value is not None}



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
    summary["requestedThinkingSelection"] = summarize_runtime_thinking_selection(
        _lookup_mapping_value(payload, "requestedThinkingSelection")
    )
    summary["appliedThinkingSelection"] = summarize_runtime_thinking_selection(
        _lookup_mapping_value(payload, "appliedThinkingSelection")
    )
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
    thinking_selection_result = summarize_runtime_thinking_selection_result(
        _lookup_mapping_value(payload, "thinkingSelectionResult")
    )
    if thinking_selection_result is not None:
        summary["thinkingSelectionResult"] = thinking_selection_result
    reasoning_suppression_basis = summarize_runtime_reasoning_suppression_basis(
        _lookup_mapping_value(payload, "reasoningSuppressionBasis")
    )
    if reasoning_suppression_basis is not None:
        summary["reasoningSuppressionBasis"] = reasoning_suppression_basis
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
    "summarize_runtime_reasoning_suppression_basis",
    "summarize_runtime_run_event",
    "summarize_runtime_thinking_capability",
    "summarize_runtime_thinking_selection_result",
    "summarize_runtime_tool_event",
]

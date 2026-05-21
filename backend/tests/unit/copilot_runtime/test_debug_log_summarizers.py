from __future__ import annotations

from app.copilot_runtime._debug_logging.summarizers import (
    preview_text,
    summarize_event_types,
    summarize_exception,
    summarize_runtime_execution_event,
    summarize_runtime_model_route,
    summarize_runtime_reasoning_suppression_basis,
    summarize_runtime_run_event,
    summarize_runtime_thinking_capability,
    summarize_runtime_thinking_control_spec,
    summarize_runtime_thinking_selection,
    summarize_runtime_thinking_selection_result,
    summarize_runtime_thinking_value,
    summarize_runtime_tool_event,
)


# ---------------------------------------------------------------------------
# preview_text
# ---------------------------------------------------------------------------


def test_preview_text_none_returns_none() -> None:
    assert preview_text(None) is None


def test_preview_text_short_text_not_truncated() -> None:
    assert preview_text("hello") == "hello"


def test_preview_text_long_text_truncated() -> None:
    long_text = "x" * 200
    result = preview_text(long_text)
    assert result is not None
    assert len(result) <= 130  # 120 + "…"
    assert result.endswith("…")


def test_preview_text_custom_limit() -> None:
    assert preview_text("hello world", limit=5) == "hello…"


def test_preview_text_exact_limit() -> None:
    assert preview_text("hello", limit=5) == "hello"


def test_preview_text_newline_escaped() -> None:
    assert preview_text("line1\nline2") == "line1\\nline2"


def test_preview_text_carriage_return_escaped() -> None:
    assert preview_text("a\rb") == "a\\rb"


def test_preview_text_zero_limit_returns_empty() -> None:
    result = preview_text("test", limit=0)
    assert result == "…"


def test_preview_text_negative_limit_normalized_to_zero() -> None:
    result = preview_text("test", limit=-5)
    assert result == "…"


# ---------------------------------------------------------------------------
# summarize_exception
# ---------------------------------------------------------------------------


def test_summarize_exception_none_returns_none() -> None:
    assert summarize_exception(None) is None


def test_summarize_exception_returns_type_and_message() -> None:
    exc = ValueError("something went wrong")
    result = summarize_exception(exc)
    assert result is not None
    assert result["type"] == "ValueError"
    assert result["message"] is not None
    assert "something went wrong" in result["message"]


def test_summarize_exception_truncates_long_message() -> None:
    exc = RuntimeError("x" * 300)
    result = summarize_exception(exc)
    assert result is not None
    assert len(result["message"]) <= 250  # 240 + "…"


# ---------------------------------------------------------------------------
# summarize_runtime_model_route
# ---------------------------------------------------------------------------


class _FakeRoute:
    def __init__(self, **kwargs):
        for key, value in kwargs.items():
            setattr(self, key, value)


def test_summarize_model_route_none_returns_none() -> None:
    assert summarize_runtime_model_route(None) is None


def test_summarize_model_route_basic_fields() -> None:
    route = _FakeRoute(
        provider_profile_id="prov-1",
        provider="openai",
        model_id="gpt-4.1",
        auth_kind="api-key",
    )
    result = summarize_runtime_model_route(route)
    assert result is not None
    assert result["providerProfileId"] == "prov-1"
    assert result["provider"] == "openai"
    assert result["modelId"] == "gpt-4.1"
    assert result["authKind"] == "api-key"
    assert "adapterId" not in result
    assert "runtimeStatus" not in result


def test_summarize_model_route_camel_case_fields() -> None:
    route = _FakeRoute(
        providerProfileId="prov-2",
        baseUrl="https://api.example.com",
    )
    result = summarize_runtime_model_route(route)
    assert result is not None
    assert result["providerProfileId"] == "prov-2"
    assert result["baseUrl"] == "https://api.example.com"


def test_summarize_model_route_filters_none_values() -> None:
    route = _FakeRoute(
        provider_profile_id="prov-3",
        provider=None,
        adapter_id=None,
    )
    result = summarize_runtime_model_route(route)
    assert result is not None
    assert result["providerProfileId"] == "prov-3"
    assert "provider" not in result
    assert "adapterId" not in result


def test_summarize_model_route_full_shape() -> None:
    route = _FakeRoute(
        provider_profile_id="pp-1",
        provider="openai",
        provider_id="oid-1",
        adapter_id="adapter-1",
        runtime_status="active",
        catalog_revision="rev-1",
        endpoint_family="chat",
        endpoint_type="openai-compatible",
        base_url="https://example.com/v1",
        model_id="gpt-4.1",
        auth_kind="api-key",
    )
    result = summarize_runtime_model_route(route)
    assert result is not None
    assert result == {
        "providerProfileId": "pp-1",
        "provider": "openai",
        "providerId": "oid-1",
        "adapterId": "adapter-1",
        "runtimeStatus": "active",
        "catalogRevision": "rev-1",
        "endpointFamily": "chat",
        "endpointType": "openai-compatible",
        "baseUrl": "https://example.com/v1",
        "modelId": "gpt-4.1",
        "authKind": "api-key",
    }


# ---------------------------------------------------------------------------
# summarize_runtime_execution_event
# ---------------------------------------------------------------------------


def test_summarize_execution_event_none_returns_none() -> None:
    assert summarize_runtime_execution_event(None) is None


def test_summarize_execution_event_basic_type() -> None:
    event = _FakeRoute(type="text_delta", payload={"delta": "hello"})
    result = summarize_runtime_execution_event(event)
    assert result is not None
    assert result["type"] == "text_delta"
    assert result["deltaLength"] == 5
    assert result["deltaPreview"] == "hello"


def test_summarize_execution_event_with_segment_id() -> None:
    event = _FakeRoute(
        type="run_metadata",
        payload={"segmentId": "seg-1", "stage": "thinking"},
    )
    result = summarize_runtime_execution_event(event)
    assert result is not None
    assert result["segmentId"] == "seg-1"
    assert result["stage"] == "thinking"


def test_summarize_execution_event_with_tool_call() -> None:
    event = _FakeRoute(
        type="tool_use",
        payload={
            "toolCallId": "call-1",
            "toolId": "tool.fs.read",
            "phase": "starting",
            "inputSummary": "Reading file.txt",
        },
    )
    result = summarize_runtime_execution_event(event)
    assert result is not None
    assert result["toolCallId"] == "call-1"
    assert result["toolId"] == "tool.fs.read"
    assert result["phase"] == "starting"
    assert result["inputSummary"] == "Reading file.txt"


def test_summarize_execution_event_empty_string_fields_excluded() -> None:
    event = _FakeRoute(type="run_diagnostic", payload={"delta": "", "resultSummary": ""})
    result = summarize_runtime_execution_event(event)
    assert result is not None
    assert result["type"] == "run_diagnostic"
    assert "deltaLength" not in result
    assert "deltaPreview" not in result
    assert "resultSummary" not in result


def test_summarize_execution_event_with_error_and_result() -> None:
    event = _FakeRoute(
        type="tool_result",
        payload={
            "resultSummary": "File written successfully.",
            "errorSummary": "Permission denied on sub-path.",
            "code": "permission_denied",
        },
    )
    result = summarize_runtime_execution_event(event)
    assert result is not None
    assert result["resultSummary"] == "File written successfully."
    assert result["errorSummary"] == "Permission denied on sub-path."
    assert result["code"] == "permission_denied"


def test_summarize_execution_event_with_assistant_text() -> None:
    event = _FakeRoute(
        type="text_delta",
        payload={"assistantText": "Hello, how can I help you?"},
    )
    result = summarize_runtime_execution_event(event)
    assert result is not None
    assert result["assistantTextLength"] == 26
    assert result["assistantTextPreview"] == "Hello, how can I help you?"


def test_summarize_execution_event_payload_from_dict() -> None:
    event = {"type": "reasoning_delta", "payload": {"reason": "thinking..."}}
    result = summarize_runtime_execution_event(event)
    assert result is not None
    assert result["type"] == "reasoning_delta"
    assert result["reason"] == "thinking..."


# ---------------------------------------------------------------------------
# summarize_runtime_thinking_value
# ---------------------------------------------------------------------------


def test_summarize_thinking_value_none_returns_none() -> None:
    assert summarize_runtime_thinking_value(None) is None


def test_summarize_thinking_value_code() -> None:
    value = _FakeRoute(
        value_type="code",
        code="medium",
        label_zh="中",
    )
    result = summarize_runtime_thinking_value(value)
    assert result is not None
    assert result["valueType"] == "code"
    assert result["code"] == "medium"
    assert result["labelZh"] == "中"
    assert "budgetTokens" not in result


def test_summarize_thinking_value_budget() -> None:
    value = _FakeRoute(
        valueType="budget",
        mode="budget",
        budgetTokens=4096,
    )
    result = summarize_runtime_thinking_value(value)
    assert result is not None
    assert result["valueType"] == "budget"
    assert result["mode"] == "budget"
    assert result["budgetTokens"] == 4096


def test_summarize_thinking_value_from_dict() -> None:
    value = {"valueType": "fixed", "code": "fixed", "labelZh": "固定推理"}
    result = summarize_runtime_thinking_value(value)
    assert result is not None
    assert result["valueType"] == "fixed"
    assert result["code"] == "fixed"


# ---------------------------------------------------------------------------
# summarize_runtime_thinking_selection
# ---------------------------------------------------------------------------


def test_summarize_thinking_selection_none_returns_none() -> None:
    assert summarize_runtime_thinking_selection(None) is None


def test_summarize_thinking_selection_with_typed_value() -> None:
    from app.copilot_runtime.contracts import RuntimeThinkingSelection, RuntimeThinkingValue

    value = RuntimeThinkingValue(valueType="code", code="medium", labelZh="中")
    selection = RuntimeThinkingSelection(series="unified-4-level-v1", value=value)
    result = summarize_runtime_thinking_selection(selection)
    assert result is not None
    assert result["series"] == "unified-4-level-v1"
    assert result["value"]["code"] == "medium"


def test_summarize_thinking_selection_with_legacy_shape() -> None:
    selection = _FakeRoute(series="legacy-v1", mode="preset", level="high", budget_tokens=None)
    result = summarize_runtime_thinking_selection(selection)
    assert result is not None
    assert result["series"] == "legacy-v1"
    assert result["mode"] == "preset"
    assert result["level"] == "high"


def test_summarize_thinking_selection_with_kind_shape() -> None:
    selection = _FakeRoute(kind="discrete", value={"code": "low"})
    result = summarize_runtime_thinking_selection(selection)
    assert result is not None
    assert result["kind"] == "discrete"
    assert result["value"] == {"code": "low"}


# ---------------------------------------------------------------------------
# summarize_runtime_thinking_capability
# ---------------------------------------------------------------------------


def test_summarize_thinking_capability_none_returns_none() -> None:
    assert summarize_runtime_thinking_capability(None) is None


def test_summarize_thinking_capability_basic_fields() -> None:
    capability = _FakeRoute(
        status="verified-supported",
        source="verified",
        supported=True,
        series="unified-4-level-v1",
        series_label_zh="统一 4 档系列",
        editor_type="discrete",
        default_level="medium",
        reason_code="verified_series_resolved",
    )
    result = summarize_runtime_thinking_capability(capability)
    assert result is not None
    assert result["status"] == "verified-supported"
    assert result["source"] == "verified"
    assert result["series"] == "unified-4-level-v1"
    assert result["editorType"] == "discrete"
    assert result["reasonCode"] == "verified_series_resolved"


def test_summarize_thinking_capability_with_visibility() -> None:
    capability = _FakeRoute(
        status="verified-supported",
        source="verified",
        supported=True,
        series="deepseek-fixed-reasoning-v1",
        visibility={"reasoning": "fixed-no-visible-trace", "supportsSuppression": True},
    )
    result = summarize_runtime_thinking_capability(capability)
    assert result is not None
    assert "visibility" in result
    assert result["visibility"]["reasoning"] == "fixed-no-visible-trace"
    assert result["visibility"]["supportsSuppression"] is True


def test_summarize_thinking_capability_filters_none_values() -> None:
    capability = _FakeRoute(
        status="unknown-without-override",
        source="unknown",
        supported=True,
        series=None,
        series_label_zh=None,
        editor_type=None,
        reason_code="route_not_verified",
    )
    result = summarize_runtime_thinking_capability(capability)
    assert result is not None
    assert result["status"] == "unknown-without-override"
    assert "series" not in result


def test_summarize_thinking_capability_with_provenance_as_object() -> None:
    capability = _FakeRoute(
        status="verified-supported",
        source="verified",
        supported=True,
        series="unified-4-level-v1",
        provenance=_FakeRoute(
            route_status="verified",
            override_present=True,
            override_applied=False,
            override_source="settings-model-declaration",
            override_format="capability-override-v1",
        ),
    )
    result = summarize_runtime_thinking_capability(capability)
    assert result is not None
    assert "provenance" in result
    assert result["provenance"]["override"]["present"] is True

def test_summarize_thinking_capability_with_provenance_as_dict() -> None:
    capability = {
        "status": "verified-supported",
        "source": "verified",
        "supported": True,
        "series": "unified-4-level-v1",
        "provenance": {
            "routeStatus": "verified",
            "override": {
                "present": True,
                "applied": False,
                "source": "settings-model-declaration",
                "format": "capability-override-v1",
            },
        },
    }
    result = summarize_runtime_thinking_capability(capability)
    assert result is not None
    assert "provenance" in result
    assert isinstance(result["provenance"], dict)


def test_summarize_thinking_capability_from_dict() -> None:
    capability = {
        "status": "verified-supported",
        "source": "verified",
        "supported": True,
        "series": "unified-4-level-v1",
        "seriesLabelZh": "统一 4 档系列",
        "editorType": "discrete",
        "reasonCode": "verified_series_resolved",
        "routeFingerprint": {"provider": "openai", "modelId": "gpt-4o"},
    }
    result = summarize_runtime_thinking_capability(capability)
    assert result is not None
    assert result["status"] == "verified-supported"
    assert result["series"] == "unified-4-level-v1"
    assert "routeFingerprint" in result


# ---------------------------------------------------------------------------
# summarize_runtime_thinking_selection_result
# ---------------------------------------------------------------------------


def test_summarize_thinking_selection_result_none_returns_none() -> None:
    assert summarize_runtime_thinking_selection_result(None) is None


def test_summarize_thinking_selection_result_basic() -> None:
    result_obj = _FakeRoute(
        applied=True,
        reason="verified_series_builder_applied",
        applied_intent="medium",
        capability_status="verified-supported",
        capability_source="verified",
        provider_builder_key="openai_reasoning_effort_v1",
        model_settings={"reasoning_effort": "medium"},
    )
    result = summarize_runtime_thinking_selection_result(result_obj)
    assert result is not None
    assert result["applied"] is True
    assert result["reasonCode"] == "verified_series_builder_applied"
    assert result["appliedThinkingLevel"] == "medium"
    assert result["capabilityStatus"] == "verified-supported"
    assert result["capabilitySource"] == "verified"
    assert result["providerBuilderKey"] == "openai_reasoning_effort_v1"
    assert result["modelSettings"] == {"reasoning_effort": "medium"}


def test_summarize_thinking_selection_result_with_error() -> None:
    result_obj = _FakeRoute(
        applied=False,
        reason="selection_missing",
        error_code="selection_missing",
        capability_status="unknown-without-override",
        capability_source="unknown",
    )
    result = summarize_runtime_thinking_selection_result(result_obj)
    assert result is not None
    assert result["applied"] is False
    assert result["errorCode"] == "selection_missing"
    assert "appliedThinkingLevel" not in result


def test_summarize_thinking_selection_result_with_override_fields() -> None:
    result_obj = _FakeRoute(
        applied=True,
        reason="override_series_builder_applied",
        override_present=True,
        override_applied=True,
        override_source="settings-model-declaration",
    )
    result = summarize_runtime_thinking_selection_result(result_obj)
    assert result is not None
    assert result["overridePresent"] is True
    assert result["overrideApplied"] is True
    assert result["overrideSource"] == "settings-model-declaration"


def test_summarize_thinking_selection_result_from_dict() -> None:
    data = {
        "requestedSelection": None,
        "appliedSelection": None,
        "applied": False,
        "reasonCode": "route_not_verified",
        "capabilityStatus": "unknown-without-override",
        "capabilitySource": "unknown",
    }
    result = summarize_runtime_thinking_selection_result(data)
    assert result is not None
    assert result["applied"] is False
    assert result["reasonCode"] == "route_not_verified"


# ---------------------------------------------------------------------------
# summarize_runtime_reasoning_suppression_basis
# ---------------------------------------------------------------------------


def test_summarize_suppression_basis_none_returns_none() -> None:
    assert summarize_runtime_reasoning_suppression_basis(None) is None


def test_summarize_suppression_basis_default() -> None:
    basis = _FakeRoute(
        should_suppress=False,
        source="none",
        reason_code=None,
        reasoning_visibility="visible",
        supports_suppression=True,
        capability_source=None,
        capability_series=None,
    )
    result = summarize_runtime_reasoning_suppression_basis(basis)
    assert result is not None
    assert result["shouldSuppress"] is False
    assert result["source"] == "none"
    assert "reasonCode" not in result


def test_summarize_suppression_basis_suppressed() -> None:
    basis = _FakeRoute(
        should_suppress=True,
        source="capability-visibility",
        reason_code="capability_visibility_hidden",
        reasoning_visibility="hidden",
        supports_suppression=True,
        capability_source="verified",
        capability_series="deepseek-fixed-reasoning-v1",
    )
    result = summarize_runtime_reasoning_suppression_basis(basis)
    assert result is not None
    assert result["shouldSuppress"] is True
    assert result["source"] == "capability-visibility"
    assert result["reasonCode"] == "capability_visibility_hidden"
    assert result["capabilitySource"] == "verified"
    assert result["capabilitySeries"] == "deepseek-fixed-reasoning-v1"


def test_summarize_suppression_basis_from_dict() -> None:
    basis = {
        "shouldSuppress": True,
        "source": "applied-selection",
        "reasonCode": "applied_selection_suppressed",
        "reasoningVisibility": "visible",
        "supportsSuppression": True,
    }
    result = summarize_runtime_reasoning_suppression_basis(basis)
    assert result is not None
    assert result["shouldSuppress"] is True
    assert result["source"] == "applied-selection"


# ---------------------------------------------------------------------------
# summarize_runtime_run_event
# ---------------------------------------------------------------------------


def test_summarize_run_event_none_returns_none() -> None:
    assert summarize_runtime_run_event(None) is None


def test_summarize_run_event_basic() -> None:
    event = _FakeRoute(
        type="run_started",
        sequence=1,
        payload={"assistantMessageId": "run-1:assistant"},
    )
    result = summarize_runtime_run_event(event)
    assert result is not None
    assert result["type"] == "run_started"
    assert result["sequence"] == 1
    assert result["assistantMessageId"] == "run-1:assistant"


def test_summarize_run_event_with_thinking_selections() -> None:
    from app.copilot_runtime.contracts import RuntimeThinkingSelection, RuntimeThinkingValue

    value = RuntimeThinkingValue(valueType="code", code="medium", labelZh="中")
    requested = RuntimeThinkingSelection(series="unified-4-level-v1", value=value)
    applied = RuntimeThinkingSelection(series="unified-4-level-v1", value=value)

    event = _FakeRoute(
        type="run_metadata",
        sequence=2,
        payload={
            "requestedThinkingSelection": requested,
            "appliedThinkingSelection": applied,
            "requestedThinkingLevel": "medium",
            "appliedThinkingLevel": "medium",
        },
    )
    result = summarize_runtime_run_event(event)
    assert result is not None
    assert result["requestedThinkingLevel"] == "medium"
    assert result["appliedThinkingLevel"] == "medium"
    assert result["requestedThinkingSelection"] is not None
    assert result["appliedThinkingSelection"] is not None


def test_summarize_run_event_with_delta() -> None:
    event = _FakeRoute(
        type="text_delta",
        sequence=3,
        payload={"delta": "Hello world!", "phase": "streaming"},
    )
    result = summarize_runtime_run_event(event)
    assert result is not None
    assert result["deltaLength"] == 12
    assert result["deltaPreview"] == "Hello world!"
    assert result["phase"] == "streaming"


def test_summarize_run_event_with_tool_call() -> None:
    event = _FakeRoute(
        type="tool_use",
        sequence=4,
        payload={
            "toolCallId": "tc-1",
            "toolId": "tool.fs.read",
            "inputSummary": "Read /path/to/file",
            "resultSummary": "Success.",
        },
    )
    result = summarize_runtime_run_event(event)
    assert result is not None
    assert result["toolCallId"] == "tc-1"
    assert result["toolId"] == "tool.fs.read"
    assert result["inputSummary"] == "Read /path/to/file"
    assert result["resultSummary"] == "Success."


def test_summarize_run_event_from_dict() -> None:
    event = {
        "type": "run_completed",
        "sequence": 5,
        "payload": {"stage": "final", "code": "success"},
    }
    result = summarize_runtime_run_event(event)
    assert result is not None
    assert result["type"] == "run_completed"
    assert result["sequence"] == 5
    assert result["stage"] == "final"


# ---------------------------------------------------------------------------
# summarize_runtime_tool_event
# ---------------------------------------------------------------------------


def test_summarize_tool_event_none_returns_none() -> None:
    assert summarize_runtime_tool_event(None) is None


def test_summarize_tool_event_basic() -> None:
    event = _FakeRoute(
        tool_call_id="tc-1",
        tool_id="tool.fs.write",
        phase="completed",
        title="Write File",
    )
    result = summarize_runtime_tool_event(event)
    assert result is not None
    assert result["toolCallId"] == "tc-1"
    assert result["toolId"] == "tool.fs.write"
    assert result["phase"] == "completed"
    assert result["title"] == "Write File"


def test_summarize_tool_event_with_summaries() -> None:
    event = _FakeRoute(
        tool_call_id="tc-2",
        tool_id="tool.fs.search",
        phase="starting",
        title="Search Files",
        summary="Searching for *.py files",
        input_summary="Pattern: *.py",
        result_summary="Found 42 files",
        error_summary=None,
    )
    result = summarize_runtime_tool_event(event)
    assert result is not None
    assert result["summary"] == "Searching for *.py files"
    assert result["inputSummary"] == "Pattern: *.py"
    assert result["resultSummary"] == "Found 42 files"
    assert "errorSummary" not in result


def test_summarize_tool_event_with_camel_case_fields() -> None:
    event = _FakeRoute(
        toolCallId="tc-3",
        toolId="tool.fs.delete",
        phase="completed",
        title="Delete File",
        inputSummary="/tmp/test.txt",
        resultSummary="Deleted successfully.",
    )
    result = summarize_runtime_tool_event(event)
    assert result is not None
    assert result["toolCallId"] == "tc-3"
    assert result["inputSummary"] == "/tmp/test.txt"


def test_summarize_tool_event_long_summary_truncated() -> None:
    long_summary = "x" * 200
    event = _FakeRoute(
        tool_call_id="tc-4",
        tool_id="tool.test",
        summary=long_summary,
    )
    result = summarize_runtime_tool_event(event)
    assert result is not None
    assert result["summary"] is not None
    assert len(result["summary"]) <= 170  # 160 + "…"


def test_summarize_tool_event_from_dict() -> None:
    event = {
        "toolCallId": "tc-5",
        "toolId": "tool.example",
        "phase": "completed",
    }
    result = summarize_runtime_tool_event(event)
    assert result is not None
    assert result["toolCallId"] == "tc-5"
    assert result["toolId"] == "tool.example"


# ---------------------------------------------------------------------------
# summarize_event_types
# ---------------------------------------------------------------------------


def test_summarize_event_types_empty_list() -> None:
    assert summarize_event_types([]) == []


def test_summarize_event_types_multiple_events() -> None:
    events = [
        _FakeRoute(type="run_started"),
        _FakeRoute(type="text_delta"),
        _FakeRoute(type="run_completed"),
    ]
    assert summarize_event_types(events) == [
        "run_started",
        "text_delta",
        "run_completed",
    ]


def test_summarize_event_types_event_without_type() -> None:
    events = [
        _FakeRoute(type="run_started"),
        _FakeRoute(),
    ]
    assert summarize_event_types(events) == ["run_started", "unknown"]


def test_summarize_event_types_from_dicts() -> None:
    events = [
        {"type": "run_started"},
        {"type": "text_delta"},
    ]
    assert summarize_event_types(events) == ["run_started", "text_delta"]


# ---------------------------------------------------------------------------
# summarize_runtime_thinking_control_spec
# ---------------------------------------------------------------------------


def test_summarize_control_spec_none_returns_none() -> None:
    assert summarize_runtime_thinking_control_spec(None) is None


def test_summarize_control_spec_basic() -> None:
    spec = _FakeRoute(kind="discrete", selection_kind="discrete")
    result = summarize_runtime_thinking_control_spec(spec)
    assert result is not None
    assert result["kind"] == "discrete"
    assert result["selectionKind"] == "discrete"


def test_summarize_control_spec_with_preset_options() -> None:
    from app.copilot_runtime.contracts import RuntimeThinkingValue

    value = RuntimeThinkingValue(valueType="code", code="medium", labelZh="中")
    spec = _FakeRoute(
        kind="preset",
        preset_options=[value],
    )
    result = summarize_runtime_thinking_control_spec(spec)
    assert result is not None
    assert "presetOptions" in result
    assert len(result["presetOptions"]) == 1


def test_summarize_control_spec_with_fixed_selection() -> None:
    from app.copilot_runtime.contracts import RuntimeThinkingSelection, RuntimeThinkingValue

    value = RuntimeThinkingValue(valueType="fixed", code="fixed", labelZh="固定推理")
    selection = RuntimeThinkingSelection(series="deepseek-fixed-reasoning-v1", value=value)
    spec = _FakeRoute(kind="fixed", fixed_selection=selection)
    result = summarize_runtime_thinking_control_spec(spec)
    assert result is not None
    assert "fixedSelection" in result
    assert result["fixedSelection"]["series"] == "deepseek-fixed-reasoning-v1"


def test_summarize_control_spec_with_budget() -> None:
    spec = _FakeRoute(
        kind="budget",
        selection_kind="budget",
        budget={"minTokens": 0, "maxTokens": 1048576, "stepTokens": 1024},
    )
    result = summarize_runtime_thinking_control_spec(spec)
    assert result is not None
    assert "budget" in result
    assert result["budget"]["minTokens"] == 0
    assert result["budget"]["maxTokens"] == 1048576


def test_summarize_control_spec_with_budget_fields() -> None:
    spec = _FakeRoute(
        kind="budget",
        budget_min_tokens=0,
        budget_max_tokens=131072,
        budget_step_tokens=4096,
    )
    result = summarize_runtime_thinking_control_spec(spec)
    assert result is not None
    assert "budget" in result
    assert result["budget"]["minTokens"] == 0
    assert result["budget"]["maxTokens"] == 131072
    assert result["budget"]["stepTokens"] == 4096

from __future__ import annotations

from unittest.mock import MagicMock, Mock

from app.copilot_runtime.model_routes import RuntimeModelRouteRef
from app.copilot_runtime.persistence.drift import (
    _MULTIPLE_ISSUES_STATUS,
    _NO_DRIFT_STATUS,
    _NOT_EVALUATED_STATUS,
    _PROVIDER_REMOVED_CODE,
    _MODEL_UNAVAILABLE_CODE,
    _TOOL_UNREGISTERED_CODE,
    _THINKING_UNSUPPORTED_CODE,
    PersistedHistoryDriftEvaluator,
    _build_warning,
    _deserialize_runtime_model_route,
    _format_historical_thinking_summary,
    _normalize_optional_string,
    _resolve_status,
)
from app.copilot_runtime.model_routes import RuntimeModelRoute, RuntimeModelRouteResolutionError
from app.copilot_runtime.persistence.models.chat import RunModel
from app.copilot_runtime.thinking_adapter import CanonicalThinkingCapability


def test_no_drift_when_run_has_no_model_or_tools_or_thinking() -> None:
    evaluator = PersistedHistoryDriftEvaluator()
    run = RunModel(
        id="run-1",
        thread_id="thread-1",
        status="completed",
        request_message_text="hello",
        request_message_role="user",
        resolved_model_id=None,
        enabled_tools_json=[],
        resolved_tool_ids_json=None,
        applied_thinking_json=None,
        requested_thinking_json=None,
        thinking_capability_override_json=None,
        selected_model_route_json={},
    )
    result = evaluator.evaluate(run=run, bound_agent_id="default")
    assert result["status"] == _NO_DRIFT_STATUS
    assert result["warnings"] == []
    assert result["requiresExplicitRebind"] is False


def test_not_evaluated_when_model_route_without_resolver() -> None:
    evaluator = PersistedHistoryDriftEvaluator()
    run = RunModel(
        id="run-1",
        thread_id="thread-1",
        status="completed",
        request_message_text="hello",
        request_message_role="user",
        resolved_model_id="gpt-4.1",
        enabled_tools_json=[],
        resolved_tool_ids_json=None,
        applied_thinking_json=None,
        requested_thinking_json=None,
        thinking_capability_override_json=None,
        selected_model_route_json={
            "providerProfileId": "provider-1",
            "routeRef": {
                "routeKind": "provider-model",
                "profileId": "provider-1",
                "modelId": "gpt-4.1",
            },
        },
    )
    result = evaluator.evaluate(run=run, bound_agent_id="default")
    assert result["status"] == _NOT_EVALUATED_STATUS
    assert result["warnings"] == []


def test_not_evaluated_when_tools_without_registries() -> None:
    evaluator = PersistedHistoryDriftEvaluator()
    run = RunModel(
        id="run-1",
        thread_id="thread-1",
        status="completed",
        request_message_text="hello",
        request_message_role="user",
        resolved_model_id=None,
        enabled_tools_json=[],
        resolved_tool_ids_json=["tool.weather"],
        applied_thinking_json=None,
        requested_thinking_json=None,
        thinking_capability_override_json=None,
        selected_model_route_json={},
    )
    result = evaluator.evaluate(run=run, bound_agent_id="default")
    assert result["status"] == _NOT_EVALUATED_STATUS
    assert result["warnings"] == []


def test_not_evaluated_when_thinking_without_route_and_adapter() -> None:
    evaluator = PersistedHistoryDriftEvaluator()
    run = RunModel(
        id="run-1",
        thread_id="thread-1",
        status="completed",
        request_message_text="hello",
        request_message_role="user",
        resolved_model_id="gpt-4.1",
        enabled_tools_json=[],
        resolved_tool_ids_json=None,
        applied_thinking_json={"series": "compat-discrete-selection-v1", "level": "medium"},
        requested_thinking_json=None,
        thinking_capability_override_json=None,
        selected_model_route_json={},
    )
    result = evaluator.evaluate(run=run, bound_agent_id="default")
    assert result["status"] == _NOT_EVALUATED_STATUS
    assert result["warnings"] == []


def test_provider_removed_warning_on_provider_not_found() -> None:
    error = RuntimeModelRouteResolutionError(code="provider_profile_not_found", message="provider not found")
    model_route_resolver = Mock()
    model_route_resolver.resolve = Mock(side_effect=error)
    evaluator = PersistedHistoryDriftEvaluator(model_route_resolver=model_route_resolver)
    run = RunModel(
        id="run-1",
        thread_id="thread-1",
        status="completed",
        request_message_text="hello",
        request_message_role="user",
        resolved_model_id="gpt-4.1",
        enabled_tools_json=[],
        resolved_tool_ids_json=None,
        applied_thinking_json=None,
        requested_thinking_json=None,
        thinking_capability_override_json=None,
        selected_model_route_json={
            "providerProfileId": "provider-1",
            "routeRef": {
                "routeKind": "provider-model",
                "profileId": "provider-1",
                "modelId": "gpt-4.1",
            },
        },
    )
    result = evaluator.evaluate(run=run, bound_agent_id="default")
    assert result["status"] == _PROVIDER_REMOVED_CODE
    assert len(result["warnings"]) == 1
    assert result["warnings"][0]["code"] == _PROVIDER_REMOVED_CODE
    assert result["requiresExplicitRebind"] is True


def test_model_unavailable_warning_on_provider_model_not_found() -> None:
    error = RuntimeModelRouteResolutionError(code="provider_model_not_found", message="model not found")
    model_route_resolver = Mock()
    model_route_resolver.resolve = Mock(side_effect=error)
    evaluator = PersistedHistoryDriftEvaluator(model_route_resolver=model_route_resolver)
    run = RunModel(
        id="run-1",
        thread_id="thread-1",
        status="completed",
        request_message_text="hello",
        request_message_role="user",
        resolved_model_id="gpt-4.1",
        enabled_tools_json=[],
        resolved_tool_ids_json=None,
        applied_thinking_json=None,
        requested_thinking_json=None,
        thinking_capability_override_json=None,
        selected_model_route_json={
            "providerProfileId": "provider-1",
            "routeRef": {
                "routeKind": "provider-model",
                "profileId": "provider-1",
                "modelId": "gpt-4.1",
            },
        },
    )
    result = evaluator.evaluate(run=run, bound_agent_id="default")
    assert result["status"] == _MODEL_UNAVAILABLE_CODE
    assert len(result["warnings"]) == 1
    assert result["warnings"][0]["code"] == _MODEL_UNAVAILABLE_CODE
    assert result["requiresExplicitRebind"] is True


def test_model_unavailable_warning_on_provider_secret_missing() -> None:
    for code in (
        "provider_secret_missing",
        "provider_base_url_missing",
        "provider_catalog_entry_not_found",
        "provider_profile_legacy",
        "provider_profile_unsupported",
        "provider_runtime_catalog_only",
        "provider_runtime_legacy_unsupported",
        "provider_catalog_revision_mismatch",
    ):
        error = RuntimeModelRouteResolutionError(code=code, message="some error")
        model_route_resolver = Mock()
        model_route_resolver.resolve = Mock(side_effect=error)
        evaluator = PersistedHistoryDriftEvaluator(model_route_resolver=model_route_resolver)
        run = RunModel(
            id="run-1",
            thread_id="thread-1",
            status="completed",
            request_message_text="hello",
            request_message_role="user",
            resolved_model_id="gpt-4.1",
            enabled_tools_json=[],
            resolved_tool_ids_json=None,
            applied_thinking_json=None,
            requested_thinking_json=None,
            thinking_capability_override_json=None,
            selected_model_route_json={
                "providerProfileId": "provider-1",
                "routeRef": {
                    "routeKind": "provider-model",
                    "profileId": "provider-1",
                    "modelId": "gpt-4.1",
                },
            },
        )
        result = evaluator.evaluate(run=run, bound_agent_id="default")
        assert result["status"] == _MODEL_UNAVAILABLE_CODE
        assert len(result["warnings"]) == 1
        assert result["warnings"][0]["code"] == _MODEL_UNAVAILABLE_CODE


def test_tool_unregistered_warning() -> None:
    agent_registry = Mock()
    agent_registry.build_agent_toolset_map = Mock(return_value={})
    tool_registry = Mock()
    tool_registry.get_default = Mock()
    tool_registry.get_default.return_value.name = "default"
    catalog = [
        {"toolId": "tool.weather", "availability": "available"},
        {"toolId": "tool.calc", "availability": "deprecated"},
    ]
    tool_registry.build_tool_catalog = Mock(return_value=catalog)
    evaluator = PersistedHistoryDriftEvaluator(
        agent_registry=agent_registry,
        tool_registry=tool_registry,
    )
    run = RunModel(
        id="run-1",
        thread_id="thread-1",
        status="completed",
        request_message_text="hello",
        request_message_role="user",
        resolved_model_id=None,
        enabled_tools_json=[],
        resolved_tool_ids_json=["tool.weather", "tool.missing"],
        applied_thinking_json=None,
        requested_thinking_json=None,
        thinking_capability_override_json=None,
        selected_model_route_json={},
    )
    result = evaluator.evaluate(run=run, bound_agent_id="default")
    assert result["status"] == _TOOL_UNREGISTERED_CODE
    assert len(result["warnings"]) == 1
    assert result["warnings"][0]["code"] == _TOOL_UNREGISTERED_CODE
    assert "tool.missing" in result["warnings"][0]["message"]


def test_all_tools_available_yields_no_warning() -> None:
    agent_registry = Mock()
    agent_registry.build_agent_toolset_map = Mock(return_value={})
    tool_registry = Mock()
    tool_registry.get_default = Mock()
    tool_registry.get_default.return_value.name = "default"
    catalog = [
        {"toolId": "tool.weather", "availability": "available"},
    ]
    tool_registry.build_tool_catalog = Mock(return_value=catalog)
    model_route_resolver = Mock()
    model_route_resolver.resolve = Mock(return_value=_make_resolved_route())
    evaluator = PersistedHistoryDriftEvaluator(
        agent_registry=agent_registry,
        tool_registry=tool_registry,
        model_route_resolver=model_route_resolver,
    )
    run = RunModel(
        id="run-1",
        thread_id="thread-1",
        status="completed",
        request_message_text="hello",
        request_message_role="user",
        resolved_model_id="gpt-4.1",
        enabled_tools_json=[],
        resolved_tool_ids_json=["tool.weather"],
        applied_thinking_json=None,
        requested_thinking_json=None,
        thinking_capability_override_json=None,
        selected_model_route_json={
            "providerProfileId": "provider-1",
            "routeRef": {
                "routeKind": "provider-model",
                "profileId": "provider-1",
                "modelId": "gpt-4.1",
            },
        },
    )
    result = evaluator.evaluate(run=run, bound_agent_id="default")
    assert result["status"] == _NOT_EVALUATED_STATUS
    assert result["warnings"] == []


def test_agent_toolset_fallback_to_default() -> None:
    agent_registry = Mock()
    agent_registry.build_agent_toolset_map = Mock(return_value={"other-agent": "custom"})
    tool_registry = Mock()
    tool_registry.get_default = Mock()
    tool_registry.get_default.return_value.name = "default"
    catalog = [
        {"toolId": "tool.fs.read", "availability": "available"},
    ]
    tool_registry.build_tool_catalog = Mock(return_value=catalog)
    evaluator = PersistedHistoryDriftEvaluator(
        agent_registry=agent_registry,
        tool_registry=tool_registry,
    )
    run = RunModel(
        id="run-1",
        thread_id="thread-1",
        status="completed",
        request_message_text="hello",
        request_message_role="user",
        resolved_model_id=None,
        enabled_tools_json=[],
        resolved_tool_ids_json=["tool.fs.read"],
        applied_thinking_json=None,
        requested_thinking_json=None,
        thinking_capability_override_json=None,
        selected_model_route_json={},
    )
    result = evaluator.evaluate(run=run, bound_agent_id="default")
    assert result["status"] == _NO_DRIFT_STATUS
    assert result["warnings"] == []


def test_tool_catalog_lookup_error_falls_back_to_default() -> None:
    tool_registry = Mock()
    tool_registry.get_default = Mock()
    tool_registry.get_default.return_value.name = "default"

    def build_catalog(toolset_name: str | None = None):
        if toolset_name == "custom":
            raise LookupError("toolset not found")
        return [{"toolId": "tool.default", "availability": "available"}]

    tool_registry.build_tool_catalog = Mock(side_effect=build_catalog)
    agent_registry = Mock()
    agent_registry.build_agent_toolset_map = Mock(return_value={"default": "custom"})
    evaluator = PersistedHistoryDriftEvaluator(
        agent_registry=agent_registry,
        tool_registry=tool_registry,
    )
    run = RunModel(
        id="run-1",
        thread_id="thread-1",
        status="completed",
        request_message_text="hello",
        request_message_role="user",
        resolved_model_id=None,
        enabled_tools_json=[],
        resolved_tool_ids_json=["tool.default"],
        applied_thinking_json=None,
        requested_thinking_json=None,
        thinking_capability_override_json=None,
        selected_model_route_json={},
    )
    result = evaluator.evaluate(run=run, bound_agent_id="default")
    assert result["status"] == _NO_DRIFT_STATUS


def test_multiple_warnings_generate_multiple_issues_status() -> None:
    error = RuntimeModelRouteResolutionError(code="provider_profile_not_found", message="provider not found")
    model_route_resolver = Mock()
    model_route_resolver.resolve = Mock(side_effect=error)
    agent_registry = Mock()
    agent_registry.build_agent_toolset_map = Mock(return_value={})
    tool_registry = Mock()
    tool_registry.get_default = Mock()
    tool_registry.get_default.return_value.name = "default"
    catalog = [
        {"toolId": "tool.weather", "availability": "available"},
    ]
    tool_registry.build_tool_catalog = Mock(return_value=catalog)
    evaluator = PersistedHistoryDriftEvaluator(
        model_route_resolver=model_route_resolver,
        tool_registry=tool_registry,
        agent_registry=agent_registry,
    )
    run = RunModel(
        id="run-1",
        thread_id="thread-1",
        status="completed",
        request_message_text="hello",
        request_message_role="user",
        resolved_model_id="gpt-4.1",
        enabled_tools_json=[],
        resolved_tool_ids_json=["tool.weather", "tool.missing"],
        applied_thinking_json=None,
        requested_thinking_json=None,
        thinking_capability_override_json=None,
        selected_model_route_json={
            "providerProfileId": "provider-1",
            "routeRef": {
                "routeKind": "provider-model",
                "profileId": "provider-1",
                "modelId": "gpt-4.1",
            },
        },
    )
    result = evaluator.evaluate(run=run, bound_agent_id="default")
    assert result["status"] == _MULTIPLE_ISSUES_STATUS
    assert len(result["warnings"]) == 2


def test_resolve_status_returns_code_for_single_warning() -> None:
    result = _resolve_status(
        warnings=[{"code": "custom_code", "message": "msg"}],
        evaluated_dimensions=1,
        unresolved_dimensions=0,
    )
    assert result == "custom_code"


def test_resolve_status_returns_multiple_issues_for_empty_code() -> None:
    result = _resolve_status(
        warnings=[{"message": "no code"}],
        evaluated_dimensions=1,
        unresolved_dimensions=0,
    )
    assert result == _MULTIPLE_ISSUES_STATUS


def test_resolve_status_no_warnings_unresolved() -> None:
    assert _resolve_status(warnings=[], evaluated_dimensions=0, unresolved_dimensions=1) == _NOT_EVALUATED_STATUS


def test_resolve_status_no_warnings_no_evaluations() -> None:
    assert _resolve_status(warnings=[], evaluated_dimensions=0, unresolved_dimensions=0) == _NO_DRIFT_STATUS


def test_deserialize_runtime_model_route_valid() -> None:
    payload = {
        "providerProfileId": "provider-1",
        "routeRef": {
            "profileId": "provider-1",
            "modelId": "gpt-4.1",
            "routeKind": "provider-model",
        },
        "catalogRevision": "rev-1",
    }
    result = _deserialize_runtime_model_route(payload)
    assert result is not None
    assert result.provider_profile_id == "provider-1"
    assert result.route_ref.model_id == "gpt-4.1"
    assert result.catalog_revision == "rev-1"


def test_deserialize_runtime_model_route_default_route_kind() -> None:
    payload = {
        "providerProfileId": "provider-1",
        "routeRef": {
            "profileId": "provider-1",
            "modelId": "gpt-4.1",
        },
    }
    result = _deserialize_runtime_model_route(payload)
    assert result is not None
    assert result.route_ref.route_kind == "provider-model"


def test_deserialize_runtime_model_route_none_payload() -> None:
    assert _deserialize_runtime_model_route(None) is None
    assert _deserialize_runtime_model_route("not-a-mapping") is None
    assert _deserialize_runtime_model_route([]) is None


def test_deserialize_runtime_model_route_empty_payload() -> None:
    assert _deserialize_runtime_model_route({}) is None
    assert _deserialize_runtime_model_route({"routeRef": None}) is None
    assert _deserialize_runtime_model_route({"routeRef": {}}) is None


def test_deserialize_runtime_model_route_mismatched_profiles() -> None:
    payload = {
        "providerProfileId": "provider-1",
        "routeRef": {
            "profileId": "provider-2",
            "modelId": "gpt-4.1",
        },
    }
    assert _deserialize_runtime_model_route(payload) is None


def test_format_historical_thinking_summary_full() -> None:
    summary = _format_historical_thinking_summary({
        "series": "compat-discrete-selection-v1",
        "mode": "preset",
        "level": "medium",
        "value": {"labelZh": "中等", "budgetTokens": 2048},
    })
    assert summary == "compat-discrete-selection-v1 / 中等 / medium / preset / 2048 tokens"


def test_format_historical_thinking_summary_minimal() -> None:
    summary = _format_historical_thinking_summary({
        "series": "thinking-v1",
    })
    assert summary == "thinking-v1"


def test_format_historical_thinking_summary_fallback_label_to_code() -> None:
    summary = _format_historical_thinking_summary({
        "series": "thinking-v1",
        "level": "high",
        "value": {"code": "high_level", "budgetTokens": 4096},
    })
    assert "high_level" in summary
    assert "4096 tokens" in summary


def test_format_historical_thinking_summary_none() -> None:
    assert _format_historical_thinking_summary(None) is None
    assert _format_historical_thinking_summary("not-a-mapping") is None


def test_normalize_optional_string() -> None:
    assert _normalize_optional_string("  hello  ") == "hello"
    assert _normalize_optional_string("  ") is None
    assert _normalize_optional_string(None) is None
    assert _normalize_optional_string(123) is None


def test_build_warning() -> None:
    result = _build_warning("test_code", "test message")
    assert result == {"code": "test_code", "message": "test message"}


def test_drift_evaluator_with_model_route_resolving_successfully() -> None:
    model_route_resolver = Mock()
    model_route_resolver.resolve = Mock(return_value=_make_resolved_route())
    evaluator = PersistedHistoryDriftEvaluator(model_route_resolver=model_route_resolver)
    run = RunModel(
        id="run-1",
        thread_id="thread-1",
        status="completed",
        request_message_text="hello",
        request_message_role="user",
        resolved_model_id="gpt-4.1",
        enabled_tools_json=[],
        resolved_tool_ids_json=None,
        applied_thinking_json=None,
        requested_thinking_json=None,
        thinking_capability_override_json=None,
        selected_model_route_json={
            "providerProfileId": "provider-1",
            "routeRef": {
                "routeKind": "provider-model",
                "profileId": "provider-1",
                "modelId": "gpt-4.1",
            },
        },
    )
    result = evaluator.evaluate(run=run, bound_agent_id="default")
    assert result["status"] == _NOT_EVALUATED_STATUS
    assert result["warnings"] == []


def test_drift_evaluator_unknown_error_unresolved() -> None:
    model_route_resolver = Mock()
    model_route_resolver.resolve = Mock(side_effect=RuntimeError("unknown"))
    evaluator = PersistedHistoryDriftEvaluator(model_route_resolver=model_route_resolver)
    run = RunModel(
        id="run-1",
        thread_id="thread-1",
        status="completed",
        request_message_text="hello",
        request_message_role="user",
        resolved_model_id=None,
        enabled_tools_json=[],
        resolved_tool_ids_json=None,
        applied_thinking_json=None,
        requested_thinking_json=None,
        thinking_capability_override_json=None,
        selected_model_route_json={
            "providerProfileId": "provider-1",
            "routeRef": {
                "routeKind": "provider-model",
                "profileId": "provider-1",
                "modelId": "gpt-4.1",
            },
        },
    )
    result = evaluator.evaluate(run=run, bound_agent_id="default")
    assert result["status"] == _NOT_EVALUATED_STATUS
    assert result["warnings"] == []


def _make_resolved_route():
    from app.copilot_runtime.model_routes import ResolvedRuntimeModelRoute
    return ResolvedRuntimeModelRoute(
        provider_profile_id="provider-1",
        provider="openai",
        provider_id="openai",
        endpoint_type="openai-compatible",
        base_url="https://api.openai.com/v1",
        model_id="gpt-4.1",
        api_key="sk-test",
        route_ref=RuntimeModelRouteRef(
            route_kind="provider-model",
            profile_id="provider-1",
            model_id="gpt-4.1",
        ),
        catalog_revision="",
    )

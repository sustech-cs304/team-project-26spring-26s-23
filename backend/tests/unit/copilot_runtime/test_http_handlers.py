"""Unit tests for copilot_runtime HTTP handler functions."""

from __future__ import annotations

from datetime import datetime, UTC
from unittest.mock import ANY, AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.testclient import TestClient

from app.copilot_runtime.contracts import (
    AGENTS_LIST_METHOD,
    CAPABILITIES_GET_METHOD,
    GLOBAL_TOOL_CATALOG_GET_METHOD,
    RUN_CANCEL_METHOD,
    RUN_START_METHOD,
    RUN_STREAM_METHOD,
    THINKING_CAPABILITY_GET_METHOD,
    THREAD_CREATE_METHOD,
    THREAD_GET_METHOD,
    TOOL_APPROVAL_RESOLVE_METHOD,
    RuntimeScaffold,
    build_runtime_scaffold,
)
from app.copilot_runtime.bridge import (
    AgentNotFoundError,
    RunNotFoundError,
    SessionNotFoundError,
    ThreadNotFoundError,
)
from app.copilot_runtime.tool_approval_coordinator import (
    ToolApprovalConflictError,
    ToolApprovalNotFoundError,
)
from app.copilot_runtime.model_routes import RuntimeModelRouteResolutionError
from app.copilot_runtime.provider_adapter_registry import RuntimeProviderAdapterError
from app.copilot_runtime.protocol import RuntimeProtocolError, RuntimeProtocolParser
from app.copilot_runtime.model_routes import RuntimeModelRouteRef
from app.copilot_runtime.session_store import (
    RuntimeRunRecord,
    RuntimeStoredModelRoute,
    RuntimeStoredRunInput,
    RuntimeStoredRunPolicy,
)
from app.copilot_runtime._session_store.records import RuntimeThreadRecord
from app.copilot_runtime.shared.dependencies import (
    RuntimeTransportDependencies,
)
from app.copilot_runtime.shared.errors import (
    agent_execution_failed_response,
    agent_not_found_response,
    method_not_implemented_response,
    protocol_error_response,
    run_not_found_response,
    runtime_operation_conflict_response,
    session_not_found_response,
    thread_not_found_response,
    tool_approval_not_found_response,
)
from app.copilot_runtime.transport.http_handlers import (
    _handle_capabilities_get_request,
    _handle_global_tool_catalog_get_request,
    _handle_run_cancel_request,
    _handle_run_start_request,
    _handle_run_stream_request,
    _handle_thinking_capability_get_request,
    _handle_thread_create_request,
    _handle_thread_get_request,
    _handle_tool_approval_resolve_request,
    _write_transport_event,
    build_router,
)
from app.copilot_runtime.transport.request_mappers import (
    read_runtime_payload,
)
from app.copilot_runtime.transport.response_mappers import (
    stream_runtime_run_events,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_scaffold() -> MagicMock:
    scaffold = MagicMock(spec=RuntimeScaffold)
    scaffold.stage = "unit-test"
    scaffold.protocol = "copilot-runtime-v1"
    scaffold.session_store_type = "in-memory"
    scaffold.default_agent = "default"
    scaffold.model_configured = True
    scaffold.model_environment_keys = ()
    scaffold.transport = {"root_path": "/"}
    scaffold.supported_methods = (
        AGENTS_LIST_METHOD,
        THREAD_CREATE_METHOD,
        THREAD_GET_METHOD,
        RUN_START_METHOD,
        RUN_STREAM_METHOD,
        RUN_CANCEL_METHOD,
        CAPABILITIES_GET_METHOD,
        GLOBAL_TOOL_CATALOG_GET_METHOD,
        THINKING_CAPABILITY_GET_METHOD,
        TOOL_APPROVAL_RESOLVE_METHOD,
    )

    def _mock_response(content: dict) -> MagicMock:
        resp = MagicMock()
        resp.to_dict.return_value = content
        return resp

    scaffold.build_agents_list_response.return_value = _mock_response(
        {"ok": True, "agents": []}
    )
    scaffold.build_thread_create_response.return_value = _mock_response(
        {"ok": True, "threadId": "thread-test"}
    )
    scaffold.build_thread_get_response.return_value = _mock_response(
        {"ok": True, "threadId": "thread-test"}
    )
    scaffold.build_run_start_response.return_value = _mock_response(
        {"ok": True, "run": {"runId": "run-test"}}
    )
    scaffold.build_run_cancel_response.return_value = _mock_response(
        {"ok": True, "cancelAccepted": True}
    )
    scaffold.build_tool_approval_resolve_response.return_value = _mock_response(
        {"ok": True, "status": "approved"}
    )
    scaffold.build_global_tool_catalog_response.return_value = _mock_response(
        {"ok": True, "tools": []}
    )
    scaffold.build_thinking_capability_response.return_value = _mock_response(
        {"ok": True, "capability": {}}
    )
    return scaffold


@pytest.fixture
def mock_bridge() -> MagicMock:
    return MagicMock()


@pytest.fixture
def mock_parser() -> MagicMock:
    return MagicMock(spec=RuntimeProtocolParser)


@pytest.fixture
def mock_dependencies(mock_scaffold, mock_bridge, mock_parser) -> RuntimeTransportDependencies:
    return RuntimeTransportDependencies(
        scaffold=mock_scaffold,
        runtime_bridge=mock_bridge,
        parser=mock_parser,
    )


@pytest.fixture
def thread_record() -> RuntimeThreadRecord:
    return RuntimeThreadRecord(
        thread_id="thread-test",
        bound_agent_id="default",
        created_at=datetime(2025, 1, 1, tzinfo=UTC),
        updated_at=datetime(2025, 1, 1, tzinfo=UTC),
    )


@pytest.fixture
def route_ref() -> RuntimeModelRouteRef:
    return RuntimeModelRouteRef(
        route_kind="provider-model",
        profile_id="openai",
        model_id="gpt-4",
    )


@pytest.fixture
def run_record(route_ref) -> RuntimeRunRecord:
    return RuntimeRunRecord(
        run_id="run-test",
        thread_id="thread-test",
        request=RuntimeStoredRunInput(
            message_role="user",
            message_content="hello",
            agent_id=None,
            policy=RuntimeStoredRunPolicy(
                model_route=RuntimeStoredModelRoute(
                    provider_profile_id="openai",
                    route_ref=route_ref,
                ),
            ),
        ),
        status="streaming",
    )


# ---------------------------------------------------------------------------
# Tests for build_router
# ---------------------------------------------------------------------------

def test_build_router_returns_router_with_one_route(mock_scaffold, mock_bridge):
    with patch(
        "app.copilot_runtime.transport.http_handlers.build_runtime_transport_dependencies",
        return_value=MagicMock(spec=RuntimeTransportDependencies),
    ):
        router = build_router(mock_scaffold, mock_bridge)

    assert len(router.routes) == 1
    route = router.routes[0]
    assert route.path == "/"
    assert "POST" in route.methods


def test_build_router_includes_route_in_fastapi_app(mock_scaffold, mock_bridge):
    with patch(
        "app.copilot_runtime.transport.http_handlers.build_runtime_transport_dependencies",
        return_value=MagicMock(spec=RuntimeTransportDependencies),
    ):
        router = build_router(mock_scaffold, mock_bridge)

    app = FastAPI()
    app.include_router(router)
    routes = [r for r in app.routes if hasattr(r, "methods") and "POST" in r.methods]
    assert len(routes) == 1


# ---------------------------------------------------------------------------
# Tests for handle_runtime_root (via router integration)
# ---------------------------------------------------------------------------

class TestHandleRuntimeRoot:
    def test_dispatches_agents_list_method(self, mock_scaffold, mock_bridge, mock_parser):
        mock_parser.read_payload = AsyncMock(return_value={"method": "agents/list"})
        mock_parser.extract_method.return_value = AGENTS_LIST_METHOD

        deps = RuntimeTransportDependencies(
            scaffold=mock_scaffold,
            runtime_bridge=mock_bridge,
            parser=mock_parser,
        )

        with patch(
            "app.copilot_runtime.transport.http_handlers.build_runtime_transport_dependencies",
            return_value=deps,
        ):
            router = build_router(mock_scaffold, mock_bridge)

        app = FastAPI()
        app.include_router(router)

        with TestClient(app) as client:
            response = client.post("/", json={"method": "agents/list"})

        assert response.status_code == 200
        assert response.json() == {"ok": True, "agents": []}

    def test_dispatches_unknown_method_to_not_implemented(self, mock_scaffold, mock_bridge, mock_parser):
        mock_parser.read_payload = AsyncMock(return_value={"method": "unknown/method"})
        mock_parser.extract_method.return_value = "unknown/method"

        deps = RuntimeTransportDependencies(
            scaffold=mock_scaffold,
            runtime_bridge=mock_bridge,
            parser=mock_parser,
        )

        with patch(
            "app.copilot_runtime.transport.http_handlers.build_runtime_transport_dependencies",
            return_value=deps,
        ):
            router = build_router(mock_scaffold, mock_bridge)

        app = FastAPI()
        app.include_router(router)

        with TestClient(app) as client:
            response = client.post("/", json={"method": "unknown/method"})

        assert response.status_code == 501
        payload = response.json()
        assert payload["ok"] is False
        assert payload["error"]["code"] == "method_not_implemented"

    def test_dispatches_payload_read_error_to_protocol_error(self, mock_scaffold, mock_bridge, mock_parser):
        async def _read_payload_raises(*args, **kwargs):
            from app.copilot_runtime.errors import build_invalid_request_error
            raise RuntimeProtocolError(
                status_code=400,
                error=build_invalid_request_error(
                    message="bad payload",
                    scaffold=mock_scaffold,
                ),
            )

        mock_parser.read_payload = AsyncMock(side_effect=_read_payload_raises)

        deps = RuntimeTransportDependencies(
            scaffold=mock_scaffold,
            runtime_bridge=mock_bridge,
            parser=mock_parser,
        )

        with patch(
            "app.copilot_runtime.transport.http_handlers.build_runtime_transport_dependencies",
            return_value=deps,
        ):
            router = build_router(mock_scaffold, mock_bridge)

        app = FastAPI()
        app.include_router(router)

        with TestClient(app) as client:
            response = client.post("/", json={"method": "whatever"})

        assert response.status_code == 400
        payload = response.json()
        assert payload["ok"] is False
        assert payload["error"]["code"] == "invalid_request"


# ---------------------------------------------------------------------------
# Tests for _handle_thread_create_request
# ---------------------------------------------------------------------------

class TestHandleThreadCreateRequest:
    def test_happy_path(self, mock_dependencies, mock_parser, mock_bridge, thread_record):
        mock_request = MagicMock()
        mock_request.agent_id = "default"
        mock_parser.extract_thread_create_request.return_value = mock_request
        mock_bridge.create_thread.return_value = thread_record

        response = _handle_thread_create_request(
            dependencies=mock_dependencies,
            payload={"method": "thread/create", "body": {"agentId": "default"}},
        )

        assert isinstance(response, JSONResponse)
        body = response.body
        import json
        data = json.loads(body)
        assert data["ok"] is True

    def test_protocol_error_path(self, mock_dependencies, mock_parser):
        from app.copilot_runtime.errors import build_invalid_request_error
        mock_parser.extract_thread_create_request.side_effect = RuntimeProtocolError(
            status_code=400,
            error=build_invalid_request_error(
                message="missing agentId",
                scaffold=mock_dependencies.scaffold,
            ),
        )

        response = _handle_thread_create_request(
            dependencies=mock_dependencies,
            payload=None,
        )

        assert response.status_code == 400

    def test_agent_not_found_path(self, mock_dependencies, mock_parser):
        mock_parser.extract_thread_create_request.side_effect = AgentNotFoundError(
            agent_name="unknown-agent"
        )

        response = _handle_thread_create_request(
            dependencies=mock_dependencies,
            payload={"method": "thread/create", "body": {"agentId": "unknown-agent"}},
        )

        assert response.status_code == 404


# ---------------------------------------------------------------------------
# Tests for _handle_thread_get_request
# ---------------------------------------------------------------------------

class TestHandleThreadGetRequest:
    def test_happy_path(self, mock_dependencies, mock_parser, mock_bridge, thread_record):
        mock_request = MagicMock()
        mock_request.thread_id = "thread-test"
        mock_parser.extract_thread_get_request.return_value = mock_request
        mock_bridge.get_thread.return_value = thread_record

        response = _handle_thread_get_request(
            dependencies=mock_dependencies,
            payload={"method": "thread/get", "body": {"threadId": "thread-test"}},
        )

        assert isinstance(response, JSONResponse)
        import json
        data = json.loads(response.body)
        assert data["ok"] is True

    def test_thread_not_found_error_path(self, mock_dependencies, mock_parser, mock_bridge):
        mock_request = MagicMock()
        mock_request.thread_id = "missing-thread"
        mock_parser.extract_thread_get_request.return_value = mock_request
        mock_bridge.get_thread.side_effect = ThreadNotFoundError("missing-thread")

        response = _handle_thread_get_request(
            dependencies=mock_dependencies,
            payload={"method": "thread/get", "body": {"threadId": "missing-thread"}},
        )

        assert response.status_code == 404
        import json
        data = json.loads(response.body)
        assert data["error"]["code"] == "thread_not_found"

    def test_agent_not_found_error_path(self, mock_dependencies, mock_parser, mock_bridge):
        mock_request = MagicMock()
        mock_request.thread_id = "thread-test"
        mock_parser.extract_thread_get_request.return_value = mock_request
        mock_bridge.get_thread.side_effect = AgentNotFoundError(
            agent_name="unknown-agent"
        )

        response = _handle_thread_get_request(
            dependencies=mock_dependencies,
            payload={"method": "thread/get", "body": {"threadId": "thread-test"}},
        )

        assert response.status_code == 404
        import json
        data = json.loads(response.body)
        assert data["error"]["code"] == "agent_not_found"

    def test_protocol_error_path(self, mock_dependencies, mock_parser):
        from app.copilot_runtime.errors import build_invalid_request_error
        mock_parser.extract_thread_get_request.side_effect = RuntimeProtocolError(
            status_code=400,
            error=build_invalid_request_error(
                message="missing threadId",
                scaffold=mock_dependencies.scaffold,
            ),
        )

        response = _handle_thread_get_request(
            dependencies=mock_dependencies,
            payload=None,
        )

        assert response.status_code == 400


# ---------------------------------------------------------------------------
# Tests for _handle_run_cancel_request
# ---------------------------------------------------------------------------

class TestHandleRunCancelRequest:
    def test_happy_path_cancel_accepted(self, mock_dependencies, mock_parser, mock_bridge, run_record):
        mock_request = MagicMock()
        mock_request.run_id = "run-test"
        mock_parser.extract_run_cancel_request.return_value = mock_request
        mock_bridge.cancel_run.return_value = (run_record, True)

        response = _handle_run_cancel_request(
            dependencies=mock_dependencies,
            payload={"method": "run/cancel", "body": {"runId": "run-test"}},
        )

        assert isinstance(response, JSONResponse)
        import json
        data = json.loads(response.body)
        assert data["ok"] is True
        assert data["cancelAccepted"] is True

    def test_cancel_rejected(self, mock_dependencies, mock_parser, mock_bridge, run_record):
        run_record.status = "completed"
        mock_request = MagicMock()
        mock_request.run_id = "run-test"
        mock_parser.extract_run_cancel_request.return_value = mock_request
        mock_bridge.cancel_run.return_value = (run_record, False)
        mock_dependencies.scaffold.build_run_cancel_response.return_value = MagicMock(
            to_dict=MagicMock(return_value={"ok": True, "cancelAccepted": False})
        )

        response = _handle_run_cancel_request(
            dependencies=mock_dependencies,
            payload={"method": "run/cancel", "body": {"runId": "run-test"}},
        )

        import json
        data = json.loads(response.body)
        assert data["ok"] is True
        assert data["cancelAccepted"] is False

    def test_run_not_found_error(self, mock_dependencies, mock_parser, mock_bridge):
        mock_request = MagicMock()
        mock_request.run_id = "missing-run"
        mock_parser.extract_run_cancel_request.return_value = mock_request
        mock_bridge.cancel_run.side_effect = RunNotFoundError("missing-run")

        response = _handle_run_cancel_request(
            dependencies=mock_dependencies,
            payload={"method": "run/cancel", "body": {"runId": "missing-run"}},
        )

        assert response.status_code == 404
        import json
        data = json.loads(response.body)
        assert data["error"]["code"] == "run_not_found"
        assert data["error"]["details"] == {"runId": "missing-run"}

    def test_protocol_error_path(self, mock_dependencies, mock_parser):
        from app.copilot_runtime.errors import build_invalid_request_error
        mock_parser.extract_run_cancel_request.side_effect = RuntimeProtocolError(
            status_code=400,
            error=build_invalid_request_error(
                message="missing runId",
                scaffold=mock_dependencies.scaffold,
            ),
        )

        response = _handle_run_cancel_request(
            dependencies=mock_dependencies,
            payload=None,
        )

        assert response.status_code == 400


# ---------------------------------------------------------------------------
# Tests for _handle_tool_approval_resolve_request
# ---------------------------------------------------------------------------

class TestHandleToolApprovalResolveRequest:
    def test_happy_path_approved(self, mock_dependencies, mock_parser, mock_bridge):
        mock_request = MagicMock()
        mock_request.run_id = "run-test"
        mock_request.tool_call_id = "call-1"
        mock_request.decision = "approved"
        mock_parser.extract_tool_approval_resolve_request.return_value = mock_request

        mock_response = MagicMock()
        mock_response.to_dict.return_value = {
            "ok": True,
            "runId": "run-test",
            "toolCallId": "call-1",
            "decision": "approved",
            "status": "approved",
        }
        mock_bridge.resolve_tool_approval.return_value = mock_response

        response = _handle_tool_approval_resolve_request(
            dependencies=mock_dependencies,
            payload={
                "method": "tool-approval/resolve",
                "body": {"runId": "run-test", "toolCallId": "call-1", "decision": "approved"},
            },
        )

        assert isinstance(response, JSONResponse)
        import json
        data = json.loads(response.body)
        assert data["ok"] is True
        assert data["status"] == "approved"

    def test_rejected_decision(self, mock_dependencies, mock_parser, mock_bridge):
        mock_request = MagicMock()
        mock_request.run_id = "run-test"
        mock_request.tool_call_id = "call-2"
        mock_request.decision = "rejected"
        mock_parser.extract_tool_approval_resolve_request.return_value = mock_request

        mock_response = MagicMock()
        mock_response.to_dict.return_value = {
            "ok": True,
            "runId": "run-test",
            "toolCallId": "call-2",
            "decision": "rejected",
            "status": "rejected",
        }
        mock_bridge.resolve_tool_approval.return_value = mock_response

        response = _handle_tool_approval_resolve_request(
            dependencies=mock_dependencies,
            payload={
                "method": "tool-approval/resolve",
                "body": {"runId": "run-test", "toolCallId": "call-2", "decision": "rejected"},
            },
        )

        import json
        data = json.loads(response.body)
        assert data["ok"] is True
        assert data["status"] == "rejected"

    def test_approval_not_found_error(self, mock_dependencies, mock_parser, mock_bridge):
        mock_request = MagicMock()
        mock_request.run_id = "run-test"
        mock_request.tool_call_id = "missing-call"
        mock_request.decision = "approved"
        mock_parser.extract_tool_approval_resolve_request.return_value = mock_request
        mock_bridge.resolve_tool_approval.side_effect = ToolApprovalNotFoundError(
            run_id="run-test",
            tool_call_id="missing-call",
        )

        response = _handle_tool_approval_resolve_request(
            dependencies=mock_dependencies,
            payload={
                "method": "tool-approval/resolve",
                "body": {"runId": "run-test", "toolCallId": "missing-call", "decision": "approved"},
            },
        )

        assert response.status_code == 404
        import json
        data = json.loads(response.body)
        assert data["error"]["code"] == "tool_approval_not_found"

    def test_approval_conflict_error(self, mock_dependencies, mock_parser, mock_bridge):
        mock_request = MagicMock()
        mock_request.run_id = "run-test"
        mock_request.tool_call_id = "call-3"
        mock_request.decision = "approved"
        mock_parser.extract_tool_approval_resolve_request.return_value = mock_request
        mock_bridge.resolve_tool_approval.side_effect = ToolApprovalConflictError(
            run_id="run-test",
            tool_call_id="call-3",
            status="approved",
        )

        response = _handle_tool_approval_resolve_request(
            dependencies=mock_dependencies,
            payload={
                "method": "tool-approval/resolve",
                "body": {"runId": "run-test", "toolCallId": "call-3", "decision": "approved"},
            },
        )

        assert response.status_code == 409
        import json
        data = json.loads(response.body)
        assert data["error"]["code"] == "tool_approval_conflict"

    def test_protocol_error_path(self, mock_dependencies, mock_parser):
        from app.copilot_runtime.errors import build_invalid_request_error
        mock_parser.extract_tool_approval_resolve_request.side_effect = RuntimeProtocolError(
            status_code=400,
            error=build_invalid_request_error(
                message="missing runId",
                scaffold=mock_dependencies.scaffold,
            ),
        )

        response = _handle_tool_approval_resolve_request(
            dependencies=mock_dependencies,
            payload=None,
        )

        assert response.status_code == 400


# ---------------------------------------------------------------------------
# Tests for _handle_capabilities_get_request
# ---------------------------------------------------------------------------

class TestHandleCapabilitiesGetRequest:
    def test_happy_path(self, mock_dependencies, mock_parser, mock_bridge):
        mock_request = MagicMock()
        mock_request.session_id = "session-test"
        mock_request.tool_permission_policy = None
        mock_parser.extract_capabilities_get_request.return_value = mock_request

        mock_capabilities = MagicMock()
        mock_capabilities.to_dict.return_value = {
            "ok": True,
            "sessionId": "session-test",
            "tools": [],
        }
        mock_bridge.get_capabilities.return_value = mock_capabilities

        response = _handle_capabilities_get_request(
            dependencies=mock_dependencies,
            payload={"method": "capabilities/get", "body": {"sessionId": "session-test"}},
        )

        assert isinstance(response, JSONResponse)
        import json
        data = json.loads(response.body)
        assert data["ok"] is True

    def test_session_not_found_error(self, mock_dependencies, mock_parser, mock_bridge):
        mock_request = MagicMock()
        mock_request.session_id = "missing-session"
        mock_request.tool_permission_policy = None
        mock_parser.extract_capabilities_get_request.return_value = mock_request
        mock_bridge.get_capabilities.side_effect = SessionNotFoundError(
            "missing-session"
        )

        response = _handle_capabilities_get_request(
            dependencies=mock_dependencies,
            payload={"method": "capabilities/get", "body": {"sessionId": "missing-session"}},
        )

        assert response.status_code == 404
        import json
        data = json.loads(response.body)
        assert data["error"]["code"] == "session_not_found"

    def test_agent_not_found_error(self, mock_dependencies, mock_parser, mock_bridge):
        mock_request = MagicMock()
        mock_request.session_id = "session-test"
        mock_request.tool_permission_policy = None
        mock_parser.extract_capabilities_get_request.return_value = mock_request
        mock_bridge.get_capabilities.side_effect = AgentNotFoundError(
            agent_name="unknown-agent"
        )

        response = _handle_capabilities_get_request(
            dependencies=mock_dependencies,
            payload={"method": "capabilities/get", "body": {"sessionId": "session-test"}},
        )

        assert response.status_code == 404
        import json
        data = json.loads(response.body)
        assert data["error"]["code"] == "agent_not_found"

    def test_protocol_error_path(self, mock_dependencies, mock_parser):
        from app.copilot_runtime.errors import build_invalid_request_error
        mock_parser.extract_capabilities_get_request.side_effect = RuntimeProtocolError(
            status_code=400,
            error=build_invalid_request_error(
                message="missing sessionId",
                scaffold=mock_dependencies.scaffold,
            ),
        )

        response = _handle_capabilities_get_request(
            dependencies=mock_dependencies,
            payload=None,
        )

        assert response.status_code == 400


# ---------------------------------------------------------------------------
# Tests for _handle_global_tool_catalog_get_request
# ---------------------------------------------------------------------------

class TestHandleGlobalToolCatalogGetRequest:
    def test_happy_path_no_language(self, mock_dependencies, mock_parser):
        mock_parser.extract_global_tool_catalog_get_request.return_value = None

        response = _handle_global_tool_catalog_get_request(
            dependencies=mock_dependencies,
            payload={"method": "tools/catalog/get", "body": {}},
        )

        assert isinstance(response, JSONResponse)
        import json
        data = json.loads(response.body)
        assert data["ok"] is True
        assert "tools" in data

    def test_happy_path_with_language(self, mock_dependencies, mock_parser):
        mock_parser.extract_global_tool_catalog_get_request.return_value = "zh-CN"

        response = _handle_global_tool_catalog_get_request(
            dependencies=mock_dependencies,
            payload={"method": "tools/catalog/get", "body": {"language": "zh-CN"}},
        )

        assert isinstance(response, JSONResponse)
        import json
        data = json.loads(response.body)
        assert data["ok"] is True

    def test_happy_path_default_payload_none(self, mock_dependencies, mock_parser):
        mock_parser.extract_global_tool_catalog_get_request.return_value = None

        response = _handle_global_tool_catalog_get_request(
            dependencies=mock_dependencies,
            payload=None,
        )

        assert isinstance(response, JSONResponse)
        import json
        data = json.loads(response.body)
        assert data["ok"] is True

    def test_protocol_error_path(self, mock_dependencies, mock_parser):
        from app.copilot_runtime.errors import build_invalid_request_error
        mock_parser.extract_global_tool_catalog_get_request.side_effect = RuntimeProtocolError(
            status_code=400,
            error=build_invalid_request_error(
                message="language must be a non-empty string",
                scaffold=mock_dependencies.scaffold,
            ),
        )

        response = _handle_global_tool_catalog_get_request(
            dependencies=mock_dependencies,
            payload={"method": "tools/catalog/get", "body": {"language": ""}},
        )

        assert response.status_code == 400


# ---------------------------------------------------------------------------
# Tests for _handle_thinking_capability_get_request
# ---------------------------------------------------------------------------

class TestHandleThinkingCapabilityGetRequest:
    @pytest.mark.asyncio
    async def test_happy_path(self, mock_dependencies, mock_parser, mock_bridge):
        mock_request = MagicMock()
        mock_request.session_id = "session-test"
        mock_request.model_route = MagicMock()
        mock_request.thinking_capability_override = None
        mock_parser.extract_thinking_capability_get_request.return_value = mock_request

        mock_capability = MagicMock()
        mock_capability.to_dict.return_value = {
            "ok": True,
            "sessionId": "session-test",
            "capability": {},
        }
        mock_bridge.get_thinking_capability = AsyncMock(
            return_value=mock_capability
        )

        response = await _handle_thinking_capability_get_request(
            dependencies=mock_dependencies,
            payload={
                "method": "thinking/capability/get",
                "body": {
                    "sessionId": "session-test",
                    "modelRoute": {
                        "routeRef": {
                            "routeKind": "provider-model",
                            "profileId": "openai",
                            "modelId": "gpt-4",
                        }
                    },
                },
            },
        )

        assert isinstance(response, JSONResponse)
        import json
        data = json.loads(response.body)
        assert data["ok"] is True

    @pytest.mark.asyncio
    async def test_session_not_found_error(self, mock_dependencies, mock_parser, mock_bridge):
        mock_request = MagicMock()
        mock_request.session_id = "missing-session"
        mock_request.model_route = MagicMock()
        mock_request.thinking_capability_override = None
        mock_parser.extract_thinking_capability_get_request.return_value = mock_request
        mock_bridge.get_thinking_capability = AsyncMock(
            side_effect=SessionNotFoundError("missing-session")
        )

        response = await _handle_thinking_capability_get_request(
            dependencies=mock_dependencies,
            payload={
                "method": "thinking/capability/get",
                "body": {
                    "sessionId": "missing-session",
                    "modelRoute": {
                        "routeRef": {
                            "routeKind": "provider-model",
                            "profileId": "openai",
                            "modelId": "gpt-4",
                        }
                    },
                },
            },
        )

        assert response.status_code == 404
        import json
        data = json.loads(response.body)
        assert data["error"]["code"] == "session_not_found"

    @pytest.mark.asyncio
    async def test_agent_not_found_error(self, mock_dependencies, mock_parser, mock_bridge):
        mock_request = MagicMock()
        mock_request.session_id = "session-test"
        mock_request.model_route = MagicMock()
        mock_request.thinking_capability_override = None
        mock_parser.extract_thinking_capability_get_request.return_value = mock_request
        mock_bridge.get_thinking_capability = AsyncMock(
            side_effect=AgentNotFoundError(agent_name="unknown-agent")
        )

        response = await _handle_thinking_capability_get_request(
            dependencies=mock_dependencies,
            payload={
                "method": "thinking/capability/get",
                "body": {
                    "sessionId": "session-test",
                    "modelRoute": {
                        "routeRef": {
                            "routeKind": "provider-model",
                            "profileId": "openai",
                            "modelId": "gpt-4",
                        }
                    },
                },
            },
        )

        assert response.status_code == 404
        import json
        data = json.loads(response.body)
        assert data["error"]["code"] == "agent_not_found"

    @pytest.mark.asyncio
    async def test_model_route_resolution_error(self, mock_dependencies, mock_parser, mock_bridge):
        mock_request = MagicMock()
        mock_request.session_id = "session-test"
        mock_request.model_route = MagicMock()
        mock_request.thinking_capability_override = None
        mock_parser.extract_thinking_capability_get_request.return_value = mock_request
        mock_bridge.get_thinking_capability = AsyncMock(
            side_effect=RuntimeModelRouteResolutionError(
                code="model_not_found",
                message="Model not found",
                details={"modelId": "unknown"},
            )
        )

        response = await _handle_thinking_capability_get_request(
            dependencies=mock_dependencies,
            payload={
                "method": "thinking/capability/get",
                "body": {
                    "sessionId": "session-test",
                    "modelRoute": {
                        "routeRef": {
                            "routeKind": "provider-model",
                            "profileId": "openai",
                            "modelId": "unknown",
                        }
                    },
                },
            },
        )

        assert response.status_code == 409
        import json
        data = json.loads(response.body)
        assert data["error"]["code"] == "model_not_found"

    @pytest.mark.asyncio
    async def test_provider_adapter_error(self, mock_dependencies, mock_parser, mock_bridge):
        mock_request = MagicMock()
        mock_request.session_id = "session-test"
        mock_request.model_route = MagicMock()
        mock_request.thinking_capability_override = None
        mock_parser.extract_thinking_capability_get_request.return_value = mock_request
        mock_bridge.get_thinking_capability = AsyncMock(
            side_effect=RuntimeProviderAdapterError(
                code="adapter_error",
                message="Adapter failed",
                details={"provider": "unknown"},
            )
        )

        response = await _handle_thinking_capability_get_request(
            dependencies=mock_dependencies,
            payload={
                "method": "thinking/capability/get",
                "body": {
                    "sessionId": "session-test",
                    "modelRoute": {
                        "routeRef": {
                            "routeKind": "provider-model",
                            "profileId": "openai",
                            "modelId": "gpt-4",
                        }
                    },
                },
            },
        )

        assert response.status_code == 409
        import json
        data = json.loads(response.body)
        assert data["error"]["code"] == "adapter_error"

    @pytest.mark.asyncio
    async def test_runtime_error_path(self, mock_dependencies, mock_parser, mock_bridge):
        mock_request = MagicMock()
        mock_request.session_id = "session-test"
        mock_request.model_route = MagicMock()
        mock_request.thinking_capability_override = None
        mock_parser.extract_thinking_capability_get_request.return_value = mock_request
        mock_bridge.get_thinking_capability = AsyncMock(
            side_effect=RuntimeError("Unexpected failure")
        )

        response = await _handle_thinking_capability_get_request(
            dependencies=mock_dependencies,
            payload={
                "method": "thinking/capability/get",
                "body": {
                    "sessionId": "session-test",
                    "modelRoute": {
                        "routeRef": {
                            "routeKind": "provider-model",
                            "profileId": "openai",
                            "modelId": "gpt-4",
                        }
                    },
                },
            },
        )

        assert response.status_code == 500
        import json
        data = json.loads(response.body)
        assert data["error"]["code"] == "agent_execution_failed"

    @pytest.mark.asyncio
    async def test_protocol_error_path(self, mock_dependencies, mock_parser):
        from app.copilot_runtime.errors import build_invalid_request_error
        mock_parser.extract_thinking_capability_get_request.side_effect = RuntimeProtocolError(
            status_code=400,
            error=build_invalid_request_error(
                message="missing sessionId",
                scaffold=mock_dependencies.scaffold,
            ),
        )

        response = await _handle_thinking_capability_get_request(
            dependencies=mock_dependencies,
            payload=None,
        )

        assert response.status_code == 400


# ---------------------------------------------------------------------------
# Tests for _handle_run_stream_request
# ---------------------------------------------------------------------------

class TestHandleRunStreamRequest:
    @pytest.mark.asyncio
    async def test_happy_path(self, mock_dependencies, mock_parser, mock_bridge):
        mock_request = MagicMock()
        mock_request.run_id = "run-test"
        mock_parser.extract_run_stream_request.return_value = mock_request

        mock_events = MagicMock()
        mock_bridge.stream_run.return_value = mock_events

        mock_http_request = MagicMock()

        with patch(
            "app.copilot_runtime.transport.http_handlers.stream_runtime_run_events",
            return_value=StreamingResponse(content=iter([]), media_type="text/event-stream"),
        ):
            response = await _handle_run_stream_request(
                dependencies=mock_dependencies,
                payload={"method": "run/stream", "body": {"runId": "run-test"}},
                http_request=mock_http_request,
            )

        assert isinstance(response, StreamingResponse)

    @pytest.mark.asyncio
    async def test_run_not_found_error(self, mock_dependencies, mock_parser, mock_bridge):
        mock_request = MagicMock()
        mock_request.run_id = "missing-run"
        mock_parser.extract_run_stream_request.return_value = mock_request
        mock_bridge.stream_run.side_effect = RunNotFoundError("missing-run")

        mock_http_request = MagicMock()

        response = await _handle_run_stream_request(
            dependencies=mock_dependencies,
            payload={"method": "run/stream", "body": {"runId": "missing-run"}},
            http_request=mock_http_request,
        )

        assert response.status_code == 404
        import json
        data = json.loads(response.body)
        assert data["error"]["code"] == "run_not_found"

    @pytest.mark.asyncio
    async def test_runtime_error_path(self, mock_dependencies, mock_parser, mock_bridge):
        mock_request = MagicMock()
        mock_request.run_id = "run-test"
        mock_parser.extract_run_stream_request.return_value = mock_request
        mock_bridge.stream_run.side_effect = RuntimeError("Stream setup failed")

        mock_http_request = MagicMock()

        response = await _handle_run_stream_request(
            dependencies=mock_dependencies,
            payload={"method": "run/stream", "body": {"runId": "run-test"}},
            http_request=mock_http_request,
        )

        assert response.status_code == 500
        import json
        data = json.loads(response.body)
        assert data["error"]["code"] == "agent_execution_failed"

    @pytest.mark.asyncio
    async def test_protocol_error_path(self, mock_dependencies, mock_parser):
        from app.copilot_runtime.errors import build_invalid_request_error
        mock_parser.extract_run_stream_request.side_effect = RuntimeProtocolError(
            status_code=400,
            error=build_invalid_request_error(
                message="missing runId",
                scaffold=mock_dependencies.scaffold,
            ),
        )

        mock_http_request = MagicMock()

        response = await _handle_run_stream_request(
            dependencies=mock_dependencies,
            payload=None,
            http_request=mock_http_request,
        )

        assert response.status_code == 400


# ---------------------------------------------------------------------------
# Tests for _handle_run_start_request
# ---------------------------------------------------------------------------

class TestHandleRunStartRequest:
    @pytest.mark.asyncio
    async def test_happy_path(self, mock_dependencies, mock_parser, mock_bridge, run_record):
        mock_start_request = MagicMock()
        mock_start_request.thread_id = "thread-test"
        mock_start_request.agent_id = "default"
        mock_start_request.policy = MagicMock()
        mock_start_request.policy.debugModeEnabled = False
        mock_parser.extract_run_start_request.return_value = mock_start_request

        mock_bridge.start_run.return_value = run_record
        mock_bridge.prime_run_metadata = AsyncMock(return_value=run_record)

        mock_http_request = MagicMock()
        mock_http_request.url.path = "/"
        mock_http_request.state = MagicMock()

        response = await _handle_run_start_request(
            dependencies=mock_dependencies,
            payload={
                "method": "run/start",
                "body": {
                    "threadId": "thread-test",
                    "message": {"role": "user", "content": "hello"},
                    "policy": {
                        "modelRoute": {
                            "routeRef": {
                                "routeKind": "provider-model",
                                "profileId": "openai",
                                "modelId": "gpt-4",
                            }
                        }
                    },
                },
            },
            http_request=mock_http_request,
        )

        assert isinstance(response, JSONResponse)
        import json
        data = json.loads(response.body)
        assert data["ok"] is True

    @pytest.mark.asyncio
    async def test_thread_not_found_error(self, mock_dependencies, mock_parser, mock_bridge):
        mock_start_request = MagicMock()
        mock_start_request.thread_id = "missing-thread"
        mock_start_request.agent_id = "default"
        mock_start_request.policy = MagicMock()
        mock_start_request.policy.debugModeEnabled = False
        mock_parser.extract_run_start_request.return_value = mock_start_request

        mock_bridge.start_run.side_effect = ThreadNotFoundError("missing-thread")

        mock_http_request = MagicMock()
        mock_http_request.url.path = "/"
        mock_http_request.state = MagicMock()

        response = await _handle_run_start_request(
            dependencies=mock_dependencies,
            payload={
                "method": "run/start",
                "body": {
                    "threadId": "missing-thread",
                    "message": {"role": "user", "content": "hello"},
                    "policy": {
                        "modelRoute": {
                            "routeRef": {
                                "routeKind": "provider-model",
                                "profileId": "openai",
                                "modelId": "gpt-4",
                            }
                        }
                    },
                },
            },
            http_request=mock_http_request,
        )

        assert response.status_code == 404
        import json
        data = json.loads(response.body)
        assert data["error"]["code"] == "thread_not_found"

    @pytest.mark.asyncio
    async def test_agent_not_found_error(self, mock_dependencies, mock_parser, mock_bridge):
        mock_start_request = MagicMock()
        mock_start_request.thread_id = "thread-test"
        mock_start_request.agent_id = "unknown-agent"
        mock_start_request.policy = MagicMock()
        mock_start_request.policy.debugModeEnabled = False
        mock_parser.extract_run_start_request.return_value = mock_start_request

        mock_bridge.start_run.side_effect = AgentNotFoundError(
            agent_name="unknown-agent"
        )

        mock_http_request = MagicMock()
        mock_http_request.url.path = "/"
        mock_http_request.state = MagicMock()

        response = await _handle_run_start_request(
            dependencies=mock_dependencies,
            payload={
                "method": "run/start",
                "body": {
                    "threadId": "thread-test",
                    "message": {"role": "user", "content": "hello"},
                    "policy": {
                        "modelRoute": {
                            "routeRef": {
                                "routeKind": "provider-model",
                                "profileId": "openai",
                                "modelId": "gpt-4",
                            }
                        }
                    },
                },
            },
            http_request=mock_http_request,
        )

        assert response.status_code == 404
        import json
        data = json.loads(response.body)
        assert data["error"]["code"] == "agent_not_found"

    @pytest.mark.asyncio
    async def test_unexpected_exception_returns_500(self, mock_dependencies, mock_parser, mock_bridge):
        mock_start_request = MagicMock()
        mock_start_request.thread_id = "thread-test"
        mock_start_request.agent_id = "default"
        mock_start_request.policy = MagicMock()
        mock_start_request.policy.debugModeEnabled = False
        mock_parser.extract_run_start_request.return_value = mock_start_request

        mock_bridge.start_run.side_effect = ValueError("Something went wrong")

        mock_http_request = MagicMock()
        mock_http_request.url.path = "/"
        mock_http_request.state = MagicMock()

        response = await _handle_run_start_request(
            dependencies=mock_dependencies,
            payload={
                "method": "run/start",
                "body": {
                    "threadId": "thread-test",
                    "message": {"role": "user", "content": "hello"},
                    "policy": {
                        "modelRoute": {
                            "routeRef": {
                                "routeKind": "provider-model",
                                "profileId": "openai",
                                "modelId": "gpt-4",
                            }
                        }
                    },
                },
            },
            http_request=mock_http_request,
        )

        assert response.status_code == 500

    @pytest.mark.asyncio
    async def test_protocol_error_path(self, mock_dependencies, mock_parser):
        from app.copilot_runtime.errors import build_invalid_request_error
        mock_parser.extract_run_start_request.side_effect = RuntimeProtocolError(
            status_code=400,
            error=build_invalid_request_error(
                message="missing threadId",
                scaffold=mock_dependencies.scaffold,
            ),
        )

        mock_http_request = MagicMock()
        mock_http_request.state = MagicMock()

        response = await _handle_run_start_request(
            dependencies=mock_dependencies,
            payload=None,
            http_request=mock_http_request,
        )

        assert response.status_code == 400


# ---------------------------------------------------------------------------
# Tests for _write_transport_event
# ---------------------------------------------------------------------------

class TestWriteTransportEvent:
    def test_no_logger_returns_none(self):
        from app.copilot_runtime.debug_log_store import DebugLogLevel, DebugLogCategory
        result = _write_transport_event(
            logger=None,
            level=DebugLogLevel.INFO,
            event_name="test.event",
            message="Test message",
            operation="test",
            phase="test_phase",
            summary={"status": "ok"},
        )
        assert result is None

    def test_with_logger_calls_write(self):
        from app.copilot_runtime.debug_log_store import DebugLogLevel, DebugLogCategory
        mock_logger = MagicMock()
        _write_transport_event(
            logger=mock_logger,
            level=DebugLogLevel.INFO,
            event_name="test.event",
            message="Test message",
            operation="test",
            phase="test_phase",
            summary={"status": "ok"},
            request_id="req-1",
            run_id="run-1",
            thread_id="thread-1",
            session_id="session-1",
            error=ValueError("test error"),
        )
        mock_logger.write.assert_called_once()


# ---------------------------------------------------------------------------
# Tests for method_not_implemented_response (via shared.errors)
# ---------------------------------------------------------------------------

class TestMethodNotImplementedResponse:
    def test_returns_501_with_correct_code(self, mock_scaffold):
        response = method_not_implemented_response(
            requested_method="legacy/run",
            scaffold=mock_scaffold,
        )

        assert response.status_code == 501
        import json
        data = json.loads(response.body)
        assert data["ok"] is False
        assert data["error"]["code"] == "method_not_implemented"
        assert data["error"]["requestedMethod"] == "legacy/run"
        assert "supportedMethods" in data["error"]

    def test_error_payload_includes_supported_methods(self, mock_scaffold):
        response = method_not_implemented_response(
            requested_method="info",
            scaffold=mock_scaffold,
        )

        import json
        data = json.loads(response.body)
        assert isinstance(data["error"]["supportedMethods"], (list, tuple))
        assert THREAD_CREATE_METHOD in data["error"]["supportedMethods"]


# ---------------------------------------------------------------------------
# Tests for error response helpers (unit verification)
# ---------------------------------------------------------------------------

class TestErrorResponseHelpers:
    def test_protocol_error_response_status_code(self, mock_scaffold):
        from app.copilot_runtime.errors import build_invalid_request_error
        exc = RuntimeProtocolError(
            status_code=400,
            error=build_invalid_request_error(
                message="test",
                scaffold=mock_scaffold,
            ),
        )
        resp = protocol_error_response(exc)
        assert resp.status_code == 400

    def test_agent_not_found_response(self, mock_scaffold):
        resp = agent_not_found_response(
            agent_name="no-such-agent",
            scaffold=mock_scaffold,
            requested_method="thread/create",
        )
        assert resp.status_code == 404

    def test_thread_not_found_response(self, mock_scaffold):
        resp = thread_not_found_response(
            thread_id="t-unknown",
            scaffold=mock_scaffold,
            requested_method="thread/get",
        )
        assert resp.status_code == 404

    def test_run_not_found_response(self, mock_scaffold):
        resp = run_not_found_response(
            run_id="r-unknown",
            scaffold=mock_scaffold,
            requested_method="run/cancel",
        )
        assert resp.status_code == 404

    def test_session_not_found_response(self, mock_scaffold):
        resp = session_not_found_response(
            session_id="s-unknown",
            scaffold=mock_scaffold,
            requested_method="capabilities/get",
        )
        assert resp.status_code == 404

    def test_tool_approval_not_found_response(self, mock_scaffold):
        resp = tool_approval_not_found_response(
            run_id="r-1",
            tool_call_id="tc-1",
            scaffold=mock_scaffold,
            requested_method="tool-approval/resolve",
        )
        assert resp.status_code == 404

    def test_agent_execution_failed_response(self, mock_scaffold):
        resp = agent_execution_failed_response(
            message="execution failed",
            scaffold=mock_scaffold,
            requested_method="run/start",
        )
        assert resp.status_code == 500

    def test_runtime_operation_conflict_response(self, mock_scaffold):
        resp = runtime_operation_conflict_response(
            code="test_conflict",
            message="test",
            scaffold=mock_scaffold,
            requested_method="tool-approval/resolve",
            details={"key": "value"},
        )
        assert resp.status_code == 409

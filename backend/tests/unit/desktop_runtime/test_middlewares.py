from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException, Request, WebSocket
from fastapi.testclient import TestClient

from app.desktop_runtime.middlewares import DesktopRuntimeFailureEnvelopeMiddleware


def _build_minimal_app() -> FastAPI:
    app = FastAPI()
    app.state.copilot_runtime_scaffold = SimpleNamespace(
        stage="test-stage",
        supported_methods=(),
    )
    app.add_middleware(DesktopRuntimeFailureEnvelopeMiddleware)
    return app


class TestDesktopRuntimeFailureEnvelopeMiddleware:
    def test_normal_response_passes_through_unchanged(self) -> None:
        app = _build_minimal_app()

        @app.get("/ok")
        def ok_endpoint() -> dict[str, object]:
            return {"ok": True, "data": "hello"}

        with TestClient(app) as client:
            response = client.get("/ok")

        assert response.status_code == 200
        payload = response.json()
        assert payload["ok"] is True
        assert payload["data"] == "hello"

    def test_http_exception_passes_through_with_status_code_preserved(self) -> None:
        app = _build_minimal_app()

        @app.get("/teapot")
        def teapot() -> None:
            raise HTTPException(status_code=418, detail="I am a teapot")

        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.get("/teapot")

        assert response.status_code == 418
        payload = response.json()
        assert payload["detail"] == "I am a teapot"

    def test_http_exception_401_passes_through(self) -> None:
        app = _build_minimal_app()

        @app.get("/unauthorized")
        def unauthorized() -> None:
            raise HTTPException(
                status_code=401,
                detail={
                    "code": "missing_local_token",
                    "message": "Missing local runtime token.",
                },
            )

        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.get("/unauthorized")

        assert response.status_code == 401
        payload = response.json()
        assert payload["detail"]["code"] == "missing_local_token"

    def test_runtime_error_produces_500_error_envelope(self) -> None:
        app = _build_minimal_app()

        @app.get("/boom")
        def boom() -> None:
            raise RuntimeError("forced test failure")

        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.get("/boom")

        assert response.status_code == 500
        assert response.headers["content-type"].startswith("application/json")
        payload = response.json()
        assert payload["ok"] is False
        assert payload["error"]["code"] == "internal_server_error"
        assert "message" in payload["error"]
        assert payload["error"]["stage"] == "test-stage"
        assert "requestId" in payload["error"]["details"]
        assert payload["error"]["requestedMethod"] is None

    def test_generic_exception_produces_500_error_envelope(self) -> None:
        app = _build_minimal_app()

        @app.get("/value-error")
        def value_error_route() -> None:
            raise ValueError("invalid value")

        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.get("/value-error")

        assert response.status_code == 500
        payload = response.json()
        assert payload["ok"] is False
        assert payload["error"]["code"] == "internal_server_error"
        assert "message" in payload["error"]
        assert "requestId" in payload["error"]["details"]

    def test_error_envelope_includes_supported_methods_from_scaffold(self) -> None:
        app = _build_minimal_app()
        app.state.copilot_runtime_scaffold = SimpleNamespace(
            stage="production",
            supported_methods=("agents/list", "thread/create"),
        )

        @app.get("/scaffold-boom")
        def scaffold_boom() -> None:
            raise RuntimeError("scaffold test")

        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.get("/scaffold-boom")

        assert response.status_code == 500
        payload = response.json()
        assert payload["error"]["stage"] == "production"
        assert payload["error"]["supportedMethods"] == ["agents/list", "thread/create"]

    def test_request_id_is_set_on_successful_requests(self) -> None:
        app = _build_minimal_app()
        captured: dict[str, object] = {}

        @app.get("/capture-id")
        async def capture_id(request: Request) -> dict[str, str]:
            captured["request_id"] = request.state.copilot_runtime_request_id
            captured["scope_id"] = request.scope.get("copilot_runtime_request_id")
            return {"ok": "true"}

        with TestClient(app) as client:
            response = client.get("/capture-id")

        assert response.status_code == 200
        request_id = captured["request_id"]
        scope_id = captured["scope_id"]
        assert isinstance(request_id, str)
        assert len(request_id) == 32
        assert request_id == scope_id

    def test_request_id_is_set_even_when_route_fails(self) -> None:
        app = _build_minimal_app()
        captured: dict[str, object] = {}

        @app.get("/fail-with-capture")
        def fail_with_capture(request: Request) -> None:
            captured["request_id"] = request.state.copilot_runtime_request_id
            captured["scope_id"] = request.scope.get("copilot_runtime_request_id")
            raise RuntimeError("captured failure")

        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.get("/fail-with-capture")

        assert response.status_code == 500
        request_id = captured["request_id"]
        scope_id = captured["scope_id"]
        assert isinstance(request_id, str)
        assert len(request_id) == 32
        assert request_id == scope_id

    def test_called_method_is_reflected_in_error_envelope(self) -> None:
        app = _build_minimal_app()

        @app.get("/tracked-method")
        def tracked_method(request: Request) -> None:
            request.state.copilot_runtime_requested_method = "custom/tracked"
            raise RuntimeError("tracked failure")

        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.get("/tracked-method")

        assert response.status_code == 500
        payload = response.json()
        assert payload["error"]["requestedMethod"] == "custom/tracked"

    def test_websocket_endpoint_passes_through_unaffected(self) -> None:
        app = _build_minimal_app()

        @app.websocket("/ws")
        async def ws_endpoint(websocket: WebSocket) -> None:
            await websocket.accept()
            data = await websocket.receive_json()
            await websocket.send_json({"echo": data})
            await websocket.close()

        with TestClient(app) as client:
            with client.websocket_connect("/ws") as ws:
                ws.send_json({"hello": "world"})
                received = ws.receive_json()

        assert received == {"echo": {"hello": "world"}}

    def test_each_request_gets_unique_request_id(self) -> None:
        app = _build_minimal_app()
        captured_ids: list[str] = []

        @app.get("/unique-id")
        async def capture_unique_id(request: Request) -> dict[str, str]:
            captured_ids.append(request.state.copilot_runtime_request_id)
            return {"ok": "true"}

        with TestClient(app) as client:
            for _ in range(5):
                response = client.get("/unique-id")
                assert response.status_code == 200

        assert len(captured_ids) == 5
        assert len(set(captured_ids)) == 5

    def test_post_request_with_body_sets_request_id(self) -> None:
        app = _build_minimal_app()
        captured: dict[str, object] = {}

        @app.post("/post-check")
        async def post_check(request: Request) -> dict[str, object]:
            captured["request_id"] = request.state.copilot_runtime_request_id
            body = await request.json()
            return {"received": body}

        with TestClient(app) as client:
            response = client.post("/post-check", json={"key": "value"})

        assert response.status_code == 200
        assert captured["request_id"] is not None
        assert response.json() == {"received": {"key": "value"}}

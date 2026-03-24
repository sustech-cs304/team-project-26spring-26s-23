from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.copilot_runtime import build_router, build_runtime_scaffold


def test_root_post_info_request_returns_runtime_info() -> None:
    scaffold = build_runtime_scaffold()
    app = FastAPI()
    app.include_router(build_router(scaffold))

    with TestClient(app) as client:
        response = client.post(
            "/",
            json={
                "method": "info",
                "properties": {"mode": "desktop"},
                "frontendUrl": "http://localhost:5173",
            },
        )

    assert response.status_code == 200
    assert response.json() == scaffold.build_info_response().to_dict()



def test_root_post_info_shape_without_method_is_recognized() -> None:
    scaffold = build_runtime_scaffold()
    app = FastAPI()
    app.include_router(build_router(scaffold))

    with TestClient(app) as client:
        response = client.post(
            "/",
            json={
                "properties": {"mode": "desktop"},
                "frontendUrl": "http://localhost:5173",
            },
        )

    assert response.status_code == 200
    assert response.json() == scaffold.build_info_response().to_dict()



def test_root_post_run_like_request_returns_structured_not_implemented_error() -> None:
    scaffold = build_runtime_scaffold()
    app = FastAPI()
    app.include_router(build_router(scaffold))

    with TestClient(app) as client:
        response = client.post(
            "/",
            json={
                "threadId": "thread-1",
                "runId": "run-1",
                "messages": [],
                "state": {},
            },
        )

    assert response.status_code == 501

    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "method_not_implemented"
    assert payload["error"]["requestedMethod"] == "run"
    assert payload["error"]["supportedMethods"] == ["info"]
    assert payload["error"]["stage"] == "phase1-info-only"
    assert "Only the info capability is currently available" in payload["error"]["message"]



def test_root_post_invalid_method_shape_returns_structured_bad_request() -> None:
    scaffold = build_runtime_scaffold()
    app = FastAPI()
    app.include_router(build_router(scaffold))

    with TestClient(app) as client:
        response = client.post("/", json={"method": 123})

    assert response.status_code == 400

    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "invalid_runtime_request"
    assert payload["error"]["requestedMethod"] is None
    assert payload["error"]["supportedMethods"] == ["info"]
    assert payload["error"]["stage"] == "phase1-info-only"

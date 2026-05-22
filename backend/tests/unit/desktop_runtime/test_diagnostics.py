from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.routing import APIRouter
from fastapi.testclient import TestClient

from app.desktop_runtime.config import DEFAULT_HOST, DesktopRuntimeConfig, DesktopRuntimePaths
from app.desktop_runtime.contracts import (
    DiagnosticsContract,
    HealthContract,
    ReadinessContract,
    VersionContract,
)
from app.desktop_runtime.health import (
    DESKTOP_RUNTIME_SERVICE_NAME,
    ENTRYPOINT_MODULE,
    build_diagnostics_contract,
    build_health_contract,
    build_readiness_contract,
    build_version_contract,
)
from app.desktop_runtime.lifecycle import RuntimeLifecycleManager
from app.desktop_runtime.routes.diagnostics import build_diagnostics_router


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _make_config(tmp_path: Path, *, local_token: str | None = None) -> DesktopRuntimeConfig:
    user_data_dir = tmp_path / "user-data"
    runtime_root_dir = user_data_dir / "desktop-runtime"
    return DesktopRuntimeConfig(
        host=DEFAULT_HOST,
        port=8765,
        local_token=local_token,
        paths=DesktopRuntimePaths(
            user_data_dir=user_data_dir,
            runtime_root_dir=runtime_root_dir,
            config_dir=runtime_root_dir / "config",
            logs_dir=runtime_root_dir / "logs",
            database_dir=runtime_root_dir / "database",
            state_dir=runtime_root_dir / "state",
            debug_log_database_file=runtime_root_dir / "database" / "copilot-debug-log.db",
            copilot_settings_file=runtime_root_dir / "config" / "copilot-settings.json",
            host_log_file=runtime_root_dir / "logs" / "electron-host.log",
            backend_stdout_log_file=runtime_root_dir / "logs" / "backend.stdout.log",
            backend_stderr_log_file=runtime_root_dir / "logs" / "backend.stderr.log",
            runtime_snapshot_file=runtime_root_dir / "state" / "runtime-snapshot.json",
            last_failure_file=runtime_root_dir / "state" / "last-failure.json",
        ),
        app_mode="desktop",
        environment="test",
    )


class _MockScaffold:
    def diagnostics_summary(self) -> dict[str, object]:
        return {
            "chat_runtime_registered": True,
            "chat_protocol": "single-endpoint",
        }


def _make_test_app(
    config: DesktopRuntimeConfig,
    manager: RuntimeLifecycleManager,
    scaffold: object | None = None,
) -> FastAPI:
    app = FastAPI()
    app.state.runtime_config = config
    app.state.lifecycle_manager = manager
    if scaffold is not None:
        app.state.copilot_runtime_scaffold = scaffold
    app.include_router(build_diagnostics_router())
    return app


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def tmp_config(tmp_path: Path) -> DesktopRuntimeConfig:
    return _make_config(tmp_path)


@pytest.fixture
def started_manager(tmp_config: DesktopRuntimeConfig) -> RuntimeLifecycleManager:
    manager = RuntimeLifecycleManager(tmp_config)
    manager.startup()
    return manager


@pytest.fixture
def unstarted_manager(tmp_config: DesktopRuntimeConfig) -> RuntimeLifecycleManager:
    return RuntimeLifecycleManager(tmp_config)


@pytest.fixture
def mock_scaffold() -> _MockScaffold:
    return _MockScaffold()


@pytest.fixture
def test_app(
    tmp_config: DesktopRuntimeConfig,
    started_manager: RuntimeLifecycleManager,
    mock_scaffold: _MockScaffold,
) -> FastAPI:
    return _make_test_app(tmp_config, started_manager, mock_scaffold)


# ---------------------------------------------------------------------------
# contracts.py
# ---------------------------------------------------------------------------


class TestHealthContract:
    def test_construction_with_defaults(self) -> None:
        contract = HealthContract(service="test-svc", status="ok", ready=True)

        assert contract.service == "test-svc"
        assert contract.status == "ok"
        assert contract.ready is True
        assert contract.transport == "loopback-http"

    def test_construction_with_explicit_transport(self) -> None:
        contract = HealthContract(service="svc", status="ok", ready=False, transport="unix-socket")

        assert contract.transport == "unix-socket"

    def test_to_dict_shape(self) -> None:
        contract = HealthContract(service="test", status="ok", ready=True)

        result = contract.to_dict()

        assert result == {
            "service": "test",
            "status": "ok",
            "ready": True,
            "transport": "loopback-http",
        }


class TestReadinessContract:
    def test_construction_with_all_fields(self) -> None:
        contract = ReadinessContract(
            service="test-svc",
            status="ready",
            ready=True,
            startup_complete=True,
            last_error=None,
        )

        assert contract.service == "test-svc"
        assert contract.status == "ready"
        assert contract.ready is True
        assert contract.startup_complete is True
        assert contract.last_error is None

    def test_construction_with_error(self) -> None:
        contract = ReadinessContract(
            service="test-svc",
            status="failed",
            ready=False,
            startup_complete=False,
            last_error="Something went wrong",
        )

        assert contract.last_error == "Something went wrong"

    def test_default_last_error_is_none(self) -> None:
        contract = ReadinessContract(
            service="test-svc", status="starting", ready=False, startup_complete=False
        )

        assert contract.last_error is None

    def test_to_dict_includes_startup_complete(self) -> None:
        contract = ReadinessContract(
            service="test", status="ready", ready=True, startup_complete=True
        )

        result = contract.to_dict()

        assert result["startup_complete"] is True

    def test_to_dict_preserves_none_last_error(self) -> None:
        contract = ReadinessContract(
            service="test", status="ready", ready=True, startup_complete=True
        )

        result = contract.to_dict()

        assert result["last_error"] is None


class TestVersionContract:
    def test_construction(self) -> None:
        contract = VersionContract(
            service="test-svc",
            version="1.2.3",
            python_version="3.11",
            app_mode="desktop",
            environment="production",
            build={"transport": "loopback-http"},
        )

        assert contract.service == "test-svc"
        assert contract.version == "1.2.3"
        assert contract.python_version == "3.11"
        assert contract.build == {"transport": "loopback-http"}

    def test_default_build_is_empty_dict(self) -> None:
        contract = VersionContract(
            service="test", version="0.1.0", python_version="3.11", app_mode="desktop", environment="dev"
        )

        assert contract.build == {}

    def test_to_dict_includes_build(self) -> None:
        contract = VersionContract(
            service="test",
            version="1.0.0",
            python_version="3.11",
            app_mode="desktop",
            environment="test",
            build={"entrypoint": "module"},
        )

        result = contract.to_dict()

        assert result["version"] == "1.0.0"
        assert result["build"]["entrypoint"] == "module"


class TestDiagnosticsContract:
    def test_construction(self) -> None:
        contract = DiagnosticsContract(
            service="test-svc",
            status="ready",
            runtime={"started_at": "now"},
            configuration={"host": "127.0.0.1"},
            auth={"token_configured": False},
            capabilities={"agents": []},
        )

        assert contract.service == "test-svc"
        assert contract.runtime == {"started_at": "now"}
        assert contract.configuration == {"host": "127.0.0.1"}
        assert contract.auth == {"token_configured": False}
        assert contract.capabilities == {"agents": []}

    def test_to_dict_shape(self) -> None:
        contract = DiagnosticsContract(
            service="test",
            status="ready",
            runtime={"ready": True},
            configuration={},
            auth={},
            capabilities={},
        )

        result = contract.to_dict()

        assert result["service"] == "test"
        assert result["runtime"]["ready"] is True


class TestRuntimeContractSerialization:
    def test_datetime_converted_to_isoformat(self) -> None:
        timestamp = datetime(2025, 1, 15, 12, 30, 45, tzinfo=UTC)
        contract = DiagnosticsContract(
            service="test",
            status="ok",
            runtime={"started_at": timestamp},
            configuration={},
            auth={},
            capabilities={},
        )

        result = contract.to_dict()

        assert result["runtime"]["started_at"] == "2025-01-15T12:30:45+00:00"

    def test_path_converted_to_posix(self) -> None:
        contract = DiagnosticsContract(
            service="test",
            status="ok",
            runtime={"working_directory": Path("a/b/c")},
            configuration={},
            auth={},
            capabilities={},
        )

        result = contract.to_dict()

        assert result["runtime"]["working_directory"] == "a/b/c"

    def test_nested_dict_serialization(self) -> None:
        timestamp = datetime(2025, 6, 1, tzinfo=UTC)
        contract = DiagnosticsContract(
            service="test",
            status="ok",
            runtime={"nested": {"time": timestamp, "path": Path("x/y")}},
            configuration={},
            auth={},
            capabilities={},
        )

        result = contract.to_dict()

        assert result["runtime"]["nested"]["time"] == "2025-06-01T00:00:00+00:00"
        assert result["runtime"]["nested"]["path"] == "x/y"

    def test_list_items_serialized(self) -> None:
        dt1 = datetime(2025, 1, 1, tzinfo=UTC)
        dt2 = datetime(2025, 6, 1, tzinfo=UTC)
        contract = DiagnosticsContract(
            service="test",
            status="ok",
            runtime={"timestamps": [dt1, dt2]},
            configuration={},
            auth={},
            capabilities={},
        )

        result = contract.to_dict()

        assert result["runtime"]["timestamps"] == [
            "2025-01-01T00:00:00+00:00",
            "2025-06-01T00:00:00+00:00",
        ]

    def test_tuple_items_serialized(self) -> None:
        dt1 = datetime(2025, 1, 1, tzinfo=UTC)
        contract = DiagnosticsContract(
            service="test",
            status="ok",
            runtime={"timestamps": (dt1, dt1)},
            configuration={},
            auth={},
            capabilities={},
        )

        result = contract.to_dict()

        assert result["runtime"]["timestamps"] == [
            "2025-01-01T00:00:00+00:00",
            "2025-01-01T00:00:00+00:00",
        ]

    def test_set_items_serialized(self) -> None:
        dt1 = datetime(2025, 1, 1, tzinfo=UTC)
        contract = DiagnosticsContract(
            service="test",
            status="ok",
            runtime={"timestamps": {dt1}},
            configuration={},
            auth={},
            capabilities={},
        )

        result = contract.to_dict()

        assert len(result["runtime"]["timestamps"]) == 1
        assert result["runtime"]["timestamps"][0] == "2025-01-01T00:00:00+00:00"

    def test_non_special_values_pass_through(self) -> None:
        contract = DiagnosticsContract(
            service="test",
            status="ok",
            runtime={"count": 42, "flag": True, "text": "hello", "nothing": None},
            configuration={},
            auth={},
            capabilities={},
        )

        result = contract.to_dict()

        assert result["runtime"]["count"] == 42
        assert result["runtime"]["flag"] is True
        assert result["runtime"]["text"] == "hello"
        assert result["runtime"]["nothing"] is None


# ---------------------------------------------------------------------------
# health.py
# ---------------------------------------------------------------------------


class TestBuildHealthContract:
    def test_returns_health_contract(self, started_manager: RuntimeLifecycleManager) -> None:
        result = build_health_contract(started_manager)

        assert isinstance(result, HealthContract)

    def test_status_is_ok(self, started_manager: RuntimeLifecycleManager) -> None:
        result = build_health_contract(started_manager)

        assert result.status == "ok"

    def test_service_name(self, started_manager: RuntimeLifecycleManager) -> None:
        result = build_health_contract(started_manager)

        assert result.service == DESKTOP_RUNTIME_SERVICE_NAME

    def test_ready_reflects_manager_state(self, started_manager: RuntimeLifecycleManager) -> None:
        result = build_health_contract(started_manager)

        assert result.ready is True

    def test_ready_false_when_manager_not_started(
        self, unstarted_manager: RuntimeLifecycleManager
    ) -> None:
        result = build_health_contract(unstarted_manager)

        assert result.ready is False

    def test_transport_is_loopback_http(self, started_manager: RuntimeLifecycleManager) -> None:
        result = build_health_contract(started_manager)

        assert result.transport == "loopback-http"


class TestBuildReadinessContract:
    def test_returns_readiness_contract(self, started_manager: RuntimeLifecycleManager) -> None:
        result = build_readiness_contract(started_manager)

        assert isinstance(result, ReadinessContract)

    def test_status_is_ready_after_startup(self, started_manager: RuntimeLifecycleManager) -> None:
        result = build_readiness_contract(started_manager)

        assert result.status == "ready"

    def test_startup_complete_is_true_after_startup(
        self, started_manager: RuntimeLifecycleManager
    ) -> None:
        result = build_readiness_contract(started_manager)

        assert result.startup_complete is True

    def test_last_error_is_none_after_successful_startup(
        self, started_manager: RuntimeLifecycleManager
    ) -> None:
        result = build_readiness_contract(started_manager)

        assert result.last_error is None

    def test_status_is_starting_when_not_started(
        self, unstarted_manager: RuntimeLifecycleManager
    ) -> None:
        result = build_readiness_contract(unstarted_manager)

        assert result.status == "starting"

    def test_ready_is_false_when_not_started(
        self, unstarted_manager: RuntimeLifecycleManager
    ) -> None:
        result = build_readiness_contract(unstarted_manager)

        assert result.ready is False


class TestBuildVersionContract:
    def test_returns_version_contract(self, tmp_config: DesktopRuntimeConfig) -> None:
        result = build_version_contract(tmp_config)

        assert isinstance(result, VersionContract)

    def test_includes_version_string(self, tmp_config: DesktopRuntimeConfig) -> None:
        result = build_version_contract(tmp_config)

        assert result.version
        assert isinstance(result.version, str)

    def test_includes_python_version(self, tmp_config: DesktopRuntimeConfig) -> None:
        result = build_version_contract(tmp_config)

        assert result.python_version
        assert "." in result.python_version

    def test_includes_app_mode(self, tmp_config: DesktopRuntimeConfig) -> None:
        result = build_version_contract(tmp_config)

        assert result.app_mode == "desktop"

    def test_includes_environment(self, tmp_config: DesktopRuntimeConfig) -> None:
        result = build_version_contract(tmp_config)

        assert result.environment == "test"

    def test_build_dict_includes_entrypoint(self, tmp_config: DesktopRuntimeConfig) -> None:
        result = build_version_contract(tmp_config)

        assert result.build["entrypoint"] == ENTRYPOINT_MODULE

    def test_build_dict_includes_transport(self, tmp_config: DesktopRuntimeConfig) -> None:
        result = build_version_contract(tmp_config)

        assert result.build["transport"] == "loopback-http"

    def test_build_dict_includes_base_url(self, tmp_config: DesktopRuntimeConfig) -> None:
        result = build_version_contract(tmp_config)

        assert result.build["base_url"] == tmp_config.base_url

    def test_service_name(self, tmp_config: DesktopRuntimeConfig) -> None:
        result = build_version_contract(tmp_config)

        assert result.service == DESKTOP_RUNTIME_SERVICE_NAME


class TestBuildDiagnosticsContract:
    def test_returns_diagnostics_contract(
        self, tmp_config: DesktopRuntimeConfig, started_manager: RuntimeLifecycleManager
    ) -> None:
        result = build_diagnostics_contract(tmp_config, started_manager)

        assert isinstance(result, DiagnosticsContract)

    def test_includes_runtime_info(
        self, tmp_config: DesktopRuntimeConfig, started_manager: RuntimeLifecycleManager
    ) -> None:
        result = build_diagnostics_contract(tmp_config, started_manager)

        assert result.runtime["ready"] is True
        assert "working_directory" in result.runtime
        assert "backend_dir" in result.runtime

    def test_includes_configuration(
        self, tmp_config: DesktopRuntimeConfig, started_manager: RuntimeLifecycleManager
    ) -> None:
        result = build_diagnostics_contract(tmp_config, started_manager)

        assert result.configuration["host"] == DEFAULT_HOST
        assert result.configuration["port"] == 8765

    def test_includes_auth_info(
        self, tmp_config: DesktopRuntimeConfig, started_manager: RuntimeLifecycleManager
    ) -> None:
        result = build_diagnostics_contract(tmp_config, started_manager)

        assert "header_name" in result.auth
        assert result.auth["token_configured"] is False

    def test_includes_capabilities(
        self, tmp_config: DesktopRuntimeConfig, started_manager: RuntimeLifecycleManager
    ) -> None:
        result = build_diagnostics_contract(tmp_config, started_manager)

        assert "domain_routes_registered" in result.capabilities
        assert "available_agents" in result.capabilities

    def test_chat_runtime_summary_updates_capabilities(
        self, tmp_config: DesktopRuntimeConfig, started_manager: RuntimeLifecycleManager
    ) -> None:
        summary = {"chat_runtime_registered": True, "custom_key": "value"}
        result = build_diagnostics_contract(
            tmp_config, started_manager, chat_runtime_summary=summary
        )

        assert result.capabilities["chat_runtime_registered"] is True
        assert result.capabilities["custom_key"] == "value"

    def test_status_reflects_manager(
        self, tmp_config: DesktopRuntimeConfig, started_manager: RuntimeLifecycleManager
    ) -> None:
        result = build_diagnostics_contract(tmp_config, started_manager)

        assert result.status == "ready"

    def test_runtime_started_at_is_set_after_startup(
        self, tmp_config: DesktopRuntimeConfig, started_manager: RuntimeLifecycleManager
    ) -> None:
        result = build_diagnostics_contract(tmp_config, started_manager)

        assert result.runtime["started_at"] is not None

    def test_default_capabilities_when_no_summary(
        self, tmp_config: DesktopRuntimeConfig, started_manager: RuntimeLifecycleManager
    ) -> None:
        result = build_diagnostics_contract(tmp_config, started_manager)

        assert result.capabilities["domain_routes_registered"] is False
        assert result.capabilities["chat_runtime_registered"] is False
        assert result.capabilities["available_agents"] == []
        assert result.capabilities["model_configured"] is False


# ---------------------------------------------------------------------------
# diagnostics.py  –  router
# ---------------------------------------------------------------------------


class TestBuildDiagnosticsRouter:
    def test_returns_apirouter(self) -> None:
        router = build_diagnostics_router()

        assert isinstance(router, APIRouter)

    def test_router_has_expected_routes(self) -> None:
        router = build_diagnostics_router()

        route_paths = [route.path for route in router.routes]
        assert "/health" in route_paths
        assert "/ready" in route_paths
        assert "/version" in route_paths
        assert "/build-info" in route_paths
        assert "/diagnostics" in route_paths
        assert "/diagnostics/runtime-info" in route_paths


class TestHealthEndpoint:
    def test_get_health_returns_200(self, test_app: FastAPI) -> None:
        client = TestClient(test_app)

        response = client.get("/health")

        assert response.status_code == 200

    def test_get_health_shape(self, test_app: FastAPI) -> None:
        client = TestClient(test_app)

        response = client.get("/health")
        payload = response.json()

        assert payload["service"] == DESKTOP_RUNTIME_SERVICE_NAME
        assert payload["status"] == "ok"
        assert payload["ready"] is True
        assert payload["transport"] == "loopback-http"


class TestReadyEndpoint:
    def test_get_ready_returns_200(self, test_app: FastAPI) -> None:
        client = TestClient(test_app)

        response = client.get("/ready")

        assert response.status_code == 200

    def test_get_ready_shape(self, test_app: FastAPI) -> None:
        client = TestClient(test_app)

        response = client.get("/ready")
        payload = response.json()

        assert payload["status"] == "ready"
        assert payload["ready"] is True
        assert payload["startup_complete"] is True
        assert payload["last_error"] is None


class TestVersionEndpoint:
    def test_get_version_returns_200(self, test_app: FastAPI) -> None:
        client = TestClient(test_app)

        response = client.get("/version")

        assert response.status_code == 200

    def test_get_version_includes_version_field(self, test_app: FastAPI) -> None:
        client = TestClient(test_app)

        response = client.get("/version")

        assert response.json()["version"]

    def test_get_version_includes_build_info(self, test_app: FastAPI) -> None:
        client = TestClient(test_app)

        response = client.get("/version")
        payload = response.json()

        assert "build" in payload
        assert payload["build"]["entrypoint"] == ENTRYPOINT_MODULE


class TestBuildInfoEndpoint:
    def test_get_build_info_returns_200(self, test_app: FastAPI) -> None:
        client = TestClient(test_app)

        response = client.get("/build-info")

        assert response.status_code == 200

    def test_get_build_info_matches_version(self, test_app: FastAPI) -> None:
        client = TestClient(test_app)

        version_response = client.get("/version")
        build_response = client.get("/build-info")

        assert build_response.json() == version_response.json()


class TestDiagnosticsEndpoint:
    def test_get_diagnostics_returns_200(self, test_app: FastAPI) -> None:
        client = TestClient(test_app)

        response = client.get("/diagnostics")

        assert response.status_code == 200

    def test_get_diagnostics_includes_runtime_info(self, test_app: FastAPI) -> None:
        client = TestClient(test_app)

        response = client.get("/diagnostics")
        payload = response.json()

        assert "runtime" in payload
        assert payload["runtime"]["ready"] is True

    def test_get_diagnostics_includes_capabilities(self, test_app: FastAPI) -> None:
        client = TestClient(test_app)

        response = client.get("/diagnostics")
        payload = response.json()

        assert "capabilities" in payload
        assert payload["capabilities"]["chat_runtime_registered"] is True

    def test_get_diagnostics_runtime_info_returns_same_payload(
        self, test_app: FastAPI
    ) -> None:
        client = TestClient(test_app)

        diag_response = client.get("/diagnostics")
        runtime_info_response = client.get("/diagnostics/runtime-info")

        assert runtime_info_response.json() == diag_response.json()

    def test_get_diagnostics_returns_401_when_token_configured_but_not_sent(
        self, tmp_path: Path, started_manager: RuntimeLifecycleManager
    ) -> None:
        config = _make_config(tmp_path, local_token="secret-token")
        app = _make_test_app(config, started_manager, _MockScaffold())

        client = TestClient(app)
        response = client.get("/diagnostics")

        assert response.status_code == 401

    def test_get_diagnostics_returns_200_when_token_matches(
        self, tmp_path: Path, started_manager: RuntimeLifecycleManager
    ) -> None:
        config = _make_config(tmp_path, local_token="secret-token")
        app = _make_test_app(config, started_manager, _MockScaffold())

        client = TestClient(app)
        response = client.get(
            "/diagnostics", headers={"X-Local-Token": "secret-token"}
        )

        assert response.status_code == 200

    def test_health_does_not_require_token(
        self, tmp_path: Path, started_manager: RuntimeLifecycleManager
    ) -> None:
        config = _make_config(tmp_path, local_token="secret-token")
        app = _make_test_app(config, started_manager, _MockScaffold())

        client = TestClient(app)
        response = client.get("/health")

        assert response.status_code == 200

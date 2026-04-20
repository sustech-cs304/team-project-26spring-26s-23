from __future__ import annotations

from importlib.metadata import PackageNotFoundError
from pathlib import Path

import pytest

import app.desktop_runtime.config as runtime_config_module

BACKEND_DIR = Path(__file__).resolve().parents[3]


def test_parse_runtime_config_defaults_to_loopback_and_backend_data_dir() -> None:
    config = runtime_config_module.parse_runtime_config([], env={}, cwd=BACKEND_DIR)

    assert config.host == runtime_config_module.DEFAULT_HOST
    assert config.port == runtime_config_module.DEFAULT_PORT
    assert config.local_token is None
    assert config.host_model_route_bridge_url is None
    assert config.host_model_route_bridge_token is None
    assert config.host_capability_bridge_url is None
    assert config.host_capability_bridge_token is None
    assert config.app_mode == runtime_config_module.DEFAULT_APP_MODE
    assert config.environment == runtime_config_module.DEFAULT_ENVIRONMENT
    assert config.user_data_dir == runtime_config_module.DEFAULT_USER_DATA_DIR.resolve()
    assert config.runtime_root_dir == config.user_data_dir / runtime_config_module.DEFAULT_RUNTIME_ROOT_DIR_NAME
    assert config.config_dir == config.runtime_root_dir / runtime_config_module.DEFAULT_CONFIG_DIR_NAME
    assert config.logs_dir == config.runtime_root_dir / runtime_config_module.DEFAULT_LOGS_DIR_NAME
    assert config.database_dir == config.runtime_root_dir / runtime_config_module.DEFAULT_DATABASE_DIR_NAME
    assert config.state_dir == config.runtime_root_dir / runtime_config_module.DEFAULT_STATE_DIR_NAME
    assert config.debug_log_database_file == (
        config.database_dir / runtime_config_module.DEFAULT_DEBUG_LOG_DATABASE_FILE_NAME
    )
    assert config.copilot_settings_file == (
        config.config_dir / runtime_config_module.DEFAULT_COPILOT_SETTINGS_FILE_NAME
    )
    assert config.host_log_file == config.logs_dir / runtime_config_module.DEFAULT_HOST_LOG_FILE_NAME
    assert config.backend_stdout_log_file == (
        config.logs_dir / runtime_config_module.DEFAULT_BACKEND_STDOUT_LOG_FILE_NAME
    )
    assert config.backend_stderr_log_file == (
        config.logs_dir / runtime_config_module.DEFAULT_BACKEND_STDERR_LOG_FILE_NAME
    )
    assert config.runtime_snapshot_file == (
        config.state_dir / runtime_config_module.DEFAULT_RUNTIME_SNAPSHOT_FILE_NAME
    )
    assert config.last_failure_file == config.state_dir / runtime_config_module.DEFAULT_LAST_FAILURE_FILE_NAME
    assert config.sanitized_summary()["host_capability_bridge_configured"] is False
    assert "model" not in config.sanitized_summary()


def test_parse_runtime_config_reads_environment_values() -> None:
    env = {
        runtime_config_module.ENV_HOST: "localhost",
        runtime_config_module.ENV_PORT: "9988",
        runtime_config_module.ENV_LOCAL_TOKEN: "env-secret",
        runtime_config_module.ENV_USER_DATA_DIR: "runtime-state",
        runtime_config_module.ENV_ROOT_DIR: "runtime-state/runtime-root",
        runtime_config_module.ENV_LOGS_DIR: "runtime-state/logs-custom",
        runtime_config_module.ENV_DATABASE_DIR: "runtime-state/db-custom",
        runtime_config_module.ENV_DEBUG_LOG_DATABASE_FILE: "runtime-state/db-custom/debug-events.sqlite3",
        runtime_config_module.ENV_APP_MODE: "desktop-bundled",
        runtime_config_module.ENV_ENVIRONMENT: "production",
        runtime_config_module.ENV_HOST_CAPABILITY_BRIDGE_URL: "http://127.0.0.1:45678/host/private/capability-bridge",
        runtime_config_module.ENV_HOST_CAPABILITY_BRIDGE_TOKEN: "capability-token-123",
    }

    config = runtime_config_module.parse_runtime_config([], env=env, cwd=BACKEND_DIR)

    assert config.host == "localhost"
    assert config.port == 9988
    assert config.local_token == "env-secret"
    assert config.user_data_dir == (BACKEND_DIR / "runtime-state").resolve()
    assert config.runtime_root_dir == (BACKEND_DIR / "runtime-state" / "runtime-root").resolve()
    assert config.config_dir == config.runtime_root_dir / runtime_config_module.DEFAULT_CONFIG_DIR_NAME
    assert config.logs_dir == (BACKEND_DIR / "runtime-state" / "logs-custom").resolve()
    assert config.database_dir == (BACKEND_DIR / "runtime-state" / "db-custom").resolve()
    assert config.state_dir == config.runtime_root_dir / runtime_config_module.DEFAULT_STATE_DIR_NAME
    assert config.debug_log_database_file == (
        BACKEND_DIR / "runtime-state" / "db-custom" / "debug-events.sqlite3"
    ).resolve()
    assert config.app_mode == "desktop-bundled"
    assert config.environment == "production"
    assert config.host_capability_bridge_url == "http://127.0.0.1:45678/host/private/capability-bridge"
    assert config.host_capability_bridge_token == "capability-token-123"
    assert config.sanitized_summary()["host_capability_bridge_configured"] is True
    assert "model" not in config.sanitized_summary()


def test_parse_runtime_config_formats_ipv6_loopback_base_url() -> None:
    config = runtime_config_module.parse_runtime_config(
        [],
        env={
            runtime_config_module.ENV_HOST: "::1",
            runtime_config_module.ENV_PORT: "9988",
        },
        cwd=BACKEND_DIR,
    )

    assert config.host == "::1"
    assert config.port == 9988
    assert config.base_url == "http://[::1]:9988"


def test_cli_arguments_override_environment_values(tmp_path: Path) -> None:
    env = {
        runtime_config_module.ENV_HOST: "localhost",
        runtime_config_module.ENV_PORT: "9988",
        runtime_config_module.ENV_LOCAL_TOKEN: "env-secret",
        runtime_config_module.ENV_USER_DATA_DIR: str(tmp_path / "env-data"),
        runtime_config_module.ENV_ROOT_DIR: str(tmp_path / "env-root"),
        runtime_config_module.ENV_APP_MODE: "env-mode",
        runtime_config_module.ENV_ENVIRONMENT: "env-environment",
    }

    config = runtime_config_module.parse_runtime_config(
        [
            "--host",
            "127.0.0.1",
            "--port",
            "9012",
            "--app-mode",
            "desktop-cli",
            "--environment",
            "staging",
            "--root-dir",
            str(tmp_path / "cli-root"),
            "--user-data-dir",
            str(tmp_path / "cli-data"),
            "--config-dir",
            str(tmp_path / "cli-config"),
            "--logs-dir",
            str(tmp_path / "cli-logs"),
            "--database-dir",
            str(tmp_path / "cli-db"),
            "--state-dir",
            str(tmp_path / "cli-state"),
            "--debug-log-database-file",
            str(tmp_path / "cli-debug-log.sqlite3"),
            "--settings-file",
            str(tmp_path / "cli-settings.json"),
            "--host-log-file",
            str(tmp_path / "cli-host.log"),
            "--backend-stdout-log-file",
            str(tmp_path / "cli.stdout.log"),
            "--backend-stderr-log-file",
            str(tmp_path / "cli.stderr.log"),
            "--runtime-snapshot-file",
            str(tmp_path / "cli-snapshot.json"),
            "--last-failure-file",
            str(tmp_path / "cli-last-failure.json"),
            "--host-model-route-bridge-url",
            "http://127.0.0.1:45678/host/private/provider-routes/resolve",
            "--host-model-route-bridge-token",
            "bridge-token-123",
            "--host-capability-bridge-url",
            "http://127.0.0.1:45678/host/private/capability-bridge",
            "--host-capability-bridge-token",
            "capability-token-456",
            "--local-token",
            "cli-secret",
        ],
        env=env,
        cwd=tmp_path,
    )

    assert config.host == "127.0.0.1"
    assert config.port == 9012
    assert config.local_token == "cli-secret"
    assert config.host_model_route_bridge_url == "http://127.0.0.1:45678/host/private/provider-routes/resolve"
    assert config.host_model_route_bridge_token == "bridge-token-123"
    assert config.host_capability_bridge_url == "http://127.0.0.1:45678/host/private/capability-bridge"
    assert config.host_capability_bridge_token == "capability-token-456"
    assert config.user_data_dir == (tmp_path / "cli-data").resolve()
    assert config.runtime_root_dir == (tmp_path / "cli-root").resolve()
    assert config.config_dir == (tmp_path / "cli-config").resolve()
    assert config.logs_dir == (tmp_path / "cli-logs").resolve()
    assert config.database_dir == (tmp_path / "cli-db").resolve()
    assert config.state_dir == (tmp_path / "cli-state").resolve()
    assert config.debug_log_database_file == (tmp_path / "cli-debug-log.sqlite3").resolve()
    assert config.copilot_settings_file == (tmp_path / "cli-settings.json").resolve()
    assert config.host_log_file == (tmp_path / "cli-host.log").resolve()
    assert config.backend_stdout_log_file == (tmp_path / "cli.stdout.log").resolve()
    assert config.backend_stderr_log_file == (tmp_path / "cli.stderr.log").resolve()
    assert config.runtime_snapshot_file == (tmp_path / "cli-snapshot.json").resolve()
    assert config.last_failure_file == (tmp_path / "cli-last-failure.json").resolve()
    assert config.app_mode == "desktop-cli"
    assert config.environment == "staging"


def test_parse_runtime_config_ignores_retired_model_environment_variables(
    tmp_path: Path,
) -> None:
    config = runtime_config_module.parse_runtime_config(
        [],
        env={
            "COPILOT_RUNTIME_MODEL": "runtime-model",
            "COPILOT_MODEL": "legacy-model",
        },
        cwd=tmp_path,
    )

    assert "model" not in config.sanitized_summary()



def test_get_backend_version_prefers_explicit_runtime_env(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(runtime_config_module.ENV_BACKEND_VERSION, " 9.8.7 ")

    assert runtime_config_module.get_backend_version() == "9.8.7"



def test_get_backend_version_reads_bundled_manifest_when_package_metadata_absent(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    backend_dir = tmp_path / "python-runtime" / "backend"
    backend_dir.mkdir(parents=True)
    manifest_path = backend_dir.parent / "backend-runtime-manifest.json"
    manifest_path.write_text(
        '{"metadata":{"backendVersion":"2.3.4"}}',
        encoding="utf-8",
    )

    def raise_package_not_found(_package_name: str) -> str:
        raise PackageNotFoundError("backend")

    monkeypatch.delenv(runtime_config_module.ENV_BACKEND_VERSION, raising=False)
    monkeypatch.setattr(runtime_config_module, "BACKEND_DIR", backend_dir)
    monkeypatch.setattr(
        runtime_config_module,
        "read_package_version",
        raise_package_not_found,
    )

    assert runtime_config_module.get_backend_version() == "2.3.4"



def test_parse_runtime_config_rejects_retired_model_flag(tmp_path: Path) -> None:
    with pytest.raises(SystemExit):
        runtime_config_module.parse_runtime_config(["--model", "cli-model"], env={}, cwd=tmp_path)



def test_parse_runtime_config_rejects_non_loopback_host() -> None:
    with pytest.raises(ValueError, match="loopback"):
        runtime_config_module.parse_runtime_config(["--host", "0.0.0.0"], env={}, cwd=BACKEND_DIR)

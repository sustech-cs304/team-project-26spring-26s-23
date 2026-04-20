from __future__ import annotations

from pathlib import Path

import pytest

import app.desktop_runtime.config as runtime_config_module
from app.desktop_runtime.config import (
    DEFAULT_APP_MODE,
    DEFAULT_BACKEND_STDERR_LOG_FILE_NAME,
    DEFAULT_BACKEND_STDOUT_LOG_FILE_NAME,
    DEFAULT_CONFIG_DIR_NAME,
    DEFAULT_COPILOT_SETTINGS_FILE_NAME,
    DEFAULT_DATABASE_DIR_NAME,
    DEFAULT_DEBUG_LOG_DATABASE_FILE_NAME,
    DEFAULT_ENVIRONMENT,
    DEFAULT_HOST,
    DEFAULT_HOST_LOG_FILE_NAME,
    DEFAULT_LAST_FAILURE_FILE_NAME,
    DEFAULT_LOGS_DIR_NAME,
    DEFAULT_PORT,
    DEFAULT_RUNTIME_ROOT_DIR_NAME,
    DEFAULT_RUNTIME_SNAPSHOT_FILE_NAME,
    DEFAULT_STATE_DIR_NAME,
    DEFAULT_USER_DATA_DIR,
    ENV_APP_MODE,
    ENV_DATABASE_DIR,
    ENV_BACKEND_VERSION,
    ENV_DEBUG_LOG_DATABASE_FILE,
    ENV_ENVIRONMENT,
    ENV_HOST,
    ENV_HOST_CAPABILITY_BRIDGE_TOKEN,
    ENV_HOST_CAPABILITY_BRIDGE_URL,
    ENV_LOCAL_TOKEN,
    ENV_LOGS_DIR,
    ENV_PORT,
    ENV_ROOT_DIR,
    ENV_USER_DATA_DIR,
    get_backend_version,
    parse_runtime_config,
)
from importlib.metadata import PackageNotFoundError

BACKEND_DIR = Path(__file__).resolve().parents[3]


def test_parse_runtime_config_defaults_to_loopback_and_backend_data_dir() -> None:
    config = parse_runtime_config([], env={}, cwd=BACKEND_DIR)

    assert config.host == DEFAULT_HOST
    assert config.port == DEFAULT_PORT
    assert config.local_token is None
    assert config.host_model_route_bridge_url is None
    assert config.host_model_route_bridge_token is None
    assert config.host_capability_bridge_url is None
    assert config.host_capability_bridge_token is None
    assert config.app_mode == DEFAULT_APP_MODE
    assert config.environment == DEFAULT_ENVIRONMENT
    assert config.user_data_dir == DEFAULT_USER_DATA_DIR.resolve()
    assert config.runtime_root_dir == config.user_data_dir / DEFAULT_RUNTIME_ROOT_DIR_NAME
    assert config.config_dir == config.runtime_root_dir / DEFAULT_CONFIG_DIR_NAME
    assert config.logs_dir == config.runtime_root_dir / DEFAULT_LOGS_DIR_NAME
    assert config.database_dir == config.runtime_root_dir / DEFAULT_DATABASE_DIR_NAME
    assert config.state_dir == config.runtime_root_dir / DEFAULT_STATE_DIR_NAME
    assert config.debug_log_database_file == config.database_dir / DEFAULT_DEBUG_LOG_DATABASE_FILE_NAME
    assert config.copilot_settings_file == config.config_dir / DEFAULT_COPILOT_SETTINGS_FILE_NAME
    assert config.host_log_file == config.logs_dir / DEFAULT_HOST_LOG_FILE_NAME
    assert config.backend_stdout_log_file == config.logs_dir / DEFAULT_BACKEND_STDOUT_LOG_FILE_NAME
    assert config.backend_stderr_log_file == config.logs_dir / DEFAULT_BACKEND_STDERR_LOG_FILE_NAME
    assert config.runtime_snapshot_file == config.state_dir / DEFAULT_RUNTIME_SNAPSHOT_FILE_NAME
    assert config.last_failure_file == config.state_dir / DEFAULT_LAST_FAILURE_FILE_NAME
    assert config.sanitized_summary()["host_capability_bridge_configured"] is False
    assert "model" not in config.sanitized_summary()


def test_parse_runtime_config_reads_environment_values() -> None:
    env = {
        ENV_HOST: "localhost",
        ENV_PORT: "9988",
        ENV_LOCAL_TOKEN: "env-secret",
        ENV_USER_DATA_DIR: "runtime-state",
        ENV_ROOT_DIR: "runtime-state/runtime-root",
        ENV_LOGS_DIR: "runtime-state/logs-custom",
        ENV_DATABASE_DIR: "runtime-state/db-custom",
        ENV_DEBUG_LOG_DATABASE_FILE: "runtime-state/db-custom/debug-events.sqlite3",
        ENV_APP_MODE: "desktop-bundled",
        ENV_ENVIRONMENT: "production",
        ENV_HOST_CAPABILITY_BRIDGE_URL: "http://127.0.0.1:45678/host/private/capability-bridge",
        ENV_HOST_CAPABILITY_BRIDGE_TOKEN: "capability-token-123",
    }

    config = parse_runtime_config([], env=env, cwd=BACKEND_DIR)

    assert config.host == "localhost"
    assert config.port == 9988
    assert config.local_token == "env-secret"
    assert config.user_data_dir == (BACKEND_DIR / "runtime-state").resolve()
    assert config.runtime_root_dir == (BACKEND_DIR / "runtime-state" / "runtime-root").resolve()
    assert config.config_dir == config.runtime_root_dir / DEFAULT_CONFIG_DIR_NAME
    assert config.logs_dir == (BACKEND_DIR / "runtime-state" / "logs-custom").resolve()
    assert config.database_dir == (BACKEND_DIR / "runtime-state" / "db-custom").resolve()
    assert config.state_dir == config.runtime_root_dir / DEFAULT_STATE_DIR_NAME
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
    config = parse_runtime_config(
        [],
        env={
            ENV_HOST: "::1",
            ENV_PORT: "9988",
        },
        cwd=BACKEND_DIR,
    )

    assert config.host == "::1"
    assert config.port == 9988
    assert config.base_url == "http://[::1]:9988"


def test_cli_arguments_override_environment_values(tmp_path: Path) -> None:
    env = {
        ENV_HOST: "localhost",
        ENV_PORT: "9988",
        ENV_LOCAL_TOKEN: "env-secret",
        ENV_USER_DATA_DIR: str(tmp_path / "env-data"),
        ENV_ROOT_DIR: str(tmp_path / "env-root"),
        ENV_APP_MODE: "env-mode",
        ENV_ENVIRONMENT: "env-environment",
    }

    config = parse_runtime_config(
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
    config = parse_runtime_config(
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
    monkeypatch.setenv(ENV_BACKEND_VERSION, " 9.8.7 ")

    assert get_backend_version() == "9.8.7"



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

    monkeypatch.delenv(ENV_BACKEND_VERSION, raising=False)
    monkeypatch.setattr(runtime_config_module, "BACKEND_DIR", backend_dir)
    monkeypatch.setattr(
        runtime_config_module,
        "read_package_version",
        raise_package_not_found,
    )

    assert get_backend_version() == "2.3.4"



def test_parse_runtime_config_rejects_retired_model_flag(tmp_path: Path) -> None:
    with pytest.raises(SystemExit):
        parse_runtime_config(["--model", "cli-model"], env={}, cwd=tmp_path)



def test_parse_runtime_config_rejects_non_loopback_host() -> None:
    with pytest.raises(ValueError, match="loopback"):
        parse_runtime_config(["--host", "0.0.0.0"], env={}, cwd=BACKEND_DIR)

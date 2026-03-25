from __future__ import annotations

from pathlib import Path

import pytest

from app.desktop_runtime.config import (
    DEFAULT_APP_MODE,
    DEFAULT_BACKEND_STDERR_LOG_FILE_NAME,
    DEFAULT_BACKEND_STDOUT_LOG_FILE_NAME,
    DEFAULT_CONFIG_DIR_NAME,
    DEFAULT_COPILOT_SETTINGS_FILE_NAME,
    DEFAULT_DATABASE_DIR_NAME,
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
    ENV_ENVIRONMENT,
    ENV_HOST,
    ENV_LEGACY_MODEL,
    ENV_LOCAL_TOKEN,
    ENV_LOGS_DIR,
    ENV_MODEL,
    ENV_PORT,
    ENV_ROOT_DIR,
    ENV_USER_DATA_DIR,
    parse_runtime_config,
)

BACKEND_DIR = Path(__file__).resolve().parents[3]


def test_parse_runtime_config_defaults_to_loopback_and_backend_data_dir() -> None:
    config = parse_runtime_config([], env={}, cwd=BACKEND_DIR)

    assert config.host == DEFAULT_HOST
    assert config.port == DEFAULT_PORT
    assert config.local_token is None
    assert config.model is None
    assert config.app_mode == DEFAULT_APP_MODE
    assert config.environment == DEFAULT_ENVIRONMENT
    assert config.user_data_dir == DEFAULT_USER_DATA_DIR.resolve()
    assert config.runtime_root_dir == config.user_data_dir / DEFAULT_RUNTIME_ROOT_DIR_NAME
    assert config.config_dir == config.runtime_root_dir / DEFAULT_CONFIG_DIR_NAME
    assert config.logs_dir == config.runtime_root_dir / DEFAULT_LOGS_DIR_NAME
    assert config.database_dir == config.runtime_root_dir / DEFAULT_DATABASE_DIR_NAME
    assert config.state_dir == config.runtime_root_dir / DEFAULT_STATE_DIR_NAME
    assert config.copilot_settings_file == config.config_dir / DEFAULT_COPILOT_SETTINGS_FILE_NAME
    assert config.host_log_file == config.logs_dir / DEFAULT_HOST_LOG_FILE_NAME
    assert config.backend_stdout_log_file == config.logs_dir / DEFAULT_BACKEND_STDOUT_LOG_FILE_NAME
    assert config.backend_stderr_log_file == config.logs_dir / DEFAULT_BACKEND_STDERR_LOG_FILE_NAME
    assert config.runtime_snapshot_file == config.state_dir / DEFAULT_RUNTIME_SNAPSHOT_FILE_NAME
    assert config.last_failure_file == config.state_dir / DEFAULT_LAST_FAILURE_FILE_NAME


def test_parse_runtime_config_reads_environment_values() -> None:
    env = {
        ENV_HOST: "localhost",
        ENV_PORT: "9988",
        ENV_LOCAL_TOKEN: "env-secret",
        ENV_USER_DATA_DIR: "runtime-state",
        ENV_ROOT_DIR: "runtime-state/runtime-root",
        ENV_LOGS_DIR: "runtime-state/logs-custom",
        ENV_DATABASE_DIR: "runtime-state/db-custom",
        ENV_APP_MODE: "desktop-bundled",
        ENV_ENVIRONMENT: "production",
        ENV_MODEL: "env-runtime-model",
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
    assert config.app_mode == "desktop-bundled"
    assert config.environment == "production"
    assert config.model == "env-runtime-model"


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
        ENV_MODEL: "env-runtime-model",
        ENV_LEGACY_MODEL: "env-legacy-model",
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
            "--model",
            "cli-model",
            "--local-token",
            "cli-secret",
        ],
        env=env,
        cwd=tmp_path,
    )

    assert config.host == "127.0.0.1"
    assert config.port == 9012
    assert config.local_token == "cli-secret"
    assert config.model == "cli-model"
    assert config.user_data_dir == (tmp_path / "cli-data").resolve()
    assert config.runtime_root_dir == (tmp_path / "cli-root").resolve()
    assert config.config_dir == (tmp_path / "cli-config").resolve()
    assert config.logs_dir == (tmp_path / "cli-logs").resolve()
    assert config.database_dir == (tmp_path / "cli-db").resolve()
    assert config.state_dir == (tmp_path / "cli-state").resolve()
    assert config.copilot_settings_file == (tmp_path / "cli-settings.json").resolve()
    assert config.host_log_file == (tmp_path / "cli-host.log").resolve()
    assert config.backend_stdout_log_file == (tmp_path / "cli.stdout.log").resolve()
    assert config.backend_stderr_log_file == (tmp_path / "cli.stderr.log").resolve()
    assert config.runtime_snapshot_file == (tmp_path / "cli-snapshot.json").resolve()
    assert config.last_failure_file == (tmp_path / "cli-last-failure.json").resolve()
    assert config.app_mode == "desktop-cli"
    assert config.environment == "staging"


def test_parse_runtime_config_model_falls_back_to_environment_keys_in_priority_order(
    tmp_path: Path,
) -> None:
    runtime_env_config = parse_runtime_config(
        [],
        env={
            ENV_MODEL: "runtime-model",
            ENV_LEGACY_MODEL: "legacy-model",
        },
        cwd=tmp_path,
    )
    legacy_env_config = parse_runtime_config(
        [],
        env={ENV_LEGACY_MODEL: "legacy-model"},
        cwd=tmp_path,
    )

    assert runtime_env_config.model == "runtime-model"
    assert legacy_env_config.model == "legacy-model"



def test_parse_runtime_config_rejects_non_loopback_host() -> None:
    with pytest.raises(ValueError, match="loopback"):
        parse_runtime_config(["--host", "0.0.0.0"], env={}, cwd=BACKEND_DIR)

"""桌面运行时配置模型与启动参数解析。"""

from __future__ import annotations

import argparse
import json
import os
import tomllib
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from importlib.metadata import PackageNotFoundError, version as read_package_version
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[2]
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
DEFAULT_APP_MODE = "desktop"
DEFAULT_ENVIRONMENT = "development"
DEFAULT_USER_DATA_DIR = BACKEND_DIR / "data"
DEFAULT_RUNTIME_ROOT_DIR_NAME = "desktop-runtime"
DEFAULT_CONFIG_DIR_NAME = "config"
DEFAULT_LOGS_DIR_NAME = "logs"
DEFAULT_DATABASE_DIR_NAME = "database"
DEFAULT_STATE_DIR_NAME = "state"
DEFAULT_DEBUG_LOG_DATABASE_FILE_NAME = "copilot-debug-log.db"
DEFAULT_DEBUG_LOG_RETENTION_DAYS = 14
DEFAULT_DEBUG_LOG_MIN_CLEANUP_INTERVAL_SECONDS = 6 * 60 * 60
DEFAULT_COPILOT_SETTINGS_FILE_NAME = "copilot-settings.json"
DEFAULT_HOST_LOG_FILE_NAME = "electron-host.log"
DEFAULT_BACKEND_STDOUT_LOG_FILE_NAME = "backend.stdout.log"
DEFAULT_BACKEND_STDERR_LOG_FILE_NAME = "backend.stderr.log"
DEFAULT_RUNTIME_SNAPSHOT_FILE_NAME = "runtime-snapshot.json"
DEFAULT_LAST_FAILURE_FILE_NAME = "last-failure.json"
_LOCAL_AUTH_HEADER_NAME = "X-Local-Token"
LOCAL_TOKEN_HEADER_NAME = _LOCAL_AUTH_HEADER_NAME

ENV_HOST = "COPILOT_DESKTOP_RUNTIME_HOST"
ENV_PORT = "COPILOT_DESKTOP_RUNTIME_PORT"
_DESKTOP_RUNTIME_LOCAL_AUTH_ENV_NAME = "COPILOT_DESKTOP_RUNTIME_LOCAL_TOKEN"
ENV_LOCAL_TOKEN = _DESKTOP_RUNTIME_LOCAL_AUTH_ENV_NAME
ENV_USER_DATA_DIR = "COPILOT_DESKTOP_RUNTIME_USER_DATA_DIR"
ENV_ROOT_DIR = "COPILOT_DESKTOP_RUNTIME_ROOT_DIR"
ENV_CONFIG_DIR = "COPILOT_DESKTOP_RUNTIME_CONFIG_DIR"
ENV_LOGS_DIR = "COPILOT_DESKTOP_RUNTIME_LOGS_DIR"
ENV_DATABASE_DIR = "COPILOT_DESKTOP_RUNTIME_DATABASE_DIR"
ENV_STATE_DIR = "COPILOT_DESKTOP_RUNTIME_STATE_DIR"
ENV_DEBUG_LOG_DATABASE_FILE = "COPILOT_DESKTOP_RUNTIME_DEBUG_LOG_DATABASE_FILE"
ENV_BACKEND_VERSION = "COPILOT_DESKTOP_RUNTIME_BACKEND_VERSION"
ENV_DEBUG_LOG_RETENTION_DAYS = "COPILOT_DESKTOP_RUNTIME_DEBUG_LOG_RETENTION_DAYS"
ENV_DEBUG_LOG_AUTO_CLEANUP_ENABLED = (
    "COPILOT_DESKTOP_RUNTIME_DEBUG_LOG_AUTO_CLEANUP_ENABLED"
)
ENV_DEBUG_LOG_MIN_CLEANUP_INTERVAL_SECONDS = (
    "COPILOT_DESKTOP_RUNTIME_DEBUG_LOG_MIN_CLEANUP_INTERVAL_SECONDS"
)
ENV_DEBUG_LOG_SNAPSHOT_RETENTION_DAYS = (
    "COPILOT_DESKTOP_RUNTIME_DEBUG_LOG_SNAPSHOT_RETENTION_DAYS"
)
ENV_COPILOT_SETTINGS_FILE = "COPILOT_DESKTOP_RUNTIME_SETTINGS_FILE"
ENV_HOST_LOG_FILE = "COPILOT_DESKTOP_RUNTIME_HOST_LOG_FILE"
ENV_BACKEND_STDOUT_LOG_FILE = "COPILOT_DESKTOP_RUNTIME_BACKEND_STDOUT_LOG_FILE"
ENV_BACKEND_STDERR_LOG_FILE = "COPILOT_DESKTOP_RUNTIME_BACKEND_STDERR_LOG_FILE"
ENV_RUNTIME_SNAPSHOT_FILE = "COPILOT_DESKTOP_RUNTIME_SNAPSHOT_FILE"
ENV_LAST_FAILURE_FILE = "COPILOT_DESKTOP_RUNTIME_LAST_FAILURE_FILE"
ENV_APP_MODE = "COPILOT_DESKTOP_RUNTIME_APP_MODE"
ENV_ENVIRONMENT = "COPILOT_DESKTOP_RUNTIME_ENVIRONMENT"
ENV_HOST_CAPABILITY_BRIDGE_URL = "COPILOT_DESKTOP_RUNTIME_HOST_CAPABILITY_BRIDGE_URL"
_DESKTOP_RUNTIME_HOST_CAPABILITY_BRIDGE_AUTH_ENV_NAME = (
    "COPILOT_DESKTOP_RUNTIME_HOST_CAPABILITY_BRIDGE_TOKEN"
)
ENV_HOST_CAPABILITY_BRIDGE_TOKEN = _DESKTOP_RUNTIME_HOST_CAPABILITY_BRIDGE_AUTH_ENV_NAME

_ALLOWED_LOOPBACK_HOSTS = {DEFAULT_HOST, "localhost", "::1"}


@dataclass(slots=True)
class DesktopRuntimePaths:
    """桌面运行时目录与宿主/后端共享文件路径。"""

    user_data_dir: Path
    runtime_root_dir: Path
    config_dir: Path
    logs_dir: Path
    database_dir: Path
    state_dir: Path
    debug_log_database_file: Path
    copilot_settings_file: Path
    host_log_file: Path
    backend_stdout_log_file: Path
    backend_stderr_log_file: Path
    runtime_snapshot_file: Path
    last_failure_file: Path

    def ensure_directories(self) -> list[Path]:
        directories = [
            self.user_data_dir,
            self.runtime_root_dir,
            self.config_dir,
            self.logs_dir,
            self.database_dir,
            self.state_dir,
        ]
        for directory in directories:
            directory.mkdir(parents=True, exist_ok=True)
        return directories

    def sanitized_summary(self) -> dict[str, str]:
        return {
            "user_data_dir": self.user_data_dir.as_posix(),
            "runtime_root_dir": self.runtime_root_dir.as_posix(),
            "config_dir": self.config_dir.as_posix(),
            "logs_dir": self.logs_dir.as_posix(),
            "database_dir": self.database_dir.as_posix(),
            "state_dir": self.state_dir.as_posix(),
            "debug_log_database_file": self.debug_log_database_file.as_posix(),
            "copilot_settings_file": self.copilot_settings_file.as_posix(),
            "host_log_file": self.host_log_file.as_posix(),
            "backend_stdout_log_file": self.backend_stdout_log_file.as_posix(),
            "backend_stderr_log_file": self.backend_stderr_log_file.as_posix(),
            "runtime_snapshot_file": self.runtime_snapshot_file.as_posix(),
            "last_failure_file": self.last_failure_file.as_posix(),
        }


@dataclass(slots=True)
class DesktopRuntimeConfig:
    """桌面宿主最小 HTTP 运行时配置。"""

    host: str
    port: int
    local_token: str | None
    paths: DesktopRuntimePaths
    app_mode: str
    environment: str
    debug_log_retention_days: int = DEFAULT_DEBUG_LOG_RETENTION_DAYS
    debug_log_auto_cleanup_enabled: bool = True
    debug_log_min_cleanup_interval_seconds: int = (
        DEFAULT_DEBUG_LOG_MIN_CLEANUP_INTERVAL_SECONDS
    )
    debug_log_snapshot_retention_days: int | None = None
    host_model_route_bridge_url: str | None = None
    host_model_route_bridge_token: str | None = None
    host_capability_bridge_url: str | None = None
    host_capability_bridge_token: str | None = None
    backend_dir: Path = BACKEND_DIR

    @property
    def user_data_dir(self) -> Path:
        return self.paths.user_data_dir

    @property
    def runtime_root_dir(self) -> Path:
        return self.paths.runtime_root_dir

    @property
    def config_dir(self) -> Path:
        return self.paths.config_dir

    @property
    def logs_dir(self) -> Path:
        return self.paths.logs_dir

    @property
    def database_dir(self) -> Path:
        return self.paths.database_dir

    @property
    def state_dir(self) -> Path:
        return self.paths.state_dir

    @property
    def debug_log_database_file(self) -> Path:
        return self.paths.debug_log_database_file

    @property
    def copilot_settings_file(self) -> Path:
        return self.paths.copilot_settings_file

    @property
    def host_log_file(self) -> Path:
        return self.paths.host_log_file

    @property
    def backend_stdout_log_file(self) -> Path:
        return self.paths.backend_stdout_log_file

    @property
    def backend_stderr_log_file(self) -> Path:
        return self.paths.backend_stderr_log_file

    @property
    def runtime_snapshot_file(self) -> Path:
        return self.paths.runtime_snapshot_file

    @property
    def last_failure_file(self) -> Path:
        return self.paths.last_failure_file

    @property
    def base_url(self) -> str:
        host = DEFAULT_HOST if self.host == "localhost" else self.host
        host_for_url = f"[{host}]" if ":" in host and not host.startswith("[") else host
        return f"http://{host_for_url}:{self.port}"

    def ensure_directories(self) -> list[Path]:
        return self.paths.ensure_directories()

    def sanitized_summary(self) -> dict[str, object]:
        return {
            "host": self.host,
            "port": self.port,
            "base_url": self.base_url,
            "app_mode": self.app_mode,
            "environment": self.environment,
            "debug_log_retention_days": self.debug_log_retention_days,
            "debug_log_auto_cleanup_enabled": self.debug_log_auto_cleanup_enabled,
            "debug_log_min_cleanup_interval_seconds": self.debug_log_min_cleanup_interval_seconds,
            "debug_log_snapshot_retention_days": self.debug_log_snapshot_retention_days,
            "host_model_route_bridge_configured": bool(
                self.host_model_route_bridge_url and self.host_model_route_bridge_token
            ),
            "host_capability_bridge_configured": bool(
                self.host_capability_bridge_url and self.host_capability_bridge_token
            ),
            "paths": self.paths.sanitized_summary(),
            "local_token_configured": bool(self.local_token),
            "local_token_header": LOCAL_TOKEN_HEADER_NAME,
        }


def get_backend_version() -> str:
    """优先从已安装包、bundled manifest 或显式运行时元数据读取版本。"""

    configured_version = _normalize_optional_text(os.environ.get(ENV_BACKEND_VERSION))
    if configured_version is not None:
        return configured_version

    try:
        return read_package_version("backend")
    except PackageNotFoundError:
        return (
            _read_bundled_runtime_manifest_version(
                BACKEND_DIR.parent / "backend-runtime-manifest.json"
            )
            or _read_backend_project_version(BACKEND_DIR / "pyproject.toml")
            or "0.1.0"
        )


def _read_bundled_runtime_manifest_version(manifest_path: Path) -> str | None:
    if not manifest_path.exists():
        return None
    with manifest_path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        return None
    metadata = data.get("metadata")
    if not isinstance(metadata, dict):
        return None
    return _normalize_optional_text(metadata.get("backendVersion"))


def _read_backend_project_version(pyproject_path: Path) -> str | None:
    if not pyproject_path.exists():
        return None
    with pyproject_path.open("rb") as handle:
        data = tomllib.load(handle)
    project = data.get("project", {})
    version = project.get("version")
    return _normalize_optional_text(version)


def build_runtime_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="启动桌面宿主使用的本地 HTTP 运行时")
    parser.add_argument(
        "--host",
        default=None,
        help="监听地址，仅允许 loopback 地址，例如 127.0.0.1 或 localhost",
    )
    parser.add_argument("--port", type=int, default=None, help="监听端口")
    parser.add_argument("--app-mode", default=None, help="应用模式，例如 desktop")
    parser.add_argument(
        "--environment", default=None, help="运行环境，例如 development 或 production"
    )
    parser.add_argument(
        "--root-dir", dest="root_dir", default=None, help="桌面运行时根目录"
    )
    parser.add_argument(
        "--runtime-root-dir", dest="root_dir", default=None, help=argparse.SUPPRESS
    )
    parser.add_argument(
        "--user-data-dir", default=None, help="Electron userData 根目录"
    )
    parser.add_argument("--config-dir", default=None, help="桌面运行时配置目录")
    parser.add_argument("--logs-dir", default=None, help="日志目录")
    parser.add_argument("--database-dir", default=None, help="数据库目录")
    parser.add_argument("--state-dir", default=None, help="诊断与状态目录")
    parser.add_argument(
        "--debug-log-database-file", default=None, help="调试日志 SQLite 文件路径"
    )
    parser.add_argument(
        "--debug-log-retention-days", type=int, default=None, help="调试日志保留天数"
    )
    parser.add_argument(
        "--debug-log-auto-cleanup-enabled",
        default=None,
        help="是否启用调试日志自动清理，支持 true/false",
    )
    parser.add_argument(
        "--debug-log-min-cleanup-interval-seconds",
        type=int,
        default=None,
        help="调试日志自动清理最小间隔秒数",
    )
    parser.add_argument(
        "--debug-log-snapshot-retention-days",
        type=int,
        default=None,
        help="可选详细快照保留天数",
    )
    parser.add_argument("--settings-file", default=None, help="Copilot 设置文件路径")
    parser.add_argument(
        "--host-log-file", default=None, help="Electron 主进程日志文件路径"
    )
    parser.add_argument(
        "--backend-stdout-log-file",
        default=None,
        help="Python 子进程 stdout 日志文件路径",
    )
    parser.add_argument(
        "--backend-stderr-log-file",
        default=None,
        help="Python 子进程 stderr 日志文件路径",
    )
    parser.add_argument(
        "--runtime-snapshot-file", default=None, help="运行态快照文件路径"
    )
    parser.add_argument(
        "--last-failure-file", default=None, help="最近失败摘要文件路径"
    )
    parser.add_argument(
        "--host-model-route-bridge-url",
        dest="host_model_route_bridge_url",
        default=None,
        help="宿主私有 provider 路由解析桥地址，仅供本地 Python runtime 使用",
    )
    parser.add_argument(
        "--host-model-route-bridge-token",
        dest="host_model_route_bridge_token",
        default=None,
        help="宿主私有 provider 路由解析桥访问令牌，仅供本地 Python runtime 使用",
    )
    parser.add_argument(
        "--host-capability-bridge-url",
        dest="host_capability_bridge_url",
        default=None,
        help="宿主私有 capability bridge 地址，仅供本地 Python runtime 使用",
    )
    parser.add_argument(
        "--host-capability-bridge-token",
        dest="host_capability_bridge_token",
        default=None,
        help="宿主私有 capability bridge 访问令牌，仅供本地 Python runtime 使用",
    )
    parser.add_argument(
        "--local-token",
        default=None,
        help="本地宿主调用令牌，可选；若提供，将保护 diagnostics 端点",
    )
    return parser


def parse_runtime_config(
    argv: Sequence[str] | None = None,
    *,
    env: Mapping[str, str] | None = None,
    cwd: Path | None = None,
) -> DesktopRuntimeConfig:
    parser = build_runtime_argument_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    env_map = env or {}
    base_dir = (cwd or BACKEND_DIR).resolve()

    host = _resolve_host(args.host, env_map)
    port = _resolve_port(args.port, env_map)
    local_token = _resolve_optional_text_value(
        args.local_token, env_map, ENV_LOCAL_TOKEN
    )
    host_model_route_bridge_url = _resolve_optional_text_value(
        args.host_model_route_bridge_url, env_map
    )
    host_model_route_bridge_token = _resolve_optional_text_value(
        args.host_model_route_bridge_token, env_map
    )
    host_capability_bridge_url = _resolve_optional_text_value(
        args.host_capability_bridge_url,
        env_map,
        ENV_HOST_CAPABILITY_BRIDGE_URL,
    )
    host_capability_bridge_token = _resolve_optional_text_value(
        args.host_capability_bridge_token,
        env_map,
        ENV_HOST_CAPABILITY_BRIDGE_TOKEN,
    )

    user_data_dir = _resolve_path(
        _resolve_optional_text_value(args.user_data_dir, env_map, ENV_USER_DATA_DIR),
        cwd=base_dir,
        fallback=DEFAULT_USER_DATA_DIR,
    )
    runtime_root_dir = _resolve_path(
        _resolve_optional_text_value(args.root_dir, env_map, ENV_ROOT_DIR),
        cwd=base_dir,
        fallback=user_data_dir / DEFAULT_RUNTIME_ROOT_DIR_NAME,
    )
    config_dir = _resolve_path(
        _resolve_optional_text_value(args.config_dir, env_map, ENV_CONFIG_DIR),
        cwd=base_dir,
        fallback=runtime_root_dir / DEFAULT_CONFIG_DIR_NAME,
    )
    logs_dir = _resolve_path(
        _resolve_optional_text_value(args.logs_dir, env_map, ENV_LOGS_DIR),
        cwd=base_dir,
        fallback=runtime_root_dir / DEFAULT_LOGS_DIR_NAME,
    )
    database_dir = _resolve_path(
        _resolve_optional_text_value(args.database_dir, env_map, ENV_DATABASE_DIR),
        cwd=base_dir,
        fallback=runtime_root_dir / DEFAULT_DATABASE_DIR_NAME,
    )
    state_dir = _resolve_path(
        _resolve_optional_text_value(args.state_dir, env_map, ENV_STATE_DIR),
        cwd=base_dir,
        fallback=runtime_root_dir / DEFAULT_STATE_DIR_NAME,
    )
    debug_log_database_file = _resolve_path(
        _resolve_optional_text_value(
            args.debug_log_database_file, env_map, ENV_DEBUG_LOG_DATABASE_FILE
        ),
        cwd=base_dir,
        fallback=database_dir / DEFAULT_DEBUG_LOG_DATABASE_FILE_NAME,
    )
    debug_log_retention_days = _resolve_positive_int_value(
        args.debug_log_retention_days,
        env_map,
        ENV_DEBUG_LOG_RETENTION_DAYS,
        default=DEFAULT_DEBUG_LOG_RETENTION_DAYS,
        field_name="debug log retention days",
    )
    debug_log_auto_cleanup_enabled = _resolve_bool_value(
        args.debug_log_auto_cleanup_enabled,
        env_map,
        ENV_DEBUG_LOG_AUTO_CLEANUP_ENABLED,
        default=True,
        field_name="debug log auto cleanup enabled",
    )
    debug_log_min_cleanup_interval_seconds = _resolve_non_negative_int_value(
        args.debug_log_min_cleanup_interval_seconds,
        env_map,
        ENV_DEBUG_LOG_MIN_CLEANUP_INTERVAL_SECONDS,
        default=DEFAULT_DEBUG_LOG_MIN_CLEANUP_INTERVAL_SECONDS,
        field_name="debug log min cleanup interval seconds",
    )
    debug_log_snapshot_retention_days = _resolve_optional_positive_int_value(
        args.debug_log_snapshot_retention_days,
        env_map,
        ENV_DEBUG_LOG_SNAPSHOT_RETENTION_DAYS,
        field_name="debug log snapshot retention days",
    )
    copilot_settings_file = _resolve_path(
        _resolve_optional_text_value(
            args.settings_file, env_map, ENV_COPILOT_SETTINGS_FILE
        ),
        cwd=base_dir,
        fallback=config_dir / DEFAULT_COPILOT_SETTINGS_FILE_NAME,
    )
    host_log_file = _resolve_path(
        _resolve_optional_text_value(args.host_log_file, env_map, ENV_HOST_LOG_FILE),
        cwd=base_dir,
        fallback=logs_dir / DEFAULT_HOST_LOG_FILE_NAME,
    )
    backend_stdout_log_file = _resolve_path(
        _resolve_optional_text_value(
            args.backend_stdout_log_file, env_map, ENV_BACKEND_STDOUT_LOG_FILE
        ),
        cwd=base_dir,
        fallback=logs_dir / DEFAULT_BACKEND_STDOUT_LOG_FILE_NAME,
    )
    backend_stderr_log_file = _resolve_path(
        _resolve_optional_text_value(
            args.backend_stderr_log_file, env_map, ENV_BACKEND_STDERR_LOG_FILE
        ),
        cwd=base_dir,
        fallback=logs_dir / DEFAULT_BACKEND_STDERR_LOG_FILE_NAME,
    )
    runtime_snapshot_file = _resolve_path(
        _resolve_optional_text_value(
            args.runtime_snapshot_file, env_map, ENV_RUNTIME_SNAPSHOT_FILE
        ),
        cwd=base_dir,
        fallback=state_dir / DEFAULT_RUNTIME_SNAPSHOT_FILE_NAME,
    )
    last_failure_file = _resolve_path(
        _resolve_optional_text_value(
            args.last_failure_file, env_map, ENV_LAST_FAILURE_FILE
        ),
        cwd=base_dir,
        fallback=state_dir / DEFAULT_LAST_FAILURE_FILE_NAME,
    )

    app_mode = (
        _resolve_optional_text_value(args.app_mode, env_map, ENV_APP_MODE)
        or DEFAULT_APP_MODE
    )
    environment = (
        _resolve_optional_text_value(args.environment, env_map, ENV_ENVIRONMENT)
        or DEFAULT_ENVIRONMENT
    )

    return DesktopRuntimeConfig(
        host=host,
        port=port,
        local_token=local_token,
        paths=DesktopRuntimePaths(
            user_data_dir=user_data_dir,
            runtime_root_dir=runtime_root_dir,
            config_dir=config_dir,
            logs_dir=logs_dir,
            database_dir=database_dir,
            state_dir=state_dir,
            debug_log_database_file=debug_log_database_file,
            copilot_settings_file=copilot_settings_file,
            host_log_file=host_log_file,
            backend_stdout_log_file=backend_stdout_log_file,
            backend_stderr_log_file=backend_stderr_log_file,
            runtime_snapshot_file=runtime_snapshot_file,
            last_failure_file=last_failure_file,
        ),
        app_mode=app_mode,
        environment=environment,
        debug_log_retention_days=debug_log_retention_days,
        debug_log_auto_cleanup_enabled=debug_log_auto_cleanup_enabled,
        debug_log_min_cleanup_interval_seconds=debug_log_min_cleanup_interval_seconds,
        debug_log_snapshot_retention_days=debug_log_snapshot_retention_days,
        host_model_route_bridge_url=host_model_route_bridge_url,
        host_model_route_bridge_token=host_model_route_bridge_token,
        host_capability_bridge_url=host_capability_bridge_url,
        host_capability_bridge_token=host_capability_bridge_token,
    )


def _normalize_optional_text(value: object | None) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _normalize_int_parseable_value(value: object | None) -> int | str | None:
    if value is None:
        return None
    if isinstance(value, int):
        return value
    normalized = _normalize_optional_text(value)
    return normalized


def _resolve_optional_text_value(
    cli_value: object | None,
    env: Mapping[str, str],
    *env_keys: str,
) -> str | None:
    normalized_cli_value = _normalize_optional_text(cli_value)
    if normalized_cli_value is not None:
        return normalized_cli_value

    for env_key in env_keys:
        normalized_env_value = _normalize_optional_text(env.get(env_key))
        if normalized_env_value is not None:
            return normalized_env_value

    return None


def _resolve_host(cli_value: str | None, env: Mapping[str, str]) -> str:
    raw_host = _resolve_optional_text_value(cli_value, env, ENV_HOST) or DEFAULT_HOST
    host = raw_host.lower()
    if host not in _ALLOWED_LOOPBACK_HOSTS:
        allowed = ", ".join(sorted(_ALLOWED_LOOPBACK_HOSTS))
        raise ValueError(
            f"Desktop runtime host must stay on loopback: {raw_host!r}. Allowed: {allowed}"
        )
    return host


def _resolve_port(cli_value: int | None, env: Mapping[str, str]) -> int:
    raw_value: object | None = cli_value if cli_value is not None else env.get(ENV_PORT)
    if raw_value is None:
        return DEFAULT_PORT

    try:
        port = int(raw_value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Invalid desktop runtime port: {raw_value!r}") from exc

    if not 1 <= port <= 65535:
        raise ValueError(f"Desktop runtime port must be between 1 and 65535: {port}")
    return port


def _resolve_bool_value(
    cli_value: object | None,
    env: Mapping[str, str],
    env_key: str,
    *,
    default: bool,
    field_name: str,
) -> bool:
    raw_value: object | None = cli_value if cli_value is not None else env.get(env_key)
    if raw_value is None:
        return default

    normalized = str(raw_value).strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"Invalid {field_name}: {raw_value!r}")


def _resolve_positive_int_value(
    cli_value: object | None,
    env: Mapping[str, str],
    env_key: str,
    *,
    default: int,
    field_name: str,
) -> int:
    raw_value = _normalize_int_parseable_value(
        cli_value if cli_value is not None else env.get(env_key)
    )
    if raw_value is None:
        return default
    try:
        resolved = int(raw_value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Invalid {field_name}: {raw_value!r}") from exc
    if resolved <= 0:
        raise ValueError(
            f"{field_name.capitalize()} must be greater than 0: {resolved}"
        )
    return resolved


def _resolve_non_negative_int_value(
    cli_value: object | None,
    env: Mapping[str, str],
    env_key: str,
    *,
    default: int,
    field_name: str,
) -> int:
    raw_value = _normalize_int_parseable_value(
        cli_value if cli_value is not None else env.get(env_key)
    )
    if raw_value is None:
        return default
    try:
        resolved = int(raw_value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Invalid {field_name}: {raw_value!r}") from exc
    if resolved < 0:
        raise ValueError(f"{field_name.capitalize()} must be non-negative: {resolved}")
    return resolved


def _resolve_optional_positive_int_value(
    cli_value: object | None,
    env: Mapping[str, str],
    env_key: str,
    *,
    field_name: str,
) -> int | None:
    raw_value = _normalize_int_parseable_value(
        cli_value if cli_value is not None else env.get(env_key)
    )
    if raw_value is None:
        return None
    try:
        resolved = int(raw_value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Invalid {field_name}: {raw_value!r}") from exc
    if resolved <= 0:
        raise ValueError(
            f"{field_name.capitalize()} must be greater than 0: {resolved}"
        )
    return resolved


def _resolve_path(value: str | None, *, cwd: Path, fallback: Path) -> Path:
    raw_value = _normalize_optional_text(value)
    path = Path(raw_value).expanduser() if raw_value is not None else fallback
    if not path.is_absolute():
        path = cwd / path
    return path.resolve()

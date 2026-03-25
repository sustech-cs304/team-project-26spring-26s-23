"""桌面运行时最小 HTTP 契约。"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, cast


class RuntimeContract:
    def to_dict(self) -> dict[str, Any]:
        return _jsonable(asdict(cast(Any, self)))


@dataclass(slots=True)
class HealthContract(RuntimeContract):
    service: str
    status: str
    ready: bool
    transport: str = "loopback-http"


@dataclass(slots=True)
class ReadinessContract(RuntimeContract):
    service: str
    status: str
    ready: bool
    startup_complete: bool
    last_error: str | None = None


@dataclass(slots=True)
class VersionContract(RuntimeContract):
    service: str
    version: str
    python_version: str
    app_mode: str
    environment: str
    build: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class DiagnosticsContract(RuntimeContract):
    service: str
    status: str
    runtime: dict[str, Any]
    configuration: dict[str, Any]
    auth: dict[str, Any]
    capabilities: dict[str, Any]


def _jsonable(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat(timespec="seconds")
    if isinstance(value, Path):
        return value.as_posix()
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_jsonable(item) for item in value]
    if hasattr(value, "to_dict"):
        return _jsonable(value.to_dict())
    return value

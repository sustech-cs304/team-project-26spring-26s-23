"""桌面运行时启动、关闭与 ready 状态管理。"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from .config import DesktopRuntimeConfig


@dataclass(slots=True)
class RuntimeLifecycleState:
    started_at: datetime | None = None
    stopped_at: datetime | None = None
    ready: bool = False
    startup_complete: bool = False
    last_error: str | None = None
    initialized_directories: list[Path] = field(default_factory=list)


class RuntimeLifecycleManager:
    """只管理桌面运行时自身的基础资源，不侵入现有业务模块。"""

    def __init__(self, config: DesktopRuntimeConfig) -> None:
        self.config = config
        self.state = RuntimeLifecycleState()

    @property
    def is_ready(self) -> bool:
        return self.state.ready

    @property
    def status(self) -> str:
        if self.state.ready:
            return "ready"
        if self.state.last_error:
            return "failed"
        if self.state.startup_complete:
            return "stopped"
        return "starting"

    def startup(self) -> None:
        try:
            self.state.initialized_directories = self.config.ensure_directories()
            self.state.started_at = datetime.now(UTC)
            self.state.stopped_at = None
            self.state.ready = True
            self.state.startup_complete = True
            self.state.last_error = None
        except Exception as exc:
            self.state.ready = False
            self.state.startup_complete = False
            self.state.last_error = f"{type(exc).__name__}: {exc}"
            raise

    def shutdown(self) -> None:
        self.state.ready = False
        self.state.stopped_at = datetime.now(UTC)

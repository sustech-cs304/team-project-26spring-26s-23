"""TIS 自有日志实现。"""

from __future__ import annotations

import json
import traceback
from dataclasses import dataclass, field
from typing import Any, Callable, Literal, Protocol, cast

from .text import _normalize_mapping, _utcnow_iso

TISLogLevel = Literal["debug", "info", "warning", "error"]
_TIS_LEVEL_VALUES: dict[str, int] = {
    "debug": 10,
    "info": 20,
    "warning": 30,
    "error": 40,
}


class TISLogSink(Protocol):
    def emit(self, event: "TISLogEvent") -> None: ...


TISLogSinkCallable = Callable[["TISLogEvent"], None]
TISLogWriter = Callable[[str], None]


@dataclass(slots=True)
class TISLogEvent:
    timestamp: str
    level: TISLogLevel
    layer: str
    source: str
    message: str
    context: dict[str, Any] = field(default_factory=dict)
    payload: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "timestamp": self.timestamp,
            "level": self.level,
            "layer": self.layer,
            "source": self.source,
            "message": self.message,
            "context": dict(self.context),
            "payload": None if self.payload is None else dict(self.payload),
        }

    def format_console_line(self) -> str:
        headline = f"[{self.timestamp}] {self.level.upper():<7} [{self.layer}] {self.source}: {self.message}"
        segments: list[str] = []
        if self.context:
            segments.append(
                f"context={json.dumps(self.context, ensure_ascii=False, sort_keys=True, default=str)}"
            )
        if self.payload:
            segments.append(
                f"payload={json.dumps(self.payload, ensure_ascii=False, sort_keys=True, default=str)}"
            )
        if not segments:
            return headline
        return f"{headline} | {'; '.join(segments)}"


@dataclass(slots=True)
class TISLogCollector:
    events: list[TISLogEvent] = field(default_factory=list)

    def emit(self, event: TISLogEvent) -> None:
        self.events.append(event)

    def snapshot(self) -> list[TISLogEvent]:
        return list(self.events)

    def to_dicts(self) -> list[dict[str, Any]]:
        return [event.to_dict() for event in self.events]


@dataclass(slots=True)
class TISConsoleSink:
    min_level: TISLogLevel = "info"
    writer: TISLogWriter | None = None

    def emit(self, event: TISLogEvent) -> None:
        if _TIS_LEVEL_VALUES.get(str(event.level), 100) < _TIS_LEVEL_VALUES.get(
            self.min_level, 20
        ):
            return
        output = self.writer or print
        output(event.format_console_line())


@dataclass(slots=True)
class TISLogger:
    layer: str
    source: str
    sinks: tuple[TISLogSink | TISLogSinkCallable, ...] = ()
    context: dict[str, Any] = field(default_factory=dict)

    def bind(self, **context: Any) -> "TISLogger":
        return TISLogger(
            layer=self.layer,
            source=self.source,
            sinks=self.sinks,
            context={**self.context, **_normalize_mapping(context)},
        )

    def child(self, source: str, **context: Any) -> "TISLogger":
        return TISLogger(
            layer=self.layer,
            source=source,
            sinks=self.sinks,
            context={**self.context, **_normalize_mapping(context)},
        )

    def log(
        self,
        level: TISLogLevel,
        message: str,
        *,
        payload: dict[str, Any] | None = None,
        context: dict[str, Any] | None = None,
    ) -> TISLogEvent:
        event = TISLogEvent(
            timestamp=_utcnow_iso(),
            level=level,
            layer=self.layer,
            source=self.source,
            message=str(message),
            context={**self.context, **_normalize_mapping(context)},
            payload=_normalize_mapping(payload) or None,
        )
        for sink in self.sinks:
            if hasattr(sink, "emit"):
                cast(TISLogSink, sink).emit(event)
            else:
                cast(TISLogSinkCallable, sink)(event)
        return event

    def debug(
        self,
        message: str,
        *,
        payload: dict[str, Any] | None = None,
        context: dict[str, Any] | None = None,
    ) -> TISLogEvent:
        return self.log("debug", message, payload=payload, context=context)

    def info(
        self,
        message: str,
        *,
        payload: dict[str, Any] | None = None,
        context: dict[str, Any] | None = None,
    ) -> TISLogEvent:
        return self.log("info", message, payload=payload, context=context)

    def warning(
        self,
        message: str,
        *,
        payload: dict[str, Any] | None = None,
        context: dict[str, Any] | None = None,
    ) -> TISLogEvent:
        return self.log("warning", message, payload=payload, context=context)

    def error(
        self,
        message: str,
        *,
        payload: dict[str, Any] | None = None,
        context: dict[str, Any] | None = None,
    ) -> TISLogEvent:
        return self.log("error", message, payload=payload, context=context)

    def exception(
        self,
        message: str,
        error: BaseException,
        *,
        payload: dict[str, Any] | None = None,
        context: dict[str, Any] | None = None,
    ) -> TISLogEvent:
        exception_payload = {
            "error_type": type(error).__name__,
            "error": str(error),
            "traceback": traceback.format_exc(),
        }
        if payload:
            exception_payload.update(_normalize_mapping(payload))
        return self.log("error", message, payload=exception_payload, context=context)


@dataclass(slots=True)
class TISLogSession:
    collector: TISLogCollector = field(default_factory=TISLogCollector)
    console_sink: TISConsoleSink | None = None

    def make_logger(
        self, *, layer: str, source: str, context: dict[str, Any] | None = None
    ) -> TISLogger:
        sinks: list[TISLogSink | TISLogSinkCallable] = [self.collector]
        if self.console_sink is not None:
            sinks.append(self.console_sink)
        return TISLogger(
            layer=layer,
            source=source,
            sinks=tuple(sinks),
            context=_normalize_mapping(context),
        )

    def snapshot(self) -> list[TISLogEvent]:
        return self.collector.snapshot()

    def to_dicts(self) -> list[dict[str, Any]]:
        return self.collector.to_dicts()


def create_tis_log_session(
    *,
    console: bool = False,
    min_level: TISLogLevel = "info",
    writer: TISLogWriter | None = None,
) -> TISLogSession:
    console_sink = (
        TISConsoleSink(min_level=min_level, writer=writer) if console else None
    )
    return TISLogSession(console_sink=console_sink)


__all__ = [
    "TISConsoleSink",
    "TISLogCollector",
    "TISLogEvent",
    "TISLogLevel",
    "TISLogger",
    "TISLogSession",
    "create_tis_log_session",
]

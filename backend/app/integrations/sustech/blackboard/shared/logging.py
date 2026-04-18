from __future__ import annotations

import json
import traceback
from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Callable, Literal, Protocol, cast

LogLevel = Literal["debug", "info", "warning", "error"]
LogLayer = Literal["api", "data", "provider", "cli"]

_LEVEL_VALUES: dict[str, int] = {
    "debug": 10,
    "info": 20,
    "warning": 30,
    "error": 40,
}


class BlackboardLogSink(Protocol):
    def emit(self, event: "BlackboardLogEvent") -> None: ...


BlackboardLogSinkCallable = Callable[["BlackboardLogEvent"], None]
BlackboardLogWriter = Callable[[str], None]


def _utcnow_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _jsonable(value: Any) -> Any:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.isoformat(timespec="seconds")
        return (
            value.astimezone(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")
        )
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_jsonable(item) for item in value]
    if hasattr(value, "to_dict"):
        return _jsonable(value.to_dict())
    return value


def _normalize_mapping(value: dict[str, Any] | None) -> dict[str, Any]:
    if not value:
        return {}
    return {str(key): _jsonable(item) for key, item in value.items()}


@dataclass(slots=True)
class BlackboardLogEvent:
    timestamp: str
    level: LogLevel
    layer: LogLayer | str
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
class BlackboardLogCollector:
    events: list[BlackboardLogEvent] = field(default_factory=list)

    def emit(self, event: BlackboardLogEvent) -> None:
        self.events.append(event)

    def snapshot(self) -> list[BlackboardLogEvent]:
        return list(self.events)

    def to_dicts(self) -> list[dict[str, Any]]:
        return [event.to_dict() for event in self.events]


@dataclass(slots=True)
class BlackboardConsoleSink:
    min_level: LogLevel = "info"
    writer: BlackboardLogWriter | None = None

    def emit(self, event: BlackboardLogEvent) -> None:
        if _LEVEL_VALUES.get(str(event.level), 100) < _LEVEL_VALUES.get(
            self.min_level, 20
        ):
            return
        output = self.writer or print
        output(event.format_console_line())


@dataclass(slots=True)
class BlackboardLogger:
    layer: LogLayer | str
    source: str
    sinks: tuple[BlackboardLogSink | BlackboardLogSinkCallable, ...] = ()
    context: dict[str, Any] = field(default_factory=dict)

    def bind(self, **context: Any) -> "BlackboardLogger":
        return BlackboardLogger(
            layer=self.layer,
            source=self.source,
            sinks=self.sinks,
            context={**self.context, **_normalize_mapping(context)},
        )

    def child(self, source: str, **context: Any) -> "BlackboardLogger":
        return BlackboardLogger(
            layer=self.layer,
            source=source,
            sinks=self.sinks,
            context={**self.context, **_normalize_mapping(context)},
        )

    def log(
        self,
        level: LogLevel,
        message: str,
        *,
        payload: dict[str, Any] | None = None,
        context: dict[str, Any] | None = None,
    ) -> BlackboardLogEvent:
        event = BlackboardLogEvent(
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
                cast(BlackboardLogSink, sink).emit(event)
            else:
                cast(BlackboardLogSinkCallable, sink)(event)
        return event

    def debug(
        self,
        message: str,
        *,
        payload: dict[str, Any] | None = None,
        context: dict[str, Any] | None = None,
    ) -> BlackboardLogEvent:
        return self.log("debug", message, payload=payload, context=context)

    def info(
        self,
        message: str,
        *,
        payload: dict[str, Any] | None = None,
        context: dict[str, Any] | None = None,
    ) -> BlackboardLogEvent:
        return self.log("info", message, payload=payload, context=context)

    def warning(
        self,
        message: str,
        *,
        payload: dict[str, Any] | None = None,
        context: dict[str, Any] | None = None,
    ) -> BlackboardLogEvent:
        return self.log("warning", message, payload=payload, context=context)

    def error(
        self,
        message: str,
        *,
        payload: dict[str, Any] | None = None,
        context: dict[str, Any] | None = None,
    ) -> BlackboardLogEvent:
        return self.log("error", message, payload=payload, context=context)

    def exception(
        self,
        message: str,
        error: BaseException,
        *,
        payload: dict[str, Any] | None = None,
        context: dict[str, Any] | None = None,
    ) -> BlackboardLogEvent:
        exception_payload = {
            "error_type": type(error).__name__,
            "error": str(error),
            "traceback": traceback.format_exc(),
        }
        if payload:
            exception_payload.update(_normalize_mapping(payload))
        return self.log("error", message, payload=exception_payload, context=context)


@dataclass(slots=True)
class BlackboardLogSession:
    collector: BlackboardLogCollector = field(default_factory=BlackboardLogCollector)
    console_sink: BlackboardConsoleSink | None = None

    def make_logger(
        self,
        *,
        layer: LogLayer | str,
        source: str,
        context: dict[str, Any] | None = None,
    ) -> BlackboardLogger:
        sinks: list[BlackboardLogSink | BlackboardLogSinkCallable] = [self.collector]
        if self.console_sink is not None:
            sinks.append(self.console_sink)
        return BlackboardLogger(
            layer=layer,
            source=source,
            sinks=tuple(sinks),
            context=_normalize_mapping(context),
        )

    def snapshot(self) -> list[BlackboardLogEvent]:
        return self.collector.snapshot()

    def to_dicts(self) -> list[dict[str, Any]]:
        return self.collector.to_dicts()


def create_log_session(
    *,
    console: bool = False,
    min_level: LogLevel = "info",
    writer: BlackboardLogWriter | None = None,
) -> BlackboardLogSession:
    console_sink = (
        BlackboardConsoleSink(min_level=min_level, writer=writer) if console else None
    )
    return BlackboardLogSession(console_sink=console_sink)


def create_logger(
    *,
    layer: LogLayer | str,
    source: str,
    collector: BlackboardLogCollector | None = None,
    console: bool = False,
    min_level: LogLevel = "info",
    writer: BlackboardLogWriter | None = None,
    context: dict[str, Any] | None = None,
    extra_sinks: list[BlackboardLogSink | BlackboardLogSinkCallable] | None = None,
) -> BlackboardLogger:
    sinks: list[BlackboardLogSink | BlackboardLogSinkCallable] = []
    if collector is not None:
        sinks.append(collector)
    if console:
        sinks.append(BlackboardConsoleSink(min_level=min_level, writer=writer))
    if extra_sinks:
        sinks.extend(extra_sinks)
    return BlackboardLogger(
        layer=layer,
        source=source,
        sinks=tuple(sinks),
        context=_normalize_mapping(context),
    )


def summarize_log_events(events: list[BlackboardLogEvent]) -> dict[str, Any]:
    by_level: Counter[str] = Counter()
    by_layer: Counter[str] = Counter()
    by_source: Counter[str] = Counter()
    for event in events:
        by_level[str(event.level)] += 1
        by_layer[str(event.layer)] += 1
        by_source[str(event.source)] += 1
    return {
        "total": len(events),
        "by_level": dict(sorted(by_level.items())),
        "by_layer": dict(sorted(by_layer.items())),
        "by_source": dict(sorted(by_source.items())),
    }

"""Structured debug logging helpers for Copilot runtime execution tracing."""

from __future__ import annotations

import json
import logging
import os
from collections.abc import Mapping
from typing import Any

from ._debug_logging.helpers import _sanitize_value
from ._debug_logging.summarizers import (
    preview_text,
    summarize_event_types,
    summarize_exception,
    summarize_runtime_execution_event,
    summarize_runtime_model_route,
    summarize_runtime_reasoning_suppression_basis,
    summarize_runtime_run_event,
    summarize_runtime_thinking_capability,
    summarize_runtime_thinking_selection_result,
    summarize_runtime_tool_event,
)

COPILOT_RUNTIME_CHAIN_DEBUG_ENV_VAR = "COPILOT_RUNTIME_CHAIN_DEBUG"
_RUNTIME_CHAIN_DEBUG_LOGGER_NAME = "app.copilot_runtime.chain_debug"
_TRUTHY_DEBUG_VALUES = frozenset({"1", "true", "yes", "on", "debug"})


def is_runtime_chain_debug_enabled(env: Mapping[str, str] | None = None) -> bool:
    source = os.environ if env is None else env
    raw_value = source.get(COPILOT_RUNTIME_CHAIN_DEBUG_ENV_VAR, "")
    return raw_value.strip().lower() in _TRUTHY_DEBUG_VALUES


def log_runtime_chain_debug(
    event_name: str, *, enabled: bool | None = None, **payload: Any
) -> None:
    debug_enabled = is_runtime_chain_debug_enabled() if enabled is None else enabled
    if not debug_enabled:
        return

    normalized_payload = {
        key: _sanitize_value(value)
        for key, value in payload.items()
        if value is not None
    }
    body = {
        "event": event_name,
        **normalized_payload,
    }
    logger = logging.getLogger(_RUNTIME_CHAIN_DEBUG_LOGGER_NAME)
    if logger.level == logging.NOTSET:
        logger.setLevel(logging.INFO)
    if len(logger.handlers) == 0:
        logger = logging.getLogger("uvicorn.error")
        if logger.level == logging.NOTSET:
            logger.setLevel(logging.INFO)
    logger.info(
        "copilot-runtime-chain %s",
        json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
    )


__all__ = [
    "COPILOT_RUNTIME_CHAIN_DEBUG_ENV_VAR",
    "is_runtime_chain_debug_enabled",
    "log_runtime_chain_debug",
    "preview_text",
    "summarize_event_types",
    "summarize_exception",
    "summarize_runtime_execution_event",
    "summarize_runtime_model_route",
    "summarize_runtime_reasoning_suppression_basis",
    "summarize_runtime_run_event",
    "summarize_runtime_thinking_capability",
    "summarize_runtime_thinking_selection_result",
    "summarize_runtime_tool_event",
]

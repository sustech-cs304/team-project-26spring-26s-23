"""Shared result mapping helpers used across TIS tool sub-domains."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from app.integrations.sustech.teaching_information_system.shared import TISLogEvent


def _summarize_logs(logs: Sequence[TISLogEvent]) -> dict[str, Any]:
    by_level: dict[str, int] = {}
    by_layer: dict[str, int] = {}
    by_source: dict[str, int] = {}
    for log in logs:
        by_level[log.level] = by_level.get(log.level, 0) + 1
        by_layer[log.layer] = by_layer.get(log.layer, 0) + 1
        by_source[log.source] = by_source.get(log.source, 0) + 1
    return {
        "total": len(logs),
        "by_level": by_level,
        "by_layer": by_layer,
        "by_source": by_source,
    }


def _common_metadata(
    *,
    credential_source: str,
    persist: bool,
    db_path_source: str | None,
) -> dict[str, Any]:
    metadata: dict[str, Any] = {
        "credentialSource": credential_source,
        "persistenceRequested": persist,
    }
    if db_path_source is not None:
        metadata["dbPathSource"] = db_path_source
    return metadata


def _detail_export_requested(arguments: Mapping[str, Any]) -> bool:
    return (
        _read_optional_text(arguments, "stateKey") is not None
        or _read_optional_text(arguments, "artifactName") is not None
    )


def _read_optional_text(arguments: Mapping[str, Any], field_name: str) -> str | None:
    value = arguments.get(field_name)
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None

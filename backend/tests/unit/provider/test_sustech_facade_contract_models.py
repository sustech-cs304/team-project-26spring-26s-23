from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from pydantic import Field, field_validator

from app.integrations.sustech.facade_contract_models import (
    SustechToolArgumentsModel,
    SustechToolBoundaryModel,
    parse_tool_arguments,
    to_jsonable_tool_contract,
)


class _ExampleArguments(SustechToolArgumentsModel):
    keyword: str = Field(default="", validate_default=True)
    limit: int | None = None

    @field_validator("keyword", mode="before")
    @classmethod
    def _normalize_keyword(cls, value: Any) -> str:
        normalized = str(value or "").strip()
        if normalized == "":
            raise ValueError("keyword must be a non-empty string.")
        return normalized

    @field_validator("limit", mode="before")
    @classmethod
    def _normalize_limit(cls, value: Any) -> int | None:
        if value is None:
            return None
        if isinstance(value, bool):
            raise ValueError("limit must be an integer.")
        try:
            return int(value)
        except (TypeError, ValueError) as ex:
            raise ValueError("limit must be an integer.") from ex


@dataclass(slots=True)
class _DataclassPayload:
    created_at: datetime
    output_path: Path


class _ExampleBoundary(SustechToolBoundaryModel):
    keyword: str
    nested: dict[str, Any]


def test_parse_tool_arguments_normalizes_declared_fields_and_ignores_unknown_inputs() -> (
    None
):
    parsed = parse_tool_arguments(
        _ExampleArguments,
        {
            "keyword": " 数据库系统 ",
            "limit": "5",
            "unknown": "ignored",
        },
    )

    assert parsed.keyword == "数据库系统"
    assert parsed.limit == 5
    assert parsed.to_contract_dict() == {
        "keyword": "数据库系统",
        "limit": 5,
    }


def test_parse_tool_arguments_surfaces_custom_validation_message() -> None:
    with pytest.raises(ValueError, match="keyword must be a non-empty string."):
        parse_tool_arguments(_ExampleArguments, {"keyword": "   "})


def test_to_jsonable_tool_contract_serializes_paths_datetimes_dataclasses_and_models() -> (
    None
):
    payload = _ExampleBoundary(
        keyword="CS305",
        nested={
            "createdAt": datetime(2026, 4, 19, 21, 0, tzinfo=UTC),
            "artifact": _DataclassPayload(
                created_at=datetime(2026, 4, 19, 21, 5, tzinfo=UTC),
                output_path=Path("database-root/blackboard/snapshot.db"),
            ),
        },
    )

    assert to_jsonable_tool_contract(payload) == {
        "keyword": "CS305",
        "nested": {
            "createdAt": "2026-04-19T21:00:00+00:00",
            "artifact": {
                "created_at": "2026-04-19T21:05:00+00:00",
                "output_path": "database-root/blackboard/snapshot.db",
            },
        },
    }


def test_to_jsonable_tool_contract_serializes_sets_in_stable_order() -> None:
    payload = {"toolIds": {"tool.weather", "tool.blackboard", "tool.calendar"}}

    assert to_jsonable_tool_contract(payload) == {
        "toolIds": ["tool.blackboard", "tool.calendar", "tool.weather"]
    }

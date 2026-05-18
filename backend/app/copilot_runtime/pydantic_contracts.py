"""Pydantic-backed helpers shared by Copilot runtime boundary contracts."""

from __future__ import annotations

from dataclasses import fields as dataclass_fields, is_dataclass
from datetime import datetime
from typing import Any, cast

from pydantic import BaseModel, ConfigDict


class RuntimeContractModel(BaseModel):
    """Shared frozen Pydantic base for runtime boundary contracts."""

    model_config = ConfigDict(
        arbitrary_types_allowed=True,
        frozen=True,
        populate_by_name=True,
    )


def contract_to_dict(value: Any) -> dict[str, Any]:
    payload = to_jsonable_contract(value)
    if not isinstance(payload, dict):  # pragma: no cover - defensive guard
        raise TypeError("Runtime contract payload must serialize to a mapping.")
    return cast(dict[str, Any], payload)


def to_jsonable_contract(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat(timespec="seconds")
    if isinstance(value, BaseModel):
        return to_jsonable_contract(
            value.model_dump(by_alias=False, exclude_none=False)
        )
    if is_dataclass(value) and not isinstance(value, type):
        return {
            field.name: to_jsonable_contract(getattr(value, field.name))
            for field in dataclass_fields(value)
        }
    if isinstance(value, dict):
        return {str(key): to_jsonable_contract(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [to_jsonable_contract(item) for item in value]
    return value


__all__ = ["RuntimeContractModel", "contract_to_dict", "to_jsonable_contract"]

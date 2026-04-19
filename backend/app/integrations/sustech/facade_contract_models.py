"""Pydantic helpers for SUSTech facade tool boundary contracts."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import asdict, is_dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Literal, TypeVar, cast

from pydantic import BaseModel, ConfigDict, ValidationError

CredentialSource = Literal["arguments", "host_secrets", "mixed"]


class SustechToolBoundaryModel(BaseModel):
    """Shared Pydantic base for SUSTech facade tool boundary models."""

    model_config = ConfigDict(
        arbitrary_types_allowed=True,
        extra="forbid",
        frozen=True,
        populate_by_name=True,
    )

    def to_contract_dict(
        self,
        *,
        exclude: set[str] | None = None,
        exclude_none: bool = False,
    ) -> dict[str, Any]:
        """Serialize with the existing tool-result JSON shape."""

        payload = to_jsonable_tool_contract(
            self.model_dump(
                by_alias=False,
                exclude=set() if exclude is None else exclude,
                exclude_none=exclude_none,
            )
        )
        if not isinstance(payload, dict):  # pragma: no cover - defensive guard
            raise TypeError(
                "SUSTech tool boundary payload must serialize to a mapping."
            )
        return cast(dict[str, Any], payload)


class SustechToolArgumentsModel(SustechToolBoundaryModel):
    """Shared Pydantic base for incoming facade tool argument models.

    Tool descriptors already publish ``additionalProperties: false``. Runtime behavior
    historically ignored unknown keys at invocation time, so argument models keep that
    compatibility while still normalizing all declared boundary fields explicitly.
    """

    model_config = ConfigDict(
        arbitrary_types_allowed=True,
        extra="ignore",
        frozen=True,
        populate_by_name=True,
    )


class ResolvedCredentialContract(SustechToolBoundaryModel):
    """Credential values resolved at the tool boundary plus their source summary."""

    username: str
    password: str
    source: CredentialSource


_ArgumentsModelT = TypeVar("_ArgumentsModelT", bound=SustechToolArgumentsModel)


def parse_tool_arguments(
    model_type: type[_ArgumentsModelT],
    arguments: Mapping[str, Any],
) -> _ArgumentsModelT:
    """Validate and normalize raw invocation arguments with stable error messages."""

    try:
        return model_type.model_validate(dict(arguments))
    except ValidationError as exc:
        raise ValueError(_validation_error_message(exc)) from exc


def to_jsonable_tool_contract(value: Any) -> Any:
    """Return a JSON-compatible value while preserving current facade field names."""

    if isinstance(value, datetime):
        return value.isoformat(timespec="seconds")
    if isinstance(value, Path):
        return value.as_posix()
    if isinstance(value, BaseModel):
        return to_jsonable_tool_contract(value.model_dump(by_alias=False))
    if is_dataclass(value) and not isinstance(value, type):
        return to_jsonable_tool_contract(asdict(value))
    if isinstance(value, Mapping):
        return {
            str(key): to_jsonable_tool_contract(item) for key, item in value.items()
        }
    if isinstance(value, (list, tuple, set)):
        return [to_jsonable_tool_contract(item) for item in value]
    to_dict = getattr(value, "to_dict", None)
    if callable(to_dict):
        return to_jsonable_tool_contract(to_dict())
    return value


def _validation_error_message(error: ValidationError) -> str:
    errors = error.errors()
    if not errors:
        return "Tool arguments are invalid."

    first_error = errors[0]
    context = first_error.get("ctx")
    if isinstance(context, Mapping):
        original_error = context.get("error")
        if isinstance(original_error, Exception):
            message = str(original_error).strip()
            if message:
                return message

    message = str(first_error.get("msg", "")).strip()
    value_error_prefix = "Value error, "
    if message.startswith(value_error_prefix):
        message = message[len(value_error_prefix) :].strip()
    return message or "Tool arguments are invalid."


__all__ = [
    "CredentialSource",
    "ResolvedCredentialContract",
    "SustechToolArgumentsModel",
    "SustechToolBoundaryModel",
    "parse_tool_arguments",
    "to_jsonable_tool_contract",
]

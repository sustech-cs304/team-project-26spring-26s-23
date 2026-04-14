"""Errors for host capability resolution."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any


class MissingHostCapabilityError(LookupError):
    """Raised when a required host capability is not bound."""

    def __init__(self, capability: str) -> None:
        self.capability = capability
        super().__init__(f"Required host capability '{capability}' is not available.")


@dataclass(frozen=True, slots=True)
class HostCapabilityOperationError(RuntimeError):
    """Raised when a bound host capability fails during a concrete operation."""

    capability: str
    code: str
    message: str
    retryable: bool = False
    details: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        normalized_capability = self.capability.strip()
        if normalized_capability == "":
            raise ValueError("capability must be a non-empty string.")
        normalized_code = self.code.strip()
        if normalized_code == "":
            raise ValueError("code must be a non-empty string.")
        normalized_message = self.message.strip()
        if normalized_message == "":
            raise ValueError("message must be a non-empty string.")
        object.__setattr__(self, "capability", normalized_capability)
        object.__setattr__(self, "code", normalized_code)
        object.__setattr__(self, "message", normalized_message)
        object.__setattr__(
            self,
            "details",
            dict(self.details) if isinstance(self.details, Mapping) else {},
        )
        RuntimeError.__init__(self, normalized_message)


__all__ = ["HostCapabilityOperationError", "MissingHostCapabilityError"]

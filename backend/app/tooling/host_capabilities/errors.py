"""Errors for host capability resolution."""

from __future__ import annotations


class MissingHostCapabilityError(LookupError):
    """Raised when a required host capability is not bound."""

    def __init__(self, capability: str) -> None:
        self.capability = capability
        super().__init__(f"Required host capability '{capability}' is not available.")


__all__ = ["MissingHostCapabilityError"]

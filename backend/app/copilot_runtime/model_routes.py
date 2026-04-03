from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True, slots=True)
class RuntimeModelRouteSnapshot:
    provider: str
    endpoint_type: str
    base_url: str
    model_id: str

    def to_dict(self) -> dict[str, str]:
        return {
            "provider": self.provider,
            "endpointType": self.endpoint_type,
            "baseUrl": self.base_url,
            "modelId": self.model_id,
        }


@dataclass(frozen=True, slots=True)
class RuntimeModelRoute:
    provider_profile_id: str
    snapshot: RuntimeModelRouteSnapshot

    def to_dict(self) -> dict[str, object]:
        return {
            "providerProfileId": self.provider_profile_id,
            "snapshot": self.snapshot.to_dict(),
        }


@dataclass(frozen=True, slots=True)
class ResolvedRuntimeModelRoute:
    provider_profile_id: str
    provider: str
    endpoint_type: str
    base_url: str
    model_id: str
    api_key: str

    def to_public_dict(self) -> dict[str, object]:
        return {
            "providerProfileId": self.provider_profile_id,
            "snapshot": {
                "provider": self.provider,
                "endpointType": self.endpoint_type,
                "baseUrl": self.base_url,
                "modelId": self.model_id,
            },
        }


class RuntimeModelRouteResolver(Protocol):
    async def resolve(self, model_route: RuntimeModelRoute) -> ResolvedRuntimeModelRoute: ...


class RuntimeModelRouteResolutionError(RuntimeError):
    def __init__(self, *, code: str, message: str, details: dict[str, object] | None = None) -> None:
        self.code = code
        self.details = dict(details or {})
        super().__init__(message)


class ProviderProfileNotFoundError(RuntimeModelRouteResolutionError):
    def __init__(self, *, provider_profile_id: str) -> None:
        super().__init__(
            code="provider_profile_not_found",
            message=f"Provider profile '{provider_profile_id}' does not exist.",
            details={"providerProfileId": provider_profile_id},
        )


class ModelRouteSnapshotMismatchError(RuntimeModelRouteResolutionError):
    def __init__(
        self,
        *,
        provider_profile_id: str,
        mismatches: list[dict[str, object]],
    ) -> None:
        super().__init__(
            code="model_route_snapshot_mismatch",
            message=(
                f"Provider profile '{provider_profile_id}' no longer matches the requested model route snapshot."
            ),
            details={
                "providerProfileId": provider_profile_id,
                "mismatches": mismatches,
            },
        )


class ProviderSecretMissingError(RuntimeModelRouteResolutionError):
    def __init__(self, *, provider_profile_id: str) -> None:
        super().__init__(
            code="provider_secret_missing",
            message=f"Provider profile '{provider_profile_id}' is missing an API key.",
            details={"providerProfileId": provider_profile_id},
        )


class HostModelRouteAccessDeniedError(RuntimeModelRouteResolutionError):
    def __init__(self, *, header_name: str) -> None:
        super().__init__(
            code="host_model_route_access_denied",
            message="Host model route bridge rejected the runtime credentials.",
            details={"headerName": header_name},
        )


class HostModelRouteUnavailableError(RuntimeModelRouteResolutionError):
    def __init__(self, *, detail: str | None = None) -> None:
        details: dict[str, object] = {}
        if detail is not None and detail.strip() != "":
            details["detail"] = detail.strip()
        super().__init__(
            code="host_model_route_unavailable",
            message="Host model route bridge is unavailable.",
            details=details,
        )


__all__ = [
    "HostModelRouteAccessDeniedError",
    "HostModelRouteUnavailableError",
    "ModelRouteSnapshotMismatchError",
    "ProviderProfileNotFoundError",
    "ProviderSecretMissingError",
    "ResolvedRuntimeModelRoute",
    "RuntimeModelRoute",
    "RuntimeModelRouteResolutionError",
    "RuntimeModelRouteResolver",
    "RuntimeModelRouteSnapshot",
]

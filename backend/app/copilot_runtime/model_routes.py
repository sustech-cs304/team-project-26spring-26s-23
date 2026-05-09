from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Protocol, Self

from pydantic import Field, model_validator

from .pydantic_contracts import RuntimeContractModel


class RuntimeModelRouteRef(RuntimeContractModel):
    route_kind: str = Field(validation_alias="routeKind")
    profile_id: str = Field(validation_alias="profileId")
    model_id: str = Field(validation_alias="modelId")

    def to_dict(self) -> dict[str, str]:
        return {
            "routeKind": self.route_kind,
            "profileId": self.profile_id,
            "modelId": self.model_id,
        }


class RuntimeModelRoute(RuntimeContractModel):
    provider_profile_id: str = Field(validation_alias="providerProfileId")
    route_ref: RuntimeModelRouteRef = Field(validation_alias="routeRef")
    catalog_revision: str | None = Field(
        default=None,
        validation_alias="catalogRevision",
    )

    @model_validator(mode="after")
    def _validate_route_ref(self) -> Self:
        if self.route_ref.profile_id != self.provider_profile_id:
            raise ValueError(
                "RuntimeModelRoute.provider_profile_id must match route_ref.profile_id."
            )
        return self

    @property
    def model_id(self) -> str:
        return self.route_ref.model_id

    def to_dict(self) -> dict[str, object]:
        payload: dict[str, object] = {
            "routeRef": self.route_ref.to_dict(),
        }
        if self.catalog_revision is not None and self.catalog_revision.strip() != "":
            payload["catalogRevision"] = self.catalog_revision.strip()
        return payload


@dataclass(frozen=True, slots=True)
class ResolvedRuntimeModelRoute:
    provider_profile_id: str
    provider: str
    endpoint_type: str
    base_url: str
    model_id: str
    api_key: str
    route_ref: RuntimeModelRouteRef | None = None
    provider_id: str | None = None
    adapter_id: str = ""
    runtime_status: str = "enabled"
    catalog_revision: str = ""
    endpoint_family: str = ""
    auth_kind: str = "api-key"
    capability_hints: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        normalized_route_ref = self.route_ref or RuntimeModelRouteRef(
            route_kind="provider-model",
            profile_id=self.provider_profile_id,
            model_id=self.model_id,
        )
        object.__setattr__(self, "route_ref", normalized_route_ref)

        normalized_provider_id = (
            _normalize_optional_text(self.provider_id)
            or _normalize_optional_text(self.provider)
            or ""
        )
        object.__setattr__(self, "provider_id", normalized_provider_id)

        normalized_endpoint_family = _normalize_optional_text(
            self.endpoint_family
        ) or _resolve_endpoint_family(self.endpoint_type)
        object.__setattr__(self, "endpoint_family", normalized_endpoint_family)

        normalized_auth_kind = _normalize_optional_text(self.auth_kind)
        if normalized_auth_kind is None:
            normalized_auth_kind = "none" if self.api_key.strip() == "" else "api-key"
        object.__setattr__(self, "auth_kind", normalized_auth_kind)

        object.__setattr__(
            self,
            "capability_hints",
            _normalize_capability_hints(self.capability_hints),
        )

    def to_public_dict(self) -> dict[str, object]:
        return self.to_resolved_route_dict()

    def to_resolved_route_dict(self) -> dict[str, object]:
        payload: dict[str, object] = {
            "routeRef": self.route_ref.to_dict()
            if self.route_ref is not None
            else {
                "routeKind": "provider-model",
                "profileId": self.provider_profile_id,
                "modelId": self.model_id,
            },
            "providerProfileId": self.provider_profile_id,
            "provider": self.provider,
            "providerId": self.provider_id or self.provider,
            "adapterId": self.adapter_id,
            "runtimeStatus": self.runtime_status,
            "catalogRevision": self.catalog_revision,
            "endpointFamily": self.endpoint_family,
            "endpointType": self.endpoint_type,
            "baseUrl": self.base_url,
            "modelId": self.model_id,
            "authKind": self.auth_kind,
        }
        if self.capability_hints:
            payload["capabilityHints"] = dict(self.capability_hints)
        return payload


class RuntimeModelRouteResolver(Protocol):
    async def resolve(
        self, model_route: RuntimeModelRoute
    ) -> ResolvedRuntimeModelRoute: ...


class RuntimeModelRouteResolutionError(RuntimeError):
    def __init__(
        self, *, code: str, message: str, details: dict[str, object] | None = None
    ) -> None:
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


def _normalize_optional_text(value: str | None) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _normalize_capability_hints(value: Mapping[str, Any] | None) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        return {}
    return {str(key): item for key, item in value.items()}


def _resolve_endpoint_family(endpoint_type: str) -> str:
    normalized_endpoint_type = _normalize_optional_text(endpoint_type) or ""
    if normalized_endpoint_type == "":
        return ""
    separator_index = normalized_endpoint_type.find("-")
    if separator_index < 0:
        return normalized_endpoint_type
    return normalized_endpoint_type[:separator_index]


__all__ = [
    "HostModelRouteAccessDeniedError",
    "HostModelRouteUnavailableError",
    "ProviderProfileNotFoundError",
    "ProviderSecretMissingError",
    "ResolvedRuntimeModelRoute",
    "RuntimeModelRoute",
    "RuntimeModelRouteRef",
    "RuntimeModelRouteResolutionError",
    "RuntimeModelRouteResolver",
]

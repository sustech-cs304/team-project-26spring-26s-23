from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal, Self, cast

from jsonschema import Draft202012Validator
from pydantic import ConfigDict, Field, field_validator, model_validator

from .pydantic_contracts import RuntimeContractModel

ProviderRuntimeStatus = Literal["enabled", "catalog-only", "legacy-unsupported"]
ProviderAuthKind = Literal["api-key", "none"]

_PROVIDER_CATALOG_ROOT = Path(__file__).resolve().parents[3] / "provider-catalog"
_PROVIDER_CATALOG_SCHEMA_PATH = _PROVIDER_CATALOG_ROOT / "schema.json"
_PROVIDER_CATALOG_REGISTRY_PATH = _PROVIDER_CATALOG_ROOT / "registry.json"


class _ProviderCatalogModel(RuntimeContractModel):
    """Strict Pydantic base for provider catalog document objects."""

    model_config = ConfigDict(
        arbitrary_types_allowed=True,
        extra="forbid",
        frozen=True,
        populate_by_name=True,
    )


class ProviderCatalogAuthSchema(_ProviderCatalogModel):
    default_kind: ProviderAuthKind = Field(validation_alias="defaultKind")
    supported_kinds: tuple[ProviderAuthKind, ...] = Field(
        validation_alias="supportedKinds"
    )
    secret_fields: tuple[str, ...] = Field(validation_alias="secretFields")
    help_text: str | None = Field(default=None, validation_alias="helpText")
    details: dict[str, Any] = Field(default_factory=dict)

    @field_validator("secret_fields", mode="before")
    @classmethod
    def _validate_secret_fields(cls, value: Any) -> Any:
        if isinstance(value, list):
            for item in value:
                _require_secret_field_name(item, label="authSchema.secretFields")
        return value

    @field_validator("help_text", mode="before")
    @classmethod
    def _normalize_help_text(cls, value: Any) -> str | None:
        return _optional_string(value)


class ProviderCatalogBaseUrlPolicy(_ProviderCatalogModel):
    mode: Literal["fixed", "optional", "required"]
    default_base_url: str | None = Field(
        default=None, validation_alias="defaultBaseUrl"
    )
    details: dict[str, Any] = Field(default_factory=dict)

    @field_validator("default_base_url", mode="before")
    @classmethod
    def _normalize_default_base_url(cls, value: Any) -> str | None:
        return _optional_string(value)


class ProviderCatalogModelConfigPolicy(_ProviderCatalogModel):
    mode: Literal["user-defined", "catalog-seeded", "read-only"]
    allow_custom_models: bool = Field(validation_alias="allowCustomModels")
    default_model_required: bool = Field(validation_alias="defaultModelRequired")
    allow_model_display_name_override: bool | None = Field(
        default=None, validation_alias="allowModelDisplayNameOverride"
    )
    details: dict[str, Any] = Field(default_factory=dict)


class ProviderCatalogCapabilityHints(_ProviderCatalogModel):
    streaming: bool | None = None
    tools: bool | None = None
    vision: bool | None = None
    reasoning: bool | None = None
    search: bool | None = None
    details: dict[str, Any] = Field(default_factory=dict)


class ProviderCatalogEntry(_ProviderCatalogModel):
    provider_id: str = Field(validation_alias="providerId")
    display_name: str = Field(validation_alias="displayName")
    endpoint_type: str = Field(validation_alias="endpointType")
    runtime_status: ProviderRuntimeStatus = Field(validation_alias="runtimeStatus")
    adapter_id: str = Field(validation_alias="adapterId")
    auth_schema: ProviderCatalogAuthSchema = Field(validation_alias="authSchema")
    base_url_policy: ProviderCatalogBaseUrlPolicy = Field(
        validation_alias="baseUrlPolicy"
    )
    model_config_policy: ProviderCatalogModelConfigPolicy = Field(
        validation_alias="modelConfigPolicy"
    )
    capability_hints: ProviderCatalogCapabilityHints = Field(
        validation_alias="capabilityHints"
    )
    aliases: tuple[str, ...] = ()
    notes: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    details: dict[str, Any] = Field(default_factory=dict)

    @field_validator("provider_id", "endpoint_type", "adapter_id", mode="before")
    @classmethod
    def _normalize_required_identifiers(cls, value: Any) -> str:
        return _require_identifier(value, label="providerCatalogEntry.identifier")

    @field_validator("display_name", mode="before")
    @classmethod
    def _normalize_display_name(cls, value: Any) -> str:
        return _require_non_empty_string(value, label="displayName")

    @field_validator("aliases", mode="before")
    @classmethod
    def _normalize_aliases(cls, value: Any) -> tuple[str, ...]:
        if value is None:
            return ()
        if not isinstance(value, list):
            raise TypeError("aliases must be an array.")
        return tuple(_require_identifier(alias, label="alias") for alias in value)

    @field_validator("notes", mode="before")
    @classmethod
    def _normalize_notes(cls, value: Any) -> str | None:
        return _optional_string(value)


class ProviderCatalog(_ProviderCatalogModel):
    catalog_revision: str = Field(validation_alias="catalogRevision")
    providers: tuple[ProviderCatalogEntry, ...]
    metadata: dict[str, Any] = Field(default_factory=dict)
    details: dict[str, Any] = Field(default_factory=dict)

    @field_validator("catalog_revision", mode="before")
    @classmethod
    def _normalize_catalog_revision(cls, value: Any) -> str:
        return _require_non_empty_string(value, label="catalogRevision")

    @model_validator(mode="after")
    def _validate_provider_count(self) -> Self:
        if len(self.providers) == 0:
            raise ValueError(
                "Provider catalog must define at least one provider entry."
            )
        return self


def provider_catalog_root() -> Path:
    return _PROVIDER_CATALOG_ROOT


@lru_cache(maxsize=1)
def load_provider_catalog() -> ProviderCatalog:
    raw_schema, raw_registry = load_provider_catalog_documents()
    Draft202012Validator.check_schema(raw_schema)
    Draft202012Validator(raw_schema).validate(raw_registry)
    return _parse_provider_catalog(raw_registry)


@lru_cache(maxsize=1)
def load_provider_catalog_documents() -> tuple[dict[str, Any], dict[str, Any]]:
    return (
        _load_json_document(_PROVIDER_CATALOG_SCHEMA_PATH),
        _load_json_document(_PROVIDER_CATALOG_REGISTRY_PATH),
    )


def list_provider_catalog_entries(
    *, runtime_status: ProviderRuntimeStatus | None = None
) -> tuple[ProviderCatalogEntry, ...]:
    providers = load_provider_catalog().providers
    if runtime_status is None:
        return providers
    return tuple(
        provider for provider in providers if provider.runtime_status == runtime_status
    )


def get_provider_catalog_entry(provider_id: str) -> ProviderCatalogEntry | None:
    normalized_provider_id = normalize_provider_catalog_identifier(provider_id)
    if normalized_provider_id == "":
        return None

    for provider in load_provider_catalog().providers:
        if (
            provider.provider_id == normalized_provider_id
            or normalized_provider_id in provider.aliases
        ):
            return provider

    return None


def normalize_provider_catalog_identifier(value: str) -> str:
    return value.strip().lower()


def _parse_provider_catalog(raw_registry: dict[str, Any]) -> ProviderCatalog:
    return ProviderCatalog.model_validate(raw_registry)


def _parse_provider_catalog_entry(raw_entry: dict[str, Any]) -> ProviderCatalogEntry:
    return ProviderCatalogEntry.model_validate(raw_entry)


def _parse_auth_schema(raw_auth_schema: Any) -> ProviderCatalogAuthSchema:
    return ProviderCatalogAuthSchema.model_validate(
        _require_mapping(raw_auth_schema, label="authSchema")
    )


def _parse_base_url_policy(raw_base_url_policy: Any) -> ProviderCatalogBaseUrlPolicy:
    return ProviderCatalogBaseUrlPolicy.model_validate(
        _require_mapping(raw_base_url_policy, label="baseUrlPolicy")
    )


def _parse_model_config_policy(
    raw_model_config_policy: Any,
) -> ProviderCatalogModelConfigPolicy:
    return ProviderCatalogModelConfigPolicy.model_validate(
        _require_mapping(raw_model_config_policy, label="modelConfigPolicy")
    )


def _parse_capability_hints(
    raw_capability_hints: Any,
) -> ProviderCatalogCapabilityHints:
    return ProviderCatalogCapabilityHints.model_validate(
        _require_mapping(raw_capability_hints, label="capabilityHints")
    )


def _load_json_document(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as file:
        payload = json.load(file)
    return _require_mapping(payload, label=str(path))


def _require_mapping(value: Any, *, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise TypeError(f"{label} must be a JSON object.")
    return value


def _require_runtime_status(value: Any, *, label: str) -> ProviderRuntimeStatus:
    return _require_enum(
        value,
        allowed=("enabled", "catalog-only", "legacy-unsupported"),
        label=label,
    )


def _require_auth_kind(value: Any, *, label: str) -> ProviderAuthKind:
    return _require_enum(value, allowed=("api-key", "none"), label=label)


def _require_identifier(value: Any, *, label: str) -> str:
    normalized = _require_non_empty_string(value, label=label)
    if not normalized.replace("-", "").isalnum() or normalized.lower() != normalized:
        raise ValueError(f"{label} must be a lowercase kebab-case identifier.")
    return normalized


def _require_non_empty_string(value: Any, *, label: str) -> str:
    if not isinstance(value, str):
        raise TypeError(f"{label} must be a string.")
    normalized = value.strip()
    if normalized == "":
        raise ValueError(f"{label} must not be empty.")
    return normalized


def _optional_string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _require_secret_field_name(value: Any, *, label: str) -> str:
    normalized = _require_non_empty_string(value, label=label)
    if not normalized[0].isalpha() or not normalized.isalnum():
        raise ValueError(f"{label} must be a camelCase identifier.")
    return normalized


def _require_boolean(value: Any, *, label: str) -> bool:
    if not isinstance(value, bool):
        raise TypeError(f"{label} must be a boolean.")
    return value


def _optional_boolean(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    return None


def _require_enum[TEnum: str](
    value: Any, *, allowed: tuple[TEnum, ...], label: str
) -> TEnum:
    normalized = _require_non_empty_string(value, label=label)
    if normalized not in allowed:
        raise ValueError(f"{label} must be one of: {', '.join(allowed)}.")
    return cast(TEnum, normalized)


__all__ = [
    "ProviderAuthKind",
    "ProviderCatalog",
    "ProviderCatalogAuthSchema",
    "ProviderCatalogBaseUrlPolicy",
    "ProviderCatalogCapabilityHints",
    "ProviderCatalogEntry",
    "ProviderCatalogModelConfigPolicy",
    "ProviderRuntimeStatus",
    "get_provider_catalog_entry",
    "list_provider_catalog_entries",
    "load_provider_catalog",
    "load_provider_catalog_documents",
    "normalize_provider_catalog_identifier",
    "provider_catalog_root",
]

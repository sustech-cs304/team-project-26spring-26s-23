from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

from jsonschema import Draft202012Validator

ProviderRuntimeStatus = Literal["enabled", "catalog-only", "legacy-unsupported"]
ProviderAuthKind = Literal["api-key", "none"]

_PROVIDER_CATALOG_ROOT = Path(__file__).resolve().parents[3] / "provider-catalog"
_PROVIDER_CATALOG_SCHEMA_PATH = _PROVIDER_CATALOG_ROOT / "schema.json"
_PROVIDER_CATALOG_REGISTRY_PATH = _PROVIDER_CATALOG_ROOT / "registry.json"


@dataclass(frozen=True, slots=True)
class ProviderCatalogAuthSchema:
    default_kind: ProviderAuthKind
    supported_kinds: tuple[ProviderAuthKind, ...]
    secret_fields: tuple[str, ...]
    help_text: str | None = None


@dataclass(frozen=True, slots=True)
class ProviderCatalogBaseUrlPolicy:
    mode: Literal["fixed", "optional", "required"]
    default_base_url: str | None = None


@dataclass(frozen=True, slots=True)
class ProviderCatalogModelConfigPolicy:
    mode: Literal["user-defined", "catalog-seeded", "read-only"]
    allow_custom_models: bool
    default_model_required: bool
    allow_model_display_name_override: bool | None = None


@dataclass(frozen=True, slots=True)
class ProviderCatalogCapabilityHints:
    streaming: bool | None = None
    tools: bool | None = None
    vision: bool | None = None
    reasoning: bool | None = None
    search: bool | None = None


@dataclass(frozen=True, slots=True)
class ProviderCatalogEntry:
    provider_id: str
    display_name: str
    endpoint_type: str
    runtime_status: ProviderRuntimeStatus
    adapter_id: str
    auth_schema: ProviderCatalogAuthSchema
    base_url_policy: ProviderCatalogBaseUrlPolicy
    model_config_policy: ProviderCatalogModelConfigPolicy
    capability_hints: ProviderCatalogCapabilityHints
    aliases: tuple[str, ...] = ()
    notes: str | None = None


@dataclass(frozen=True, slots=True)
class ProviderCatalog:
    catalog_revision: str
    providers: tuple[ProviderCatalogEntry, ...]


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
    providers = tuple(
        _parse_provider_catalog_entry(item) for item in raw_registry["providers"]
    )
    if len(providers) == 0:
        raise ValueError("Provider catalog must define at least one provider entry.")

    return ProviderCatalog(
        catalog_revision=_require_non_empty_string(
            raw_registry["catalogRevision"], label="catalogRevision"
        ),
        providers=providers,
    )


def _parse_provider_catalog_entry(raw_entry: dict[str, Any]) -> ProviderCatalogEntry:
    return ProviderCatalogEntry(
        provider_id=_require_identifier(raw_entry["providerId"], label="providerId"),
        display_name=_require_non_empty_string(
            raw_entry["displayName"], label="displayName"
        ),
        endpoint_type=_require_identifier(
            raw_entry["endpointType"], label="endpointType"
        ),
        runtime_status=_require_runtime_status(
            raw_entry["runtimeStatus"], label="runtimeStatus"
        ),
        adapter_id=_require_identifier(raw_entry["adapterId"], label="adapterId"),
        auth_schema=_parse_auth_schema(raw_entry["authSchema"]),
        base_url_policy=_parse_base_url_policy(raw_entry["baseUrlPolicy"]),
        model_config_policy=_parse_model_config_policy(raw_entry["modelConfigPolicy"]),
        capability_hints=_parse_capability_hints(raw_entry["capabilityHints"]),
        aliases=tuple(
            _require_identifier(alias, label="alias")
            for alias in raw_entry.get("aliases", [])
        ),
        notes=_optional_string(raw_entry.get("notes")),
    )


def _parse_auth_schema(raw_auth_schema: Any) -> ProviderCatalogAuthSchema:
    auth_schema = _require_mapping(raw_auth_schema, label="authSchema")
    return ProviderCatalogAuthSchema(
        default_kind=_require_auth_kind(
            auth_schema["defaultKind"], label="authSchema.defaultKind"
        ),
        supported_kinds=tuple(
            _require_auth_kind(kind, label="authSchema.supportedKinds")
            for kind in auth_schema["supportedKinds"]
        ),
        secret_fields=tuple(
            _require_non_empty_string(field, label="authSchema.secretFields")
            for field in auth_schema["secretFields"]
        ),
        help_text=_optional_string(auth_schema.get("helpText")),
    )


def _parse_base_url_policy(raw_base_url_policy: Any) -> ProviderCatalogBaseUrlPolicy:
    base_url_policy = _require_mapping(raw_base_url_policy, label="baseUrlPolicy")
    return ProviderCatalogBaseUrlPolicy(
        mode=_require_enum(
            base_url_policy["mode"],
            allowed=("fixed", "optional", "required"),
            label="baseUrlPolicy.mode",
        ),
        default_base_url=_optional_string(base_url_policy.get("defaultBaseUrl")),
    )


def _parse_model_config_policy(
    raw_model_config_policy: Any,
) -> ProviderCatalogModelConfigPolicy:
    model_config_policy = _require_mapping(
        raw_model_config_policy, label="modelConfigPolicy"
    )
    return ProviderCatalogModelConfigPolicy(
        mode=_require_enum(
            model_config_policy["mode"],
            allowed=("user-defined", "catalog-seeded", "read-only"),
            label="modelConfigPolicy.mode",
        ),
        allow_custom_models=_require_boolean(
            model_config_policy["allowCustomModels"],
            label="modelConfigPolicy.allowCustomModels",
        ),
        default_model_required=_require_boolean(
            model_config_policy["defaultModelRequired"],
            label="modelConfigPolicy.defaultModelRequired",
        ),
        allow_model_display_name_override=(
            None
            if "allowModelDisplayNameOverride" not in model_config_policy
            else _require_boolean(
                model_config_policy["allowModelDisplayNameOverride"],
                label="modelConfigPolicy.allowModelDisplayNameOverride",
            )
        ),
    )


def _parse_capability_hints(
    raw_capability_hints: Any,
) -> ProviderCatalogCapabilityHints:
    capability_hints = _require_mapping(raw_capability_hints, label="capabilityHints")
    return ProviderCatalogCapabilityHints(
        streaming=_optional_boolean(capability_hints.get("streaming")),
        tools=_optional_boolean(capability_hints.get("tools")),
        vision=_optional_boolean(capability_hints.get("vision")),
        reasoning=_optional_boolean(capability_hints.get("reasoning")),
        search=_optional_boolean(capability_hints.get("search")),
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
    return normalized  # type: ignore[return-value]


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

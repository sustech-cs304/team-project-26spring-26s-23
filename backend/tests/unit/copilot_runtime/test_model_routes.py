from __future__ import annotations

import asyncio

import pytest
from pydantic import ValidationError

from app.copilot_runtime.model_routes import (
    HostModelRouteAccessDeniedError,
    HostModelRouteUnavailableError,
    ProviderProfileNotFoundError,
    ProviderSecretMissingError,
    ResolvedRuntimeModelRoute,
    RuntimeModelRoute,
    RuntimeModelRouteRef,
    RuntimeModelRouteResolutionError,
    RuntimeModelRouteResolver,
    _normalize_capability_hints,
    _normalize_optional_text,
    _resolve_endpoint_family,
)


class FakeRuntimeModelRouteResolver:
    """Concrete test-double that implements RuntimeModelRouteResolver."""

    def __init__(
        self,
        catalog: dict[str, dict] | None = None,
    ) -> None:
        self._catalog = catalog or {}

    async def resolve(
        self,
        model_route: RuntimeModelRoute,
        *,
        catalog: dict[str, dict] | None = None,
    ) -> ResolvedRuntimeModelRoute:
        working_catalog = catalog if catalog is not None else self._catalog
        profile_id = model_route.provider_profile_id

        if profile_id not in working_catalog:
            raise ProviderProfileNotFoundError(provider_profile_id=profile_id)

        provider_data = working_catalog[profile_id]
        model_id = model_route.model_id
        entries = provider_data.get("models", [])

        matching = [e for e in entries if e.get("model_id", "") == model_id]

        if not matching:
            raise RuntimeModelRouteResolutionError(
                code="model_not_found",
                message=(
                    f"Model '{model_id}' not found for "
                    f"provider profile '{profile_id}'."
                ),
                details={
                    "providerProfileId": profile_id,
                    "modelId": model_id,
                },
            )

        if len(matching) > 1:
            enabled = [
                m
                for m in matching
                if m.get("runtime_status", "enabled") == "enabled"
            ]
            if enabled:
                matching = enabled

        selected = matching[0]

        return ResolvedRuntimeModelRoute(
            provider_profile_id=profile_id,
            provider=provider_data.get("provider", profile_id),
            provider_id=provider_data.get("provider_id", profile_id),
            endpoint_type=provider_data.get("endpoint_type", ""),
            base_url=selected.get("base_url", ""),
            model_id=model_id,
            api_key=selected.get("api_key", ""),
            route_ref=model_route.route_ref,
            catalog_revision=model_route.catalog_revision or "",
            runtime_status=selected.get("runtime_status", "enabled"),
            capability_hints=selected.get("capability_hints", {}),
        )


def _make_route_ref(
    route_kind: str = "provider-model",
    profile_id: str = "profile-openai",
    model_id: str = "gpt-4o",
) -> RuntimeModelRouteRef:
    return RuntimeModelRouteRef(
        route_kind=route_kind,
        profile_id=profile_id,
        model_id=model_id,
    )


def _make_route(
    provider_profile_id: str = "profile-openai",
    route_kind: str = "provider-model",
    model_id: str = "gpt-4o",
    catalog_revision: str | None = None,
) -> RuntimeModelRoute:
    return RuntimeModelRoute(
        provider_profile_id=provider_profile_id,
        route_ref=_make_route_ref(
            route_kind=route_kind,
            profile_id=provider_profile_id,
            model_id=model_id,
        ),
        catalog_revision=catalog_revision,
    )


def _make_openai_catalog() -> dict[str, dict]:
    return {
        "profile-openai": {
            "provider": "openai",
            "provider_id": "openai",
            "endpoint_type": "openai-compatible",
            "adapter_id": "openai",
            "models": [
                {
                    "model_id": "gpt-4o",
                    "model_display_name": "GPT-4o",
                    "base_url": "https://api.openai.com/v1",
                    "api_key": "sk-test-key",
                    "runtime_status": "enabled",
                },
                {
                    "model_id": "gpt-4o-mini",
                    "model_display_name": "GPT-4o Mini",
                    "base_url": "https://api.openai.com/v1",
                    "api_key": "sk-test-key",
                    "runtime_status": "enabled",
                },
            ],
        },
    }


def _make_multi_provider_catalog() -> dict[str, dict]:
    base = _make_openai_catalog()
    base["profile-anthropic"] = {
        "provider": "anthropic",
        "provider_id": "anthropic",
        "endpoint_type": "anthropic-native",
        "adapter_id": "anthropic",
        "models": [
            {
                "model_id": "claude-sonnet-4-20250514",
                "model_display_name": "Claude Sonnet 4",
                "base_url": "https://api.anthropic.com",
                "api_key": "sk-ant-test-key",
                "runtime_status": "enabled",
            },
        ],
    }
    return base


# ---------------------------------------------------------------------------
# RuntimeModelRouteRef
# ---------------------------------------------------------------------------

class TestRuntimeModelRouteRef:
    def test_construction_sets_fields(self) -> None:
        ref = RuntimeModelRouteRef(
            route_kind="provider-model",
            profile_id="profile-abc",
            model_id="gpt-4o",
        )
        assert ref.route_kind == "provider-model"
        assert ref.profile_id == "profile-abc"
        assert ref.model_id == "gpt-4o"

    def test_construction_via_validation_aliases(self) -> None:
        ref = RuntimeModelRouteRef.model_validate({
            "routeKind": "provider-model",
            "profileId": "profile-abc",
            "modelId": "gpt-4o",
        })
        assert ref.route_kind == "provider-model"
        assert ref.profile_id == "profile-abc"
        assert ref.model_id == "gpt-4o"

    def test_missing_required_fields_raises_validation_error(self) -> None:
        with pytest.raises(ValidationError):
            RuntimeModelRouteRef.model_validate({"routeKind": "provider-model"})

    def test_to_dict_returns_camel_case_keys(self) -> None:
        ref = _make_route_ref("provider-model", "profile-x", "gemini-pro")
        result = ref.to_dict()
        assert result == {
            "routeKind": "provider-model",
            "profileId": "profile-x",
            "modelId": "gemini-pro",
        }

    def test_immutability(self) -> None:
        ref = _make_route_ref()
        with pytest.raises(ValidationError):
            ref.route_kind = "other"  # type: ignore[misc]


# ---------------------------------------------------------------------------
# RuntimeModelRoute
# ---------------------------------------------------------------------------

class TestRuntimeModelRoute:
    def test_construction_sets_fields(self) -> None:
        route = _make_route("profile-openai", "provider-model", "gpt-4o")
        assert route.provider_profile_id == "profile-openai"
        assert route.route_ref.model_id == "gpt-4o"
        assert route.model_id == "gpt-4o"
        assert route.catalog_revision is None

    def test_catalog_revision_defaults_to_none(self) -> None:
        route = _make_route(catalog_revision=None)
        assert route.catalog_revision is None

    def test_catalog_revision_stored_when_provided(self) -> None:
        route = _make_route(catalog_revision="rev-2026")
        assert route.catalog_revision == "rev-2026"

    def test_model_id_property_delegates_to_route_ref(self) -> None:
        route = _make_route(model_id="claude-sonnet")
        assert route.model_id == "claude-sonnet"

    def test_validator_rejects_mismatched_profile_ids(self) -> None:
        with pytest.raises(ValidationError, match="must match route_ref.profile_id"):
            RuntimeModelRoute.model_validate({
                "providerProfileId": "profile-x",
                "routeRef": {
                    "routeKind": "provider-model",
                    "profileId": "profile-y",
                    "modelId": "gpt-4o",
                },
            })

    def test_construction_via_raw_dict(self) -> None:
        route = RuntimeModelRoute.model_validate({
            "providerProfileId": "profile-abc",
            "routeRef": {
                "routeKind": "provider-model",
                "profileId": "profile-abc",
                "modelId": "gpt-4o",
            },
            "catalogRevision": "rev-1",
        })
        assert route.provider_profile_id == "profile-abc"
        assert route.model_id == "gpt-4o"
        assert route.catalog_revision == "rev-1"

    def test_to_dict_includes_route_ref(self) -> None:
        route = _make_route(catalog_revision="rev-1")
        payload = route.to_dict()
        assert payload["routeRef"] == {
            "routeKind": "provider-model",
            "profileId": "profile-openai",
            "modelId": "gpt-4o",
        }
        assert payload["catalogRevision"] == "rev-1"

    def test_to_dict_omits_catalog_revision_when_none(self) -> None:
        route = _make_route(catalog_revision=None)
        payload = route.to_dict()
        assert "catalogRevision" not in payload

    def test_to_dict_omits_catalog_revision_when_empty(self) -> None:
        route = _make_route(catalog_revision="   ")
        payload = route.to_dict()
        assert "catalogRevision" not in payload

    def test_empty_model_id_is_accepted(self) -> None:
        route = RuntimeModelRoute.model_validate({
            "providerProfileId": "profile-empty",
            "routeRef": {
                "routeKind": "provider-model",
                "profileId": "profile-empty",
                "modelId": "",
            },
        })
        assert route.model_id == ""

    def test_immutability(self) -> None:
        route = _make_route()
        with pytest.raises(ValidationError):
            route.provider_profile_id = "other"  # type: ignore[misc]


# ---------------------------------------------------------------------------
# ResolvedRuntimeModelRoute
# ---------------------------------------------------------------------------

class TestResolvedRuntimeModelRoute:
    def test_construction_with_all_fields(self) -> None:
        resolved = ResolvedRuntimeModelRoute(
            provider_profile_id="profile-openai",
            provider="openai",
            endpoint_type="openai-compatible",
            base_url="https://api.openai.com/v1",
            model_id="gpt-4o",
            api_key="sk-test-key",
        )
        assert resolved.provider_profile_id == "profile-openai"
        assert resolved.provider == "openai"
        assert resolved.endpoint_type == "openai-compatible"
        assert resolved.base_url == "https://api.openai.com/v1"
        assert resolved.model_id == "gpt-4o"
        assert resolved.api_key == "sk-test-key"

    def test_defaults(self) -> None:
        resolved = ResolvedRuntimeModelRoute(
            provider_profile_id="profile-openai",
            provider="openai",
            endpoint_type="openai-compatible",
            base_url="https://api.openai.com/v1",
            model_id="gpt-4o",
            api_key="sk-test-key",
        )
        assert resolved.route_ref is not None
        assert resolved.runtime_status == "enabled"
        assert resolved.catalog_revision == ""
        assert resolved.adapter_id == ""
        assert resolved.provider_id is not None
        assert resolved.auth_kind == "api-key"

    def test_normalizes_route_ref_when_none_supplied(self) -> None:
        resolved = ResolvedRuntimeModelRoute(
            provider_profile_id="profile-openai",
            provider="openai",
            endpoint_type="openai-compatible",
            base_url="https://api.openai.com/v1",
            model_id="gpt-4o",
            api_key="sk-test-key",
            route_ref=None,
        )
        assert resolved.route_ref is not None
        assert resolved.route_ref.route_kind == "provider-model"
        assert resolved.route_ref.profile_id == "profile-openai"
        assert resolved.route_ref.model_id == "gpt-4o"

    def test_preserves_provided_route_ref(self) -> None:
        ref = _make_route_ref("provider-model", "profile-abc", "custom-model")
        resolved = ResolvedRuntimeModelRoute(
            provider_profile_id="profile-abc",
            provider="some-provider",
            endpoint_type="openai-compatible",
            base_url="https://example.com",
            model_id="custom-model",
            api_key="sk-key",
            route_ref=ref,
        )
        assert resolved.route_ref is ref

    def test_normalizes_provider_id_from_provider(self) -> None:
        resolved = ResolvedRuntimeModelRoute(
            provider_profile_id="profile-x",
            provider="  openai  ",
            provider_id=None,
            endpoint_type="openai-compatible",
            base_url="https://api.openai.com/v1",
            model_id="gpt-4o",
            api_key="sk-key",
        )
        assert resolved.provider_id == "openai"

    def test_normalizes_provider_id_when_explicitly_set(self) -> None:
        resolved = ResolvedRuntimeModelRoute(
            provider_profile_id="profile-x",
            provider="some-provider",
            provider_id="  explicit-id  ",
            endpoint_type="openai-compatible",
            base_url="https://example.com",
            model_id="gpt-4o",
            api_key="sk-key",
        )
        assert resolved.provider_id == "explicit-id"

    def test_resolves_endpoint_family_from_endpoint_type(self) -> None:
        resolved = ResolvedRuntimeModelRoute(
            provider_profile_id="profile-x",
            provider="openai",
            endpoint_type="openai-compatible",
            endpoint_family="",
            base_url="https://api.openai.com/v1",
            model_id="gpt-4o",
            api_key="sk-key",
        )
        assert resolved.endpoint_family == "openai"

    def test_resolves_endpoint_family_no_hyphen(self) -> None:
        resolved = ResolvedRuntimeModelRoute(
            provider_profile_id="profile-x",
            provider="test",
            endpoint_type="  gemini-native  ",
            endpoint_family="",
            base_url="https://example.com",
            model_id="gemini-pro",
            api_key="sk-key",
        )
        assert resolved.endpoint_family == "gemini"

    def test_endpoint_family_empty_when_empty_type(self) -> None:
        resolved = ResolvedRuntimeModelRoute(
            provider_profile_id="profile-x",
            provider="test",
            endpoint_type="",
            endpoint_family="",
            base_url="https://example.com",
            model_id="gemini-pro",
            api_key="sk-key",
        )
        assert resolved.endpoint_family == ""

    def test_endpoint_family_preserved_when_explicit(self) -> None:
        resolved = ResolvedRuntimeModelRoute(
            provider_profile_id="profile-x",
            provider="test",
            endpoint_type="openai-compatible",
            endpoint_family="custom-family",
            base_url="https://example.com",
            model_id="gpt-4o",
            api_key="sk-key",
        )
        assert resolved.endpoint_family == "custom-family"

    def test_auth_kind_normalized_to_api_key_when_key_present(self) -> None:
        resolved = ResolvedRuntimeModelRoute(
            provider_profile_id="profile-x",
            provider="openai",
            endpoint_type="openai-compatible",
            base_url="https://api.openai.com/v1",
            model_id="gpt-4o",
            api_key="sk-key",
            auth_kind="",
        )
        assert resolved.auth_kind == "api-key"

    def test_auth_kind_default_none_when_no_key(self) -> None:
        resolved = ResolvedRuntimeModelRoute(
            provider_profile_id="profile-x",
            provider="ollama",
            endpoint_type="ollama-native",
            base_url="http://localhost:11434",
            model_id="llama3",
            api_key="",
        )
        assert resolved.auth_kind == "none"

    def test_auth_kind_explicit_empty_normalizes_to_none_when_no_key(self) -> None:
        resolved = ResolvedRuntimeModelRoute(
            provider_profile_id="profile-x",
            provider="ollama",
            endpoint_type="ollama-native",
            base_url="http://localhost:11434",
            model_id="llama3",
            api_key="",
            auth_kind="",
        )
        assert resolved.auth_kind == "none"

    def test_auth_kind_preserves_explicit_value(self) -> None:
        resolved = ResolvedRuntimeModelRoute(
            provider_profile_id="profile-x",
            provider="test",
            endpoint_type="openai-compatible",
            base_url="https://example.com",
            model_id="gpt-4o",
            api_key="sk-key",
            auth_kind="custom-kind",
        )
        assert resolved.auth_kind == "custom-kind"

    def test_capability_hints_normalized(self) -> None:
        resolved = ResolvedRuntimeModelRoute(
            provider_profile_id="profile-x",
            provider="openai",
            endpoint_type="openai-compatible",
            base_url="https://api.openai.com/v1",
            model_id="gpt-4o",
            api_key="sk-key",
            capability_hints={"streaming": True, "vision": True},
        )
        assert resolved.capability_hints == {"streaming": True, "vision": True}

    def test_capability_hints_defaults_to_empty(self) -> None:
        resolved = ResolvedRuntimeModelRoute(
            provider_profile_id="profile-x",
            provider="openai",
            endpoint_type="openai-compatible",
            base_url="https://api.openai.com/v1",
            model_id="gpt-4o",
            api_key="sk-key",
        )
        assert resolved.capability_hints == {}

    def test_to_resolved_route_dict_includes_all_fields(self) -> None:
        resolved = ResolvedRuntimeModelRoute(
            provider_profile_id="profile-openai",
            provider="openai",
            provider_id="openai",
            endpoint_type="openai-compatible",
            base_url="https://api.openai.com/v1",
            model_id="gpt-4o",
            api_key="sk-test-key",
            route_ref=_make_route_ref(),
            adapter_id="openai",
            catalog_revision="rev-1",
            capability_hints={"streaming": True},
        )
        d = resolved.to_resolved_route_dict()
        assert d["routeRef"] == {
            "routeKind": "provider-model",
            "profileId": "profile-openai",
            "modelId": "gpt-4o",
        }
        assert d["providerProfileId"] == "profile-openai"
        assert d["provider"] == "openai"
        assert d["providerId"] == "openai"
        assert d["adapterId"] == "openai"
        assert d["runtimeStatus"] == "enabled"
        assert d["catalogRevision"] == "rev-1"
        assert d["endpointFamily"] == "openai"
        assert d["endpointType"] == "openai-compatible"
        assert d["baseUrl"] == "https://api.openai.com/v1"
        assert d["modelId"] == "gpt-4o"
        assert d["authKind"] == "api-key"
        assert d["capabilityHints"] == {"streaming": True}

    def test_to_public_dict_matches_to_resolved_route_dict(self) -> None:
        resolved = ResolvedRuntimeModelRoute(
            provider_profile_id="profile-openai",
            provider="openai",
            endpoint_type="openai-compatible",
            base_url="https://api.openai.com/v1",
            model_id="gpt-4o",
            api_key="sk-key",
        )
        assert resolved.to_public_dict() == resolved.to_resolved_route_dict()

    def test_immutability_frozen_dataclass(self) -> None:
        resolved = ResolvedRuntimeModelRoute(
            provider_profile_id="profile-openai",
            provider="openai",
            endpoint_type="openai-compatible",
            base_url="https://api.openai.com/v1",
            model_id="gpt-4o",
            api_key="sk-key",
        )
        with pytest.raises(Exception):
            resolved.model_id = "other"  # type: ignore[misc]

    def test_api_key_not_exposed_in_public_dict(self) -> None:
        resolved = ResolvedRuntimeModelRoute(
            provider_profile_id="profile-openai",
            provider="openai",
            endpoint_type="openai-compatible",
            base_url="https://api.openai.com/v1",
            model_id="gpt-4o",
            api_key="sk-secret-key",
        )
        d = resolved.to_public_dict()
        assert "apiKey" not in d
        assert "api_key" not in d


# ---------------------------------------------------------------------------
# FakeRuntimeModelRouteResolver
# ---------------------------------------------------------------------------

class TestFakeRuntimeModelRouteResolverInit:
    def test_init_with_empty_catalog(self) -> None:
        resolver = FakeRuntimeModelRouteResolver(catalog={})
        assert resolver._catalog == {}

    def test_init_with_none_catalog_defaults_to_empty(self) -> None:
        resolver = FakeRuntimeModelRouteResolver(catalog=None)
        assert resolver._catalog == {}

    def test_init_with_single_provider(self) -> None:
        catalog = _make_openai_catalog()
        resolver = FakeRuntimeModelRouteResolver(catalog=catalog)
        assert "profile-openai" in resolver._catalog
        assert len(resolver._catalog) == 1

    def test_init_with_multiple_providers(self) -> None:
        catalog = _make_multi_provider_catalog()
        resolver = FakeRuntimeModelRouteResolver(catalog=catalog)
        assert len(resolver._catalog) == 2
        assert "profile-openai" in resolver._catalog
        assert "profile-anthropic" in resolver._catalog

    def test_resolver_conforms_to_protocol_structural(self) -> None:
        resolver = FakeRuntimeModelRouteResolver()
        assert hasattr(resolver, "resolve")
        assert callable(resolver.resolve)


class TestFakeRuntimeModelRouteResolverResolve:
    def test_resolve_happy_path_by_provider_and_model(self) -> None:
        async def _run():
            resolver = FakeRuntimeModelRouteResolver(catalog=_make_openai_catalog())
            route = _make_route("profile-openai", model_id="gpt-4o")
            resolved = await resolver.resolve(route)

            assert isinstance(resolved, ResolvedRuntimeModelRoute)
            assert resolved.provider_profile_id == "profile-openai"
            assert resolved.provider == "openai"
            assert resolved.model_id == "gpt-4o"
            assert resolved.base_url == "https://api.openai.com/v1"
            assert resolved.api_key == "sk-test-key"
            assert resolved.endpoint_type == "openai-compatible"
            assert resolved.runtime_status == "enabled"

        asyncio.run(_run())

    def test_resolve_different_model_same_provider(self) -> None:
        async def _run():
            resolver = FakeRuntimeModelRouteResolver(catalog=_make_openai_catalog())
            route = _make_route("profile-openai", model_id="gpt-4o-mini")
            resolved = await resolver.resolve(route)

            assert resolved.model_id == "gpt-4o-mini"

        asyncio.run(_run())

    def test_resolve_provider_not_found_raises(self) -> None:
        async def _run():
            resolver = FakeRuntimeModelRouteResolver(catalog=_make_openai_catalog())
            route = _make_route("profile-nonexistent", model_id="gpt-4o")

            with pytest.raises(ProviderProfileNotFoundError) as exc_info:
                await resolver.resolve(route)

            assert exc_info.value.code == "provider_profile_not_found"
            assert "profile-nonexistent" in exc_info.value.details["providerProfileId"]

        asyncio.run(_run())

    def test_resolve_model_not_found_for_provider_raises(self) -> None:
        async def _run():
            resolver = FakeRuntimeModelRouteResolver(catalog=_make_openai_catalog())
            route = _make_route("profile-openai", model_id="unknown-model")

            with pytest.raises(RuntimeModelRouteResolutionError) as exc_info:
                await resolver.resolve(route)

            assert exc_info.value.code == "model_not_found"
            assert "unknown-model" in str(exc_info.value)
            assert exc_info.value.details["providerProfileId"] == "profile-openai"
            assert exc_info.value.details["modelId"] == "unknown-model"

        asyncio.run(_run())

    def test_resolve_multiple_matching_models_disambiguates_by_enabled(
        self,
    ) -> None:
        async def _run():
            catalog = {
                "profile-openai": {
                    "provider": "openai",
                    "provider_id": "openai",
                    "endpoint_type": "openai-compatible",
                    "models": [
                        {
                            "model_id": "gpt-4o",
                            "base_url": "https://legacy.example.com",
                            "api_key": "sk-legacy",
                            "runtime_status": "legacy-unsupported",
                        },
                        {
                            "model_id": "gpt-4o",
                            "base_url": "https://api.openai.com/v1",
                            "api_key": "sk-enabled",
                            "runtime_status": "enabled",
                        },
                    ],
                },
            }
            resolver = FakeRuntimeModelRouteResolver(catalog=catalog)
            route = _make_route("profile-openai", model_id="gpt-4o")
            resolved = await resolver.resolve(route)

            assert resolved.api_key == "sk-enabled"
            assert resolved.base_url == "https://api.openai.com/v1"

        asyncio.run(_run())

    def test_resolve_accepts_catalog_at_resolve_time(self) -> None:
        async def _run():
            resolver = FakeRuntimeModelRouteResolver()
            route = _make_route("profile-openai", model_id="gpt-4o")
            resolved = await resolver.resolve(route, catalog=_make_openai_catalog())

            assert resolved.model_id == "gpt-4o"
            assert resolved.provider == "openai"

        asyncio.run(_run())

    def test_resolve_time_catalog_overrides_init_catalog(self) -> None:
        async def _run():
            init_catalog = _make_openai_catalog()
            resolve_catalog = {
                "profile-openai": {
                    "provider": "override-provider",
                    "provider_id": "override-provider",
                    "endpoint_type": "custom-type",
                    "models": [
                        {
                            "model_id": "gpt-4o",
                            "base_url": "https://override.example.com",
                            "api_key": "sk-override",
                            "runtime_status": "enabled",
                        },
                    ],
                },
            }
            resolver = FakeRuntimeModelRouteResolver(catalog=init_catalog)
            route = _make_route("profile-openai", model_id="gpt-4o")
            resolved = await resolver.resolve(route, catalog=resolve_catalog)

            assert resolved.provider == "override-provider"
            assert resolved.base_url == "https://override.example.com"

        asyncio.run(_run())

    def test_resolve_with_empty_catalog_raises(self) -> None:
        async def _run():
            resolver = FakeRuntimeModelRouteResolver(catalog={})
            route = _make_route("profile-openai", model_id="gpt-4o")

            with pytest.raises(ProviderProfileNotFoundError):
                await resolver.resolve(route)

        asyncio.run(_run())

    def test_resolve_empty_model_id(self) -> None:
        async def _run():
            catalog = {
                "profile-empty": {
                    "provider": "test",
                    "provider_id": "test",
                    "endpoint_type": "openai-compatible",
                    "models": [
                        {
                            "model_id": "",
                            "base_url": "https://example.com",
                            "api_key": "sk-key",
                            "runtime_status": "enabled",
                        },
                    ],
                },
            }
            resolver = FakeRuntimeModelRouteResolver(catalog=catalog)
            route = _make_route("profile-empty", model_id="")
            resolved = await resolver.resolve(route)

            assert resolved.model_id == ""

        asyncio.run(_run())

    def test_resolve_route_ref_preserved(self) -> None:
        async def _run():
            resolver = FakeRuntimeModelRouteResolver(catalog=_make_openai_catalog())
            ref = _make_route_ref("provider-model", "profile-openai", "gpt-4o")
            route = RuntimeModelRoute(
                provider_profile_id="profile-openai",
                route_ref=ref,
            )
            resolved = await resolver.resolve(route)

            assert resolved.route_ref is ref

        asyncio.run(_run())


# ---------------------------------------------------------------------------
# RuntimeModelRouteResolver Protocol verification
# ---------------------------------------------------------------------------

class TestRuntimeModelRouteResolverProtocol:
    def test_fake_resolver_implements_protocol(self) -> None:
        resolver = FakeRuntimeModelRouteResolver()
        assert callable(resolver.resolve)

    def test_protocol_requires_async_resolve(self) -> None:
        import inspect

        member = RuntimeModelRouteResolver.resolve
        assert inspect.iscoroutinefunction(member)


# ---------------------------------------------------------------------------
# Error classes
# ---------------------------------------------------------------------------

class TestRuntimeModelRouteResolutionError:
    def test_construction_sets_code_and_message(self) -> None:
        err = RuntimeModelRouteResolutionError(
            code="test_code",
            message="Something went wrong.",
        )
        assert err.code == "test_code"
        assert str(err) == "Something went wrong."
        assert err.details == {}

    def test_construction_with_details(self) -> None:
        err = RuntimeModelRouteResolutionError(
            code="test_code",
            message="Error with details.",
            details={"key": "value", "nested": {"a": 1}},
        )
        assert err.details == {"key": "value", "nested": {"a": 1}}

    def test_construction_with_none_details_defaults_to_empty(self) -> None:
        err = RuntimeModelRouteResolutionError(
            code="test_code",
            message="Error with no details.",
            details=None,
        )
        assert err.details == {}

    def test_is_subclass_of_runtime_error(self) -> None:
        err = RuntimeModelRouteResolutionError(code="x", message="y")
        assert isinstance(err, RuntimeError)


class TestProviderProfileNotFoundError:
    def test_construction(self) -> None:
        err = ProviderProfileNotFoundError(provider_profile_id="profile-missing")
        assert err.code == "provider_profile_not_found"
        assert "profile-missing" in str(err)
        assert err.details == {"providerProfileId": "profile-missing"}


class TestProviderSecretMissingError:
    def test_construction(self) -> None:
        err = ProviderSecretMissingError(provider_profile_id="profile-no-key")
        assert err.code == "provider_secret_missing"
        assert "profile-no-key" in str(err)
        assert err.details == {"providerProfileId": "profile-no-key"}


class TestHostModelRouteAccessDeniedError:
    def test_construction(self) -> None:
        err = HostModelRouteAccessDeniedError(header_name="X-Bridge-Token")
        assert err.code == "host_model_route_access_denied"
        assert err.details == {"headerName": "X-Bridge-Token"}


class TestHostModelRouteUnavailableError:
    def test_construction_without_detail(self) -> None:
        err = HostModelRouteUnavailableError()
        assert err.code == "host_model_route_unavailable"
        assert "unavailable" in str(err).lower()
        assert err.details == {}

    def test_construction_with_detail(self) -> None:
        err = HostModelRouteUnavailableError(detail="Connection refused.")
        assert err.code == "host_model_route_unavailable"
        assert err.details == {"detail": "Connection refused."}

    def test_construction_with_empty_detail(self) -> None:
        err = HostModelRouteUnavailableError(detail="   ")
        assert err.details == {}

    def test_construction_with_none_detail(self) -> None:
        err = HostModelRouteUnavailableError(detail=None)
        assert err.details == {}


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

class TestNormalizeOptionalText:
    def test_returns_none_for_none(self) -> None:
        assert _normalize_optional_text(None) is None

    def test_returns_none_for_non_string(self) -> None:
        assert _normalize_optional_text(42) is None  # type: ignore[arg-type]
        assert _normalize_optional_text(True) is None  # type: ignore[arg-type]
        assert _normalize_optional_text([1, 2]) is None  # type: ignore[arg-type]

    def test_returns_none_for_empty_string(self) -> None:
        assert _normalize_optional_text("") is None

    def test_returns_none_for_whitespace_string(self) -> None:
        assert _normalize_optional_text("   ") is None
        assert _normalize_optional_text("\t\n") is None

    def test_returns_stripped_string(self) -> None:
        assert _normalize_optional_text("  hello  ") == "hello"

    def test_returns_original_when_clean(self) -> None:
        assert _normalize_optional_text("openai") == "openai"


class TestNormalizeCapabilityHints:
    def test_returns_empty_for_none(self) -> None:
        assert _normalize_capability_hints(None) == {}

    def test_returns_empty_for_non_mapping(self) -> None:
        assert _normalize_capability_hints("string") == {}  # type: ignore[arg-type]
        assert _normalize_capability_hints(42) == {}  # type: ignore[arg-type]

    def test_returns_dict_with_str_keys(self) -> None:
        assert _normalize_capability_hints({"a": 1, 2: "b"}) == {"a": 1, "2": "b"}  # type: ignore[dict-item]

    def test_returns_copy_of_dict(self) -> None:
        original = {"streaming": True}
        result = _normalize_capability_hints(original)
        assert result == original
        assert result is not original


class TestResolveEndpointFamily:
    def test_returns_family_before_hyphen(self) -> None:
        assert _resolve_endpoint_family("openai-compatible") == "openai"
        assert _resolve_endpoint_family("anthropic-native") == "anthropic"

    def test_returns_full_when_no_hyphen(self) -> None:
        assert _resolve_endpoint_family("ollama") == "ollama"

    def test_returns_empty_for_empty_string(self) -> None:
        assert _resolve_endpoint_family("") == ""

    def test_returns_empty_for_whitespace(self) -> None:
        assert _resolve_endpoint_family("   ") == ""

    def test_returns_first_segment_when_multiple_hyphens(self) -> None:
        assert _resolve_endpoint_family("openai-compatible-v2") == "openai"

from __future__ import annotations

from pathlib import Path

import pytest
from jsonschema import Draft202012Validator
from pydantic import ValidationError

import app.copilot_runtime.provider_catalog as provider_catalog_module
from app.copilot_runtime.provider_catalog import ProviderCatalogAuthSchema


def test_provider_catalog_documents_match_schema() -> None:
    schema, registry = provider_catalog_module.load_provider_catalog_documents()

    Draft202012Validator.check_schema(schema)
    Draft202012Validator(schema).validate(registry)
    assert provider_catalog_module.provider_catalog_root().name == "provider-catalog"
    assert (
        provider_catalog_module.load_provider_catalog().model_dump()["providers"][0][
            "auth_schema"
        ]["details"]
        == {}
    )


def test_provider_catalog_root_prefers_bundled_adjacent_catalog(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bundled_root = tmp_path / "python-runtime" / "provider-catalog"
    dev_root = tmp_path / "repo" / "provider-catalog"
    for root in (bundled_root, dev_root):
        root.mkdir(parents=True)
        (root / "schema.json").write_text("{}", encoding="utf-8")
        (root / "registry.json").write_text("{}", encoding="utf-8")

    provider_catalog_module.provider_catalog_root.cache_clear()
    provider_catalog_module.load_provider_catalog_documents.cache_clear()
    provider_catalog_module.load_provider_catalog.cache_clear()
    monkeypatch.setattr(
        provider_catalog_module,
        "_bundled_provider_catalog_root",
        lambda: bundled_root,
    )
    monkeypatch.setattr(
        provider_catalog_module,
        "_search_dev_repo_provider_catalog_root",
        lambda: dev_root,
    )

    try:
        assert provider_catalog_module.provider_catalog_root() == bundled_root.resolve(strict=False)
    finally:
        provider_catalog_module.provider_catalog_root.cache_clear()
        provider_catalog_module.load_provider_catalog_documents.cache_clear()
        provider_catalog_module.load_provider_catalog.cache_clear()


def test_provider_catalog_includes_first_batch_enabled_providers() -> None:
    catalog = provider_catalog_module.load_provider_catalog()
    enabled_provider_ids = {
        entry.provider_id
        for entry in provider_catalog_module.list_provider_catalog_entries(runtime_status="enabled")
    }

    assert catalog.catalog_revision == "2026-04-06-provider-catalog-v1"
    assert {"openai", "anthropic", "gemini", "ollama", "groq", "mistral"}.issubset(
        enabled_provider_ids
    )


def test_provider_catalog_distinguishes_runtime_statuses() -> None:
    all_entries = provider_catalog_module.list_provider_catalog_entries()
    assert len(all_entries) >= 6

    openrouter_entry = provider_catalog_module.get_provider_catalog_entry("openrouter")
    legacy_entry = provider_catalog_module.get_provider_catalog_entry("openai-response")
    ollama_entry = provider_catalog_module.get_provider_catalog_entry("ollama")

    assert openrouter_entry is not None
    assert openrouter_entry.runtime_status == "catalog-only"
    assert openrouter_entry.endpoint_type == "openai-compatible"

    assert legacy_entry is not None
    assert legacy_entry.runtime_status == "legacy-unsupported"
    assert legacy_entry.endpoint_type == "openai-response"

    assert ollama_entry is not None
    assert ollama_entry.runtime_status == "enabled"
    assert ollama_entry.auth_schema.default_kind == "none"
    assert ollama_entry.base_url_policy.default_base_url == "http://127.0.0.1:11434/v1"
    assert ollama_entry.metadata == {}
    assert ollama_entry.details == {}


def test_provider_catalog_resolves_aliases() -> None:
    gemini_entry = provider_catalog_module.get_provider_catalog_entry("google")
    xai_entry = provider_catalog_module.get_provider_catalog_entry("grok")

    assert gemini_entry is not None
    assert gemini_entry.provider_id == "gemini"
    assert gemini_entry.endpoint_type == "gemini-native"

    assert xai_entry is not None
    assert xai_entry.provider_id == "xai"
    assert xai_entry.endpoint_type == "xai-native"


def test_provider_catalog_secret_field_names_report_actual_constraints() -> None:
    with pytest.raises(
        ValidationError,
        match="authSchema.secretFields must start with a letter and contain only letters and digits.",
    ):
        ProviderCatalogAuthSchema.model_validate(
            {
                "defaultKind": "api-key",
                "supportedKinds": ["api-key"],
                "secretFields": ["api_key"],
            }
        )

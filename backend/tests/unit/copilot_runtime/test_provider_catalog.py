from __future__ import annotations

from app.copilot_runtime.provider_catalog import (
    get_provider_catalog_entry,
    list_provider_catalog_entries,
    list_provider_catalog_entries as list_entries,
    load_provider_catalog,
    load_provider_catalog_documents,
    provider_catalog_root,
)
from jsonschema import Draft202012Validator


def test_provider_catalog_documents_match_schema() -> None:
    schema, registry = load_provider_catalog_documents()

    Draft202012Validator.check_schema(schema)
    Draft202012Validator(schema).validate(registry)
    assert provider_catalog_root().name == "provider-catalog"


def test_provider_catalog_includes_first_batch_enabled_providers() -> None:
    catalog = load_provider_catalog()
    enabled_provider_ids = {
        entry.provider_id
        for entry in list_entries(runtime_status="enabled")
    }

    assert catalog.catalog_revision == "2026-04-06-provider-catalog-v1"
    assert {"openai", "anthropic", "gemini", "ollama", "groq", "mistral"}.issubset(enabled_provider_ids)


def test_provider_catalog_distinguishes_runtime_statuses() -> None:
    all_entries = list_provider_catalog_entries()
    assert len(all_entries) >= 6

    openrouter_entry = get_provider_catalog_entry("openrouter")
    legacy_entry = get_provider_catalog_entry("openai-response")
    ollama_entry = get_provider_catalog_entry("ollama")

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


def test_provider_catalog_resolves_aliases() -> None:
    gemini_entry = get_provider_catalog_entry("google")
    xai_entry = get_provider_catalog_entry("grok")

    assert gemini_entry is not None
    assert gemini_entry.provider_id == "gemini"
    assert gemini_entry.endpoint_type == "gemini-native"

    assert xai_entry is not None
    assert xai_entry.provider_id == "xai"
    assert xai_entry.endpoint_type == "xai-native"

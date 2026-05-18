from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.copilot_runtime.skill_snapshot_provider import (
    SKILL_CAPABILITY_BRIDGE_STATE_FILE_NAME,
    SKILL_CAPABILITY_SNAPSHOT_BRIDGE_KEY,
    SKILL_CAPABILITY_SNAPSHOT_BRIDGE_TOOL_ID,
    SKILL_CAPABILITY_SNAPSHOT_FILE_NAME,
    SKILL_RESOURCE_MAX_BYTES,
    SKILL_SNAPSHOT_VERSION,
    activate_skill,
    build_skill_index_system_prompt,
    collect_skill_snapshot_forbidden_paths,
    create_skill_snapshot_provider,
    read_skill_resource,
    validate_skill_capability_snapshot,
)


def test_validate_skill_capability_snapshot_accepts_runtime_shape() -> None:
    payload = _build_skill_snapshot_payload()

    snapshot = validate_skill_capability_snapshot(payload)

    assert snapshot.version == SKILL_SNAPSHOT_VERSION
    assert snapshot.snapshot_revision == 8
    assert [skill.skill_id for skill in snapshot.skills] == ["writing-clear-docs"]
    assert collect_skill_snapshot_forbidden_paths(payload) == []


def test_validate_skill_capability_snapshot_rejects_version_mismatch() -> None:
    payload = _build_skill_snapshot_payload()
    payload["version"] = SKILL_SNAPSHOT_VERSION + 1

    with pytest.raises(ValidationError):
        validate_skill_capability_snapshot(payload)


def test_create_skill_snapshot_provider_loads_snapshot_file_and_runtime_index(
    tmp_path: Path,
) -> None:
    state_dir, config_dir, runtime_root_dir = _write_skill_runtime_fixture(tmp_path)
    provider = create_skill_snapshot_provider(
        state_dir=state_dir,
        config_dir=config_dir,
        runtime_root_dir=runtime_root_dir,
    )

    result = provider.load_snapshot_result()
    index = provider.load_runtime_index()

    assert result.source == "snapshot-file"
    assert result.snapshot is not None
    assert result.snapshot.snapshot_revision == 8
    assert index.source == "snapshot-file"
    assert index.snapshot_revision == 8
    assert tuple(index.skills_by_id) == ("writing-clear-docs",)
    assert index.locators_by_id["writing-clear-docs"].entry_path == "SKILL.md"


def test_create_skill_snapshot_provider_falls_back_to_bridge_state_and_cache(
    tmp_path: Path,
) -> None:
    state_dir, config_dir, runtime_root_dir = _write_skill_runtime_fixture(tmp_path)
    snapshot_file = state_dir / SKILL_CAPABILITY_SNAPSHOT_FILE_NAME
    payload = json.loads(snapshot_file.read_text(encoding="utf-8"))
    snapshot_file.unlink()
    (state_dir / SKILL_CAPABILITY_BRIDGE_STATE_FILE_NAME).write_text(
        json.dumps(
            {
                "version": 1,
                "values": {
                    "tool": {
                        SKILL_CAPABILITY_SNAPSHOT_BRIDGE_TOOL_ID: {
                            SKILL_CAPABILITY_SNAPSHOT_BRIDGE_KEY: payload,
                        }
                    },
                    "run": {},
                },
            }
        ),
        encoding="utf-8",
    )
    provider = create_skill_snapshot_provider(
        state_dir=state_dir,
        config_dir=config_dir,
        runtime_root_dir=runtime_root_dir,
    )

    from_bridge = provider.load_snapshot_result()
    (state_dir / SKILL_CAPABILITY_BRIDGE_STATE_FILE_NAME).write_text(
        "{ invalid json }\n",
        encoding="utf-8",
    )
    from_cache = provider.load_snapshot_result()

    assert from_bridge.source == "capability-bridge-state"
    assert from_bridge.snapshot is not None
    assert from_bridge.snapshot.snapshot_revision == 8
    assert from_cache.source == "cache"
    assert from_cache.snapshot is not None
    assert from_cache.snapshot.snapshot_revision == 8


def test_create_skill_snapshot_provider_returns_empty_index_when_snapshot_missing(
    tmp_path: Path,
) -> None:
    provider = create_skill_snapshot_provider(
        state_dir=tmp_path / "state",
        config_dir=tmp_path / "config",
        runtime_root_dir=tmp_path / "runtime",
    )

    result = provider.load_snapshot_result()
    index = provider.load_runtime_index()

    assert result.source == "missing"
    assert result.snapshot is None
    assert index.source == "missing"
    assert index.snapshot_revision is None
    assert index.skills_by_id == {}
    prompt = build_skill_index_system_prompt(index)
    assert prompt is not None
    assert "No enabled Skills" in prompt


def test_create_skill_snapshot_provider_rejects_redaction_violations(
    tmp_path: Path,
) -> None:
    state_dir = tmp_path / "state"
    state_dir.mkdir(parents=True)
    payload = _build_skill_snapshot_payload()
    payload["managedDirectoryName"] = "writing-clear-docs"
    (state_dir / SKILL_CAPABILITY_SNAPSHOT_FILE_NAME).write_text(
        json.dumps(payload),
        encoding="utf-8",
    )
    provider = create_skill_snapshot_provider(state_dir=state_dir)

    result = provider.load_snapshot_result()

    assert result.source == "missing"
    assert result.snapshot is None


def test_build_skill_index_system_prompt_is_lightweight(tmp_path: Path) -> None:
    state_dir, config_dir, runtime_root_dir = _write_skill_runtime_fixture(tmp_path)
    entry_content = "# Clear Docs\nDetailed entry instructions must stay out of the index."
    resource_content = "Do not inject this checklist body into the index."
    skill_root = runtime_root_dir / "skills" / "writing-clear-docs"
    (skill_root / "SKILL.md").write_text(entry_content, encoding="utf-8")
    (skill_root / "resources" / "checklist.md").write_text(
        resource_content,
        encoding="utf-8",
    )
    provider = create_skill_snapshot_provider(
        state_dir=state_dir,
        config_dir=config_dir,
        runtime_root_dir=runtime_root_dir,
    )

    prompt = build_skill_index_system_prompt(provider.load_runtime_index())

    assert prompt is not None
    assert "Available Skills" in prompt
    assert "writing-clear-docs" in prompt
    assert "Resources indexed: 1" in prompt
    assert "MUST call skill_activate(skill_id)" in prompt
    assert "Do not answer a matching task from this lightweight list alone" in prompt
    assert "call skill_read_resource(skill_id, path)" in prompt
    assert "entry instructions must stay out" not in prompt
    assert "Do not inject this checklist body" not in prompt
    assert "resources/checklist.md" not in prompt
    assert "entryContent" not in prompt
    assert "content" not in prompt


def test_skill_activate_success_and_failure(tmp_path: Path) -> None:
    index = _load_skill_runtime_index(tmp_path)

    activated = activate_skill(index, "Clear Docs")
    missing = activate_skill(index, "missing-skill")

    assert activated["ok"] is True
    assert activated["skillId"] == "writing-clear-docs"
    assert activated["displayName"] == "Clear Docs"
    assert activated["entryContent"] == "# Clear Docs\nUse this skill to write concise docs.\n"
    assert activated["resources"] == [{"path": "resources/checklist.md"}]
    assert "entrySummary" not in activated
    assert "entryContentLength" not in activated
    assert missing == {
        "ok": False,
        "errorCode": "skill_not_found",
        "message": "Skill was not found in the enabled skill snapshot.",
        "skillId": "missing-skill",
        "snapshotRevision": 8,
    }


def test_skill_read_resource_success_and_failures_without_activation(tmp_path: Path) -> None:
    index = _load_skill_runtime_index(tmp_path)

    success = read_skill_resource(index, "writing-clear-docs", "resources/checklist.md")
    traversal = read_skill_resource(index, "writing-clear-docs", "../secret.md")
    missing = read_skill_resource(index, "writing-clear-docs", "resources/missing.md")

    assert success == {
        "ok": True,
        "skillId": "writing-clear-docs",
        "displayName": "Clear Docs",
        "path": "resources/checklist.md",
        "content": "- Prefer structure over verbosity.\n",
        "snapshotRevision": 8,
    }
    assert "entryContent" not in success
    assert traversal["errorCode"] == "invalid_resource_path"
    assert missing["errorCode"] == "resource_not_found"


def test_skill_read_resource_enforces_file_safety_without_resource_metadata(
    tmp_path: Path,
) -> None:
    state_dir, config_dir, runtime_root_dir = _write_skill_runtime_fixture(
        tmp_path,
        resources=(
            {"path": "resources/too-large.md"},
            {"path": "resources/binary.bin"},
        ),
    )
    skill_root = runtime_root_dir / "skills" / "writing-clear-docs"
    (skill_root / "resources" / "too-large.md").write_text(
        "x" * (SKILL_RESOURCE_MAX_BYTES + 1),
        encoding="utf-8",
    )
    (skill_root / "resources" / "binary.bin").write_bytes(b"\xff\xfe\x00")
    provider = create_skill_snapshot_provider(
        state_dir=state_dir,
        config_dir=config_dir,
        runtime_root_dir=runtime_root_dir,
    )
    index = provider.load_runtime_index()

    too_large = read_skill_resource(index, "writing-clear-docs", "resources/too-large.md")
    not_text = read_skill_resource(index, "writing-clear-docs", "resources/binary.bin")

    assert too_large["errorCode"] == "resource_too_large"
    assert not_text["errorCode"] == "resource_not_text"


def test_skill_snapshot_provider_resolves_builtin_skill_locators_from_source_directory(
    tmp_path: Path,
) -> None:
    state_dir = tmp_path / "state"
    config_dir = tmp_path / "config"
    runtime_root_dir = tmp_path / "desktop-runtime"
    builtin_root = tmp_path / "builtin-skills" / "builtin-placeholder-skill"
    state_dir.mkdir(parents=True)
    (config_dir / "skill-registry").mkdir(parents=True)
    (builtin_root / "resources").mkdir(parents=True)
    (builtin_root / "SKILL.md").write_text(
        "# Builtin Placeholder\nUse this builtin skill.\n",
        encoding="utf-8",
    )
    (builtin_root / "resources" / "notes.md").write_text(
        "builtin resource body\n",
        encoding="utf-8",
    )
    (state_dir / SKILL_CAPABILITY_SNAPSHOT_FILE_NAME).write_text(
        json.dumps(
            {
                "version": 1,
                "registryRevision": 4,
                "snapshotRevision": 6,
                "generatedAt": "2026-04-24T00:00:00.000Z",
                "skills": [
                    {
                        "skillId": "builtin-placeholder-skill",
                        "displayName": "Builtin Placeholder",
                        "description": "Builtin placeholder skill.",
                        "tags": ["builtin"],
                        "entrySummary": "Use this builtin skill.",
                        "resourceSummaries": [{"path": "resources/notes.md"}],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    (config_dir / "skill-registry" / "registry.json").write_text(
        json.dumps(
            {
                "version": 1,
                "kind": "skill-registry",
                "registryRevision": 4,
                "snapshotRevision": 6,
                "skills": [
                    {
                        "skillId": "builtin-placeholder-skill",
                        "displayName": "Builtin Placeholder",
                        "description": "Builtin placeholder skill.",
                        "source": "builtin",
                        "sourceDirectory": str(builtin_root),
                        "enabled": True,
                        "trusted": True,
                        "managedDirectoryName": "builtin-placeholder-skill",
                        "entryPath": "SKILL.md",
                        "tags": ["builtin"],
                        "validation": {"status": "valid", "errors": [], "warnings": []},
                        "entrySummary": "Use this builtin skill.",
                        "resourceSummaries": [{"path": "resources/notes.md"}],
                        "importedAt": "2026-04-24T00:00:00.000Z",
                        "updatedAt": "2026-04-24T00:00:00.000Z",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    provider = create_skill_snapshot_provider(
        state_dir=state_dir,
        config_dir=config_dir,
        runtime_root_dir=runtime_root_dir,
    )

    index = provider.load_runtime_index()

    assert index.locators_by_id["builtin-placeholder-skill"].root_dir == builtin_root.resolve()
    assert (
        read_skill_resource(index, "builtin-placeholder-skill", "resources/notes.md")["content"]
        == "builtin resource body\n"
    )


def _load_skill_runtime_index(tmp_path: Path):
    state_dir, config_dir, runtime_root_dir = _write_skill_runtime_fixture(tmp_path)
    provider = create_skill_snapshot_provider(
        state_dir=state_dir,
        config_dir=config_dir,
        runtime_root_dir=runtime_root_dir,
    )
    return provider.load_runtime_index()


def _write_skill_runtime_fixture(
    tmp_path: Path,
    *,
    resources: tuple[dict[str, object], ...] | None = None,
) -> tuple[Path, Path, Path]:
    state_dir = tmp_path / "state"
    config_dir = tmp_path / "config"
    runtime_root_dir = tmp_path / "desktop-runtime"
    skill_root = runtime_root_dir / "skills" / "writing-clear-docs"
    resources_dir = skill_root / "resources"
    state_dir.mkdir(parents=True)
    (config_dir / "skill-registry").mkdir(parents=True)
    resources_dir.mkdir(parents=True)

    resource_summaries = resources or ({"path": "resources/checklist.md"},)
    (skill_root / "SKILL.md").write_text(
        "# Clear Docs\nUse this skill to write concise docs.\n",
        encoding="utf-8",
    )
    (resources_dir / "checklist.md").write_text(
        "- Prefer structure over verbosity.\n",
        encoding="utf-8",
    )
    (state_dir / SKILL_CAPABILITY_SNAPSHOT_FILE_NAME).write_text(
        json.dumps(_build_skill_snapshot_payload(resources=resource_summaries)),
        encoding="utf-8",
    )
    (config_dir / "skill-registry" / "registry.json").write_text(
        json.dumps(_build_skill_registry_payload(resources=resource_summaries)),
        encoding="utf-8",
    )
    return state_dir, config_dir, runtime_root_dir


def _build_skill_snapshot_payload(
    *,
    resources: tuple[dict[str, object], ...] | None = None,
) -> dict[str, object]:
    return {
        "version": 1,
        "registryRevision": 12,
        "snapshotRevision": 8,
        "generatedAt": "2026-04-24T00:00:00.000Z",
        "skills": [
            {
                "skillId": "writing-clear-docs",
                "displayName": "Clear Docs",
                "description": "Write clear developer documentation.",
                "version": "1.0.0",
                "tags": ["documentation", "writing"],
                "entrySummary": "Use when drafting concise technical documents.",
                "resourceSummaries": list(
                    resources or ({"path": "resources/checklist.md"},)
                ),
            }
        ],
    }


def _build_skill_registry_payload(
    *,
    resources: tuple[dict[str, object], ...] | None = None,
) -> dict[str, object]:
    return {
        "version": 1,
        "kind": "skill-registry",
        "registryRevision": 12,
        "snapshotRevision": 8,
        "skills": [
            {
                "skillId": "writing-clear-docs",
                "displayName": "Clear Docs",
                "description": "Write clear developer documentation.",
                "enabled": True,
                "trusted": True,
                "managedDirectoryName": "writing-clear-docs",
                "entryPath": "SKILL.md",
                "tags": ["documentation"],
                "validation": {"status": "valid", "errors": [], "warnings": []},
                "entrySummary": "Use when drafting concise technical documents.",
                "resourceSummaries": list(
                    resources or ({"path": "resources/checklist.md"},)
                ),
                "importedAt": "2026-04-24T00:00:00.000Z",
                "updatedAt": "2026-04-24T00:00:00.000Z",
            }
        ],
    }

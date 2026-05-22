from __future__ import annotations

import json
import shutil
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from app.copilot_runtime.skill_snapshot_provider import (
    SKILL_CAPABILITY_SNAPSHOT_FILE_NAME,
    SKILL_REGISTRY_DIR_NAME,
    SKILL_REGISTRY_DOCUMENT_FILE_NAME,
    SKILL_REGISTRY_MANAGED_SKILLS_DIR_NAME,
)


@dataclass(frozen=True, slots=True)
class BuiltinSkillSpec:
    skill_id: str
    display_name: str
    description: str
    entry_summary: str
    tags: tuple[str, ...] = ()


_DEFAULT_SKILLS: tuple[BuiltinSkillSpec, ...] = (
    BuiltinSkillSpec(
        skill_id="campus-info-qa",
        display_name="校园官方信息问答",
        description="翻阅本地同步的校园官方文档回答问题，并给出引用；不依赖校园检索工具。",
        entry_summary="用于校规、办事流程等官方信息问答；必要时先引导同步/抽取文档。",
        tags=("campus", "qa"),
    ),
)


def _load_json_object(path: Path) -> dict[str, object] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    return payload


def _ensure_int(value: object, *, default: int) -> int:
    return value if isinstance(value, int) else default


def _normalize_skills_list(value: object) -> list[dict[str, object]]:
    if not isinstance(value, list):
        return []
    out: list[dict[str, object]] = []
    for item in value:
        if isinstance(item, dict):
            out.append(item)
    return out


def ensure_builtin_skills(
    *,
    state_dir: Path,
    config_dir: Path,
    runtime_root_dir: Path,
) -> None:
    registry_dir = config_dir / SKILL_REGISTRY_DIR_NAME
    registry_dir.mkdir(parents=True, exist_ok=True)
    registry_file = registry_dir / SKILL_REGISTRY_DOCUMENT_FILE_NAME
    snapshot_file = state_dir / SKILL_CAPABILITY_SNAPSHOT_FILE_NAME
    managed_skills_dir = runtime_root_dir / SKILL_REGISTRY_MANAGED_SKILLS_DIR_NAME
    managed_skills_dir.mkdir(parents=True, exist_ok=True)

    template_root = Path(__file__).resolve().parent / "builtin_skills"
    now = datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")

    registry_payload = (
        _load_json_object(registry_file) if registry_file.exists() else None
    )
    if (
        registry_payload is None
        or registry_payload.get("version") != 1
        or registry_payload.get("kind") != "skill-registry"
    ):
        registry_payload = {
            "version": 1,
            "kind": "skill-registry",
            "registryRevision": 1,
            "snapshotRevision": 1,
            "skills": [],
        }
    registry_skills = _normalize_skills_list(registry_payload.get("skills"))
    registry_payload["skills"] = registry_skills
    registry_changed = False
    registry_by_id: dict[str, dict[str, object]] = {}
    for record in registry_skills:
        skill_id = record.get("skillId")
        if isinstance(skill_id, str) and skill_id.strip():
            registry_by_id[skill_id] = record
    for spec in _DEFAULT_SKILLS:
        record = registry_by_id.get(spec.skill_id)
        if record is None:
            record = {"skillId": spec.skill_id}
            registry_skills.append(record)
            registry_by_id[spec.skill_id] = record
            registry_changed = True
        desired = {
            "displayName": spec.display_name,
            "description": spec.description,
            "enabled": True,
            "trusted": True,
            "managedDirectoryName": spec.skill_id,
            "entryPath": "SKILL.md",
            "tags": list(spec.tags),
            "validation": {"status": "valid"},
            "entrySummary": spec.entry_summary,
            "resourceSummaries": [],
        }
        for key, value in desired.items():
            if record.get(key) != value:
                record[key] = value
                registry_changed = True
        if "importedAt" not in record:
            record["importedAt"] = now
            registry_changed = True
        record["updatedAt"] = now

    snapshot_payload = (
        _load_json_object(snapshot_file) if snapshot_file.exists() else None
    )
    if (
        snapshot_payload is None
        or snapshot_payload.get("version") != 1
        or not isinstance(snapshot_payload.get("skills"), list)
    ):
        snapshot_payload = {
            "version": 1,
            "registryRevision": 1,
            "snapshotRevision": 1,
            "generatedAt": now,
            "skills": [],
        }
    snapshot_skills = _normalize_skills_list(snapshot_payload.get("skills"))
    snapshot_payload["skills"] = snapshot_skills
    snapshot_changed = False
    snapshot_by_id: dict[str, dict[str, object]] = {}
    for record in snapshot_skills:
        skill_id = record.get("skillId")
        if isinstance(skill_id, str) and skill_id.strip():
            snapshot_by_id[skill_id] = record
    for spec in _DEFAULT_SKILLS:
        record = snapshot_by_id.get(spec.skill_id)
        if record is None:
            record = {"skillId": spec.skill_id}
            snapshot_skills.append(record)
            snapshot_by_id[spec.skill_id] = record
            snapshot_changed = True
        desired = {
            "displayName": spec.display_name,
            "description": spec.description,
            "tags": list(spec.tags),
            "entrySummary": spec.entry_summary,
            "resourceSummaries": [],
        }
        for key, value in desired.items():
            if record.get(key) != value:
                record[key] = value
                snapshot_changed = True
    snapshot_payload["generatedAt"] = now

    if registry_changed or snapshot_changed or not registry_file.exists():
        current_revision = max(
            _ensure_int(registry_payload.get("registryRevision"), default=0),
            _ensure_int(registry_payload.get("snapshotRevision"), default=0),
            _ensure_int(snapshot_payload.get("registryRevision"), default=0),
            _ensure_int(snapshot_payload.get("snapshotRevision"), default=0),
        )
        next_revision = current_revision + 1 if current_revision >= 1 else 1
        registry_payload["registryRevision"] = next_revision
        registry_payload["snapshotRevision"] = next_revision
        snapshot_payload["registryRevision"] = next_revision
        snapshot_payload["snapshotRevision"] = next_revision

    registry_file.write_text(
        json.dumps(registry_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    snapshot_file.write_text(
        json.dumps(snapshot_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    for spec in _DEFAULT_SKILLS:
        target_dir = managed_skills_dir / spec.skill_id
        source_dir = template_root / spec.skill_id
        if not source_dir.exists():
            continue
        target_dir.mkdir(parents=True, exist_ok=True)
        target_entry = target_dir / "SKILL.md"
        source_entry = source_dir / "SKILL.md"
        if source_entry.exists():
            shutil.copy2(source_entry, target_entry)


__all__ = ["ensure_builtin_skills", "BuiltinSkillSpec"]

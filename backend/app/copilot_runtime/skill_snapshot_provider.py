"""Skill capability snapshot contracts, runtime index loading, and safe readers."""

from __future__ import annotations

import json
import posixpath
import re
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path, PureWindowsPath
from typing import Any, Literal, TypeAlias, cast

from pydantic import Field, field_validator, model_validator

from app.copilot_runtime._tool_registry.constants import (
    SKILL_ACTIVATE_TOOL_ID,
    SKILL_READ_RESOURCE_TOOL_ID,
)
from app.copilot_runtime.pydantic_contracts import RuntimeContractModel

SKILL_SNAPSHOT_VERSION = 1
SKILL_CAPABILITY_SNAPSHOT_FILE_NAME = "skill-capability-snapshot.json"
SKILL_CAPABILITY_BRIDGE_STATE_FILE_NAME = "capability-bridge-state.json"
SKILL_CAPABILITY_SNAPSHOT_BRIDGE_TOOL_ID = "__runtime.skill.catalog__"
SKILL_CAPABILITY_SNAPSHOT_BRIDGE_KEY = "snapshot"
SKILL_REGISTRY_DIR_NAME = "skill-registry"
SKILL_REGISTRY_DOCUMENT_FILE_NAME = "registry.json"
SKILL_REGISTRY_MANAGED_SKILLS_DIR_NAME = "skills"

SKILL_ENTRY_MAX_BYTES = 256 * 1024
SKILL_RESOURCE_MAX_BYTES = 256 * 1024

SKILL_ACTIVATE_FUNCTION_NAME = "skill_activate"
SKILL_READ_RESOURCE_FUNCTION_NAME = "skill_read_resource"

_SKILL_INDEX_MAX_DESCRIPTION_LENGTH = 240
_SKILL_INDEX_MAX_ENTRY_SUMMARY_LENGTH = 240
_SKILL_SNAPSHOT_FORBIDDEN_FIELD_KEYS = frozenset(
    {
        "absolutepath",
        "apikey",
        "authorization",
        "command",
        "env",
        "headers",
        "localpath",
        "localtoken",
        "manageddirectoryname",
        "password",
        "passwords",
        "secret",
        "secrets",
        "sourcepath",
        "token",
        "tokens",
    }
)


class SkillSnapshotResourceSummary(RuntimeContractModel):
    path: str
    description: str | None = None

    @field_validator("path")
    @classmethod
    def _validate_path(cls, value: str) -> str:
        normalized = normalize_skill_resource_path(value)
        if normalized is None:
            raise ValueError("Skill resource path must be a safe relative path.")
        return normalized

    def to_public_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"path": self.path}
        if self.description is not None:
            payload["description"] = self.description
        return payload


class SkillSnapshotSkillSummary(RuntimeContractModel):
    skill_id: str = Field(alias="skillId")
    display_name: str = Field(alias="displayName")
    description: str
    version: str | None = None
    tags: list[str] = Field(default_factory=list)
    entry_summary: str | None = Field(default=None, alias="entrySummary")
    resource_summaries: list[SkillSnapshotResourceSummary] = Field(
        default_factory=list,
        alias="resourceSummaries",
    )

    @field_validator("skill_id", "display_name", "description")
    @classmethod
    def _validate_required_text(cls, value: str) -> str:
        normalized = value.strip()
        if normalized == "":
            raise ValueError("Skill summary text fields must be non-empty.")
        return normalized

    @field_validator("tags")
    @classmethod
    def _normalize_tags(cls, value: list[str]) -> list[str]:
        normalized: list[str] = []
        seen: set[str] = set()
        for tag in value:
            candidate = tag.strip()
            if candidate == "" or candidate in seen:
                continue
            seen.add(candidate)
            normalized.append(candidate)
        return normalized

    @model_validator(mode="after")
    def _validate_unique_resource_paths(self) -> "SkillSnapshotSkillSummary":
        paths = [resource.path for resource in self.resource_summaries]
        if len(paths) != len(set(paths)):
            raise ValueError("Skill resource paths must be unique within a skill.")
        return self

    def to_index_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "skillId": self.skill_id,
            "displayName": self.display_name,
            "description": self.description,
            "tags": list(self.tags),
            "entrySummary": self.entry_summary,
            "resourceCount": len(self.resource_summaries),
        }
        if self.version is not None:
            payload["version"] = self.version
        return payload


class SkillCapabilitySnapshot(RuntimeContractModel):
    version: Literal[1] = SKILL_SNAPSHOT_VERSION
    registry_revision: int = Field(alias="registryRevision")
    snapshot_revision: int = Field(alias="snapshotRevision")
    generated_at: str = Field(alias="generatedAt")
    skills: list[SkillSnapshotSkillSummary] = Field(default_factory=list)

    @field_validator("registry_revision", "snapshot_revision")
    @classmethod
    def _validate_revision(cls, value: int) -> int:
        if value < 0:
            raise ValueError("Skill snapshot revisions must be non-negative.")
        return value

    @model_validator(mode="after")
    def _validate_unique_skill_ids(self) -> "SkillCapabilitySnapshot":
        skill_ids = [skill.skill_id for skill in self.skills]
        if len(skill_ids) != len(set(skill_ids)):
            raise ValueError("Skill ids must be unique within a skill snapshot.")
        return self


class _SkillValidationSummary(RuntimeContractModel):
    status: Literal["valid", "invalid"]


class _SkillRegistryResourceSummary(RuntimeContractModel):
    path: str
    description: str | None = None

    @field_validator("path")
    @classmethod
    def _validate_path(cls, value: str) -> str:
        normalized = normalize_skill_resource_path(value)
        if normalized is None:
            raise ValueError(
                "Skill registry resource path must be a safe relative path."
            )
        return normalized


class _SkillRegistryRecord(RuntimeContractModel):
    skill_id: str = Field(alias="skillId")
    enabled: bool
    trusted: Literal[True]
    source: Literal["builtin", "imported"] = "imported"
    source_directory: str | None = Field(default=None, alias="sourceDirectory")
    managed_directory_name: str = Field(alias="managedDirectoryName")
    entry_path: str = Field(alias="entryPath")
    validation: _SkillValidationSummary
    resource_summaries: list[_SkillRegistryResourceSummary] = Field(
        default_factory=list,
        alias="resourceSummaries",
    )

    @field_validator("managed_directory_name", "entry_path")
    @classmethod
    def _validate_relative_path(cls, value: str) -> str:
        normalized = normalize_skill_resource_path(value)
        if normalized is None:
            raise ValueError("Skill registry paths must be safe relative paths.")
        return normalized


class _SkillRegistryDocument(RuntimeContractModel):
    version: int = 1
    kind: str = "skill-registry"
    registry_revision: int = Field(alias="registryRevision")
    snapshot_revision: int = Field(alias="snapshotRevision")
    skills: list[_SkillRegistryRecord] = Field(default_factory=list)

    @model_validator(mode="after")
    def _validate_document_identity(self) -> "_SkillRegistryDocument":
        if self.version != 1 or self.kind != "skill-registry":
            raise ValueError("Unsupported skill registry document.")
        return self


SkillSnapshotSource: TypeAlias = Literal[
    "snapshot-file",
    "capability-bridge-state",
    "cache",
    "missing",
]


@dataclass(frozen=True, slots=True)
class SkillSnapshotProviderLoadResult:
    snapshot: SkillCapabilitySnapshot | None
    source: SkillSnapshotSource


@dataclass(frozen=True, slots=True)
class SkillRuntimeLocator:
    skill_id: str
    root_dir: Path
    entry_path: str
    resource_paths: frozenset[str]


@dataclass(frozen=True, slots=True)
class SkillRuntimeIndex:
    snapshot_revision: int | None
    registry_revision: int | None
    generated_at: str | None
    source: SkillSnapshotSource
    skills_by_id: Mapping[str, SkillSnapshotSkillSummary]
    locators_by_id: Mapping[str, SkillRuntimeLocator]

    @classmethod
    def empty(cls, *, source: SkillSnapshotSource = "missing") -> "SkillRuntimeIndex":
        return cls(
            snapshot_revision=None,
            registry_revision=None,
            generated_at=None,
            source=source,
            skills_by_id={},
            locators_by_id={},
        )

    @property
    def has_available_skills(self) -> bool:
        return len(self.skills_by_id) > 0

    def get_skill(self, skill_id: str) -> SkillSnapshotSkillSummary | None:
        return self.skills_by_id.get(skill_id.strip())

    def get_locator(self, skill_id: str) -> SkillRuntimeLocator | None:
        return self.locators_by_id.get(skill_id.strip())


@dataclass(frozen=True, slots=True)
class SkillRuntimeResolvedSkill:
    skill: SkillSnapshotSkillSummary
    locator: SkillRuntimeLocator


def activate_skill(
    index: SkillRuntimeIndex,
    skill_id_or_name: Any,
) -> dict[str, Any]:
    resolved = _resolve_skill_reference(index, skill_id_or_name)
    if isinstance(resolved, dict):
        return resolved

    entry_content, error = _read_text_file_within_skill_root(
        locator=resolved.locator,
        relative_path=resolved.locator.entry_path,
        max_bytes=SKILL_ENTRY_MAX_BYTES,
        kind="entry",
    )
    if error is not None:
        return _skill_error(
            error[0],
            error[1],
            skill_id=resolved.skill.skill_id,
            snapshot_revision=index.snapshot_revision,
        )

    return {
        "ok": True,
        "skillId": resolved.skill.skill_id,
        "displayName": resolved.skill.display_name,
        "entryContent": entry_content,
        "resources": [
            resource.to_public_dict() for resource in resolved.skill.resource_summaries
        ],
        "snapshotRevision": index.snapshot_revision,
    }


async def execute_skill_activate_tool(
    arguments: Mapping[str, Any] | None,
) -> dict[str, Any]:
    index = _get_current_skill_runtime_index()
    skill_id_or_name = dict(arguments or {}).get("skill_id")
    if skill_id_or_name is None:
        skill_id_or_name = dict(arguments or {}).get("skillId")
    if skill_id_or_name is None:
        skill_id_or_name = dict(arguments or {}).get("name")
    resolved = _resolve_skill_reference(index, skill_id_or_name)
    if isinstance(resolved, dict):
        return resolved

    entry_content, error = _read_text_file_within_skill_root(
        locator=resolved.locator,
        relative_path=resolved.locator.entry_path,
        max_bytes=SKILL_ENTRY_MAX_BYTES,
        kind="entry",
    )
    if error is not None:
        return _skill_error(
            error[0],
            error[1],
            skill_id=resolved.skill.skill_id,
            snapshot_revision=index.snapshot_revision,
        )

    payload: dict[str, Any] = {
        "ok": True,
        "skillId": resolved.skill.skill_id,
        "displayName": resolved.skill.display_name,
        "entryContent": entry_content,
        "resources": [
            resource.to_public_dict() for resource in resolved.skill.resource_summaries
        ],
        "snapshotRevision": index.snapshot_revision,
    }
    return payload


async def execute_skill_read_resource_tool(
    arguments: Mapping[str, Any] | None,
) -> dict[str, Any]:
    payload = dict(arguments or {})
    skill_id_or_name = payload.get("skill_id")
    if skill_id_or_name is None:
        skill_id_or_name = payload.get("skillId")
    if skill_id_or_name is None:
        skill_id_or_name = payload.get("name")
    return read_skill_resource(
        _get_current_skill_runtime_index(),
        skill_id_or_name,
        payload.get("path"),
    )


def read_skill_resource(
    index: SkillRuntimeIndex,
    skill_id_or_name: Any,
    path: Any,
) -> dict[str, Any]:
    resolved = _resolve_skill_reference(
        index,
        skill_id_or_name,
        resource_path=path if isinstance(path, str) else None,
    )
    if isinstance(resolved, dict):
        return resolved

    normalized_path = normalize_skill_resource_path(path)
    if normalized_path is None:
        return _skill_error(
            "invalid_resource_path",
            "Skill resource path must be relative and must not traverse outside the skill directory.",
            skill_id=resolved.skill.skill_id,
            resource_path=path if isinstance(path, str) else None,
            snapshot_revision=index.snapshot_revision,
        )

    resource_paths = {resource.path for resource in resolved.skill.resource_summaries}
    if (
        normalized_path not in resource_paths
        or normalized_path not in resolved.locator.resource_paths
    ):
        return _skill_error(
            "resource_not_found",
            "Skill resource was not found in the enabled skill snapshot resource index.",
            skill_id=resolved.skill.skill_id,
            resource_path=normalized_path,
            snapshot_revision=index.snapshot_revision,
        )

    content, error = _read_text_file_within_skill_root(
        locator=resolved.locator,
        relative_path=normalized_path,
        max_bytes=SKILL_RESOURCE_MAX_BYTES,
        kind="resource",
    )
    if error is not None:
        return _skill_error(
            error[0],
            error[1],
            skill_id=resolved.skill.skill_id,
            resource_path=normalized_path,
            snapshot_revision=index.snapshot_revision,
        )

    return {
        "ok": True,
        "skillId": resolved.skill.skill_id,
        "displayName": resolved.skill.display_name,
        "path": normalized_path,
        "content": content,
        "snapshotRevision": index.snapshot_revision,
    }


class SkillSnapshotProvider:
    def __init__(
        self,
        *,
        snapshot_file: Path | None,
        capability_bridge_state_file: Path | None = None,
        registry_file: Path | None = None,
        managed_skills_dir: Path | None = None,
    ) -> None:
        self._snapshot_file = snapshot_file
        self._capability_bridge_state_file = capability_bridge_state_file
        self._registry_file = registry_file
        self._managed_skills_dir = managed_skills_dir
        self._cached_snapshot: SkillCapabilitySnapshot | None = None

    def load_snapshot(self) -> SkillCapabilitySnapshot | None:
        return self.load_snapshot_result().snapshot

    def load_snapshot_result(self) -> SkillSnapshotProviderLoadResult:
        snapshot = self._load_from_snapshot_file()
        if snapshot is not None:
            self._cached_snapshot = snapshot
            return SkillSnapshotProviderLoadResult(
                snapshot=snapshot,
                source=cast(SkillSnapshotSource, "snapshot-file"),
            )

        snapshot = self._load_from_capability_bridge_state()
        if snapshot is not None:
            self._cached_snapshot = snapshot
            return SkillSnapshotProviderLoadResult(
                snapshot=snapshot,
                source=cast(SkillSnapshotSource, "capability-bridge-state"),
            )

        if self._cached_snapshot is not None:
            return SkillSnapshotProviderLoadResult(
                snapshot=self._cached_snapshot,
                source=cast(SkillSnapshotSource, "cache"),
            )

        return SkillSnapshotProviderLoadResult(
            snapshot=None,
            source=cast(SkillSnapshotSource, "missing"),
        )

    def load_runtime_index(self) -> SkillRuntimeIndex:
        result = self.load_snapshot_result()
        snapshot = result.snapshot
        if snapshot is None or len(snapshot.skills) == 0:
            return SkillRuntimeIndex.empty(source=result.source)

        locators = self._load_runtime_locators(snapshot)
        skills_by_id = {
            skill.skill_id: skill
            for skill in snapshot.skills
            if skill.skill_id in locators
        }
        if len(skills_by_id) == 0:
            return SkillRuntimeIndex.empty(source=result.source)

        return SkillRuntimeIndex(
            snapshot_revision=snapshot.snapshot_revision,
            registry_revision=snapshot.registry_revision,
            generated_at=snapshot.generated_at,
            source=result.source,
            skills_by_id=skills_by_id,
            locators_by_id={
                skill_id: locator
                for skill_id, locator in locators.items()
                if skill_id in skills_by_id
            },
        )

    def _load_from_snapshot_file(self) -> SkillCapabilitySnapshot | None:
        if self._snapshot_file is None:
            return None
        payload = _read_json_file(self._snapshot_file)
        if payload is None:
            return None
        return _validate_snapshot_payload(payload)

    def _load_from_capability_bridge_state(self) -> SkillCapabilitySnapshot | None:
        if self._capability_bridge_state_file is None:
            return None
        payload = _read_json_file(self._capability_bridge_state_file)
        if payload is None:
            return None
        extracted = _extract_snapshot_from_capability_bridge_state(payload)
        if extracted is None:
            return None
        return _validate_snapshot_payload(extracted)

    def _load_runtime_locators(
        self,
        snapshot: SkillCapabilitySnapshot,
    ) -> dict[str, SkillRuntimeLocator]:
        if self._registry_file is None or self._managed_skills_dir is None:
            return {}
        registry_payload = _read_json_file(self._registry_file)
        if registry_payload is None:
            return {}
        try:
            registry = _SkillRegistryDocument.model_validate(registry_payload)
        except Exception:
            return {}

        managed_root = self._managed_skills_dir.resolve(strict=False)
        snapshot_skill_ids = {skill.skill_id for skill in snapshot.skills}
        locators: dict[str, SkillRuntimeLocator] = {}
        for record in registry.skills:
            if record.skill_id not in snapshot_skill_ids:
                continue
            if (
                not record.enabled
                or record.trusted is not True
                or record.validation.status != "valid"
            ):
                continue
            if record.source == "builtin":
                if record.source_directory is None:
                    continue
                root_dir = Path(record.source_directory).resolve(strict=False)
            else:
                root_dir = (managed_root / record.managed_directory_name).resolve(
                    strict=False
                )
                if not _is_within_directory(managed_root, root_dir):
                    continue
            resource_paths = frozenset(
                resource.path for resource in record.resource_summaries
            )
            locators[record.skill_id] = SkillRuntimeLocator(
                skill_id=record.skill_id,
                root_dir=root_dir,
                entry_path=record.entry_path,
                resource_paths=resource_paths,
            )
        return locators


def create_skill_snapshot_provider(
    *,
    state_dir: Path | None,
    config_dir: Path | None = None,
    runtime_root_dir: Path | None = None,
) -> SkillSnapshotProvider:
    snapshot_file = (
        None if state_dir is None else state_dir / SKILL_CAPABILITY_SNAPSHOT_FILE_NAME
    )
    bridge_state_file = (
        None
        if state_dir is None
        else state_dir / SKILL_CAPABILITY_BRIDGE_STATE_FILE_NAME
    )
    registry_file = (
        None
        if config_dir is None
        else config_dir / SKILL_REGISTRY_DIR_NAME / SKILL_REGISTRY_DOCUMENT_FILE_NAME
    )
    managed_skills_dir = (
        None
        if runtime_root_dir is None
        else runtime_root_dir / SKILL_REGISTRY_MANAGED_SKILLS_DIR_NAME
    )
    return SkillSnapshotProvider(
        snapshot_file=snapshot_file,
        capability_bridge_state_file=bridge_state_file,
        registry_file=registry_file,
        managed_skills_dir=managed_skills_dir,
    )


def validate_skill_capability_snapshot(payload: Any) -> SkillCapabilitySnapshot:
    return SkillCapabilitySnapshot.model_validate(payload)


def collect_skill_snapshot_forbidden_paths(
    payload: Any,
    *,
    _path: str = "",
) -> list[str]:
    if isinstance(payload, RuntimeContractModel):
        payload = payload.model_dump(by_alias=True, exclude_none=False)

    if isinstance(payload, list):
        violations: list[str] = []
        for index, item in enumerate(payload):
            next_path = f"{_path}[{index}]" if _path else f"[{index}]"
            violations.extend(
                collect_skill_snapshot_forbidden_paths(item, _path=next_path)
            )
        return violations

    if not isinstance(payload, Mapping):
        return []

    violations: list[str] = []
    for key, value in payload.items():
        next_path = f"{_path}.{key}" if _path else str(key)
        if _normalize_forbidden_key(key) in _SKILL_SNAPSHOT_FORBIDDEN_FIELD_KEYS:
            violations.append(next_path)
            continue
        violations.extend(
            collect_skill_snapshot_forbidden_paths(value, _path=next_path)
        )
    return violations


def build_skill_index_system_prompt(index: SkillRuntimeIndex) -> str | None:
    if not index.has_available_skills:
        return "\n".join(
            [
                "## Available Skills",
                "",
                "No enabled Skills are currently available from the Skill Registry snapshot. Do not call skill_activate or skill_read_resource unless a later context lists a matching skill.",
            ]
        )

    lines = [
        "## Available Skills",
        "",
        "The following enabled Skills are available for this run. Treat each Skill description and Use when hint as activation criteria. If the current user task is related to a listed Skill and the skill_activate tool is available, you MUST call skill_activate(skill_id) with the skill id or display name to read its SKILL.md entry before producing the substantive answer. Do not answer a matching task from this lightweight list alone. After reading SKILL.md, if the entry references resources that are relevant to the task, call skill_read_resource(skill_id, path) with the skill id or display name and the listed relative resource path before relying on that resource. skill_read_resource does not require a prior activation call, but the path must be listed in the enabled skill snapshot.",
        "You MUST NOT invent Skill ids, display names, or resource paths. Only use the exact ids or display names shown in the list below. If none apply, do not call skill_activate/skill_read_resource.",
        "",
    ]
    for skill in sorted(index.skills_by_id.values(), key=lambda item: item.skill_id):
        summary_parts = [
            f"- {skill.skill_id}: {_compact_text(skill.description, _SKILL_INDEX_MAX_DESCRIPTION_LENGTH)}"
        ]
        if skill.entry_summary is not None and skill.entry_summary.strip() != "":
            summary_parts.append(
                f"Use when: {_compact_text(skill.entry_summary, _SKILL_INDEX_MAX_ENTRY_SUMMARY_LENGTH)}"
            )
        if len(skill.tags) > 0:
            summary_parts.append(f"Tags: {', '.join(skill.tags[:8])}")
        if len(skill.resource_summaries) > 0:
            summary_parts.append(f"Resources indexed: {len(skill.resource_summaries)}")
        lines.append(" ".join(summary_parts))
    return "\n".join(lines).strip()


def normalize_skill_resource_path(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().replace("\\", "/")
    if normalized == "":
        return None
    if normalized.startswith("/") or normalized.startswith("//"):
        return None
    if PureWindowsPath(value).is_absolute() or re.match(r"^[a-zA-Z]:[\\/]", value):
        return None
    if posixpath.isabs(normalized):
        return None
    parts = normalized.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        return None
    compacted = posixpath.normpath(normalized)
    if compacted == "." or compacted.startswith("../") or compacted == "..":
        return None
    return compacted


def _validate_snapshot_payload(payload: Any) -> SkillCapabilitySnapshot | None:
    if payload is None:
        return None
    if collect_skill_snapshot_forbidden_paths(payload):
        return None
    try:
        return validate_skill_capability_snapshot(payload)
    except Exception:
        return None


def _read_json_file(path: Path) -> Any | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except (OSError, json.JSONDecodeError):
        return None


def _extract_snapshot_from_capability_bridge_state(payload: Any) -> Any | None:
    if not isinstance(payload, Mapping):
        return None
    values = payload.get("values")
    if not isinstance(values, Mapping):
        return None
    tool_values = values.get("tool")
    if not isinstance(tool_values, Mapping):
        return None
    tool_bucket = tool_values.get(SKILL_CAPABILITY_SNAPSHOT_BRIDGE_TOOL_ID)
    if not isinstance(tool_bucket, Mapping):
        return None
    return tool_bucket.get(SKILL_CAPABILITY_SNAPSHOT_BRIDGE_KEY)


def _read_text_file_within_skill_root(
    *,
    locator: SkillRuntimeLocator,
    relative_path: str,
    max_bytes: int,
    kind: Literal["entry", "resource"],
) -> tuple[str | None, tuple[str, str] | None]:
    normalized_path = normalize_skill_resource_path(relative_path)
    if normalized_path is None:
        return None, (
            f"invalid_{kind}_path",
            "Skill file path must be relative and must not traverse outside the skill directory.",
        )
    candidate = locator.root_dir / normalized_path
    target = candidate.resolve(strict=False)
    if not _is_within_directory(locator.root_dir, target):
        return None, (
            f"invalid_{kind}_path",
            "Skill file path must stay inside the managed skill directory.",
        )
    try:
        stat = candidate.lstat()
    except OSError:
        return None, (
            f"{kind}_not_readable",
            "Skill file is not readable from the managed skill directory.",
        )
    if candidate.is_symlink() or not candidate.is_file():
        return None, (
            f"{kind}_not_readable",
            "Skill file must be a regular non-symlink file.",
        )
    if stat.st_size > max_bytes:
        return None, (
            "resource_too_large" if kind == "resource" else "entry_too_large",
            "Skill file exceeds the runtime text read size limit.",
        )
    try:
        return candidate.read_text(encoding="utf-8"), None
    except UnicodeDecodeError:
        return None, (
            "resource_not_text" if kind == "resource" else "entry_not_text",
            "Skill file must be valid UTF-8 text.",
        )
    except OSError:
        return None, (
            f"{kind}_not_readable",
            "Skill file is not readable from the managed skill directory.",
        )


def _is_within_directory(root_directory: Path, target_path: Path) -> bool:
    try:
        target_path.resolve(strict=False).relative_to(
            root_directory.resolve(strict=False)
        )
        return True
    except ValueError:
        return False


def _skill_error(
    error_code: str,
    message: str,
    *,
    skill_id: str | None = None,
    resource_path: str | None = None,
    snapshot_revision: int | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "ok": False,
        "errorCode": error_code,
        "message": message,
    }
    if skill_id is not None:
        payload["skillId"] = skill_id
    if resource_path is not None:
        payload["path"] = resource_path
    if snapshot_revision is not None:
        payload["snapshotRevision"] = snapshot_revision
    return payload


def _get_current_skill_runtime_index() -> SkillRuntimeIndex:
    from app.tooling.runtime_adapter.copilot_runtime import (
        get_runtime_context_metadata_value,
    )

    index = get_runtime_context_metadata_value(("skillRuntime", "index"))
    if isinstance(index, SkillRuntimeIndex):
        return index
    return SkillRuntimeIndex.empty(source="missing")


def _compact_text(value: str, max_length: int) -> str:
    compacted = " ".join(value.split())
    if len(compacted) <= max_length:
        return compacted
    return f"{compacted[: max_length - 1].rstrip()}…"


def _normalize_forbidden_key(value: Any) -> str:
    return "".join(character for character in str(value).lower() if character.isalnum())


def _resolve_skill_reference(
    index: SkillRuntimeIndex,
    skill_id_or_name: Any,
    *,
    resource_path: str | None = None,
) -> SkillRuntimeResolvedSkill | dict[str, Any]:
    normalized_reference = _normalize_skill_reference(skill_id_or_name)
    if normalized_reference == "":
        return _skill_error(
            "invalid_skill_reference",
            "Skill id or display name must be a non-empty string.",
            skill_id=normalized_reference,
            resource_path=resource_path,
            snapshot_revision=index.snapshot_revision,
        )
    if not index.has_available_skills:
        return _skill_error(
            "skill_index_unavailable",
            "No enabled skills are available in the current skill snapshot.",
            skill_id=normalized_reference,
            resource_path=resource_path,
            snapshot_revision=index.snapshot_revision,
        )

    exact_skill = index.get_skill(normalized_reference)
    exact_locator = index.get_locator(normalized_reference)
    if exact_skill is not None and exact_locator is not None:
        return SkillRuntimeResolvedSkill(skill=exact_skill, locator=exact_locator)

    folded_reference = normalized_reference.casefold()
    matches: list[SkillRuntimeResolvedSkill] = []
    for skill in index.skills_by_id.values():
        locator = index.get_locator(skill.skill_id)
        if locator is None:
            continue
        if skill.skill_id.casefold() == folded_reference:
            matches.append(SkillRuntimeResolvedSkill(skill=skill, locator=locator))
            continue
        if skill.display_name.casefold() == folded_reference:
            matches.append(SkillRuntimeResolvedSkill(skill=skill, locator=locator))

    unique_matches: dict[str, SkillRuntimeResolvedSkill] = {
        match.skill.skill_id: match for match in matches
    }
    if len(unique_matches) == 1:
        return next(iter(unique_matches.values()))
    if len(unique_matches) > 1:
        return _skill_error(
            "skill_reference_ambiguous",
            "Skill reference matched more than one enabled skill. Use the stable skill id instead.",
            skill_id=normalized_reference,
            resource_path=resource_path,
            snapshot_revision=index.snapshot_revision,
        )
    return _skill_error(
        "skill_not_found",
        "Skill was not found in the enabled skill snapshot.",
        skill_id=normalized_reference,
        resource_path=resource_path,
        snapshot_revision=index.snapshot_revision,
    )


def _normalize_skill_reference(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


__all__ = [
    "SKILL_ACTIVATE_FUNCTION_NAME",
    "SKILL_ACTIVATE_TOOL_ID",
    "SKILL_CAPABILITY_BRIDGE_STATE_FILE_NAME",
    "SKILL_CAPABILITY_SNAPSHOT_BRIDGE_KEY",
    "SKILL_CAPABILITY_SNAPSHOT_BRIDGE_TOOL_ID",
    "SKILL_CAPABILITY_SNAPSHOT_FILE_NAME",
    "SKILL_ENTRY_MAX_BYTES",
    "SKILL_READ_RESOURCE_FUNCTION_NAME",
    "SKILL_READ_RESOURCE_TOOL_ID",
    "SKILL_REGISTRY_DOCUMENT_FILE_NAME",
    "SKILL_REGISTRY_DIR_NAME",
    "SKILL_REGISTRY_MANAGED_SKILLS_DIR_NAME",
    "SKILL_RESOURCE_MAX_BYTES",
    "SKILL_SNAPSHOT_VERSION",
    "SkillCapabilitySnapshot",
    "SkillRuntimeIndex",
    "SkillRuntimeLocator",
    "SkillSnapshotProvider",
    "SkillSnapshotProviderLoadResult",
    "SkillSnapshotResourceSummary",
    "SkillSnapshotSkillSummary",
    "SkillSnapshotSource",
    "activate_skill",
    "build_skill_index_system_prompt",
    "collect_skill_snapshot_forbidden_paths",
    "create_skill_snapshot_provider",
    "execute_skill_activate_tool",
    "execute_skill_read_resource_tool",
    "normalize_skill_resource_path",
    "read_skill_resource",
    "validate_skill_capability_snapshot",
]

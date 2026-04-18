"""TIS provider 层结果对象导出。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.integrations.sustech.teaching_information_system.api.dto import (
    TISCreditGPAQueryResult,
    TISCreditGPASummary,
    TISCreditGPATermRecord,
    TISCreditGPAYearRecord,
    TISGradeQueryResult,
    TISGradeRecord,
    TISProbeResult,
    TISSelectedCourseRecord,
    TISSelectedCourseSemester,
    TISSelectedCourseSummary,
    TISSelectedCoursesQueryResult,
)
from app.integrations.sustech.teaching_information_system.data import TISSyncStats


@dataclass(slots=True)
class TISPersistenceResourceResult:
    name: str
    stats: TISSyncStats

    def to_dict(self) -> dict[str, Any]:
        return {"name": self.name, "stats": self.stats.to_dict()}


@dataclass(slots=True)
class TISPersistenceGroupResult:
    name: str
    resources: dict[str, TISPersistenceResourceResult] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "resources": {
                key: value.to_dict() for key, value in self.resources.items()
            },
        }


@dataclass(slots=True)
class TISPersistenceSummary:
    enabled: bool = False
    owner_key: str | None = None
    db_path: str | None = None
    resources: dict[str, TISPersistenceResourceResult | TISPersistenceGroupResult] = (
        field(default_factory=dict)
    )
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        serialized_resources: dict[str, Any] = {}
        for key, value in self.resources.items():
            serialized_resources[key] = value.to_dict()
        return {
            "enabled": self.enabled,
            "owner_key": self.owner_key,
            "db_path": self.db_path,
            "resources": serialized_resources,
            "metadata": dict(self.metadata),
        }


def attach_persistence_summary(
    result: Any, summary: TISPersistenceSummary | None
) -> Any:
    setattr(result, "persistence", None if summary is None else summary.to_dict())
    return result


def resource_result(name: str, stats: TISSyncStats) -> TISPersistenceResourceResult:
    return TISPersistenceResourceResult(name=name, stats=stats)


def resource_group_result(
    name: str, stats_by_resource: dict[str, TISSyncStats]
) -> TISPersistenceGroupResult:
    return TISPersistenceGroupResult(
        name=name,
        resources={
            key: TISPersistenceResourceResult(name=key, stats=value)
            for key, value in stats_by_resource.items()
        },
    )


__all__ = [
    "TISPersistenceGroupResult",
    "TISPersistenceResourceResult",
    "TISPersistenceSummary",
    "TISCreditGPAQueryResult",
    "TISCreditGPASummary",
    "TISCreditGPATermRecord",
    "TISCreditGPAYearRecord",
    "TISGradeQueryResult",
    "TISGradeRecord",
    "TISProbeResult",
    "TISSelectedCourseRecord",
    "TISSelectedCourseSemester",
    "TISSelectedCourseSummary",
    "TISSelectedCoursesQueryResult",
    "attach_persistence_summary",
    "resource_group_result",
    "resource_result",
]

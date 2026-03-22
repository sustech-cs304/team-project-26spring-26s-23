"""TIS data 层共享结果类型。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class TISSyncStats:
    inserted: int = 0
    updated: int = 0
    deleted: int = 0
    skipped: int = 0
    unchanged: int = 0

    def to_dict(self) -> dict[str, int]:
        return {
            "inserted": int(self.inserted),
            "updated": int(self.updated),
            "deleted": int(self.deleted),
            "skipped": int(self.skipped),
            "unchanged": int(self.unchanged),
        }


def empty_sync_stats() -> TISSyncStats:
    return TISSyncStats()


@dataclass(slots=True)
class TISPersistenceResult:
    resource: str
    stats: TISSyncStats = field(default_factory=TISSyncStats)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "resource": self.resource,
            "stats": self.stats.to_dict(),
            "metadata": dict(self.metadata),
        }


__all__ = ["TISPersistenceResult", "TISSyncStats", "empty_sync_stats"]


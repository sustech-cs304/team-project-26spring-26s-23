"""Blackboard 数据层共享结果类型。"""

from __future__ import annotations

SyncStats = dict[str, int]


def empty_sync_stats() -> SyncStats:
    return {"inserted": 0, "updated": 0, "deleted": 0}

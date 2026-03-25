from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Literal


class OfficialDocCategory(str, Enum):
    GOVERNANCE = "governance"
    ADMINISTRATION = "administration"
    STUDENT_AFFAIRS = "student_affairs"
    SAFETY = "safety"
    FINANCIAL_AID = "financial_aid"
    OTHER = "other"


class SourceKind(str, Enum):
    PDF = "pdf"
    HTML_LISTING = "html_listing"


class UpdateCadence(str, Enum):
    MANUAL = "manual"
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"


@dataclass(frozen=True)
class UpdatePolicy:
    cadence: UpdateCadence
    supports_incremental: bool


@dataclass(frozen=True)
class OfficialDocSeed:
    source_id: str
    title: str
    category: OfficialDocCategory
    kind: SourceKind
    url: str
    update_policy: UpdatePolicy
    parser: Literal["osa_wjxzs", "sustech_rules_and_regulations"] | None = None


@dataclass(frozen=True)
class DiscoveredOfficialDoc:
    source_id: str
    title: str
    category: OfficialDocCategory
    url: str
    updated_at: str | None


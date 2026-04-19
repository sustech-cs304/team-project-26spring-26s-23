"""Blackboard 领域共享时间解析工具。"""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta, timezone, tzinfo
from zoneinfo import ZoneInfo

_DATETIME_LABEL_PREFIX = re.compile(
    r"^\s*(?:Due|Posted on|截止(?:日期|时间)?|发布日期|发布于)\s*[:：]?\s*",
    re.IGNORECASE,
)

_DATETIME_FORMATS: tuple[str, ...] = (
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d %H:%M",
    "%Y-%m-%d",
    "%m-%d-%Y %H:%M:%S",
    "%m-%d-%Y %H:%M",
    "%m-%d-%Y",
    "%A, %B %d, %Y %I:%M:%S %p",
    "%A, %B %d, %Y %I:%M %p",
    "%B %d, %Y %I:%M:%S %p",
    "%B %d, %Y %I:%M %p",
    "%b %d, %Y %I:%M:%S %p",
    "%b %d, %Y %I:%M %p",
    "%B %d, %Y",
    "%b %d, %Y",
)

_DATE_EXTRACTION_PATTERNS: tuple[str, ...] = (
    r"(20\d{2}[\-\./年]\s*\d{1,2}[\-\./月]\s*\d{1,2}(?:\s*日)?(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)",
    r"(\d{1,2}[\-\./]\d{1,2}[\-\./]20\d{2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)",
    r"((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s*20\d{2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)?)",
    r"((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s*(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s*20\d{2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?(?:\s+[A-Z]{2,5})?)?)",
)


def normalize_loose_datetime_text(value: str | None) -> str:
    """归一化 Blackboard 文本日期，兼容中英文字段前缀。"""
    raw = str(value or "").strip()
    if not raw:
        return ""

    cleaned = _DATETIME_LABEL_PREFIX.sub("", raw)
    cleaned = cleaned.replace("年", "-").replace("月", "-").replace("日", " ")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def extract_date_text(value: str | None) -> str:
    """从混合文本中提取最像日期的片段。"""
    normalized = re.sub(r"\s+", " ", str(value or "")).strip()
    if not normalized:
        return ""

    for pattern in _DATE_EXTRACTION_PATTERNS:
        match = re.search(pattern, normalized, re.IGNORECASE)
        if match:
            return match.group(1).strip()

    label_match = re.search(
        r"(?:Due|Posted on|截止(?:日期|时间)?|发布日期|发布于)\s*[:：]?\s*([^\n\r;；]{4,100})",
        normalized,
        re.IGNORECASE,
    )
    if label_match:
        candidate = label_match.group(1).strip()
        if re.search(
            r"20\d{2}|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec",
            candidate,
            re.IGNORECASE,
        ):
            return candidate

    return ""


def parse_loose_datetime(value: str | None) -> datetime | None:
    """尽量解析 Blackboard/ICS 外围文本中的时间。"""
    cleaned = normalize_loose_datetime_text(value)
    if not cleaned:
        return None

    candidates = [cleaned, cleaned.replace("/", "-"), cleaned.replace(".", "-")]
    english_candidates: list[str] = []
    for item in candidates:
        english_candidates.append(re.sub(r"\s+[A-Z]{2,5}$", "", item))

    for candidate in [*candidates, *english_candidates]:
        for fmt in _DATETIME_FORMATS:
            try:
                return datetime.strptime(candidate, fmt)
            except ValueError:
                continue

    return None


def parse_loose_datetime_or_min(value: str | None) -> datetime:
    """解析失败时返回 [`datetime.min`](backend/app/integrations/sustech/blackboard/shared/datetime.py:1)。"""
    return parse_loose_datetime(value) or datetime.min


def resolve_tzinfo(tzid: str | None) -> tzinfo:
    """将 ICS TZID 解析为 tzinfo。"""
    normalized = str(tzid or "").strip().strip('"')
    if not normalized:
        return UTC

    try:
        return ZoneInfo(normalized)
    except Exception:
        fallback_offsets = {
            "ASIA/SHANGHAI": timezone(timedelta(hours=8)),
            "UTC": UTC,
            "GMT": UTC,
        }
        return fallback_offsets.get(normalized.upper(), UTC)


def parse_ics_datetime(
    value: str | None, params: dict[str, str] | None = None
) -> tuple[datetime | None, bool]:
    """解析 ICS 日期字段，并统一转为 UTC aware datetime。"""
    raw = str(value or "").strip()
    if not raw:
        return None, False

    normalized_params = {str(k).upper(): str(v) for k, v in (params or {}).items()}
    value_type = str(normalized_params.get("VALUE") or "").upper()
    is_all_day = value_type == "DATE" or (len(raw) == 8 and raw.isdigit())

    if is_all_day:
        try:
            dt = datetime.strptime(raw[:8], "%Y%m%d").replace(tzinfo=UTC)
            return dt, True
        except ValueError:
            return None, True

    base = raw
    target_tzinfo: tzinfo | None = None
    if base.endswith("Z"):
        target_tzinfo = UTC
        base = base[:-1]
    elif "TZID" in normalized_params:
        target_tzinfo = resolve_tzinfo(normalized_params.get("TZID"))

    parsed = None
    for fmt in ("%Y%m%dT%H%M%S", "%Y%m%dT%H%M"):
        try:
            parsed = datetime.strptime(base, fmt)
            break
        except ValueError:
            continue

    if parsed is None:
        return None, False

    aware = parsed.replace(tzinfo=target_tzinfo or UTC)
    return aware.astimezone(UTC), False


def to_utc_naive(dt: datetime | None) -> datetime | None:
    """将 aware datetime 转为 UTC naive；naive 原样返回。"""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt
    return dt.astimezone(UTC).replace(tzinfo=None)

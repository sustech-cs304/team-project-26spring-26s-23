"""Blackboard ICS 纯解析 API。"""

from __future__ import annotations

import hashlib
import re
from datetime import datetime

from app.integrations.sustech.blackboard.api.dto import CalendarEventDTO
from app.integrations.sustech.blackboard.shared import (
    extract_blackboard_token_from_text,
    parse_ics_datetime,
    to_utc_naive,
)


class BlackboardCalendarICSParser:
    """解析 Blackboard ICS 文本并产出 [`CalendarEventDTO`](backend/app/integrations/sustech/blackboard/api/dto.py:119)。"""

    @staticmethod
    def unfold_lines(ics_text: str) -> list[str]:
        lines = (
            str(ics_text or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")
        )
        unfolded: list[str] = []
        for line in lines:
            if not line:
                if unfolded:
                    unfolded.append("")
                continue

            if line.startswith((" ", "\t")) and unfolded:
                unfolded[-1] += line[1:]
            else:
                unfolded.append(line)

        return unfolded

    @staticmethod
    def parse_property_line(line: str) -> tuple[str, dict[str, str], str] | None:
        if ":" not in line:
            return None

        left, value = line.split(":", 1)
        parts = left.split(";")
        key = parts[0].strip().upper()
        if not key:
            return None

        params: dict[str, str] = {}
        for item in parts[1:]:
            if "=" not in item:
                continue
            p_key, p_val = item.split("=", 1)
            params[p_key.strip().upper()] = p_val.strip()

        return key, params, value.strip()

    @staticmethod
    def canonicalize_raw_uid(raw_uid: str | None) -> str | None:
        normalized = str(raw_uid or "").strip()
        if not normalized:
            return None

        match = re.fullmatch(r"\d{8}T\d{6}Z-(.+)", normalized)
        if match:
            return match.group(1).strip() or normalized

        return normalized

    @staticmethod
    def stable_uid(raw_uid: str | None, title: str, end_at: datetime | None) -> str:
        canonical_raw_uid = BlackboardCalendarICSParser.canonicalize_raw_uid(raw_uid)
        if canonical_raw_uid:
            digest = hashlib.sha1(canonical_raw_uid.encode("utf-8")).hexdigest()[:20]
            return f"ics_{digest}"

        fallback = f"{title.strip()}::{end_at.isoformat() if end_at else '<none>'}"
        digest = hashlib.sha1(fallback.encode("utf-8")).hexdigest()[:20]
        return f"ics_{digest}"

    @staticmethod
    def unescape_ics_text(value: str | None) -> str | None:
        if value is None:
            return None
        text = str(value)
        text = text.replace("\\n", "\n").replace("\\N", "\n")
        text = text.replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\")
        return text.strip() or None

    @staticmethod
    def extract_course_id(title: str, description: str, location: str) -> str | None:
        return extract_blackboard_token_from_text(title, description, location)

    def parse_events(self, ics_text: str) -> list[CalendarEventDTO]:
        lines = self.unfold_lines(ics_text)

        events_raw: list[dict[str, tuple[dict[str, str], str]]] = []
        current: dict[str, tuple[dict[str, str], str]] | None = None

        for line in lines:
            marker = line.strip().upper()
            if marker == "BEGIN:VEVENT":
                current = {}
                continue
            if marker == "END:VEVENT":
                if current is not None:
                    events_raw.append(current)
                current = None
                continue
            if current is None:
                continue

            parsed = self.parse_property_line(line)
            if parsed is None:
                continue

            key, params, value = parsed
            current[key] = (params, value)

        normalized_map: dict[str, CalendarEventDTO] = {}

        for item in events_raw:
            summary = (
                self.unescape_ics_text(str(item.get("SUMMARY", ({}, ""))[1] or ""))
                or "(No Title)"
            )
            description = self.unescape_ics_text(
                str(item.get("DESCRIPTION", ({}, ""))[1] or "")
            )
            location = self.unescape_ics_text(
                str(item.get("LOCATION", ({}, ""))[1] or "")
            )
            raw_uid = self.unescape_ics_text(str(item.get("UID", ({}, ""))[1] or ""))

            dtstart_params, dtstart_value = item.get("DTSTART", ({}, ""))
            start_at_raw, all_day = parse_ics_datetime(dtstart_value, dtstart_params)
            if start_at_raw is None:
                continue

            dtend_params, dtend_value = item.get("DTEND", ({}, ""))
            end_at_raw, _ = parse_ics_datetime(dtend_value, dtend_params)
            if end_at_raw is None:
                end_at_raw = start_at_raw

            start_at = to_utc_naive(start_at_raw)
            end_at = to_utc_naive(end_at_raw)

            uid = self.stable_uid(raw_uid, summary, end_at)
            course_id = self.extract_course_id(
                summary, description or "", location or ""
            )

            normalized_map[uid] = CalendarEventDTO(
                uid=uid,
                raw_uid=raw_uid,
                title=summary,
                description=description,
                location=location,
                course_id=course_id,
                start_at=start_at,
                end_at=end_at,
                all_day=all_day,
            )

        return list(normalized_map.values())

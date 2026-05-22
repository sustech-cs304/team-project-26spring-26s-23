from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta, MAXYEAR

from app.event_manager.data.dto import UnifiedCalendarEvent
from app.integrations.sustech.blackboard.shared.datetime import (
    parse_ics_datetime,
    to_utc_naive,
)


class WakeupCalendarICSParser:
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
    def unescape_ics_text(value: str | None) -> str | None:
        if value is None:
            return None
        text = str(value)
        text = text.replace("\\n", "\n").replace("\\N", "\n")
        text = text.replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\")
        return text.strip() or None

    @staticmethod
    def _parse_rrule(value: str | None) -> dict[str, str]:
        raw = str(value or "").strip()
        if not raw:
            return {}
        parts = [item.strip() for item in raw.split(";") if item.strip()]
        parsed: dict[str, str] = {}
        for part in parts:
            if "=" not in part:
                continue
            key, val = part.split("=", 1)
            parsed[key.strip().upper()] = val.strip()
        return parsed

    @staticmethod
    def _parse_rrule_until(value: str | None) -> datetime | None:
        raw = str(value or "").strip()
        if not raw:
            return None
        if len(raw) == 8 and raw.isdigit():
            try:
                dt = datetime.strptime(raw, "%Y%m%d").replace(tzinfo=UTC)
                dt = dt.replace(hour=23, minute=59, second=59)
            except ValueError:
                return None
            return dt.astimezone(UTC).replace(tzinfo=None)
        aware, _ = parse_ics_datetime(raw, {})
        if aware is None:
            return None
        return to_utc_naive(aware)

    @staticmethod
    def _stable_source_id(raw_uid: str | None, title: str, start_at: datetime) -> str:
        normalized = str(raw_uid or "").strip() or None
        if normalized is None:
            normalized = f"{title.strip()}::{start_at.isoformat()}"
        digest = hashlib.sha1(
            f"{normalized}::{start_at.isoformat()}".encode("utf-8"),
            usedforsecurity=False,
        ).hexdigest()[:20]
        return f"wakeup_{digest}"

    @staticmethod
    def _parse_rrule_byday(value: str | None, start_at: datetime) -> tuple[int, ...]:
        weekday_map = {
            "MO": 0,
            "TU": 1,
            "WE": 2,
            "TH": 3,
            "FR": 4,
            "SA": 5,
            "SU": 6,
        }
        raw = str(value or "").strip().upper()
        if not raw:
            return (start_at.weekday(),)

        parsed: list[int] = []
        for item in raw.split(","):
            token = item.strip()
            if len(token) < 2:
                continue
            weekday = weekday_map.get(token[-2:])
            if weekday is not None and weekday not in parsed:
                parsed.append(weekday)

        return tuple(sorted(parsed)) or (start_at.weekday(),)

    @staticmethod
    def _expand_weekly_rrule(
        *,
        start_at: datetime,
        end_at: datetime | None,
        rrule: dict[str, str],
        exdates: set[datetime],
    ) -> list[tuple[datetime, datetime | None]]:
        freq = str(rrule.get("FREQ") or "").strip().upper()
        if freq != "WEEKLY":
            return [(start_at, end_at)]

        try:
            interval = int(rrule.get("INTERVAL") or 1)
        except (TypeError, ValueError):
            interval = 1
        interval = max(1, interval)

        until = WakeupCalendarICSParser._parse_rrule_until(rrule.get("UNTIL"))
        count: int | None = None
        try:
            count = int(rrule.get("COUNT")) if rrule.get("COUNT") else None
        except (TypeError, ValueError):
            count = None

        bydays = WakeupCalendarICSParser._parse_rrule_byday(
            rrule.get("BYDAY"), start_at
        )
        duration = (end_at - start_at) if end_at is not None else None

        occurrences: list[tuple[datetime, datetime | None]] = []
        current_week_start = start_at
        produced = 0
        visited = 0
        max_occurrences = 512
        max_date = datetime(MAXYEAR, 12, 31)

        while True:
            for weekday in bydays:
                if count is not None and visited >= count:
                    return occurrences or [(start_at, end_at)]
                if count is None and until is None and visited >= max_occurrences:
                    return occurrences or [(start_at, end_at)]

                try:
                    current = current_week_start + timedelta(
                        days=weekday - start_at.weekday()
                    )
                except OverflowError:
                    return occurrences or [(start_at, end_at)]

                if current < start_at:
                    continue
                if until is not None and current > until:
                    return occurrences or [(start_at, end_at)]

                visited += 1
                if current not in exdates:
                    current_end = current + duration if duration is not None else None
                    occurrences.append((current, current_end))
                    produced += 1

                if count is None and until is None and produced >= max_occurrences:
                    return occurrences or [(start_at, end_at)]

            try:
                next_week_start = current_week_start + timedelta(weeks=interval)
            except OverflowError:
                break
            if next_week_start > max_date:
                break
            current_week_start = next_week_start

        return occurrences or [(start_at, end_at)]

    @staticmethod
    def _parse_exdates(
        exdate_value: str | None, params: dict[str, str] | None
    ) -> set[datetime]:
        raw = str(exdate_value or "").strip()
        if not raw:
            return set()
        items = [item.strip() for item in raw.split(",") if item.strip()]
        result: set[datetime] = set()
        for item in items:
            dt_raw, _ = parse_ics_datetime(item, params or {})
            dt = to_utc_naive(dt_raw)
            if dt is not None:
                result.add(dt)
        return result

    def parse_to_unified_events(
        self, ics_text: str, *, source: str = "wakeup"
    ) -> list[UnifiedCalendarEvent]:
        lines = self.unfold_lines(ics_text)

        events_raw: list[dict[str, list[tuple[dict[str, str], str]]]] = []
        current: dict[str, list[tuple[dict[str, str], str]]] | None = None

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
            current.setdefault(key, []).append((params, value))

        normalized_map: dict[str, UnifiedCalendarEvent] = {}

        for item in events_raw:
            summary_value = (item.get("SUMMARY") or [({}, "")])[0][1]
            summary = self.unescape_ics_text(str(summary_value or "")) or "(No Title)"
            description = self.unescape_ics_text(
                str((item.get("DESCRIPTION") or [({}, "")])[0][1] or "")
            )
            location = self.unescape_ics_text(
                str((item.get("LOCATION") or [({}, "")])[0][1] or "")
            )
            raw_uid = self.unescape_ics_text(
                str((item.get("UID") or [({}, "")])[0][1] or "")
            )

            dtstart_params, dtstart_value = (item.get("DTSTART") or [({}, "")])[0]
            start_at_raw, all_day = parse_ics_datetime(dtstart_value, dtstart_params)
            if start_at_raw is None:
                continue

            dtend_params, dtend_value = (item.get("DTEND") or [({}, "")])[0]
            end_at_raw, _ = parse_ics_datetime(dtend_value, dtend_params)
            if end_at_raw is None:
                end_at_raw = start_at_raw

            start_at = (
                start_at_raw
                if start_at_raw.tzinfo is None
                else start_at_raw.astimezone(UTC).replace(tzinfo=None)
            )
            end_at = to_utc_naive(end_at_raw)

            exdates: set[datetime] = set()
            for ex_params, ex_value in item.get("EXDATE", []):
                exdates |= self._parse_exdates(ex_value, ex_params)

            rrule_value = (item.get("RRULE") or [({}, "")])[0][1]
            rrule = self._parse_rrule(rrule_value)
            occurrences = self._expand_weekly_rrule(
                start_at=start_at, end_at=end_at, rrule=rrule, exdates=exdates
            )

            for occurrence_start, occurrence_end in occurrences:
                source_id = self._stable_source_id(raw_uid, summary, occurrence_start)
                metadata: dict[str, object] = {}
                if location:
                    metadata["location"] = location
                if raw_uid:
                    metadata["raw_uid"] = raw_uid
                if rrule:
                    metadata["rrule"] = rrule
                normalized_map[source_id] = UnifiedCalendarEvent(
                    title=summary,
                    start_time=occurrence_start,
                    end_time=occurrence_end,
                    source=source,
                    source_id=source_id,
                    description=description,
                    is_all_day=all_day,
                    status="not_started",
                    metadata_payload=metadata or None,
                )

        return list(normalized_map.values())

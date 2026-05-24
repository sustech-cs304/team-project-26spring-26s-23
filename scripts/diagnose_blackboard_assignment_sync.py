from __future__ import annotations

import json
import sqlite3
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any

USER_DATA_DIR = Path(r"C:/Users/24352/AppData/Roaming/CanDue")
BLACKBOARD_DB = USER_DATA_DIR / "desktop-runtime" / "database" / "blackboard" / "sustech.db"
TIMELINE_DB = USER_DATA_DIR / "timeline.db"
STDOUT_LOG = USER_DATA_DIR / "desktop-runtime" / "logs" / "backend.stdout.log"
STDERR_LOG = USER_DATA_DIR / "desktop-runtime" / "logs" / "backend.stderr.log"


def print_section(title: str) -> None:
    print()
    print("=" * 96)
    print(title)
    print("=" * 96)


def connect(db_path: Path) -> sqlite3.Connection | None:
    if not db_path.exists():
        print(f"MISSING: {db_path}")
        return None
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn


def table_exists(conn: sqlite3.Connection, name: str) -> bool:
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        (name,),
    ).fetchone()
    return row is not None


def columns(conn: sqlite3.Connection, table: str) -> list[str]:
    if not table_exists(conn, table):
        return []
    return [str(row[1]) for row in conn.execute(f"PRAGMA table_info({table})")]


def scalar(conn: sqlite3.Connection, sql: str, params: tuple[Any, ...] = ()) -> Any:
    row = conn.execute(sql, params).fetchone()
    return None if row is None else row[0]


def text(value: Any) -> str:
    return str(value or "").strip()


def short(value: Any, limit: int = 110) -> str:
    normalized = " ".join(text(value).split())
    return normalized if len(normalized) <= limit else normalized[: limit - 1] + "…"


def parse_datetime(value: Any) -> datetime | None:
    raw = text(value)
    if not raw:
        return None
    candidates = [raw, raw.replace("T", " ").replace("Z", "")]
    for candidate in candidates:
        for fmt in (
            "%Y-%m-%d %H:%M:%S.%f",
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%d %H:%M",
            "%Y-%m-%d",
        ):
            try:
                return datetime.strptime(candidate[:26], fmt)
            except ValueError:
                continue
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def timeline_metadata(row: sqlite3.Row) -> dict[str, Any]:
    raw = text(row["metadata_payload"] if "metadata_payload" in row.keys() else None)
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {"_raw": raw}
    return parsed if isinstance(parsed, dict) else {"_value": parsed}


def bridge_decision(row: sqlite3.Row, existing_source_ids: set[str]) -> tuple[str, str]:
    assignment_id = text(row["assignment_id"] if "assignment_id" in row.keys() else None)
    title = text(row["title"] if "title" in row.keys() else None)
    if not assignment_id or not title:
        return "SKIP_MISSING_IDENTITY", "assignment_id/title 缺失"

    source_id = f"assignment:{assignment_id}"
    if source_id in existing_source_ids:
        return "SKIP_EXISTING", f"timeline 已存在 source_id={source_id}"

    start_time = parse_datetime(row["start_time"] if "start_time" in row.keys() else None)
    end_time = parse_datetime(row["end_time"] if "end_time" in row.keys() else None)
    if start_time is None or end_time is None:
        return "SKIP_INVALID_TIME", f"start_time={row['start_time'] if 'start_time' in row.keys() else None!r}, end_time={row['end_time'] if 'end_time' in row.keys() else None!r}"
    if end_time <= start_time:
        return "SKIP_INVALID_TIME", f"end_time <= start_time ({start_time} -> {end_time})"
    return "INSERTABLE", f"{start_time.isoformat(sep=' ')} -> {end_time.isoformat(sep=' ')}"


def print_paths() -> None:
    print_section("1. Runtime paths")
    for path in (USER_DATA_DIR, BLACKBOARD_DB, TIMELINE_DB, STDOUT_LOG, STDERR_LOG):
        status = "EXISTS" if path.exists() else "MISSING"
        size = path.stat().st_size if path.exists() else "-"
        print(f"{status:7} size={size!s:>10}  {path}")


def print_blackboard_db_report() -> None:
    print_section("2. Blackboard DB tables / assignment parse result")
    conn = connect(BLACKBOARD_DB)
    if conn is None:
        return
    with conn:
        for table in ("courses", "assignments", "announcements", "announcement_assignment_links"):
            if table_exists(conn, table):
                print(f"table {table:<32} rows={scalar(conn, f'SELECT COUNT(*) FROM {table}')}")
            else:
                print(f"table {table:<32} MISSING")

        assignment_columns = columns(conn, "assignments")
        print(f"assignments columns: {', '.join(assignment_columns)}")
        if not table_exists(conn, "assignments"):
            return

        active_total = scalar(conn, "SELECT COUNT(*) FROM assignments WHERE is_deleted = 0")
        with_start = scalar(conn, "SELECT COUNT(*) FROM assignments WHERE is_deleted = 0 AND start_time IS NOT NULL AND TRIM(CAST(start_time AS TEXT)) != ''") if "start_time" in assignment_columns else 0
        with_end = scalar(conn, "SELECT COUNT(*) FROM assignments WHERE is_deleted = 0 AND end_time IS NOT NULL AND TRIM(CAST(end_time AS TEXT)) != ''") if "end_time" in assignment_columns else 0
        with_both = scalar(conn, "SELECT COUNT(*) FROM assignments WHERE is_deleted = 0 AND start_time IS NOT NULL AND TRIM(CAST(start_time AS TEXT)) != '' AND end_time IS NOT NULL AND TRIM(CAST(end_time AS TEXT)) != ''") if {"start_time", "end_time"}.issubset(assignment_columns) else 0
        print(f"active assignments={active_total}, with_start={with_start}, with_end={with_end}, with_both={with_both}")

        rows = conn.execute(
            """
            SELECT id, course_id, assignment_id, title, start_time, end_time, due_date,
                   due_date_parsed, status, submission_status, score, url, source_page,
                   is_deleted
            FROM assignments
            WHERE is_deleted = 0
            ORDER BY course_id, title
            LIMIT 80
            """
        ).fetchall()

        timeline_source_ids: set[str] = set()
        tconn = connect(TIMELINE_DB)
        if tconn is not None:
            with tconn:
                if table_exists(tconn, "timeline_events"):
                    timeline_source_ids = {
                        text(row[0])
                        for row in tconn.execute("SELECT source_id FROM timeline_events WHERE source='bb'")
                        if text(row[0])
                    }

        decision_counts: Counter[str] = Counter()
        print("\nAssignment rows and bridge decisions:")
        for row in rows:
            decision, reason = bridge_decision(row, timeline_source_ids)
            decision_counts[decision] += 1
            print(
                f"- [{decision}] course={row['course_id']} id={row['assignment_id']} "
                f"title={short(row['title'], 72)!r} status={text(row['status']) or '-'} "
                f"submission={text(row['submission_status']) or '-'} score={text(row['score']) or '-'}"
            )
            print(
                f"  time: start={row['start_time']!r}, end={row['end_time']!r}, "
                f"due={row['due_date']!r}, due_parsed={row['due_date_parsed']!r}"
            )
            print(f"  reason: {reason}")
            print(f"  url: {short(row['url'], 140)}")
            print(f"  source_page: {short(row['source_page'], 140)}")

        print(f"\nBridge decision summary: {dict(decision_counts)}")


def print_announcement_report() -> None:
    print_section("3. Announcement classification / linked assignment evidence")
    conn = connect(BLACKBOARD_DB)
    if conn is None:
        return
    with conn:
        if not table_exists(conn, "announcements"):
            print("announcements table missing")
            return
        relation_rows = conn.execute(
            """
            SELECT COALESCE(relation_type, 'NULL') AS relation_type,
                   COALESCE(relation_confidence, 'NULL') AS relation_confidence,
                   COUNT(*) AS cnt
            FROM announcements
            WHERE is_deleted = 0
            GROUP BY COALESCE(relation_type, 'NULL'), COALESCE(relation_confidence, 'NULL')
            ORDER BY cnt DESC
            """
        ).fetchall()
        print("Announcement relation summary:")
        for row in relation_rows:
            print(f"- {row['relation_type']} / {row['relation_confidence']}: {row['cnt']}")

        print("\nRecent assignment-related announcement rows:")
        rows = conn.execute(
            """
            SELECT a.announcement_id, a.course_id, a.title, a.posted_at, a.relation_type,
                   a.relation_confidence, a.url,
                   COUNT(l.id) AS linked_count
            FROM announcements a
            LEFT JOIN announcement_assignment_links l
              ON l.announcement_id = a.announcement_id AND l.is_deleted = 0
            WHERE a.is_deleted = 0
            GROUP BY a.id
            ORDER BY COALESCE(a.posted_at, '') DESC, a.title ASC
            LIMIT 40
            """
        ).fetchall()
        for row in rows:
            marker = "ASSIGNMENT_NOTICE" if text(row["relation_type"]) == "assignment_notice" else "ANNOUNCEMENT"
            print(
                f"- [{marker}] course={row['course_id']} ann={row['announcement_id']} "
                f"linked={row['linked_count']} relation={row['relation_type']}/{row['relation_confidence']} "
                f"posted={row['posted_at']} title={short(row['title'], 90)!r}"
            )
            print(f"  url: {short(row['url'], 140)}")

        if table_exists(conn, "announcement_assignment_links"):
            print("\nAnnouncement -> assignment links:")
            links = conn.execute(
                """
                SELECT l.announcement_id, l.assignment_id, l.course_id, l.link_source,
                       l.confidence, a.title AS announcement_title, s.title AS assignment_title
                FROM announcement_assignment_links l
                LEFT JOIN announcements a ON a.announcement_id = l.announcement_id
                LEFT JOIN assignments s ON s.assignment_id = l.assignment_id
                WHERE l.is_deleted = 0
                ORDER BY l.course_id, l.announcement_id
                LIMIT 60
                """
            ).fetchall()
            for link in links:
                print(
                    f"- course={link['course_id']} ann={short(link['announcement_title'], 55)!r} "
                    f"-> assignment={short(link['assignment_title'], 55)!r} "
                    f"source={link['link_source']} confidence={link['confidence']}"
                )


def print_timeline_report() -> None:
    print_section("4. Timeline bb events")
    conn = connect(TIMELINE_DB)
    if conn is None:
        return
    with conn:
        if not table_exists(conn, "timeline_events"):
            print("timeline_events table missing")
            return
        total = scalar(conn, "SELECT COUNT(*) FROM timeline_events")
        bb_total = scalar(conn, "SELECT COUNT(*) FROM timeline_events WHERE source='bb'")
        assignment_total = scalar(
            conn,
            "SELECT COUNT(*) FROM timeline_events WHERE source='bb' AND source_id LIKE 'assignment:%'",
        )
        print(f"timeline_events total={total}, bb_total={bb_total}, bb_assignment_events={assignment_total}")

        rows = conn.execute(
            """
            SELECT id, source, source_id, title, start_time, end_time, status, progress,
                   metadata_payload
            FROM timeline_events
            WHERE source='bb'
            ORDER BY start_time DESC
            LIMIT 80
            """
        ).fetchall()
        for row in rows:
            metadata = timeline_metadata(row)
            kind = metadata.get("kind", "-")
            print(
                f"- id={row['id']} source_id={row['source_id']} kind={kind} "
                f"status={row['status']} progress={row['progress']} title={short(row['title'], 90)!r}"
            )
            print(f"  time: {row['start_time']} -> {row['end_time']}")
            if metadata:
                print(f"  metadata: {json.dumps(metadata, ensure_ascii=False, sort_keys=True)}")


def print_runtime_log_snippets() -> None:
    print_section("5. Runtime log snippets")
    needles = (
        "Blackboard 作业已同步到统一日历",
        "课程作业抓取完成",
        "Blackboard 基础 snapshot 抓取完成",
        "Blackboard sync payloads 构建完成",
        "Blackboard 数据落库完成",
        "assignment_count",
        "assignment_notice",
        "plain_course_announcement",
    )
    for log_path in (STDOUT_LOG, STDERR_LOG):
        print(f"\n--- {log_path} ---")
        if not log_path.exists():
            print("missing")
            continue
        try:
            data = log_path.read_text(encoding="utf-8", errors="replace")[-1_200_000:]
        except OSError as exc:
            print(f"cannot read: {exc}")
            continue
        matches = [line for line in data.splitlines() if any(needle in line for needle in needles)]
        if not matches:
            print("no matching lines in tail")
            continue
        for line in matches[-120:]:
            print(short(line, 220))


def main() -> None:
    print("Blackboard assignment/calendar diagnostic report")
    print(f"generated_at={datetime.now().isoformat(timespec='seconds')}")
    print_paths()
    print_blackboard_db_report()
    print_announcement_report()
    print_timeline_report()
    print_runtime_log_snippets()


if __name__ == "__main__":
    main()

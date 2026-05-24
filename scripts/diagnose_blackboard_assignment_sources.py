from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Iterable

USER_DATA_DIR = Path(r"C:/Users/24352/AppData/Roaming/CanDue")
BLACKBOARD_DB = USER_DATA_DIR / "desktop-runtime" / "database" / "blackboard" / "sustech.db"


def short(value: object, limit: int = 180) -> str:
    text = " ".join(str(value or "").split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {str(row[1]) for row in conn.execute(f"PRAGMA table_info({table})")}


def select_existing(conn: sqlite3.Connection, table: str, wanted: Iterable[str]) -> str:
    existing = columns(conn, table)
    selected = [name for name in wanted if name in existing]
    return ", ".join(selected) if selected else "COUNT(*) AS count"


def print_rows(title: str, rows: list[sqlite3.Row], fields: Iterable[str]) -> None:
    print("=" * 120)
    print(title)
    print(f"count={len(rows)}")
    for index, row in enumerate(rows, 1):
        parts = []
        for field in fields:
            if field in row.keys():
                parts.append(f"{field}={short(row[field])!r}")
        print(f"[{index}] " + " | ".join(parts))


print(f"BLACKBOARD_DB={BLACKBOARD_DB}")
with sqlite3.connect(str(BLACKBOARD_DB)) as conn:
    conn.row_factory = sqlite3.Row
    for table in ("courses", "assignments", "grades", "resources", "announcements"):
        if table not in {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}:
            print(f"table {table}: MISSING")
            continue
        total = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        active = conn.execute(
            f"SELECT COUNT(*) FROM {table} WHERE COALESCE(is_deleted, 0) = 0"
        ).fetchone()[0]
        print(f"table {table}: total={total}, active={active}, columns={sorted(columns(conn, table))}")

    assignment_summary_rows = conn.execute(
        """
        SELECT course_id,
               COUNT(*) AS total,
               SUM(CASE WHEN lower(COALESCE(summary, '') || ' ' || COALESCE(description, '')) LIKE '%posted on%' THEN 1 ELSE 0 END) AS posted_on_rows,
               SUM(CASE WHEN lower(COALESCE(url, '')) LIKE '%/webapps/assignment/%' THEN 1 ELSE 0 END) AS assignment_url_rows,
               SUM(CASE WHEN lower(COALESCE(url, '') || ' ' || COALESCE(source_page, '')) LIKE '%bb-mygrades%' THEN 1 ELSE 0 END) AS mygrades_rows,
               SUM(CASE WHEN start_time IS NOT NULL AND end_time IS NOT NULL THEN 1 ELSE 0 END) AS timed_rows
        FROM assignments
        WHERE COALESCE(is_deleted, 0) = 0
        GROUP BY course_id
        ORDER BY total DESC
        """
    ).fetchall()
    print_rows(
        "active assignment profile by course",
        assignment_summary_rows,
        ("course_id", "total", "posted_on_rows", "assignment_url_rows", "mygrades_rows", "timed_rows"),
    )

    suspicious_assignments = conn.execute(
        """
        SELECT assignment_id, course_id, title, due_date, start_time, end_time, url, source_page, summary, description
        FROM assignments
        WHERE COALESCE(is_deleted, 0) = 0
          AND lower(COALESCE(summary, '') || ' ' || COALESCE(description, '')) LIKE '%posted on%'
        ORDER BY course_id, title
        LIMIT 80
        """
    ).fetchall()
    print_rows(
        "active assignments containing announcement metadata",
        suspicious_assignments,
        ("assignment_id", "course_id", "title", "due_date", "start_time", "end_time", "url", "source_page", "summary", "description"),
    )

    strong_assignments = conn.execute(
        """
        SELECT assignment_id, course_id, title, due_date, start_time, end_time, url, source_page, summary, description
        FROM assignments
        WHERE COALESCE(is_deleted, 0) = 0
          AND lower(COALESCE(url, '')) LIKE '%/webapps/assignment/%'
        ORDER BY course_id, title
        LIMIT 80
        """
    ).fetchall()
    print_rows(
        "active assignments with strong /webapps/assignment/ url",
        strong_assignments,
        ("assignment_id", "course_id", "title", "due_date", "start_time", "end_time", "url", "source_page", "summary", "description"),
    )

    grade_fields = (
        "grade_id",
        "assignment_id",
        "course_id",
        "item_name",
        "title",
        "name",
        "due_date",
        "due_date_parsed",
        "status",
        "score",
        "total_score",
        "url",
        "source_page",
    )
    grade_select = select_existing(conn, "grades", grade_fields)
    grade_title_expr = "COALESCE(item_name, title, name, '')"
    grade_rows = conn.execute(
        f"""
        SELECT {grade_select}
        FROM grades
        WHERE COALESCE(is_deleted, 0) = 0
          AND lower({grade_title_expr}) NOT LIKE '%course grade%'
          AND lower({grade_title_expr}) NOT LIKE '%total%'
        ORDER BY course_id, {grade_title_expr}
        LIMIT 120
        """
    ).fetchall()
    print_rows("active non-total grade rows", grade_rows, grade_fields)

    resource_rows = conn.execute(
        """
        SELECT resource_id, course_id, assignment_id, title, type, url, source_page, parent_id
        FROM resources
        WHERE COALESCE(is_deleted, 0) = 0
          AND (
            lower(COALESCE(title, '')) LIKE '%assignment%'
            OR lower(COALESCE(title, '')) LIKE '%homework%'
            OR lower(COALESCE(title, '')) LIKE '%lab%'
            OR lower(COALESCE(title, '')) LIKE '%project%'
            OR lower(COALESCE(url, '')) LIKE '%/webapps/assignment/%'
          )
        ORDER BY course_id, title
        LIMIT 160
        """
    ).fetchall()
    print_rows(
        "active resource rows that look assignment-related",
        resource_rows,
        ("resource_id", "course_id", "assignment_id", "title", "type", "url", "source_page", "parent_id"),
    )

    announcement_rows = conn.execute(
        """
        SELECT announcement_id, course_id, title, publish_time, url, source_page, relation_type, relation_confidence, detail
        FROM announcements
        WHERE COALESCE(is_deleted, 0) = 0
          AND (
            lower(COALESCE(title, '') || ' ' || COALESCE(detail, '')) LIKE '%assignment%'
            OR lower(COALESCE(title, '') || ' ' || COALESCE(detail, '')) LIKE '%homework%'
            OR lower(COALESCE(title, '') || ' ' || COALESCE(detail, '')) LIKE '%project%'
            OR lower(COALESCE(title, '') || ' ' || COALESCE(detail, '')) LIKE '%due%'
          )
        ORDER BY course_id, publish_time DESC
        LIMIT 120
        """
    ).fetchall()
    print_rows(
        "active announcement rows that mention assignment/homework/project/due",
        announcement_rows,
        ("announcement_id", "course_id", "title", "publish_time", "relation_type", "relation_confidence", "url", "source_page", "detail"),
    )

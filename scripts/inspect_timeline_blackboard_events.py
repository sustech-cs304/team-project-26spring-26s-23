from __future__ import annotations

import json
import sqlite3
from pathlib import Path

USER_DATA_DIR = Path(r"C:/Users/24352/AppData/Roaming/CanDue")
BLACKBOARD_DB = USER_DATA_DIR / "desktop-runtime" / "database" / "blackboard" / "sustech.db"
TIMELINE_DB = USER_DATA_DIR / "timeline.db"


def short(value: object, limit: int = 140) -> str:
    text = " ".join(str(value or "").split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


print(f"TIMELINE_DB={TIMELINE_DB}")
print(f"BLACKBOARD_DB={BLACKBOARD_DB}")

with sqlite3.connect(str(TIMELINE_DB)) as timeline_conn:
    timeline_conn.row_factory = sqlite3.Row
    timeline_rows = timeline_conn.execute(
        """
        SELECT id, source, source_id, title, start_time, end_time, status, progress, metadata_payload
        FROM timeline_events
        ORDER BY id
        """
    ).fetchall()

with sqlite3.connect(str(BLACKBOARD_DB)) as blackboard_conn:
    blackboard_conn.row_factory = sqlite3.Row
    print(f"timeline_rows={len(timeline_rows)}")
    for row in timeline_rows:
        metadata = json.loads(row["metadata_payload"] or "{}")
        assignment_id = str(metadata.get("assignment_id") or "").strip()
        course_id = str(metadata.get("course_id") or "").strip()
        assignment_row = None
        announcement_matches = []
        if assignment_id:
            assignment_row = blackboard_conn.execute(
                """
                SELECT assignment_id, course_id, title, url, source_page, start_time, end_time, due_date,
                       description, description_html, summary, status, submission_status
                FROM assignments
                WHERE assignment_id = ?
                LIMIT 1
                """,
                (assignment_id,),
            ).fetchone()
            announcement_matches = blackboard_conn.execute(
                """
                SELECT a.announcement_id, a.course_id, a.title, a.url, a.relation_type, a.relation_confidence
                FROM announcements a
                JOIN announcement_assignment_links l ON l.announcement_id = a.announcement_id
                WHERE l.assignment_id = ? AND l.is_deleted = 0 AND a.is_deleted = 0
                LIMIT 8
                """,
                (assignment_id,),
            ).fetchall()

        print("-" * 120)
        print(
            f"TL id={row['id']} source={row['source']} source_id={row['source_id']} "
            f"status={row['status']} progress={row['progress']}"
        )
        print(f"TL title={short(row['title'])!r}")
        print(f"TL time={row['start_time']} -> {row['end_time']}")
        print(f"metadata.kind={metadata.get('kind')!r} assignment_id={assignment_id!r} course_id={course_id!r}")
        print(f"metadata.url={short(metadata.get('url'))}")
        print(f"metadata.source_page={short(metadata.get('source_page'))}")
        if assignment_row is None:
            print("ASSIGNMENT_ROW=None")
        else:
            print(
                f"ASSIGNMENT title={short(assignment_row['title'])!r} "
                f"time={assignment_row['start_time']} -> {assignment_row['end_time']} due={assignment_row['due_date']}"
            )
            print(f"ASSIGNMENT url={short(assignment_row['url'])}")
            print(f"ASSIGNMENT source_page={short(assignment_row['source_page'])}")
            print(f"ASSIGNMENT summary={short(assignment_row['summary'])!r}")
            print(f"ASSIGNMENT description={short(assignment_row['description'])!r}")
        if announcement_matches:
            print("LINKED_ANNOUNCEMENTS:")
            for ann in announcement_matches:
                print(
                    f"  ann={ann['announcement_id']} course={ann['course_id']} "
                    f"relation={ann['relation_type']}/{ann['relation_confidence']} title={short(ann['title'])!r}"
                )
                print(f"  ann.url={short(ann['url'])}")
        else:
            print("LINKED_ANNOUNCEMENTS=None")

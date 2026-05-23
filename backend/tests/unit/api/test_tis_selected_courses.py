from __future__ import annotations

from app.integrations.sustech.teaching_information_system.api.dto import TISSelectedCourseSemester
from app.integrations.sustech.teaching_information_system.api.selected_courses import extract_selected_course_records_from_json
from app.integrations.sustech.teaching_information_system.shared import _clean_text



def test_clean_text_preserves_legitimate_falsy_values() -> None:
    assert _clean_text(None) == ""
    assert _clean_text(0) == "0"
    assert _clean_text(False) == ""



def test_extract_selected_course_records_preserves_zero_effective_status() -> None:
    semester = TISSelectedCourseSemester(
        semester_id="2025-20261",
        academic_year="2025-2026",
        term_code="1",
    )

    records = extract_selected_course_records_from_json(
        {
            "yxkcList": [
                {
                    "kcdm": "CS101",
                    "kcmc": "Course A",
                    "cqzt": 0,
                    "xf": 3,
                }
            ]
        },
        semester=semester,
    )

    assert len(records) == 1
    assert records[0].effective_flag is False
    assert records[0].effective_status == "0"
    assert records[0].credits == 3.0

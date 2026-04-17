"""TIS 已选课程查询解析。"""

from __future__ import annotations

import re
from typing import Any, Sequence

from ..shared import _clean_text, _jsonable, compose_semester_label
from .dto import TISSelectedCourseRecord, TISSelectedCourseSemester, TISSelectedCourseSummary


def _to_float_or_none(value: Any) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    text = _clean_text(value)
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _to_bool_or_none(value: Any) -> bool | None:
    text = _clean_text(value).lower()
    if not text:
        return None
    if text in {"1", "true", "yes", "y", "是"}:
        return True
    if text in {"0", "false", "no", "n", "否"}:
        return False
    return None


def _build_selected_course_semester(
    academic_year: str,
    term_code: str,
    *,
    is_current: bool | None = None,
    raw: dict[str, Any] | None = None,
) -> TISSelectedCourseSemester | None:
    year = _clean_text(academic_year)
    code = _clean_text(term_code)
    if not year or not code:
        return None
    return TISSelectedCourseSemester(
        semester_id=f"{year}{code}",
        academic_year=year,
        term_code=code,
        label=compose_semester_label(year, code),
        is_current=is_current,
        raw={str(key): _jsonable(value) for key, value in (raw or {}).items()},
    )


def _extract_selected_courses_current_semester(payload: Any) -> TISSelectedCourseSemester | None:
    if not isinstance(payload, dict):
        return None
    current_semester = _build_selected_course_semester(
        _clean_text(payload.get("p_dqxn") or payload.get("p_xn")),
        _clean_text(payload.get("p_dqxq") or payload.get("p_xq")),
        is_current=True,
        raw={str(key): _jsonable(value) for key, value in payload.items()},
    )
    if current_semester is not None:
        return current_semester
    return _build_selected_course_semester(
        _clean_text(payload.get("p_xn")),
        _clean_text(payload.get("p_xq")),
        is_current=True,
        raw={str(key): _jsonable(value) for key, value in payload.items()},
    )


def _parse_selected_course_semester_argument(
    semester: str | None,
    *,
    current_semester: TISSelectedCourseSemester | None = None,
) -> TISSelectedCourseSemester:
    if semester is None:
        if current_semester is None:
            raise RuntimeError("TIS 已选课程默认学期解析失败")
        return current_semester

    text = _clean_text(semester)
    if not text:
        raise ValueError("学期参数不能为空字符串")
    if text in {"当前学期", "current", "current_semester"}:
        if current_semester is None:
            raise RuntimeError("TIS 当前学期尚未解析，无法使用默认学期别名")
        return current_semester

    normalized = text.replace("/", "-").replace(" ", "")
    full_match = re.fullmatch(r"(\d{4}-\d{4})([123])", normalized)
    if full_match:
        semester_option = _build_selected_course_semester(full_match.group(1), full_match.group(2), raw={"input": text})
        if semester_option is None:
            raise ValueError(f"无法解析学期参数: {semester}")
        return semester_option

    segmented_match = re.fullmatch(r"(\d{4}-\d{4})-([123])", normalized)
    if segmented_match:
        semester_option = _build_selected_course_semester(segmented_match.group(1), segmented_match.group(2), raw={"input": text})
        if semester_option is None:
            raise ValueError(f"无法解析学期参数: {semester}")
        return semester_option

    raise ValueError(f"无法识别的学期参数格式: {semester}")


def _build_selected_courses_base_payload(
    *,
    pylx: str,
    academic_year: str = "",
    term_code: str = "",
    semester_id: str = "",
    current_academic_year: str = "",
    current_term_code: str = "",
    current_semester_id: str = "",
    selection_mode: str = "",
    page_num: int | None = None,
    page_size: int | None = None,
    selected_credit_flag: str = "",
) -> dict[str, Any]:
    normalized_pylx = _clean_text(pylx) or "1"
    payload: dict[str, Any] = {
        "cxsfmt": "0",
        "p_pylx": normalized_pylx,
        "mxpylx": normalized_pylx,
        "p_sfgldjr": "0",
        "p_sfredis": "0",
        "p_sfsyxkgwc": "0",
        "p_xktjz": "",
        "p_chaxunxh": "",
        "p_gjz": "",
        "p_skjs": "",
        "p_xn": _clean_text(academic_year),
        "p_xq": _clean_text(term_code),
        "p_xnxq": _clean_text(semester_id),
        "p_dqxn": _clean_text(current_academic_year),
        "p_dqxq": _clean_text(current_term_code),
        "p_dqxnxq": _clean_text(current_semester_id),
        "p_xkfsdm": _clean_text(selection_mode),
        "p_xiaoqu": "",
        "p_kkyx": "",
        "p_kclb": "",
        "p_xkxs": "",
        "p_dyc": "",
        "p_kkxnxq": "",
        "p_id": "",
        "p_sfhlctkc": "0",
        "p_sfhllrlkc": "0",
        "p_kxsj_xqj": "",
        "p_kxsj_ksjc": "",
        "p_kxsj_jsjc": "",
        "p_kcdm_js": "",
        "p_kcdm_cxrw": "",
        "p_kcdm_cxrw_zckc": "",
        "p_kc_gjz": "",
        "p_xzcxtjz_nj": "",
        "p_xzcxtjz_yx": "",
        "p_xzcxtjz_zy": "",
        "p_xzcxtjz_zyfx": "",
        "p_xzcxtjz_bj": "",
        "p_sfxsgwckb": "1",
        "p_skyy": "",
        "p_sfmxzj": selected_credit_flag,
    }
    if page_num is not None and page_size is not None:
        payload["p_chaxunxkfsdm"] = ""
        payload["pageNum"] = int(page_num)
        payload["pageSize"] = int(page_size)
    return payload


def extract_selected_course_records_from_json(payload: Any, *, semester: TISSelectedCourseSemester) -> list[TISSelectedCourseRecord]:
    if not isinstance(payload, dict):
        return []
    rows = payload.get("yxkcList")
    if not isinstance(rows, list):
        return []

    records: list[TISSelectedCourseRecord] = []
    for item in rows:
        if not isinstance(item, dict):
            continue
        course_code = _clean_text(item.get("kcdm"))
        course_name = _clean_text(item.get("kcmc"))
        if not course_code or not course_name:
            continue

        class_time = _clean_text(item.get("sksj")) or None
        class_location = _clean_text(item.get("skdd")) or None
        class_info = " ".join(part for part in (class_time, class_location) if part) or None
        effective_status = _clean_text(item.get("cqms") or item.get("cqzt")) or None

        records.append(
            TISSelectedCourseRecord(
                course_code=course_code,
                course_name=course_name,
                task_number=_clean_text(item.get("rwh")) or None,
                course_sequence_number=_clean_text(item.get("kxh")) or None,
                course_nature=_clean_text(item.get("kcxzmc") or item.get("kcxz")) or None,
                course_category=_clean_text(item.get("kclbmc") or item.get("kclb")) or None,
                credits=_to_float_or_none(item.get("xf")),
                hours=_to_float_or_none(item.get("xs")),
                class_time=class_time,
                class_location=class_location,
                class_info=class_info,
                offering_department=_clean_text(item.get("kkyxmc")) or None,
                selection_category=_clean_text(item.get("xkfsmc") or item.get("xkfsdm")) or None,
                selection_coefficient=_to_float_or_none(item.get("xkxs")),
                effective_flag=_to_bool_or_none(item.get("cqzt")),
                effective_status=effective_status,
                selected_at=_clean_text(item.get("xksj")) or None,
                campus=_clean_text(item.get("xiaoqumc")) or None,
                term=_clean_text(item.get("xnxq")) or semester.semester_id,
                raw={str(key): _jsonable(value) for key, value in item.items()},
            )
        )
    return records


def build_selected_course_summary(
    payload: Any,
    *,
    courses: Sequence[TISSelectedCourseRecord],
    page_num: int,
    page_size: int,
) -> TISSelectedCourseSummary:
    credit_values = [course.credits for course in courses if course.credits is not None]
    hour_values = [course.hours for course in courses if course.hours is not None]
    effective_course_count = sum(1 for course in courses if course.effective_flag is True)
    raw_keys = sorted(str(key) for key in payload.keys()) if isinstance(payload, dict) else []
    return TISSelectedCourseSummary(
        course_count=len(courses),
        total_credits=round(sum(credit_values), 3) if credit_values else None,
        total_hours=round(sum(hour_values), 3) if hour_values else None,
        effective_course_count=effective_course_count,
        page_num=int(page_num),
        page_size=int(page_size),
        raw_keys=raw_keys,
    )


__all__ = [
    "_build_selected_courses_base_payload",
    "_extract_selected_courses_current_semester",
    "_parse_selected_course_semester_argument",
    "build_selected_course_summary",
    "extract_selected_course_records_from_json",
]

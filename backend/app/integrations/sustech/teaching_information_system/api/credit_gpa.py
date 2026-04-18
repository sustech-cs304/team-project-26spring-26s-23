"""TIS 学分绩查询解析。"""

from __future__ import annotations

from typing import Any

from ..shared import _clean_text, _jsonable
from .dto import TISCreditGPASummary, TISCreditGPATermRecord, TISCreditGPAYearRecord


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


def extract_credit_gpa_summary_from_json(payload: Any) -> TISCreditGPASummary:
    if not isinstance(payload, dict):
        return TISCreditGPASummary()
    summary_payload = payload.get("xfjandpm")
    if not isinstance(summary_payload, dict):
        return TISCreditGPASummary()
    return TISCreditGPASummary(
        average_credit_gpa=_to_float_or_none(summary_payload.get("PJXFJ")),
        rank=_clean_text(summary_payload.get("PM")) or None,
        raw={str(key): _jsonable(value) for key, value in summary_payload.items()},
    )


def extract_credit_gpa_term_records_from_json(
    payload: Any,
) -> list[TISCreditGPATermRecord]:
    if not isinstance(payload, dict):
        return []
    rows = payload.get("xnanxqxfj")
    if not isinstance(rows, list):
        return []

    records: list[TISCreditGPATermRecord] = []
    for item in rows:
        if not isinstance(item, dict):
            continue
        academic_year_term = _clean_text(item.get("XNXQ"))
        if not academic_year_term:
            continue
        records.append(
            TISCreditGPATermRecord(
                academic_year_term=academic_year_term,
                academic_year=_clean_text(item.get("XN")) or None,
                term_code=_clean_text(item.get("XQ")) or None,
                term_credit_gpa=_to_float_or_none(item.get("XQXFJ")),
                year_credit_gpa=_to_float_or_none(item.get("XNXFJ")),
                raw={str(key): _jsonable(value) for key, value in item.items()},
            )
        )
    return records


def extract_credit_gpa_year_records_from_json(
    payload: Any,
) -> list[TISCreditGPAYearRecord]:
    term_records = extract_credit_gpa_term_records_from_json(payload)
    year_records: list[TISCreditGPAYearRecord] = []
    seen_years: set[str] = set()
    for term_record in term_records:
        academic_year = _clean_text(term_record.academic_year)
        if not academic_year or academic_year in seen_years:
            continue
        seen_years.add(academic_year)
        year_records.append(
            TISCreditGPAYearRecord(
                academic_year=academic_year,
                year_credit_gpa=term_record.year_credit_gpa,
                raw={
                    "XN": academic_year,
                    "XNXFJ": term_record.year_credit_gpa,
                    "source": term_record.raw,
                },
            )
        )
    return year_records


__all__ = [
    "extract_credit_gpa_summary_from_json",
    "extract_credit_gpa_term_records_from_json",
    "extract_credit_gpa_year_records_from_json",
]

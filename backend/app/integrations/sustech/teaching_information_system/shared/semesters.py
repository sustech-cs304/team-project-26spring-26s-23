"""TIS 学期相关共享工具。"""

from __future__ import annotations

from .text import _clean_text

_TERM_CODE_TO_NAME: dict[str, str] = {"1": "秋季", "2": "春季", "3": "夏季"}


def compose_semester_label(academic_year: str, term_code: str) -> str:
    year = _clean_text(academic_year)
    code = _clean_text(term_code)
    if not year:
        return code
    if not code:
        return year
    return f"{year}{_TERM_CODE_TO_NAME.get(code, code)}"


__all__ = ["_TERM_CODE_TO_NAME", "compose_semester_label"]

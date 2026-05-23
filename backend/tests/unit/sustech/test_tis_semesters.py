from __future__ import annotations

from app.integrations.sustech.teaching_information_system.shared.semesters import (
    _TERM_CODE_TO_NAME,
    compose_semester_label,
)


def _assert_equal(actual: object, expected: object, message: str) -> None:
    if actual != expected:
        raise AssertionError(f"{message}: expected={expected!r}, actual={actual!r}")


class TestTermCodeToNameMapping:
    def test_term_1_is_autumn(self) -> None:
        _assert_equal(_TERM_CODE_TO_NAME["1"], "秋季", "code 1 → 秋季")

    def test_term_2_is_spring(self) -> None:
        _assert_equal(_TERM_CODE_TO_NAME["2"], "春季", "code 2 → 春季")

    def test_term_3_is_summer(self) -> None:
        _assert_equal(_TERM_CODE_TO_NAME["3"], "夏季", "code 3 → 夏季")

    def test_has_only_three_entries(self) -> None:
        assert len(_TERM_CODE_TO_NAME) == 3


class TestComposeSemesterLabel:
    def test_standard_fall_semester(self) -> None:
        result = compose_semester_label("2024-2025", "1")
        _assert_equal(result, "2024-2025秋季", "standard fall semester")

    def test_standard_spring_semester(self) -> None:
        result = compose_semester_label("2024-2025", "2")
        _assert_equal(result, "2024-2025春季", "standard spring semester")

    def test_standard_summer_semester(self) -> None:
        result = compose_semester_label("2024-2025", "3")
        _assert_equal(result, "2024-2025夏季", "standard summer semester")

    def test_unknown_term_code_preserved_as_is(self) -> None:
        result = compose_semester_label("2024-2025", "4")
        _assert_equal(result, "2024-20254", "unknown code appended as-is")

    def test_empty_year_returns_code_only(self) -> None:
        result = compose_semester_label("", "1")
        _assert_equal(result, "1", "empty year → code only")

    def test_none_year_returns_code_only(self) -> None:
        result = compose_semester_label(None, "2")  # type: ignore[arg-type]
        _assert_equal(result, "2", "None year → code only")

    def test_empty_code_returns_year_only(self) -> None:
        result = compose_semester_label("2024-2025", "")
        _assert_equal(result, "2024-2025", "empty code → year only")

    def test_none_code_returns_year_only(self) -> None:
        result = compose_semester_label("2024-2025", None)  # type: ignore[arg-type]
        _assert_equal(result, "2024-2025", "None code → year only")

    def test_both_empty_returns_empty(self) -> None:
        result = compose_semester_label("", "")
        _assert_equal(result, "", "both empty → empty string")

    def test_year_with_whitespace_trimmed(self) -> None:
        result = compose_semester_label("  2024-2025  ", "1")
        _assert_equal(result, "2024-2025秋季", "whitespace trimmed from year")

    def test_code_with_whitespace_trimmed(self) -> None:
        result = compose_semester_label("2024-2025", " 2 ")
        _assert_equal(result, "2024-2025春季", "whitespace trimmed from code")

    def test_term_code_with_letter_unknown(self) -> None:
        result = compose_semester_label("2024-2025", "A")
        _assert_equal(result, "2024-2025A", "letter code preserved as-is")

    def test_single_year_fall(self) -> None:
        result = compose_semester_label("2024", "1")
        _assert_equal(result, "2024秋季", "single year fall")

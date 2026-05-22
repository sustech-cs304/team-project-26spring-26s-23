from __future__ import annotations

from app.integrations.sustech.teaching_information_system.api.credit_gpa import (
    _to_float_or_none,
    extract_credit_gpa_summary_from_json,
    extract_credit_gpa_term_records_from_json,
    extract_credit_gpa_year_records_from_json,
)

# ---------------------------------------------------------------------------
# _to_float_or_none
# ---------------------------------------------------------------------------


class TestToFloatOrNone:
    def test_float_input(self) -> None:
        assert _to_float_or_none(3.5) == 3.5

    def test_int_input(self) -> None:
        assert _to_float_or_none(4) == 4.0

    def test_string_number_input(self) -> None:
        assert _to_float_or_none("3.75") == 3.75

    def test_none_input_returns_none(self) -> None:
        assert _to_float_or_none(None) is None

    def test_empty_string_returns_none(self) -> None:
        assert _to_float_or_none("") is None

    def test_whitespace_only_returns_none(self) -> None:
        assert _to_float_or_none("   ") is None

    def test_non_numeric_string_returns_none(self) -> None:
        assert _to_float_or_none("N/A") is None

    def test_bool_true_returns_none(self) -> None:
        """Booleans are instances of int; should not be converted."""
        assert _to_float_or_none(True) is None

    def test_bool_false_returns_none(self) -> None:
        assert _to_float_or_none(False) is None


# ---------------------------------------------------------------------------
# extract_credit_gpa_summary_from_json
# ---------------------------------------------------------------------------

SUMMARY_JSON_VALID = {
    "xfjandpm": {
        "PJXFJ": 3.75,
        "PM": "42/200",
        "extra_field": "ignored",
    }
}

SUMMARY_JSON_MISSING_NODE = {"other": "data"}

SUMMARY_JSON_NIL_NODE = {"xfjandpm": None}

SUMMARY_JSON_NOT_DICT = ["list", "input"]


class TestExtractCreditGpaSummaryFromJson:
    def test_extracts_average_credit_gpa(self) -> None:
        summary = extract_credit_gpa_summary_from_json(SUMMARY_JSON_VALID)
        assert summary.average_credit_gpa == 3.75

    def test_extracts_rank(self) -> None:
        summary = extract_credit_gpa_summary_from_json(SUMMARY_JSON_VALID)
        assert summary.rank == "42/200"

    def test_raw_data_preserved(self) -> None:
        summary = extract_credit_gpa_summary_from_json(SUMMARY_JSON_VALID)
        assert "PJXFJ" in summary.raw

    def test_missing_xfjandpm_returns_default(self) -> None:
        summary = extract_credit_gpa_summary_from_json(SUMMARY_JSON_MISSING_NODE)
        assert summary.average_credit_gpa is None
        assert summary.rank is None

    def test_none_xfjandpm_returns_default(self) -> None:
        summary = extract_credit_gpa_summary_from_json(SUMMARY_JSON_NIL_NODE)
        assert summary.average_credit_gpa is None

    def test_non_dict_input_returns_default(self) -> None:
        summary = extract_credit_gpa_summary_from_json(SUMMARY_JSON_NOT_DICT)
        assert summary.average_credit_gpa is None

    def test_empty_dict_returns_default(self) -> None:
        summary = extract_credit_gpa_summary_from_json({})
        assert summary.average_credit_gpa is None


# ---------------------------------------------------------------------------
# extract_credit_gpa_term_records_from_json
# ---------------------------------------------------------------------------

TERM_JSON_VALID = {
    "xnanxqxfj": [
        {
            "XNXQ": "2023-2024-1",
            "XN": "2023-2024",
            "XQ": "1",
            "XQXFJ": 3.8,
            "XNXFJ": 3.7,
        },
        {
            "XNXQ": "2023-2024-2",
            "XN": "2023-2024",
            "XQ": "2",
            "XQXFJ": 3.9,
            "XNXFJ": 3.7,
        },
        {
            "XNXQ": "2024-2025-1",
            "XN": "2024-2025",
            "XQ": "1",
            "XQXFJ": "3.6",
            "XNXFJ": "3.6",
        },
    ]
}

TERM_JSON_EMPTY_ROWS = {"xnanxqxfj": []}

TERM_JSON_MISSING_KEY = {"other": "data"}

TERM_JSON_NON_DICT_ITEM = {"xnanxqxfj": [{"XNXQ": "2023-2024-1"}, "string_item"]}

TERM_JSON_MISSING_XNXQ = {"xnanxqxfj": [{"XN": "2023-2024", "XQ": "1"}]}


class TestExtractCreditGpaTermRecordsFromJson:
    def test_extracts_all_term_records(self) -> None:
        records = extract_credit_gpa_term_records_from_json(TERM_JSON_VALID)
        assert len(records) == 3

    def test_extracts_academic_year_term(self) -> None:
        records = extract_credit_gpa_term_records_from_json(TERM_JSON_VALID)
        terms = {r.academic_year_term for r in records}
        assert "2023-2024-1" in terms
        assert "2024-2025-1" in terms

    def test_extracts_academic_year(self) -> None:
        records = extract_credit_gpa_term_records_from_json(TERM_JSON_VALID)
        years = {r.academic_year for r in records}
        assert "2023-2024" in years
        assert "2024-2025" in years

    def test_extracts_term_code(self) -> None:
        records = extract_credit_gpa_term_records_from_json(TERM_JSON_VALID)
        codes = {r.term_code for r in records}
        assert "1" in codes
        assert "2" in codes

    def test_extracts_term_credit_gpa(self) -> None:
        records = extract_credit_gpa_term_records_from_json(TERM_JSON_VALID)
        first = records[0]
        assert first.term_credit_gpa == 3.8

    def test_extracts_year_credit_gpa(self) -> None:
        records = extract_credit_gpa_term_records_from_json(TERM_JSON_VALID)
        first = records[0]
        assert first.year_credit_gpa == 3.7

    def test_string_gpa_converted_to_float(self) -> None:
        records = extract_credit_gpa_term_records_from_json(TERM_JSON_VALID)
        third = records[2]
        assert third.term_credit_gpa == 3.6
        assert third.year_credit_gpa == 3.6

    def test_empty_rows_returns_empty_list(self) -> None:
        records = extract_credit_gpa_term_records_from_json(TERM_JSON_EMPTY_ROWS)
        assert records == []

    def test_missing_key_returns_empty_list(self) -> None:
        records = extract_credit_gpa_term_records_from_json(TERM_JSON_MISSING_KEY)
        assert records == []

    def test_non_list_rows_returns_empty(self) -> None:
        records = extract_credit_gpa_term_records_from_json(
            {"xnanxqxfj": "not_a_list"}
        )
        assert records == []

    def test_non_dict_item_skipped(self) -> None:
        records = extract_credit_gpa_term_records_from_json(TERM_JSON_NON_DICT_ITEM)
        assert len(records) == 1
        assert records[0].academic_year_term == "2023-2024-1"

    def test_missing_xnxq_skipped(self) -> None:
        records = extract_credit_gpa_term_records_from_json(TERM_JSON_MISSING_XNXQ)
        assert records == []

    def test_non_dict_input_returns_empty(self) -> None:
        records = extract_credit_gpa_term_records_from_json("not json")
        assert records == []

    def test_raw_data_preserved(self) -> None:
        records = extract_credit_gpa_term_records_from_json(TERM_JSON_VALID)
        assert len(records) > 0
        assert "XNXQ" in records[0].raw


# ---------------------------------------------------------------------------
# extract_credit_gpa_year_records_from_json
# ---------------------------------------------------------------------------


class TestExtractCreditGpaYearRecordsFromJson:
    def test_extracts_year_records_from_term_data(self) -> None:
        records = extract_credit_gpa_year_records_from_json(TERM_JSON_VALID)
        assert len(records) == 2
        years = {r.academic_year for r in records}
        assert "2023-2024" in years
        assert "2024-2025" in years

    def test_first_occurrence_wins_for_year_gpa(self) -> None:
        records = extract_credit_gpa_year_records_from_json(TERM_JSON_VALID)
        year_2023_2024 = [r for r in records if r.academic_year == "2023-2024"]
        assert len(year_2023_2024) == 1
        assert year_2023_2024[0].year_credit_gpa == 3.7

    def test_empty_term_records_returns_empty(self) -> None:
        records = extract_credit_gpa_year_records_from_json(
            {"xnanxqxfj": []}
        )
        assert records == []

    def test_invalid_input_returns_empty(self) -> None:
        records = extract_credit_gpa_year_records_from_json("invalid")
        assert records == []

    def test_raw_data_includes_source(self) -> None:
        records = extract_credit_gpa_year_records_from_json(TERM_JSON_VALID)
        assert len(records) > 0
        assert "XN" in records[0].raw
        assert "source" in records[0].raw

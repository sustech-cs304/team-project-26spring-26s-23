from __future__ import annotations

import json
from datetime import datetime

from app.integrations.sustech.blackboard.data.sync_operations import (
    _assignment_record_score,
    _derive_max_score,
    _deserialize_assignment_attachments_json,
    _has_meaningful_value,
    _merge_assignment_attachment_rows,
    _merge_assignment_records_by_assignment_id,
    _normalize_announcement_assignment_link_record,
    _normalize_announcement_record,
    _normalize_assignment_attachments,
    _normalize_assignment_id,
    _normalize_assignment_record,
    _normalize_calendar_event_record,
    _normalize_grade_assignment_id,
    _normalize_grade_id,
    _normalize_grade_record,
    _normalize_resource_parent_id,
    _normalize_resource_record,
    _text,
)


def _assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def _assert_false(condition: bool, message: str) -> None:
    if condition:
        raise AssertionError(message)


def _assert_equal(actual: object, expected: object, message: str) -> None:
    if actual != expected:
        raise AssertionError(f"{message}: expected={expected!r}, actual={actual!r}")


def _stable_id(*parts: str) -> str:
    return "_".join(part for part in parts if part)


def _mock_normalize_url(value: object) -> str | None:
    if value is None:
        return None
    return str(value).strip() or None


def _mock_parse_total_score(value: object) -> str | None:
    if value is None:
        return None
    return str(value).strip() or None


def _mock_parse_datetime(value: object) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.strptime(str(value), "%Y-%m-%d %H:%M")
    except ValueError:
        return None


def _mock_parse_score_metrics(score: object) -> tuple[float | None, float | None, float | None]:
    if score is None:
        return None, None, None
    text = str(score).strip()
    if "/" in text:
        parts = text.split("/")
        try:
            return float(parts[0]), float(parts[1]), None
        except ValueError:
            return None, None, None
    try:
        return float(text), None, None
    except ValueError:
        return None, None, None


def _mock_to_float(value: object) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (ValueError, TypeError):
        return None


def _mock_guess_resource_type(url: str) -> str:
    return "file"


# ── _text ────────────────────────────────────────────────────────────────────


class TestTextHelper:
    def test_converts_none_to_empty(self) -> None:
        _assert_equal(_text(None), "", "None → ''")

    def test_converts_number_to_str(self) -> None:
        _assert_equal(_text(42), "42", "int → str")

    def test_strips_whitespace(self) -> None:
        _assert_equal(_text("  hello  "), "hello", "stripped")

    def test_empty_string_stays_empty(self) -> None:
        _assert_equal(_text(""), "", "empty → empty")


# ── _normalize_assignment_id ────────────────────────────────────────────────


class TestNormalizeAssignmentId:
    def test_returns_given_id_when_present(self) -> None:
        result = _normalize_assignment_id(
            "_course_1", "HW1", "asg_123", "", None, stable_id=_stable_id,
        )
        _assert_equal(result, "asg_123", "returns explicit assignment_id")

    def test_generates_from_url_when_id_missing(self) -> None:
        result = _normalize_assignment_id(
            "_course_1", "HW1", "", "", "https://bb.example/hw1", stable_id=_stable_id,
        )
        _assert_equal(result, _stable_id("asg", "_course_1", "https://bb.example/hw1"), "generated from url")

    def test_generates_from_title_and_due_when_no_id_or_url(self) -> None:
        result = _normalize_assignment_id(
            "_course_1", "HW1", "", "2026-03-10", None, stable_id=_stable_id,
        )
        _assert_equal(
            result,
            _stable_id("asg", "_course_1", "HW1", "2026-03-10"),
            "generated from title + due_date",
        )

    def test_url_takes_priority_over_title_due(self) -> None:
        result = _normalize_assignment_id(
            "_course_1", "HW1", "", "2026-03-10", "https://bb.example/hw1",
            stable_id=_stable_id,
        )
        _assert_equal(
            result,
            _stable_id("asg", "_course_1", "https://bb.example/hw1"),
            "url used when both url and due_date present",
        )


# ── _has_meaningful_value ───────────────────────────────────────────────────


class TestHasMeaningfulValue:
    def test_none_is_not_meaningful(self) -> None:
        _assert_false(_has_meaningful_value(None), "None → False")

    def test_empty_string_is_not_meaningful(self) -> None:
        _assert_false(_has_meaningful_value(""), "empty → False")
        _assert_false(_has_meaningful_value("  "), "whitespace → False")

    def test_non_empty_string_is_meaningful(self) -> None:
        _assert_true(_has_meaningful_value("hello"), "non-empty → True")

    def test_empty_list_is_not_meaningful(self) -> None:
        _assert_false(_has_meaningful_value([]), "[] → False")

    def test_non_empty_list_is_meaningful(self) -> None:
        _assert_true(_has_meaningful_value([1, 2]), "[1,2] → True")

    def test_empty_dict_is_not_meaningful(self) -> None:
        _assert_false(_has_meaningful_value({}), "{} → False")

    def test_non_empty_dict_is_meaningful(self) -> None:
        _assert_true(_has_meaningful_value({"a": 1}), "{a:1} → True")

    def test_zero_is_meaningful(self) -> None:
        _assert_true(_has_meaningful_value(0), "0 → True")

    def test_false_is_meaningful(self) -> None:
        _assert_true(_has_meaningful_value(False), "False → True")


# ── _assignment_record_score ────────────────────────────────────────────────


class TestAssignmentRecordScore:
    def test_empty_record_scores_low(self) -> None:
        score = _assignment_record_score({})
        _assert_equal(score[0], 0, "description_html=0")
        _assert_equal(score[1], 0, "description=0")
        _assert_equal(score[2], 0, "attachments_json=0")
        _assert_equal(score[6], 0, "start_time=0")
        _assert_equal(score[8], 0, "url has /webapps/assignment/")
        _assert_equal(score[10], "", "assignment_id empty")

    def test_rich_record_scores_high(self) -> None:
        score = _assignment_record_score({
            "description_html": "<p>desc</p>",
            "description": "text desc",
            "attachments_json": '[{"name":"f.pdf"}]',
            "submission_status": "已提交",
            "status": "graded",
            "due_date": "2026-03-10",
            "url": "https://bb.example/webapps/assignment/123",
            "source_page": "content_id=abc",
            "assignment_id": "asg_123",
        })
        _assert_equal(score[0], 1, "description_html=1")
        _assert_equal(score[1], 1, "description=1")
        _assert_equal(score[2], 1, "attachments_json=1")
        _assert_equal(score[3], 1, "submission_status=1")
        _assert_equal(score[4], 1, "status=1")
        _assert_equal(score[5], 1, "due_date=1")
        _assert_equal(score[6], 0, "start_time=0")
        _assert_equal(score[7], 0, "end_time=0")
        _assert_equal(score[8], 1, "url has /webapps/assignment/")
        _assert_equal(score[9], 1, "url has content_id=")
        _assert_equal(score[10], "asg_123", "assignment_id correct")


# ── _deserialize_assignment_attachments_json ────────────────────────────────


class TestDeserializeAssignmentAttachmentsJson:
    def test_deserializes_valid_json_list(self) -> None:
        result = _deserialize_assignment_attachments_json(
            '[{"name": "a.pdf"}, {"name": "b.pdf"}]'
        )
        _assert_equal(len(result), 2, "two items")
        _assert_equal(result[0]["name"], "a.pdf", "first item correct")

    def test_empty_string_returns_empty_list(self) -> None:
        _assert_equal(_deserialize_assignment_attachments_json(""), [], "empty → []")

    def test_invalid_json_returns_empty_list(self) -> None:
        _assert_equal(_deserialize_assignment_attachments_json("{bad"), [], "invalid → []")

    def test_non_list_json_returns_empty_list(self) -> None:
        _assert_equal(_deserialize_assignment_attachments_json('{"key":"value"}'), [], "dict → []")

    def test_filters_non_dict_items(self) -> None:
        result = _deserialize_assignment_attachments_json(
            '[{"name":"a"}, "plain string", 42, {"name":"b"}]'
        )
        _assert_equal(len(result), 2, "only dicts kept")


# ── _merge_assignment_attachment_rows ───────────────────────────────────────


class TestMergeAssignmentAttachmentRows:
    def test_merges_multiple_groups(self) -> None:
        group_a = [{"url": "u1", "name": "a.pdf"}]
        group_b = [{"url": "u2", "name": "b.pdf"}]
        merged = _merge_assignment_attachment_rows(group_a, group_b)
        _assert_equal(len(merged), 2, "two merged rows")

    def test_deduplicates_by_key(self) -> None:
        row = {"url": "u1", "name": "a.pdf", "resource_id": "res_1"}
        merged = _merge_assignment_attachment_rows([row], [row])
        _assert_equal(len(merged), 1, "duplicate removed")

    def test_skips_empty_dedupe_key(self) -> None:
        merged = _merge_assignment_attachment_rows([{"url": "", "name": "", "resource_id": ""}])
        _assert_equal(len(merged), 0, "empty key skipped")

    def test_uses_title_fallback_for_name(self) -> None:
        merged = _merge_assignment_attachment_rows([
            {"url": "u1", "title": "doc.txt", "resource_id": "r1"}
        ])
        _assert_equal(merged[0]["name"], "doc.txt", "title used as name fallback")


# ── _merge_assignment_records_by_assignment_id ──────────────────────────────


class TestMergeAssignmentRecordsByAssignmentId:
    def test_deduplicates_same_assignment_id(self) -> None:
        records = [
            {"assignment_id": "asg_1", "title": "HW1", "description": "desc", "due_date": "2026-03-10", "url": ""},
            {"assignment_id": "asg_1", "title": "HW1", "description_html": "<p>desc</p>", "due_date": "", "url": ""},
        ]
        merged, _ = _merge_assignment_records_by_assignment_id(records, {})
        _assert_equal(len(merged), 1, "deduped to one record")

    def test_merged_record_has_best_fields(self) -> None:
        records = [
            {"assignment_id": "asg_1", "title": "HW1", "description": "desc", "due_date": "2026-03-10", "url": ""},
            {"assignment_id": "asg_1", "title": "HW1", "description_html": "<p>desc</p>", "due_date": "", "url": ""},
        ]
        merged, _ = _merge_assignment_records_by_assignment_id(records, {})
        _assert_equal(merged[0]["description"], "desc", "description preserved")
        _assert_equal(merged[0]["description_html"], "<p>desc</p>", "description_html filled")
        _assert_equal(merged[0]["due_date"], "2026-03-10", "due_date preserved")

    def test_keeps_different_assignment_ids_separate(self) -> None:
        records = [
            {"assignment_id": "asg_1", "title": "HW1", "description": "desc1", "due_date": "", "url": ""},
            {"assignment_id": "asg_2", "title": "HW1", "description": "desc2", "due_date": "", "url": ""},
        ]
        merged, _ = _merge_assignment_records_by_assignment_id(records, {})
        _assert_equal(len(merged), 2, "two distinct assignments kept separate")

    def test_skips_records_without_assignment_id(self) -> None:
        records = [
            {"assignment_id": "", "title": "HW1", "description": "", "due_date": "", "url": ""},
            {"assignment_id": "asg_1", "title": "HW1", "description": "desc", "due_date": "", "url": ""},
        ]
        merged, _ = _merge_assignment_records_by_assignment_id(records, {})
        _assert_equal(len(merged), 1, "only record with id kept")

    def test_empty_input(self) -> None:
        merged, attachments = _merge_assignment_records_by_assignment_id([], {})
        _assert_equal(len(merged), 0, "empty input → empty output")
        _assert_equal(len(attachments), 0, "no attachments")


# ── _normalize_assignment_attachments ───────────────────────────────────────


class TestNormalizeAssignmentAttachments:
    def test_handles_list_of_dicts(self) -> None:
        json_str, rows = _normalize_assignment_attachments([
            {"name": "a.pdf", "url": "u1"},
        ])
        _assert_true(json_str is not None, "json_str returned")
        _assert_equal(len(rows), 1, "one row returned")

    def test_handles_non_list(self) -> None:
        json_str, rows = _normalize_assignment_attachments("not a list")
        _assert_true(json_str is None, "non-list → None json")
        _assert_equal(len(rows), 0, "non-list → empty rows")

    def test_filters_non_dict_items(self) -> None:
        json_str, rows = _normalize_assignment_attachments([
            {"name": "a.pdf"}, "bad", 42,
        ])
        _assert_equal(len(rows), 1, "only dict kept")


# ── _normalize_assignment_record ────────────────────────────────────────────


class TestNormalizeAssignmentRecord:
    def test_normalizes_basic_assignment(self) -> None:
        record, batch = _normalize_assignment_record(
            "_course_1",
            {"title": "HW1", "url": "https://bb.example/hw1", "assignment_id": "asg_1"},
            normalize_url=_mock_normalize_url,
            stable_id=_stable_id,
            parse_total_score=_mock_parse_total_score,
            parse_datetime=_mock_parse_datetime,
        )
        assert record is not None
        _assert_equal(record["course_id"], "_course_1", "course_id set")
        _assert_equal(record["assignment_id"], "asg_1", "assignment_id set")
        _assert_equal(record["title"], "HW1", "title set")
        _assert_equal(record["url"], "https://bb.example/hw1", "url set")

    def test_rejects_record_without_title(self) -> None:
        record, batch = _normalize_assignment_record(
            "_course_1",
            {"title": "", "url": "https://bb.example/hw1"},
            normalize_url=_mock_normalize_url,
            stable_id=_stable_id,
            parse_total_score=_mock_parse_total_score,
            parse_datetime=_mock_parse_datetime,
        )
        _assert_true(record is None, "no title → None")
        _assert_true(batch is None, "batch None for no title")

    def test_generates_bb_url_when_no_real_url(self) -> None:
        record, batch = _normalize_assignment_record(
            "_course_1",
            {"title": "HW1", "assignment_id": "asg_1"},
            normalize_url=_mock_normalize_url,
            stable_id=_stable_id,
            parse_total_score=_mock_parse_total_score,
            parse_datetime=_mock_parse_datetime,
        )
        assert record is not None
        _assert_true(
            str(record["url"]).startswith("bb://assignment/"),
            "generated bb:// url",
        )

    def test_has_attachments(self) -> None:
        record, batch = _normalize_assignment_record(
            "_course_1",
            {
                "title": "HW1",
                "url": "https://bb.example/hw1",
                "assignment_id": "asg_1",
                "attachments": [{"name": "a.pdf", "url": "u1"}],
            },
            normalize_url=_mock_normalize_url,
            stable_id=_stable_id,
            parse_total_score=_mock_parse_total_score,
            parse_datetime=_mock_parse_datetime,
        )
        assert record is not None
        _assert_true(record["attachments_json"] is not None, "attachments_json set")
        _assert_true(batch is not None, "batch returned for attachments")

    def test_no_attachments(self) -> None:
        record, batch = _normalize_assignment_record(
            "_course_1",
            {
                "title": "HW1",
                "url": "https://bb.example/hw1",
                "assignment_id": "asg_1",
                "attachments": [],
            },
            normalize_url=_mock_normalize_url,
            stable_id=_stable_id,
            parse_total_score=_mock_parse_total_score,
            parse_datetime=_mock_parse_datetime,
        )
        assert record is not None
        _assert_true(batch is None, "empty attachments → batch None")


# ── _normalize_resource_parent_id ───────────────────────────────────────────


class TestNormalizeResourceParentId:
    def test_returns_none_for_self_reference(self) -> None:
        result = _normalize_resource_parent_id("res_abc", "res_abc")
        _assert_true(result is None, "self-reference → None")

    def test_returns_trimmed_parent_id(self) -> None:
        result = _normalize_resource_parent_id("  res_parent  ", "res_child")
        _assert_equal(result, "res_parent", "trimmed parent_id")

    def test_returns_none_for_empty(self) -> None:
        result = _normalize_resource_parent_id("", "res_child")
        _assert_true(result is None, "empty → None")


# ── _normalize_resource_record ──────────────────────────────────────────────


class TestNormalizeResourceRecord:
    def test_normalizes_basic_resource(self) -> None:
        record, parent = _normalize_resource_record(
            "_course_1",
            {"title": "lecture1.pdf", "download_url": "https://bb.example/dl"},
            normalize_url=_mock_normalize_url,
            stable_id=_stable_id,
        )
        assert record is not None
        _assert_equal(record["course_id"], "_course_1", "course_id set")
        _assert_equal(record["title"], "lecture1.pdf", "title set")

    def test_uses_name_as_title_fallback(self) -> None:
        record, parent = _normalize_resource_record(
            "_course_1",
            {"name": "lecture2.pdf", "download_url": "https://bb.example/dl"},
            normalize_url=_mock_normalize_url,
            stable_id=_stable_id,
        )
        assert record is not None
        _assert_equal(record["title"], "lecture2.pdf", "name used as title")

    def test_rejects_empty_title(self) -> None:
        record, parent = _normalize_resource_record(
            "_course_1",
            {"title": "", "name": "", "download_url": "https://bb.example/dl"},
            normalize_url=_mock_normalize_url,
            stable_id=_stable_id,
        )
        _assert_true(record is None, "empty title → None")

    def test_generates_bb_url_when_no_real_url(self) -> None:
        record, parent = _normalize_resource_record(
            "_course_1",
            {"title": "lecture1.pdf", "url": ""},
            normalize_url=_mock_normalize_url,
            stable_id=_stable_id,
        )
        assert record is not None
        _assert_true(
            str(record["url"]).startswith("bb://resource/"),
            "generated bb:// url",
        )

    def test_with_parent_id(self) -> None:
        record, parent = _normalize_resource_record(
            "_course_1",
            {"title": "child.pdf", "download_url": "u1", "parent_id": "res_parent", "resource_id": "res_child"},
            normalize_url=_mock_normalize_url,
            stable_id=_stable_id,
        )
        assert record is not None
        _assert_true(parent is not None, "parent tuple returned")
        _assert_equal(parent[0], "res_child", "child id")
        _assert_equal(parent[1], "res_parent", "parent id")


# ── _normalize_grade_id ─────────────────────────────────────────────────────


class TestNormalizeGradeId:
    def test_returns_given_id(self) -> None:
        result = _normalize_grade_id(
            "_course_1", "HW1", "grd_123", "", "", "category1", stable_id=_stable_id,
        )
        _assert_equal(result, "grd_123", "returns explicit grade_id")

    def test_generates_when_no_id(self) -> None:
        result = _normalize_grade_id(
            "_course_1", "HW1", "", "2026-03-10", "2026-04-01", "exam",
            stable_id=_stable_id,
        )
        _assert_equal(
            result,
            _stable_id("grd", "_course_1", "HW1", "2026-03-10", "exam"),
            "generated from components",
        )

    def test_falls_back_to_graded_date(self) -> None:
        result = _normalize_grade_id(
            "_course_1", "HW1", "", "", "2026-04-01", "exam",
            stable_id=_stable_id,
        )
        _assert_equal(
            result,
            _stable_id("grd", "_course_1", "HW1", "2026-04-01", "exam"),
            "graded_date used when due_date empty",
        )

    def test_empty_category(self) -> None:
        result = _normalize_grade_id(
            "_course_1", "HW1", "", "", "", None, stable_id=_stable_id,
        )
        _assert_equal(
            result,
            _stable_id("grd", "_course_1", "HW1", "", ""),
            "empty category → empty component",
        )


# ── _derive_max_score ───────────────────────────────────────────────────────


class TestDeriveMaxScore:
    def test_returns_max_score_when_set(self) -> None:
        result = _derive_max_score("100", 95.0)
        _assert_equal(result, 95.0, "returns existing max_score")

    def test_derives_from_total_score(self) -> None:
        result = _derive_max_score("100", None)
        _assert_equal(result, 100.0, "derived from total_score")

    def test_none_total_score(self) -> None:
        result = _derive_max_score(None, None)
        _assert_true(result is None, "None total_score → None")

    def test_empty_total_score(self) -> None:
        result = _derive_max_score("", None)
        _assert_true(result is None, "empty total_score → None")

    def test_invalid_total_score(self) -> None:
        result = _derive_max_score("nope", None)
        _assert_true(result is None, "invalid total_score → None")


# ── _normalize_grade_assignment_id ──────────────────────────────────────────


class TestNormalizeGradeAssignmentId:
    def test_returns_id_when_in_existing_set(self) -> None:
        result = _normalize_grade_assignment_id(
            "_course_1",
            {"assignment_id": "asg_1"},
            grade_id="grd_1",
            item_name="HW1",
            existing_assignment_ids={"asg_1", "asg_2"},
            logger=None,
        )
        _assert_equal(result, "asg_1", "known id returned")

    def test_returns_none_when_not_in_existing_set(self) -> None:
        result = _normalize_grade_assignment_id(
            "_course_1",
            {"assignment_id": "asg_unknown"},
            grade_id="grd_1",
            item_name="HW1",
            existing_assignment_ids={"asg_1"},
            logger=None,
        )
        _assert_true(result is None, "unknown id → None")

    def test_empty_assignment_id(self) -> None:
        result = _normalize_grade_assignment_id(
            "_course_1",
            {"assignment_id": ""},
            grade_id="grd_1",
            item_name="HW1",
            existing_assignment_ids=set(),
            logger=None,
        )
        _assert_true(result is None, "empty id → None")


# ── _normalize_grade_record ─────────────────────────────────────────────────


class TestNormalizeGradeRecord:
    def test_normalizes_basic_grade(self) -> None:
        record = _normalize_grade_record(
            "_course_1",
            {"item_name": "HW1", "grade_id": "grd_1", "score": "95/100", "due_date": "2026-03-10"},
            stable_id=_stable_id,
            parse_total_score=_mock_parse_total_score,
            parse_score_metrics=_mock_parse_score_metrics,
            parse_datetime=_mock_parse_datetime,
            to_float=_mock_to_float,
            existing_assignment_ids=set(),
            logger=None,
        )
        assert record is not None
        _assert_equal(record["course_id"], "_course_1", "course_id set")
        _assert_equal(record["grade_id"], "grd_1", "grade_id set")
        _assert_equal(record["item_name"], "HW1", "item_name set")

    def test_rejects_empty_item_name(self) -> None:
        record = _normalize_grade_record(
            "_course_1",
            {"item_name": ""},
            stable_id=_stable_id,
            parse_total_score=_mock_parse_total_score,
            parse_score_metrics=_mock_parse_score_metrics,
            parse_datetime=_mock_parse_datetime,
            to_float=_mock_to_float,
            existing_assignment_ids=set(),
            logger=None,
        )
        _assert_true(record is None, "empty name → None")

    def test_uses_name_fallback(self) -> None:
        record = _normalize_grade_record(
            "_course_1",
            {"name": "HW1", "grade_id": "grd_1"},
            stable_id=_stable_id,
            parse_total_score=_mock_parse_total_score,
            parse_score_metrics=_mock_parse_score_metrics,
            parse_datetime=_mock_parse_datetime,
            to_float=_mock_to_float,
            existing_assignment_ids=set(),
            logger=None,
        )
        assert record is not None
        _assert_equal(record["item_name"], "HW1", "name fallback")

    def test_set_defaults(self) -> None:
        record = _normalize_grade_record(
            "_course_1",
            {"name": "HW1", "grade_id": "grd_1"},
            stable_id=_stable_id,
            parse_total_score=_mock_parse_total_score,
            parse_score_metrics=_mock_parse_score_metrics,
            parse_datetime=_mock_parse_datetime,
            to_float=_mock_to_float,
            existing_assignment_ids=set(),
            logger=None,
        )
        assert record is not None
        _assert_equal(record["is_counted"], True, "is_counted default True")
        _assert_true(record["score_numeric"] is None, "score_numeric None when no score")


# ── _normalize_announcement_record ──────────────────────────────────────────


class TestNormalizeAnnouncementRecord:
    def test_normalizes_basic_announcement(self) -> None:
        record = _normalize_announcement_record(
            {
                "title": "New Assignment",
                "course_id": "_course_1",
                "course_name": "CS305",
                "publish_time": "2026-03-10 12:00",
                "url": "https://bb.example/ann/1",
                "announcement_id": "ann_1",
            },
            normalize_url=_mock_normalize_url,
            parse_datetime=_mock_parse_datetime,
            stable_id=_stable_id,
        )
        assert record is not None
        _assert_equal(record["title"], "New Assignment", "title")
        _assert_equal(record["course_id"], "_course_1", "course_id")
        _assert_equal(record["announcement_id"], "ann_1", "announcement_id")

    def test_rejects_empty_title(self) -> None:
        record = _normalize_announcement_record(
            {"title": ""},
            normalize_url=_mock_normalize_url,
            parse_datetime=_mock_parse_datetime,
            stable_id=_stable_id,
        )
        _assert_true(record is None, "empty title → None")

    def test_generates_announcement_id_when_missing(self) -> None:
        record = _normalize_announcement_record(
            {"title": "News", "course_id": "_course_1"},
            normalize_url=_mock_normalize_url,
            parse_datetime=_mock_parse_datetime,
            stable_id=_stable_id,
        )
        assert record is not None
        _assert_true(len(str(record["announcement_id"])) > 0, "generated announcement_id")

    def test_uses_posted_date_as_publish_time_fallback(self) -> None:
        record = _normalize_announcement_record(
            {
                "title": "News",
                "course_id": "_course_1",
                "posted_date": "2026-03-10 12:00",
                "announcement_id": "ann_1",
            },
            normalize_url=_mock_normalize_url,
            parse_datetime=_mock_parse_datetime,
            stable_id=_stable_id,
        )
        assert record is not None
        _assert_true(record["posted_at"] is not None, "posted_at parsed")

    def test_content_detail_fallback(self) -> None:
        record = _normalize_announcement_record(
            {
                "title": "News",
                "course_id": "_course_1",
                "announcement_id": "ann_1",
                "detail": "Some content",
                "detail_html": "<p>Content</p>",
            },
            normalize_url=_mock_normalize_url,
            parse_datetime=_mock_parse_datetime,
            stable_id=_stable_id,
        )
        assert record is not None
        _assert_equal(record["content"], "Some content", "detail → content")
        _assert_equal(record["content_html"], "<p>Content</p>", "detail_html → content_html")


# ── _normalize_announcement_assignment_link_record ──────────────────────────


class TestNormalizeAnnouncementAssignmentLinkRecord:
    def test_normalizes_basic_link(self) -> None:
        record = _normalize_announcement_assignment_link_record({
            "announcement_id": "ann_1",
            "assignment_id": "asg_1",
            "course_id": "_course_1",
        })
        assert record is not None
        _assert_equal(record["announcement_id"], "ann_1", "announcement_id")
        _assert_equal(record["assignment_id"], "asg_1", "assignment_id")
        _assert_equal(record["link_source"], "content_id_match", "default link_source")
        _assert_equal(record["confidence"], "medium", "default confidence")

    def test_rejects_missing_announcement_id(self) -> None:
        record = _normalize_announcement_assignment_link_record({
            "announcement_id": "",
            "assignment_id": "asg_1",
            "course_id": "_course_1",
        })
        _assert_true(record is None, "missing announcement_id → None")

    def test_rejects_missing_assignment_id(self) -> None:
        record = _normalize_announcement_assignment_link_record({
            "announcement_id": "ann_1",
            "assignment_id": "",
            "course_id": "_course_1",
        })
        _assert_true(record is None, "missing assignment_id → None")

    def test_rejects_missing_course_id(self) -> None:
        record = _normalize_announcement_assignment_link_record({
            "announcement_id": "ann_1",
            "assignment_id": "asg_1",
            "course_id": "",
        })
        _assert_true(record is None, "missing course_id → None")

    def test_custom_link_source(self) -> None:
        record = _normalize_announcement_assignment_link_record({
            "announcement_id": "ann_1",
            "assignment_id": "asg_1",
            "course_id": "_course_1",
            "link_source": "title_match",
            "confidence": "high",
        })
        assert record is not None
        _assert_equal(record["link_source"], "title_match", "custom link_source")
        _assert_equal(record["confidence"], "high", "custom confidence")

    def test_serializes_evidence_json(self) -> None:
        record = _normalize_announcement_assignment_link_record({
            "announcement_id": "ann_1",
            "assignment_id": "asg_1",
            "course_id": "_course_1",
            "evidence_json": {"score": 0.95},
        })
        assert record is not None
        _assert_true(isinstance(record["evidence_json"], str), "evidence serialized to string")
        _assert_true("0.95" in str(record["evidence_json"]), "score present")


# ── _normalize_calendar_event_record ────────────────────────────────────────


class TestNormalizeCalendarEventRecord:
    def test_normalizes_basic_event(self) -> None:
        start = datetime(2026, 3, 10, 9, 0)
        record = _normalize_calendar_event_record(
            "https://bb.example/ics",
            {"uid": "evt_1", "title": "Lecture", "start_at": start},
        )
        assert record is not None
        _assert_equal(record["feed_url"], "https://bb.example/ics", "feed_url")
        _assert_equal(record["uid"], "evt_1", "uid")
        _assert_equal(record["title"], "Lecture", "title")
        _assert_equal(record["start_at"], start, "start_at")

    def test_rejects_missing_uid(self) -> None:
        record = _normalize_calendar_event_record(
            "https://bb.example/ics",
            {"uid": "", "title": "Lecture", "start_at": datetime(2026, 3, 10)},
        )
        _assert_true(record is None, "empty uid → None")

    def test_rejects_missing_title(self) -> None:
        record = _normalize_calendar_event_record(
            "https://bb.example/ics",
            {"uid": "evt_1", "title": "", "start_at": datetime(2026, 3, 10)},
        )
        _assert_true(record is None, "empty title → None")

    def test_rejects_none_start_at(self) -> None:
        record = _normalize_calendar_event_record(
            "https://bb.example/ics",
            {"uid": "evt_1", "title": "Lecture", "start_at": None},
        )
        _assert_true(record is None, "None start_at → None")

    def test_all_day_default_false(self) -> None:
        start = datetime(2026, 3, 10, 9, 0)
        record = _normalize_calendar_event_record(
            "https://bb.example/ics",
            {"uid": "evt_1", "title": "Lecture", "start_at": start},
        )
        assert record is not None
        _assert_equal(record["all_day"], False, "all_day default False")

    def test_all_day_explicit(self) -> None:
        start = datetime(2026, 3, 10, 9, 0)
        record = _normalize_calendar_event_record(
            "https://bb.example/ics",
            {"uid": "evt_1", "title": "Lecture", "start_at": start, "all_day": True},
        )
        assert record is not None
        _assert_equal(record["all_day"], True, "all_day True")

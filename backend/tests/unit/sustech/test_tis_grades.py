from __future__ import annotations

from unittest.mock import MagicMock

import httpx

from app.integrations.sustech.teaching_information_system.api.dto import (
    TISGradeRecord,
    TISHomepageProfile,
    TISMenuEntry,
    TISProbeResult,
)
from app.integrations.sustech.teaching_information_system.api.grades import (
    _build_real_grade_query_payload,
    _build_tis_probe_result,
    _dedupe_grade_records,
    _dedupe_preserve_order,
    _extract_grade_json_debug_payload,
    _first_non_empty,
    _merge_probe_records,
    _normalize_candidate_url,
    _pick_by_header_tokens,
    build_grade_candidate_urls,
    extract_grade_records_from_html,
    extract_grade_records_from_json,
)


# ---------------------------------------------------------------------------
# Test helpers
# ---------------------------------------------------------------------------

def _make_response(
    *,
    url: str = "https://tis.sustech.edu.cn/cjgl/grcjcx/grcjcx",
    method: str = "GET",
    status_code: int = 200,
    content_type: str = "application/json",
    text: str = "",
    json_payload: object = None,
    history: list[httpx.Response] | None = None,
    request_headers: dict[str, str] | None = None,
) -> httpx.Response:
    request = MagicMock(spec=httpx.Request)
    if request_headers:
        request.headers = httpx.Headers(request_headers)
    else:
        request.headers = httpx.Headers()
    request.method = method
    request.url = httpx.URL(url)

    response = MagicMock(spec=httpx.Response)
    response.status_code = status_code
    response.request = request
    response.url = httpx.URL(url)
    response.history = history or []
    headers = MagicMock()
    headers.get.return_value = content_type
    response.headers = headers
    response.text = text
    if json_payload is not None:
        response.json.return_value = json_payload
    else:
        response.json.side_effect = Exception("not json")
    return response


# ---------------------------------------------------------------------------
# _first_non_empty
# ---------------------------------------------------------------------------

class TestFirstNonEmpty:
    def test_finds_exact_key_match(self) -> None:
        mapping = {"courseName": "高等数学", "score": "90"}
        result = _first_non_empty(mapping, ("courseName",))
        assert result == "高等数学"

    def test_finds_case_insensitive_match(self) -> None:
        mapping = {"CourseName": "线性代数"}
        result = _first_non_empty(mapping, ("courseName",))
        assert result == "线性代数"

    def test_skips_empty_string(self) -> None:
        mapping = {"courseName": "", "kcmc": "大学物理"}
        result = _first_non_empty(mapping, ("courseName", "kcmc"))
        assert result == "大学物理"

    def test_skips_none_value(self) -> None:
        mapping = {"courseName": None, "kcmc": "C语言"}
        result = _first_non_empty(mapping, ("courseName", "kcmc"))
        assert result == "C语言"

    def test_candidate_not_in_mapping_returns_none(self) -> None:
        result = _first_non_empty({"a": "1"}, ("b", "c"))
        assert result is None

    def test_whitespace_only_value_treated_as_empty(self) -> None:
        mapping = {"courseName": "   ", "kcmc": "物理"}
        result = _first_non_empty(mapping, ("courseName", "kcmc"))
        assert result == "物理"

    def test_empty_mapping_returns_none(self) -> None:
        result = _first_non_empty({}, ("courseName",))
        assert result is None


# ---------------------------------------------------------------------------
# _pick_by_header_tokens
# ---------------------------------------------------------------------------

class TestPickByHeaderTokens:
    def test_matches_single_token(self) -> None:
        mapping = {"课程名称": "高等数学"}
        result = _pick_by_header_tokens(mapping, ("课程",))
        assert result == "高等数学"

    def test_matches_case_insensitive(self) -> None:
        mapping = {"Course Name": "Physics"}
        result = _pick_by_header_tokens(mapping, ("course",))
        assert result == "Physics"

    def test_returns_first_match(self) -> None:
        mapping = {"课程名称": "A", "课程代码": "B"}
        result = _pick_by_header_tokens(mapping, ("课程", "name"))
        assert result in ("A", "B")

    def test_no_match_returns_none(self) -> None:
        mapping = {"abc": "123"}
        result = _pick_by_header_tokens(mapping, ("课程", "score"))
        assert result is None

    def test_skips_empty_values(self) -> None:
        mapping = {"课程名称": "", "课程代码": "CS101"}
        result = _pick_by_header_tokens(mapping, ("课程",))
        assert result == "CS101"


# ---------------------------------------------------------------------------
# _dedupe_preserve_order
# ---------------------------------------------------------------------------

class TestDedupePreserveOrder:
    def test_empty_list(self) -> None:
        assert _dedupe_preserve_order([]) == []

    def test_no_duplicates_unchanged(self) -> None:
        assert _dedupe_preserve_order(["a", "b", "c"]) == ["a", "b", "c"]

    def test_removes_duplicates_preserves_order(self) -> None:
        assert _dedupe_preserve_order(["a", "b", "a", "c", "b"]) == ["a", "b", "c"]

    def test_filters_empty_strings(self) -> None:
        assert _dedupe_preserve_order(["", "a", "", "b"]) == ["a", "b"]

    def test_filters_whitespace_only(self) -> None:
        assert _dedupe_preserve_order(["a", "   ", "b"]) == ["a", "b"]

    def test_normalizes_whitespace_before_dedup(self) -> None:
        assert _dedupe_preserve_order(["  a  ", "a", "b"]) == ["a", "b"]


# ---------------------------------------------------------------------------
# _dedupe_grade_records
# ---------------------------------------------------------------------------

class TestDedupeGradeRecords:
    def test_empty_list(self) -> None:
        assert _dedupe_grade_records([]) == []

    def test_unique_records_unchanged(self) -> None:
        r1 = TISGradeRecord(course_name="A", score="90")
        r2 = TISGradeRecord(course_name="B", score="80")
        result = _dedupe_grade_records([r1, r2])
        assert len(result) == 2

    def test_removes_exact_duplicates(self) -> None:
        r1 = TISGradeRecord(course_name="A", score="90", course_code="CS101", term="2024春")
        r2 = TISGradeRecord(course_name="A", score="90", course_code="CS101", term="2024春")
        result = _dedupe_grade_records([r1, r2])
        assert len(result) == 1

    def test_different_score_not_duplicate(self) -> None:
        r1 = TISGradeRecord(course_name="A", score="90", course_code="CS101", term="2024春")
        r2 = TISGradeRecord(course_name="A", score="85", course_code="CS101", term="2024春")
        result = _dedupe_grade_records([r1, r2])
        assert len(result) == 2

    def test_different_term_not_duplicate(self) -> None:
        r1 = TISGradeRecord(course_name="A", score="90", course_code="CS101", term="2024春")
        r2 = TISGradeRecord(course_name="A", score="90", course_code="CS101", term="2024秋")
        result = _dedupe_grade_records([r1, r2])
        assert len(result) == 2


# ---------------------------------------------------------------------------
# _merge_probe_records
# ---------------------------------------------------------------------------

class TestMergeProbeRecords:
    def test_empty_probes(self) -> None:
        assert _merge_probe_records([]) == []

    def test_merges_and_dedupes(self) -> None:
        r1 = TISGradeRecord(course_name="A", score="90")
        r2 = TISGradeRecord(course_name="B", score="80")
        r3 = TISGradeRecord(course_name="A", score="90")  # duplicate
        p1 = TISProbeResult(
            url="url1",
            method="GET",
            status_code=200,
            grade_records=[r1, r2],
        )
        p2 = TISProbeResult(
            url="url2",
            method="GET",
            status_code=200,
            grade_records=[r3],
        )
        result = _merge_probe_records([p1, p2])
        assert len(result) == 2


# ---------------------------------------------------------------------------
# _normalize_candidate_url
# ---------------------------------------------------------------------------

class TestNormalizeCandidateUrl:
    def test_absolute_url_preserved(self) -> None:
        result = _normalize_candidate_url(
            "https://tis.sustech.edu.cn/grades",
            page_url="http://x.com/p",
            base_url="https://tis.sustech.edu.cn",
        )
        assert result == "https://tis.sustech.edu.cn/grades"

    def test_root_relative_url_joined_to_base(self) -> None:
        result = _normalize_candidate_url(
            "/cjgl/grcjcx/go/1",
            page_url="http://x.com/p",
            base_url="https://tis.sustech.edu.cn",
        )
        assert result == "https://tis.sustech.edu.cn/cjgl/grcjcx/go/1"

    def test_relative_url_joined_to_page(self) -> None:
        result = _normalize_candidate_url(
            "grcjcx/go/1",
            page_url="https://tis.sustech.edu.cn/cjgl/",
            base_url="https://tis.sustech.edu.cn",
        )
        assert result == "https://tis.sustech.edu.cn/cjgl/grcjcx/go/1"

    def test_javascript_url_returns_none(self) -> None:
        result = _normalize_candidate_url(
            "javascript:void(0)",
            page_url="http://x.com/p",
            base_url="https://tis.sustech.edu.cn",
        )
        assert result is None

    def test_empty_text_returns_none(self) -> None:
        result = _normalize_candidate_url(
            "",
            page_url="http://x.com/p",
            base_url="https://tis.sustech.edu.cn",
        )
        assert result is None

    def test_simple_identifier_returns_none(self) -> None:
        result = _normalize_candidate_url(
            "justText",
            page_url="http://x.com/p",
            base_url="https://tis.sustech.edu.cn",
        )
        assert result is None


# ---------------------------------------------------------------------------
# build_grade_candidate_urls
# ---------------------------------------------------------------------------

class TestBuildGradeCandidateUrls:
    def test_builds_default_candidates(self) -> None:
        homepage = TISHomepageProfile(page_url="https://tis.sustech.edu.cn/student_index")
        urls = build_grade_candidate_urls(homepage)
        assert len(urls) > 0
        for url in urls:
            assert url.startswith("https://tis.sustech.edu.cn")

    def test_includes_grade_related_endpoints(self) -> None:
        homepage = TISHomepageProfile(
            page_url="https://tis.sustech.edu.cn/student_index",
            grade_related_endpoints=["/custom/grade/page"],
        )
        urls = build_grade_candidate_urls(homepage)
        assert any("custom/grade/page" in u for u in urls)

    def test_includes_menu_entries_with_grade_keywords(self) -> None:
        homepage = TISHomepageProfile(
            page_url="https://tis.sustech.edu.cn/student_index",
            menu_entries=[
                TISMenuEntry(text="成绩查询", href="/cjgl/grcjcx/go/1"),
                TISMenuEntry(text="课表", href="/kb/schedule"),
            ],
        )
        urls = build_grade_candidate_urls(homepage)
        assert any("cjgl/grcjcx/go/1" in u for u in urls)

    def test_filters_non_same_host_urls(self) -> None:
        homepage = TISHomepageProfile(
            page_url="https://tis.sustech.edu.cn/student_index",
            grade_related_endpoints=["https://evil.com/grades"],
        )
        urls = build_grade_candidate_urls(homepage)
        assert not any("evil.com" in u for u in urls)

    def test_deduplicates_urls(self) -> None:
        homepage = TISHomepageProfile(
            page_url="https://tis.sustech.edu.cn/student_index",
            grade_related_endpoints=["/cjgl/grcjcx/go/1"],
        )
        urls = build_grade_candidate_urls(homepage)
        count = sum(1 for u in urls if "cjgl/grcjcx/go/1" in u)
        assert count == 1

    def test_normalized_root_withouth_slash(self) -> None:
        homepage = TISHomepageProfile(
            page_url="https://tis.sustech.edu.cn/student_index",
            grade_related_endpoints=["/custom/grades"],
        )
        urls = build_grade_candidate_urls(homepage)
        assert any("/custom/grades" in u for u in urls)


# ---------------------------------------------------------------------------
# _build_real_grade_query_payload
# ---------------------------------------------------------------------------

class TestBuildRealGradeQueryPayload:
    def test_default_payload(self) -> None:
        payload = _build_real_grade_query_payload()
        assert payload["pylx"] == "1"
        assert payload["current"] == 1
        assert payload["pageSize"] == 20
        assert payload["cxbj"] == "-1"
        assert payload["xn"] is None
        assert payload["xq"] is None

    def test_custom_pylx(self) -> None:
        payload = _build_real_grade_query_payload(pylx="2")
        assert payload["pylx"] == "2"

    def test_custom_pagination(self) -> None:
        payload = _build_real_grade_query_payload(current=3, page_size=50)
        assert payload["current"] == 3
        assert payload["pageSize"] == 50

    def test_empty_pylx_falls_back_to_1(self) -> None:
        payload = _build_real_grade_query_payload(pylx="")
        assert payload["pylx"] == "1"


# ---------------------------------------------------------------------------
# _build_tis_probe_result
# ---------------------------------------------------------------------------

class TestBuildTisProbeResult:
    def test_basic_probe_result(self) -> None:
        response = _make_response(
            url="https://tis.sustech.edu.cn/api/grades",
            method="GET",
            status_code=200,
            text='{"data": []}',
        )
        result = _build_tis_probe_result(response, probe_label="test-probe")
        assert result.url == "https://tis.sustech.edu.cn/api/grades"
        assert result.method == "GET"
        assert result.status_code == 200
        assert result.probe_label == "test-probe"
        assert result.grade_records == []

    def test_json_content_type_detected(self) -> None:
        response = _make_response(content_type="application/json;charset=utf-8")
        result = _build_tis_probe_result(response, probe_label="json-test")
        assert result.is_json is True

    def test_html_content_type_not_json(self) -> None:
        response = _make_response(content_type="text/html")
        result = _build_tis_probe_result(response, probe_label="html-test")
        assert result.is_json is False

    def test_request_payload_keys_included(self) -> None:
        response = _make_response()
        payload = {"xn": None, "xq": None, "pylx": "1", "current": 1}
        result = _build_tis_probe_result(
            response, probe_label="api", request_payload=payload
        )
        assert "current" in result.request_payload_keys
        assert "pylx" in result.request_payload_keys

    def test_record_count_included(self) -> None:
        response = _make_response()
        result = _build_tis_probe_result(response, probe_label="p", record_count=42)
        assert result.record_count == 42

    def test_preview_truncated(self) -> None:
        long_body = "x" * 1000
        response = _make_response(text=long_body, content_type="text/html")
        result = _build_tis_probe_result(response, probe_label="trunc")
        assert result.preview is not None
        assert len(result.preview) <= 500

    def test_redirect_count_from_history(self) -> None:
        hist_resp = _make_response(url="https://tis.sustech.edu.cn/redirect1")
        main_response = _make_response(
            url="https://tis.sustech.edu.cn/final",
            history=[hist_resp],
        )
        result = _build_tis_probe_result(main_response, probe_label="redirect")
        assert result.redirect_count == 1

    def test_request_headers_extracted(self) -> None:
        response = _make_response(
            request_headers={
                "RoleCode": "STUDENT",
                "Referer": "https://tis.sustech.edu.cn/home",
                "Accept": "application/json",
            }
        )
        result = _build_tis_probe_result(response, probe_label="headers-test")
        assert result.request_headers.get("RoleCode") == "STUDENT"
        assert result.request_headers.get("Referer") == "https://tis.sustech.edu.cn/home"

    def test_none_content_type_handled(self) -> None:
        response = _make_response(content_type="")
        result = _build_tis_probe_result(response, probe_label="no-ct")
        assert result.content_type is None


# ---------------------------------------------------------------------------
# _extract_grade_json_debug_payload
# ---------------------------------------------------------------------------

class TestExtractGradeJsonDebugPayload:
    def test_non_dict_returns_type_info(self) -> None:
        result = _extract_grade_json_debug_payload(["a", "list"])
        assert result["payload_type"] == "list"

    def test_dict_with_content_list(self) -> None:
        payload = {
            "content": {
                "list": [
                    {"courseName": "Math", "score": "90", "kcmc": "数学"},
                ]
            }
        }
        result = _extract_grade_json_debug_payload(payload)
        assert result["payload_type"] == "dict"
        assert result["list_length"] == 1
        assert "courseName" in result["sample_record_keys"]

    def test_dict_without_content(self) -> None:
        payload = {"data": [{"a": 1}]}
        result = _extract_grade_json_debug_payload(payload)
        assert result["content_keys"] == []
        assert result["list_length"] is None

    def test_content_not_dict(self) -> None:
        payload = {"content": "string_instead"}
        result = _extract_grade_json_debug_payload(payload)
        assert result["content_keys"] == []

    def test_root_keys_truncated(self) -> None:
        payload = {f"key_{i}": i for i in range(30)}
        result = _extract_grade_json_debug_payload(payload)
        assert len(result["root_keys"]) <= 20


# ---------------------------------------------------------------------------
# extract_grade_records_from_json
# ---------------------------------------------------------------------------

GRADE_JSON_BASIC = {
    "content": {
        "list": [
            {
                "courseName": "高等数学",
                "score": "95",
                "courseCode": "MA101",
                "xnxq": "2023-2024-1",
                "credit": "4",
            },
            {
                "kcmc": "大学物理",
                "cj": "88",
                "kch": "PHY102",
                "xn": "2023-2024",
                "xq": "1",
                "xf": "3",
            },
        ]
    }
}

GRADE_JSON_NESTED = {
    "data": [
        {
            "courseName": "线性代数",
            "score": "A",
            "rows": [
                {
                    "course": "C语言",
                    "grade": "B+",
                }
            ],
        }
    ]
}

GRADE_JSON_NO_GRADES = {"data": [{"foo": "bar", "baz": 123}]}

GRADE_JSON_EMPTY = {}

GRADE_JSON_DUPLICATES = {
    "rows": [
        {"courseName": "数学", "score": "90"},
        {"courseName": "数学", "score": "90"},
        {"courseName": "物理", "score": "85"},
    ]
}


class TestExtractGradeRecordsFromJson:
    def test_extracts_from_content_list(self) -> None:
        records = extract_grade_records_from_json(GRADE_JSON_BASIC)
        assert len(records) == 2
        names = {r.course_name for r in records}
        assert "高等数学" in names
        assert "大学物理" in names

    def test_extracts_course_code(self) -> None:
        records = extract_grade_records_from_json(GRADE_JSON_BASIC)
        codes = {r.course_code for r in records}
        assert "MA101" in codes

    def test_extracts_score(self) -> None:
        records = extract_grade_records_from_json(GRADE_JSON_BASIC)
        scores = {r.score for r in records}
        assert "95" in scores
        assert "88" in scores

    def test_extracts_term(self) -> None:
        records = extract_grade_records_from_json(GRADE_JSON_BASIC)
        terms = {r.term for r in records}
        assert "2023-2024-1" in terms

    def test_extracts_credit(self) -> None:
        records = extract_grade_records_from_json(GRADE_JSON_BASIC)
        credits = {r.credit for r in records}
        assert "4" in credits

    def test_walks_nested_containers(self) -> None:
        records = extract_grade_records_from_json(GRADE_JSON_NESTED)
        names = {r.course_name for r in records}
        assert "线性代数" in names
        assert "C语言" in names

    def test_no_grades_returns_empty(self) -> None:
        records = extract_grade_records_from_json(GRADE_JSON_NO_GRADES)
        assert records == []

    def test_empty_dict_returns_empty(self) -> None:
        records = extract_grade_records_from_json(GRADE_JSON_EMPTY)
        assert records == []

    def test_non_dict_input(self) -> None:
        records = extract_grade_records_from_json(["just", "a", "list"])
        assert records == []

    def test_string_input(self) -> None:
        records = extract_grade_records_from_json("not json")
        assert records == []

    def test_deduplicates_duplicate_records(self) -> None:
        records = extract_grade_records_from_json(GRADE_JSON_DUPLICATES)
        assert len(records) == 2

    def test_bool_score_skipped(self) -> None:
        payload = {"rows": [{"courseName": "Test", "score": True}]}
        records = extract_grade_records_from_json(payload)
        assert len(records) == 0

    def test_raw_data_preserved(self) -> None:
        records = extract_grade_records_from_json(GRADE_JSON_BASIC)
        assert len(records) > 0
        assert "courseName" in records[0].raw


# ---------------------------------------------------------------------------
# extract_grade_records_from_html
# ---------------------------------------------------------------------------

GRADE_HTML_BASIC = """
<table>
  <tr>
    <th>课程名称</th>
    <th>成绩</th>
    <th>学分</th>
    <th>课程代码</th>
    <th>学期</th>
  </tr>
  <tr>
    <td>高等数学</td>
    <td>95</td>
    <td>4</td>
    <td>MA101</td>
    <td>2023-2024-1</td>
  </tr>
  <tr>
    <td>大学物理</td>
    <td>88</td>
    <td>3</td>
    <td>PHY102</td>
    <td>2023-2024-1</td>
  </tr>
</table>
"""

GRADE_HTML_ENGLISH_HEADERS = """
<table>
  <tr>
    <th>Course Name</th>
    <th>Score</th>
    <th>Credits</th>
  </tr>
  <tr>
    <td>Physics</td>
    <td>A</td>
    <td>3</td>
  </tr>
</table>
"""

GRADE_HTML_NO_GRADE_TABLE = """
<table>
  <tr>
    <th>序号</th>
    <th>姓名</th>
    <th>学院</th>
  </tr>
  <tr>
    <td>1</td>
    <td>张三</td>
    <td>计算机系</td>
  </tr>
</table>
"""

GRADE_HTML_EMPTY = ""

GRADE_HTML_MISSING_COURSE_NAME = """
<table>
  <tr>
    <th>成绩</th>
    <th>学分</th>
  </tr>
  <tr>
    <td>90</td>
    <td>4</td>
  </tr>
</table>
"""

GRADE_HTML_MISSING_SCORE = """
<table>
  <tr>
    <th>课程名称</th>
  </tr>
  <tr>
    <td>高等数学</td>
  </tr>
</table>
"""

GRADE_HTML_EXTRA_COLUMNS = """
<table>
  <tr>
    <th>col0</th>
    <th>课程名称</th>
    <th>成绩</th>
    <th>col3</th>
  </tr>
  <tr>
    <td>0</td>
    <td>数据结构</td>
    <td>92</td>
    <td>3</td>
  </tr>
</table>
"""

GRADE_HTML_HEURISTIC_MATCH = """
<table>
  <tr>
    <th>score_col</th>
    <th>name_col</th>
  </tr>
  <tr>
    <td>A+</td>
    <td>编译原理</td>
  </tr>
</table>
"""

GRADE_HTML_DUPLICATE = """
<table>
  <tr>
    <th>课程名称</th>
    <th>成绩</th>
  </tr>
  <tr>
    <td>数学</td>
    <td>90</td>
  </tr>
  <tr>
    <td>数学</td>
    <td>90</td>
  </tr>
</table>
"""


class TestExtractGradeRecordsFromHtml:
    def test_extracts_grade_records_basic(self) -> None:
        records = extract_grade_records_from_html(GRADE_HTML_BASIC)
        assert len(records) == 2
        names = {r.course_name for r in records}
        assert "高等数学" in names
        assert "大学物理" in names

    def test_extracts_from_english_headers(self) -> None:
        records = extract_grade_records_from_html(GRADE_HTML_ENGLISH_HEADERS)
        assert len(records) == 1
        assert records[0].course_name == "Physics"
        assert records[0].score == "A"

    def test_skips_non_grade_table(self) -> None:
        records = extract_grade_records_from_html(GRADE_HTML_NO_GRADE_TABLE)
        assert records == []

    def test_empty_html_returns_empty(self) -> None:
        records = extract_grade_records_from_html(GRADE_HTML_EMPTY)
        assert records == []

    def test_missing_course_name_skipped(self) -> None:
        records = extract_grade_records_from_html(GRADE_HTML_MISSING_COURSE_NAME)
        assert records == []

    def test_missing_score_skipped(self) -> None:
        records = extract_grade_records_from_html(GRADE_HTML_MISSING_SCORE)
        assert records == []

    def test_extra_columns_handled(self) -> None:
        records = extract_grade_records_from_html(GRADE_HTML_EXTRA_COLUMNS)
        assert len(records) == 1
        assert records[0].course_name == "数据结构"
        assert records[0].score == "92"

    def test_heuristic_header_matching(self) -> None:
        records = extract_grade_records_from_html(GRADE_HTML_HEURISTIC_MATCH)
        assert len(records) == 1
        assert records[0].course_name == "编译原理"
        assert records[0].score == "A+"

    def test_deduping(self) -> None:
        records = extract_grade_records_from_html(GRADE_HTML_DUPLICATE)
        assert len(records) == 1

    def test_raw_data_preserved(self) -> None:
        records = extract_grade_records_from_html(GRADE_HTML_BASIC)
        assert len(records) > 0
        assert len(records[0].raw) > 0

    def test_single_row_table_skipped(self) -> None:
        html = "<table><tr><th>课程名称</th><th>成绩</th></tr></table>"
        records = extract_grade_records_from_html(html)
        assert records == []

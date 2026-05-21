from __future__ import annotations

from bs4 import BeautifulSoup

from app.integrations.sustech.teaching_information_system.api.dto import (
    DEFAULT_TIS_SERVICE_CONFIG,
    TISHomepageProfile,
    TISMenuEntry,
)
from app.integrations.sustech.teaching_information_system.api.homepage import (
    _dedupe_menu_entries,
    _dedupe_preserve_order,
    _extract_menu_entries,
    _extract_role_codes,
    analyze_homepage_html,
)


def _assert_equal(actual: object, expected: object, message: str) -> None:
    if actual != expected:
        raise AssertionError(f"{message}: expected={expected!r}, actual={actual!r}")


def _assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


_FAKE_HOMEPAGE_URL = "https://tis.example.edu.cn/student_index"
_FAKE_BASE_URL = "https://tis.example.edu.cn"


def _make_tis_homepage_html(
    *,
    title: str = "教学管理与服务平台",
    extra_head: str = "",
    body_content: str = "",
    scripts: str = "",
) -> str:
    """Build a realistic TIS homepage HTML snippet for tests."""
    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>{title}</title>
{extra_head}
</head>
<body>
<div id="wrapper">
  <div class="header">
    <h1>南方科技大学教学管理系统</h1>
  </div>
  <div class="nav-container">
    <ul class="nav">
      <li><a href="/student_index">首页</a></li>
      <li><a href="/cjgl/grcjcx/go/1">成绩查询</a></li>
      <li><a href="/Xsxk/query/1" onclick="openMenu('/Xsxk/query/1')">选课系统</a></li>
      <li><a href="/kb/studentSchedule" target="_blank">课表查看</a></li>
    </ul>
  </div>
  {body_content}
</div>
<script>
var baseUrl = "{_FAKE_BASE_URL}";
var baseURL = "{_FAKE_BASE_URL}";
</script>
{scripts}
</body>
</html>"""


class TestDedupePreserveOrder:
    def test_empty_iterable(self) -> None:
        _assert_equal(_dedupe_preserve_order([]), [], "empty → empty")

    def test_no_duplicates(self) -> None:
        _assert_equal(
            _dedupe_preserve_order(["a", "b", "c"]),
            ["a", "b", "c"],
            "no duplicates unchanged",
        )

    def test_removes_duplicates(self) -> None:
        _assert_equal(
            _dedupe_preserve_order(["a", "b", "a", "c", "b"]),
            ["a", "b", "c"],
            "duplicates removed, order preserved",
        )

    def test_empty_strings_filtered(self) -> None:
        _assert_equal(
            _dedupe_preserve_order(["", "a", "", "b"]),
            ["a", "b"],
            "empty strings filtered out",
        )

    def test_whitespace_only_filtered(self) -> None:
        _assert_equal(
            _dedupe_preserve_order(["a", "   ", "b"]),
            ["a", "b"],
            "whitespace-only filtered out",
        )


class TestDedupeMenuEntries:
    def test_empty_list(self) -> None:
        _assert_equal(_dedupe_menu_entries([]), [], "empty → empty")

    def test_removes_duplicate_entries_by_text_href_onclick(self) -> None:
        e1 = TISMenuEntry(text="成绩", href="/grades", onclick=None)
        e2 = TISMenuEntry(text="成绩", href="/grades", onclick=None)
        result = _dedupe_menu_entries([e1, e2])
        _assert_equal(len(result), 1, "duplicate menu entries deduped")

    def test_different_text_not_duplicate(self) -> None:
        e1 = TISMenuEntry(text="成绩", href="/grades")
        e2 = TISMenuEntry(text="课表", href="/schedule")
        result = _dedupe_menu_entries([e1, e2])
        _assert_equal(len(result), 2, "different text → different entries")


class TestExtractMenuEntries:
    def test_extracts_anchor_links(self) -> None:
        html = '<ul><li><a href="/grades">成绩查询</a></li><li><a href="/schedule">课表</a></li></ul>'
        soup = BeautifulSoup(html, "html.parser")
        entries = _extract_menu_entries(soup, page_url=_FAKE_HOMEPAGE_URL)
        assert len(entries) >= 2
        texts = {e.text for e in entries}
        assert "成绩查询" in texts
        assert "课表" in texts

    def test_relative_href_joined_to_page_url(self) -> None:
        html = '<a href="/grades">成绩</a>'
        soup = BeautifulSoup(html, "html.parser")
        entries = _extract_menu_entries(soup, page_url="https://tis.example.edu.cn/student_index")
        assert len(entries) == 1
        _assert_equal(
            entries[0].href,
            "https://tis.example.edu.cn/grades",
            "relative href joined to page_url",
        )

    def test_absolute_href_preserved(self) -> None:
        html = '<a href="https://other.example.edu.cn/page">External</a>'
        soup = BeautifulSoup(html, "html.parser")
        entries = _extract_menu_entries(soup, page_url=_FAKE_HOMEPAGE_URL)
        assert len(entries) == 1
        _assert_equal(
            entries[0].href,
            "https://other.example.edu.cn/page",
            "absolute href preserved",
        )

    def test_preserves_javascript_void_links_as_href(self) -> None:
        html = '<a href="javascript:void(0)">Click</a>'
        soup = BeautifulSoup(html, "html.parser")
        entries = _extract_menu_entries(soup, page_url=_FAKE_HOMEPAGE_URL)
        assert len(entries) == 1
        _assert_equal(entries[0].href, "javascript:void(0)", "javascript:void(0) href preserved as-is")

    def test_preserves_hash_links_as_href(self) -> None:
        html = '<a href="#">Top</a>'
        soup = BeautifulSoup(html, "html.parser")
        entries = _extract_menu_entries(soup, page_url=_FAKE_HOMEPAGE_URL)
        assert len(entries) == 1
        _assert_equal(entries[0].href, "#", "# href preserved as-is")

    def test_extracts_onclick_from_anchor(self) -> None:
        html = '<a href="javascript:;" onclick="doSomething()">Action</a>'
        soup = BeautifulSoup(html, "html.parser")
        entries = _extract_menu_entries(soup, page_url=_FAKE_HOMEPAGE_URL)
        assert len(entries) == 1
        _assert_equal(entries[0].onclick, "doSomething()", "onclick extracted from anchor")

    def test_extracts_button_with_onclick(self) -> None:
        html = '<button onclick="openMenu(\'/grades\')">成绩</button>'
        soup = BeautifulSoup(html, "html.parser")
        entries = _extract_menu_entries(soup, page_url=_FAKE_HOMEPAGE_URL)
        assert len(entries) == 1
        _assert_equal(entries[0].onclick, "openMenu('/grades')", "onclick from button")

    def test_classifies_grade_menu_entries(self) -> None:
        html = '<a href="/cjgl/grcjcx/go/1">成绩查询</a>'
        soup = BeautifulSoup(html, "html.parser")
        entries = _extract_menu_entries(soup, page_url=_FAKE_HOMEPAGE_URL)
        assert len(entries) >= 1
        grade_entries = [e for e in entries if e.menu_type == "grade"]
        assert len(grade_entries) >= 1, "grade menu entries classified"

    def test_classifies_schedule_menu_entries(self) -> None:
        html = '<a href="/kb/studentSchedule">课表</a>'
        soup = BeautifulSoup(html, "html.parser")
        entries = _extract_menu_entries(soup, page_url=_FAKE_HOMEPAGE_URL)
        assert len(entries) >= 1
        schedule_entries = [e for e in entries if e.menu_type == "schedule"]
        assert len(schedule_entries) >= 1, "schedule menu entries classified"

    def test_empty_nav_returns_empty_list(self) -> None:
        soup = BeautifulSoup("", "html.parser")
        entries = _extract_menu_entries(soup, page_url=_FAKE_HOMEPAGE_URL)
        _assert_equal(entries, [], "empty HTML → empty entries")

    def test_skips_tags_without_text_href_or_onclick(self) -> None:
        html = '<a></a>'
        soup = BeautifulSoup(html, "html.parser")
        entries = _extract_menu_entries(soup, page_url=_FAKE_HOMEPAGE_URL)
        _assert_equal(entries, [], "anchor without text/href/onclick skipped")

    def test_extracts_target_attribute(self) -> None:
        html = '<a href="/schedule" target="_blank">课表</a>'
        soup = BeautifulSoup(html, "html.parser")
        entries = _extract_menu_entries(soup, page_url=_FAKE_HOMEPAGE_URL)
        assert len(entries) == 1
        _assert_equal(entries[0].target, "_blank", "target attribute extracted")


class TestExtractRoleCodes:
    def test_extracts_role_code_with_camel_case(self) -> None:
        html = '<script>var RoleCode = "STUDENT";</script>'
        codes = _extract_role_codes(html)
        _assert_equal(codes, ["STUDENT"], "RoleCode extracted")

    def test_extracts_role_code_with_lower_camel(self) -> None:
        html = '<script>var roleCode = "TEACHER";</script>'
        codes = _extract_role_codes(html)
        _assert_equal(codes, ["TEACHER"], "roleCode extracted")

    def test_extracts_role_code_with_lowercase(self) -> None:
        html = '<script>var rolecode = "ADMIN";</script>'
        codes = _extract_role_codes(html)
        _assert_equal(codes, ["ADMIN"], "rolecode extracted")

    def test_quoted_role_code_key_is_matched(self) -> None:
        html = '{"RoleCode": "STUDENT"}'
        codes = _extract_role_codes(html)
        _assert_equal(codes, ["STUDENT"], "quoted JSON key RoleCode is now matched")

    def test_deduplicates_role_codes(self) -> None:
        html = '<script>var RoleCode = "STUDENT";\nvar roleCode = "STUDENT";</script>'
        codes = _extract_role_codes(html)
        _assert_equal(codes, ["STUDENT"], "duplicate role codes deduped")

    def test_empty_html_returns_empty_list(self) -> None:
        _assert_equal(_extract_role_codes(""), [], "empty HTML → empty role codes")

    def test_no_role_codes_returns_empty_list(self) -> None:
        html = "<html><body><p>No codes here</p></body></html>"
        _assert_equal(_extract_role_codes(html), [], "no role codes → empty")

    def test_role_code_with_equals_and_no_quotes_around_value_not_matched(self) -> None:
        html = "RoleCode = STUDENT"
        codes = _extract_role_codes(html)
        _assert_equal(codes, [], "unquoted value not matched")

    def test_role_code_value_max_64_chars(self) -> None:
        long_code = "A" * 100
        html = f'<script>var RoleCode = "{long_code}";</script>'
        codes = _extract_role_codes(html)
        assert len(codes) == 1
        assert len(codes[0]) == 64, f"role code truncated to 64 chars, got {len(codes[0])}"
        _assert_equal(codes[0], "A" * 64, "role code max 64 chars")


class TestAnalyzeHomepageHtml:
    def test_extracts_title_from_html(self) -> None:
        html = _make_tis_homepage_html(title="教学管理与服务平台")
        profile = analyze_homepage_html(html, page_url=_FAKE_HOMEPAGE_URL, base_url=_FAKE_BASE_URL)
        _assert_equal(profile.title, "教学管理与服务平台", "title extracted")

    def test_empty_html_returns_default_profile(self) -> None:
        profile = analyze_homepage_html("", page_url=_FAKE_HOMEPAGE_URL, base_url=_FAKE_BASE_URL)
        assert isinstance(profile, TISHomepageProfile)
        _assert_equal(profile.title, "", "empty HTML → empty title")
        _assert_equal(profile.iframe_urls, [], "empty HTML → empty iframe_urls")
        _assert_equal(profile.menu_entries, [], "empty HTML → empty menu_entries")
        _assert_equal(profile.role_codes, [], "empty HTML → empty role_codes")
        _assert_equal(profile.prefers_json_api, False, "empty HTML → prefers_json_api=False")

    def test_none_html_returns_default_profile(self) -> None:
        profile = analyze_homepage_html(  # type: ignore[arg-type]
            None, page_url=_FAKE_HOMEPAGE_URL, base_url=_FAKE_BASE_URL
        )
        assert isinstance(profile, TISHomepageProfile)

    def test_extracts_iframe_urls(self) -> None:
        html = _make_tis_homepage_html(
            body_content='<iframe src="/embedded/page1"></iframe><iframe src="https://other.example.com/page2"></iframe>'
        )
        profile = analyze_homepage_html(html, page_url=_FAKE_HOMEPAGE_URL, base_url=_FAKE_BASE_URL)
        assert len(profile.iframe_urls) >= 2
        urls_joined = any("tis.example.edu.cn/embedded/page1" in u for u in profile.iframe_urls)
        _assert_true(urls_joined, "relative iframe src joined to page_url")

    def test_extracts_base_urls(self) -> None:
        html = _make_tis_homepage_html()
        profile = analyze_homepage_html(html, page_url=_FAKE_HOMEPAGE_URL, base_url=_FAKE_BASE_URL)
        assert _FAKE_BASE_URL in profile.base_urls

    def test_extracts_menu_entries_from_nav(self) -> None:
        html = _make_tis_homepage_html()
        profile = analyze_homepage_html(html, page_url=_FAKE_HOMEPAGE_URL, base_url=_FAKE_BASE_URL)
        assert len(profile.menu_entries) >= 4

    def test_extracts_role_codes(self) -> None:
        html = _make_tis_homepage_html(
            scripts='<script>var RoleCode = "STUDENT";</script>'
        )
        profile = analyze_homepage_html(html, page_url=_FAKE_HOMEPAGE_URL, base_url=_FAKE_BASE_URL)
        _assert_equal(profile.role_codes, ["STUDENT"], "role codes extracted in profile")

    def test_identifies_grade_related_endpoints(self) -> None:
        html = _make_tis_homepage_html(
            body_content='<a href="/cjgl/grcjcx/go/1">成绩查询</a>'
        )
        profile = analyze_homepage_html(html, page_url=_FAKE_HOMEPAGE_URL, base_url=_FAKE_BASE_URL)
        assert len(profile.grade_related_endpoints) > 0, (
            f"expected grade-related endpoints, got {profile.grade_related_endpoints}"
        )

    def test_identifies_schedule_related_endpoints(self) -> None:
        html = _make_tis_homepage_html(
            body_content='<a href="/kb/studentSchedule" target="_blank">课表查看</a>'
        )
        profile = analyze_homepage_html(html, page_url=_FAKE_HOMEPAGE_URL, base_url=_FAKE_BASE_URL)
        assert len(profile.schedule_related_endpoints) > 0

    def test_detects_json_api_preference_with_ajax_code(self) -> None:
        html = _make_tis_homepage_html(
            scripts='<script>fetch("/api/grades.json");</script>',
            body_content='<a href="/api/grades.json">Grades</a>',
        )
        profile = analyze_homepage_html(html, page_url=_FAKE_HOMEPAGE_URL, base_url=_FAKE_BASE_URL)
        _assert_true(profile.prefers_json_api, "detected JSON API preference")

    def test_raw_signals_include_counts(self) -> None:
        html = _make_tis_homepage_html()
        profile = analyze_homepage_html(html, page_url=_FAKE_HOMEPAGE_URL, base_url=_FAKE_BASE_URL)
        signals = profile.raw_signals
        assert "script_count" in signals
        assert "iframe_count" in signals
        assert "anchor_count" in signals
        assert signals["anchor_count"] > 0

    def test_malformed_html_handled_gracefully(self) -> None:
        html = "<div><p>unclosed div <span>text</p>"
        profile = analyze_homepage_html(html, page_url=_FAKE_HOMEPAGE_URL, base_url=_FAKE_BASE_URL)
        assert isinstance(profile, TISHomepageProfile)

    def test_page_url_preserved_in_profile(self) -> None:
        profile = analyze_homepage_html("", page_url=_FAKE_HOMEPAGE_URL, base_url=_FAKE_BASE_URL)
        _assert_equal(profile.page_url, _FAKE_HOMEPAGE_URL, "page_url preserved")

    def test_discovers_endpoints_from_quoted_urls(self) -> None:
        html = _make_tis_homepage_html(
            scripts='<script>var api = "/api/query.do";</script>',
        )
        profile = analyze_homepage_html(html, page_url=_FAKE_HOMEPAGE_URL, base_url=_FAKE_BASE_URL)
        assert any(".do" in ep for ep in profile.discovered_endpoints), (
            f"discovered endpoints should include .do URLs, got {profile.discovered_endpoints}"
        )

    def test_default_page_url_used_when_not_provided(self) -> None:
        profile = analyze_homepage_html("<html><title>TIS</title></html>")
        _assert_equal(
            profile.page_url,
            DEFAULT_TIS_SERVICE_CONFIG.homepage_url,
            "default homepage URL used",
        )

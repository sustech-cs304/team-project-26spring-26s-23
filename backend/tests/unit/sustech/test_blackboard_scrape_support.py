from __future__ import annotations

from datetime import datetime

from app.integrations.sustech.blackboard.api.scrape_support import (
    clean_field,
    extract_course_name_and_listed_grade,
    extract_date_text_safe,
    extract_grade_text,
    extract_status_text,
    is_course_content_page_url,
    is_navigation_noise,
    is_sidebar_seed_candidate,
    is_valid_assignment,
    is_valid_resource,
    looks_like_course_name,
    normalize_assignment_title,
    parse_datetime_safe,
    stable_resource_id,
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


# ── clean_field ──────────────────────────────────────────────────────────────


class TestCleanField:
    def test_cleans_whitespace(self) -> None:
        result = clean_field("  hello   world  ")
        _assert_equal(result, "hello world", "whitespace collapsed")

    def test_truncates_to_max_length(self) -> None:
        result = clean_field("a" * 1000, max_length=10)
        _assert_equal(result, "a" * 10, "truncated to max_length")

    def test_empty_string_returns_empty(self) -> None:
        result = clean_field("", max_length=100)
        _assert_equal(result, "", "empty input → empty output")

    def test_default_max_length_600(self) -> None:
        result = clean_field("a" * 800)
        _assert_equal(len(result), 600, "default max_length=600")


# ── looks_like_course_name ───────────────────────────────────────────────────


class TestLooksLikeCourseName:
    def test_rejects_empty(self) -> None:
        _assert_false(looks_like_course_name(""), "empty → False")
        _assert_false(looks_like_course_name("  "), "whitespace → False")

    def test_rejects_short_text(self) -> None:
        _assert_false(looks_like_course_name("A"), "single char → False")

    def test_rejects_noise_tokens(self) -> None:
        for token in ("发布时间", "Posted on", "课程菜单", "http://", "top frame tabs"):
            _assert_false(
                looks_like_course_name(token), f"noise token '{token}' → False"
            )

    def test_rejects_weekday_abbreviation(self) -> None:
        _assert_false(looks_like_course_name("Class on Mon"), "weekday abbr → False")

    def test_rejects_full_weekday(self) -> None:
        _assert_false(looks_like_course_name("Class on Monday"), "full weekday rejected")

    def test_rejects_date_only_text(self) -> None:
        _assert_false(looks_like_course_name("2024-03-10"), "date → False")
        _assert_false(looks_like_course_name("2024年3月10日"), "Chinese date → False")

    def test_accepts_plausible_course_name(self) -> None:
        _assert_true(
            looks_like_course_name("CS305 Database Systems"), "CS305 → True"
        )
        _assert_true(
            looks_like_course_name("高级算法设计"), "Chinese course name → True"
        )


# ── extract_status_text ─────────────────────────────────────────────────────


class TestExtractStatusText:
    def test_extracts_chinese_status(self) -> None:
        _assert_equal(
            extract_status_text("已提交"), "已提交", "已提交 extracted"
        )
        _assert_equal(
            extract_status_text("未提交"), "未提交", "未提交 extracted"
        )
        _assert_equal(
            extract_status_text("已批改"), "已批改", "已批改 extracted"
        )
        _assert_equal(
            extract_status_text("逾期"), "逾期", "逾期 extracted"
        )

    def test_extracts_english_status(self) -> None:
        _assert_equal(
            extract_status_text("Submitted"), "Submitted", "submitted extracted"
        )
        _assert_equal(
            extract_status_text("Needs Grading"), "Needs Grading", "needs grading extracted"
        )
        _assert_equal(
            extract_status_text("In Progress"), "In Progress", "in progress extracted"
        )

    def test_status_within_larger_text(self) -> None:
        _assert_equal(
            extract_status_text("状态：已提交 (等待批改)"),
            "已提交",
            "status within larger text",
        )

    def test_empty_input(self) -> None:
        _assert_equal(extract_status_text(""), "", "empty → empty")
        _assert_equal(extract_status_text(None), "", "None → empty")  # type: ignore[arg-type]

    def test_no_status_found(self) -> None:
        _assert_equal(extract_status_text("hello world"), "", "no status → empty")


# ── extract_grade_text ───────────────────────────────────────────────────────


class TestExtractGradeText:
    def test_extracts_fraction(self) -> None:
        _assert_equal(
            extract_grade_text("95.5 / 100"), "95.5 / 100", "fraction extracted"
        )
        _assert_equal(
            extract_grade_text("95/100"), "95/100", "simple fraction extracted"
        )

    def test_extracts_percentage(self) -> None:
        _assert_equal(extract_grade_text("95%"), "95%", "percentage extracted")
        _assert_equal(extract_grade_text(" 95.5% "), "95.5%", "percentage with decimals")

    def test_extracts_letter_grade(self) -> None:
        _assert_equal(extract_grade_text("A"), "A", "A extracted")
        _assert_equal(extract_grade_text("Grade: F"), "F", "F extracted")

    def test_letter_grade_with_plus_minus(self) -> None:
        _assert_equal(extract_grade_text("A+"), "A+", "A+ extracted")
        _assert_equal(extract_grade_text("B-"), "B-", "B- extracted")

    def test_extracts_labeled_grade(self) -> None:
        _assert_equal(
            extract_grade_text("得分：85"), "85", "得分 label extracted"
        )
        _assert_equal(
            extract_grade_text("Grade: 85"), "85", "grade label extracted"
        )

    def test_empty_input(self) -> None:
        _assert_equal(extract_grade_text(""), "", "empty → empty")

    def test_no_grade_found(self) -> None:
        _assert_equal(extract_grade_text("No grade available"), "", "no grade → empty")


# ── parse_datetime_safe ─────────────────────────────────────────────────────


class TestParseDatetimeSafe:
    def test_parses_valid_datetime(self) -> None:
        result = parse_datetime_safe("2026-03-10 23:59")
        _assert_true(isinstance(result, datetime), "returns datetime")
        _assert_true(result != datetime.min, "not datetime.min")

    def test_invalid_returns_min(self) -> None:
        result = parse_datetime_safe("not a date")
        _assert_equal(result, datetime.min, "invalid → datetime.min")

    def test_empty_returns_min(self) -> None:
        result = parse_datetime_safe("")
        _assert_equal(result, datetime.min, "empty → datetime.min")


# ── is_navigation_noise ─────────────────────────────────────────────────────


class TestIsNavigationNoise:
    def test_detects_known_noise(self) -> None:
        _assert_true(is_navigation_noise("course menu"), "course menu → noise")
        _assert_true(
            is_navigation_noise("Top Frame Tabs"), "top frame tabs → noise"
        )
        _assert_true(is_navigation_noise("注销"), "注销 → noise")
        _assert_true(
            is_navigation_noise("Open Global Navigation"),
            "open global nav → noise",
        )

    def test_plain_text_not_noise(self) -> None:
        _assert_false(is_navigation_noise("CS305 Database Systems"), "course name")
        _assert_false(is_navigation_noise("Homework 1"), "homework")

    def test_empty_text(self) -> None:
        _assert_false(is_navigation_noise(""), "empty → not noise")
        _assert_false(is_navigation_noise(None), "None → not noise")  # type: ignore[arg-type]


# ── normalize_assignment_title ───────────────────────────────────────────────


class TestNormalizeAssignmentTitle:
    def test_normalizes_whitespace(self) -> None:
        _assert_equal(
            normalize_assignment_title("  Homework   1  "),
            "Homework 1",
            "whitespace normalized",
        )

    def test_strips_due_suffix(self) -> None:
        _assert_equal(
            normalize_assignment_title("Homework 1 Due: 2026-03-10"),
            "Homework 1",
            "Due: suffix removed",
        )
        _assert_equal(
            normalize_assignment_title("Homework 1 due: tomorrow"),
            "Homework 1",
            "lowercase due: removed",
        )

    def test_empty_input(self) -> None:
        _assert_equal(normalize_assignment_title(""), "", "empty → empty")
        _assert_equal(normalize_assignment_title(None), "", "None → empty")  # type: ignore[arg-type]


# ── is_valid_assignment ─────────────────────────────────────────────────────


class TestIsValidAssignment:
    def test_rejects_empty_title(self) -> None:
        _assert_false(
            is_valid_assignment({"title": "", "url": "https://bb.example/asg"}),
            "empty title → invalid",
        )

    def test_rejects_error_title(self) -> None:
        _assert_false(
            is_valid_assignment({"title": "Error: 失败", "url": "https://bb.example"}),
            "error title → invalid",
        )
        _assert_false(
            is_valid_assignment({"title": "错误", "url": "https://bb.example"}),
            "错误 title → invalid",
        )

    def test_rejects_title_is_url(self) -> None:
        _assert_false(
            is_valid_assignment({"title": "https://bb.example", "url": "https://bb.example"}),
            "title is url → invalid",
        )

    def test_rejects_navigation_title(self) -> None:
        _assert_false(
            is_valid_assignment({"title": "活动标签", "url": "https://bb.example"}),
            "活动标签 → invalid",
        )

    def test_rejects_javascript_url(self) -> None:
        _assert_false(
            is_valid_assignment({"title": "Some link", "url": "javascript:void(0)"}),
            "javascript url → invalid",
        )

    def test_rejects_navigation_text_title(self) -> None:
        _assert_false(
            is_valid_assignment({"title": "Course Menu", "url": "https://bb.example"}),
            "course menu title → invalid",
        )

    def test_accepts_assignment_with_due_date(self) -> None:
        _assert_true(
            is_valid_assignment({"title": "Homework 1", "url": "https://bb.example", "due_date": "2026-03-10"}),
            "has due_date → valid",
        )

    def test_accepts_assignment_with_status(self) -> None:
        _assert_true(
            is_valid_assignment({"title": "Homework 1", "url": "https://bb.example", "status": "已提交"}),
            "has status → valid",
        )

    def test_accepts_assignment_with_known_title_token(self) -> None:
        _assert_true(
            is_valid_assignment({"title": "作业一", "url": "https://bb.example"}),
            "作业 token → valid",
        )
        _assert_true(
            is_valid_assignment({"title": "Lab report", "url": "https://bb.example"}),
            "lab token → valid",
        )
        _assert_true(
            is_valid_assignment({"title": "Quiz 3", "url": "https://bb.example"}),
            "quiz token → valid",
        )

    def test_accepts_assignment_with_assignment_url(self) -> None:
        _assert_true(
            is_valid_assignment(
                {"title": "Generic Task", "url": "https://bb.example/webapps/assignment/submit"}
            ),
            "assignment url token → valid",
        )

    def test_accepts_assignment_with_bb_assignment_url(self) -> None:
        _assert_true(
            is_valid_assignment(
                {"title": "Generic Task", "url": "https://bb.example/bb-assignment-123"}
            ),
            "bb-assignment url token → valid",
        )

    def test_rejects_missing_signal(self) -> None:
        _assert_false(
            is_valid_assignment({"title": "Generic Task", "url": "https://bb.example/page"}),
            "no signal → invalid",
        )

    def test_with_logger_does_not_raise(self) -> None:
        result = is_valid_assignment(
            {"title": "Homework 1", "url": "https://bb.example"},
            logger=None,
        )
        _assert_true(result, "None logger should not crash")


# ── is_valid_resource ───────────────────────────────────────────────────────


class TestIsValidResource:
    def test_rejects_empty_download_url(self) -> None:
        _assert_false(
            is_valid_resource({"name": "file.pdf", "download_url": "", "type": "file"}),
            "empty download_url → invalid",
        )

    def test_rejects_help_url(self) -> None:
        _assert_false(
            is_valid_resource({
                "name": "Getting Started",
                "download_url": "https://bb.example/webapps/blackboard/content/getting-started/",
                "type": "link",
            }),
            "help url → invalid",
        )

    def test_rejects_javascript_url(self) -> None:
        _assert_false(
            is_valid_resource({
                "name": "Click here",
                "download_url": "javascript:openWindow()",
                "type": "link",
            }),
            "javascript url → invalid",
        )

    def test_rejects_help_title(self) -> None:
        _assert_false(
            is_valid_resource({
                "name": "Your profile",
                "download_url": "https://bb.example/page",
                "type": "link",
            }),
            "help title → invalid",
        )

    def test_rejects_folder_navigation_action(self) -> None:
        _assert_false(
            is_valid_resource({
                "name": "cancel",
                "download_url": "https://bb.example/folder/1",
                "type": "folder",
            }),
            "cancel folder → invalid",
        )
        _assert_false(
            is_valid_resource({
                "name": "关闭",
                "download_url": "https://bb.example/folder/2",
                "type": "folder",
            }),
            "关闭 folder → invalid",
        )

    def test_rejects_empty_folder_name(self) -> None:
        _assert_false(
            is_valid_resource({
                "name": "",
                "download_url": "https://bb.example/folder/1",
                "type": "folder",
            }),
            "empty folder name → invalid",
        )

    def test_rejects_navigation_folder_name(self) -> None:
        _assert_false(
            is_valid_resource({
                "name": "Course Menu",
                "download_url": "https://bb.example/folder/1",
                "type": "folder",
            }),
            "navigation folder name → invalid",
        )

    def test_accepts_valid_file_resource(self) -> None:
        _assert_true(
            is_valid_resource({
                "name": "lecture1.pdf",
                "download_url": "https://bb.example/bbcswebdav/lecture1.pdf",
                "type": "file",
            }),
            "valid file → valid",
        )

    def test_accepts_valid_folder_resource(self) -> None:
        _assert_true(
            is_valid_resource({
                "name": "Lecture Notes",
                "download_url": "https://bb.example/materials/lectures/",
                "type": "folder",
            }),
            "valid folder → valid",
        )

    def test_rejects_course_help_without_valid_token(self) -> None:
        _assert_false(
            is_valid_resource({
                "name": "Some Page",
                "download_url": "https://bb.example/webapps/blackboard/content/listContent.jsp",
                "type": "link",
            }),
            "course help page without valid content token → invalid",
        )

    def test_rejects_blackboard_help_doc_by_name(self) -> None:
        _assert_false(
            is_valid_resource({
                "name": "folder",
                "download_url": "https://bb.example/webapps/blackboard/content/some-help",
                "type": "link",
            }),
            "blackboard help doc → invalid",
        )

    def test_with_logger_does_not_raise(self) -> None:
        result = is_valid_resource(
            {
                "name": "lecture1.pdf",
                "download_url": "https://bb.example/bbcswebdav/lecture1.pdf",
                "type": "file",
            },
            logger=None,
        )
        _assert_true(result, "None logger should not crash")


# ── extract_course_name_and_listed_grade ─────────────────────────────────────


class TestExtractCourseNameAndListedGrade:
    def test_extracts_name_with_grade(self) -> None:
        name, grade = extract_course_name_and_listed_grade("CS305 (95)")
        _assert_equal(name, "CS305", "name extracted")
        _assert_equal(grade, "95", "grade extracted")

    def test_extracts_name_without_grade(self) -> None:
        name, grade = extract_course_name_and_listed_grade("CS305 Database Systems")
        _assert_equal(name, "CS305 Database Systems", "full name returned")
        _assert_equal(grade, "", "no grade → empty")

    def test_empty_text(self) -> None:
        name, grade = extract_course_name_and_listed_grade("")
        _assert_equal(name, "", "empty name")
        _assert_equal(grade, "", "empty grade")

    def test_normalizes_whitespace(self) -> None:
        name, grade = extract_course_name_and_listed_grade("  CS305   (95)  ")
        _assert_equal(name, "CS305", "whitespace normalized")
        _assert_equal(grade, "95", "grade extracted")


# ── stable_resource_id ──────────────────────────────────────────────────────


class TestStableResourceId:
    def test_generates_stable_id(self) -> None:
        rid = stable_resource_id("_course_1", "lecture1.pdf", "https://bb.example/dl")
        _assert_true(rid.startswith("res_"), "starts with res_")
        _assert_equal(len(rid), 24, "length = 4 prefix + 20 hex chars")

    def test_same_inputs_produce_same_id(self) -> None:
        rid1 = stable_resource_id("_course_1", "lecture1.pdf", "https://bb.example/dl")
        rid2 = stable_resource_id("_course_1", "lecture1.pdf", "https://bb.example/dl")
        _assert_equal(rid1, rid2, "idempotent")

    def test_different_inputs_produce_different_ids(self) -> None:
        rid1 = stable_resource_id("_course_1", "a.pdf", "url1")
        rid2 = stable_resource_id("_course_1", "b.pdf", "url2")
        _assert_true(rid1 != rid2, "different inputs → different ids")


# ── is_course_content_page_url ──────────────────────────────────────────────


class TestIsCourseContentPageUrl:
    def test_recognizes_content_page(self) -> None:
        _assert_true(
            is_course_content_page_url(
                "https://bb.example/webapps/blackboard/content/listContent.jsp?course_id=_course_1",
                "_course_1",
                base_url="https://bb.example",
            ),
            "content page URL",
        )

    def test_recognizes_launcher(self) -> None:
        _assert_true(
            is_course_content_page_url(
                "https://bb.example/webapps/blackboard/execute/launcher?course_id=_course_1",
                "_course_1",
                base_url="https://bb.example",
            ),
            "launcher URL",
        )

    def test_rejects_different_netloc(self) -> None:
        _assert_false(
            is_course_content_page_url(
                "https://other.example/content?course_id=_course_1",
                "_course_1",
                base_url="https://bb.example",
            ),
            "different netloc → not content page",
        )

    def test_rejects_missing_course_id(self) -> None:
        _assert_false(
            is_course_content_page_url(
                "https://bb.example/webapps/blackboard/content/page",
                "_course_1",
                base_url="https://bb.example",
            ),
            "missing course_id → not content page",
        )

    def test_rejects_non_content_path(self) -> None:
        _assert_false(
            is_course_content_page_url(
                "https://bb.example/webapps/login?_course_1",
                "_course_1",
                base_url="https://bb.example",
            ),
            "non-content path → not content page",
        )


# ── is_sidebar_seed_candidate ───────────────────────────────────────────────


class TestIsSidebarSeedCandidate:
    def test_recognizes_content_seed(self) -> None:
        _assert_true(
            is_sidebar_seed_candidate(
                "作业",
                "https://bb.example/webapps/blackboard/content/listContent.jsp?course_id=_course_1",
                "_course_1",
                base_url="https://bb.example",
            ),
            "content seed",
        )

    def test_recognizes_assignment_seed(self) -> None:
        _assert_true(
            is_sidebar_seed_candidate(
                "Assignment",
                "https://bb.example/webapps/assignment?_course_1",
                "_course_1",
                base_url="https://bb.example",
            ),
            "assignment seed",
        )

    def test_rejects_javascript_url(self) -> None:
        _assert_false(
            is_sidebar_seed_candidate(
                "Link",
                "javascript:void(0)",
                "_course_1",
                base_url="https://bb.example",
            ),
            "javascript url → not seed",
        )

    def test_rejects_logout_url(self) -> None:
        _assert_false(
            is_sidebar_seed_candidate(
                "Link",
                "https://bb.example/logout?_course_1",
                "_course_1",
                base_url="https://bb.example",
            ),
            "logout url → not seed",
        )

    def test_rejects_external_netloc(self) -> None:
        _assert_false(
            is_sidebar_seed_candidate(
                "Resource",
                "https://other.example/resource",
                "_course_1",
                base_url="https://bb.example",
            ),
            "external netloc → not seed",
        )

    def test_rejects_missing_course_id(self) -> None:
        _assert_false(
            is_sidebar_seed_candidate(
                "Lecture",
                "https://bb.example/webapps/blackboard/content/page",
                "_course_1",
                base_url="https://bb.example",
            ),
            "missing course_id → not seed",
        )

    def test_rejects_noise_url_tokens(self) -> None:
        _assert_false(
            is_sidebar_seed_candidate(
                "Calendar",
                "https://bb.example/calendar?_course_1",
                "_course_1",
                base_url="https://bb.example",
            ),
            "calendar token → not seed",
        )


# ── extract_date_text_safe ──────────────────────────────────────────────────


class TestExtractDateTextSafe:
    def test_returns_date_text_for_valid_input(self) -> None:
        result = extract_date_text_safe("发布: 2026-03-10")
        _assert_true(isinstance(result, str), "returns a string")

    def test_handles_empty_input(self) -> None:
        result = extract_date_text_safe("")
        _assert_true(result == "", "empty → empty string")

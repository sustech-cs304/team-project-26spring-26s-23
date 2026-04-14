"""Blackboard 课程列表解析器。"""

from __future__ import annotations

import re
from datetime import datetime
from urllib.parse import urljoin

from bs4 import BeautifulSoup
from bs4.element import Tag

from app.integrations.sustech.blackboard.api.dto import CourseDTO
from app.integrations.sustech.blackboard.shared import DEFAULT_BLACKBOARD_BASE_URL, clean_text, extract_course_id_from_url


class BlackboardCourseParser:
    """负责解析 Blackboard 课程列表 HTML。"""

    def __init__(self, *, base_url: str = DEFAULT_BLACKBOARD_BASE_URL) -> None:
        self.base_url = base_url

    def extract_course_meta(self, course_name: str, context_text: str) -> dict[str, str | None]:
        """从课程名及周边文本提取 ``code`` / ``term`` / ``instructor``。"""
        normalized = re.sub(r"\s+", " ", str(context_text or "")).strip()
        normalized_name = clean_text(course_name, max_length=500)

        code_match = re.search(r"\b([A-Z]{2,}\d{2,}[A-Z]?)\b", normalized_name)
        if code_match is None:
            code_match = re.search(r"\b([A-Z]{2,}\d{2,}[A-Z]?)\b", normalized)

        term_match = re.search(r"\b(Spring|Summer|Fall|Winter)\s+\d{4}\b", normalized_name, re.IGNORECASE)
        if term_match is None:
            term_match = re.search(r"\b(Spring|Summer|Fall|Winter)\s+\d{4}\b", normalized, re.IGNORECASE)

        instructor = ""
        for pattern in (
            r"(?:Instructor|Teacher|Lecturer|Prof\.?|教师|任课教师|老师)\s*[:：]\s*([^|,，;；]{2,80})",
            r"(?:Instructor|Teacher|Lecturer|Prof\.?|教师|任课教师|老师)\s+([^|,，;；]{2,80})",
        ):
            match = re.search(pattern, normalized, re.IGNORECASE)
            if match:
                instructor = match.group(1).strip()
                break

        return {
            "code": code_match.group(1) if code_match else None,
            "term": term_match.group(0) if term_match else None,
            "instructor": instructor or None,
        }

    def normalize_term_label(self, raw_text: str) -> str | None:
        """统一学期标签，如 ``Spring 2026``。"""
        normalized = clean_text(raw_text, max_length=160)
        if not normalized:
            return None

        for pattern in (
            r"\((Spring|Summer|Fall|Winter)\s+(\d{4})\)",
            r"\b(Spring|Summer|Fall|Winter)\s+(\d{4})\b",
        ):
            match = re.search(pattern, normalized, re.IGNORECASE)
            if match:
                return f"{match.group(1).capitalize()} {match.group(2)}"

        return None

    def is_archived_term(self, term: str | None) -> bool:
        """基于学期标签判断课程是否已归档。"""
        if not term:
            return False

        normalized = self.normalize_term_label(term) or clean_text(term, max_length=80)
        season = ""
        year = 0

        en_match = re.search(r"\b(Spring|Summer|Fall|Winter)\s+(\d{4})\b", normalized, re.IGNORECASE)
        if en_match:
            season = en_match.group(1).capitalize()
            year = int(en_match.group(2))
        else:
            zh_match_1 = re.search(r"(20\d{2})\s*[年\s]*([春夏秋冬])", normalized)
            zh_match_2 = re.search(r"([春夏秋冬])\s*(20\d{2})", normalized)
            if zh_match_1:
                year = int(zh_match_1.group(1))
                season = {"春": "Spring", "夏": "Summer", "秋": "Fall", "冬": "Winter"}[zh_match_1.group(2)]
            elif zh_match_2:
                season = {"春": "Spring", "夏": "Summer", "秋": "Fall", "冬": "Winter"}[zh_match_2.group(1)]
                year = int(zh_match_2.group(2))

        if not season or year <= 0:
            return False

        season_order = {"Winter": 0, "Spring": 1, "Summer": 2, "Fall": 3}
        now = datetime.now()
        if now.month in (3, 4, 5):
            current_season = "Spring"
        elif now.month in (6, 7, 8):
            current_season = "Summer"
        elif now.month in (9, 10, 11):
            current_season = "Fall"
        else:
            current_season = "Winter"

        current_key = (now.year, season_order[current_season])
        target_key = (year, season_order[season])
        return target_key < current_key

    def find_term_heading_for_link(self, link: Tag) -> str | None:
        """查找课程链接所属的学期标题。"""
        term_container: Tag | None = None
        for ancestor in link.parents:
            if not isinstance(ancestor, Tag):
                continue

            ancestor_id = str(ancestor.get("id") or "").strip()
            if ancestor.name == "div" and "termCourses__" in ancestor_id:
                term_container = ancestor
                break

        if term_container is None:
            return None

        sibling = term_container.previous_sibling
        while sibling is not None:
            if isinstance(sibling, Tag):
                sibling_classes = {str(item) for item in (sibling.get("class") or [])}
                if sibling.name == "h3" and any("termHeading" in item for item in sibling_classes):
                    return self.normalize_term_label(sibling.get_text(" ", strip=True))
            sibling = sibling.previous_sibling

        return None

    @staticmethod
    def is_course_entry_link(href: str) -> bool:
        """判断链接是否像课程入口。"""
        lower_href = str(href or "").strip().lower()
        if not lower_href or lower_href.startswith("#") or lower_href.startswith("javascript:"):
            return False

        if "launcher?type=course" in lower_href:
            return True
        if "/execute/coursemain" in lower_href and "course_id=" in lower_href:
            return True
        if "/content/listcontent.jsp" in lower_href and "course_id=" in lower_href:
            return True
        if "/bb-mygrades-bblearn/mygrades" in lower_href and "course_id=" in lower_href:
            return True

        return False

    def parse_courses_html(self, html: str) -> list[CourseDTO]:
        """解析课程列表 HTML，输出 [`CourseDTO`](backend/app/blackboard/api/dto.py)。"""
        soup = BeautifulSoup(html, "html.parser")
        courses: list[CourseDTO] = []
        seen_ids: set[str] = set()

        for link in soup.find_all("a"):
            href = str(link.get("href") or "").strip()
            if not href or not self.is_course_entry_link(href):
                continue

            course_id = extract_course_id_from_url(href) or ""
            if not course_id or course_id in seen_ids:
                continue

            course_name = clean_text(link.get_text(" ", strip=True), max_length=500)
            if not course_name:
                continue

            full_url = urljoin(self.base_url, href)
            parent = link.find_parent(["li", "tr", "div"])
            context_text = parent.get_text(" ", strip=True) if isinstance(parent, Tag) else course_name
            meta = self.extract_course_meta(course_name, context_text)
            if meta["term"] is None:
                meta["term"] = self.find_term_heading_for_link(link)

            seen_ids.add(course_id)
            courses.append(
                CourseDTO(
                    course_id=course_id,
                    name=course_name,
                    url=full_url,
                    code=meta["code"],
                    term=meta["term"],
                    instructor=meta["instructor"],
                    is_archived=self.is_archived_term(meta["term"]),
                )
            )

        return courses




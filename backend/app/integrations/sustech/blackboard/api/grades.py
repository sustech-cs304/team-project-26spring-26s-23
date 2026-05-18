"""Blackboard 成绩抓取 API。"""

from __future__ import annotations

import re
from collections.abc import Callable, Mapping, Sequence

from bs4 import BeautifulSoup
from bs4.element import Tag

from .context import BlackboardAPIContext
from .dto import AllGradesCourseDTO, AllGradesDTO, CourseGradesDTO, GradeDTO
from .scrape_support import (
    extract_course_name_and_listed_grade,
    extract_date_text_safe,
    extract_grade_text,
    extract_status_text,
    is_navigation_noise,
    normalize_assignment_title,
)


class BlackboardGradeAPI:
    """负责 Blackboard 成绩抓取与汇总。"""

    def __init__(self, context: BlackboardAPIContext) -> None:
        self.context = context

    def get_course_grades(self, course_id: str) -> CourseGradesDTO:
        """获取课程成绩（总评 + 分项成绩 + 统计信息）。"""
        total_grade, grade_items, stats, source_url = self._collect_course_grades(
            course_id
        )
        result = CourseGradesDTO(
            course_id=course_id,
            total_grade=total_grade,
            items=grade_items,
            stats=stats,
            source_url=source_url,
        )
        self.context.log(
            f"✅ [Blackboard] 成绩解析完成: total_grade='{total_grade}', items={len(grade_items)}"
        )
        return result

    def get_course_grade_dtos(self, course_id: str) -> list[GradeDTO]:
        """获取课程成绩明细 DTO。"""
        _, grade_items, _, _ = self._collect_course_grades(course_id)
        return grade_items

    def _collect_course_grades(
        self,
        course_id: str,
    ) -> tuple[str, list[GradeDTO], dict[str, int | float | None], str]:
        self.context.log(f"🔍 [Blackboard] 开始获取课程成绩, course_id={course_id}")

        candidate_urls = [
            f"{self.context.base_url}/webapps/bb-mygrades-BBLEARN/myGrades?course_id={course_id}&stream_name=mygrades&is_stream=false",
            f"{self.context.base_url}/webapps/bb-mygrades-BBLEARN/myGrades?course_id={course_id}",
            f"{self.context.base_url}/webapps/blackboard/execute/launcher?type=Course&id={course_id}",
        ]

        grade_items: list[GradeDTO] = []
        page_text = ""
        source_url = ""

        for page_url in candidate_urls:
            try:
                response = self.context.get(page_url, label="Grades")
                response.raise_for_status()
            except Exception as ex:
                self.context.log(f"⚠️ [Blackboard] 成绩页面访问失败: {page_url} - {ex}")
                continue

            soup = BeautifulSoup(response.text, "html.parser")
            page_text = soup.get_text(" ", strip=True)
            source_url = str(response.url)
            self.context.log(f"🔍 [Blackboard] 分析成绩页面结构: {source_url}")

            rows = soup.select("div.sortable_item_row.row")
            if rows:
                for row in rows:
                    dto = self._parse_grade_row(row, course_id, source_url or page_url)
                    if dto is not None:
                        grade_items.append(dto)

            if grade_items or any(
                token in page_text.lower() for token in ("grade", "成绩", "my grades")
            ):
                break

        deduped_items = self._dedupe_grade_items(grade_items)
        total_grade = self._extract_total_grade(deduped_items, page_text)
        stats = self._build_stats(deduped_items)
        return total_grade, deduped_items, stats, source_url

    def get_all_grades(
        self,
        *,
        fallback_course_loader: Callable[[], Sequence[object]] | None = None,
        course_grade_loader: Callable[[str], CourseGradesDTO] | None = None,
    ) -> AllGradesDTO:
        """获取“我的成绩”页面中的所有课程成绩汇总。"""
        self.context.log("🔍 [Blackboard] 开始获取所有课程成绩汇总")
        if course_grade_loader is None:
            course_grade_loader = self.get_course_grades

        selected_source_url, discovered_courses, seen_course_ids = (
            self._discover_courses_from_all_grades_pages()
        )
        self._extend_fallback_grade_courses(
            discovered_courses,
            seen_course_ids,
            fallback_course_loader,
        )
        result = self._build_all_grades_result(
            selected_source_url,
            discovered_courses,
            course_grade_loader,
        )
        self.context.log(
            f"✅ [Blackboard] 汇总成绩解析完成，课程数={len(result.courses)}"
        )
        return result

    def _all_grades_candidate_urls(self) -> list[str]:
        return [
            f"{self.context.base_url}/webapps/gradebook/do/student/viewGrades",
            f"{self.context.base_url}/webapps/bb-mygrades-BBLEARN/myGrades?stream_name=mygrades&is_stream=false",
        ]

    def _load_all_grades_page(self, page_url: str) -> tuple[str, BeautifulSoup] | None:
        try:
            response = self.context.get(page_url, label="All-Grades")
            response.raise_for_status()
        except Exception as ex:
            self.context.log(f"⚠️ [Blackboard] 访问汇总成绩页面失败: {page_url} - {ex}")
            return None

        selected_source_url = str(response.url)
        self.context.log(f"🔍 [Blackboard] 解析汇总成绩页面: {selected_source_url}")
        return selected_source_url, BeautifulSoup(response.text, "html.parser")

    def _all_grades_candidate_links(self, soup: BeautifulSoup) -> list[Tag]:
        scoped_links: list[Tag] = []
        for container_selector in (
            "#courses",
            "#course_list",
            ".courseList",
            ".myGrades",
            ".gradesList",
            "#grades_wrapper",
            "#contentPanel",
        ):
            for container in soup.select(container_selector):
                scoped_links.extend(container.find_all("a", href=True))
        return scoped_links or soup.find_all("a", href=True)

    def _is_grade_course_link(self, href: str) -> bool:
        lower_href = href.lower()
        return (
            "course_id=" in lower_href
            or "viewgrades" in lower_href
            or "mygrades" in lower_href
        )

    def _all_grades_link_text(self, link: Tag) -> str:
        raw_text = link.get_text(" ", strip=True)
        parent_block = link.find_parent(["li", "tr", "div"])
        parent_text = parent_block.get_text(" ", strip=True) if parent_block else ""
        if parent_text and len(parent_text) > len(raw_text):
            return parent_text
        return raw_text

    def _extract_discovered_grade_course(
        self,
        link: Tag,
        seen_course_ids: set[str],
    ) -> dict[str, str] | None:
        href = str(link.get("href") or "").strip()
        if not href or not self._is_grade_course_link(href):
            return None

        course_id = self.context.extract_course_id(href)
        if not course_id or course_id in seen_course_ids:
            return None

        raw_text = self._all_grades_link_text(link)
        course_name, listed_grade = extract_course_name_and_listed_grade(raw_text)
        if not course_name:
            course_name = link.get_text(" ", strip=True)
        if not course_name:
            return None

        return {
            "course_id": course_id,
            "course_name": course_name,
            "listed_grade": listed_grade,
        }

    def _discover_grade_courses_from_soup(
        self,
        soup: BeautifulSoup,
        seen_course_ids: set[str],
    ) -> list[dict[str, str]]:
        candidate_links = self._all_grades_candidate_links(soup)
        self.context.log(
            f"🔍 [Blackboard] 汇总成绩页候选链接数: {len(candidate_links)}"
        )
        discovered_courses: list[dict[str, str]] = []
        for link in candidate_links:
            course = self._extract_discovered_grade_course(link, seen_course_ids)
            if course is None:
                continue
            seen_course_ids.add(course["course_id"])
            discovered_courses.append(course)
            self.context.log(
                "🔍 [Blackboard] 发现课程: "
                f"id='{course['course_id']}', "
                f"name='{course['course_name']}', "
                f"listed_grade='{course['listed_grade']}'"
            )
        return discovered_courses

    def _discover_courses_from_all_grades_pages(
        self,
    ) -> tuple[str, list[dict[str, str]], set[str]]:
        selected_source_url = ""
        discovered_courses: list[dict[str, str]] = []
        seen_course_ids: set[str] = set()

        for page_url in self._all_grades_candidate_urls():
            page = self._load_all_grades_page(page_url)
            if page is None:
                continue
            selected_source_url, soup = page
            discovered_courses = self._discover_grade_courses_from_soup(
                soup,
                seen_course_ids,
            )
            if discovered_courses:
                break

        return selected_source_url, discovered_courses, seen_course_ids

    def _extend_fallback_grade_courses(
        self,
        discovered_courses: list[dict[str, str]],
        seen_course_ids: set[str],
        fallback_course_loader: Callable[[], Sequence[object]] | None,
    ) -> None:
        if discovered_courses or fallback_course_loader is None:
            return

        self.context.log(
            "⚠️ [Blackboard] 未在'我的成绩'页面解析到课程列表，回退到课程模块列表"
        )
        for course in fallback_course_loader():
            course_id = self._course_field(course, "course_id", "id")
            course_name = self._course_field(course, "name", "course_name")
            if not course_id or course_id in seen_course_ids:
                continue
            seen_course_ids.add(course_id)
            discovered_courses.append(
                {
                    "course_id": course_id,
                    "course_name": course_name,
                    "listed_grade": "",
                }
            )

    def _empty_course_grade_stats(self) -> dict[str, int | float | None]:
        return {
            "total_items": 0,
            "graded_items": 0,
            "average_score": None,
        }

    def _load_course_grade_detail(
        self,
        course_id: str,
        course_grade_loader: Callable[[str], CourseGradesDTO],
    ) -> CourseGradesDTO:
        try:
            return course_grade_loader(course_id)
        except Exception as ex:
            self.context.log(f"⚠️ [Blackboard] 获取课程成绩详情失败: {course_id} - {ex}")
            return CourseGradesDTO(
                course_id=course_id,
                total_grade="",
                items=[],
                stats=self._empty_course_grade_stats(),
                source_url="",
            )

    def _build_all_grades_course_dto(
        self,
        item: Mapping[str, str],
        grade_detail: CourseGradesDTO,
    ) -> AllGradesCourseDTO:
        listed_grade = str(item.get("listed_grade") or "").strip()
        return AllGradesCourseDTO(
            course_id=str(item.get("course_id") or "").strip(),
            course_name=str(item.get("course_name") or "").strip(),
            listed_grade=listed_grade,
            total_grade=grade_detail.total_grade or listed_grade,
            items=list(grade_detail.items),
            stats=dict(grade_detail.stats or self._empty_course_grade_stats()),
            source_url=grade_detail.source_url,
        )

    def _build_all_grades_result(
        self,
        selected_source_url: str,
        discovered_courses: Sequence[Mapping[str, str]],
        course_grade_loader: Callable[[str], CourseGradesDTO],
    ) -> AllGradesDTO:
        courses_result: dict[str, AllGradesCourseDTO] = {}
        course_order: list[str] = []

        for item in discovered_courses:
            course_id = str(item.get("course_id") or "").strip()
            if not course_id:
                continue
            grade_detail = self._load_course_grade_detail(
                course_id, course_grade_loader
            )
            if course_id not in courses_result:
                course_order.append(course_id)
            courses_result[course_id] = self._build_all_grades_course_dto(
                item,
                grade_detail,
            )

        return AllGradesDTO(
            source_url=selected_source_url,
            total_courses=len(courses_result),
            course_order=course_order,
            courses=courses_result,
        )

    def _course_field(self, item: object, *names: str) -> str:
        if isinstance(item, Mapping):
            for name in names:
                value = item.get(name)
                if value is not None:
                    return str(value).strip()
            return ""

        for name in names:
            if hasattr(item, name):
                value = getattr(item, name)
                if value is not None:
                    return str(value).strip()
        return ""

    def _parse_grade_row(
        self, row: Tag, course_id: str, page_url: str
    ) -> GradeDTO | None:
        gradable_node = row.select_one(".cell.gradable")
        if not gradable_node:
            return None

        raw_name = gradable_node.get_text(" ", strip=True)
        name = normalize_assignment_title(raw_name)
        if not name or is_navigation_noise(name):
            return None
        if name.lower() == "item":
            return None

        activity_text = ""
        activity_node = row.select_one(".cell.activity")
        if activity_node:
            activity_text = activity_node.get_text(" ", strip=True)

        status_text = ""
        status_node = row.select_one(".cell.status")
        if status_node:
            status_text = status_node.get_text(" ", strip=True)

        score_raw = ""
        grade_node = row.select_one(".cell.grade")
        if grade_node:
            score_raw = grade_node.get_text(" ", strip=True)

        score = extract_grade_text(score_raw) or score_raw
        due_date = extract_date_text_safe(f"{raw_name} {activity_text}")
        status = extract_status_text(f"{status_text} {activity_text}")

        row_id = str(row.get("id") or "").strip()
        first_link = row.find("a", href=True)
        detail_url = (
            self.context.absolute_url(
                page_url, str(first_link.get("href") or "").strip()
            )
            if first_link
            else ""
        )
        grade_id = self._extract_grade_id(detail_url, row_id)

        looks_like_grade_row = bool(score_raw.strip()) or any(
            token in name.lower()
            for token in (
                "作业",
                "assignment",
                "quiz",
                "exam",
                "test",
                "project",
                "实验",
                "测验",
                "grade",
                "total",
            )
        )
        if not looks_like_grade_row:
            return None

        return GradeDTO(
            grade_id=grade_id,
            course_id=course_id,
            assignment_id=None,
            item_name=name,
            score=score.strip(),
            status=status,
            due_date=due_date,
            source_url=page_url,
        )

    def _extract_grade_id(self, url: str, row_id: str) -> str | None:
        if url:
            ids = self.context.extract_ids(
                url, id_types=("pk1", "xid", "rid", "content_id")
            )
            result = (
                ids.get("pk1")
                or ids.get("xid")
                or ids.get("rid")
                or ids.get("content_id")
            )
            if result:
                return result

        cleaned_row_id = row_id.strip()
        if cleaned_row_id:
            match = re.search(r"(\d+)$", cleaned_row_id)
            if match:
                return match.group(1)

        return None

    def _extract_total_grade(self, grade_items: list[GradeDTO], page_text: str) -> str:
        for item in grade_items:
            name = str(item.item_name or "").strip().lower()
            score = str(item.score or "").strip()
            if name in ("course grade", "total", "weighted total") and score not in (
                "",
                "-",
                "--",
                "n/a",
            ):
                return score

        total_match = re.search(
            r"(?:课程总成绩|总评|总成绩|Final Grade|Total(?: Grade)?)\s*[:：]?\s*([A-F][\+\-]?|\d+(?:\.\d+)?\s*%?)",
            page_text,
            re.IGNORECASE,
        )
        if total_match:
            return total_match.group(1).strip()
        return ""

    def _dedupe_grade_items(self, grade_items: list[GradeDTO]) -> list[GradeDTO]:
        seen_item_keys: set[str] = set()
        deduped_items: list[GradeDTO] = []
        for item in grade_items:
            key = f"{item.item_name}|{item.score}|{item.due_date}"
            if key in seen_item_keys:
                continue
            seen_item_keys.add(key)
            deduped_items.append(item)
        return deduped_items

    def _build_stats(
        self, grade_items: list[GradeDTO]
    ) -> dict[str, int | float | None]:
        numeric_values: list[float] = []
        graded_items = 0
        for item in grade_items:
            score_text = str(item.score or "").strip()
            ratio_match = re.search(
                r"(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)", score_text
            )
            percent_match = re.search(r"(\d+(?:\.\d+)?)\s*%", score_text)
            number_match = re.search(r"^(\d+(?:\.\d+)?)$", score_text)
            if ratio_match:
                numerator = float(ratio_match.group(1))
                denominator = float(ratio_match.group(2))
                if denominator > 0:
                    numeric_values.append(numerator / denominator * 100)
            elif percent_match:
                numeric_values.append(float(percent_match.group(1)))
            elif number_match:
                numeric_values.append(float(number_match.group(1)))

            if score_text and score_text not in ("-", "--", "n/a", "N/A"):
                graded_items += 1

        return {
            "total_items": len(grade_items),
            "graded_items": graded_items,
            "average_score": round(sum(numeric_values) / len(numeric_values), 2)
            if numeric_values
            else None,
        }

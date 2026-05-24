"""Blackboard 作业抓取 API。"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
import re
from urllib.parse import parse_qs, urlparse

from bs4 import BeautifulSoup
from bs4.element import Tag

from .context import BlackboardAPIContext
from .dto import AssignmentAttachmentDTO, AssignmentDTO
from app.integrations.sustech.blackboard.shared import parse_loose_datetime

from .scrape_support import (
    extract_date_text_safe,
    extract_status_text,
    is_course_content_page_url,
    is_navigation_noise,
    is_valid_assignment,
    normalize_assignment_title,
    parse_datetime_safe,
)


def _extract_node_inner_html(node: Tag | None) -> str:
    if not isinstance(node, Tag):
        return ""
    return node.decode_contents().strip()


def _first_non_empty_text(*values: str | None) -> str | None:
    for value in values:
        text = str(value or "").strip()
        if text:
            return text
    return None


def _normalize_compact_text(value: str | None) -> str:
    return " ".join(str(value or "").split()).strip().lower()


_ASSIGNMENT_START_PATTERNS = (
    r"(?:Available\s+from|Display\s+After|Starts?|Opens?|Release(?:d)?(?:\s+date)?|开放(?:时间|日期)?|开始(?:时间|日期)?|发布(?:时间|日期)?)\s*[:：]?\s*([^\n\r;；]+)",
)
_ASSIGNMENT_END_PATTERNS = (
    r"(?:Available\s+until|Display\s+Until|Ends?|Closes?|Due(?:\s+Date)?|截止(?:时间|日期)?|结束(?:时间|日期)?)\s*[:：]?\s*([^\n\r;；]+)",
)


def _extract_assignment_datetime_by_patterns(
    text: str,
    patterns: tuple[str, ...],
) -> datetime | None:
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if not match:
            continue
        candidate = str(match.group(1) or "").strip()
        parsed = parse_loose_datetime(candidate) or parse_loose_datetime(
            extract_date_text_safe(candidate)
        )
        if parsed is not None:
            return parsed
    return None


def _extract_assignment_time_range(*texts: str | None) -> tuple[datetime | None, datetime | None]:
    joined_text = " ".join(
        str(text or "").strip() for text in texts if str(text or "").strip()
    )
    if not joined_text:
        return None, None

    start_time = _extract_assignment_datetime_by_patterns(
        joined_text,
        _ASSIGNMENT_START_PATTERNS,
    )
    end_time = _extract_assignment_datetime_by_patterns(
        joined_text,
        _ASSIGNMENT_END_PATTERNS,
    )
    return start_time, end_time


def _strip_html_tags(value: str | None) -> str | None:
    html = str(value or "").strip()
    if not html:
        return None
    return BeautifulSoup(html, "html.parser").get_text(" ", strip=True) or None


def _prefer_fallback_when_primary_is_title_shell(
    *,
    title: str,
    primary_text: str | None,
    primary_html: str | None,
    fallback_text: str | None,
    fallback_html: str | None,
) -> tuple[str | None, str | None]:
    normalized_title = _normalize_compact_text(title)
    normalized_primary_text = _normalize_compact_text(primary_text)
    normalized_primary_html_text = _normalize_compact_text(
        _strip_html_tags(primary_html)
    )
    primary_looks_like_title_shell = bool(normalized_title) and (
        normalized_primary_text == normalized_title
        or normalized_primary_html_text == normalized_title
    )
    if primary_looks_like_title_shell:
        return (
            _first_non_empty_text(fallback_text, primary_text),
            _first_non_empty_text(fallback_html, primary_html),
        )
    return (
        _first_non_empty_text(primary_text, fallback_text),
        _first_non_empty_text(primary_html, fallback_html),
    )


class BlackboardAssignmentAPI:
    """负责 Blackboard 作业列表与详情抓取。"""

    _ASSIGNMENT_KEYWORDS = (
        "assignment",
        "作业",
        "homework",
        "quiz",
        "project",
        "lab",
        "实验",
        "测验",
    )

    _ASSIGNMENT_FALLBACK_KEYWORDS = (
        "assignment",
        "作业",
        "homework",
        "quiz",
        "project",
        "due",
    )

    _ANNOUNCEMENT_FALLBACK_MARKERS = (
        "posted on",
        "posted by",
        "posted to",
        "发布于",
        "发布时间",
    )
    _STRONG_ASSIGNMENT_URL_MARKERS = (
        "/webapps/assignment/",
        "/bb-assignment-",
        "/bb-mygrades-",
    )

    _IGNORED_ASSIGNMENT_TITLES = ("item", "course grade", "total", "weighted total")

    def __init__(self, context: BlackboardAPIContext) -> None:
        self.context = context

    def get_course_assignments(self, course_id: str) -> list[AssignmentDTO]:
        """获取课程作业列表。"""
        self.context.log(f"🔍 [Blackboard] 开始获取作业列表, course_id={course_id}")

        assignments: list[AssignmentDTO] = []
        seen_keys: set[str] = set()

        queue = self._build_assignment_candidate_urls(course_id)
        queued_urls = {
            self._normalize_assignment_page_url(url) for url in queue if url.strip()
        }
        visited_urls: set[str] = set()

        max_pages = 40
        while queue and len(visited_urls) < max_pages:
            page_url = queue.pop(0)
            normalized_page_url = self._normalize_assignment_page_url(page_url)
            queued_urls.discard(normalized_page_url)
            if not normalized_page_url or normalized_page_url in visited_urls:
                continue
            visited_urls.add(normalized_page_url)

            soup = self._fetch_assignment_page(page_url)
            if soup is None:
                continue

            row_assignments = self._collect_row_assignments(
                course_id, page_url, soup, seen_keys
            )
            assignments.extend(row_assignments)
            if row_assignments:
                self._enqueue_assignment_content_page_urls(
                    queue,
                    queued_urls,
                    visited_urls,
                    self._discover_assignment_content_page_urls(
                        soup,
                        page_url,
                        course_id,
                    ),
                )
                continue

            assignments.extend(
                self._collect_fallback_assignments(course_id, page_url, soup, seen_keys)
            )

            self._enqueue_assignment_content_page_urls(
                queue,
                queued_urls,
                visited_urls,
                self._discover_assignment_content_page_urls(
                    soup,
                    page_url,
                    course_id,
                ),
            )

        assignments.sort(
            key=lambda item: item.due_date_parsed or parse_datetime_safe(""),
            reverse=True,
        )
        self.context.log(f"✅ [Blackboard] 作业解析完成，共 {len(assignments)} 条")
        return assignments

    def _build_assignment_candidate_urls(self, course_id: str) -> list[str]:
        return [
            f"{self.context.base_url}/webapps/bb-mygrades-BBLEARN/myGrades?course_id={course_id}&stream_name=mygrades&is_stream=false",
            f"{self.context.base_url}/webapps/bb-assignment-BBLEARN/execute/manageCourseAssignment?course_id={course_id}",
            f"{self.context.base_url}/webapps/blackboard/content/listContent.jsp?course_id={course_id}",
            f"{self.context.base_url}/webapps/blackboard/execute/launcher?type=Course&id={course_id}",
        ]

    def _normalize_assignment_page_url(self, url: str) -> str:
        return urlparse(str(url or ""))._replace(fragment="").geturl()

    def _discover_assignment_content_page_urls(
        self,
        soup: BeautifulSoup,
        page_url: str,
        course_id: str,
    ) -> list[str]:
        discovered: list[str] = []
        seen_urls: set[str] = set()
        current_page_url = self._normalize_assignment_page_url(page_url)

        for link in soup.find_all("a", href=True):
            if not isinstance(link, Tag):
                continue

            href = str(link.get("href") or "").strip()
            if not href:
                continue

            absolute_url = self.context.absolute_url(page_url, href)
            normalized_url = self._normalize_assignment_page_url(absolute_url)
            if not normalized_url or normalized_url == current_page_url:
                continue
            if normalized_url in seen_urls:
                continue
            if not is_course_content_page_url(
                normalized_url,
                course_id,
                base_url=self.context.base_url,
            ):
                continue

            parsed = urlparse(normalized_url)
            if "execute/launcher" in parsed.path.lower():
                continue
            if "content_id" not in parse_qs(parsed.query):
                continue

            seen_urls.add(normalized_url)
            discovered.append(normalized_url)

        return discovered

    def _enqueue_assignment_content_page_urls(
        self,
        queue: list[str],
        queued_urls: set[str],
        visited_urls: set[str],
        candidate_urls: list[str],
    ) -> None:
        for candidate_url in candidate_urls:
            normalized_url = self._normalize_assignment_page_url(candidate_url)
            if (
                not normalized_url
                or normalized_url in queued_urls
                or normalized_url in visited_urls
            ):
                continue
            queue.append(normalized_url)
            queued_urls.add(normalized_url)

    def _fetch_assignment_page(self, page_url: str) -> BeautifulSoup | None:
        try:
            response = self.context.get(page_url, label="Assignments")
            response.raise_for_status()
        except Exception as ex:
            self.context.log(f"⚠️ [Blackboard] 作业页面访问失败: {page_url} - {ex}")
            return None

        self.context.log(f"🔍 [Blackboard] 分析作业页面结构: {page_url}")
        return BeautifulSoup(response.text, "html.parser")

    def _collect_row_assignments(
        self,
        course_id: str,
        page_url: str,
        soup: BeautifulSoup,
        seen_keys: set[str],
    ) -> list[AssignmentDTO]:
        assignments: list[AssignmentDTO] = []
        for row in soup.select("div.sortable_item_row.row"):
            assignment = self._build_assignment_from_row(
                course_id, page_url, row, seen_keys
            )
            if assignment is not None:
                assignments.append(assignment)
        return assignments

    def _build_assignment_from_row(
        self,
        course_id: str,
        page_url: str,
        row: Tag,
        seen_keys: set[str],
    ) -> AssignmentDTO | None:
        gradable_text = self._get_cell_text(row, ".cell.gradable")
        if not gradable_text or is_navigation_noise(gradable_text):
            return None

        title = normalize_assignment_title(gradable_text)
        lower_title = title.lower()
        if lower_title in self._IGNORED_ASSIGNMENT_TITLES:
            return None
        if not self._looks_like_assignment(lower_title, gradable_text):
            return None

        detail_url = self._resolve_assignment_detail_url(page_url, row)
        assignment_id = self._extract_assignment_id(detail_url)
        detail = self.get_assignment_details(detail_url) if detail_url else None
        attachments = self._collect_row_assignment_attachments(
            page_url, row, detail_url
        )
        attachments = self._merge_attachment_lists(
            attachments,
            detail.attachments if detail is not None else [],
        )

        due_date = extract_date_text_safe(
            f"{gradable_text} {self._get_cell_text(row, '.cell.activity')}"
        )
        status = extract_status_text(
            " ".join(
                [
                    self._get_cell_text(row, ".cell.status"),
                    self._get_cell_text(row, ".cell.activity"),
                    self._get_cell_text(row, ".cell.grade"),
                ]
            )
        )
        summary = row.get_text(" ", strip=True)[:240]
        start_time, end_time = _extract_assignment_time_range(
            row.get_text(" ", strip=True),
            detail.description if detail is not None else None,
            detail.description_html if detail is not None else None,
        )
        if detail is not None:
            start_time = start_time or detail.start_time
            end_time = end_time or detail.end_time
        return self._build_assignment_dto(
            course_id=course_id,
            assignment_id=assignment_id,
            title=title,
            detail_url=detail_url,
            due_date=due_date,
            status=status,
            summary=summary,
            page_url=page_url,
            description=detail.description if detail is not None else None,
            description_html=detail.description_html if detail is not None else None,
            attachments=attachments,
            seen_keys=seen_keys,
            start_time=start_time,
            end_time=end_time,
        )

    def _collect_fallback_assignments(
        self,
        course_id: str,
        page_url: str,
        soup: BeautifulSoup,
        seen_keys: set[str],
    ) -> list[AssignmentDTO]:
        assignments: list[AssignmentDTO] = []
        for container in self._collect_assignment_candidate_containers(soup):
            assignment = self._build_assignment_from_container(
                course_id,
                page_url,
                container,
                seen_keys,
            )
            if assignment is not None:
                assignments.append(assignment)
        return assignments

    def _collect_assignment_candidate_containers(
        self, soup: BeautifulSoup
    ) -> list[Tag]:
        candidate_containers: list[Tag] = []
        seen_ids: set[int] = set()

        for selector in (
            "li[id^='contentListItem:']",
            "div.sortable_item_row.row",
            "tr[id^='contentListItem:']",
        ):
            for node in soup.select(selector):
                marker = id(node)
                if marker in seen_ids:
                    continue
                seen_ids.add(marker)
                candidate_containers.append(node)

        if candidate_containers:
            return candidate_containers

        for container in soup.find_all(["li", "div", "tr"]):
            marker = id(container)
            if marker in seen_ids:
                continue
            seen_ids.add(marker)
            candidate_containers.append(container)
        return candidate_containers

    def _build_assignment_from_container(
        self,
        course_id: str,
        page_url: str,
        container: Tag,
        seen_keys: set[str],
    ) -> AssignmentDTO | None:
        text = container.get_text(" ", strip=True)
        if not text or is_navigation_noise(text):
            return None

        container_id = str(container.get("id") or "").strip()
        has_assignment_structure = bool(
            container.select_one(
                ".details, .vtbegenerated, .contextItemDetailsHeaders, .cell.gradable"
            )
        )
        if not has_assignment_structure and not container_id.startswith(
            "contentListItem:"
        ):
            return None

        lower_text = text.lower()
        if not any(token in lower_text for token in self._ASSIGNMENT_FALLBACK_KEYWORDS):
            return None

        title = self._extract_assignment_container_title(container, text)
        if not title:
            return None

        detail_url = self._resolve_assignment_container_detail_url(page_url, container)
        if not detail_url:
            return None
        if self._looks_like_announcement_fallback_container(
            container=container,
            text=text,
            detail_url=detail_url,
        ):
            return None

        assignment_id = self._extract_assignment_id(detail_url)
        (
            inline_description,
            inline_description_html,
            inline_attachments,
        ) = self._extract_assignment_container_inline_details(
            page_url,
            container,
            detail_url,
        )
        detail = self.get_assignment_details(detail_url)
        description, description_html = _prefer_fallback_when_primary_is_title_shell(
            title=title,
            primary_text=detail.description if detail is not None else None,
            primary_html=detail.description_html if detail is not None else None,
            fallback_text=inline_description,
            fallback_html=inline_description_html,
        )
        attachments = self._merge_attachment_lists(
            inline_attachments,
            detail.attachments if detail is not None else [],
        )
        start_time, end_time = _extract_assignment_time_range(
            text,
            inline_description,
            inline_description_html,
            detail.description if detail is not None else None,
            detail.description_html if detail is not None else None,
        )
        if detail is not None:
            start_time = start_time or detail.start_time
            end_time = end_time or detail.end_time
        return self._build_assignment_dto(
            course_id=course_id,
            assignment_id=assignment_id,
            title=title,
            detail_url=detail_url,
            due_date=extract_date_text_safe(text),
            status=extract_status_text(text),
            summary=text[:240],
            page_url=page_url,
            description=description,
            description_html=description_html,
            attachments=attachments,
            seen_keys=seen_keys,
            start_time=start_time,
            end_time=end_time,
        )

    def _extract_assignment_container_inline_details(
        self,
        page_url: str,
        container: Tag,
        detail_url: str,
    ) -> tuple[str | None, str | None, list[AssignmentAttachmentDTO]]:
        details_scope = container.select_one(".details")
        scope = details_scope if isinstance(details_scope, Tag) else container
        description_node = scope.select_one(
            ".vtbegenerated, .description, #description"
        )
        description = (
            description_node.get_text(" ", strip=True)
            if isinstance(description_node, Tag)
            else ""
        )
        description_html = (
            _extract_node_inner_html(description_node)
            if isinstance(description_node, Tag)
            else ""
        )
        attachments = self._collect_row_assignment_attachments(
            page_url,
            scope,
            detail_url,
        )
        return (
            _first_non_empty_text(description),
            _first_non_empty_text(description_html),
            attachments,
        )

    def _extract_assignment_container_title(
        self, container: Tag, fallback_text: str
    ) -> str:
        title_node = container.find("h3")
        if isinstance(title_node, Tag):
            title = normalize_assignment_title(title_node.get_text(" ", strip=True))
            if title:
                return title

        link = container.select_one(".item a[href]") or container.find("a", href=True)
        if isinstance(link, Tag):
            title = normalize_assignment_title(
                link.get_text(strip=True) or fallback_text[:100]
            )
            if title:
                return title
        return normalize_assignment_title(fallback_text[:100])

    def _resolve_assignment_container_detail_url(
        self, page_url: str, container: Tag
    ) -> str:
        title_link = container.select_one(".item a[href], h3 a[href]")
        if isinstance(title_link, Tag):
            detail_url = self.context.absolute_url(
                page_url,
                str(title_link.get("href") or "").strip(),
            )
            if detail_url:
                return detail_url

        container_id = str(container.get("id") or "").strip()
        return f"{page_url}#{container_id}" if container_id else page_url

    def _looks_like_announcement_fallback_container(
        self,
        *,
        container: Tag,
        text: str,
        detail_url: str,
    ) -> bool:
        if self._has_strong_assignment_detail_url(detail_url):
            return False

        if container.select_one(".announcementInfo") is not None:
            return True

        block_hint = " ".join(
            str(value or "")
            for value in (
                container.get("id"),
                " ".join(str(item) for item in (container.get("class") or [])),
                container.parent.get("id") if isinstance(container.parent, Tag) else "",
                " ".join(str(item) for item in (container.parent.get("class") or []))
                if isinstance(container.parent, Tag)
                else "",
            )
        ).lower()
        if "announcement" in block_hint:
            return True

        lower_text = text.lower()
        return any(marker in lower_text for marker in self._ANNOUNCEMENT_FALLBACK_MARKERS)

    def _has_strong_assignment_detail_url(self, detail_url: str) -> bool:
        lower_url = detail_url.lower()
        return any(marker in lower_url for marker in self._STRONG_ASSIGNMENT_URL_MARKERS)

    def _build_assignment_dto(
        self,
        *,
        course_id: str,
        assignment_id: str | None,
        title: str,
        detail_url: str,
        due_date: str,
        status: str,
        summary: str,
        page_url: str,
        description: str | None,
        description_html: str | None,
        attachments: list[AssignmentAttachmentDTO],
        seen_keys: set[str],
        start_time: datetime | None = None,
        end_time: datetime | None = None,
    ) -> AssignmentDTO | None:
        candidate_assignment = {
            "assignment_id": assignment_id,
            "title": title,
            "url": detail_url,
            "due_date": due_date,
            "status": status,
            "summary": summary,
            "attachments": [
                {"name": item.name, "url": item.url} for item in attachments
            ],
            "source_page": page_url,
        }
        if not is_valid_assignment(
            candidate_assignment,
            logger=self.context.logger.child("api.scrape_support.assignments")
            if self.context.logger is not None
            else None,
        ):
            return None

        key = f"{title}|{detail_url}"
        if key in seen_keys:
            return None
        seen_keys.add(key)

        return AssignmentDTO(
            assignment_id=assignment_id,
            course_id=course_id,
            title=title,
            start_time=start_time,
            end_time=end_time,
            due_date=due_date,
            due_date_parsed=parse_datetime_safe(due_date),
            status=status,
            url=detail_url,
            description=description or None,
            description_html=description_html or None,
            summary=summary,
            source_page=page_url,
            attachments=attachments,
        )

    def _looks_like_assignment(self, lower_title: str, gradable_text: str) -> bool:
        return any(token in lower_title for token in self._ASSIGNMENT_KEYWORDS) or (
            "due" in gradable_text.lower()
        )

    def _get_cell_text(self, row: Tag, selector: str) -> str:
        cell = row.select_one(selector)
        return cell.get_text(" ", strip=True) if cell else ""

    def _resolve_assignment_detail_url(self, page_url: str, row: Tag) -> str:
        first_link = row.find("a", href=True)
        if isinstance(first_link, Tag):
            detail_url = self.context.absolute_url(
                page_url,
                str(first_link.get("href") or "").strip(),
            )
            if detail_url:
                return detail_url

        row_id = str(row.get("id") or "").strip()
        return f"{page_url}#{row_id}" if row_id else page_url

    def _collect_row_assignment_attachments(
        self,
        page_url: str,
        row: Tag,
        detail_url: str,
    ) -> list[AssignmentAttachmentDTO]:
        raw_attachments: list[dict[str, str]] = []
        for att in row.find_all("a", href=True):
            if not isinstance(att, Tag):
                continue
            att_href = self.context.absolute_url(
                page_url, str(att.get("href") or "").strip()
            )
            if not att_href or att_href == detail_url:
                continue
            lowered_href = att_href.lower()
            if any(
                token in lowered_href
                for token in ("/bbcswebdav/", "xid=", "attachment=true")
            ):
                raw_attachments.append(
                    {
                        "title": att.get_text(strip=True)
                        or Path(urlparse(att_href).path).name,
                        "url": att_href,
                    }
                )
        return self._normalize_attachments(
            raw_attachments, self._extract_assignment_id(detail_url), page_url
        )

    def _merge_attachment_lists(
        self,
        primary: list[AssignmentAttachmentDTO],
        secondary: list[AssignmentAttachmentDTO],
    ) -> list[AssignmentAttachmentDTO]:
        merged: list[AssignmentAttachmentDTO] = []
        seen_attachment_urls: set[str] = set()
        for att in primary + secondary:
            att_url = str(att.url or "").strip()
            if not att_url or att_url in seen_attachment_urls:
                continue
            seen_attachment_urls.add(att_url)
            merged.append(att)
        return merged

    def get_assignment_details(self, assignment_url: str) -> AssignmentDTO:
        """获取单个作业详情。"""
        self.context.log(f"🔍 [Blackboard] 开始获取作业详情: {assignment_url}")

        parsed = urlparse(assignment_url)
        fragment = parsed.fragment
        base_url = assignment_url.split("#", 1)[0]

        soup = self._fetch_assignment_detail_soup(base_url)
        if soup is None:
            return self._build_empty_assignment_details(assignment_url)

        row_scope = self._find_assignment_detail_row(soup, fragment)
        scope = row_scope or soup
        title, due_date, status, description, description_html = (
            self._extract_assignment_detail_fields(
                soup,
                row_scope,
            )
        )
        attachments = self._extract_detail_scope_attachments(base_url, scope)
        full_text = soup.get_text(" ", strip=True)

        start_time, end_time = _extract_assignment_time_range(
            full_text,
            description,
            description_html,
        )
        details = AssignmentDTO(
            assignment_id=self._extract_assignment_id(assignment_url),
            course_id=self.context.extract_course_id(assignment_url) or None,
            title=title,
            start_time=start_time,
            end_time=end_time,
            description=description,
            description_html=description_html or None,
            due_date=due_date,
            due_date_parsed=parse_datetime_safe(due_date),
            status=status,
            url=assignment_url,
            attachments=attachments,
        )
        self.context.log(
            f"✅ [Blackboard] 作业详情解析完成: title='{title}', 附件数={len(attachments)}"
        )
        return details

    def _fetch_assignment_detail_soup(self, base_url: str) -> BeautifulSoup | None:
        try:
            response = self.context.get(base_url, label="Assignment-Details")
            response.raise_for_status()
        except Exception as ex:
            self.context.log(f"❌ [Blackboard] 获取作业详情失败: {ex}")
            return None
        return BeautifulSoup(response.text, "html.parser")

    def _build_empty_assignment_details(self, assignment_url: str) -> AssignmentDTO:
        return AssignmentDTO(
            assignment_id=self._extract_assignment_id(assignment_url),
            course_id=self.context.extract_course_id(assignment_url) or None,
            title="",
            start_time=None,
            end_time=None,
            description="",
            description_html=None,
            due_date="",
            status="",
            url=assignment_url,
            attachments=[],
        )

    def _find_assignment_detail_row(
        self,
        soup: BeautifulSoup,
        fragment: str,
    ) -> Tag | None:
        if fragment:
            candidate = soup.find(id=fragment)
            if isinstance(candidate, Tag):
                return candidate

        for row in soup.select("div.sortable_item_row.row"):
            gradable = row.select_one(".cell.gradable")
            if gradable and "assignment" in gradable.get_text(" ", strip=True).lower():
                return row
        return None

    def _extract_assignment_detail_fields(
        self,
        soup: BeautifulSoup,
        row_scope: Tag | None,
    ) -> tuple[str, str, str, str, str | None]:
        if row_scope is not None:
            return self._extract_assignment_detail_fields_from_row(row_scope)
        return self._extract_assignment_detail_fields_from_page(soup)

    def _extract_assignment_detail_fields_from_row(
        self,
        row_scope: Tag,
    ) -> tuple[str, str, str, str, str | None]:
        gradable_text = self._get_cell_text(row_scope, ".cell.gradable")
        activity_text = self._get_cell_text(row_scope, ".cell.activity")
        status_text = self._get_cell_text(row_scope, ".cell.status")
        description_node = row_scope.select_one(
            ".vtbegenerated, .description, #description"
        )
        description_text = (
            description_node.get_text(" ", strip=True)
            if isinstance(description_node, Tag)
            else row_scope.get_text(" ", strip=True)
        )
        description_html = (
            _extract_node_inner_html(description_node)
            if isinstance(description_node, Tag)
            else None
        )
        return (
            normalize_assignment_title(gradable_text),
            extract_date_text_safe(f"{gradable_text} {activity_text}"),
            extract_status_text(f"{status_text} {activity_text}"),
            description_text,
            description_html or None,
        )

    def _extract_assignment_detail_fields_from_page(
        self,
        soup: BeautifulSoup,
    ) -> tuple[str, str, str, str, str | None]:
        title_node = soup.find(["h1", "h2"]) or soup.find("title")
        title = title_node.get_text(" ", strip=True) if title_node else ""
        description, description_html = self._extract_assignment_page_description(soup)
        full_text = soup.get_text(" ", strip=True)
        return (
            title,
            extract_date_text_safe(full_text),
            extract_status_text(full_text),
            description,
            description_html or None,
        )

    def _extract_assignment_page_description(
        self, soup: BeautifulSoup
    ) -> tuple[str, str]:
        for selector in (
            ".vtbegenerated",
            ".description",
            "#description",
            "#content_listContainer",
        ):
            node = soup.select_one(selector)
            if node:
                description = node.get_text(" ", strip=True)
                if description:
                    return description, _extract_node_inner_html(node)

        body = soup.find("body")
        if not isinstance(body, Tag):
            return "", ""
        return body.get_text(" ", strip=True)[:500], _extract_node_inner_html(body)

    def _extract_detail_scope_attachments(
        self,
        base_url: str,
        scope: BeautifulSoup | Tag,
    ) -> list[AssignmentAttachmentDTO]:
        attachments: list[AssignmentAttachmentDTO] = []
        seen_attachment_urls: set[str] = set()
        for link in scope.find_all("a", href=True):
            if not isinstance(link, Tag):
                continue
            href = self.context.absolute_url(
                base_url, str(link.get("href") or "").strip()
            )
            if not href or href in seen_attachment_urls:
                continue
            lowered_href = href.lower()
            if any(
                token in lowered_href
                for token in ("/bbcswebdav/", "xid=", "attachment=true")
            ):
                attachments.append(
                    AssignmentAttachmentDTO(
                        name=link.get_text(strip=True)
                        or Path(urlparse(href).path).name,
                        url=href,
                    )
                )
                seen_attachment_urls.add(href)
        return attachments

    def _extract_assignment_id(self, url: str) -> str | None:
        ids = self.context.extract_ids(
            url, id_types=("pk1", "xid", "rid", "content_id")
        )
        return (
            ids.get("pk1") or ids.get("xid") or ids.get("rid") or ids.get("content_id")
        )

    def _extract_resource_id(self, url: str) -> str | None:
        ids = self.context.extract_ids(url, id_types=("xid", "rid"))
        return ids.get("xid") or ids.get("rid")

    def _normalize_attachments(
        self,
        raw_attachments: list[dict[str, str]],
        assignment_id: str | None,
        base_url: str,
    ) -> list[AssignmentAttachmentDTO]:
        normalized: list[AssignmentAttachmentDTO] = []
        seen_urls: set[str] = set()
        for att in raw_attachments:
            attachment_url = str(att.get("url") or "").strip()
            if not attachment_url:
                continue
            if not attachment_url.startswith("http"):
                attachment_url = self.context.absolute_url(base_url, attachment_url)
            if attachment_url in seen_urls:
                continue
            seen_urls.add(attachment_url)

            title = str(att.get("title") or att.get("name") or "").strip()
            if not title:
                title = Path(urlparse(attachment_url).path).name

            normalized.append(
                AssignmentAttachmentDTO(
                    resource_id=self._extract_resource_id(attachment_url),
                    name=title,
                    url=attachment_url,
                    type="file",
                )
            )
        return normalized

    def _extract_assignment_attachments(
        self,
        detail_url: str,
        page_url: str,
        assignment_id: str | None,
    ) -> list[AssignmentAttachmentDTO]:
        if not detail_url:
            return []

        detail = self.get_assignment_details(detail_url)
        raw_attachments = [
            {
                "title": str(att.name or "").strip(),
                "url": str(att.url or "").strip(),
            }
            for att in detail.attachments
        ]
        return self._normalize_attachments(raw_attachments, assignment_id, page_url)

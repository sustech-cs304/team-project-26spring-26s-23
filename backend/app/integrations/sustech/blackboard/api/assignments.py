"""Blackboard 作业抓取 API。"""

from __future__ import annotations

from pathlib import Path
from urllib.parse import urlparse

from bs4 import BeautifulSoup
from bs4.element import Tag

from .context import BlackboardAPIContext
from .dto import AssignmentAttachmentDTO, AssignmentDTO
from .scrape_support import (
    extract_date_text_safe,
    extract_status_text,
    is_navigation_noise,
    is_valid_assignment,
    normalize_assignment_title,
    parse_datetime_safe,
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

    _IGNORED_ASSIGNMENT_TITLES = ("item", "course grade", "total", "weighted total")

    def __init__(self, context: BlackboardAPIContext) -> None:
        self.context = context

    def get_course_assignments(self, course_id: str) -> list[AssignmentDTO]:
        """获取课程作业列表。"""
        self.context.log(f"🔍 [Blackboard] 开始获取作业列表, course_id={course_id}")

        assignments: list[AssignmentDTO] = []
        seen_keys: set[str] = set()

        for page_url in self._build_assignment_candidate_urls(course_id):
            soup = self._fetch_assignment_page(page_url)
            if soup is None:
                continue

            assignments.extend(
                self._collect_row_assignments(course_id, page_url, soup, seen_keys)
            )
            if assignments:
                continue

            assignments.extend(
                self._collect_fallback_assignments(course_id, page_url, soup, seen_keys)
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
        ]

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
            assignment = self._build_assignment_from_row(course_id, page_url, row, seen_keys)
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
        attachments = self._collect_row_assignment_attachments(page_url, row, detail_url)
        attachments = self._merge_attachment_lists(
            attachments,
            self._extract_assignment_attachments(detail_url, page_url, assignment_id),
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
        return self._build_assignment_dto(
            course_id=course_id,
            assignment_id=assignment_id,
            title=title,
            detail_url=detail_url,
            due_date=due_date,
            status=status,
            summary=summary,
            page_url=page_url,
            attachments=attachments,
            seen_keys=seen_keys,
        )

    def _collect_fallback_assignments(
        self,
        course_id: str,
        page_url: str,
        soup: BeautifulSoup,
        seen_keys: set[str],
    ) -> list[AssignmentDTO]:
        assignments: list[AssignmentDTO] = []
        for container in soup.find_all(["li", "div", "tr"]):
            assignment = self._build_assignment_from_container(
                course_id,
                page_url,
                container,
                seen_keys,
            )
            if assignment is not None:
                assignments.append(assignment)
        return assignments

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

        lower_text = text.lower()
        if not any(token in lower_text for token in self._ASSIGNMENT_FALLBACK_KEYWORDS):
            return None

        link = container.find("a", href=True)
        if not isinstance(link, Tag):
            return None

        title = normalize_assignment_title(link.get_text(strip=True) or text[:100])
        detail_url = self.context.absolute_url(page_url, str(link.get("href") or "").strip())
        if not detail_url:
            return None

        assignment_id = self._extract_assignment_id(detail_url)
        attachments = self._extract_assignment_attachments(detail_url, page_url, assignment_id)
        return self._build_assignment_dto(
            course_id=course_id,
            assignment_id=assignment_id,
            title=title,
            detail_url=detail_url,
            due_date=extract_date_text_safe(text),
            status=extract_status_text(text),
            summary=text[:240],
            page_url=page_url,
            attachments=attachments,
            seen_keys=seen_keys,
        )

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
        attachments: list[AssignmentAttachmentDTO],
        seen_keys: set[str],
    ) -> AssignmentDTO | None:
        candidate_assignment = {
            "assignment_id": assignment_id,
            "title": title,
            "url": detail_url,
            "due_date": due_date,
            "status": status,
            "summary": summary,
            "attachments": [{"name": item.name, "url": item.url} for item in attachments],
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
            due_date=due_date,
            due_date_parsed=parse_datetime_safe(due_date),
            status=status,
            url=detail_url,
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
            att_href = self.context.absolute_url(page_url, str(att.get("href") or "").strip())
            if not att_href or att_href == detail_url:
                continue
            if any(
                token in att_href.lower()
                for token in ("/bbcswebdav/", "download", "attachment", "file")
            ):
                raw_attachments.append(
                    {
                        "title": att.get_text(strip=True)
                        or Path(urlparse(att_href).path).name,
                        "url": att_href,
                    }
                )
        return self._normalize_attachments(raw_attachments, self._extract_assignment_id(detail_url), page_url)

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
        title, due_date, status, description = self._extract_assignment_detail_fields(
            soup,
            row_scope,
        )
        attachments = self._extract_detail_scope_attachments(base_url, scope)

        details = AssignmentDTO(
            assignment_id=self._extract_assignment_id(assignment_url),
            course_id=self.context.extract_course_id(assignment_url) or None,
            title=title,
            description=description[:600],
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
            description="",
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
    ) -> tuple[str, str, str, str]:
        if row_scope is not None:
            return self._extract_assignment_detail_fields_from_row(row_scope)
        return self._extract_assignment_detail_fields_from_page(soup)

    def _extract_assignment_detail_fields_from_row(
        self,
        row_scope: Tag,
    ) -> tuple[str, str, str, str]:
        gradable_text = self._get_cell_text(row_scope, ".cell.gradable")
        activity_text = self._get_cell_text(row_scope, ".cell.activity")
        status_text = self._get_cell_text(row_scope, ".cell.status")
        return (
            normalize_assignment_title(gradable_text),
            extract_date_text_safe(f"{gradable_text} {activity_text}"),
            extract_status_text(f"{status_text} {activity_text}"),
            row_scope.get_text(" ", strip=True),
        )

    def _extract_assignment_detail_fields_from_page(
        self,
        soup: BeautifulSoup,
    ) -> tuple[str, str, str, str]:
        title_node = soup.find(["h1", "h2"]) or soup.find("title")
        title = title_node.get_text(" ", strip=True) if title_node else ""
        description = self._extract_assignment_page_description(soup)
        full_text = soup.get_text(" ", strip=True)
        return (
            title,
            extract_date_text_safe(full_text),
            extract_status_text(full_text),
            description,
        )

    def _extract_assignment_page_description(self, soup: BeautifulSoup) -> str:
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
                    return description

        body = soup.find("body")
        return body.get_text(" ", strip=True)[:500] if body else ""

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
            href = self.context.absolute_url(base_url, str(link.get("href") or "").strip())
            if not href or href in seen_attachment_urls:
                continue
            if any(
                token in href.lower()
                for token in ("/bbcswebdav/", "download", "attachment", "file")
            ):
                attachments.append(
                    AssignmentAttachmentDTO(
                        name=link.get_text(strip=True) or Path(urlparse(href).path).name,
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

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

    def __init__(self, context: BlackboardAPIContext) -> None:
        self.context = context

    def get_course_assignments(self, course_id: str) -> list[AssignmentDTO]:
        """获取课程作业列表。"""
        self.context.log(f"🔍 [Blackboard] 开始获取作业列表, course_id={course_id}")

        candidate_urls = [
            f"{self.context.base_url}/webapps/bb-mygrades-BBLEARN/myGrades?course_id={course_id}&stream_name=mygrades&is_stream=false",
            f"{self.context.base_url}/webapps/bb-assignment-BBLEARN/execute/manageCourseAssignment?course_id={course_id}",
            f"{self.context.base_url}/webapps/blackboard/content/listContent.jsp?course_id={course_id}",
        ]

        assignments: list[AssignmentDTO] = []
        seen_keys: set[str] = set()

        for page_url in candidate_urls:
            try:
                response = self.context.get(page_url, label="Assignments")
                response.raise_for_status()
            except Exception as ex:
                self.context.log(f"⚠️ [Blackboard] 作业页面访问失败: {page_url} - {ex}")
                continue

            soup = BeautifulSoup(response.text, "html.parser")
            self.context.log(f"🔍 [Blackboard] 分析作业页面结构: {page_url}")

            rows = soup.select("div.sortable_item_row.row")
            for row in rows:
                gradable_node = row.select_one(".cell.gradable")
                if not gradable_node:
                    continue

                gradable_text = gradable_node.get_text(" ", strip=True)
                if not gradable_text or is_navigation_noise(gradable_text):
                    continue

                title = normalize_assignment_title(gradable_text)
                lower_title = title.lower()
                if lower_title in ("item", "course grade", "total", "weighted total"):
                    continue

                if not any(token in lower_title for token in ("assignment", "作业", "homework", "quiz", "project", "lab", "实验", "测验")):
                    if "due" not in gradable_text.lower():
                        continue

                activity_text = ""
                activity_node = row.select_one(".cell.activity")
                if activity_node:
                    activity_text = activity_node.get_text(" ", strip=True)

                grade_text = ""
                grade_node = row.select_one(".cell.grade")
                if grade_node:
                    grade_text = grade_node.get_text(" ", strip=True)

                status_text = ""
                status_node = row.select_one(".cell.status")
                if status_node:
                    status_text = status_node.get_text(" ", strip=True)

                first_link = row.find("a", href=True)
                detail_url = self.context.absolute_url(page_url, str(first_link.get("href") or "").strip()) if first_link else ""
                row_id = str(row.get("id") or "").strip()
                if not detail_url:
                    detail_url = f"{page_url}#{row_id}" if row_id else page_url

                row_attachments: list[dict[str, str]] = []
                for att in row.find_all("a", href=True):
                    att_href = self.context.absolute_url(page_url, str(att.get("href") or "").strip())
                    if not att_href or att_href == detail_url:
                        continue
                    if any(token in att_href.lower() for token in ("/bbcswebdav/", "download", "attachment", "file")):
                        row_attachments.append(
                            {
                                "title": att.get_text(strip=True) or Path(urlparse(att_href).path).name,
                                "url": att_href,
                            }
                        )

                assignment_id = self._extract_assignment_id(detail_url)
                attachments = self._normalize_attachments(row_attachments, assignment_id, page_url)
                detail_attachments = self._extract_assignment_attachments(detail_url, page_url, assignment_id)
                if detail_attachments:
                    merged: list[AssignmentAttachmentDTO] = []
                    seen_attachment_urls: set[str] = set()
                    for att in attachments + detail_attachments:
                        att_url = str(att.url or "").strip()
                        if not att_url or att_url in seen_attachment_urls:
                            continue
                        seen_attachment_urls.add(att_url)
                        merged.append(att)
                    attachments = merged

                due_date = extract_date_text_safe(f"{gradable_text} {activity_text}")
                status = extract_status_text(f"{status_text} {activity_text} {grade_text}")
                summary = row.get_text(" ", strip=True)

                candidate_assignment = {
                    "assignment_id": assignment_id,
                    "title": title,
                    "url": detail_url,
                    "due_date": due_date,
                    "status": status,
                    "summary": summary[:240],
                    "attachments": [{"name": item.name, "url": item.url} for item in attachments],
                    "source_page": page_url,
                }
                if not is_valid_assignment(
                    candidate_assignment,
                    logger=self.context.logger.child("api.scrape_support.assignments") if self.context.logger is not None else None,
                ):
                    continue

                key = f"{title}|{detail_url}"
                if key in seen_keys:
                    continue

                assignments.append(
                    AssignmentDTO(
                        assignment_id=assignment_id,
                        course_id=course_id,
                        title=title,
                        due_date=due_date,
                        due_date_parsed=parse_datetime_safe(due_date),
                        status=status,
                        url=detail_url,
                        summary=summary[:240],
                        source_page=page_url,
                        attachments=attachments,
                    )
                )
                seen_keys.add(key)

            if assignments:
                continue

            for container in soup.find_all(["li", "div", "tr"]):
                text = container.get_text(" ", strip=True)
                if not text or is_navigation_noise(text):
                    continue

                lower_text = text.lower()
                if not any(token in lower_text for token in ("assignment", "作业", "homework", "quiz", "project", "due")):
                    continue

                link = container.find("a", href=True)
                if not link:
                    continue

                title = normalize_assignment_title(link.get_text(strip=True) or text[:100])
                detail_url = self.context.absolute_url(page_url, str(link.get("href") or "").strip())
                if not detail_url:
                    continue

                assignment_id = self._extract_assignment_id(detail_url)
                attachments = self._extract_assignment_attachments(detail_url, page_url, assignment_id)

                candidate_assignment = {
                    "assignment_id": assignment_id,
                    "title": title,
                    "url": detail_url,
                    "due_date": extract_date_text_safe(text),
                    "status": extract_status_text(text),
                    "summary": text[:240],
                    "attachments": [{"name": item.name, "url": item.url} for item in attachments],
                    "source_page": page_url,
                }
                if not is_valid_assignment(
                    candidate_assignment,
                    logger=self.context.logger.child("api.scrape_support.assignments") if self.context.logger is not None else None,
                ):
                    continue

                key = f"{title}|{detail_url}"
                if key in seen_keys:
                    continue

                assignments.append(
                    AssignmentDTO(
                        assignment_id=assignment_id,
                        course_id=course_id,
                        title=title,
                        due_date=str(candidate_assignment["due_date"] or ""),
                        due_date_parsed=parse_datetime_safe(str(candidate_assignment["due_date"] or "")),
                        status=str(candidate_assignment["status"] or ""),
                        url=detail_url,
                        summary=text[:240],
                        source_page=page_url,
                        attachments=attachments,
                    )
                )
                seen_keys.add(key)

        assignments.sort(key=lambda item: item.due_date_parsed or parse_datetime_safe(""), reverse=True)
        self.context.log(f"✅ [Blackboard] 作业解析完成，共 {len(assignments)} 条")
        return assignments

    def get_assignment_details(self, assignment_url: str) -> AssignmentDTO:
        """获取单个作业详情。"""
        self.context.log(f"🔍 [Blackboard] 开始获取作业详情: {assignment_url}")

        parsed = urlparse(assignment_url)
        fragment = parsed.fragment
        base_url = assignment_url.split("#", 1)[0]

        try:
            response = self.context.get(base_url, label="Assignment-Details")
            response.raise_for_status()
        except Exception as ex:
            self.context.log(f"❌ [Blackboard] 获取作业详情失败: {ex}")
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

        soup = BeautifulSoup(response.text, "html.parser")
        row_scope: Tag | None = None
        if fragment:
            candidate = soup.find(id=fragment)
            if isinstance(candidate, Tag):
                row_scope = candidate

        if row_scope is None:
            rows = soup.select("div.sortable_item_row.row")
            for row in rows:
                gradable = row.select_one(".cell.gradable")
                if gradable and "assignment" in gradable.get_text(" ", strip=True).lower():
                    row_scope = row
                    break

        scope: Tag = row_scope if row_scope is not None else soup  # type: ignore[assignment]

        title = ""
        due_date = ""
        status = ""
        description = ""

        if row_scope is not None:
            gradable_node = row_scope.select_one(".cell.gradable")
            activity_node = row_scope.select_one(".cell.activity")
            status_node = row_scope.select_one(".cell.status")

            gradable_text = gradable_node.get_text(" ", strip=True) if gradable_node else ""
            activity_text = activity_node.get_text(" ", strip=True) if activity_node else ""
            status_text = status_node.get_text(" ", strip=True) if status_node else ""

            title = normalize_assignment_title(gradable_text)
            due_date = extract_date_text_safe(f"{gradable_text} {activity_text}")
            status = extract_status_text(f"{status_text} {activity_text}")
            description = row_scope.get_text(" ", strip=True)
        else:
            title_node = soup.find(["h1", "h2"]) or soup.find("title")
            title = title_node.get_text(" ", strip=True) if title_node else ""

            for selector in (".vtbegenerated", ".description", "#description", "#content_listContainer"):
                node = soup.select_one(selector)
                if node:
                    description = node.get_text(" ", strip=True)
                    if description:
                        break
            if not description:
                body = soup.find("body")
                description = body.get_text(" ", strip=True)[:500] if body else ""

            full_text = soup.get_text(" ", strip=True)
            due_date = extract_date_text_safe(full_text)
            status = extract_status_text(full_text)

        attachments: list[AssignmentAttachmentDTO] = []
        seen_attachment_urls: set[str] = set()
        for link in scope.find_all("a", href=True):
            href = self.context.absolute_url(base_url, str(link.get("href") or "").strip())
            if not href or href in seen_attachment_urls:
                continue
            lower_href = href.lower()
            if any(token in lower_href for token in ("/bbcswebdav/", "download", "attachment", "file")):
                attachments.append(
                    AssignmentAttachmentDTO(
                        name=link.get_text(strip=True) or Path(urlparse(href).path).name,
                        url=href,
                    )
                )
                seen_attachment_urls.add(href)

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

    def _extract_assignment_id(self, url: str) -> str | None:
        ids = self.context.extract_ids(url, id_types=("pk1", "xid", "rid", "content_id"))
        return ids.get("pk1") or ids.get("xid") or ids.get("rid") or ids.get("content_id")

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



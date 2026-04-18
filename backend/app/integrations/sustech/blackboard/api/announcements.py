"""Blackboard 公告抓取 API。"""

from __future__ import annotations

import re
from collections.abc import Callable, Mapping, Sequence
from urllib.parse import parse_qs, urlparse

from bs4 import BeautifulSoup
from bs4.element import Tag

from .context import BlackboardAPIContext
from .dto import AnnouncementDTO
from .fetch_helpers import extract_xml_contents
from .scrape_support import (
    clean_field,
    extract_date_text_safe,
    is_navigation_noise,
    looks_like_course_name,
    parse_datetime_safe,
)


class BlackboardAnnouncementAPI:
    """负责 Blackboard 公告抓取与解析。"""

    def __init__(self, context: BlackboardAPIContext) -> None:
        self.context = context

    def get_all_announcement_dtos(
        self,
        *,
        course_loader: Callable[[], Sequence[Mapping[str, object]]] | None = None,
        course_announcement_loader: Callable[[str], Sequence[Mapping[str, object]]]
        | None = None,
    ) -> list[AnnouncementDTO]:
        """获取跨课程汇总公告 DTO。"""
        self.context.log("🔍 [Blackboard] 开始获取汇总公告")

        urls_to_try = [
            f"{self.context.base_url}/webapps/portal/execute/defaultTab",
            f"{self.context.base_url}/webapps/portal/execute/tabs/tabAction?tab_tab_group_id=_1_1",
            f"{self.context.base_url}/webapps/blackboard/execute/announcement?method=search&context=mybb",
        ]

        all_announcements: list[AnnouncementDTO] = []
        seen_keys: set[str] = set()

        course_name_to_id: dict[str, str] = {}
        if course_loader is not None:
            try:
                for course in course_loader():
                    cid = clean_field(str(course.get("id") or ""), max_length=64)
                    cname = clean_field(str(course.get("name") or ""), max_length=200)
                    if not cid or not cname:
                        continue
                    key = re.sub(r"\s+", " ", cname).strip().lower()
                    if key:
                        course_name_to_id[key] = cid
            except Exception as ex:
                self.context.log(f"⚠️ [Blackboard] 构建课程名映射失败: {ex}")

        def _normalize_merged_announcement(
            item: Mapping[str, object],
        ) -> AnnouncementDTO:
            announcement_url = str(item.get("url") or "")
            merged_course_name = (
                clean_field(str(item.get("course_name") or ""), max_length=160) or None
            )
            merged_course_id = clean_field(
                str(item.get("course_id") or ""), max_length=64
            )
            if not merged_course_id:
                merged_course_id = self.context.extract_course_id(
                    announcement_url
                ) or self.context.extract_course_id(str(item.get("source_page") or ""))
            if not merged_course_id and merged_course_name:
                lookup_key = re.sub(r"\s+", " ", merged_course_name).strip().lower()
                merged_course_id = course_name_to_id.get(lookup_key, "")

            publish_time = (
                clean_field(str(item.get("publish_time") or ""), max_length=120) or None
            )
            detail = (
                clean_field(
                    str(item.get("detail") or item.get("content") or ""), max_length=600
                )
                or None
            )
            title = clean_field(str(item.get("title") or ""), max_length=200)
            author = clean_field(str(item.get("author") or ""), max_length=255) or None
            source_page = (
                clean_field(str(item.get("source_page") or ""), max_length=500) or None
            )

            return AnnouncementDTO(
                announcement_id=self._extract_announcement_id(announcement_url),
                course_id=merged_course_id or None,
                course_name=merged_course_name,
                title=title,
                publish_time=publish_time,
                publish_time_parsed=parse_datetime_safe(publish_time or ""),
                detail=detail,
                author=author,
                url=announcement_url or None,
                source_page=source_page,
            )

        def _merge(items: list[dict[str, object]]) -> None:
            for item in items:
                dto = _normalize_merged_announcement(item)
                key = f"{dto.course_name or ''}|{dto.title}|{dto.publish_time or ''}|{dto.url or ''}"
                if key in seen_keys:
                    continue
                seen_keys.add(key)
                all_announcements.append(dto)

        for page_url in urls_to_try:
            try:
                response = self.context.get(page_url, label="All-Announcements")
                response.raise_for_status()
            except Exception as ex:
                self.context.log(
                    f"⚠️ [Blackboard] 访问汇总公告页面失败: {page_url} - {ex}"
                )
                continue

            html = response.text
            xml_inner = extract_xml_contents(html)
            if xml_inner is not None:
                html = xml_inner

            parsed = self._parse_all_announcements_from_html(html, str(response.url))
            self.context.log(
                f"🔍 [Blackboard] 页面公告解析数量: {len(parsed)} ({response.url})"
            )
            _merge(parsed)

        tabs_url = f"{self.context.base_url}/webapps/portal/execute/tabs/tabAction"
        for mod_id in ("_4_1", "_5_1", "_6_1", "_7_1", "_8_1"):
            post_data = {
                "action": "refreshAjaxModule",
                "modId": mod_id,
                "tabId": "_1_1",
                "tab_tab_group_id": "_1_1",
            }
            try:
                response = self.context.post(
                    tabs_url, data=post_data, label=f"All-Announcements-POST-{mod_id}"
                )
                response.raise_for_status()
            except Exception as ex:
                self.context.log(
                    f"⚠️ [Blackboard] 公告模块Ajax访问失败: modId={mod_id} - {ex}"
                )
                continue

            html = response.text
            xml_inner = extract_xml_contents(html)
            if xml_inner is not None:
                html = xml_inner

            parsed = self._parse_all_announcements_from_html(html, str(response.url))
            if parsed:
                self.context.log(
                    f"🔍 [Blackboard] modId={mod_id} 命中公告数量: {len(parsed)}"
                )
            _merge(parsed)

        if (
            not all_announcements
            and course_loader is not None
            and course_announcement_loader is not None
        ):
            self.context.log("⚠️ [Blackboard] 汇总公告为空，尝试逐课程公告回退补齐")
            try:
                for course in course_loader():
                    cid = clean_field(str(course.get("id") or ""), max_length=64)
                    cname = clean_field(str(course.get("name") or ""), max_length=200)
                    if not cid:
                        continue
                    for ann in course_announcement_loader(cid):
                        dto = _normalize_merged_announcement(
                            {
                                "course_id": cid,
                                "course_name": cname,
                                "title": ann.get("title"),
                                "publish_time": ann.get("publish_time"),
                                "detail": ann.get("detail"),
                                "author": ann.get("author"),
                                "url": ann.get("url"),
                                "source_page": ann.get("source_page"),
                            }
                        )
                        dedup_key = f"{dto.course_name or ''}|{dto.title}|{dto.publish_time or ''}|{dto.url or ''}"
                        if dedup_key in seen_keys:
                            continue
                        seen_keys.add(dedup_key)
                        all_announcements.append(dto)
            except Exception as ex:
                self.context.log(f"⚠️ [Blackboard] 逐课程公告回退失败: {ex}")

        all_announcements.sort(
            key=lambda item: parse_datetime_safe(str(item.publish_time or "")),
            reverse=True,
        )
        self.context.log(
            f"✅ [Blackboard] 汇总公告解析完成，共 {len(all_announcements)} 条"
        )
        return all_announcements

    def get_course_announcement_dtos(self, course_id: str) -> list[AnnouncementDTO]:
        """获取课程公告 DTO 列表，并按发布时间倒序排列。"""
        self.context.log(f"🔍 [Blackboard] 开始获取课程公告, course_id={course_id}")

        candidate_urls = [
            (
                f"{self.context.base_url}/webapps/blackboard/execute/announcement"
                f"?method=search&context=course_entry&course_id={course_id}"
            ),
            f"{self.context.base_url}/webapps/blackboard/content/listContent.jsp?course_id={course_id}",
        ]

        announcements: list[AnnouncementDTO] = []
        seen_keys: set[str] = set()

        for page_url in candidate_urls:
            try:
                response = self.context.get(page_url, label="Announcements")
                response.raise_for_status()
            except Exception as ex:
                self.context.log(f"⚠️ [Blackboard] 公告页面访问失败: {page_url} - {ex}")
                continue

            soup = BeautifulSoup(response.text, "html.parser")
            self.context.log(f"🔍 [Blackboard] 分析公告页面结构: {page_url}")

            blocks = soup.select("ul.announcementList > li")
            for block in blocks:
                block_text = block.get_text(" ", strip=True)
                if not block_text or is_navigation_noise(block_text):
                    continue

                details_node = block.select_one(".details")
                body_node = block.select_one(".vtbegenerated")
                details_text = (
                    details_node.get_text(" ", strip=True) if details_node else ""
                )
                body_text = body_node.get_text(" ", strip=True) if body_node else ""

                title_node = block.find(["h2", "h3"])
                link_node = block.find("a", href=True)
                title = ""
                if title_node:
                    title = title_node.get_text(" ", strip=True)
                elif link_node:
                    title = link_node.get_text(" ", strip=True)

                if not title:
                    title = block_text.split("Posted on:")[0].strip()[:120]

                publish_time = extract_date_text_safe(details_text or block_text)
                detail = body_text or details_text or block_text
                author = self._extract_author_from_announcement_block(block)
                url = (
                    self.context.absolute_url(
                        page_url, str(link_node.get("href") or "").strip()
                    )
                    if link_node
                    else page_url
                )

                key = f"{title}|{url}|{publish_time}"
                if key in seen_keys:
                    continue

                announcements.append(
                    AnnouncementDTO(
                        announcement_id=self._extract_announcement_id(url),
                        course_id=course_id,
                        course_name=None,
                        title=title,
                        publish_time=publish_time,
                        publish_time_parsed=parse_datetime_safe(publish_time),
                        detail=detail[:600],
                        author=author,
                        url=url,
                        source_page=page_url,
                    )
                )
                seen_keys.add(key)

            if announcements:
                continue

            for container in soup.find_all(["li", "div", "tr", "article"]):
                text = container.get_text(" ", strip=True)
                if not text or is_navigation_noise(text):
                    continue

                lower_text = text.lower()
                if not (
                    "announcement" in lower_text
                    or "公告" in text
                    or "通知" in text
                    or "posted on" in lower_text
                ):
                    continue

                link = container.find("a", href=True)
                link_href = (
                    self.context.absolute_url(
                        page_url, str(link.get("href") or "").strip()
                    )
                    if link
                    else page_url
                )
                link_text = link.get_text(strip=True) if link else ""

                title = link_text or text[:100]
                publish_time = extract_date_text_safe(text)
                detail = text
                author = self._extract_author_from_announcement_block(container)
                if title and detail.startswith(title):
                    detail = detail[len(title) :].strip()

                key = f"{title}|{link_href}|{publish_time}"
                if key in seen_keys:
                    continue

                announcements.append(
                    AnnouncementDTO(
                        announcement_id=self._extract_announcement_id(link_href),
                        course_id=course_id,
                        course_name=None,
                        title=title,
                        publish_time=publish_time,
                        publish_time_parsed=parse_datetime_safe(publish_time),
                        detail=detail[:600],
                        author=author,
                        url=link_href,
                        source_page=page_url,
                    )
                )
                seen_keys.add(key)

        announcements.sort(
            key=lambda item: parse_datetime_safe(str(item.publish_time or "")),
            reverse=True,
        )
        self.context.log(f"✅ [Blackboard] 公告解析完成，共 {len(announcements)} 条")
        return announcements

    def _extract_announcement_id(self, url: str) -> str | None:
        ids = self.context.extract_ids(url, id_types=("xid", "rid", "content_id"))
        return ids.get("xid") or ids.get("rid") or ids.get("content_id")

    def _extract_course_name_from_announcement_text(self, text: str) -> str:
        normalized = clean_field(text, max_length=500)
        if not normalized:
            return ""

        patterns = [
            r"(?:发布至|Posted\s*to|Course|课程)\s*[:：]\s*([^\|,，;；]{2,160})",
            r"(?:From|来自)\s*[:：]?\s*([^\|,，;；]{2,160})",
        ]
        for pattern in patterns:
            match = re.search(pattern, normalized, re.IGNORECASE)
            if match:
                course_name = clean_field(match.group(1), max_length=160)
                if looks_like_course_name(course_name):
                    return course_name

        return ""

    def _extract_course_name_from_announcement_block(self, block: Tag) -> str:
        for info in block.select(".announcementInfo p"):
            label_node = info.find("span")
            label_text = (
                clean_field(label_node.get_text(" ", strip=True), max_length=40)
                if label_node
                else ""
            )
            whole_text = clean_field(info.get_text(" ", strip=True), max_length=220)
            if not whole_text:
                continue

            lower_label = label_text.lower()
            if "发布至" in label_text or "posted to" in lower_label:
                course_name = whole_text
                if label_text:
                    course_name = whole_text.replace(label_text, "", 1).strip(" :：")
                course_name = clean_field(course_name, max_length=160)
                if looks_like_course_name(course_name):
                    return course_name

        for selector in (
            ".course",
            ".courseName",
            ".context",
            ".course-title",
            ".courseTitle",
        ):
            node = block.select_one(selector)
            if not node:
                continue
            course_name = clean_field(node.get_text(" ", strip=True), max_length=160)
            if looks_like_course_name(course_name):
                return course_name

        return ""

    def _extract_author_from_announcement_block(self, block: Tag) -> str | None:
        for info in block.select(".announcementInfo p"):
            text = clean_field(info.get_text(" ", strip=True), max_length=255)
            if not text:
                continue

            label_node = info.find("span")
            label = (
                clean_field(label_node.get_text(" ", strip=True), max_length=40)
                if label_node
                else ""
            )
            lower_label = label.lower()
            lower_text = text.lower()

            if (
                "发帖者" not in text
                and "posted by" not in lower_text
                and "author" not in lower_text
            ):
                continue

            author = text
            if label and (
                "发帖者" in label
                or "posted by" in lower_label
                or "author" in lower_label
            ):
                author = text.replace(label, "", 1).strip(" :：")
            else:
                matched = re.search(
                    r"(?:发帖者|posted\s*by|author)\s*[:：]\s*(.+)$",
                    text,
                    re.IGNORECASE,
                )
                if matched:
                    author = matched.group(1)

            author = clean_field(author, max_length=255)
            if author and not is_navigation_noise(author):
                return author

        return None

    def _extract_course_id_from_announcement_block(
        self, block: Tag, page_url: str
    ) -> str | None:
        for attr in ("data-course-id", "data-course_id", "course_id"):
            value = str(block.get(attr) or "").strip()
            if value:
                return value

        for link in block.select("a[href]"):
            href = str(link.get("href") or "").strip()
            if not href:
                continue
            candidate_url = self.context.absolute_url(page_url, href)
            course_id = self.context.extract_course_id(candidate_url)
            if course_id:
                return course_id

        return None

    def _extract_course_code_from_announcement_block(
        self, block: Tag, page_url: str
    ) -> str | None:
        for attr in ("data-course-code", "data-course_code", "course_code"):
            value = str(block.get(attr) or "").strip()
            if value:
                return value.replace(" ", "").upper()

        for link in block.select("a[href]"):
            href = str(link.get("href") or "").strip()
            if not href:
                continue
            parsed = urlparse(self.context.absolute_url(page_url, href))
            query = parse_qs(parsed.query)
            for key in ("course_code", "courseCode", "code"):
                value = query.get(key)
                if value and value[0]:
                    return str(value[0]).replace(" ", "").upper()

        return None

    def _build_announcement_payload(
        self,
        *,
        course_id: str | None,
        course_code: str | None,
        course_name: str,
        title: str,
        publish_time: str,
        detail: str,
        author: str | None,
        url: str,
        source_page: str,
    ) -> dict[str, object]:
        return {
            "course_id": course_id,
            "course_code": course_code,
            "course_name": course_name,
            "title": title,
            "publish_time": publish_time,
            "detail": detail,
            "author": author,
            "url": url,
            "source_page": source_page,
        }

    def _append_unique_announcement(
        self,
        announcements: list[dict[str, object]],
        seen_keys: set[str],
        item: dict[str, object],
    ) -> None:
        key = "|".join(
            [
                str(item.get("course_name") or ""),
                str(item.get("title") or ""),
                str(item.get("publish_time") or ""),
                str(item.get("url") or ""),
            ]
        )
        if key in seen_keys:
            return

        announcements.append(item)
        seen_keys.add(key)

    def _collect_candidate_announcement_blocks(self, soup: BeautifulSoup) -> list[Tag]:
        candidate_blocks: list[Tag] = []
        for selector in (
            "ul.announcementList > li",
            "div.announcementList li",
            "li.announcement",
            "div.announcement",
            "div[id*='announcement'] li",
            "section[id*='announcement'] li",
        ):
            candidate_blocks.extend(soup.select(selector))

        if candidate_blocks:
            return candidate_blocks

        for li in soup.find_all("li"):
            parent = li.find_parent(["ul", "div", "section"])
            if not isinstance(parent, Tag):
                continue

            parent_id_attr = parent.get("id")
            parent_class_attr = parent.get("class")
            parent_id_text = str(parent_id_attr or "")

            if isinstance(parent_class_attr, list):
                parent_class_text = " ".join(str(item) for item in parent_class_attr)
            elif isinstance(parent_class_attr, str):
                parent_class_text = parent_class_attr
            else:
                parent_class_text = ""

            hint = f"{parent_id_text} {parent_class_text}".lower()
            if "announce" in hint and li not in candidate_blocks:
                candidate_blocks.append(li)

        return candidate_blocks

    def _parse_announcement_table_row(
        self, row: Tag, page_url: str
    ) -> dict[str, object] | None:
        cells = row.find_all(["th", "td"])
        if len(cells) < 2:
            return None

        row_text = clean_field(row.get_text(" ", strip=True), max_length=2000)
        if not row_text or is_navigation_noise(row_text):
            return None

        link = row.find("a", href=True)
        if not link:
            return None

        publish_time = clean_field(extract_date_text_safe(row_text), max_length=120)
        has_announcement_signal = (
            "announcement" in row_text.lower()
            or "公告" in row_text
            or "通知" in row_text
        )
        if not publish_time and not has_announcement_signal:
            return None

        title = clean_field(
            link.get_text(" ", strip=True) or row_text[:120], max_length=200
        )
        if not title:
            return None

        course_name = ""
        if len(cells) >= 3:
            maybe_course = clean_field(cells[0].get_text(" ", strip=True), max_length=160)
            if maybe_course != title and looks_like_course_name(maybe_course):
                course_name = maybe_course

        detail = clean_field(row_text, max_length=600)
        url = self.context.absolute_url(page_url, str(link.get("href") or "").strip())
        return self._build_announcement_payload(
            course_id=self._extract_course_id_from_announcement_block(row, page_url),
            course_code=self._extract_course_code_from_announcement_block(row, page_url),
            course_name=course_name,
            title=title,
            publish_time=publish_time,
            detail=detail,
            author=self._extract_author_from_announcement_block(row),
            url=url,
            source_page=page_url,
        )

    def _extract_announcement_title(self, block: Tag, block_text: str) -> str:
        title_node = block.find(["h2", "h3", "h4", "strong"])
        if title_node:
            return clean_field(title_node.get_text(" ", strip=True), max_length=200)

        link_node = block.find("a", href=True)
        if link_node:
            return clean_field(link_node.get_text(" ", strip=True), max_length=200)

        return clean_field(block_text[:120], max_length=200)

    def _normalize_announcement_course_name(self, block: Tag, block_text: str) -> str:
        details_node = block.select_one(".details")
        details_text = (
            clean_field(details_node.get_text(" ", strip=True), max_length=3000)
            if details_node
            else ""
        )
        course_name = self._extract_course_name_from_announcement_block(block)
        if not course_name:
            course_name = self._extract_course_name_from_announcement_text(
                details_text or block_text
            )
        course_name = clean_field(course_name, max_length=160)
        if course_name and not looks_like_course_name(course_name):
            return ""
        return course_name

    def _parse_announcement_block(
        self, block: Tag, page_url: str
    ) -> dict[str, object] | None:
        block_text = clean_field(block.get_text(" ", strip=True), max_length=3000)
        if not block_text or is_navigation_noise(block_text):
            return None

        lower_text = block_text.lower()
        details_node = block.select_one(".details")
        details_text = (
            clean_field(details_node.get_text(" ", strip=True), max_length=3000)
            if details_node
            else ""
        )
        publish_time = clean_field(
            extract_date_text_safe(details_text or block_text), max_length=120
        )
        has_announcement_signal = (
            "announcement" in lower_text
            or "posted on" in lower_text
            or "公告" in block_text
            or "通知" in block_text
        )
        if not publish_time and not has_announcement_signal:
            return None

        title = self._extract_announcement_title(block, block_text)
        if not title:
            return None

        body_node = block.select_one(".vtbegenerated")
        detail = clean_field(
            body_node.get_text(" ", strip=True) if body_node else (details_text or block_text),
            max_length=600,
        )
        dom_id = clean_field(str(block.get("id") or ""), max_length=120)
        url = f"{page_url}#{dom_id}" if dom_id else page_url

        return self._build_announcement_payload(
            course_id=self._extract_course_id_from_announcement_block(block, page_url),
            course_code=self._extract_course_code_from_announcement_block(block, page_url),
            course_name=self._normalize_announcement_course_name(block, block_text),
            title=title,
            publish_time=publish_time,
            detail=detail,
            author=self._extract_author_from_announcement_block(block),
            url=url,
            source_page=page_url,
        )

    def _parse_all_announcements_from_html(
        self, html: str, page_url: str
    ) -> list[dict[str, object]]:
        soup = BeautifulSoup(html, "html.parser")
        announcements: list[dict[str, object]] = []
        seen_keys: set[str] = set()
        candidate_blocks = self._collect_candidate_announcement_blocks(soup)

        if not candidate_blocks:
            for row in soup.select("table tr"):
                parsed_row = self._parse_announcement_table_row(row, page_url)
                if parsed_row is not None:
                    self._append_unique_announcement(
                        announcements, seen_keys, parsed_row
                    )

        for block in candidate_blocks:
            parsed_block = self._parse_announcement_block(block, page_url)
            if parsed_block is not None:
                self._append_unique_announcement(announcements, seen_keys, parsed_block)

        announcements.sort(
            key=lambda item: parse_datetime_safe(str(item.get("publish_time") or "")),
            reverse=True,
        )
        return announcements

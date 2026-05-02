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


def _announcement_info_nodes(block: Tag) -> list[Tag]:
    return list(block.select(".announcementInfo p"))


def _clean_tag_text(node: Tag | None, *, max_length: int) -> str:
    if not isinstance(node, Tag):
        return ""
    return clean_field(node.get_text(" ", strip=True), max_length=max_length)


def _clean_tag_html(node: Tag | None, *, max_length: int) -> str:
    if not isinstance(node, Tag):
        return ""
    html = node.decode_contents().strip()
    if not html:
        return ""
    return html[:max_length]


def _first_link_with_href(block: Tag) -> Tag | None:
    link = block.find("a", href=True)
    return link if isinstance(link, Tag) else None


def _announcement_link_url(
    context: BlackboardAPIContext,
    page_url: str,
    link: Tag | None,
) -> str:
    if link is None:
        return page_url
    return context.absolute_url(page_url, str(link.get("href") or "").strip())


def _trim_announcement_detail(detail: str, title: str) -> str:
    if title and detail.startswith(title):
        return detail[len(title) :].strip()
    return detail


def _announcement_details_node(block: Tag) -> Tag | None:
    node = block.select_one(".details")
    return node if isinstance(node, Tag) else None


def _announcement_body_node(block: Tag) -> Tag | None:
    node = block.select_one(".vtbegenerated")
    return node if isinstance(node, Tag) else None


def _course_code_from_query(query: Mapping[str, list[str]]) -> str | None:
    for key in ("course_code", "courseCode", "code"):
        values = query.get(key)
        if values and values[0]:
            return str(values[0]).replace(" ", "").upper()
    return None


def _parent_block_hint(parent: Tag) -> str:
    class_attr = parent.get("class")
    class_text = (
        " ".join(str(item) for item in class_attr)
        if isinstance(class_attr, list)
        else str(class_attr or "")
    )
    return f"{str(parent.get('id') or '')} {class_text}".lower()


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
        all_announcements: list[AnnouncementDTO] = []
        seen_keys: set[str] = set()
        course_name_to_id = self._build_course_name_to_id(course_loader)

        self._merge_announcement_payloads(
            announcements=all_announcements,
            seen_keys=seen_keys,
            items=self._load_all_announcement_page_payloads(),
            course_name_to_id=course_name_to_id,
        )
        self._merge_announcement_payloads(
            announcements=all_announcements,
            seen_keys=seen_keys,
            items=self._load_all_announcement_ajax_payloads(),
            course_name_to_id=course_name_to_id,
        )
        if not all_announcements:
            self._merge_announcement_payloads(
                announcements=all_announcements,
                seen_keys=seen_keys,
                items=self._load_course_announcement_fallback_payloads(
                    course_loader=course_loader,
                    course_announcement_loader=course_announcement_loader,
                ),
                course_name_to_id=course_name_to_id,
            )

        all_announcements.sort(
            key=lambda item: parse_datetime_safe(str(item.publish_time or "")),
            reverse=True,
        )
        self.context.log(
            f"✅ [Blackboard] 汇总公告解析完成，共 {len(all_announcements)} 条"
        )
        return all_announcements

    def _normalize_announcement_course_key(self, course_name: str) -> str:
        return re.sub(r"\s+", " ", course_name).strip().lower()

    def _build_course_name_to_id(
        self,
        course_loader: Callable[[], Sequence[Mapping[str, object]]] | None,
    ) -> dict[str, str]:
        course_name_to_id: dict[str, str] = {}
        if course_loader is None:
            return course_name_to_id

        try:
            for course in course_loader():
                cid = clean_field(str(course.get("id") or ""), max_length=64)
                cname = clean_field(str(course.get("name") or ""), max_length=200)
                if not cid or not cname:
                    continue
                key = self._normalize_announcement_course_key(cname)
                if key:
                    course_name_to_id[key] = cid
        except Exception as ex:
            self.context.log(f"⚠️ [Blackboard] 构建课程名映射失败: {ex}")
        return course_name_to_id

    def _resolve_merged_announcement_course_id(
        self,
        item: Mapping[str, object],
        announcement_url: str,
        merged_course_name: str | None,
        course_name_to_id: Mapping[str, str],
    ) -> str:
        merged_course_id = clean_field(str(item.get("course_id") or ""), max_length=64)
        if merged_course_id:
            return merged_course_id

        for candidate_url in (announcement_url, str(item.get("source_page") or "")):
            course_id = self.context.extract_course_id(candidate_url)
            if course_id:
                return course_id

        if not merged_course_name:
            return ""
        return course_name_to_id.get(
            self._normalize_announcement_course_key(merged_course_name), ""
        )

    def _normalize_merged_announcement(
        self,
        item: Mapping[str, object],
        course_name_to_id: Mapping[str, str],
    ) -> AnnouncementDTO:
        announcement_url = str(item.get("url") or "")
        merged_course_name = (
            clean_field(str(item.get("course_name") or ""), max_length=160) or None
        )
        publish_time = (
            clean_field(str(item.get("publish_time") or ""), max_length=120) or None
        )
        detail = (
            clean_field(
                str(item.get("detail") or item.get("content") or ""), max_length=600
            )
            or None
        )
        raw_detail_html = str(item.get("detail_html") or item.get("content_html") or "").strip()
        detail_html = raw_detail_html[:12000] or None
        title = clean_field(str(item.get("title") or ""), max_length=200)
        author = clean_field(str(item.get("author") or ""), max_length=255) or None
        source_page = (
            clean_field(str(item.get("source_page") or ""), max_length=500) or None
        )
        linked_content_candidates = self._normalize_linked_content_candidates(
            item.get("linked_content_candidates")
        )
        merged_course_id = self._resolve_merged_announcement_course_id(
            item,
            announcement_url,
            merged_course_name,
            course_name_to_id,
        )
        return AnnouncementDTO(
            announcement_id=(
                clean_field(str(item.get("announcement_id") or ""), max_length=128)
                or self._extract_announcement_id(announcement_url)
            ),
            course_id=merged_course_id or None,
            course_name=merged_course_name,
            title=title,
            publish_time=publish_time,
            publish_time_parsed=parse_datetime_safe(publish_time or ""),
            detail=detail,
            detail_html=detail_html,
            author=author,
            url=announcement_url or None,
            source_page=source_page,
            linked_content_candidates=linked_content_candidates,
        )

    def _announcement_dto_key(self, item: AnnouncementDTO) -> str:
        return (
            f"{item.course_name or ''}|{item.title}|"
            f"{item.publish_time or ''}|{item.url or ''}"
        )

    def _merge_announcement_payloads(
        self,
        *,
        announcements: list[AnnouncementDTO],
        seen_keys: set[str],
        items: Sequence[Mapping[str, object]],
        course_name_to_id: Mapping[str, str],
    ) -> None:
        for item in items:
            dto = self._normalize_merged_announcement(item, course_name_to_id)
            key = self._announcement_dto_key(dto)
            if key in seen_keys:
                continue
            seen_keys.add(key)
            announcements.append(dto)

    def _extract_parsed_announcement_payloads(
        self,
        html: str,
        page_url: str,
    ) -> list[dict[str, object]]:
        xml_inner = extract_xml_contents(html)
        if xml_inner is not None:
            html = xml_inner
        return self._parse_all_announcements_from_html(html, page_url)

    def _load_all_announcement_page_payloads(self) -> list[dict[str, object]]:
        urls_to_try = [
            f"{self.context.base_url}/webapps/portal/execute/defaultTab",
            f"{self.context.base_url}/webapps/portal/execute/tabs/tabAction?tab_tab_group_id=_1_1",
            f"{self.context.base_url}/webapps/blackboard/execute/announcement?method=search&context=mybb",
        ]
        payloads: list[dict[str, object]] = []
        for page_url in urls_to_try:
            try:
                response = self.context.get(page_url, label="All-Announcements")
                response.raise_for_status()
            except Exception as ex:
                self.context.log(
                    f"⚠️ [Blackboard] 访问汇总公告页面失败: {page_url} - {ex}"
                )
                continue

            parsed = self._extract_parsed_announcement_payloads(
                response.text,
                str(response.url),
            )
            self.context.log(
                f"🔍 [Blackboard] 页面公告解析数量: {len(parsed)} ({response.url})"
            )
            payloads.extend(parsed)
        return payloads

    def _load_all_announcement_ajax_payloads(self) -> list[dict[str, object]]:
        tabs_url = f"{self.context.base_url}/webapps/portal/execute/tabs/tabAction"
        payloads: list[dict[str, object]] = []
        for mod_id in ("_4_1", "_5_1", "_6_1", "_7_1", "_8_1"):
            post_data = {
                "action": "refreshAjaxModule",
                "modId": mod_id,
                "tabId": "_1_1",
                "tab_tab_group_id": "_1_1",
            }
            try:
                response = self.context.post(
                    tabs_url,
                    data=post_data,
                    label=f"All-Announcements-POST-{mod_id}",
                )
                response.raise_for_status()
            except Exception as ex:
                self.context.log(
                    f"⚠️ [Blackboard] 公告模块Ajax访问失败: modId={mod_id} - {ex}"
                )
                continue

            parsed = self._extract_parsed_announcement_payloads(
                response.text,
                str(response.url),
            )
            if parsed:
                self.context.log(
                    f"🔍 [Blackboard] modId={mod_id} 命中公告数量: {len(parsed)}"
                )
            payloads.extend(parsed)
        return payloads

    def _fallback_announcement_payload(
        self,
        course_id: str,
        course_name: str,
        announcement: Mapping[str, object],
    ) -> dict[str, object]:
        return {
            "announcement_id": announcement.get("announcement_id"),
            "course_id": course_id,
            "course_name": course_name,
            "title": announcement.get("title"),
            "publish_time": announcement.get("publish_time"),
            "detail": announcement.get("detail"),
            "detail_html": announcement.get("detail_html"),
            "author": announcement.get("author"),
            "url": announcement.get("url"),
            "source_page": announcement.get("source_page"),
            "linked_content_candidates": announcement.get("linked_content_candidates"),
        }

    def _load_course_announcement_fallback_payloads(
        self,
        *,
        course_loader: Callable[[], Sequence[Mapping[str, object]]] | None,
        course_announcement_loader: Callable[[str], Sequence[Mapping[str, object]]]
        | None,
    ) -> list[dict[str, object]]:
        if course_loader is None or course_announcement_loader is None:
            return []

        self.context.log("⚠️ [Blackboard] 汇总公告为空，尝试逐课程公告回退补齐")
        payloads: list[dict[str, object]] = []
        try:
            for course in course_loader():
                cid = clean_field(str(course.get("id") or ""), max_length=64)
                cname = clean_field(str(course.get("name") or ""), max_length=200)
                if not cid:
                    continue
                for ann in course_announcement_loader(cid):
                    payloads.append(
                        self._fallback_announcement_payload(cid, cname, ann)
                    )
        except Exception as ex:
            self.context.log(f"⚠️ [Blackboard] 逐课程公告回退失败: {ex}")
        return payloads

    def get_course_announcement_dtos(self, course_id: str) -> list[AnnouncementDTO]:
        """获取课程公告 DTO 列表，并按发布时间倒序排列。"""
        self.context.log(f"🔍 [Blackboard] 开始获取课程公告, course_id={course_id}")
        announcements: list[AnnouncementDTO] = []
        seen_keys: set[str] = set()

        for page_url in self._course_announcement_candidate_urls(course_id):
            soup = self._load_course_announcement_soup(page_url)
            if soup is None:
                continue

            announcements.extend(
                self._parse_primary_course_announcement_dtos(
                    soup=soup,
                    course_id=course_id,
                    page_url=page_url,
                    seen_keys=seen_keys,
                )
            )
            if announcements:
                continue
            announcements.extend(
                self._parse_fallback_course_announcement_dtos(
                    soup=soup,
                    course_id=course_id,
                    page_url=page_url,
                    seen_keys=seen_keys,
                )
            )

        announcements.sort(
            key=lambda item: parse_datetime_safe(str(item.publish_time or "")),
            reverse=True,
        )
        self.context.log(f"✅ [Blackboard] 公告解析完成，共 {len(announcements)} 条")
        return announcements

    def _course_announcement_candidate_urls(self, course_id: str) -> list[str]:
        return [
            (
                f"{self.context.base_url}/webapps/blackboard/execute/announcement"
                f"?method=search&context=course_entry&course_id={course_id}"
            ),
            f"{self.context.base_url}/webapps/blackboard/content/listContent.jsp?course_id={course_id}",
        ]

    def _load_course_announcement_soup(self, page_url: str) -> BeautifulSoup | None:
        try:
            response = self.context.get(page_url, label="Announcements")
            response.raise_for_status()
        except Exception as ex:
            self.context.log(f"⚠️ [Blackboard] 公告页面访问失败: {page_url} - {ex}")
            return None

        self.context.log(f"🔍 [Blackboard] 分析公告页面结构: {page_url}")
        return BeautifulSoup(response.text, "html.parser")

    def _build_course_announcement_dto(
        self,
        *,
        announcement_id: str | None,
        course_id: str,
        page_url: str,
        title: str,
        publish_time: str,
        detail: str,
        detail_html: str | None,
        author: str | None,
        url: str,
        linked_content_candidates: list[dict[str, object]],
    ) -> AnnouncementDTO:
        return AnnouncementDTO(
            announcement_id=announcement_id or self._extract_announcement_id(url),
            course_id=course_id,
            course_name=None,
            title=title,
            publish_time=publish_time,
            publish_time_parsed=parse_datetime_safe(publish_time),
            detail=detail[:600],
            detail_html=detail_html[:12000] if detail_html else None,
            author=author,
            url=url,
            source_page=page_url,
            linked_content_candidates=linked_content_candidates,
        )

    def _course_announcement_key(self, item: AnnouncementDTO) -> str:
        return f"{item.title}|{item.url or ''}|{item.publish_time or ''}"

    def _append_course_announcement(
        self,
        announcements: list[AnnouncementDTO],
        seen_keys: set[str],
        item: AnnouncementDTO | None,
    ) -> None:
        if item is None:
            return
        key = self._course_announcement_key(item)
        if key in seen_keys:
            return
        seen_keys.add(key)
        announcements.append(item)

    def _course_announcement_title(self, block: Tag, block_text: str) -> str:
        title_node = block.find(["h2", "h3"])
        if isinstance(title_node, Tag):
            return title_node.get_text(" ", strip=True)
        link_node = _first_link_with_href(block)
        if link_node is not None:
            return link_node.get_text(" ", strip=True)
        return block_text.split("Posted on:")[0].strip()[:120]

    def _parse_primary_course_announcement_block(
        self,
        block: Tag,
        course_id: str,
        page_url: str,
    ) -> AnnouncementDTO | None:
        block_text = block.get_text(" ", strip=True)
        if not block_text or is_navigation_noise(block_text):
            return None

        details_text = _clean_tag_text(
            _announcement_details_node(block),
            max_length=3000,
        )
        body_text = _clean_tag_text(_announcement_body_node(block), max_length=3000)
        body_html = _clean_tag_html(_announcement_body_node(block), max_length=12000)
        link_node = _first_link_with_href(block)
        url = _announcement_link_url(self.context, page_url, link_node)
        linked_content_candidates = self._extract_linked_content_candidates(block, page_url)
        return self._build_course_announcement_dto(
            announcement_id=self._resolve_announcement_record_id(
                block,
                announcement_url=url,
                linked_content_candidates=linked_content_candidates,
            ),
            course_id=course_id,
            page_url=page_url,
            title=self._course_announcement_title(block, block_text),
            publish_time=extract_date_text_safe(details_text or block_text),
            detail=body_text or details_text or block_text,
            detail_html=body_html or None,
            author=self._extract_author_from_announcement_block(block),
            url=url,
            linked_content_candidates=linked_content_candidates,
        )

    def _parse_primary_course_announcement_dtos(
        self,
        *,
        soup: BeautifulSoup,
        course_id: str,
        page_url: str,
        seen_keys: set[str],
    ) -> list[AnnouncementDTO]:
        announcements: list[AnnouncementDTO] = []
        for block in soup.select("ul.announcementList > li"):
            self._append_course_announcement(
                announcements,
                seen_keys,
                self._parse_primary_course_announcement_block(
                    block,
                    course_id,
                    page_url,
                ),
            )
        return announcements

    def _has_announcement_text_signal(self, text: str) -> bool:
        lower_text = text.lower()
        return (
            "announcement" in lower_text
            or "公告" in text
            or "通知" in text
            or "posted on" in lower_text
        )

    def _parse_fallback_course_announcement_container(
        self,
        container: Tag,
        course_id: str,
        page_url: str,
    ) -> AnnouncementDTO | None:
        if self._looks_like_course_content_item(container):
            return None

        text = container.get_text(" ", strip=True)
        if (
            not text
            or is_navigation_noise(text)
            or not self._has_announcement_text_signal(text)
        ):
            return None

        link = _first_link_with_href(container)
        url = _announcement_link_url(self.context, page_url, link)
        title = link.get_text(strip=True) if link is not None else ""
        detail = _trim_announcement_detail(text, title)
        linked_content_candidates = self._extract_linked_content_candidates(
            container, page_url
        )
        return self._build_course_announcement_dto(
            announcement_id=self._resolve_announcement_record_id(
                container,
                announcement_url=url,
                linked_content_candidates=linked_content_candidates,
            ),
            course_id=course_id,
            page_url=page_url,
            title=title or text[:100],
            publish_time=extract_date_text_safe(text),
            detail=detail,
            detail_html=None,
            author=self._extract_author_from_announcement_block(container),
            url=url,
            linked_content_candidates=linked_content_candidates,
        )

    def _parse_fallback_course_announcement_dtos(
        self,
        *,
        soup: BeautifulSoup,
        course_id: str,
        page_url: str,
        seen_keys: set[str],
    ) -> list[AnnouncementDTO]:
        announcements: list[AnnouncementDTO] = []
        for container in soup.find_all(["li", "div", "tr", "article"]):
            self._append_course_announcement(
                announcements,
                seen_keys,
                self._parse_fallback_course_announcement_container(
                    container,
                    course_id,
                    page_url,
                ),
            )
        return announcements

    def _extract_announcement_id(self, url: str) -> str | None:
        ids = self.context.extract_ids(
            url,
            id_types=("ann_id", "xid", "rid", "content_id"),
        )
        return (
            ids.get("ann_id")
            or ids.get("xid")
            or ids.get("rid")
            or ids.get("content_id")
        )

    def _normalize_linked_content_candidates(
        self,
        value: object,
    ) -> list[dict[str, object]]:
        if not isinstance(value, list):
            return []

        normalized: list[dict[str, object]] = []
        for item in value:
            if not isinstance(item, Mapping):
                continue
            normalized_item: dict[str, object] = {}
            for key, raw in item.items():
                key_text = clean_field(str(key), max_length=64)
                if not key_text:
                    continue
                if raw is None or isinstance(raw, bool):
                    normalized_item[key_text] = raw
                    continue
                normalized_item[key_text] = clean_field(str(raw), max_length=5120)
            if normalized_item:
                normalized.append(normalized_item)
        return normalized

    def _extract_block_dom_announcement_id(self, block: Tag) -> str | None:
        raw_id = clean_field(str(block.get("id") or ""), max_length=128)
        if raw_id and re.fullmatch(r"_\d+_\d+", raw_id):
            return raw_id
        return None

    def _extract_linked_content_candidates(
        self,
        block: Tag,
        page_url: str,
    ) -> list[dict[str, object]]:
        candidates: list[dict[str, object]] = []
        seen_keys: set[str] = set()
        for link in block.select("a[href]"):
            absolute_url = _announcement_link_url(self.context, page_url, link)
            lower_url = absolute_url.lower()
            ids = self.context.extract_ids(
                absolute_url,
                id_types=(
                    "ann_id",
                    "course_id",
                    "content_id",
                    "pk1",
                    "xid",
                    "rid",
                    "id",
                ),
            )
            is_launch_link = "launchlink.jsp" in lower_url
            if not (
                is_launch_link
                or ids.get("ann_id")
                or ids.get("content_id")
                or ids.get("pk1")
                or ids.get("xid")
                or ids.get("rid")
            ):
                continue

            path_text = clean_field(link.get_text(" ", strip=True), max_length=300) or None
            candidate_key = "|".join(
                [
                    absolute_url,
                    str(ids.get("ann_id") or ""),
                    str(ids.get("content_id") or ""),
                    str(path_text or ""),
                ]
            )
            if candidate_key in seen_keys:
                continue
            seen_keys.add(candidate_key)
            candidates.append(
                {
                    "url": absolute_url,
                    "path_text": path_text,
                    "ann_id": ids.get("ann_id"),
                    "course_id": ids.get("course_id"),
                    "content_id": ids.get("content_id"),
                    "pk1": ids.get("pk1"),
                    "xid": ids.get("xid"),
                    "rid": ids.get("rid"),
                    "source": ids.get("source"),
                    "is_launch_link": is_launch_link,
                }
            )
        return candidates

    def _resolve_announcement_record_id(
        self,
        block: Tag,
        *,
        announcement_url: str,
        linked_content_candidates: list[dict[str, object]],
    ) -> str | None:
        block_id = self._extract_block_dom_announcement_id(block)
        if block_id:
            return block_id

        extracted = self._extract_announcement_id(announcement_url)
        if extracted:
            return extracted

        for candidate in linked_content_candidates:
            ann_id = clean_field(str(candidate.get("ann_id") or ""), max_length=128)
            if ann_id:
                return ann_id
        return None

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
        for info in _announcement_info_nodes(block):
            label_text = _clean_tag_text(info.find("span"), max_length=40)
            whole_text = _clean_tag_text(info, max_length=220)
            if not whole_text:
                continue

            lower_label = label_text.lower()
            if "发布至" in label_text or "posted to" in lower_label:
                course_name = whole_text.replace(label_text, "", 1).strip(" :：")
                course_name = clean_field(course_name or whole_text, max_length=160)
                if looks_like_course_name(course_name):
                    return course_name

        for selector in (
            ".course",
            ".courseName",
            ".context",
            ".course-title",
            ".courseTitle",
        ):
            course_name = _clean_tag_text(block.select_one(selector), max_length=160)
            if looks_like_course_name(course_name):
                return course_name

        return ""

    def _extract_author_from_announcement_block(self, block: Tag) -> str | None:
        for info in _announcement_info_nodes(block):
            text = _clean_tag_text(info, max_length=255)
            if not text:
                continue

            label = _clean_tag_text(info.find("span"), max_length=40)
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
            course_id = self.context.extract_course_id(
                _announcement_link_url(self.context, page_url, link)
            )
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
            parsed = urlparse(_announcement_link_url(self.context, page_url, link))
            course_code = _course_code_from_query(parse_qs(parsed.query))
            if course_code:
                return course_code

        return None

    def _build_announcement_payload(
        self,
        *,
        announcement_id: str | None,
        course_id: str | None,
        course_code: str | None,
        course_name: str,
        title: str,
        publish_time: str,
        detail: str,
        detail_html: str | None,
        author: str | None,
        url: str,
        source_page: str,
        linked_content_candidates: list[dict[str, object]],
    ) -> dict[str, object]:
        return {
            "announcement_id": announcement_id,
            "course_id": course_id,
            "course_code": course_code,
            "course_name": course_name,
            "title": title,
            "publish_time": publish_time,
            "detail": detail,
            "detail_html": detail_html,
            "author": author,
            "url": url,
            "source_page": source_page,
            "linked_content_candidates": linked_content_candidates,
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
            if "announce" in _parent_block_hint(parent) and li not in candidate_blocks:
                candidate_blocks.append(li)

        return candidate_blocks

    def _looks_like_course_content_item(self, block: Tag) -> bool:
        block_id = str(block.get("id") or "").strip().lower()
        if block_id.startswith("contentlistitem:"):
            return True

        parent = block.find_parent(
            id=lambda value: isinstance(value, str)
            and value.lower().startswith("contentlistitem:")
        )
        if isinstance(parent, Tag):
            return True

        has_content_shell = block.select_one(".item h3") is not None
        has_rich_text_body = block.select_one(".vtbegenerated") is not None
        has_attachment_header = block.select_one(".contextItemDetailsHeaders") is not None
        return has_content_shell and (has_rich_text_body or has_attachment_header)

    def _has_explicit_announcement_metadata(self, block: Tag, details_text: str) -> bool:
        if block.select_one(".announcementInfo") is not None:
            return True

        hint = _parent_block_hint(block)
        if "announcement" in hint and not self._looks_like_course_content_item(block):
            return True

        lower_details = details_text.lower()
        return any(
            token in lower_details
            for token in ("posted on", "posted to", "posted by", "author")
        )

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
            maybe_course = clean_field(
                cells[0].get_text(" ", strip=True), max_length=160
            )
            if maybe_course != title and looks_like_course_name(maybe_course):
                course_name = maybe_course

        detail = clean_field(row_text, max_length=600)
        url = self.context.absolute_url(page_url, str(link.get("href") or "").strip())
        linked_content_candidates = self._extract_linked_content_candidates(row, page_url)
        return self._build_announcement_payload(
            announcement_id=self._resolve_announcement_record_id(
                row,
                announcement_url=url,
                linked_content_candidates=linked_content_candidates,
            ),
            course_id=self._extract_course_id_from_announcement_block(row, page_url),
            course_code=self._extract_course_code_from_announcement_block(
                row, page_url
            ),
            course_name=course_name,
            title=title,
            publish_time=publish_time,
            detail=detail,
            detail_html=None,
            author=self._extract_author_from_announcement_block(row),
            url=url,
            source_page=page_url,
            linked_content_candidates=linked_content_candidates,
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
        if self._looks_like_course_content_item(block):
            return None

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
        has_announcement_metadata = self._has_explicit_announcement_metadata(
            block, details_text
        )
        if not has_announcement_signal and not has_announcement_metadata:
            return None

        title = self._extract_announcement_title(block, block_text)
        if not title:
            return None

        body_node = block.select_one(".vtbegenerated")
        detail = clean_field(
            body_node.get_text(" ", strip=True)
            if body_node
            else (details_text or block_text),
            max_length=600,
        )
        detail_html = _clean_tag_html(body_node, max_length=12000) or None
        dom_id = clean_field(str(block.get("id") or ""), max_length=120)
        url = f"{page_url}#{dom_id}" if dom_id else page_url
        linked_content_candidates = self._extract_linked_content_candidates(block, page_url)

        return self._build_announcement_payload(
            announcement_id=self._resolve_announcement_record_id(
                block,
                announcement_url=url,
                linked_content_candidates=linked_content_candidates,
            ),
            course_id=self._extract_course_id_from_announcement_block(block, page_url),
            course_code=self._extract_course_code_from_announcement_block(
                block, page_url
            ),
            course_name=self._normalize_announcement_course_name(block, block_text),
            title=title,
            publish_time=publish_time,
            detail=detail,
            detail_html=detail_html,
            author=self._extract_author_from_announcement_block(block),
            url=url,
            source_page=page_url,
            linked_content_candidates=linked_content_candidates,
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

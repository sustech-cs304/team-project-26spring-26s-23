"""Blackboard 课程内容 / 资源 / sidebar 抓取 API。"""

from __future__ import annotations

import re
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from bs4 import BeautifulSoup
from bs4.element import Tag

from .context import BlackboardAPIContext
from .dto import ResourceDTO
from .scrape_support import (
    clean_field,
    is_course_content_page_url,
    is_navigation_noise,
    is_sidebar_seed_candidate,
    is_valid_resource,
    stable_resource_id,
)


RESOURCE_FILE_SUFFIX_RE = re.compile(
    r"\.(pdf|doc|docx|ppt|pptx|xls|xlsx|zip|rar|7z|mp4|mp3|txt|csv|jpg|png)$"
)
RESOURCE_SIZE_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)", re.IGNORECASE)


class BlackboardContentAPI:
    """负责 Blackboard 课程内容、sidebar 与资源递归抓取。"""

    def __init__(self, context: BlackboardAPIContext) -> None:
        self.context = context

    def get_course_sidebar(self, course_id: str) -> dict[str, list[dict[str, str]]]:
        """抓取并解析课程侧边栏链接。"""
        candidate_urls = [
            f"{self.context.base_url}/webapps/blackboard/content/listContent.jsp?course_id={course_id}",
            f"{self.context.base_url}/webapps/blackboard/execute/launcher?type=Course&id={course_id}",
        ]

        merged: dict[str, list[dict[str, str]]] = {}
        merged_seen_urls: set[str] = set()

        for page_url in candidate_urls:
            try:
                response = self.context.get(page_url, label="Sidebar")
                response.raise_for_status()
                parsed = self.parse_course_sidebar(response.text, str(response.url), course_id=course_id)
            except Exception as ex:
                self.context.log(f"⚠️ [Blackboard] sidebar解析失败，跳过页面: {page_url} - {ex}")
                continue

            for group, links in parsed.items():
                bucket = merged.setdefault(group, [])
                for item in links:
                    item_url = str(item.get("url") or "").strip()
                    if not item_url or item_url in merged_seen_urls:
                        continue
                    bucket.append(item)
                    merged_seen_urls.add(item_url)

        self.context.log(f"🔍 [Blackboard] sidebar分组数: {len(merged)}, sidebar seed命中数: {len(merged_seen_urls)}")
        return merged

    def parse_course_sidebar(self, html: str, page_url: str, *, course_id: str) -> dict[str, list[dict[str, str]]]:
        """解析课程左侧导航栏，返回按分组聚合的链接。"""
        if not html:
            return {}

        soup = BeautifulSoup(html, "html.parser")
        sidebar_root = soup.select_one("#courseMenuPalette_contents") or soup.select_one("#courseMenuPalette")
        if not isinstance(sidebar_root, Tag):
            return {}

        grouped_links: dict[str, list[dict[str, str]]] = {}
        group_seen_urls: dict[str, set[str]] = {}
        current_group = "默认分组"

        for li in sidebar_root.select("li"):
            if not isinstance(li, Tag):
                continue

            classes = {str(item).strip().lower() for item in (li.get("class") or [])}
            anchor = li.find("a", href=True)

            if anchor is None:
                if classes.intersection({"separator", "title", "menudivider"}):
                    header_text = clean_field(li.get_text(" ", strip=True), max_length=80)
                    if header_text:
                        current_group = header_text
                continue

            title = clean_field(anchor.get_text(" ", strip=True), max_length=180)
            href = clean_field(str(anchor.get("href") or ""), max_length=1500)
            if not href:
                continue

            full_url = self.context.absolute_url(page_url, href)
            normalized_url = urlparse(full_url)._replace(fragment="").geturl()

            if not is_sidebar_seed_candidate(title, normalized_url, course_id, base_url=self.context.base_url):
                continue

            bucket = grouped_links.setdefault(current_group, [])
            seen = group_seen_urls.setdefault(current_group, set())
            if normalized_url in seen:
                continue

            bucket.append({"title": title or "untitled", "url": normalized_url})
            seen.add(normalized_url)

        return {group: links for group, links in grouped_links.items() if links}

    def get_course_content_dtos(self, course_id: str) -> list[ResourceDTO]:
        """递归抓取课程内容中的资源链接，返回正式 DTO。"""
        self.context.log(f"🔍 [Blackboard] 开始获取课程资源, course_id={course_id}")

        seed_urls = [
            f"{self.context.base_url}/webapps/blackboard/content/listContent.jsp?course_id={course_id}",
            f"{self.context.base_url}/webapps/blackboard/execute/launcher?type=Course&id={course_id}",
        ]

        sidebar_seed_urls: list[str] = []
        try:
            sidebar = self.get_course_sidebar(course_id)
            for group_links in sidebar.values():
                for item in group_links:
                    candidate_url = str(item.get("url") or "").strip()
                    if candidate_url:
                        sidebar_seed_urls.append(candidate_url)
        except Exception as ex:
            self.context.log(f"⚠️ [Blackboard] sidebar seed解析异常，回退默认seed: {ex}")
            sidebar_seed_urls = []

        merged_seed_urls: list[str] = []
        seen_seed_urls: set[str] = set()
        for candidate in seed_urls + sidebar_seed_urls:
            normalized = urlparse(candidate)._replace(fragment="").geturl()
            if not normalized or normalized in seen_seed_urls:
                continue
            seen_seed_urls.add(normalized)
            merged_seed_urls.append(normalized)

        sidebar_seed_added = max(0, len(merged_seed_urls) - len(seed_urls))
        if sidebar_seed_urls:
            self.context.log(
                f"🔍 [Blackboard] sidebar seed候选数: {len(sidebar_seed_urls)}, 有效新增seed数: {sidebar_seed_added}, 合并后seed总数: {len(merged_seed_urls)}"
            )
        else:
            self.context.log("🔍 [Blackboard] sidebar seed为空，回退默认seed链路")

        queue: list[tuple[str, str | None]] = [(url, None) for url in merged_seed_urls]
        queued_urls: set[str] = set(merged_seed_urls)
        visited: set[str] = set()
        resources: list[ResourceDTO] = []
        seen_download_urls: set[str] = set()

        max_pages = 40
        while queue and len(visited) < max_pages:
            page_url, parent_resource_id = queue.pop(0)
            queued_urls.discard(page_url)
            if page_url in visited:
                continue

            visited.add(page_url)
            self.context.log(f"📄 [Blackboard] 访问内容页 ({len(visited)}/{max_pages}): {page_url}")

            try:
                response = self.context.get(page_url, label="Contents")
                response.raise_for_status()
            except Exception as ex:
                self.context.log(f"⚠️ [Blackboard] 内容页访问失败: {page_url} - {ex}")
                continue

            soup = BeautifulSoup(response.text, "html.parser")

            for link in soup.find_all("a", href=True):
                resource = self.extract_resource(
                    link,
                    page_url,
                    course_id=course_id,
                    parent_resource_id=parent_resource_id,
                )
                if not resource:
                    continue

                download_url = str(resource.url or "")
                if not download_url or download_url in seen_download_urls:
                    continue

                if not is_valid_resource(
                    {
                        "name": resource.title,
                        "download_url": resource.url,
                    },
                    logger=self.context.logger.child("api.scrape_support.resources") if self.context.logger is not None else None,
                ):
                    continue

                seen_download_urls.add(download_url)
                resources.append(resource)

            for link in soup.find_all("a", href=True):
                container = self.extract_content_container(
                    link,
                    page_url,
                    course_id=course_id,
                    parent_resource_id=parent_resource_id,
                )
                if not container:
                    continue

                child_url = str(container.url or "").strip()
                child_resource_id = str(container.resource_id or "").strip()
                if not child_url or not child_resource_id:
                    continue

                if child_url not in seen_download_urls:
                    seen_download_urls.add(child_url)
                    resources.append(container)

                if child_url in visited or child_url in queued_urls:
                    continue

                queue.append((child_url, child_resource_id))
                queued_urls.add(child_url)

        old_to_real_id: dict[str, str] = {}
        for resource in resources:
            old_id = str(resource.resource_id or "").strip()
            download_url = str(resource.url or "").strip()
            ids = self.context.extract_ids(download_url)
            real_id = ids.get("xid") or ids.get("rid") or ids.get("content_id")
            resource.resource_id = real_id
            if old_id and real_id:
                old_to_real_id[old_id] = real_id

        for resource in resources:
            parent_id = str(resource.parent_id or "").strip()
            if not parent_id:
                resource.parent_id = None
                continue
            resource.parent_id = old_to_real_id.get(parent_id)

        self.context.log(f"✅ [Blackboard] 资源抓取完成: 访问页面={len(visited)}, 资源数={len(resources)}")
        return resources

    def extract_content_container(
        self,
        link: Tag,
        page_url: str,
        *,
        course_id: str,
        parent_resource_id: str | None,
    ) -> ResourceDTO | None:
        """从课程内容页链接中提取目录/容器资源。"""
        href = str(link.get("href") or "").strip()
        if not href:
            return None

        full_url = self.context.absolute_url(page_url, href)
        parsed_raw = urlparse(full_url)
        normalized_url = parsed_raw._replace(fragment="").geturl()
        current_page_url = urlparse(page_url)._replace(fragment="").geturl()

        if normalized_url == current_page_url:
            return None

        if not is_course_content_page_url(normalized_url, course_id, base_url=self.context.base_url):
            return None

        parsed = urlparse(normalized_url)
        query = parse_qs(parsed.query)

        if "execute/launcher" in parsed.path.lower():
            return None
        if "content_id" not in query:
            return None

        name = link.get_text(strip=True)
        if not name:
            name = query.get("content_id", ["folder"])[0]

        if is_navigation_noise(name):
            return None

        resource_id = stable_resource_id(course_id, name, normalized_url)
        return ResourceDTO(
            resource_id=resource_id,
            course_id=course_id,
            title=name,
            url=normalized_url,
            type="folder",
            size="",
            source_page=page_url,
            parent_id=parent_resource_id,
        )

    def extract_resource(
        self,
        link: Tag,
        page_url: str,
        *,
        course_id: str,
        parent_resource_id: str | None,
    ) -> ResourceDTO | None:
        """从 `<a>` 标签中提取文件资源信息。"""
        href = str(link.get("href") or "").strip()
        if not href:
            return None

        full_url = self.context.absolute_url(page_url, href)
        parsed = urlparse(full_url)
        lower_url = full_url.lower()
        lower_path = parsed.path.lower()

        is_download_like = any(token in lower_url for token in ("/bbcswebdav/", "download", "xid=", "attachment"))
        is_download_like = is_download_like or bool(RESOURCE_FILE_SUFFIX_RE.search(lower_path))

        if "listcontent.jsp" in lower_path and "download" not in lower_url:
            return None
        if not is_download_like:
            return None

        name = link.get_text(strip=True)
        if not name:
            name = Path(parsed.path).name or "unnamed_resource"

        file_type = "link"
        suffix = Path(parsed.path).suffix.lower().lstrip(".")
        if suffix:
            file_type = suffix

        size = ""
        parent_text = link.parent.get_text(" ", strip=True) if link.parent else ""
        size_match = RESOURCE_SIZE_RE.search(parent_text)
        if size_match:
            size = f"{size_match.group(1)} {size_match.group(2).upper()}"

        return ResourceDTO(
            resource_id=stable_resource_id(course_id, name, full_url),
            course_id=course_id,
            title=name,
            url=full_url,
            type=file_type,
            size=size,
            parent_id=parent_resource_id,
            source_page=page_url,
        )




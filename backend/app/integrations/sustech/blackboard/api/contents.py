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
                parsed = self.parse_course_sidebar(
                    response.text, str(response.url), course_id=course_id
                )
            except Exception as ex:
                self.context.log(
                    f"⚠️ [Blackboard] sidebar解析失败，跳过页面: {page_url} - {ex}"
                )
                continue

            for group, links in parsed.items():
                bucket = merged.setdefault(group, [])
                for item in links:
                    item_url = str(item.get("url") or "").strip()
                    if not item_url or item_url in merged_seen_urls:
                        continue
                    bucket.append(item)
                    merged_seen_urls.add(item_url)

        self.context.log(
            f"🔍 [Blackboard] sidebar分组数: {len(merged)}, sidebar seed命中数: {len(merged_seen_urls)}"
        )
        return merged

    def parse_course_sidebar(
        self, html: str, page_url: str, *, course_id: str
    ) -> dict[str, list[dict[str, str]]]:
        """解析课程左侧导航栏，返回按分组聚合的链接。"""
        if not html:
            return {}

        soup = BeautifulSoup(html, "html.parser")
        sidebar_root = soup.select_one(
            "#courseMenuPalette_contents"
        ) or soup.select_one("#courseMenuPalette")
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
                    header_text = clean_field(
                        li.get_text(" ", strip=True), max_length=80
                    )
                    if header_text:
                        current_group = header_text
                continue

            title = clean_field(anchor.get_text(" ", strip=True), max_length=180)
            href = clean_field(str(anchor.get("href") or ""), max_length=1500)
            if not href:
                continue

            full_url = self.context.absolute_url(page_url, href)
            normalized_url = urlparse(full_url)._replace(fragment="").geturl()

            if not is_sidebar_seed_candidate(
                title, normalized_url, course_id, base_url=self.context.base_url
            ):
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

        merged_seed_urls = self._collect_seed_urls(course_id)
        resources = self._collect_course_resources(course_id, merged_seed_urls)
        self._normalize_resource_ids(resources)

        self.context.log(f"✅ [Blackboard] 资源抓取完成: 资源数={len(resources)}")
        return resources

    def _collect_seed_urls(self, course_id: str) -> list[str]:
        """合并默认入口与 sidebar 中提取出的 seed。"""
        seed_urls = [
            f"{self.context.base_url}/webapps/blackboard/content/listContent.jsp?course_id={course_id}",
            f"{self.context.base_url}/webapps/blackboard/execute/launcher?type=Course&id={course_id}",
        ]
        sidebar_seed_urls = self._collect_sidebar_seed_urls(course_id)
        merged_seed_urls = self._deduplicate_urls(seed_urls + sidebar_seed_urls)

        sidebar_seed_added = max(0, len(merged_seed_urls) - len(seed_urls))
        if sidebar_seed_urls:
            self.context.log(
                f"🔍 [Blackboard] sidebar seed候选数: {len(sidebar_seed_urls)}, 有效新增seed数: {sidebar_seed_added}, 合并后seed总数: {len(merged_seed_urls)}"
            )
        else:
            self.context.log("🔍 [Blackboard] sidebar seed为空，回退默认seed链路")

        return merged_seed_urls

    def _collect_sidebar_seed_urls(self, course_id: str) -> list[str]:
        """从 sidebar 中抽取可作为内容抓取入口的 URL。"""
        try:
            sidebar = self.get_course_sidebar(course_id)
        except Exception as ex:
            self.context.log(f"⚠️ [Blackboard] sidebar seed解析异常，回退默认seed: {ex}")
            return []

        sidebar_seed_urls: list[str] = []
        for group_links in sidebar.values():
            for item in group_links:
                candidate_url = str(item.get("url") or "").strip()
                if candidate_url:
                    sidebar_seed_urls.append(candidate_url)
        return sidebar_seed_urls

    def _deduplicate_urls(self, candidate_urls: list[str]) -> list[str]:
        """去重并标准化 URL，保持原始顺序。"""
        merged_urls: list[str] = []
        seen_urls: set[str] = set()
        for candidate in candidate_urls:
            normalized = urlparse(candidate)._replace(fragment="").geturl()
            if not normalized or normalized in seen_urls:
                continue
            seen_urls.add(normalized)
            merged_urls.append(normalized)
        return merged_urls

    def _collect_course_resources(
        self, course_id: str, seed_urls: list[str]
    ) -> list[ResourceDTO]:
        """按队列遍历课程内容页并收集资源。"""
        queue: list[tuple[str, str | None]] = [(url, None) for url in seed_urls]
        queued_urls: set[str] = set(seed_urls)
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
            self.context.log(
                f"📄 [Blackboard] 访问内容页 ({len(visited)}/{max_pages}): {page_url}"
            )

            soup = self._fetch_content_page_soup(page_url)
            if soup is None:
                continue

            links = list(soup.find_all("a", href=True))
            self._collect_page_file_resources(
                links,
                page_url,
                course_id=course_id,
                parent_resource_id=parent_resource_id,
                resources=resources,
                seen_download_urls=seen_download_urls,
            )
            self._collect_page_containers(
                links,
                page_url,
                course_id=course_id,
                parent_resource_id=parent_resource_id,
                resources=resources,
                seen_download_urls=seen_download_urls,
                queue=queue,
                queued_urls=queued_urls,
                visited=visited,
            )

        self.context.log(f"🔍 [Blackboard] 内容抓取访问页面数: {len(visited)}")
        return resources

    def _fetch_content_page_soup(self, page_url: str) -> BeautifulSoup | None:
        """请求并解析单个内容页。"""
        try:
            response = self.context.get(page_url, label="Contents")
            response.raise_for_status()
        except Exception as ex:
            self.context.log(f"⚠️ [Blackboard] 内容页访问失败: {page_url} - {ex}")
            return None

        return BeautifulSoup(response.text, "html.parser")

    def _collect_page_file_resources(
        self,
        links: list[Tag],
        page_url: str,
        *,
        course_id: str,
        parent_resource_id: str | None,
        resources: list[ResourceDTO],
        seen_download_urls: set[str],
    ) -> None:
        """从单页链接中提取文件资源。"""
        for link in links:
            resource = self.extract_resource(
                link,
                page_url,
                course_id=course_id,
                parent_resource_id=parent_resource_id,
            )
            if resource is None:
                continue

            download_url = str(resource.url or "").strip()
            if not download_url or download_url in seen_download_urls:
                continue

            if not self._is_collectable_resource(resource):
                continue

            seen_download_urls.add(download_url)
            resources.append(resource)

    def _is_collectable_resource(self, resource: ResourceDTO) -> bool:
        """判断资源是否应进入最终结果。"""
        return is_valid_resource(
            {
                "name": resource.title,
                "download_url": resource.url,
            },
            logger=self.context.logger.child("api.scrape_support.resources")
            if self.context.logger is not None
            else None,
        )

    def _collect_page_containers(
        self,
        links: list[Tag],
        page_url: str,
        *,
        course_id: str,
        parent_resource_id: str | None,
        resources: list[ResourceDTO],
        seen_download_urls: set[str],
        queue: list[tuple[str, str | None]],
        queued_urls: set[str],
        visited: set[str],
    ) -> None:
        """从单页链接中提取目录资源，并向队列补充未访问容器。"""
        for link in links:
            container = self.extract_content_container(
                link,
                page_url,
                course_id=course_id,
                parent_resource_id=parent_resource_id,
            )
            if container is None:
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

    def _normalize_resource_ids(self, resources: list[ResourceDTO]) -> None:
        """将临时 resource_id 归一化为 Blackboard 真实标识，并同步 parent_id。"""
        old_to_real_id: dict[str, str] = {}
        for resource in resources:
            old_id = str(resource.resource_id or "").strip()
            download_url = str(resource.url or "").strip()
            ids = self.context.extract_ids(download_url)
            real_id = ids.get("xid") or ids.get("rid") or ids.get("content_id")
            if not real_id:
                continue

            resource.resource_id = real_id
            if old_id:
                old_to_real_id[old_id] = real_id

        for resource in resources:
            parent_id = str(resource.parent_id or "").strip()
            if not parent_id:
                resource.parent_id = None
                continue
            resource.parent_id = old_to_real_id.get(parent_id, parent_id)

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

        if not is_course_content_page_url(
            normalized_url, course_id, base_url=self.context.base_url
        ):
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

        is_download_like = any(
            token in lower_url
            for token in ("/bbcswebdav/", "download", "xid=", "attachment")
        )
        is_download_like = is_download_like or bool(
            RESOURCE_FILE_SUFFIX_RE.search(lower_path)
        )

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

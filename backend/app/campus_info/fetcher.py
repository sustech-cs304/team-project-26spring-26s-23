from __future__ import annotations

import hashlib
from collections.abc import Iterable
from datetime import datetime
from urllib.parse import urljoin

import httpx
from bs4 import BeautifulSoup

from app.campus_info.models import DiscoveredOfficialDoc, OfficialDocCategory, OfficialDocSeed, SourceKind

HrefValue = str | Iterable[str] | None

# 给 URL 生成稳定的 source_id
def _stable_source_id(prefix: str, url: str) -> str:
    digest = hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]
    return f"{prefix}_{digest}"

# 标准化 href 值
def _normalize_href(href: HrefValue) -> str:
    if href is None:
        return ""
    if isinstance(href, str):
        return href.strip()
    for item in href:
        if item.strip():
            return item.strip()
    return ""

# 从 URL 中获取文本内容
def fetch_text(url: str, *, timeout_s: float = 20.0) -> str:
    with httpx.Client(follow_redirects=True, timeout=timeout_s) as client:
        resp = client.get(url, headers={"User-Agent": "Mozilla/5.0"})
        _ = resp.raise_for_status()
        return resp.text

# 尝试解析日期字符串
def _try_parse_date(text: str) -> str | None:
    value = (text or "").strip()
    if not value:
        return None
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d"):
        try:
            return datetime.strptime(value, fmt).date().isoformat()
        except ValueError:
            continue
    return None

# 解析 OSA 文件下载列表
def parse_osa_wjxzs_listing(
    html: str,
    *,
    listing_url: str,
    category: OfficialDocCategory,
) -> list[DiscoveredOfficialDoc]:
    soup = BeautifulSoup(html, "html.parser")
    docs: list[DiscoveredOfficialDoc] = []

    for a in soup.select("a[href]"):
        href = _normalize_href(a.get("href"))
        if not href:
            continue

        url = urljoin(listing_url, href)
        if url.lower().endswith(".pdf"):
            pass
        elif "m=college" in url.lower() and "a=download" in url.lower() and "id=" in url.lower():
            pass
        else:
            continue

        title = " ".join((a.get_text(" ", strip=True) or "").split())
        if not title:
            continue
        if title in {"首页", "尾页", "上一页", "下一页"}:
            continue

        updated_at = None
        container = a.parent
        if container is not None:
            nearby_text = " ".join(container.get_text(" ", strip=True).split())
            marker = "更新时间"
            if marker in nearby_text:
                tail = nearby_text.split(marker, 1)[1]
                tail = tail.lstrip(":：").strip()
                updated_at = _try_parse_date(tail[:10]) or _try_parse_date(tail.split()[0])

        docs.append(
            DiscoveredOfficialDoc(
                source_id=_stable_source_id("osa_doc", url),
                title=title,
                category=category,
                url=url,
                updated_at=updated_at,
            )
        )

    unique: dict[str, DiscoveredOfficialDoc] = {}
    for d in docs:
        unique[d.url] = d
    return list(unique.values())

# 解析规章制度目录页面
def parse_sustech_rules_and_regulations(
    html: str,
    *,
    listing_url: str,
    fallback_category: OfficialDocCategory,
) -> list[DiscoveredOfficialDoc]:
    soup = BeautifulSoup(html, "html.parser")
    docs: list[DiscoveredOfficialDoc] = []

    for a in soup.select("a[href]"):
        href = _normalize_href(a.get("href"))
        if not href:
            continue

        url = urljoin(listing_url, href)
        if not url.lower().endswith(".pdf"):
            continue

        title = " ".join((a.get_text(" ", strip=True) or "").split())
        if not title:
            continue

        if "章程" in title:
            category = OfficialDocCategory.GOVERNANCE
        elif "管理暂行办法" in title:
            category = OfficialDocCategory.ADMINISTRATION
        else:
            category = fallback_category

        docs.append(
            DiscoveredOfficialDoc(
                source_id=_stable_source_id("sustech_doc", url),
                title=title,
                category=category,
                url=url,
                updated_at=None,
            )
        )

    unique: dict[str, DiscoveredOfficialDoc] = {}
    for d in docs:
        unique[d.url] = d
    return list(unique.values())

# 对外暴露的函数，用于发现官方文档
def discover_official_docs(seed: OfficialDocSeed) -> list[DiscoveredOfficialDoc]:
    if seed.kind == SourceKind.PDF:
        return [
            DiscoveredOfficialDoc(
                source_id=seed.source_id,
                title=seed.title,
                category=seed.category,
                url=seed.url,
                updated_at=None,
            )
        ]

    if seed.kind == SourceKind.HTML_LISTING and seed.parser == "osa_wjxzs":
        discovered: dict[str, DiscoveredOfficialDoc] = {}
        with httpx.Client(follow_redirects=True, timeout=20.0) as client:
            for page in range(1, 6):
                page_url = seed.url if page == 1 else f"{seed.url}&p={page}"
                resp = client.get(page_url, headers={"User-Agent": "Mozilla/5.0"})
                _ = resp.raise_for_status()
                docs = parse_osa_wjxzs_listing(resp.text, listing_url=page_url, category=seed.category)
                if not docs:
                    break
                for d in docs:
                    discovered[d.url] = d
        return list(discovered.values())

    if seed.kind == SourceKind.HTML_LISTING and seed.parser == "sustech_rules_and_regulations":
        html = fetch_text(seed.url)
        return parse_sustech_rules_and_regulations(
            html,
            listing_url=seed.url,
            fallback_category=seed.category,
        )

    raise ValueError(f"unsupported seed kind/parser: {seed.kind} / {seed.parser}")


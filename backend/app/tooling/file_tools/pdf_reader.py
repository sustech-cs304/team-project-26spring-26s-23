"""Structured PDF reader for staged file tool Read support."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pdfplumber

from .errors import FileToolError
from .path_policy import PathResolution
from .protocol import PathMetadata, ReadRequest, ReadResult
from .text_reader import _build_sha256

_DEFAULT_MAX_INLINE_PAGES = 5
_MAX_READABLE_PAGES = 20


@dataclass(frozen=True, slots=True)
class PdfReadPayload:
    """Resolved PDF read payload before service/runtime envelope mapping."""

    result: ReadResult
    file_size: int


class FileToolPdfReader:
    """Read PDF files with bounded page extraction."""

    def __init__(self, *, page_range_required_threshold: int = _DEFAULT_MAX_INLINE_PAGES) -> None:
        if page_range_required_threshold < 0:
            raise ValueError("page_range_required_threshold must be greater than or equal to 0.")
        self._page_range_required_threshold = page_range_required_threshold

    def read_pdf(self, *, request: ReadRequest, resolution: PathResolution) -> PdfReadPayload:
        target_path = resolution.resolved_path
        if not target_path.exists():
            raise FileToolError(
                code="file_not_found",
                message="Target file does not exist.",
                details={"path": request.path, "resolvedPath": target_path.as_posix()},
            )
        if not target_path.is_file():
            raise FileToolError(
                code="not_a_file",
                message="Target path is not a regular file.",
                details={"path": request.path, "resolvedPath": target_path.as_posix()},
            )

        raw = target_path.read_bytes()
        file_size = len(raw)
        try:
            with pdfplumber.open(target_path) as pdf:
                total_pages = len(pdf.pages)
                start_page, end_page = _resolve_page_range(
                    request=request,
                    total_pages=total_pages,
                    threshold=self._page_range_required_threshold,
                )
                page_payloads: list[dict[str, Any]] = []
                extracted_text_parts: list[str] = []
                for page_number in range(start_page, end_page + 1):
                    page = pdf.pages[page_number - 1]
                    page_text = (page.extract_text() or "").strip()
                    page_payloads.append({"pageNumber": page_number, "text": page_text})
                    extracted_text_parts.append(f"[Page {page_number}]\n{page_text}")
        except FileToolError:
            raise
        except Exception as exc:
            raise FileToolError(
                code="invalid_request",
                message="PDF file could not be parsed.",
                details={"path": request.path, "resolvedPath": target_path.as_posix()},
            ) from exc

        path_metadata = PathMetadata(
            path=request.path,
            resolved_path=target_path.as_posix(),
            path_kind=resolution.path_kind,
            root_policy=resolution.root_policy,
            symlink_policy=resolution.symlink_policy,
        )
        page_count = end_page - start_page + 1
        metadata = {
            "fileSize": file_size,
            "sha256": _build_sha256(raw),
            "mimeType": "application/pdf",
            "totalPages": total_pages,
            "pageStart": start_page,
            "pageEnd": end_page,
            "pageCount": page_count,
        }
        return PdfReadPayload(
            result=ReadResult(
                kind="pdf",
                path=path_metadata,
                encoding="utf-8",
                truncated=False,
                next_offset=None,
                content={
                    "text": "\n\n".join(extracted_text_parts).strip(),
                    "pages": page_payloads,
                    "pageRange": {"start": start_page, "end": end_page},
                },
                metadata=metadata if request.include_metadata else {},
            ),
            file_size=file_size,
        )


def _resolve_page_range(*, request: ReadRequest, total_pages: int, threshold: int) -> tuple[int, int]:
    if total_pages < 1:
        raise FileToolError(
            code="invalid_request",
            message="PDF file does not contain readable pages.",
            details={"totalPages": total_pages},
        )
    if request.pages is None:
        if total_pages >= threshold and threshold >= 0:
            raise FileToolError(
                code="page_range_required",
                message="PDF page range is required for documents above the inline page threshold.",
                details={
                    "path": request.path,
                    "threshold": threshold,
                    "totalPages": total_pages,
                    "maxPagesPerRead": _MAX_READABLE_PAGES,
                },
            )
        return 1, min(total_pages, _MAX_READABLE_PAGES)
    start_page, end_page = request.pages
    if start_page > end_page:
        raise FileToolError(
            code="invalid_pages",
            message="PDF page range start must be less than or equal to end.",
            details={"pages": [start_page, end_page], "totalPages": total_pages},
        )
    if start_page < 1 or end_page > total_pages:
        raise FileToolError(
            code="invalid_pages",
            message="PDF page range must stay within the document bounds.",
            details={"pages": [start_page, end_page], "totalPages": total_pages},
        )
    if end_page - start_page + 1 > _MAX_READABLE_PAGES:
        raise FileToolError(
            code="invalid_pages",
            message="PDF reads are limited to at most 20 pages per request.",
            details={"pages": [start_page, end_page], "maxPagesPerRead": _MAX_READABLE_PAGES},
        )
    return start_page, end_page


__all__ = ["FileToolPdfReader", "PdfReadPayload"]

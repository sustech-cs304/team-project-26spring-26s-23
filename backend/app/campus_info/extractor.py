from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, cast

import pymupdf as fitz  

logger = logging.getLogger(__name__)

class _PdfPage(Protocol):
    def get_text(self, option: str) -> str: ...


class _PdfDoc(Protocol):
    def __len__(self) -> int: ...
    def __getitem__(self, index: int) -> _PdfPage: ...
    def close(self) -> None: ...



@dataclass(frozen=True)
class ExtractedPage:
    page_number: int
    text: str


@dataclass(frozen=True)
class ExtractedDocument:
    source_id: str
    title: str
    url: str
    pages: list[ExtractedPage]


def extract_pdf_document(
    pdf_path: Path, source_id: str, title: str, url: str
) -> ExtractedDocument | None:
    """
    Extract text from a PDF file using PyMuPDF.
    """
    if not pdf_path.exists():
        logger.error(f"PDF file not found: {pdf_path}")
        return None

    try:
        doc = cast(_PdfDoc, cast(object, fitz.open(str(pdf_path))))
        pages: list[ExtractedPage] = []
        for i in range(len(doc)):
            page = doc[i]
            raw_text = page.get_text("text")
            clean_text = raw_text.strip()
            if clean_text:
                pages.append(ExtractedPage(page_number=i + 1, text=clean_text))

        doc.close()

        return ExtractedDocument(
            source_id=source_id,
            title=title,
            url=url,
            pages=pages,
        )

    except Exception as e:
        logger.error(f"Failed to extract PDF {pdf_path}: {e}")
        return None

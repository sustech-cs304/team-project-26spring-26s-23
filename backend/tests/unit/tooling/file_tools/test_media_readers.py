from __future__ import annotations

import asyncio
import base64
from collections.abc import Awaitable
from pathlib import Path
from typing import TypeVar

import pytest

from app.tooling.file_tools import (
    FileToolError,
    FileToolImageReader,
    FileToolPathPolicy,
    FileToolPdfReader,
    ReadRequest,
)
from app.tooling.file_tools.runtime_bindings import build_file_tool_read_runtime_binding
from app.tooling.file_tools.service import FileToolReadService
from app.tooling.file_tools.text_reader import FileToolTextReader
from app.tooling.runtime_adapter.copilot_runtime import (
    RuntimeToolExecutionContext,
    runtime_tool_execution_scope,
)


_T = TypeVar("_T")


async def _as_coroutine(awaitable: Awaitable[_T]) -> _T:
    return await awaitable


_MINIMAL_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jk6sAAAAASUVORK5CYII="
_MINIMAL_GIF = b"GIF89a\x01\x00\x01\x00"
_MINIMAL_BMP = (
    b"BM"
    + (b"\x00" * 16)
    + (1).to_bytes(4, "little", signed=True)
    + (1).to_bytes(4, "little", signed=True)
)
_MINIMAL_WEBP = b"RIFF\x16\x00\x00\x00WEBPVP8X" + (b"\x00" * 14)
_MINIMAL_JPEG = b"\xff\xd8\xff\xc0\x00\x11\x08\x00\x01\x00\x01\x03\x01\x11\x00\x02\x11\x00\x03\x11\x00"
_MINIMAL_SVG = b'<svg width="2" height="3" xmlns="http://www.w3.org/2000/svg"></svg>'
_MINIMAL_PDF = b"""%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 44 >>
stream
BT /F1 18 Tf 72 96 Td (Hello PDF) Tj ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000241 00000 n 
0000000335 00000 n 
trailer
<< /Root 1 0 R /Size 6 >>
startxref
405
%%EOF
"""


def test_image_reader_requires_vision_capability(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    image_path = workspace_root / "pixel.png"
    image_path.write_bytes(base64.b64decode(_MINIMAL_PNG_BASE64))
    resolution = FileToolPathPolicy(workspace_root=workspace_root).resolve_path(
        "pixel.png"
    )

    reader = FileToolImageReader()
    request = ReadRequest(path="pixel.png", vision_enabled=False)

    try:
        reader.read_image(request=request, resolution=resolution)
    except FileToolError as exc:
        payload = exc.to_dict()
    else:
        raise AssertionError("Expected vision-gated image read to fail.")

    assert payload["code"] == "vision_required"
    assert payload["details"]["visionEnabled"] is False


def test_image_reader_returns_structured_payload_when_vision_enabled(
    tmp_path: Path,
) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    image_path = workspace_root / "pixel.png"
    image_bytes = base64.b64decode(_MINIMAL_PNG_BASE64)
    image_path.write_bytes(image_bytes)
    resolution = FileToolPathPolicy(workspace_root=workspace_root).resolve_path(
        "pixel.png"
    )

    payload = FileToolImageReader().read_image(
        request=ReadRequest(path="pixel.png", vision_enabled=True),
        resolution=resolution,
    )

    result = payload.result.to_dict()
    assert result["kind"] == "image"
    assert result["content"]["mimeType"] == "image/png"
    assert result["content"]["image"]["mediaType"] == "image/png"
    assert result["content"]["image"]["dataBase64"] == base64.b64encode(
        image_bytes
    ).decode("ascii")
    assert result["metadata"]["width"] == 1
    assert result["metadata"]["height"] == 1


@pytest.mark.parametrize(
    (
        "filename",
        "image_bytes",
        "expected_mime_type",
        "expected_width",
        "expected_height",
    ),
    [
        ("pixel.png", base64.b64decode(_MINIMAL_PNG_BASE64), "image/png", 1, 1),
        ("pixel.gif", _MINIMAL_GIF, "image/gif", 1, 1),
        ("pixel.bmp", _MINIMAL_BMP, "image/bmp", 1, 1),
        ("pixel.webp", _MINIMAL_WEBP, "image/webp", 1, 1),
        ("pixel.jpg", _MINIMAL_JPEG, "image/jpeg", 1, 1),
        ("diagram.svg", _MINIMAL_SVG, "image/svg+xml", 2, 3),
    ],
)
def test_image_reader_detects_supported_image_formats(
    tmp_path: Path,
    filename: str,
    image_bytes: bytes,
    expected_mime_type: str,
    expected_width: int,
    expected_height: int,
) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    image_path = workspace_root / filename
    image_path.write_bytes(image_bytes)
    resolution = FileToolPathPolicy(workspace_root=workspace_root).resolve_path(
        filename
    )

    payload = FileToolImageReader().read_image(
        request=ReadRequest(path=filename, vision_enabled=True),
        resolution=resolution,
    )

    result = payload.result.to_dict()
    assert result["content"]["mimeType"] == expected_mime_type
    assert result["metadata"]["mimeType"] == expected_mime_type
    assert result["metadata"]["width"] == expected_width
    assert result["metadata"]["height"] == expected_height


def test_image_reader_prefers_detected_raster_format_over_suffix(
    tmp_path: Path,
) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    image_path = workspace_root / "pixel.jpg"
    image_path.write_bytes(base64.b64decode(_MINIMAL_PNG_BASE64))
    resolution = FileToolPathPolicy(workspace_root=workspace_root).resolve_path(
        "pixel.jpg"
    )

    payload = FileToolImageReader().read_image(
        request=ReadRequest(path="pixel.jpg", vision_enabled=True),
        resolution=resolution,
    )

    result = payload.result.to_dict()
    assert result["content"]["mimeType"] == "image/png"
    assert result["metadata"]["width"] == 1
    assert result["metadata"]["height"] == 1


def test_image_reader_preserves_suffix_fallback_for_unrecognized_raster_bytes(
    tmp_path: Path,
) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    image_path = workspace_root / "broken.webp"
    image_path.write_bytes(b"not really a webp")
    resolution = FileToolPathPolicy(workspace_root=workspace_root).resolve_path(
        "broken.webp"
    )

    payload = FileToolImageReader().read_image(
        request=ReadRequest(path="broken.webp", vision_enabled=True),
        resolution=resolution,
    )

    result = payload.result.to_dict()
    assert result["content"]["mimeType"] == "image/webp"
    assert result["metadata"]["width"] is None
    assert result["metadata"]["height"] is None


def test_pdf_reader_extracts_text_and_page_metadata(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    pdf_path = workspace_root / "sample.pdf"
    pdf_path.write_bytes(_MINIMAL_PDF)
    resolution = FileToolPathPolicy(workspace_root=workspace_root).resolve_path(
        "sample.pdf"
    )

    payload = FileToolPdfReader().read_pdf(
        request=ReadRequest(path="sample.pdf"),
        resolution=resolution,
    )

    result = payload.result.to_dict()
    assert result["kind"] == "pdf"
    assert result["content"]["pageRange"] == {"start": 1, "end": 1}
    assert result["content"]["pages"] == [{"pageNumber": 1, "text": "Hello PDF"}]
    assert "[Page 1]" in result["content"]["text"]
    assert result["metadata"]["totalPages"] == 1


def test_pdf_reader_enforces_page_range_rules(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    pdf_path = workspace_root / "sample.pdf"
    pdf_path.write_bytes(_MINIMAL_PDF)
    resolution = FileToolPathPolicy(workspace_root=workspace_root).resolve_path(
        "sample.pdf"
    )
    reader = FileToolPdfReader(page_range_required_threshold=0)

    try:
        reader.read_pdf(request=ReadRequest(path="sample.pdf"), resolution=resolution)
    except FileToolError as exc:
        missing_range = exc.to_dict()
    else:
        raise AssertionError("Expected missing page range to fail.")

    try:
        reader.read_pdf(
            request=ReadRequest(path="sample.pdf", pages=(2, 1)),
            resolution=resolution,
        )
    except FileToolError as exc:
        invalid_range = exc.to_dict()
    else:
        raise AssertionError("Expected invalid page range to fail.")

    assert missing_range["code"] == "page_range_required"
    assert invalid_range["code"] == "invalid_pages"


def test_read_service_routes_media_reads(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    (workspace_root / "pixel.png").write_bytes(base64.b64decode(_MINIMAL_PNG_BASE64))
    (workspace_root / "sample.pdf").write_bytes(_MINIMAL_PDF)
    service = FileToolReadService(
        path_policy=FileToolPathPolicy(workspace_root=workspace_root),
        text_reader=FileToolTextReader(),
        image_reader=FileToolImageReader(),
        pdf_reader=FileToolPdfReader(),
    )

    image_result = service.read(ReadRequest(path="pixel.png", vision_enabled=True))
    pdf_result = service.read(ReadRequest(path="sample.pdf"))

    assert image_result.to_dict()["data"]["kind"] == "image"
    assert pdf_result.to_dict()["data"]["kind"] == "pdf"


def test_runtime_binding_uses_runtime_model_vision_flag(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    (workspace_root / "pixel.png").write_bytes(base64.b64decode(_MINIMAL_PNG_BASE64))
    binding = build_file_tool_read_runtime_binding(workspace_root=workspace_root)

    no_vision_result = asyncio.run(
        _as_coroutine(binding.execute({"path": "pixel.png"}))
    )

    assert no_vision_result["status"] == "error"
    assert no_vision_result["error"]["code"] == "execution_failed"

    with runtime_tool_execution_scope(
        RuntimeToolExecutionContext(
            tool_call_id="call-1",
            run_id="run-1",
            metadata={
                "resolvedModelRoute": {
                    "capabilityHints": {"vision": True},
                    "modelId": "gpt-4.1",
                    "providerId": "openai",
                }
            },
        )
    ):
        vision_result = asyncio.run(
            _as_coroutine(binding.execute({"path": "pixel.png"}))
        )

    assert vision_result["status"] == "success"
    assert vision_result["output"]["data"]["kind"] == "image"


def test_media_runtime_binding_allows_absolute_image_and_pdf_paths(
    tmp_path: Path,
) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    outside_root = tmp_path / "outside"
    outside_root.mkdir()
    image_path = outside_root / "pixel.png"
    pdf_path = outside_root / "sample.pdf"
    image_path.write_bytes(base64.b64decode(_MINIMAL_PNG_BASE64))
    pdf_path.write_bytes(_MINIMAL_PDF)
    binding = build_file_tool_read_runtime_binding(workspace_root=workspace_root)

    with runtime_tool_execution_scope(
        RuntimeToolExecutionContext(
            tool_call_id="call-1",
            run_id="run-1",
            metadata={
                "resolvedModelRoute": {
                    "capabilityHints": {"vision": True},
                    "modelId": "gpt-4.1",
                    "providerId": "openai",
                }
            },
        )
    ):
        image_result = asyncio.run(
            _as_coroutine(binding.execute({"path": str(image_path)}))
        )
    pdf_result = asyncio.run(_as_coroutine(binding.execute({"path": str(pdf_path)})))

    assert image_result["status"] == "success"
    assert (
        image_result["output"]["data"]["resolvedPath"]
        == image_path.resolve(strict=False).as_posix()
    )
    assert (
        image_result["output"]["data"]["effectiveRoot"]
        == outside_root.resolve(strict=False).as_posix()
    )
    assert image_result["output"]["data"]["rootSource"] == "absolute_override"
    assert pdf_result["status"] == "success"
    assert (
        pdf_result["output"]["data"]["resolvedPath"]
        == pdf_path.resolve(strict=False).as_posix()
    )
    assert (
        pdf_result["output"]["data"]["effectiveRoot"]
        == outside_root.resolve(strict=False).as_posix()
    )
    assert pdf_result["output"]["data"]["rootSource"] == "absolute_override"


def test_media_readers_allow_absolute_paths_outside_workspace(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    outside_root = tmp_path / "outside"
    outside_root.mkdir()
    image_path = outside_root / "pixel.png"
    pdf_path = outside_root / "sample.pdf"
    image_path.write_bytes(base64.b64decode(_MINIMAL_PNG_BASE64))
    pdf_path.write_bytes(_MINIMAL_PDF)

    image_resolution = FileToolPathPolicy(workspace_root=workspace_root).resolve_path(
        str(image_path)
    )
    pdf_resolution = FileToolPathPolicy(workspace_root=workspace_root).resolve_path(
        str(pdf_path)
    )

    image_result = (
        FileToolImageReader()
        .read_image(
            request=ReadRequest(path=str(image_path), vision_enabled=True),
            resolution=image_resolution,
        )
        .result.to_dict()
    )
    pdf_result = (
        FileToolPdfReader()
        .read_pdf(
            request=ReadRequest(path=str(pdf_path)),
            resolution=pdf_resolution,
        )
        .result.to_dict()
    )

    assert image_result["resolvedPath"] == image_path.resolve(strict=False).as_posix()
    assert (
        image_result["effectiveRoot"] == outside_root.resolve(strict=False).as_posix()
    )
    assert image_result["rootSource"] == "absolute_override"
    assert pdf_result["resolvedPath"] == pdf_path.resolve(strict=False).as_posix()
    assert pdf_result["effectiveRoot"] == outside_root.resolve(strict=False).as_posix()
    assert pdf_result["rootSource"] == "absolute_override"

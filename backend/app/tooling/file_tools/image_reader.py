"""Structured image reader for staged file tool Read support with vision gating."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any
import base64
import imghdr
import re
import struct

from .errors import FileToolError
from .path_policy import PathResolution
from .protocol import PathMetadata, ReadRequest, ReadResult
from .text_reader import _build_sha256

_SUPPORTED_IMAGE_SUFFIXES = frozenset(
    {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"}
)
_RASTER_MIME_BY_SUFFIX = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
}
_SVG_MIME = "image/svg+xml"


@dataclass(frozen=True, slots=True)
class ImageReadPayload:
    """Resolved image read payload before service/runtime envelope mapping."""

    result: ReadResult
    file_size: int


class FileToolImageReader:
    """Read image files into a structured payload, but only when vision is enabled."""

    def read_image(
        self, *, request: ReadRequest, resolution: PathResolution
    ) -> ImageReadPayload:
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
        if not request.vision_enabled:
            raise FileToolError(
                code="vision_required",
                message="Image reading requires a vision-capable model/provider for the current runtime.",
                details={
                    "path": request.path,
                    "resolvedPath": target_path.as_posix(),
                    "kind": "image",
                    "visionEnabled": False,
                },
            )

        raw = target_path.read_bytes()
        file_size = len(raw)
        suffix = target_path.suffix.lower()
        mime_type = _resolve_mime_type(path=target_path, raw=raw)
        width, height = _resolve_dimensions(
            path=target_path, raw=raw, mime_type=mime_type
        )
        path_metadata = PathMetadata(
            path=request.path,
            resolved_path=target_path.as_posix(),
            path_kind=resolution.path_kind,
            effective_root=resolution.effective_root.as_posix(),
            root_source=resolution.root_source,
            root_policy=resolution.root_policy,
            symlink_policy=resolution.symlink_policy,
        )
        content: dict[str, Any] = {
            "mimeType": mime_type,
            "image": {
                "mediaType": mime_type,
                "dataBase64": base64.b64encode(raw).decode("ascii"),
            },
        }
        metadata = {
            "fileSize": file_size,
            "sha256": _build_sha256(raw),
            "mimeType": mime_type,
            "width": width,
            "height": height,
            "visionEnabled": True,
            "source": "inline-base64",
            "suffix": suffix,
        }
        return ImageReadPayload(
            result=ReadResult(
                kind="image",
                path=path_metadata,
                truncated=False,
                next_offset=None,
                content=content,
                metadata=metadata if request.include_metadata else {},
            ),
            file_size=file_size,
        )


def is_supported_image_path(path: Path) -> bool:
    return path.suffix.lower() in _SUPPORTED_IMAGE_SUFFIXES


def _resolve_mime_type(*, path: Path, raw: bytes) -> str:
    suffix = path.suffix.lower()
    if suffix == ".svg":
        return _SVG_MIME
    detected = imghdr.what(None, raw)
    if detected == "jpeg":
        return "image/jpeg"
    if detected == "png":
        return "image/png"
    if detected == "gif":
        return "image/gif"
    if detected == "bmp":
        return "image/bmp"
    if detected == "webp":
        return "image/webp"
    return _RASTER_MIME_BY_SUFFIX.get(suffix, "application/octet-stream")


def _resolve_dimensions(
    *, path: Path, raw: bytes, mime_type: str
) -> tuple[int | None, int | None]:
    try:
        if mime_type == "image/png":
            return _read_png_dimensions(raw)
        if mime_type == "image/gif":
            return _read_gif_dimensions(raw)
        if mime_type == "image/bmp":
            return _read_bmp_dimensions(raw)
        if mime_type == "image/webp":
            return _read_webp_dimensions(raw)
        if mime_type == "image/jpeg":
            return _read_jpeg_dimensions(raw)
        if mime_type == _SVG_MIME:
            return _read_svg_dimensions(path)
    except (OSError, ValueError):
        return None, None
    return None, None


def _read_png_dimensions(raw: bytes) -> tuple[int | None, int | None]:
    if len(raw) < 24 or raw[:8] != b"\x89PNG\r\n\x1a\n":
        return None, None
    width, height = struct.unpack(">II", raw[16:24])
    return int(width), int(height)


def _read_gif_dimensions(raw: bytes) -> tuple[int | None, int | None]:
    if len(raw) < 10 or raw[:6] not in {b"GIF87a", b"GIF89a"}:
        return None, None
    width, height = struct.unpack("<HH", raw[6:10])
    return int(width), int(height)


def _read_bmp_dimensions(raw: bytes) -> tuple[int | None, int | None]:
    if len(raw) < 26 or raw[:2] != b"BM":
        return None, None
    width, height = struct.unpack("<ii", raw[18:26])
    return abs(int(width)), abs(int(height))


def _read_webp_dimensions(raw: bytes) -> tuple[int | None, int | None]:
    if len(raw) < 30 or raw[:4] != b"RIFF" or raw[8:12] != b"WEBP":
        return None, None
    chunk = raw[12:16]
    if chunk == b"VP8X" and len(raw) >= 30:
        width = 1 + int.from_bytes(raw[24:27], "little")
        height = 1 + int.from_bytes(raw[27:30], "little")
        return width, height
    if chunk == b"VP8 " and len(raw) >= 30:
        width, height = struct.unpack("<HH", raw[26:30])
        return int(width & 0x3FFF), int(height & 0x3FFF)
    if chunk == b"VP8L" and len(raw) >= 25:
        bits = int.from_bytes(raw[21:25], "little")
        width = (bits & 0x3FFF) + 1
        height = ((bits >> 14) & 0x3FFF) + 1
        return width, height
    return None, None


def _read_jpeg_dimensions(raw: bytes) -> tuple[int | None, int | None]:
    if len(raw) < 4 or raw[:2] != b"\xff\xd8":
        return None, None
    index = 2
    while index + 9 < len(raw):
        if raw[index] != 0xFF:
            index += 1
            continue
        marker = raw[index + 1]
        index += 2
        while marker == 0xFF and index < len(raw):
            marker = raw[index]
            index += 1
        if marker in {0xD8, 0xD9}:
            continue
        if index + 2 > len(raw):
            break
        segment_length = struct.unpack(">H", raw[index : index + 2])[0]
        if segment_length < 2 or index + segment_length > len(raw):
            break
        if marker in {
            0xC0,
            0xC1,
            0xC2,
            0xC3,
            0xC5,
            0xC6,
            0xC7,
            0xC9,
            0xCA,
            0xCB,
            0xCD,
            0xCE,
            0xCF,
        }:
            if index + 7 > len(raw):
                break
            height, width = struct.unpack(">HH", raw[index + 3 : index + 7])
            return int(width), int(height)
        index += segment_length
    return None, None


def _read_svg_dimensions(path: Path) -> tuple[int | None, int | None]:
    svg_text = path.read_text(encoding="utf-8")
    root_attributes = _extract_svg_root_attributes(svg_text)
    width = _parse_svg_length(root_attributes.get("width"))
    height = _parse_svg_length(root_attributes.get("height"))
    if width is not None and height is not None:
        return width, height
    view_box = root_attributes.get("viewBox")
    if view_box is None:
        return None, None
    parts = [part for part in view_box.replace(",", " ").split() if part]
    if len(parts) != 4:
        return None, None
    try:
        return int(float(parts[2])), int(float(parts[3]))
    except ValueError:
        return None, None


def _extract_svg_root_attributes(svg_text: str) -> dict[str, str]:
    root_match = re.search(r"<svg\b(?P<attrs>[^>]*)>", svg_text, flags=re.IGNORECASE)
    if root_match is None:
        return {}

    attributes: dict[str, str] = {}
    for key, double_quoted, single_quoted in re.findall(
        r"([:\w.-]+)\s*=\s*(?:\"([^\"]*)\"|'([^']*)')",
        root_match.group("attrs"),
    ):
        attributes[key] = double_quoted or single_quoted
    return attributes


def _parse_svg_length(value: str | None) -> int | None:
    if value is None:
        return None
    text = value.strip()
    if text == "":
        return None
    digits: list[str] = []
    for char in text:
        if char.isdigit() or char in {".", "-"}:
            digits.append(char)
        else:
            break
    if not digits:
        return None
    try:
        return int(float("".join(digits)))
    except ValueError:
        return None


__all__ = ["FileToolImageReader", "ImageReadPayload", "is_supported_image_path"]

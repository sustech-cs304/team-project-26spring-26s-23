from __future__ import annotations

from pathlib import Path

from app.tooling.file_tools import FileToolPathPolicy, ReadRequest
from app.tooling.file_tools.service import FileToolReadService
from app.tooling.file_tools.text_reader import FileToolTextReader


def test_file_tool_read_service_returns_success_envelope(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    target = workspace_root / "notes.txt"
    target.write_text("a\nb\nc\n", encoding="utf-8")
    service = FileToolReadService(
        path_policy=FileToolPathPolicy(workspace_root=workspace_root),
        text_reader=FileToolTextReader(),
    )

    result = service.read(ReadRequest(path="notes.txt", offset=2, limit=1))

    assert result.to_dict()["ok"] is True
    assert result.to_dict()["tool"] == "Read"
    assert result.to_dict()["data"]["content"] == {"text": "b"}
    assert result.to_dict()["data"]["nextOffset"] == 3


def test_file_tool_read_service_maps_file_errors_into_failure_envelope(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    service = FileToolReadService(
        path_policy=FileToolPathPolicy(workspace_root=workspace_root),
        text_reader=FileToolTextReader(),
    )

    result = service.read(ReadRequest(path="missing.txt"))

    assert result.to_dict()["ok"] is False
    assert result.to_dict()["tool"] == "Read"
    assert result.to_dict()["error"]["code"] == "file_not_found"

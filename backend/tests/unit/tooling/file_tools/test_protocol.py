from __future__ import annotations

import pytest

from app.tooling.file_tools import (
    AuditMetadata,
    FileToolCallMetadata,
    FileToolError,
    GlobMatch,
    GlobRequest,
    GrepMatch,
    GrepRequest,
    PathMetadata,
    ReadRequest,
    ReadResult,
    ToolResultEnvelope,
    WriteRequest,
    WriteResult,
)


def test_read_request_and_result_serialize_to_stable_protocol_shape() -> None:
    audit = AuditMetadata(actor="agent", intent="read_context", session_id="session-1")
    request = ReadRequest(path="docs/spec.md", offset=3, limit=40, parser_hint="text", audit=audit)
    path = PathMetadata(
        path="docs/spec.md",
        resolved_path="C:/workspace/docs/spec.md",
        path_kind="relative",
    )
    result = ReadResult(
        kind="text",
        path=path,
        encoding="utf-8",
        truncated=True,
        next_offset=43,
        content={"text": "line 3\nline 4"},
        metadata={"lineStart": 3, "lineCount": 2},
    )

    assert request.to_dict() == {
        "path": "docs/spec.md",
        "offset": 3,
        "limit": 40,
        "includeMetadata": True,
        "parserHint": "text",
        "audit": {
            "actor": "agent",
            "intent": "read_context",
            "sessionId": "session-1",
        },
    }
    assert result.to_dict() == {
        "kind": "text",
        "path": "docs/spec.md",
        "resolvedPath": "C:/workspace/docs/spec.md",
        "pathKind": "relative",
        "rootPolicy": "workspace_only",
        "symlinkPolicy": "deny_escape",
        "encoding": "utf-8",
        "truncated": True,
        "nextOffset": 43,
        "content": {"text": "line 3\nline 4"},
        "metadata": {"lineStart": 3, "lineCount": 2},
    }


def test_write_request_and_result_serialize_to_stable_protocol_shape() -> None:
    audit = AuditMetadata(actor="agent", intent="write_file", session_id="session-2")
    request = WriteRequest(
        path="docs/spec.md",
        content="updated text",
        overwrite=False,
        expected_hash="sha256:abcd",
        audit=audit,
    )
    path = PathMetadata(
        path="docs/spec.md",
        resolved_path="C:/workspace/docs/spec.md",
        path_kind="relative",
    )
    result = WriteResult(
        path=path,
        encoding="utf-8",
        created=False,
        overwritten=True,
        metadata={"fileSize": 12, "sha256": "sha256:efgh", "writeMode": "overwrite"},
    )

    assert request.to_dict() == {
        "path": "docs/spec.md",
        "content": "updated text",
        "encoding": "utf-8",
        "overwrite": False,
        "atomic": True,
        "expectedHash": "sha256:abcd",
        "audit": {
            "actor": "agent",
            "intent": "write_file",
            "sessionId": "session-2",
        },
    }
    assert result.to_dict() == {
        "path": "docs/spec.md",
        "resolvedPath": "C:/workspace/docs/spec.md",
        "pathKind": "relative",
        "rootPolicy": "workspace_only",
        "symlinkPolicy": "deny_escape",
        "encoding": "utf-8",
        "created": False,
        "overwritten": True,
        "metadata": {"fileSize": 12, "sha256": "sha256:efgh", "writeMode": "overwrite"},
    }


def test_glob_and_grep_shapes_share_path_metadata() -> None:
    path = PathMetadata(
        path="src/app.py",
        resolved_path="C:/workspace/src/app.py",
        path_kind="relative",
    )
    glob_request = GlobRequest(base_path="src", pattern="**/*.py", include_hidden=True, max_results=20)
    glob_match = GlobMatch(
        path=path,
        is_directory=False,
        is_hidden=False,
        size_bytes=123,
        modified_time_ms=1700000000000,
    )
    grep_request = GrepRequest(
        base_path="src",
        pattern="TODO",
        file_glob="**/*.py",
        context_lines=2,
        max_results=10,
    )
    grep_match = GrepMatch(
        path=path,
        line_number=12,
        column_number=3,
        line_text="TODO: refine",
        match_text="TODO",
        before=("# note",),
        after=("pass",),
    )

    assert glob_request.to_dict() == {
        "basePath": "src",
        "pattern": "**/*.py",
        "includeHidden": True,
        "maxResults": 20,
    }
    assert glob_match.to_dict() == {
        "path": "src/app.py",
        "resolvedPath": "C:/workspace/src/app.py",
        "pathKind": "relative",
        "rootPolicy": "workspace_only",
        "symlinkPolicy": "deny_escape",
        "isDirectory": False,
        "isHidden": False,
        "sizeBytes": 123,
        "modifiedTimeMs": 1700000000000,
    }
    assert grep_request.to_dict() == {
        "basePath": "src",
        "pattern": "TODO",
        "fileGlob": "**/*.py",
        "isRegex": False,
        "caseSensitive": False,
        "contextLines": 2,
        "includeHidden": False,
        "maxResults": 10,
    }
    assert grep_match.to_dict() == {
        "path": "src/app.py",
        "resolvedPath": "C:/workspace/src/app.py",
        "pathKind": "relative",
        "rootPolicy": "workspace_only",
        "symlinkPolicy": "deny_escape",
        "lineNumber": 12,
        "columnNumber": 3,
        "lineText": "TODO: refine",
        "matchText": "TODO",
        "before": ["# note"],
        "after": ["pass"],
    }


def test_result_envelope_enforces_success_and_failure_invariants() -> None:
    metadata = FileToolCallMetadata(duration_ms=12, audit=AuditMetadata(actor="agent"))
    envelope = ToolResultEnvelope(
        ok=True,
        tool="Read",
        request_id="req-1",
        data={"kind": "text"},
        metadata=metadata,
    )

    assert envelope.to_dict() == {
        "ok": True,
        "tool": "Read",
        "requestId": "req-1",
        "data": {"kind": "text"},
        "metadata": {"durationMs": 12, "audit": {"actor": "agent"}},
    }

    with pytest.raises(ValueError, match="Successful file tool envelopes cannot include an error payload"):
        ToolResultEnvelope(
            ok=True,
            tool="Read",
            error=FileToolError(code="invalid_request", message="bad request"),
        )

    with pytest.raises(ValueError, match="Failed file tool envelopes must include an error payload"):
        ToolResultEnvelope(ok=False, tool="Read")

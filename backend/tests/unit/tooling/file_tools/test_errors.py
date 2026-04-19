from __future__ import annotations

from typing import Any, cast

import pytest

from app.tooling.file_tools import FILE_TOOL_ERROR_CODES, FileToolError


def test_file_tool_error_exposes_stable_codes_and_serialization() -> None:
    error = FileToolError(
        code="path_out_of_bounds",
        message="Resolved path escapes the workspace root.",
        details={"path": "../secret.txt"},
    )

    assert "invalid_request" in FILE_TOOL_ERROR_CODES
    assert "permission_denied" in FILE_TOOL_ERROR_CODES
    assert error.retryable is False
    assert error.to_dict() == {
        "code": "path_out_of_bounds",
        "message": "Resolved path escapes the workspace root.",
        "retryable": False,
        "details": {"path": "../secret.txt"},
    }


def test_file_tool_error_rejects_unknown_error_code() -> None:
    invalid_code = cast(Any, "unknown")

    with pytest.raises(ValueError, match="Unknown file tool error code"):
        FileToolError(code=invalid_code, message="boom")

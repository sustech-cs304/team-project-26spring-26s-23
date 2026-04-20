from __future__ import annotations

from pathlib import Path

import pytest

import app.integrations.sustech.teaching_information_system.provider.use_cases.diagnostics as diagnostics_module


def test_run_tis_link_diagnostic_from_env_requires_explicit_env_path() -> None:
    with pytest.raises(RuntimeError, match="explicit env_path"):
        diagnostics_module.run_tis_link_diagnostic_from_env()



def test_run_tis_link_diagnostic_from_env_reads_credentials_from_explicit_path(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    env_path = tmp_path / "tis.env"
    env_path.write_text(
        "SUSTECH_USERNAME=test-user\n"
        "SUSTECH_PASSWORD=test-pass\n"
        "TIS_ROLE_CODE=02\n",
        encoding="utf-8",
    )

    captured: dict[str, object] = {}

    def fake_run_tis_link_diagnostic(
        username: str,
        password: str,
        *,
        role_code: str | None = None,
        config=None,
        enable_console_logging: bool = False,
        max_probe_count: int = 12,
    ) -> dict[str, object]:
        captured.update(
            username=username,
            password=password,
            role_code=role_code,
            config=config,
            enable_console_logging=enable_console_logging,
            max_probe_count=max_probe_count,
        )
        return {"ok": True}

    monkeypatch.setattr(
        diagnostics_module,
        "run_tis_link_diagnostic",
        fake_run_tis_link_diagnostic,
    )

    result = diagnostics_module.run_tis_link_diagnostic_from_env(
        env_path=str(env_path),
        enable_console_logging=True,
        max_probe_count=4,
    )

    assert captured == {
        "username": "test-user",
        "password": "test-pass",
        "role_code": "02",
        "config": None,
        "enable_console_logging": True,
        "max_probe_count": 4,
    }
    assert result["ok"] is True
    assert result["env_path"] == str(env_path)
    assert result["env_summary"] == {
        "username_present": True,
        "password_present": True,
        "role_code_present": True,
    }

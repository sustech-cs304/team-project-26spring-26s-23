from dataclasses import replace

from app.copilot_runtime import build_runtime_scaffold
from app.copilot_runtime.errors import build_method_not_implemented_error


def test_build_method_not_implemented_error_uses_current_scaffold_supported_methods() -> None:
    scaffold = replace(
        build_runtime_scaffold(model_configured=True),
        supported_methods=("info", "session/create"),
    )

    payload = build_method_not_implemented_error(
        requested_method="future/method",
        scaffold=scaffold,
    ).to_dict()

    assert payload["error"]["supportedMethods"] == ["info", "session/create"]
    assert payload["error"]["message"] == (
        "Runtime method 'future/method' is not implemented yet in the current scaffold. "
        "Supported methods are info and session/create."
    )

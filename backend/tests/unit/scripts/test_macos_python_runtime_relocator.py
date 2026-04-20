from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any


def _load_relocator_module() -> Any:
    workspace_root = Path(__file__).resolve().parents[4]
    module_path = workspace_root / ".github" / "scripts" / "macos_python_runtime_relocator.py"
    module_name = "macos_python_runtime_relocator"
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def test_build_relocation_plan_rewrites_absolute_runtime_and_homebrew_dependencies(tmp_path: Path) -> None:
    relocator = _load_relocator_module()
    runtime_root = (tmp_path / "python-runtime").resolve()
    python_binary = runtime_root / "bin" / "python3"
    internal_libpython = runtime_root / "lib" / "libpython3.12.dylib"
    external_libssl = (tmp_path / "opt" / "homebrew" / "lib" / "libssl.3.dylib").resolve()
    external_libcrypto = (tmp_path / "opt" / "homebrew" / "lib" / "libcrypto.3.dylib").resolve()

    for binary_path in (
        python_binary,
        internal_libpython,
        external_libssl,
        external_libcrypto,
    ):
        binary_path.parent.mkdir(parents=True, exist_ok=True)
        binary_path.write_bytes(b"placeholder")

    metadata_by_path = {
        python_binary: relocator.BinaryMetadata(
            path=python_binary,
            dependencies=(
                internal_libpython.as_posix(),
                external_libssl.as_posix(),
                "/usr/lib/libSystem.B.dylib",
            ),
            install_name=None,
        ),
        internal_libpython: relocator.BinaryMetadata(
            path=internal_libpython,
            dependencies=("/usr/lib/libSystem.B.dylib",),
            install_name=internal_libpython.as_posix(),
        ),
        external_libssl: relocator.BinaryMetadata(
            path=external_libssl,
            dependencies=(external_libcrypto.as_posix(),),
            install_name=external_libssl.as_posix(),
        ),
        external_libcrypto: relocator.BinaryMetadata(
            path=external_libcrypto,
            dependencies=("/usr/lib/libSystem.B.dylib",),
            install_name=external_libcrypto.as_posix(),
        ),
    }

    plan = relocator.build_relocation_plan(
        runtime_root,
        [python_binary, internal_libpython],
        lambda path: metadata_by_path[path.resolve()],
    )

    copied_destinations = {destination for _, destination in plan.copied_binaries}
    expected_bundled_root = runtime_root / "lib" / "bundled-macos-dylibs"
    assert copied_destinations == {
        expected_bundled_root / "libcrypto.3.dylib",
        expected_bundled_root / "libssl.3.dylib",
    }

    updates_by_destination = {
        update.destination_path: update for update in plan.updates
    }
    assert dict(updates_by_destination[python_binary].dependency_changes) == {
        internal_libpython.as_posix(): "@loader_path/../lib/libpython3.12.dylib",
        external_libssl.as_posix(): "@loader_path/../lib/bundled-macos-dylibs/libssl.3.dylib",
    }
    assert updates_by_destination[internal_libpython].install_name == "@loader_path/libpython3.12.dylib"
    assert dict(
        updates_by_destination[expected_bundled_root / "libssl.3.dylib"].dependency_changes
    ) == {
        external_libcrypto.as_posix(): "@loader_path/libcrypto.3.dylib"
    }
    assert (
        updates_by_destination[expected_bundled_root / "libssl.3.dylib"].install_name
        == "@loader_path/libssl.3.dylib"
    )


def test_find_non_relocatable_references_flags_absolute_homebrew_dependencies(tmp_path: Path) -> None:
    relocator = _load_relocator_module()
    runtime_root = (tmp_path / "python-runtime").resolve()
    binary_path = runtime_root / "bin" / "python3"
    metadata = relocator.BinaryMetadata(
        path=binary_path,
        dependencies=(
            "/opt/homebrew/opt/openssl@3/lib/libssl.3.dylib",
            "@loader_path/../lib/libpython3.12.dylib",
            "/usr/lib/libSystem.B.dylib",
        ),
        install_name=None,
    )

    violations = relocator.find_non_relocatable_references(runtime_root, metadata)

    assert violations == [
        f"{binary_path.as_posix()}: dependency remains non-relocatable (/opt/homebrew/opt/openssl@3/lib/libssl.3.dylib)"
    ]

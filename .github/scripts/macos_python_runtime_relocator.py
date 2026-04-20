from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Callable


MACHO_MAGIC_HEADERS = {
    b"\xfe\xed\xfa\xce",
    b"\xce\xfa\xed\xfe",
    b"\xfe\xed\xfa\xcf",
    b"\xcf\xfa\xed\xfe",
    b"\xca\xfe\xba\xbe",
    b"\xbe\xba\xfe\xca",
    b"\xca\xfe\xba\xbf",
    b"\xbf\xba\xfe\xca",
}
SYSTEM_LIBRARY_PREFIXES = ("/System/Library/", "/usr/lib/")
RELATIVE_LIBRARY_PREFIXES = ("@executable_path/", "@loader_path/", "@rpath/")
BUNDLED_DYLIB_DIRECTORY = Path("lib") / "bundled-macos-dylibs"


@dataclass(frozen=True)
class BinaryMetadata:
    path: Path
    dependencies: tuple[str, ...]
    install_name: str | None = None
    rpaths: tuple[str, ...] = ()


@dataclass(frozen=True)
class BinaryUpdate:
    source_path: Path
    destination_path: Path
    dependency_changes: tuple[tuple[str, str], ...]
    install_name: str | None = None
    rpaths_to_delete: tuple[str, ...] = ()


@dataclass(frozen=True)
class RelocationPlan:
    copied_binaries: tuple[tuple[Path, Path], ...]
    updates: tuple[BinaryUpdate, ...]


def is_macho_file(path: Path) -> bool:
    try:
        with path.open("rb") as handle:
            return handle.read(4) in MACHO_MAGIC_HEADERS
    except OSError:
        return False


def discover_runtime_macho_files(runtime_root: Path) -> list[Path]:
    binaries: list[Path] = []

    for candidate in runtime_root.rglob("*"):
        if candidate.is_symlink() or not candidate.is_file():
            continue
        if is_macho_file(candidate):
            binaries.append(candidate.resolve(strict=True))

    return sorted(set(binaries))


def parse_otool_libraries(output: str) -> tuple[str, ...]:
    libraries: list[str] = []

    for line in output.splitlines()[1:]:
        stripped = line.strip()
        if stripped == "":
            continue
        libraries.append(stripped.split(" (", 1)[0])

    return tuple(libraries)


def parse_otool_rpaths(output: str) -> tuple[str, ...]:
    rpaths: list[str] = []
    lines = output.splitlines()

    for index, line in enumerate(lines):
        if line.strip() != "cmd LC_RPATH":
            continue

        for candidate in lines[index + 1 :]:
            stripped = candidate.strip()
            if stripped.startswith("path "):
                rpaths.append(stripped.split(" (offset ", 1)[0][5:])
                break
            if stripped.startswith("cmd "):
                break

    return tuple(rpaths)


def load_binary_metadata(path: Path) -> BinaryMetadata:
    resolved_path = path.resolve(strict=True)
    dependency_result = run_command("inspect Mach-O dependencies", ["otool", "-L", str(resolved_path)])
    load_commands_result = run_command("inspect Mach-O load commands", ["otool", "-l", str(resolved_path)])
    install_name_result = subprocess.run(
        ["otool", "-D", str(resolved_path)],
        capture_output=True,
        text=True,
        check=False,
    )

    install_name: str | None = None
    if install_name_result.returncode == 0:
        install_name_lines = [line.strip() for line in install_name_result.stdout.splitlines() if line.strip()]
        if len(install_name_lines) > 1:
            install_name = install_name_lines[1]

    dependencies = tuple(
        dependency
        for dependency in parse_otool_libraries(dependency_result.stdout)
        if dependency != install_name
    )
    return BinaryMetadata(
        path=resolved_path,
        dependencies=dependencies,
        install_name=install_name,
        rpaths=parse_otool_rpaths(load_commands_result.stdout),
    )


def classify_reference(reference: str, runtime_root: Path) -> str:
    if reference.startswith(RELATIVE_LIBRARY_PREFIXES):
        return "relative"

    if reference.startswith(SYSTEM_LIBRARY_PREFIXES):
        return "system"

    if not os.path.isabs(reference):
        return "invalid"

    resolved_reference = Path(reference).resolve(strict=False)
    if is_path_inside_root(resolved_reference, runtime_root):
        return "runtime-absolute"

    return "external-absolute"


def is_path_inside_root(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def classify_rpath(reference: str, runtime_root: Path) -> str:
    if reference.startswith(("@loader_path/", "@executable_path/")):
        return "relative"

    if reference.startswith(SYSTEM_LIBRARY_PREFIXES):
        return "system"

    if not os.path.isabs(reference):
        return "invalid"

    resolved_reference = Path(reference).resolve(strict=False)
    if is_path_inside_root(resolved_reference, runtime_root):
        return "runtime-absolute"

    return "external-absolute"


def resolve_loader_relative_reference(reference: str, loader_binary_path: Path) -> Path:
    if reference.startswith("@loader_path/"):
        suffix = reference.removeprefix("@loader_path/")
        return (loader_binary_path.parent / suffix).resolve(strict=False)

    if reference.startswith("@executable_path/"):
        suffix = reference.removeprefix("@executable_path/")
        return (loader_binary_path.parent / suffix).resolve(strict=False)

    raise RuntimeError(f"Unsupported loader-relative reference: {reference}")


def resolve_rpath_entry(reference: str, loader_binary_path: Path) -> Path:
    reference_kind = classify_rpath(reference, loader_binary_path.parent)

    if reference_kind == "relative":
        return resolve_loader_relative_reference(reference, loader_binary_path)

    if reference_kind in {"runtime-absolute", "external-absolute", "system"}:
        return Path(reference).resolve(strict=False)

    raise RuntimeError(f"Unsupported LC_RPATH entry: {reference}")


def resolve_rpath_dependency(reference: str, metadata: BinaryMetadata) -> Path:
    suffix = reference.removeprefix("@rpath/")

    for rpath in metadata.rpaths:
        candidate = (resolve_rpath_entry(rpath, metadata.path) / suffix).resolve(strict=False)
        if candidate.exists():
            return candidate

    raise RuntimeError(
        f"Cannot resolve @rpath dependency for {metadata.path.as_posix()}: {reference} with rpaths {metadata.rpaths}"
    )


def make_loader_path_reference(loader_binary_path: Path, target_binary_path: Path) -> str:
    relative_path = os.path.relpath(target_binary_path, start=loader_binary_path.parent)
    relative_path_posix = Path(relative_path).as_posix()
    return f"@loader_path/{relative_path_posix}"


def build_external_destination(source_path: Path, bundled_dylib_root: Path, used_names: set[str]) -> Path:
    base_name = source_path.name
    candidate_name = base_name
    suffix = 1

    while candidate_name in used_names:
        stem = Path(base_name).stem
        extension = "".join(Path(base_name).suffixes)
        candidate_name = f"{stem}-{suffix}{extension}"
        suffix += 1

    used_names.add(candidate_name)
    return bundled_dylib_root / candidate_name


def build_relocation_plan(
    runtime_root: Path,
    root_binaries: list[Path],
    metadata_provider: Callable[[Path], BinaryMetadata],
) -> RelocationPlan:
    resolved_runtime_root = runtime_root.resolve(strict=True)
    bundled_dylib_root = resolved_runtime_root / BUNDLED_DYLIB_DIRECTORY
    destination_by_source: dict[Path, Path] = {
        binary.resolve(strict=True): binary.resolve(strict=True) for binary in root_binaries
    }
    used_bundled_names: set[str] = set()
    pending: deque[Path] = deque(sorted(destination_by_source))

    while pending:
        source_path = pending.popleft()
        metadata = metadata_provider(source_path)

        for dependency in metadata.dependencies:
            if dependency.startswith("@rpath/"):
                dependency_source = resolve_rpath_dependency(dependency, metadata).resolve(strict=True)
                if is_path_inside_root(dependency_source, resolved_runtime_root):
                    continue

                if dependency_source in destination_by_source:
                    continue

                destination_by_source[dependency_source] = build_external_destination(
                    dependency_source,
                    bundled_dylib_root,
                    used_bundled_names,
                )
                pending.append(dependency_source)
                continue

            reference_kind = classify_reference(dependency, resolved_runtime_root)
            if reference_kind != "external-absolute":
                continue

            dependency_source = Path(dependency).resolve(strict=True)
            if dependency_source in destination_by_source:
                continue

            destination_by_source[dependency_source] = build_external_destination(
                dependency_source,
                bundled_dylib_root,
                used_bundled_names,
            )
            pending.append(dependency_source)

    updates: list[BinaryUpdate] = []
    copied_binaries: list[tuple[Path, Path]] = []

    for source_path, destination_path in sorted(
        destination_by_source.items(), key=lambda item: item[1].as_posix()
    ):
        metadata = metadata_provider(source_path)
        dependency_changes: list[tuple[str, str]] = []

        for dependency in metadata.dependencies:
            if dependency.startswith("@rpath/"):
                resolved_dependency_path = resolve_rpath_dependency(dependency, metadata).resolve(strict=True)
                if is_path_inside_root(resolved_dependency_path, resolved_runtime_root):
                    target_path = resolved_dependency_path
                else:
                    target_path = destination_by_source[resolved_dependency_path]

                dependency_changes.append(
                    (dependency, make_loader_path_reference(destination_path, target_path))
                )
                continue

            reference_kind = classify_reference(dependency, resolved_runtime_root)
            if reference_kind in {"relative", "system"}:
                continue

            if reference_kind == "runtime-absolute":
                target_path = Path(dependency).resolve(strict=True)
            elif reference_kind == "external-absolute":
                target_path = destination_by_source[Path(dependency).resolve(strict=True)]
            else:
                raise RuntimeError(
                    f"Unsupported Mach-O dependency reference in {source_path}: {dependency}"
                )

            dependency_changes.append(
                (dependency, make_loader_path_reference(destination_path, target_path))
            )

        install_name = None
        if metadata.install_name is not None and (
            metadata.install_name.startswith("@rpath/")
            or classify_reference(metadata.install_name, resolved_runtime_root)
            in {"runtime-absolute", "external-absolute"}
        ):
            install_name = f"@loader_path/{destination_path.name}"

        rpaths_to_delete = tuple(
            rpath
            for rpath in metadata.rpaths
            if classify_rpath(rpath, resolved_runtime_root)
            in {"runtime-absolute", "external-absolute"}
        )

        updates.append(
            BinaryUpdate(
                source_path=source_path,
                destination_path=destination_path,
                dependency_changes=tuple(dependency_changes),
                install_name=install_name,
                rpaths_to_delete=rpaths_to_delete,
            )
        )

        if source_path != destination_path:
            copied_binaries.append((source_path, destination_path))

    return RelocationPlan(
        copied_binaries=tuple(copied_binaries),
        updates=tuple(updates),
    )


def run_command(description: str, command: list[str]) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"Failed to {description} (exit code {result.returncode}): {' '.join(command)}\n"
            f"stdout:\n{result.stdout}\n"
            f"stderr:\n{result.stderr}"
        )
    return result


def apply_relocation_plan(plan: RelocationPlan) -> None:
    for source_path, destination_path in plan.copied_binaries:
        destination_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_path, destination_path)
        print(
            f"[python-download] Copied external macOS dylib {source_path.as_posix()} -> {destination_path.as_posix()}"
        )

    for update in plan.updates:
        if update.install_name is not None:
            run_command(
                "rewrite Mach-O install name",
                [
                    "install_name_tool",
                    "-id",
                    update.install_name,
                    str(update.destination_path),
                ],
            )
            print(
                f"[python-download] Rewrote install name for {update.destination_path.as_posix()} -> {update.install_name}"
            )

        for old_reference, new_reference in update.dependency_changes:
            run_command(
                "rewrite Mach-O dependency reference",
                [
                    "install_name_tool",
                    "-change",
                    old_reference,
                    new_reference,
                    str(update.destination_path),
                ],
            )
            print(
                "[python-download] Rewrote Mach-O dependency "
                f"{old_reference} -> {new_reference} in {update.destination_path.as_posix()}"
            )

        for rpath in update.rpaths_to_delete:
            run_command(
                "delete Mach-O rpath",
                [
                    "install_name_tool",
                    "-delete_rpath",
                    rpath,
                    str(update.destination_path),
                ],
            )
            print(
                f"[python-download] Deleted Mach-O rpath {rpath} from {update.destination_path.as_posix()}"
            )


def find_non_relocatable_references(runtime_root: Path, metadata: BinaryMetadata) -> list[str]:
    violations: list[str] = []

    if metadata.install_name is not None:
        if metadata.install_name.startswith("@rpath/"):
            violations.append(
                f"{metadata.path.as_posix()}: install name still relies on @rpath ({metadata.install_name})"
            )

        install_name_kind = classify_reference(metadata.install_name, runtime_root)
        if install_name_kind not in {"relative", "system"}:
            violations.append(
                f"{metadata.path.as_posix()}: install name remains non-relocatable ({metadata.install_name})"
            )

    for dependency in metadata.dependencies:
        if dependency.startswith("@rpath/"):
            violations.append(
                f"{metadata.path.as_posix()}: dependency still relies on @rpath ({dependency})"
            )
            continue

        dependency_kind = classify_reference(dependency, runtime_root)
        if dependency_kind not in {"relative", "system"}:
            violations.append(
                f"{metadata.path.as_posix()}: dependency remains non-relocatable ({dependency})"
            )

    for rpath in metadata.rpaths:
        rpath_kind = classify_rpath(rpath, runtime_root)
        if rpath_kind not in {"relative", "system"}:
            violations.append(
                f"{metadata.path.as_posix()}: rpath remains non-relocatable ({rpath})"
            )

    return violations


def audit_runtime(runtime_root: Path) -> None:
    runtime_binaries = discover_runtime_macho_files(runtime_root)
    violations: list[str] = []

    for binary_path in runtime_binaries:
        violations.extend(find_non_relocatable_references(runtime_root, load_binary_metadata(binary_path)))

    if violations:
        formatted_violations = "\n".join(f"[python-download]   {violation}" for violation in violations)
        raise RuntimeError(
            "Refusing to continue because the macOS Python runtime still contains non-relocatable dynamic-library references.\n"
            f"{formatted_violations}"
        )

    print(
        f"[python-download] Verified {len(runtime_binaries)} macOS Mach-O file(s) for relocatable dynamic-library references."
    )


def relocate_runtime(runtime_root: Path) -> None:
    resolved_runtime_root = runtime_root.resolve(strict=True)
    root_binaries = discover_runtime_macho_files(resolved_runtime_root)
    if not root_binaries:
        raise RuntimeError(
            f"Cannot find Mach-O binaries inside the macOS runtime root: {resolved_runtime_root.as_posix()}"
        )

    print(
        f"[python-download] Inspecting {len(root_binaries)} macOS Mach-O file(s) for relocatable dependency rewriting."
    )
    plan = build_relocation_plan(resolved_runtime_root, root_binaries, load_binary_metadata)
    print(
        "[python-download] Prepared macOS runtime relocation plan: "
        f"{len(plan.copied_binaries)} external dylib copy/copies, {len(plan.updates)} Mach-O update(s)."
    )

    apply_relocation_plan(plan)
    audit_runtime(resolved_runtime_root)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Rewrite macOS CPython runtime Mach-O references so the bundled runtime stays relocatable."
    )
    parser.add_argument("--runtime-root", required=True, type=Path)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    resolved_argv = sys.argv[1:] if argv is None else argv
    args = parse_args(resolved_argv)
    relocate_runtime(args.runtime_root)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

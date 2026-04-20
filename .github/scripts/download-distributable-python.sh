#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  download-distributable-python.sh \
    --download-url <url> \
    --archive-kind <source-tar-xz|macos-pkg> \
    --install-root <directory> \
    --python-version <version> \
    --expected-arch <x64|arm64> \
    --python-version-file <path> \
    --pyproject-file <path> \
    [--python-executable-relative <path>] \
    [--python-source-label <label>]
EOF
}

require_argument() {
  local name="$1"
  local value="$2"

  if [[ -z "$value" ]]; then
    echo "Missing required argument: $name" >&2
    usage >&2
    exit 1
  fi
}

assert_official_python_download_url() {
  local url="$1"

  case "$url" in
    https://www.python.org/ftp/python/*|https://python.org/ftp/python/*)
      return 0
      ;;
    *)
      echo "Python downloads must come from the official python.org FTP release path, received: $url" >&2
      exit 1
      ;;
  esac
}

normalize_version() {
  local version="$1"
  local -a parts=()
  IFS='.' read -r -a parts <<<"$version"

  while [[ ${#parts[@]} -lt 3 ]]; do
    parts+=(0)
  done

  printf '%s.%s.%s' "${parts[0]}" "${parts[1]}" "${parts[2]}"
}

version_gte() {
  local left right
  left="$(normalize_version "$1")"
  right="$(normalize_version "$2")"

  local -a left_parts=()
  local -a right_parts=()
  IFS='.' read -r -a left_parts <<<"$left"
  IFS='.' read -r -a right_parts <<<"$right"

  for index in 0 1 2; do
    if (( 10#${left_parts[$index]} > 10#${right_parts[$index]} )); then
      return 0
    fi

    if (( 10#${left_parts[$index]} < 10#${right_parts[$index]} )); then
      return 1
    fi
  done

  return 0
}

assert_version_constraints() {
  local actual_version="$1"
  local python_version_file="$2"
  local pyproject_file="$3"

  local required_series
  required_series="$(tr -d '[:space:]' < "$python_version_file")"
  require_argument '--python-version-file' "$required_series"

  if [[ "$actual_version" != "$required_series"* ]]; then
    echo "Resolved Python version $actual_version does not match required series $required_series from $python_version_file." >&2
    exit 1
  fi

  local minimum_version
  minimum_version="$(sed -nE 's/^requires-python[[:space:]]*=[[:space:]]*">=([^\"]+)"/\1/p' "$pyproject_file" | head -n 1)"
  require_argument 'requires-python in pyproject.toml' "$minimum_version"

  if ! version_gte "$actual_version" "$minimum_version"; then
    echo "Resolved Python version $actual_version does not satisfy requires-python >=$minimum_version from $pyproject_file." >&2
    exit 1
  fi
}

resolve_version_from_output() {
  local executable_path="$1"
  local version_output
  version_output="$("$executable_path" --version 2>&1)"
  echo "${version_output#Python }"
}

normalize_architecture() {
  local raw_arch="$1"
  local normalized_arch
  normalized_arch="$(echo "$raw_arch" | tr '[:upper:]' '[:lower:]')"

  case "$normalized_arch" in
    x64|x86_64|amd64)
      echo 'x64'
      ;;
    arm64|aarch64)
      echo 'arm64'
      ;;
    *)
      echo "$normalized_arch"
      ;;
  esac
}

write_output() {
  local key="$1"
  local value="$2"

  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    printf '%s=%s\n' "$key" "$value" >> "$GITHUB_OUTPUT"
  fi
}

prepend_colon_path() {
  local new_entry="$1"
  local existing_value="$2"

  if [[ -z "$existing_value" ]]; then
    echo "$new_entry"
  else
    echo "$new_entry:$existing_value"
  fi
}

append_macos_source_dependency_flags() {
  local formula="$1"
  local dependency_prefix=''

  dependency_prefix="$(brew --prefix "$formula" 2>/dev/null || true)"
  if [[ -z "$dependency_prefix" || ! -d "$dependency_prefix" ]]; then
    echo "[python-download] Homebrew dependency $formula is not available; continuing with system defaults."
    return 0
  fi

  echo "[python-download] Using Homebrew dependency $formula from $dependency_prefix."
  CPPFLAGS="-I$dependency_prefix/include ${CPPFLAGS:-}"
  LDFLAGS="-L$dependency_prefix/lib ${LDFLAGS:-}"

  if [[ -d "$dependency_prefix/lib/pkgconfig" ]]; then
    PKG_CONFIG_PATH="$(prepend_colon_path "$dependency_prefix/lib/pkgconfig" "${PKG_CONFIG_PATH:-}")"
  fi
}

configure_macos_source_build_environment() {
  local openssl_prefix=''

  configure_args+=(--disable-framework)

  if ! command -v brew >/dev/null 2>&1; then
    echo '[python-download] Homebrew is not available; continuing macOS source build with system defaults.'
    return 0
  fi

  append_macos_source_dependency_flags 'openssl@3'
  append_macos_source_dependency_flags 'readline'
  append_macos_source_dependency_flags 'sqlite'
  append_macos_source_dependency_flags 'xz'

  openssl_prefix="$(brew --prefix openssl@3 2>/dev/null || true)"
  if [[ -n "$openssl_prefix" && -d "$openssl_prefix" ]]; then
    configure_args+=(--with-openssl="$openssl_prefix" --with-openssl-rpath=auto)
  fi

  export CPPFLAGS LDFLAGS PKG_CONFIG_PATH
}

sanitize_macos_source_build_symlinks() {
  local runtime_root="$1"
  local python_executable_path="$2"

  echo '[python-download] Inspecting macOS CPython source install symlinks before bundling.'
  "$python_executable_path" - "$runtime_root" <<'PY'
import os
import shutil
import sys
from pathlib import Path

runtime_root = Path(sys.argv[1]).resolve(strict=True)


def relative_to_runtime(path: Path) -> str:
    return path.relative_to(runtime_root).as_posix()


def is_inside_runtime(path: Path) -> bool:
    try:
        return os.path.commonpath([str(runtime_root), str(path)]) == str(runtime_root)
    except ValueError:
        return False


def collect_symlinks() -> list[Path]:
    symlinks: list[Path] = []

    for current_root, dirnames, filenames in os.walk(runtime_root, topdown=True, followlinks=False):
        current_path = Path(current_root)

        for name in list(dirnames) + list(filenames):
            candidate = current_path / name
            if candidate.is_symlink():
                symlinks.append(candidate)

    return sorted(symlinks, key=relative_to_runtime)


def fail(message: str, details: list[str]) -> None:
    print(f'[python-download] {message}', file=sys.stderr)
    for detail in details:
        print(f'[python-download]   {detail}', file=sys.stderr)
    sys.exit(1)


symlinks = collect_symlinks()
if not symlinks:
    print('[python-download] No symlinks found in the macOS Python runtime.')
    sys.exit(0)

print(f'[python-download] Found {len(symlinks)} symlink(s) in the macOS Python runtime:')
for link_path in symlinks:
    print(f'[python-download]   {relative_to_runtime(link_path)} -> {os.readlink(link_path)}')

safe_links: list[tuple[Path, str, Path]] = []
violations: list[str] = []
for link_path in symlinks:
    raw_target = os.readlink(link_path)
    configured_target = Path(raw_target)
    target_path = configured_target if configured_target.is_absolute() else link_path.parent / configured_target

    try:
        resolved_target = target_path.resolve(strict=True)
    except OSError as error:
        violations.append(f'{relative_to_runtime(link_path)} -> {raw_target} (cannot resolve target: {error})')
        continue

    if not is_inside_runtime(resolved_target):
        violations.append(
            f'{relative_to_runtime(link_path)} -> {raw_target} '
            f'(resolves outside runtime root: {resolved_target})'
        )
        continue

    if resolved_target.is_dir():
        link_parent = link_path.parent.resolve(strict=True)
        if os.path.commonpath([str(resolved_target), str(link_parent)]) == str(resolved_target):
            violations.append(
                f'{relative_to_runtime(link_path)} -> {raw_target} '
                '(directory target contains the link location; refusing to materialize a recursive copy)'
            )
            continue

    safe_links.append((link_path, raw_target, resolved_target))

if violations:
    fail(
        'Refusing to bundle macOS Python runtime because it contains non-relocatable symlinks.',
        violations,
    )

materialized: list[str] = []
for link_path, raw_target, resolved_target in safe_links:
    display_path = relative_to_runtime(link_path)
    link_path.unlink()

    if resolved_target.is_dir():
        shutil.copytree(resolved_target, link_path, symlinks=False)
    elif resolved_target.is_file():
        shutil.copy2(resolved_target, link_path)
    else:
        violations.append(
            f'{display_path} -> {raw_target} '
            f'(resolved target is neither a regular file nor a directory: {resolved_target})'
        )
        continue

    materialized.append(f'{display_path} -> {raw_target}')

if violations:
    fail('Failed to materialize one or more macOS Python runtime symlinks.', violations)

remaining_symlinks = collect_symlinks()
if remaining_symlinks:
    fail(
        'macOS Python runtime still contains symlinks after materialization.',
        [f'{relative_to_runtime(path)} -> {os.readlink(path)}' for path in remaining_symlinks],
    )

print(f'[python-download] Materialized {len(materialized)} macOS Python runtime symlink(s) as regular files/directories:')
for entry in materialized:
    print(f'[python-download]   {entry}')
PY
}

resolve_macos_framework_source() {
  local expanded_pkg_root="$1"
  local python_major_minor="$2"
  local framework_source=''
  local payload_version_bin=''
  local framework_package_info=''

  framework_source="$(find "$expanded_pkg_root" -type d -path '*/Library/Frameworks/Python.framework' -print -quit)"
  if [[ -n "$framework_source" && -d "$framework_source" ]]; then
    echo "$framework_source"
    return 0
  fi

  payload_version_bin="$(find "$expanded_pkg_root" -type d -path "*/Payload/Versions/$python_major_minor/bin" -print -quit)"
  if [[ -n "$payload_version_bin" && -d "$payload_version_bin" ]]; then
    framework_source="$(dirname "$(dirname "$(dirname "$payload_version_bin")")")"
    if [[ -d "$framework_source" ]]; then
      echo "$framework_source"
      return 0
    fi
  fi

  framework_package_info="$(find "$expanded_pkg_root" -type f -name 'PackageInfo' -exec grep -l '/Library/Frameworks/Python.framework' {} + 2>/dev/null | head -n 1 || true)"
  if [[ -n "$framework_package_info" ]]; then
    framework_source="$(dirname "$framework_package_info")/Payload"
    if [[ -d "$framework_source" ]]; then
      echo "$framework_source"
      return 0
    fi
  fi

  return 1
}

download_url=''
archive_kind=''
install_root=''
python_version=''
expected_arch=''
python_version_file=''
pyproject_file=''
python_executable_relative=''
python_source_label=''

while [[ $# -gt 0 ]]; do
  case "$1" in
    --download-url)
      download_url="$2"
      shift 2
      ;;
    --archive-kind)
      archive_kind="$2"
      shift 2
      ;;
    --install-root)
      install_root="$2"
      shift 2
      ;;
    --python-version)
      python_version="$2"
      shift 2
      ;;
    --expected-arch)
      expected_arch="$2"
      shift 2
      ;;
    --python-version-file)
      python_version_file="$2"
      shift 2
      ;;
    --pyproject-file)
      pyproject_file="$2"
      shift 2
      ;;
    --python-executable-relative)
      python_executable_relative="$2"
      shift 2
      ;;
    --python-source-label)
      python_source_label="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

require_argument '--download-url' "$download_url"
require_argument '--archive-kind' "$archive_kind"
require_argument '--install-root' "$install_root"
require_argument '--python-version' "$python_version"
require_argument '--expected-arch' "$expected_arch"
require_argument '--python-version-file' "$python_version_file"
require_argument '--pyproject-file' "$pyproject_file"
assert_official_python_download_url "$download_url"
expected_arch="$(normalize_architecture "$expected_arch")"

archive_name="$(basename "$download_url")"
work_root="$install_root/work"
runtime_root="$install_root/python-runtime"
archive_path="$work_root/$archive_name"

rm -rf "$install_root"
mkdir -p "$work_root" "$runtime_root"

if [[ -z "$python_source_label" ]]; then
  python_source_label="python.org/$archive_name"
fi

echo "[python-download] Downloading official Python archive: $download_url"
curl --fail --location --retry 5 --retry-delay 2 --output "$archive_path" "$download_url"

declare python_executable_path=''
declare actual_python_version=''
cleanup_mount=''

cleanup() {
  if [[ -n "$cleanup_mount" ]] && mount | grep -q "on $cleanup_mount "; then
    hdiutil detach "$cleanup_mount" -quiet || true
  fi
}
trap cleanup EXIT

case "$archive_kind" in
  source-tar-xz)
    echo "[python-download] Extracting Python source archive."
    tar -xJf "$archive_path" -C "$work_root"

    source_root="$work_root/Python-$python_version"
    if [[ ! -d "$source_root" ]]; then
      echo "Expected extracted source directory at $source_root." >&2
      exit 1
    fi

    build_jobs="$(getconf _NPROCESSORS_ONLN 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)"
    configure_args=(--prefix="$runtime_root")

    if [[ "$OSTYPE" == darwin* ]]; then
      echo '[python-download] Configuring macOS CPython source build for regular prefix layout.'
      configure_macos_source_build_environment
    fi

    echo "[python-download] Building CPython from official source tarball."
    pushd "$source_root" > /dev/null
    ./configure "${configure_args[@]}"
    make -j"$build_jobs"
    make install
    popd > /dev/null

    if [[ -z "$python_executable_relative" ]]; then
      python_executable_relative='bin/python3'
    fi

    python_executable_path="$runtime_root/$python_executable_relative"
    if [[ ! -f "$python_executable_path" ]]; then
      echo "Cannot find Python executable at $python_executable_path." >&2
      exit 1
    fi

    if [[ "$OSTYPE" == darwin* ]]; then
      sanitize_macos_source_build_symlinks "$runtime_root" "$python_executable_path"
    fi
    ;;
  macos-pkg)
    if [[ "$OSTYPE" != darwin* ]]; then
      echo 'macos-pkg extraction is only supported on macOS runners.' >&2
      exit 1
    fi

    python_major_minor="${python_version%.*}"
    expanded_pkg_root="$work_root/pkg-expanded"

    echo "[python-download] Extracting official macOS Python pkg payload."
    pkgutil --expand-full "$archive_path" "$expanded_pkg_root"

    echo "[python-download] Expanded macOS pkg root: $expanded_pkg_root"
    framework_source="$(resolve_macos_framework_source "$expanded_pkg_root" "$python_major_minor" || true)"

    if [[ -z "$framework_source" || ! -d "$framework_source" ]]; then
      echo '[python-download] Expanded macOS pkg contents (depth <= 3):' >&2
      find "$expanded_pkg_root" -mindepth 1 -maxdepth 3 -print | sort | head -n 200 >&2 || true
      echo "Cannot find Python.framework inside expanded macOS pkg at $expanded_pkg_root." >&2
      exit 1
    fi

    if [[ "$framework_source" == */Payload ]]; then
      echo "[python-download] Using macOS framework component payload: $framework_source"
    else
      echo "[python-download] Using macOS framework directory: $framework_source"
    fi

    /usr/bin/ditto "$framework_source" "$runtime_root/Python.framework"

    if [[ -z "$python_executable_relative" ]]; then
      python_executable_relative="Python.framework/Versions/$python_major_minor/bin/python3"
    fi
    ;;
  *)
    echo "Unsupported archive kind: $archive_kind" >&2
    exit 1
    ;;
esac

python_executable_path="$runtime_root/$python_executable_relative"
if [[ ! -f "$python_executable_path" ]]; then
  echo "Cannot find Python executable at $python_executable_path." >&2
  exit 1
fi

actual_python_version="$(resolve_version_from_output "$python_executable_path")"
actual_arch="$("$python_executable_path" -c 'import platform; print(platform.machine())')"
actual_arch="$(normalize_architecture "$actual_arch")"
assert_version_constraints "$actual_python_version" "$python_version_file" "$pyproject_file"

if [[ "$actual_arch" != "$expected_arch" ]]; then
  echo "Resolved Python architecture $actual_arch does not match expected architecture $expected_arch." >&2
  exit 1
fi

echo "[python-download] Python directory: $runtime_root"
echo "[python-download] Python executable relative path: $python_executable_relative"
echo "[python-download] Python version: $actual_python_version"
echo "[python-download] Python architecture: $actual_arch"
echo "[python-download] Python source label: $python_source_label"

write_output 'python_dir' "$runtime_root"
write_output 'python_executable_relative' "$python_executable_relative"
write_output 'python_version' "$actual_python_version"
write_output 'python_arch' "$actual_arch"
write_output 'python_source_label' "$python_source_label"

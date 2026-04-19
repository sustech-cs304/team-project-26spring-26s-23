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

    echo "[python-download] Building CPython from official source tarball."
    pushd "$source_root" > /dev/null
    ./configure --prefix="$runtime_root"
    make -j"$build_jobs"
    make install
    popd > /dev/null

    if [[ -z "$python_executable_relative" ]]; then
      python_executable_relative='bin/python3'
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

    framework_source="$(find "$expanded_pkg_root" -type d -path '*/Library/Frameworks/Python.framework' -print -quit)"
    if [[ -z "$framework_source" ]]; then
      framework_source="$(find "$expanded_pkg_root" -type d -name 'Python.framework' -print -quit)"
    fi

    if [[ -z "$framework_source" || ! -d "$framework_source" ]]; then
      echo "Cannot find Python.framework inside expanded pkg payload at $expanded_pkg_root." >&2
      exit 1
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

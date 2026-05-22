#!/usr/bin/env python3
"""
Project Metrics Reporter
统计 frontend-copilot 和 backend 的：
  - Lines of Code (代码行数)
  - Number of source files (源文件数量)
  - Cyclomatic complexity (圈复杂度)
  - Number of dependencies (依赖数量)
"""

import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = ROOT / "backend"
FRONTEND_DIR = ROOT / "frontend-copilot"

# ── helpers ──────────────────────────────────────────────────────────


def run(
    cmd: list[str],
    cwd: str | Path | None = None,
    timeout: int = 120,
    encoding: str = "utf-8",
) -> subprocess.CompletedProcess:
    """Run a command and return the CompletedProcess with UTF-8 encoding."""
    return subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        capture_output=True,
        timeout=timeout,
        encoding=encoding,
        errors="replace",
    )


def count_lines_and_files(
    root: Path,
    patterns: list[str],
    exclude_patterns: list[str] | None = None,
) -> tuple[int, int]:
    """Count total lines (non-blank) and number of source files."""
    if exclude_patterns is None:
        exclude_patterns = []

    files: list[Path] = []
    for pat in patterns:
        files.extend(root.rglob(pat))

    filtered: list[Path] = []
    for f in files:
        rel = str(f.relative_to(root))
        if any(ex in rel for ex in exclude_patterns):
            continue
        filtered.append(f)

    total = 0
    for f in filtered:
        try:
            text = f.read_text(encoding="utf-8", errors="ignore")
            total += sum(1 for line in text.splitlines() if line.strip())
        except Exception:
            pass

    return total, len(filtered)


# ── Python / Backend ─────────────────────────────────────────────────


def backend_dependency_count() -> int:
    """Count production dependencies from pyproject.toml."""
    toml_path = BACKEND_DIR / "pyproject.toml"
    if not toml_path.exists():
        return 0

    text = toml_path.read_text(encoding="utf-8")
    in_deps = False
    count = 0
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("[project.optional-dependencies]"):
            break
        if stripped == "dependencies = [":
            in_deps = True
            continue
        if in_deps:
            if stripped == "]":
                break
            if stripped.startswith('"') or stripped.startswith("'"):
                count += 1
    return count


def backend_cyclomatic_complexity() -> dict[str, Any]:
    """Compute cyclomatic complexity for Python source files using radon."""
    app_dir = BACKEND_DIR / "app"
    if not app_dir.exists():
        return {"average": 0, "max": 0, "function_count": 0, "per_file": {}}

    try:
        result = run(
            ["uv", "run", "radon", "cc", "--json", "-s", str(app_dir)],
            cwd=BACKEND_DIR,
            timeout=60,
        )
    except FileNotFoundError:
        return {
            "average": 0,
            "max": 0,
            "function_count": 0,
            "error": "radon not available -- run: uv add --dev radon",
            "per_file": {},
        }

    if result.returncode != 0:
        return {
            "average": 0,
            "max": 0,
            "function_count": 0,
            "error": f"radon failed:\n{result.stderr[:500]}",
            "per_file": {},
        }

    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        return {
            "average": 0,
            "max": 0,
            "function_count": 0,
            "error": "radon output was not valid JSON",
            "per_file": {},
        }

    all_complexities: list[int] = []
    per_file: dict[str, dict] = {}

    for fpath, funcs in data.items():
        rel = str(Path(fpath).relative_to(app_dir))
        vals = [f["complexity"] for f in funcs]
        all_complexities.extend(vals)
        per_file[rel] = {
            "functions": len(funcs),
            "average": round(sum(vals) / len(vals), 2) if vals else 0,
            "max": max(vals) if vals else 0,
        }

    return {
        "average": round(sum(all_complexities) / len(all_complexities), 2) if all_complexities else 0,
        "max": max(all_complexities) if all_complexities else 0,
        "function_count": len(all_complexities),
        "per_file": per_file,
    }


# ── TypeScript / Frontend ────────────────────────────────────────────


def frontend_dependency_count() -> int:
    """Count runtime dependencies from package.json."""
    pkg_path = FRONTEND_DIR / "package.json"
    if not pkg_path.exists():
        return 0

    try:
        data = json.loads(pkg_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return 0

    return len(data.get("dependencies", {}))


def frontend_cyclomatic_complexity() -> dict[str, Any]:
    """Compute cyclomatic complexity for TypeScript files using ESLint."""
    src_dir = FRONTEND_DIR / "src"
    electron_dir = FRONTEND_DIR / "electron"

    targets = []
    if src_dir.exists():
        targets.append("src")
    if electron_dir.exists():
        targets.append("electron")

    if not targets:
        return {"average": 0, "max": 0, "function_count": 0, "per_file": {}}

    # Use npx.cmd on Windows
    npx_cmd = "npx.cmd" if sys.platform == "win32" else "npx"
    cmd = [
        npx_cmd,
        "eslint",
        "--rule",
        'complexity: ["warn", 0]',
        "--format",
        "json",
        "--no-error-on-unmatched-pattern",
        *targets,
    ]

    try:
        result = run(cmd, cwd=FRONTEND_DIR, timeout=120)
    except FileNotFoundError:
        return {
            "average": 0,
            "max": 0,
            "function_count": 0,
            "error": "eslint/npx not available -- ensure Node.js is installed",
            "per_file": {},
        }

    if result.returncode not in (0, 1):
        return {
            "average": 0,
            "max": 0,
            "function_count": 0,
            "error": f"eslint failed:\n{result.stderr[:500]}",
            "per_file": {},
        }

    if not result.stdout:
        return {
            "average": 0,
            "max": 0,
            "function_count": 0,
            "error": "eslint produced no output",
            "per_file": {},
        }

    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        return {
            "average": 0,
            "max": 0,
            "function_count": 0,
            "error": "eslint output was not valid JSON",
            "per_file": {},
        }

    all_complexities: list[int] = []
    per_file: dict[str, dict] = {}

    complexity_re = re.compile(r"complexity of (\d+)")

    for file_info in data:
        fpath = file_info.get("filePath", "")
        try:
            rel = str(Path(fpath).relative_to(FRONTEND_DIR))
        except ValueError:
            rel = fpath

        vals: list[int] = []
        for msg in file_info.get("messages", []):
            if msg.get("ruleId") == "complexity":
                m = complexity_re.search(msg.get("message", ""))
                if m:
                    vals.append(int(m.group(1)))

        if vals:
            all_complexities.extend(vals)
            per_file[rel] = {
                "functions": len(vals),
                "average": round(sum(vals) / len(vals), 2),
                "max": max(vals),
            }

    return {
        "average": round(sum(all_complexities) / len(all_complexities), 2) if all_complexities else 0,
        "max": max(all_complexities) if all_complexities else 0,
        "function_count": len(all_complexities),
        "per_file": per_file,
    }


# ── report helpers ───────────────────────────────────────────────────


def fmt_num(n: int) -> str:
    return f"{n:,}"


def print_metrics(
    label: str,
    lines: int,
    files: int,
    deps: int,
    cc: dict[str, Any],
) -> None:
    """Pretty-print a metrics block for one component."""
    w = 52
    print("=" * w)
    print(f"  {label}")
    print("=" * w)
    print(f"  {'Source files':<36s} {fmt_num(files):>10s}")
    print(f"  {'Lines of Code':<36s} {fmt_num(lines):>10s}")
    print(f"  {'Dependencies':<36s} {fmt_num(deps):>10s}")
    print(f"  {'CC - Function count':<36s} {fmt_num(cc.get('function_count', 0)):>10s}")
    print(f"  {'CC - Average':<36s} {cc.get('average', 0):>10}")
    print(f"  {'CC - Maximum':<36s} {cc.get('max', 0):>10}")

    if cc.get("error"):
        print(f"\n  WARNING: {cc['error']}")

    print()


def print_top_complex_files(cc: dict[str, Any], label: str, top_n: int = 5) -> None:
    """Print files with highest max cyclomatic complexity."""
    per_file = cc.get("per_file", {})
    if not per_file:
        return

    sorted_files = sorted(per_file.items(), key=lambda x: x[1]["max"], reverse=True)
    print(f"  {label} - Top {top_n} highest CC files:")
    for fpath, info in sorted_files[:top_n]:
        print(
            f"    {fpath:<50s} max={info['max']:>3}, "
            f"avg={info['average']:>5}, funcs={info['functions']}"
        )
    print()


# ── main ─────────────────────────────────────────────────────────────


def main() -> None:
    print()
    print("+================================================+")
    print("|      [Metrics] CanDue Project Code Metrics     |")
    print("+================================================+")
    print()

    # ── Backend ────────────────────────────────────────────────────
    py_lines, py_files = count_lines_and_files(
        BACKEND_DIR / "app",
        ["*.py"],
        exclude_patterns=["__pycache__", ".pyc"],
    )
    py_deps = backend_dependency_count()
    py_cc = backend_cyclomatic_complexity()
    print_metrics("[Python] Backend", py_lines, py_files, py_deps, py_cc)
    print_top_complex_files(py_cc, "backend")

    # ── Frontend ───────────────────────────────────────────────────
    ts_lines_src, ts_files_src = count_lines_and_files(
        FRONTEND_DIR / "src",
        ["*.ts", "*.tsx"],
        exclude_patterns=[".test.ts", ".test.tsx", "__snapshots__"],
    )
    ts_lines_electron, ts_files_electron = count_lines_and_files(
        FRONTEND_DIR / "electron",
        ["*.ts", "*.tsx"],
        exclude_patterns=[".test.ts", ".test.tsx", "__snapshots__"],
    )
    ts_lines = ts_lines_src + ts_lines_electron
    ts_files = ts_files_src + ts_files_electron
    ts_deps = frontend_dependency_count()
    ts_cc = frontend_cyclomatic_complexity()
    print_metrics("[TypeScript] Frontend", ts_lines, ts_files, ts_deps, ts_cc)
    print_top_complex_files(ts_cc, "frontend")

    # ── Summary ────────────────────────────────────────────────────
    print("=" * 52)
    print("  [Summary] Total")
    print("=" * 52)
    total_lines = py_lines + ts_lines
    total_files = py_files + ts_files
    total_deps = py_deps + ts_deps
    total_functions = py_cc.get("function_count", 0) + ts_cc.get("function_count", 0)

    if total_functions > 0:
        combined_cc_avg = round(
            (py_cc.get("average", 0) * py_cc.get("function_count", 0)
             + ts_cc.get("average", 0) * ts_cc.get("function_count", 0))
            / total_functions,
            2,
        )
    else:
        combined_cc_avg = 0

    combined_cc_max = max(py_cc.get("max", 0), ts_cc.get("max", 0))

    print(f"  {'Source files':<36s} {fmt_num(total_files):>10s}")
    print(f"  {'Lines of Code':<36s} {fmt_num(total_lines):>10s}")
    print(f"  {'Dependencies':<36s} {fmt_num(total_deps):>10s}")
    print(f"  {'CC - Function count':<36s} {fmt_num(total_functions):>10s}")
    print(f"  {'CC - Weighted Average':<36s} {combined_cc_avg:>10}")
    print(f"  {'CC - Maximum':<36s} {combined_cc_max:>10}")
    print()


if __name__ == "__main__":
    main()

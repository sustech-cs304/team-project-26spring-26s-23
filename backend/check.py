"""
Use this script to check code quality. It includes:
- Ruff for formatting and linting
- Pyright for type checking
- Xenon for complexity analysis
"""

import subprocess
from pathlib import Path

CWD = Path(__file__).parent.resolve()

def run_command(command: list[str], step_name: str):
    print(f"\n👉 {step_name}...")
    result = subprocess.run(command, cwd=CWD)
    if result.returncode != 0:
        print(f"❌ {step_name} 报告了上述问题")
        return False
    return True

def main():
    print("🚀 代码质量查验...\n")
    success = True
    pre = ["uv", "run", "--extra", "dev"]
    success &= run_command(
        command=pre + ["ruff", "format", "--check", "app"],
        step_name="Ruff 格式检查"
    )
    success &= run_command(
        command=pre + ["ruff", "check", "app"],
        step_name="Ruff 规范检查"
    )
    success &= run_command(
        command=pre + ["pyright", "."],
        step_name="Pyright 类型检查"
    )
    success &= run_command(
        command=pre + ["bandit", "-r", "-l", "app"],
        step_name="Bandit 安全检查"
    )
    success &= run_command(
        command=pre + ["xenon", "--max-absolute", "C", "--max-modules", "B", "--max-average", "A", "app"],
        step_name="Xenon 复杂度检查"
    )
    if not success:
        raise SystemExit(1)

if __name__ == "__main__":
    main()
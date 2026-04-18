"""
Use this script to check code quality. It includes:
- Ruff for formatting and linting
- Pyright for type checking
- Xenon for complexity analysis
"""

import subprocess

def run_command(command: list[str], step_name: str):
    print(f"\n👉 {step_name}...")
    result = subprocess.run(command)
    if result.returncode != 0:
        print(f"❌ {step_name} 报告了上述问题")
        return False
    return True

def main():
    print("🚀 代码质量查验...\n")
    success = True
    success &= run_command(
        command=["ruff", "format", "--check", "app"],
        step_name="Ruff 格式检查"
    )
    success &= run_command(
        command=["ruff", "check", "app"],
        step_name="Ruff 规范检查"
    )
    success &= run_command(
        command=["pyright", "."],
        step_name="Pyright 类型检查"
    )
    success &= run_command(
        command=["xenon", "--max-absolute", "C", "--max-modules", "B", "--max-average", "A", "app"],
        step_name="Xenon 复杂度检查"
    )
    if not success:
        raise SystemExit(1)

if __name__ == "__main__":
    main()
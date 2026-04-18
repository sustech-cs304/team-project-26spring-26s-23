"""
Use this script to check code quality. It includes:
- Ruff for formatting and linting
- Pyright for type checking
- Xenon for complexity analysis
"""

import subprocess

def run_command(command, step_name):
    print(f"\n👉 {step_name}...")
    result = subprocess.run(command, shell=True)
    if result.returncode != 0:
        print(f"❌ {step_name} 报告了上述问题")
        return False
    return True

def main():
    print("🚀 代码质量查验...\n")
    success = True
    success &= run_command("ruff format --check app", "Ruff 格式检查")
    success &= run_command("ruff check app", "Ruff 规范检查")
    success &= run_command("pyright .", "Pyright 类型检查")
    success &= run_command("xenon --max-absolute C --max-modules B --max-average A app", "Xenon 复杂度检查")
    if not success:
        raise SystemExit(1)

if __name__ == "__main__":
    main()
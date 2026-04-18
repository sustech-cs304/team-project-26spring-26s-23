from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[4]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.integrations.sustech.blackboard.api.dto import CourseCatalogResultDTO
from app.integrations.sustech.blackboard.provider.use_cases.course_catalog import (
    search_course_catalog_with_credentials,
)
from app.integrations.sustech.blackboard.shared import BlackboardLogger, create_log_session


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="搜索 Blackboard 课程目录")
    parser.add_argument("--keyword", required=True, help="搜索关键词，例如：计算机")
    parser.add_argument("--field", default="CourseName", help="搜索字段，默认 CourseName")
    parser.add_argument("--operator", default="Contains", help="搜索操作符，默认 Contains")
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="限制返回条数，<=0 表示不限制",
    )
    parser.add_argument(
        "--save-json",
        action="store_true",
        help="将搜索结果保存为 JSON 到 backend/data/reports/",
    )
    parser.add_argument(
        "--preview",
        type=int,
        default=10,
        help="终端预览条数，默认 10",
    )
    return parser


def _strip_value_label(text: str) -> str:
    value = str(text or "").strip()
    if not value:
        return ""

    prefixes = (
        "课程名称",
        "课程ID",
        "Course ID",
        "Course Name",
        "教师",
        "Instructor",
        "描述",
        "Description",
    )
    for prefix in prefixes:
        if value.lower().startswith(prefix.lower()):
            stripped = value[len(prefix) :].lstrip(" :：")
            if stripped:
                return stripped
    return value


def _log_preview(logger: BlackboardLogger, results: list[CourseCatalogResultDTO], preview: int) -> None:
    logger.info("▶ 课程目录搜索结果预览开始", payload={"preview": max(preview, 0), "total": len(results)})
    if not results:
        logger.info("🏳 未查询到课程目录结果")
        return

    for idx, item in enumerate(results[: max(preview, 0)], 1):
        course_identifier = _strip_value_label(str(item.course_identifier or ""))
        course_name = _strip_value_label(str(item.course_name or ""))
        instructor = _strip_value_label(str(item.instructor or "")) or "(未知)"
        description = _strip_value_label(str(item.description or ""))
        course_id = _strip_value_label(str(item.course_id or "")) or "(无)"

        if len(description) > 120:
            description = f"{description[:117]}..."

        logger.info(
            f"预览结果 #{idx}: [{course_identifier}] {course_name}",
            payload={
                "instructor": instructor,
                "course_id": course_id,
                "description": description,
            },
        )


def _save_json_report(
    backend_dir: Path,
    *,
    keyword: str,
    field: str,
    operator: str,
    limit: int | None,
    results: list[CourseCatalogResultDTO],
) -> Path:
    report_dir = backend_dir / "data" / "reports"
    report_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_path = report_dir / f"course_catalog_search_{timestamp}.json"

    payload = {
        "run_at": datetime.now().isoformat(timespec="seconds"),
        "keyword": keyword,
        "field": field,
        "operator": operator,
        "limit": limit,
        "total": len(results),
        "results": [item.to_dict() for item in results],
    }

    with out_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    return out_path


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()

    load_dotenv(BACKEND_DIR / ".env")
    log_session = create_log_session(console=True)
    logger = log_session.make_logger(
        layer="cli",
        source="search_course_catalog",
        context={
            "keyword": args.keyword,
            "field": args.field,
            "operator": args.operator,
        },
    )

    username = os.getenv("SUSTECH_USERNAME")
    password = os.getenv("SUSTECH_PASSWORD")

    if not username or not password:
        logger.error("⚠ 缺少环境变量 SUSTECH_USERNAME / SUSTECH_PASSWORD")
        logger.info("⚠ 请在 backend/.env 中配置凭据后重试")
        return 1

    limit = args.limit if args.limit and args.limit > 0 else None

    try:
        logger.info("▶ 开始执行课程目录搜索 CLI", payload={"limit": limit, "preview": args.preview})
        result = search_course_catalog_with_credentials(
            username,
            password,
            keyword=args.keyword,
            field=args.field,
            operator=args.operator,
            limit=limit,
            enable_console_logging=True,
        )
        logger.info(
            "✅ 课程目录搜索完成",
            payload={
                "keyword": result.keyword,
                "field": result.field,
                "operator": result.operator,
                "total": result.total,
                "provider_log_summary": result.log_summary,
            },
        )
        _log_preview(logger, result.results, args.preview)

        if args.save_json:
            out_path = _save_json_report(
                BACKEND_DIR,
                keyword=result.keyword,
                field=result.field,
                operator=result.operator,
                limit=result.limit,
                results=result.results,
            )
            logger.info(
                "✅ 已保存课程目录 JSON 报告",
                payload={
                    "path": out_path.as_posix(),
                    "provider_logs": [event.to_dict() for event in result.logs],
                    "provider_log_summary": result.log_summary,
                },
            )

        return 0
    except Exception as ex:
        logger.error("❌ 课程目录搜索失败", payload={"error": str(ex)})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())


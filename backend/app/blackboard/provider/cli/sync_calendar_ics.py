from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[4]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.blackboard.api.dto import CalendarEventDTO
from app.blackboard.provider.use_cases.calendar_ics import (
    refresh_calendar_ics_subscription,
)
from app.blackboard.shared import create_log_session

ENV_FEED_KEYS = ("BLACKBOARD_CALENDAR_FEED_URL", "CALENDAR_FEED_URL")
ENV_DB_PATH_KEY = "SUSTECH_DB_PATH"
DEFAULT_DB_PATH = BACKEND_DIR / "data" / "sustech.db"


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="刷新 ICS 日历订阅并同步到本地数据库")
    parser.add_argument(
        "--feed-url",
        required=False,
        help=(
            "ICS 订阅地址（可选）。"
            "未提供时按优先级读取环境变量："
            "BLACKBOARD_CALENDAR_FEED_URL > CALENDAR_FEED_URL"
        ),
    )
    parser.add_argument(
        "--db-path",
        required=False,
        help=(
            "SQLite 数据库路径（可选）。"
            f"未提供时读取 {ENV_DB_PATH_KEY}，"
            f"仍未提供则默认使用 {DEFAULT_DB_PATH.as_posix()}"
        ),
    )
    parser.add_argument(
        "--save-json",
        action="store_true",
        help="将刷新结果与事件快照保存为 JSON 到 backend/data/reports/",
    )
    return parser


def _to_json_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat(timespec="seconds")
    return value


def _save_json_report(*, feed_url: str, stats: dict[str, Any], events: list[CalendarEventDTO]) -> Path:
    report_dir = BACKEND_DIR / "data" / "reports"
    report_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_path = report_dir / f"calendar_ics_sync_{timestamp}.json"

    payload = {
        "run_at": datetime.now().isoformat(timespec="seconds"),
        "feed_url": feed_url,
        "stats": {k: _to_json_value(v) for k, v in stats.items()},
        "events": [{k: _to_json_value(v) for k, v in row.to_dict().items()} for row in events],
    }

    with out_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    return out_path


def _load_env() -> None:
    load_dotenv(BACKEND_DIR / ".env")


def _resolve_feed_url(cli_feed_url: str | None) -> tuple[str, str]:
    normalized_cli = str(cli_feed_url or "").strip()
    if normalized_cli:
        return normalized_cli, "--feed-url"

    for env_key in ENV_FEED_KEYS:
        env_value = str(os.getenv(env_key) or "").strip()
        if env_value:
            return env_value, env_key

    env_tips = "\n".join(
        [
            "请在 backend/.env 中至少配置一项：",
            "  BLACKBOARD_CALENDAR_FEED_URL=https://...",
            "  CALENDAR_FEED_URL=https://...",
        ]
    )
    raise ValueError(
        "未提供 ICS 订阅地址：请通过 --feed-url 传入，"
        "或在环境变量中配置 BLACKBOARD_CALENDAR_FEED_URL / CALENDAR_FEED_URL。\n"
        + env_tips
    )


def _resolve_db_path(cli_db_path: str | None) -> tuple[Path, str]:
    normalized_cli = str(cli_db_path or "").strip()
    if normalized_cli:
        db_path = Path(normalized_cli)
        if not db_path.is_absolute():
            db_path = BACKEND_DIR / db_path
        return db_path.resolve(), "--db-path"

    env_db_path = str(os.getenv(ENV_DB_PATH_KEY) or "").strip()
    if env_db_path:
        db_path = Path(env_db_path)
        if not db_path.is_absolute():
            db_path = BACKEND_DIR / db_path
        return db_path.resolve(), ENV_DB_PATH_KEY

    return DEFAULT_DB_PATH.resolve(), "default"


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()

    _load_env()
    log_session = create_log_session(console=True)
    logger = log_session.make_logger(layer="cli", source="sync_calendar_ics")

    try:
        feed_url, feed_source = _resolve_feed_url(args.feed_url)
        db_path, db_source = _resolve_db_path(args.db_path)

        logger.info(
            "开始刷新 ICS 订阅 CLI",
            payload={
                "feed_url": feed_url,
                "feed_source": feed_source,
                "db_path": db_path.as_posix(),
                "db_source": db_source,
            },
        )

        result = refresh_calendar_ics_subscription(
            feed_url,
            db_path=db_path,
            enable_console_logging=True,
        )
        parsed_count = int(result.stats.get("parsed", 0))

        logger.info(
            "ICS 刷新完成",
            payload={
                "parsed": parsed_count,
                "inserted": int(result.stats.get("inserted", 0)),
                "updated": int(result.stats.get("updated", 0)),
                "deleted": int(result.stats.get("deleted", 0)),
                "active_event_count": result.active_event_count,
                "all_event_count": result.all_event_count,
                "provider_log_summary": result.log_summary,
            },
        )

        if args.save_json:
            out_path = _save_json_report(
                feed_url=result.feed_url,
                stats=result.stats,
                events=result.active_events,
            )
            logger.info(
                "已保存 ICS JSON 报告",
                payload={
                    "path": out_path.as_posix(),
                    "provider_logs": [event.to_dict() for event in result.logs],
                    "provider_log_summary": result.log_summary,
                },
            )

        return 0
    except Exception as ex:
        logger.error("ICS 同步失败", payload={"error": str(ex)})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

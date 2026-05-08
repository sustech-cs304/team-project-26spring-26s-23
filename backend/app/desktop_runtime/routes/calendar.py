from datetime import datetime, timedelta, UTC
from fastapi import APIRouter
from pydantic import BaseModel

class UnifiedCalendarEvent(BaseModel):
    id: str | int
    source: str
    source_id: str | None
    title: str
    description: str | None
    start_time: str
    end_time: str
    is_all_day: bool
    location: str | None
    status: str

def build_calendar_router() -> APIRouter:
    router = APIRouter(prefix="/calendar", tags=["calendar"])

    @router.get("/events", response_model=list[UnifiedCalendarEvent])
    async def get_events():
        # Mock data representing Phase 2
        now = datetime.now(UTC)
        return [
            UnifiedCalendarEvent(
                id=1,
                source="bb",
                source_id="mock_bb_1",
                title="软件工程 期中考试",
                description="期中考试，闭卷",
                start_time=(now + timedelta(days=1)).isoformat() + "Z",
                end_time=(now + timedelta(days=1, hours=2)).isoformat() + "Z",
                is_all_day=False,
                location="一教 101",
                status="upcoming",
            ),
            UnifiedCalendarEvent(
                id=2,
                source="course",
                source_id="mock_course_1",
                title="数据库原理 课程",
                description="理论课",
                start_time=(now + timedelta(days=2)).isoformat() + "Z",
                end_time=(now + timedelta(days=2, hours=1.5)).isoformat() + "Z",
                is_all_day=False,
                location="二教 202",
                status="upcoming",
            ),
            UnifiedCalendarEvent(
                id=3,
                source="custom",
                source_id=None,
                title="项目周会",
                description="组内同步进度",
                start_time=(now + timedelta(days=3)).isoformat() + "Z",
                end_time=(now + timedelta(days=3, hours=1)).isoformat() + "Z",
                is_all_day=False,
                location="工学院 100",
                status="upcoming",
            ),
        ]

    return router

from __future__ import annotations
from dataclasses import asdict, dataclass, field, fields
from datetime import UTC, datetime
from typing import Any

def _jsonable(value: Any) -> Any:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.isoformat(timespec="seconds")
        return value.astimezone(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_jsonable(item) for item in value]
    return value


@dataclass(slots=True)
class EventDTO:
    """DTO 基类，提供轻量序列化能力。"""

    def to_dict(self) -> dict[str, Any]:
        return _jsonable(asdict(self))
    
    @classmethod
    def from_obj(cls, obj: Any):
        class_fields = fields(cls)
        obj_dict = {}
        for field in class_fields:
            name = field.name
            if hasattr(obj, name):
                obj_dict[name] = getattr(obj, name)
        return cls(**obj_dict)
    

@dataclass(slots=True)
class CourseEvent(EventDTO):
    course_name: str
    semester_id: str
    class_start: int
    class_end: int
    week_day: int
    week_start: int
    week_end: int
    week_type: int = 2  # 0:even 1:odd 2:all

    week_canceled: list[int] = field(default_factory=list)
    course_group_id: int | None = None

    id: int | None = None
    place: str | None = None
    teacher: str | None = None

    def week_valid(self, week: int) -> bool:
        if week < self.week_start or week > self.week_end:
            return False
        if self.week_type != 2 and week % 2 != self.week_type:
            return False
        return week not in self.week_canceled

    def get_all_weeks(self):
        all_weeks = list(range(self.week_start, self.week_start+1))
        if self.week_type != 2:
            all_weeks = list(filter(lambda week: week % 2 == self.week_type, all_weeks))
        if len(self.week_canceled) != 0:
            all_weeks = list(filter(lambda week: week not in self.week_canceled, all_weeks))
        return all_weeks
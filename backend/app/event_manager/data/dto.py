from __future__ import annotations
from dataclasses import asdict, dataclass, fields
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
    week_type: int

    id: int | None = None
    place: str | None = None
    teacher: str | None = None
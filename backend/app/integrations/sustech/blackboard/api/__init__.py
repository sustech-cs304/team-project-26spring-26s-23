"""Blackboard API 层骨架。"""

from .announcements import BlackboardAnnouncementAPI
from .assignments import BlackboardAssignmentAPI
from .calendar_ics_parser import BlackboardCalendarICSParser
from .contents import BlackboardContentAPI
from .context import BlackboardAPIContext
from .course_catalog import (
    BlackboardCourseCatalogAPI,
    find_course_catalog_next_page_url,
    find_course_catalog_show_all_url,
    parse_course_catalog_table,
)
from .course_client import BlackboardCourseAPI
from .course_parser import BlackboardCourseParser
from .dto import (
    AllGradesCourseDTO,
    AllGradesDTO,
    AnnouncementDTO,
    AssignmentAttachmentDTO,
    AssignmentDTO,
    BlackboardDTO,
    CalendarEventDTO,
    CourseCatalogResultDTO,
    CourseDTO,
    CourseGradesDTO,
    GradeDTO,
    ResourceDTO,
)
from .fetch_helpers import extract_xml_contents
from .grades import BlackboardGradeAPI

__all__ = [
    "BlackboardDTO",
    "CourseDTO",
    "AssignmentAttachmentDTO",
    "AssignmentDTO",
    "ResourceDTO",
    "AnnouncementDTO",
    "GradeDTO",
    "CourseGradesDTO",
    "AllGradesCourseDTO",
    "AllGradesDTO",
    "CourseCatalogResultDTO",
    "CalendarEventDTO",
    "BlackboardAPIContext",
    "BlackboardCourseParser",
    "BlackboardCourseAPI",
    "BlackboardCourseCatalogAPI",
    "BlackboardAssignmentAPI",
    "BlackboardGradeAPI",
    "BlackboardAnnouncementAPI",
    "BlackboardContentAPI",
    "BlackboardCalendarICSParser",
    "parse_course_catalog_table",
    "find_course_catalog_show_all_url",
    "find_course_catalog_next_page_url",
    "extract_xml_contents",
]

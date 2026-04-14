from __future__ import annotations

from app.integrations.sustech.blackboard.shared import extract_blackboard_ids_from_url


def test_url_id_extraction() -> None:
    test_cases = [
        (
            "https://bb.sustech.edu.cn/webapps/blackboard/content/listContent.jsp?course_id=_12345_1",
            "course_id",
            "_12345_1",
        ),
        (
            "https://bb.sustech.edu.cn/webapps/blackboard/execute/content/file?content_id=_67890_1",
            "content_id",
            "_67890_1",
        ),
        (
            "https://bb.sustech.edu.cn/webapps/assignment/uploadAssignment?pk1=_11111_1",
            "pk1",
            "_11111_1",
        ),
        ("https://bb.sustech.edu.cn/bbcswebdav/xid-22222", "xid", "22222"),
        (
            "https://bb.sustech.edu.cn/webapps/portal/execute/tabs/tabAction?rid=_33333_1",
            "rid",
            "_33333_1",
        ),
        (
            "https://bb.sustech.edu.cn/webapps/calendar/calendarData/selectedCalendarViewData?id=_44444_1",
            "id",
            "_44444_1",
        ),
        (
            "https://bb.sustech.edu.cn/bbcswebdav/pid-55555-dt-content-rid-66666_1/xid-77777",
            "xid",
            "77777",
        ),
        (
            "https://bb.sustech.edu.cn/webapps/blackboard/content/rid-88888_1/file.pdf",
            "rid",
            "88888_1",
        ),
        ("https://bb.sustech.edu.cn/webapps/portal/pid-99999/page.jsp", "pk1", "99999"),
        (
            "https://bb.sustech.edu.cn/webapps/blackboard/execute/launcher?type=Course&id=_10101_1#_20202_1",
            "id",
            "_10101_1",
        ),
        (
            "https://bb.sustech.edu.cn/bbcswebdav/xid-30303?course_id=_40404_1",
            "course_id",
            "_40404_1",
        ),
        ("https://bb.sustech.edu.cn/webapps/login/", None, None),
    ]

    for url, expected_key, expected_value in test_cases:
        result = extract_blackboard_ids_from_url(url)
        if expected_key is None:
            assert all(value is None for key, value in result.items() if key != "source")
        else:
            assert result.get(expected_key) == expected_value

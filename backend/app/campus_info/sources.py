from __future__ import annotations

from app.campus_info.models import (
    OfficialDocCategory,
    OfficialDocSeed,
    SourceKind,
    UpdateCadence,
    UpdatePolicy,
)


def get_official_doc_seeds() -> list[OfficialDocSeed]:
    return [
        OfficialDocSeed(
            source_id="sustech_rules_and_regulations_listing",
            title="学校章程及制定的各项规章制度",
            category=OfficialDocCategory.OTHER,
            kind=SourceKind.HTML_LISTING,
            url="https://www.sustech.edu.cn/zh/rules-and-regulations.html",
            update_policy=UpdatePolicy(cadence=UpdateCadence.MONTHLY, supports_incremental=True),
            parser="sustech_rules_and_regulations",
        ),
        OfficialDocSeed(
            source_id="osa_policies_listing_wjxzs",
            title="学生工作部 文件下载（规章制度/学生手册等）",
            category=OfficialDocCategory.STUDENT_AFFAIRS,
            kind=SourceKind.HTML_LISTING,
            url="https://osa.sustech.edu.cn/index.php?g=School&m=Filedownload&a=wjxzs",
            update_policy=UpdatePolicy(cadence=UpdateCadence.WEEKLY, supports_incremental=True),
            parser="osa_wjxzs",
        ),
    ]


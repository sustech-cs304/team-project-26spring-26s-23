"""Add Blackboard announcement relation fields and link table.

Revision ID: 20260430_04_blackboard_announcement_assignment_links
Revises: 20260430_03_blackboard_html_fields
Create Date: 2026-04-30 23:10:00
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "20260430_04_blackboard_announcement_assignment_links"
down_revision: Union[str, None] = "20260430_03_blackboard_html_fields"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    table_names = set(inspector.get_table_names())

    if "announcements" in table_names:
        announcement_columns = {column["name"] for column in inspector.get_columns("announcements")}
        if "relation_type" not in announcement_columns:
            op.add_column(
                "announcements",
                sa.Column("relation_type", sa.String(length=64), nullable=True),
            )
        if "relation_confidence" not in announcement_columns:
            op.add_column(
                "announcements",
                sa.Column("relation_confidence", sa.String(length=64), nullable=True),
            )

    if "announcement_assignment_links" not in table_names:
        op.create_table(
            "announcement_assignment_links",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.Column("last_synced_at", sa.DateTime(), nullable=True),
            sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("0")),
            sa.Column("announcement_id", sa.String(length=128), nullable=False),
            sa.Column("assignment_id", sa.String(length=128), nullable=False),
            sa.Column("course_id", sa.String(length=128), nullable=False),
            sa.Column("link_source", sa.String(length=64), nullable=False),
            sa.Column("confidence", sa.String(length=64), nullable=False),
            sa.Column("evidence_json", sa.Text(), nullable=True),
            sa.ForeignKeyConstraint(["announcement_id"], ["announcements.announcement_id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["assignment_id"], ["assignments.assignment_id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["course_id"], ["courses.course_id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "announcement_id",
                "assignment_id",
                name="uq_announcement_assignment_links_pair",
            ),
        )
        op.create_index(
            "idx_announcement_assignment_links_course",
            "announcement_assignment_links",
            ["course_id"],
            unique=False,
        )
        op.create_index(
            "idx_announcement_assignment_links_confidence",
            "announcement_assignment_links",
            ["confidence"],
            unique=False,
        )
        op.create_index(
            "idx_announcement_assignment_links_announcement",
            "announcement_assignment_links",
            ["announcement_id"],
            unique=False,
        )
        op.create_index(
            "idx_announcement_assignment_links_assignment",
            "announcement_assignment_links",
            ["assignment_id"],
            unique=False,
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    table_names = set(inspector.get_table_names())

    if "announcement_assignment_links" in table_names:
        op.drop_index(
            "idx_announcement_assignment_links_assignment",
            table_name="announcement_assignment_links",
        )
        op.drop_index(
            "idx_announcement_assignment_links_announcement",
            table_name="announcement_assignment_links",
        )
        op.drop_index(
            "idx_announcement_assignment_links_confidence",
            table_name="announcement_assignment_links",
        )
        op.drop_index(
            "idx_announcement_assignment_links_course",
            table_name="announcement_assignment_links",
        )
        op.drop_table("announcement_assignment_links")

    if "announcements" in table_names:
        announcement_columns = {column["name"] for column in inspector.get_columns("announcements")}
        if "relation_confidence" in announcement_columns:
            op.drop_column("announcements", "relation_confidence")
        if "relation_type" in announcement_columns:
            op.drop_column("announcements", "relation_type")

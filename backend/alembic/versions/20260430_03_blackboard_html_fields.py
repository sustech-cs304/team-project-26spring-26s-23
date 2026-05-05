"""Add Blackboard HTML rich text fields.

Revision ID: 20260430_03_blackboard_html_fields
Revises: 20260418_02_persist_tool_permission_policy
Create Date: 2026-04-30 16:30:00
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "20260430_03_blackboard_html_fields"
down_revision: Union[str, None] = "20260418_02_persist_tool_permission_policy"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    table_names = set(inspector.get_table_names())

    if "assignments" in table_names:
        assignment_columns = {column["name"] for column in inspector.get_columns("assignments")}
        if "description_html" not in assignment_columns:
            op.add_column("assignments", sa.Column("description_html", sa.Text(), nullable=True))

    if "announcements" in table_names:
        announcement_columns = {column["name"] for column in inspector.get_columns("announcements")}
        if "content_html" not in announcement_columns:
            op.add_column("announcements", sa.Column("content_html", sa.Text(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    table_names = set(inspector.get_table_names())

    if "announcements" in table_names:
        announcement_columns = {column["name"] for column in inspector.get_columns("announcements")}
        if "content_html" in announcement_columns:
            op.drop_column("announcements", "content_html")

    if "assignments" in table_names:
        assignment_columns = {column["name"] for column in inspector.get_columns("assignments")}
        if "description_html" in assignment_columns:
            op.drop_column("assignments", "description_html")

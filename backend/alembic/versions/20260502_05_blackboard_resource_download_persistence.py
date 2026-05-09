"""Add Blackboard resource download persistence tables.

Revision ID: 20260502_05_blackboard_resource_download_persistence
Revises: 20260430_04_blackboard_announcement_assignment_links
Create Date: 2026-05-02 11:35:00
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "20260502_05_blackboard_resource_download_persistence"
down_revision: Union[str, None] = "20260430_04_blackboard_announcement_assignment_links"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    table_names = set(inspector.get_table_names())

    if "resource_download_bindings" not in table_names:
        op.create_table(
            "resource_download_bindings",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.Column("last_synced_at", sa.DateTime(), nullable=True),
            sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("0")),
            sa.Column("course_id", sa.String(length=128), nullable=False),
            sa.Column("resource_id", sa.String(length=128), nullable=True),
            sa.Column("resource_url_key", sa.String(length=2048), nullable=False),
            sa.Column("local_path", sa.Text(), nullable=False),
            sa.Column("directory_path", sa.Text(), nullable=False),
            sa.Column("file_name", sa.String(length=512), nullable=False),
            sa.Column("downloaded_at", sa.DateTime(), nullable=True),
            sa.Column("verified_at", sa.DateTime(), nullable=True),
            sa.Column("file_size_bytes", sa.Integer(), nullable=True),
            sa.Column("etag", sa.String(length=512), nullable=True),
            sa.Column("content_length", sa.Integer(), nullable=True),
            sa.ForeignKeyConstraint(["course_id"], ["courses.course_id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["resource_id"], ["resources.resource_id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "resource_url_key",
                name="uq_resource_download_bindings_resource_url_key",
            ),
        )
        op.create_index(
            "idx_resource_download_bindings_course",
            "resource_download_bindings",
            ["course_id"],
            unique=False,
        )
        op.create_index(
            "idx_resource_download_bindings_resource",
            "resource_download_bindings",
            ["resource_id"],
            unique=False,
        )
        op.create_index(
            "idx_resource_download_bindings_local_path",
            "resource_download_bindings",
            ["local_path"],
            unique=False,
        )

    if "resource_download_directory_preferences" not in table_names:
        op.create_table(
            "resource_download_directory_preferences",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.Column("last_synced_at", sa.DateTime(), nullable=True),
            sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("0")),
            sa.Column("scope_type", sa.String(length=32), nullable=False),
            sa.Column("scope_key", sa.String(length=2048), nullable=False),
            sa.Column("directory_path", sa.Text(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "scope_type",
                "scope_key",
                name="uq_resource_download_directory_preferences_scope",
            ),
        )
        op.create_index(
            "idx_resource_download_directory_preferences_scope_type",
            "resource_download_directory_preferences",
            ["scope_type"],
            unique=False,
        )
        op.create_index(
            "idx_resource_download_directory_preferences_scope_key",
            "resource_download_directory_preferences",
            ["scope_key"],
            unique=False,
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    table_names = set(inspector.get_table_names())

    if "resource_download_directory_preferences" in table_names:
        op.drop_index(
            "idx_resource_download_directory_preferences_scope_key",
            table_name="resource_download_directory_preferences",
        )
        op.drop_index(
            "idx_resource_download_directory_preferences_scope_type",
            table_name="resource_download_directory_preferences",
        )
        op.drop_table("resource_download_directory_preferences")

    if "resource_download_bindings" in table_names:
        op.drop_index(
            "idx_resource_download_bindings_local_path",
            table_name="resource_download_bindings",
        )
        op.drop_index(
            "idx_resource_download_bindings_resource",
            table_name="resource_download_bindings",
        )
        op.drop_index(
            "idx_resource_download_bindings_course",
            table_name="resource_download_bindings",
        )
        op.drop_table("resource_download_bindings")

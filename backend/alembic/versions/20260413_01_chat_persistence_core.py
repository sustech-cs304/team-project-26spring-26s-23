"""create chat persistence core schema

Revision ID: 20260413_01
Revises: 
Create Date: 2026-04-13 20:15:00
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260413_01"
down_revision: str | None = None
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "threads",
        sa.Column("id", sa.String(length=128), nullable=False),
        sa.Column("bound_agent_id", sa.String(length=128), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("title_source", sa.String(length=32), nullable=True),
        sa.Column("summary_text", sa.Text(), nullable=True),
        sa.Column("summary_source", sa.String(length=32), nullable=True),
        sa.Column("last_run_id", sa.String(length=128), nullable=True),
        sa.Column("last_user_message_preview", sa.Text(), nullable=True),
        sa.Column("last_assistant_message_preview", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("schema_version", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_threads_last_run_id", "threads", ["last_run_id"], unique=False)
    op.create_index("ix_threads_updated_at", "threads", ["updated_at"], unique=False)

    op.create_table(
        "runs",
        sa.Column("id", sa.String(length=128), nullable=False),
        sa.Column("thread_id", sa.String(length=128), nullable=False),
        sa.Column("agent_id", sa.String(length=128), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("request_message_text", sa.Text(), nullable=False),
        sa.Column("request_message_role", sa.String(length=32), nullable=False),
        sa.Column("selected_model_route_json", sa.JSON(), nullable=False),
        sa.Column("resolved_model_route_json", sa.JSON(), nullable=True),
        sa.Column("resolved_model_id", sa.String(length=256), nullable=True),
        sa.Column("requested_thinking_json", sa.JSON(), nullable=True),
        sa.Column("applied_thinking_json", sa.JSON(), nullable=True),
        sa.Column("thinking_capability_override_json", sa.JSON(), nullable=True),
        sa.Column("thinking_level_intent", sa.String(length=32), nullable=True),
        sa.Column("enabled_tools_json", sa.JSON(), nullable=False),
        sa.Column("resolved_tool_ids_json", sa.JSON(), nullable=True),
        sa.Column("request_options_json", sa.JSON(), nullable=False),
        sa.Column("debug_mode_enabled", sa.Boolean(), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("cancel_requested", sa.Boolean(), nullable=False),
        sa.Column("assistant_text", sa.Text(), nullable=True),
        sa.Column("failure_code", sa.String(length=128), nullable=True),
        sa.Column("failure_message", sa.Text(), nullable=True),
        sa.Column("failure_details_json", sa.JSON(), nullable=True),
        sa.Column("cancel_reason", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["thread_id"], ["threads.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_runs_thread_id", "runs", ["thread_id"], unique=False)
    op.create_index("ix_runs_thread_created_at", "runs", ["thread_id", "created_at"], unique=False)
    op.create_index("ix_runs_thread_updated_at", "runs", ["thread_id", "updated_at"], unique=False)

    op.create_table(
        "run_events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("run_id", sa.String(length=128), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("payload_json", sa.JSON(), nullable=False),
        sa.Column("payload_text_search", sa.Text(), nullable=True),
        sa.Column("tool_call_id", sa.String(length=128), nullable=True),
        sa.Column("tool_id", sa.String(length=128), nullable=True),
        sa.Column("phase", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("redaction_version", sa.Integer(), nullable=False),
        sa.Column("is_redacted", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "seq", name="uq_run_events_run_id_seq"),
    )
    op.create_index("ix_run_events_run_id", "run_events", ["run_id"], unique=False)
    op.create_index("ix_run_events_run_id_seq", "run_events", ["run_id", "seq"], unique=False)
    op.create_index("ix_run_events_tool_call_id", "run_events", ["tool_call_id"], unique=False)

    op.create_table(
        "thread_projection",
        sa.Column("thread_id", sa.String(length=128), nullable=False),
        sa.Column("last_run_status", sa.String(length=32), nullable=True),
        sa.Column("last_activity_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("display_title", sa.Text(), nullable=True),
        sa.Column("display_summary", sa.Text(), nullable=True),
        sa.Column("last_effective_model_snapshot_json", sa.JSON(), nullable=True),
        sa.Column("last_effective_tools_snapshot_json", sa.JSON(), nullable=True),
        sa.Column("drift_summary_json", sa.JSON(), nullable=True),
        sa.Column("timeline_preview_json", sa.JSON(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["thread_id"], ["threads.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("thread_id"),
    )
    op.create_index(
        "ix_thread_projection_last_activity_at",
        "thread_projection",
        ["last_activity_at"],
        unique=False,
    )

    op.create_table(
        "run_projection",
        sa.Column("run_id", sa.String(length=128), nullable=False),
        sa.Column("assistant_text_final", sa.Text(), nullable=True),
        sa.Column("timeline_items_json", sa.JSON(), nullable=True),
        sa.Column("tool_call_blocks_json", sa.JSON(), nullable=True),
        sa.Column("diagnostic_blocks_json", sa.JSON(), nullable=True),
        sa.Column("terminal_state_json", sa.JSON(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("run_id"),
    )


def downgrade() -> None:
    op.drop_table("run_projection")
    op.drop_index("ix_thread_projection_last_activity_at", table_name="thread_projection")
    op.drop_table("thread_projection")
    op.drop_index("ix_run_events_tool_call_id", table_name="run_events")
    op.drop_index("ix_run_events_run_id_seq", table_name="run_events")
    op.drop_index("ix_run_events_run_id", table_name="run_events")
    op.drop_table("run_events")
    op.drop_index("ix_runs_thread_updated_at", table_name="runs")
    op.drop_index("ix_runs_thread_created_at", table_name="runs")
    op.drop_index("ix_runs_thread_id", table_name="runs")
    op.drop_table("runs")
    op.drop_index("ix_threads_updated_at", table_name="threads")
    op.drop_index("ix_threads_last_run_id", table_name="threads")
    op.drop_table("threads")

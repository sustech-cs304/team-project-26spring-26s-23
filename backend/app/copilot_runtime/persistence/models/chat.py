"""ORM table definitions for Copilot runtime chat persistence."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from ..base import Base


def _utcnow() -> datetime:
    return datetime.now(UTC)


class ThreadModel(Base):
    __tablename__ = "threads"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    bound_agent_id: Mapped[str] = mapped_column(String(128), nullable=False)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    title_source: Mapped[str | None] = mapped_column(String(32), nullable=True)
    summary_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary_source: Mapped[str | None] = mapped_column(String(32), nullable=True)
    last_run_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    last_user_message_preview: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_assistant_message_preview: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    __table_args__ = (
        Index("ix_threads_updated_at", "updated_at"),
        Index("ix_threads_last_run_id", "last_run_id"),
    )


class RunModel(Base):
    __tablename__ = "runs"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    thread_id: Mapped[str] = mapped_column(
        String(128),
        ForeignKey("threads.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    agent_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    request_message_text: Mapped[str] = mapped_column(Text, nullable=False)
    request_message_role: Mapped[str] = mapped_column(String(32), nullable=False)
    selected_model_route_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    resolved_model_route_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    resolved_model_id: Mapped[str | None] = mapped_column(String(256), nullable=True)
    requested_thinking_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    applied_thinking_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    thinking_capability_override_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    thinking_level_intent: Mapped[str | None] = mapped_column(String(32), nullable=True)
    enabled_tools_json: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    resolved_tool_ids_json: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    request_options_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    debug_mode_enabled: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    assistant_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    failure_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    failure_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    failure_details_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)

    __table_args__ = (
        Index("ix_runs_thread_created_at", "thread_id", "created_at"),
        Index("ix_runs_thread_updated_at", "thread_id", "updated_at"),
    )


class RunEventModel(Base):
    __tablename__ = "run_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(
        String(128),
        ForeignKey("runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    payload_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    payload_text_search: Mapped[str | None] = mapped_column(Text, nullable=True)
    tool_call_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    tool_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    phase: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    redaction_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    is_redacted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    __table_args__ = (
        UniqueConstraint("run_id", "seq", name="uq_run_events_run_id_seq"),
        Index("ix_run_events_run_id_seq", "run_id", "seq"),
        Index("ix_run_events_tool_call_id", "tool_call_id"),
    )


class ThreadProjectionModel(Base):
    __tablename__ = "thread_projection"

    thread_id: Mapped[str] = mapped_column(
        String(128),
        ForeignKey("threads.id", ondelete="CASCADE"),
        primary_key=True,
    )
    last_run_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    last_activity_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    display_title: Mapped[str | None] = mapped_column(Text, nullable=True)
    display_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_effective_model_snapshot_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    last_effective_tools_snapshot_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    drift_summary_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    timeline_preview_json: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)

    __table_args__ = (Index("ix_thread_projection_last_activity_at", "last_activity_at"),)


class RunProjectionModel(Base):
    __tablename__ = "run_projection"

    run_id: Mapped[str] = mapped_column(
        String(128),
        ForeignKey("runs.id", ondelete="CASCADE"),
        primary_key=True,
    )
    assistant_text_final: Mapped[str | None] = mapped_column(Text, nullable=True)
    timeline_items_json: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON, nullable=True)
    tool_call_blocks_json: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON, nullable=True)
    diagnostic_blocks_json: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON, nullable=True)
    terminal_state_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)


__all__ = [
    "RunEventModel",
    "RunModel",
    "RunProjectionModel",
    "ThreadModel",
    "ThreadProjectionModel",
]

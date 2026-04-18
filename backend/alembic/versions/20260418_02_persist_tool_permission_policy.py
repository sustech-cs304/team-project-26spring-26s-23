"""Persist tool permission policy on runtime runs.

Revision ID: 20260418_02_persist_tool_permission_policy
Revises: 20260413_01
Create Date: 2026-04-18 14:59:00
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260418_02_persist_tool_permission_policy"
down_revision: Union[str, None] = "20260413_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("runs", sa.Column("tool_permission_policy_json", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("runs", "tool_permission_policy_json")

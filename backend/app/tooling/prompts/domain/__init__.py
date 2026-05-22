"""Domain prompt registries — Blackboard and TIS tools."""

from __future__ import annotations

from .blackboard import BLACKBOARD_PROMPTS, BLACKBOARD_TOOL_PREFERENCE_GUIDE
from .tis import TIS_PROMPTS, TIS_TOOL_PREFERENCE_GUIDE

__all__ = [
    "BLACKBOARD_PROMPTS",
    "BLACKBOARD_TOOL_PREFERENCE_GUIDE",
    "TIS_PROMPTS",
    "TIS_TOOL_PREFERENCE_GUIDE",
]

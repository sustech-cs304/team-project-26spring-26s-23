"""Tests for the tool prompts package — 16 bundled prompts, registry API, and quality checks."""

from __future__ import annotations

import pytest

from app.tooling.prompts import (
    PromptContext,
    ToolPrompt,
    clear_registry,
    get_all_tool_descriptions,
    get_all_tool_prompts,
    get_tool_description,
    get_tool_prompt,
    get_tool_prompts_as_dicts,
    register_tool_prompt,
)
from app.tooling.prompts._base import (
    DEFAULT_MAX_GLOB_RESULTS,
    DEFAULT_MAX_GREP_RESULTS,
    DEFAULT_MAX_READ_LINES,
)
from app.tooling.prompts._context import PromptContext
from app.tooling.prompts.file_tools import (
    FILE_TOOL_EDIT_PROMPT,
    FILE_TOOL_GLOB_PROMPT,
    FILE_TOOL_GREP_PROMPT,
    FILE_TOOL_NOTEBOOK_EDIT_PROMPT,
    FILE_TOOL_PREFERENCE_GUIDE,
    FILE_TOOL_PROMPTS,
    FILE_TOOL_READ_PROMPT,
    FILE_TOOL_SWITCH_ROOT_PROMPT,
    FILE_TOOL_WRITE_PROMPT,
)
from app.tooling.prompts.domain.blackboard import (
    BLACKBOARD_PROMPTS,
    BLACKBOARD_SNAPSHOT_SYNC_PROMPT,
    BLACKBOARD_SQL_QUERY_PROMPT,
    BLACKBOARD_TOOL_PREFERENCE_GUIDE,
)
from app.tooling.prompts.domain.tis import (
    TIS_PROMPTS,
    TIS_SQL_QUERY_PROMPT,
    TIS_TOOL_PREFERENCE_GUIDE,
)
from app.tooling.prompts.system.tool_selection_guide import (
    SHARED_CONVENTIONS,
    TOOL_SELECTION_GUIDE,
)


# ============================================================================
# ToolPrompt base class
# ============================================================================

class TestToolPromptBasics:
    def test_minimal_construction(self) -> None:
        prompt = ToolPrompt.minimal("test.tool", "A test tool.")
        assert prompt.tool_id == "test.tool"
        assert prompt.description == "A test tool."

    def test_empty_tool_id_raises(self) -> None:
        with pytest.raises(ValueError, match="tool_id"):
            ToolPrompt.minimal("", "desc")

    def test_empty_description_raises(self) -> None:
        with pytest.raises(ValueError, match="description"):
            ToolPrompt.minimal("test.tool", "")

    def test_optional_sections_normalized(self) -> None:
        prompt = ToolPrompt(
            tool_id="t.id",
            description="desc",
            usage_guide="  use it  ",
        )
        assert prompt.usage_guide == "use it"


class TestToolPromptRendering:
    def test_render_compact(self) -> None:
        prompt = ToolPrompt.minimal("t.id", "Short description.")
        assert prompt.render_compact() == "Short description."

    def test_render_with_all_sections(self) -> None:
        prompt = ToolPrompt(
            tool_id="t.id",
            description="Test tool.",
            usage_guide="Use when needed.",
            parameter_guide="param: desc",
            constraints="Must exist.",
            relationships="Use with X.",
            examples='{"key": "value"}',
        )
        rendered = prompt.render()
        assert "Test tool." in rendered
        assert "Use when needed." in rendered

    def test_render_full_mode(self) -> None:
        prompt = ToolPrompt(
            tool_id="test.tool",
            description="A test tool.",
            usage_guide="Use carefully.",
        )
        full = prompt.render_full()
        assert "## test.tool" in full
        assert "### When to Use" in full

    def test_render_with_context_injection(self) -> None:
        prompt = ToolPrompt(
            tool_id="t.id",
            description="Workspace: {{workspace_root}}",
        )
        ctx = PromptContext(workspace_root="/home/user/project")
        rendered = prompt.render(context=ctx)
        assert "/home/user/project" in rendered


# ============================================================================
# PromptContext
# ============================================================================

class TestPromptContext:
    def test_inject_known_variables(self) -> None:
        ctx = PromptContext(
            workspace_root="/ws",
            max_read_lines=500,
        )
        text = "Root: {{workspace_root}}, Lines: {{max_read_lines}}"
        result = ctx.inject(text)
        assert "Root: /ws" in result
        assert "Lines: 500" in result

    def test_inject_unknown_variable_no_change(self) -> None:
        ctx = PromptContext()
        text = "Value: {{unknown_var}}"
        assert ctx.inject(text) == text


# ============================================================================
# Registry API
# ============================================================================

class TestPromptRegistry:
    def test_register_and_retrieve(self) -> None:
        clear_registry()
        prompt = ToolPrompt.minimal("custom.tool", "Custom tool.")
        register_tool_prompt(prompt)
        assert get_tool_prompt("custom.tool") is not None

    def test_get_missing_tool(self) -> None:
        clear_registry()
        assert get_tool_prompt("nonexistent") is None

    def test_get_tool_prompts_as_dicts(self) -> None:
        clear_registry()
        register_tool_prompt(ToolPrompt.minimal("a.tool", "Tool A"))
        dicts = get_tool_prompts_as_dicts()
        assert len(dicts) == 1
        assert dicts[0]["toolId"] == "a.tool"


# ============================================================================
# Bundled prompts count
# ============================================================================

class TestBundledPrompts:
    def test_total_bundled_count_is_16(self) -> None:
        all_prompts = (*FILE_TOOL_PROMPTS, *BLACKBOARD_PROMPTS, *TIS_PROMPTS)
        assert len(all_prompts) == 16

    def test_all_file_tools_present(self) -> None:
        tool_ids = {p.tool_id for p in FILE_TOOL_PROMPTS}
        assert len(tool_ids) == 7
        assert "tool.fs.read" in tool_ids
        assert "tool.fs.edit" in tool_ids
        assert "tool.fs.glob" in tool_ids
        assert "tool.fs.grep" in tool_ids

    def test_all_blackboard_tools_present(self) -> None:
        tool_ids = {p.tool_id for p in BLACKBOARD_PROMPTS}
        assert len(tool_ids) == 5
        assert "blackboard.snapshot.sync" in tool_ids
        assert "blackboard.sql.query" in tool_ids

    def test_all_tis_tools_present(self) -> None:
        tool_ids = {p.tool_id for p in TIS_PROMPTS}
        assert len(tool_ids) == 4
        assert "tis.selected_courses.fetch" in tool_ids
        assert "tis.sql.query" in tool_ids


# ============================================================================
# Prompt quality checks
# ============================================================================

ALL_PROMPTS = (*FILE_TOOL_PROMPTS, *BLACKBOARD_PROMPTS, *TIS_PROMPTS)


class TestPromptQuality:
    @pytest.mark.parametrize("prompt", ALL_PROMPTS, ids=lambda p: p.tool_id)
    def test_has_usage_guide(self, prompt: ToolPrompt) -> None:
        assert len(prompt.usage_guide) > 50

    @pytest.mark.parametrize("prompt", ALL_PROMPTS, ids=lambda p: p.tool_id)
    def test_has_parameter_guide(self, prompt: ToolPrompt) -> None:
        assert len(prompt.parameter_guide) > 30

    @pytest.mark.parametrize("prompt", ALL_PROMPTS, ids=lambda p: p.tool_id)
    def test_has_constraints(self, prompt: ToolPrompt) -> None:
        assert len(prompt.constraints) > 20

    @pytest.mark.parametrize("prompt", ALL_PROMPTS, ids=lambda p: p.tool_id)
    def test_rendered_not_empty(self, prompt: ToolPrompt) -> None:
        rendered = prompt.render()
        assert len(rendered) > 100


# ============================================================================
# Critical prompt rules
# ============================================================================

class TestCriticalPromptRules:
    def test_read_before_edit_rule_in_edit_prompt(self) -> None:
        rendered = FILE_TOOL_EDIT_PROMPT.render_full()
        assert "tool.fs.read" in rendered

    def test_edit_not_write_rule_in_write_prompt(self) -> None:
        rendered = FILE_TOOL_WRITE_PROMPT.render_full()
        assert "tool.fs.edit" in rendered

    def test_snap_sync_sql_dependency(self) -> None:
        rendered = BLACKBOARD_SQL_QUERY_PROMPT.render_full()
        assert "blackboard.snapshot.sync" in rendered

    def test_fetch_before_sql_in_tis(self) -> None:
        rendered = TIS_SQL_QUERY_PROMPT.render_full()
        assert "tis.selected_courses.fetch" in rendered

    def test_replace_all_in_edit_prompt(self) -> None:
        rendered = FILE_TOOL_EDIT_PROMPT.render_full()
        assert "replaceAll" in rendered

    def test_pdf_pages_in_read_prompt(self) -> None:
        rendered = FILE_TOOL_READ_PROMPT.render_full()
        assert "PDF" in rendered


# ============================================================================
# Inter-tool guides
# ============================================================================

class TestToolPreferenceGuides:
    def test_file_tool_guide_mentions_key_tools(self) -> None:
        assert "tool.fs.read" in FILE_TOOL_PREFERENCE_GUIDE
        assert "tool.fs.edit" in FILE_TOOL_PREFERENCE_GUIDE

    def test_blackboard_guide_mentions_key_tools(self) -> None:
        assert "blackboard.snapshot.sync" in BLACKBOARD_TOOL_PREFERENCE_GUIDE

    def test_tis_guide_mentions_key_tools(self) -> None:
        assert "tis.selected_courses.fetch" in TIS_TOOL_PREFERENCE_GUIDE

    def test_combined_guide_includes_all_domains(self) -> None:
        assert "File Operation" in TOOL_SELECTION_GUIDE
        assert "Blackboard Data Tools" in TOOL_SELECTION_GUIDE
        assert "TIS" in TOOL_SELECTION_GUIDE


# ============================================================================
# Default value embedding
# ============================================================================

class TestDefaultValues:
    def test_read_prompt_mentions_default_max_lines(self) -> None:
        rendered = FILE_TOOL_READ_PROMPT.render()
        assert str(DEFAULT_MAX_READ_LINES) in rendered

    def test_glob_prompt_mentions_default_max_results(self) -> None:
        rendered = FILE_TOOL_GLOB_PROMPT.render()
        assert str(DEFAULT_MAX_GLOB_RESULTS) in rendered

    def test_grep_prompt_mentions_default_max_results(self) -> None:
        rendered = FILE_TOOL_GREP_PROMPT.render()
        assert str(DEFAULT_MAX_GREP_RESULTS) in rendered


# ============================================================================
# Shared conventions and parallel execution
# ============================================================================


class TestSharedConventions:
    def test_includes_read_before_modify(self) -> None:
        assert "Read before modify" in SHARED_CONVENTIONS
        assert "tool.fs.read" in SHARED_CONVENTIONS

    def test_includes_emoji_policy(self) -> None:
        assert "Only use emojis" in SHARED_CONVENTIONS

    def test_includes_documentation_policy(self) -> None:
        assert "NEVER create README" in SHARED_CONVENTIONS

    def test_includes_shell_avoidance(self) -> None:
        assert "Shell command avoidance" in SHARED_CONVENTIONS
        assert "cat, grep, sed, awk" in SHARED_CONVENTIONS

    def test_includes_parallel_execution_rule(self) -> None:
        assert "Parallel execution" in SHARED_CONVENTIONS
        assert "parallel tool calls" in SHARED_CONVENTIONS
        assert "independent" in SHARED_CONVENTIONS.lower()

    def test_parallel_execution_has_concrete_examples(self) -> None:
        assert "three tool.fs.read calls in ONE message" in SHARED_CONVENTIONS
        assert "tool.fs.glob + tool.fs.grep in ONE message" in SHARED_CONVENTIONS

    def test_parallel_execution_explains_dependency_rule(self) -> None:
        assert "DEPENDS on the earlier" in SHARED_CONVENTIONS

    def test_includes_credentials_auto_resolve(self) -> None:
        assert "Credentials" in SHARED_CONVENTIONS
        assert "auto-resolved" in SHARED_CONVENTIONS

    def test_includes_sync_first_rule(self) -> None:
        assert "Sync-first" in SHARED_CONVENTIONS
        assert "prior data sync" in SHARED_CONVENTIONS

    def test_includes_state_persistence(self) -> None:
        assert "State persistence" in SHARED_CONVENTIONS
        assert "stateKey" in SHARED_CONVENTIONS


# ============================================================================
# Context injection integration
# ============================================================================


class TestContextInjectionIntegration:
    """Verify PromptContext.inject() works end-to-end with the guides."""

    def test_context_injects_current_month_year(self) -> None:
        context = PromptContext(current_month_year="2026年05月")
        injected = context.inject(TOOL_SELECTION_GUIDE)
        assert "2026年05月" in injected

    def test_context_does_not_break_guides(self) -> None:
        context = PromptContext(
            workspace_root="/test/root",
            current_month_year="2026年05月",
        )
        injected = context.inject(TOOL_SELECTION_GUIDE)
        assert "Tool Selection Guide" in injected
        assert "File Operation Tool Selection" in injected
        assert "Blackboard Data Tools" in injected

    def test_context_injects_into_shared_conventions(self) -> None:
        context = PromptContext(workspace_root="/my/project")
        injected = context.inject(SHARED_CONVENTIONS)
        assert "Shared File Operation Conventions" in injected
        assert "Parallel execution" in injected

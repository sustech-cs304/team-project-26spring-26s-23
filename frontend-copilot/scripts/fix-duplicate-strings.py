#!/usr/bin/env python3
"""
Automated fix for sonarjs/no-duplicate-string in test files.

Usage: python scripts/fix-duplicate-strings.py [file1] [file2] ...
If no files specified, runs on the four priority files.

Strategy:
1. Run ESLint in JSON format to get warnings with line/column
2. Extract the actual string literal from the source at each warning position
3. Group by unique string value across the entire file
4. Generate unique constant names (DESC_, FIELD_, LABEL_, DATA_, SELECTOR_, CSS_ prefixes)
5. Insert constant definitions after imports, before first describe/it
6. Replace all occurrences of the string literal with the constant reference
"""

import json
import os
import re
import subprocess
import sys
# Config
PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ESLINT_BIN = os.path.join(PROJECT_DIR, 'node_modules', '.bin', 'eslint')

# Files in the target directories
DEFAULT_FILES = [
    'src/features/copilot/CopilotChatPanel.composer.test.tsx',
    'src/features/copilot/CopilotChatPanel.test.tsx',
    'src/workbench/sustech/BlackboardDataBrowser.test.tsx',
    'src/workbench/capabilities/CapabilitiesWorkspace.test.tsx',
]

SMALLER_FILES = [
    'src/features/copilot/CopilotPanelShell.diagnostic.test.tsx',
    'src/features/copilot/CopilotMessageList.segment.test.tsx',
    'src/features/copilot/CopilotComposer.test.tsx',
    'src/features/copilot/components/ToolPicker.test.tsx',
    'src/features/copilot/CopilotThinkingSelector.test.tsx',
    'src/features/copilot/copilot-chat-helpers.test.ts',
    'src/features/copilot/run-segment-reducer.test.ts',
    'src/features/copilot/error-detail-overlay-view-model.test.ts',
    'src/workbench/capabilities/use-managed-runtime.test.tsx',
]


def run_eslint_json(relative_path: str) -> list:
    """Run ESLint on a single file and return parsed JSON warnings."""
    abs_path = os.path.join(PROJECT_DIR, relative_path)
    
    # Write to temp file to avoid encoding issues
    import tempfile
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix='.json', mode='w', encoding='utf-8')
    tmp.close()
    
    try:
        cmd = f'npx eslint "{abs_path}" --format json > "{tmp.name}" 2>&1'
        subprocess.run(cmd, cwd=PROJECT_DIR, shell=True, timeout=60)
        
        with open(tmp.name, 'r', encoding='utf-8') as f:
            raw = f.read()
        
        # Find JSON array
        json_start = raw.find('[')
        if json_start < 0:
            return []
        
        data = json.loads(raw[json_start:])
        if isinstance(data, list) and len(data) > 0:
            return data[0].get('messages', [])
        return []
    except Exception as e:
        print(f"  ERROR running eslint: {e}")
        return []
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


def extract_string_at_position(lines: list, msg: dict) -> str | None:
    """
    Extract the string literal from the source using ESLint's line/column info.
    msg contains: line, column, endLine, endColumn
    Returns the string content (without quotes) or None if not found.
    """
    line_num = msg.get('line', 0)
    col_num = msg.get('column', 0)
    end_col = msg.get('endColumn', col_num + 10)
    
    if line_num < 1 or line_num > len(lines):
        return None
    
    line = lines[line_num - 1]
    start_idx = col_num - 1
    end_idx = end_col - 1
    
    if start_idx < 0 or start_idx >= len(line):
        return None
    
    if end_idx > len(line):
        end_idx = len(line)
    
    # Extract the substring from column to endColumn
    literal_str = line[start_idx:end_idx]
    
    # Strip quotes
    if (literal_str.startswith("'") and literal_str.endswith("'")) or \
       (literal_str.startswith('"') and literal_str.endswith('"')) or \
       (literal_str.startswith('`') and literal_str.endswith('`')):
        return literal_str[1:-1]
    
    return literal_str


def classify_string(s: str) -> str:
    """Classify a string to determine the constant prefix."""
    # CSS selectors / data-testid
    if s.startswith('data-testid=') or s.startswith('aria-') or s.startswith('.'):
        return 'SELECTOR'
    if s.startswith('copilot-') or s.startswith('chat-'):
        return 'SELECTOR'
    if 'data-testid' in s:
        return 'SELECTOR'
    
    # Chinese text - descriptions/labels
    if re.search(r'[\u4e00-\u9fff]', s):
        return 'DESC'
    
    # HTML tags / attributes
    if s.startswith('<') or s.startswith('['):
        return 'SELECTOR'
    
    # Field names (short, common identifiers)
    if re.match(r'^[a-z][a-zA-Z0-9_]*$', s) and len(s) < 20:
        return 'FIELD'
    
    # Labels / UI text
    return 'LABEL'


def make_constant_name(prefix: str, value: str, existing: set) -> str:
    """Generate a unique constant name from a string value."""
    # Create a short, readable identifier
    if re.search(r'[\u4e00-\u9fff]', value):
        # Chinese text - use pinyin-like approach, just use a counter
        base = f'{prefix}_CN_{len(existing):03d}'
    else:
        # English/ASCII - take first few significant words
        words = re.findall(r'[a-zA-Z0-9]+', value)
        if words:
            # Take key words, up to 3
            key_words = [w.upper() for w in words[:3] if len(w) > 2 or w.lower() in ('id', 'ok', 'ai', 'ui')]
            if not key_words:
                key_words = [words[0].upper()[:8]]
            base = f'{prefix}_{"_".join(key_words)}'
        else:
            # Special characters only
            base = f'{prefix}_SYM_{len(existing):03d}'
    
    # Ensure uniqueness
    name = base
    counter = 1
    while name in existing:
        counter += 1
        name = f'{base}_{counter}'
    
    existing.add(name)
    return name


def extract_all_duplicate_strings(file_path: str, debug: bool = False) -> dict[str, int]:
    """
    Extract all duplicate strings from a file by running ESLint and analyzing warnings.
    Returns dict of {string_value: actual_occurrence_count}.
    The count is extracted from the ESLint message (e.g., "duplicating this literal 9 times").
    """
    abs_path = os.path.join(PROJECT_DIR, file_path)
    with open(abs_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    messages = run_eslint_json(file_path)
    
    if debug:
        print(f"  DEBUG: Got {len(messages)} messages from ESLint")
        dup_msgs = [m for m in messages if m.get('ruleId') == 'sonarjs/no-duplicate-string']
        print(f"  DEBUG: {len(dup_msgs)} are duplicate-string warnings")
    
    string_counts: dict[str, int] = {}
    
    for msg in messages:
        if msg.get('ruleId') == 'sonarjs/no-duplicate-string':
            extracted = extract_string_at_position(lines, msg)
            if debug:
                print(f"  DEBUG: line={msg.get('line')} col={msg.get('column')} endCol={msg.get('endColumn')} -> '{extracted}'")
            if not extracted:
                continue
            
            # Parse the actual occurrence count from the ESLint message
            # Message format: "Define a constant instead of duplicating this literal N times."
            message = msg.get('message', '')
            count_match = re.search(r'duplicating this literal (\d+) times', message)
            if count_match:
                count = int(count_match.group(1))
                # Use the higher count (in case the same string is flagged in multiple places)
                if extracted not in string_counts or count > string_counts[extracted]:
                    string_counts[extracted] = count
            else:
                # Fallback: at least 4 (the ESLint threshold)
                string_counts[extracted] = max(string_counts.get(extracted, 4), 4)
    
    return string_counts


def find_all_occurrences(lines: list, search_str: str) -> list[tuple[int, int, int, int, int]]:
    """
    Find all occurrences of a string literal in the source code.
    Returns list of (line, quote_start_col, content_start_col, content_end_col, quote_end_col) - all 1-indexed.
    quote_start_col..quote_end_col is the full match including quotes.
    content_start_col..content_end_col is just the value (excluding quotes).
    """
    occurrences = []
    escaped = re.escape(search_str)
    
    for i, line in enumerate(lines):
        line_num = i + 1
        # Match any quoted version
        for pattern in [
            # template literal
            rf'`({escaped})`',
            # single-quoted
            rf"'({escaped})'",
            # double-quoted
            rf'"({escaped})"',
        ]:
            for m in re.finditer(pattern, line):
                # m.start(0) = start of opening quote
                # m.start(1) = start of content (after opening quote)
                # m.end(1) = end of content (before closing quote)
                # m.end(0) = end of closing quote
                occurrences.append((
                    line_num,
                    m.start(0) + 1,  # quote_start_col
                    m.start(1) + 1,  # content_start_col
                    m.end(1) + 1,    # content_end_col
                    m.end(0) + 1,    # quote_end_col
                ))

    return occurrences


def fix_file(file_path: str) -> bool:
    """Fix all duplicate-string issues in a single file."""
    abs_path = os.path.join(PROJECT_DIR, file_path)
    
    with open(abs_path, 'r', encoding='utf-8') as f:
        content = f.read()
        lines = content.split('\n')
    
    # Get all duplicate strings from ESLint
    string_counts = extract_all_duplicate_strings(file_path)
    
    if not string_counts:
        print(f"  No duplicate-string warnings for {file_path}")
        return False
    
    # Filter to strings that appear >= 4 times (ESLint threshold)
    duplicates = {s: c for s, c in string_counts.items() if c >= 4}
    
    if not duplicates:
        print(f"  No strings with >= 4 occurrences for {file_path}")
        return False
    
    # Generate constant names and replacements
    existing_names = set()
    replacements: dict[str, str] = {}  # string_value -> constant_name
    
    for string_val, count in sorted(duplicates.items(), key=lambda x: -x[1]):
        prefix = classify_string(string_val)
        name = make_constant_name(prefix, string_val, existing_names)
        replacements[string_val] = name
    
    # Find insertion point (after imports, before first describe/it)
    # Look for the first describe( call at the top level (no leading whitespace/indentation)
    # OR after the last import statement, whichever is later
    insert_line = 0
    last_import_line = 0
    first_describe_line = 0
    
    for i, line in enumerate(lines):
        stripped = line.strip()
        # Track last import
        if stripped.startswith('import ') or stripped.startswith('import{') or stripped.startswith('import type') or stripped.startswith('importtype'):
            last_import_line = i + 1  # +1 to insert after this line
        # Track top-level function/const/interface declarations (but not inside blocks)
        if not line.startswith(' ') and not line.startswith('\t') and stripped:
            if stripped.startswith('describe(') or stripped.startswith('it(') or stripped.startswith('test('):
                if first_describe_line == 0:
                    first_describe_line = i
                break
    
    # Prefer after last import, but before first describe
    if last_import_line > 0:
        insert_line = last_import_line
    elif first_describe_line > 0:
        insert_line = first_describe_line
    else:
        insert_line = 50  # safety fallback
    
    # But don't insert inside a block - check that the line we're inserting after isn't inside braces
    # Count braces to ensure we're at the top level
    brace_count = 0
    for i in range(insert_line):
        line = lines[i]
        brace_count += line.count('{') - line.count('}')
    
    if brace_count > 0:
        # We're inside a block, find the next line where brace_count returns to 0
        for i in range(insert_line, len(lines)):
            line = lines[i]
            brace_count += line.count('{') - line.count('}')
            if brace_count <= 0:
                insert_line = i + 1
                break
    
    # Generate constant definitions
    constant_defs = []
    for string_val, const_name in sorted(replacements.items(), key=lambda x: x[1]):
        # Escape special characters in the value
        escaped_val = string_val.replace('\\', '\\\\').replace("'", "\\'")
        constant_defs.append(f"const {const_name} = '{escaped_val}'")
    
    # Also handle occurrences that need replacing
    # We need to replace ALL occurrences in the file, not just the flagged ones
    changes = 0
    
    # Build a replacement plan: (line_num, quote_start, quote_end, const_name)
    replace_ops = []
    for string_val, const_name in replacements.items():
        occurrences = find_all_occurrences([l + '\n' for l in lines], string_val)
        for (line_num, quote_start, content_start, content_end, quote_end) in occurrences:
            replace_ops.append((line_num, quote_start, quote_end, const_name))
    
    # Sort by line_num descending so we can replace from bottom to top
    replace_ops.sort(key=lambda x: (-x[0], -x[1]))
    
    # Apply replacements (line by line, from bottom to top)
    new_lines = list(lines)
    
    # Group by line number
    by_line = {}
    for op in replace_ops:
        ln = op[0]
        if ln not in by_line:
            by_line[ln] = []
        by_line[ln].append(op)
    
    for line_num in sorted(by_line.keys(), reverse=True):
        ops = by_line[line_num]
        line = new_lines[line_num - 1]
        
        # Build new line by replacing in reverse order (right to left within line)
        ops_sorted = sorted(ops, key=lambda x: -x[1])
        
        for _, quote_start, quote_end, const_name in ops_sorted:
            before = line[:quote_start - 1]
            after = line[quote_end - 1:]
            # Check if this is a JSX attribute (preceded by = without braces)
            # e.g., baseUrl="http://localhost" -> baseUrl={LABEL_HTTP_LOCALHOST}
            char_before = before.rstrip()
            if char_before and char_before[-1] == '=' and not char_before.endswith('{'):
                line = before + '{' + const_name + '}' + after
            else:
                line = before + const_name + after
            changes += 1
        
        new_lines[line_num - 1] = line
    
    # Insert constant definitions
    const_block = '\n'.join(constant_defs)
    new_lines.insert(insert_line, '\n// Duplicate-string constants extracted for sonarjs/no-duplicate-string\n' + const_block + '\n')
    
    # Write back
    new_content = '\n'.join(new_lines)
    
    with open(abs_path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    
    print(f"  Fixed {file_path}: {len(duplicates)} unique strings, {changes} replacements")
    for string_val, const_name in sorted(replacements.items(), key=lambda x: x[1]):
        print(f"    {const_name} = '{string_val[:60]}{'...' if len(string_val) > 60 else ''}' ({duplicates[string_val]}x)")
    
    return True


def main():
    files = sys.argv[1:] if len(sys.argv) > 1 else DEFAULT_FILES + SMALLER_FILES
    
    # Verify files exist
    existing_files = []
    for f in files:
        abs_path = os.path.join(PROJECT_DIR, f)
        if os.path.exists(abs_path):
            existing_files.append(f)
        else:
            print(f"Warning: {f} not found, skipping")
    
    print(f"Processing {len(existing_files)} files...")
    
    fixed_count = 0
    for file_path in existing_files:
        if fix_file(file_path):
            fixed_count += 1
    
    print(f"\nFixed {fixed_count} files.")


if __name__ == '__main__':
    main()

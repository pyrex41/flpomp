---
name: ralph-visualization
description: Add stream visualization TUI to an existing Ralph loop setup. Shows tool calls, text output, and git diffs in a clean terminal display.
argument-hint: [project-path]
allowed-tools: Write, Read, Bash, Glob
---

# Ralph Visualization

Add a stream display TUI to monitor Ralph loop iterations. This is an **optional layer** on top of the core Ralph setup.

## Prerequisites

- Existing Ralph loop setup (run `/ralph-setup` first)
- Claude Code harness (stream display requires `--output-format stream-json`)

## What This Adds

1. **`stream_display.py`** - TUI that renders streaming JSON as readable output
2. Updates `loop.sh` to pipe through the display (if not already configured)

## Features

- **Tool call display** - Color-coded tool names with key arguments
- **Text toggle** - Press `[v]` during streaming to show/hide assistant text
- **Git diff summary** - Shows files changed at end of iteration
- **Iteration stats** - Duration, tool count, changes

## Usage

After installation:

```bash
# Runs with display automatically
./loop.sh --build

# Disable display for raw output
./loop.sh --build --no-display

# Debug: dump raw JSON for inspection
./loop.sh --build --dump /tmp/stream.jsonl
```

## Installation

When invoked, this skill will:

1. Check that Ralph is already set up in the target directory
2. Copy `stream_display.py` to the project
3. Verify `loop.sh` has display piping configured

## Reference

See [references/stream-display.md](references/stream-display.md) for architecture details.

## Execution Steps

When this skill is invoked:

1. **Check for existing Ralph setup:**
   ```bash
   ls ralph.conf PROMPT_build.md loop.sh 2>/dev/null
   ```
   If not set up, tell user to run `/ralph-setup` first.

2. **Copy stream_display.py to project:**
   Read from this skill's directory and write to project root:
   - Source: `skills/visualization/stream_display.py`
   - Target: `$PROJECT/stream_display.py`

3. **Update loop.sh** to enable stream display:

   Add these variables near the top (after STOP_FILE):
   ```bash
   # Stream display (optional - requires Claude Code harness)
   DISPLAY_SCRIPT="${DISPLAY_SCRIPT:-stream_display.py}"
   DUMP_FILE="${DUMP_FILE:-}"
   ```

   Update the claude command in `build_command()` to include streaming flags:
   ```bash
   local cmd="cat '$prompt_file' | claude --output-format stream-json --verbose"
   ```

   Update the main loop's run section to pipe through display:
   ```bash
   if [[ -n "$DISPLAY_SCRIPT" && -f "$DISPLAY_SCRIPT" && "$HARNESS" == "claude" ]]; then
       DISPLAY_ARGS="--iteration $iteration --mode $MODE"
       [[ -n "$DUMP_FILE" ]] && DISPLAY_ARGS="$DISPLAY_ARGS --dump $DUMP_FILE"
       eval "$cmd" | python3 "$DISPLAY_SCRIPT" $DISPLAY_ARGS
   else
       eval "$cmd"
   fi
   ```

4. **Add CLI flags** to usage and argument parsing:
   - `--dump <file>` - Dump raw JSON for debugging
   - `--no-display` - Disable stream display

5. **Show usage instructions:**
   - Press `[v]` during streaming to toggle text visibility
   - Use `--dump /tmp/stream.jsonl` to debug parsing issues
   - Only works with Claude Code harness (`--output-format stream-json`)

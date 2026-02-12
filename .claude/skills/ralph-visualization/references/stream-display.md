# Stream Display Architecture

Raw CLI output in `--output-format stream-json` mode is JSON lines — not human-readable. The stream display sits between the CLI and the terminal as a stdin filter.

## Architecture

```bash
$CLI --output-format stream-json -p "$PROMPT" | python3 stream_display.py --iteration N --mode MODE
```

The display reads JSON lines from stdin and renders:
- Tool calls (always visible, color-coded by type)
- Agent text output (togglable with `[v]` key)
- Git status diff (before/after each iteration, shown in footer)
- Elapsed time and tool count

## Event Types

| Event | Action |
|-------|--------|
| `assistant` | Walk `message.content[]`, print `text` blocks, extract `tool_use` blocks |
| `content_block_start` | Begin accumulating tool input for streaming mode |
| `content_block_delta` | Print `text_delta`, accumulate `input_json_delta` for tools |
| `content_block_stop` | Parse accumulated tool JSON, print tool name + key arg |
| `tool_call` | Fallback for CLIs that send tool events separately |

## Deduplication

Per-block dedup tracks by `(message_id, content_index)`. When a new message ID appears, trackers reset. This prevents reprinting text when partial messages arrive (the CLI sends the full content array each time, growing incrementally).

## Tool Colors

| Color | Tools |
|-------|-------|
| Blue | Read, Glob, Grep, LS |
| Yellow | Edit, Write, NotebookEdit |
| Green | Bash |
| Magenta | Task |
| Cyan | WebFetch, WebSearch |

## The `[v]` Toggle

A background thread reads keypresses from `/dev/tty` via termios cbreak mode. Press `v` to collapse text — only tool calls remain visible, with a spinner status bar showing elapsed time and tool count. Press `v` again to expand. Falls back gracefully if `/dev/tty` is unavailable.

## Debugging

If tools show as `?` or text is missing, dump the raw JSON:

```bash
./loop.sh --build --dump /tmp/stream.jsonl
cat /tmp/stream.jsonl | python3 -m json.tool | less
```

## Writing Your Own

The included `stream_display.py` is ~480 lines. A minimal display needs:

1. Read lines from stdin
2. Parse each line as JSON
3. Handle `assistant` events: walk `message.content[]`, print `text` blocks, extract `tool_use` blocks
4. Handle `content_block_delta`: print `text_delta`, accumulate `input_json_delta`
5. Handle `content_block_stop`: parse accumulated tool JSON, print tool name + key arg

That's ~80 lines in any language. Colors, spinners, toggle, git snapshots, and dedup are polish.

Key point: **pipe `--output-format stream-json` into your display**. Do not parse terminal escape codes from the CLI's normal output.

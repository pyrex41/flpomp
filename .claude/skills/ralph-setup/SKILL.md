---
name: ralph-setup
description: Interactively set up the Ralph Wiggum autonomous development workflow for a project. Use when initializing Ralph loops, configuring harness/model/permissions, or scaffolding backpressure for autonomous AI development.
argument-hint: [project-path]
allowed-tools: AskUserQuestion, Write, Bash, Read, Glob, Grep
---

# Ralph Wiggum Interactive Setup

You are setting up the Ralph Wiggum autonomous development loop for a project. Interview the user to configure everything, then generate the files.

## Interview Flow

Use AskUserQuestion to walk through each step. Ask one question at a time. Use the answers to generate all configuration files at the end.

### Step 1: AI Harness

Ask which AI coding CLI they'll use:
- **Claude Code** (recommended) - `cat PROMPT.md | claude --allowedTools '...'`
- **Cursor CLI** - `agent -p --force "$(cat PROMPT.md)"`
- **OpenCode** - `opencode --model MODEL --prompt-file PROMPT.md`
- **Codex CLI** - `codex --model MODEL --approval-mode auto-edit PROMPT.md`
- **Custom** - Any CLI that accepts a prompt file

If they pick OpenCode or Codex, ask which model. If custom, ask for the command template (use `{PROMPT_FILE}` as placeholder).

For detailed harness configuration and comparison, see [references/harnesses.md](references/harnesses.md).

### Step 2: Permission Model

Ask about their comfort level with autonomous permissions:
- **Guarded** - Separate plan/build permissions. Plan mode: read-only. Build mode: Edit, Write, Bash only.
- **Subtasks enabled** - Same as guarded, but adds Task tool in build mode for parallel subagent execution
- **Full auto** - Skip all permission prompts (`--dangerously-skip-permissions` / `--approval-mode full-auto`)

### Step 3: Backpressure / Validation

Ask what language/framework the project uses. Then ask for their specific commands:
- **Build command** (e.g., `npm run build`, `cargo build`, `go build ./...`)
- **Test command** (e.g., `npm run test`, `cargo test`, `pytest`)
- **Lint command** (e.g., `npm run lint`, `cargo clippy -- -D warnings`, `ruff check .`)
- **Type check command** if applicable (e.g., `tsc --noEmit`, `mypy .`)
- **Full check command** - combined command that runs all of the above

If they're unsure, suggest defaults from [references/backpressure.md](references/backpressure.md) based on their language.

### Step 4: Project Conventions

Ask about:
- Brief project description (one sentence)
- Source directory layout (e.g., `src/`, `lib/`, `pkg/`)
- Test file conventions (e.g., `*.test.ts` next to source, `tests/` directory)
- Any guardrails - files Ralph must never touch, patterns to avoid

### Step 5: Subagent Limits

Ask how aggressively to parallelize:
- **Conservative** - Up to 10 search subagents, 2 implementation, 1 validation
- **Standard** - Up to 50 search, 5 implementation, 1 validation
- **Aggressive** - Up to 200 search, 10 implementation, 1 validation

Validation is always 1 subagent (serialized backpressure).

## File Generation

After the interview, generate all files in the project directory ($ARGUMENTS or current directory):

### Files to generate:

1. **`ralph.conf`** - Configuration from Steps 1-2
2. **`loop.sh`** - Outer loop script (from [templates/loop.sh](templates/loop.sh))
3. **`PROMPT_plan.md`** - Planning prompt (from [templates/PROMPT_plan.md](templates/PROMPT_plan.md), with subagent limits from Step 5)
4. **`PROMPT_build.md`** - Building prompt (from [templates/PROMPT_build.md](templates/PROMPT_build.md), with subagent limits from Step 5)
5. **`AGENTS.md`** - Populated with answers from Steps 3-4 (use [templates/AGENTS.md](templates/AGENTS.md) as base)
6. **`specs/`** directory (create empty, with a note to add JTBD specs)

Read each template file, customize it with the user's answers, and write the result.

### Customization rules:

- **AGENTS.md**: Fill in all `[placeholder]` sections with real values from the interview
- **PROMPT_plan.md**: Update subagent limits to match Step 5 answers. Must include "Stopping the Loop" section with `.stop` file instructions.
- **PROMPT_build.md**: Update subagent limits and validation commands to match answers. Must include "Stopping the Loop" section with `.stop` file instructions.
- **ralph.conf**: Set HARNESS, MODEL, ALLOW_SUBTASKS from Steps 1-2
- **loop.sh**: Copy from template as-is (it reads ralph.conf at runtime)

## After Generation

Show the user:
1. Summary of what was generated
2. How to run: `./loop.sh --plan` then `./loop.sh --build`
3. Remind them to write JTBD specs in `specs/*.md` (link to [references/specs.md](references/specs.md) format)
4. Explain the stop file: the agent writes `.stop` when the task queue is empty, and the loop stops cleanly
5. Mention: run `/ralph-visualization` to add a stream display TUI for monitoring (Claude Code only)

## Reference Files

- [references/harnesses.md](references/harnesses.md) - AI CLI comparison and configuration
- [references/backpressure.md](references/backpressure.md) - Language-specific backpressure patterns
- [references/specs.md](references/specs.md) - Writing JTBD specifications
- [references/subagents.md](references/subagents.md) - Subagent patterns and scaling

## Architecture Context (for your reference, don't dump on user)

Ralph uses an outer bash loop that runs the AI agent repeatedly with fresh context. Each iteration reads PROMPT.md + AGENTS.md + specs/*, picks a task from IMPLEMENTATION_PLAN.md, implements it, validates via backpressure (tests/build/lint), updates the plan, commits, and exits. The plan file is persistent shared state between isolated executions.

The loop has two hard stop conditions that always apply:
1. **Max iterations** (always enforced) — a hard cap so the loop never runs forever
2. **Stop file** (`.stop`) — the agent writes this file when nothing is left to do. The loop checks before each iteration, reads contents as a reason, logs it, deletes it, and breaks. Also cleaned up on startup so stale files don't block fresh runs.

Every prompt must include a "Stopping the Loop" section that tells the agent exactly when to write `.stop`. Without this, the loop restarts iterations that immediately exit — burning API calls.

Key phrases to embed in generated prompts: "study" (not read), "don't assume not implemented", "up to N parallel subagents", "Ultrathink", "capture the why", "keep it up to date".

Plan mode is read-only analysis. Build mode modifies code. Validation always uses exactly 1 subagent for serialized backpressure.

Optional: `/ralph-visualization` adds a stream display TUI for Claude Code harness.

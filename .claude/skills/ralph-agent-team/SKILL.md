---
name: agent-team
description: Set up parallel autonomous agent infrastructure for test-driven development. Multiple Claude instances coordinate via git to solve complex implementation tasks. Based on Anthropic's C compiler methodology.
argument-hint: [project-path]
allowed-tools: AskUserQuestion, Write, Bash, Read, Glob, Grep
---

# Agent Team Setup

> **Source**: [Building a C Compiler with Claude](https://www.anthropic.com/engineering/building-c-compiler) by Nicholas Carlini at Anthropic. This skill implements the methodology from that project where 16 parallel Claude instances built a 100,000-line Rust C compiler.

Set up infrastructure for running multiple parallel Claude agents that coordinate via git to implement complex projects. This is test-driven autonomous development - tests define success, agents figure out how to get there.

## When to Use This vs Ralph

| Use Agent Team When | Use Ralph When |
|---------------------|----------------|
| Large implementation with many independent tasks | Single coherent feature |
| Test suite already exists or can drive work | Requirements need discovery/planning |
| Want parallel progress across codebase | Sequential task-by-task progress |
| Building something with verifiable correctness | Building something with subjective quality |

## Core Philosophy

From Anthropic's C compiler project:

> "Claude will work autonomously to solve whatever problem I give it. So it's important that the task verifier is nearly perfect, otherwise Claude will solve the wrong problem."

**Key insight**: Don't write detailed instructions. Write perfect tests. The agent figures out the rest.

## Interview Flow

### Step 1: Project Type

Ask what kind of project:
- **Compiler/Interpreter** - Language implementation with test suites
- **Library/Framework** - Code with comprehensive unit tests
- **System/Infrastructure** - Something with integration tests
- **Migration/Port** - Porting existing code to new target
- **Other** - Custom verifiable task

### Step 2: Test Harness

This is the most important step. Ask about their test infrastructure:
- What command runs tests?
- How many tests exist?
- Do tests output consistent patterns? (e.g., `ERROR: reason`, `PASS`, `FAIL`)
- Can tests run in isolation? (important for parallelism)
- Is there a "known good" reference implementation? (for oracle pattern)

If they don't have good tests, **stop here** - agent team won't work without them.

### Step 3: Parallelism Strategy

Ask how many agents to run:
- **2-4 agents** - Small project, limited tasks
- **8-16 agents** - Large project, many independent tasks
- **Custom** - Specific number

Ask about isolation:
- **Docker containers** (recommended) - Full isolation, safe for `--dangerously-skip-permissions`
- **Git worktrees** - Lighter weight, same machine
- **Separate machines** - Distributed team

### Step 4: Agent Specialization

Ask what specialized roles they want:
- **Core Implementation** - Main development work (always needed)
- **Test Fixer** - Focus on failing tests
- **Deduplication** - Find and consolidate redundant code
- **Optimization** - Performance improvements
- **Documentation** - READMEs, progress tracking
- **Architecture Review** - Refactoring for better design
- **Custom** - Define their own role

### Step 5: Coordination Pattern

Ask about task discovery:
- **Test-based** - Each failing test is a task (recommended)
- **File-based** - Each file needing work is a task
- **Directory-based** - Each module/directory is a task
- **Custom** - Define task discovery command

## File Generation

Generate these files in the project directory:

### 1. `agent_loop.sh` - The core autonomous loop

```bash
#!/bin/bash
# Agent Team - Autonomous Loop
# Run one instance per agent, each in isolated environment

set -e

AGENT_ID="${AGENT_ID:-$(hostname)-$$}"
UPSTREAM="${UPSTREAM:-origin}"
BRANCH="${BRANCH:-main}"
LOG_DIR="${LOG_DIR:-agent_logs}"

mkdir -p "$LOG_DIR"

echo "Agent $AGENT_ID starting..."

while true; do
    COMMIT=$(git rev-parse --short=6 HEAD)
    LOGFILE="$LOG_DIR/agent_${AGENT_ID}_${COMMIT}_$(date +%s).log"

    # Sync with upstream
    git fetch "$UPSTREAM"
    git merge "$UPSTREAM/$BRANCH" --no-edit 2>/dev/null || git merge --abort 2>/dev/null || true

    # Run agent
    claude --dangerously-skip-permissions \
           -p "$(cat AGENT_PROMPT.md)" \
           --model claude-sonnet-4-5-20250929 \
           &> "$LOGFILE"

    # Push changes
    git push "$UPSTREAM" "$BRANCH" 2>/dev/null || true

    echo "Iteration complete. Log: $LOGFILE"
    sleep 5
done
```

### 2. `AGENT_PROMPT.md` - What the agent sees each iteration

```markdown
# Agent Task

You are one of several parallel agents working on this project. Your job: make tests pass.

## Workflow

1. **Check current state**: Run the test harness to see what's failing
2. **Claim a task**: Create a lock file in `current_tasks/` for what you'll work on
3. **Implement**: Fix the failing test(s) you claimed
4. **Verify**: Run tests to confirm your fix works
5. **Commit & exit**: Push your changes and exit cleanly

## Rules

- Only work on tasks you've locked (check `current_tasks/` first)
- If you can't lock a task (file exists), pick a different one
- Keep changes focused - one logical fix per iteration
- Always run tests before committing
- If tests pass, look for optimization or cleanup opportunities
- Exit after each meaningful commit for context refresh

## Locking Protocol

To claim task "foo":
```bash
echo "$HOSTNAME-$$" > current_tasks/foo.lock
git add current_tasks/foo.lock
git commit -m "Lock: foo"
git push
```

If push fails (someone else claimed it), pick a different task.

To release:
```bash
rm current_tasks/foo.lock
git add -A && git commit -m "Release: foo" && git push
```

## Test Commands

[FILL IN: Project-specific test commands]

## Progress Tracking

Update `PROGRESS.md` with:
- What you fixed
- Current test pass rate
- Any blockers discovered
```

### 3. `PROGRESS.md` - Shared state for all agents

```markdown
# Progress Tracker

Updated by agents after each iteration.

## Current Status

- **Tests Passing**: 0 / ???
- **Last Updated**: [timestamp]
- **Active Agents**: See `current_tasks/`

## Recent Fixes

<!-- Agents append here -->

## Known Blockers

<!-- Issues that need human attention -->

## Architecture Notes

<!-- Agents document design decisions here -->
```

### 4. `current_tasks/.gitkeep` - Task lock directory

### 5. `test_harness.sh` - Wrapper for consistent test output

```bash
#!/bin/bash
# Test harness wrapper - produces consistent output for agents

FAST_MODE="${FAST_MODE:-false}"
SAMPLE_RATE="${SAMPLE_RATE:-10}"  # percent

run_tests() {
    # [FILL IN: Actual test command]
    echo "Running tests..."
}

if [ "$FAST_MODE" = "true" ]; then
    # Probabilistic sampling - run random subset
    # Different agents get different subsets but deterministic per-agent
    SEED="${AGENT_ID:-$$}"
    echo "Fast mode: sampling $SAMPLE_RATE% of tests (seed: $SEED)"
    # [FILL IN: Sampling logic]
fi

run_tests 2>&1 | while read line; do
    # Normalize output for agent parsing
    if echo "$line" | grep -qi "error\|fail"; then
        echo "ERROR: $line"
    elif echo "$line" | grep -qi "pass\|ok\|success"; then
        echo "PASS: $line"
    else
        echo "$line"
    fi
done

# Summary at end
echo "---"
echo "SUMMARY: [FILL IN: pass/fail counts]"
```

### 6. `docker-compose.yml` (if using Docker isolation)

```yaml
version: '3.8'

services:
  agent:
    build: .
    environment:
      - AGENT_ID=${AGENT_ID}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
    volumes:
      - ./:/workspace
      - upstream:/upstream
    working_dir: /workspace
    deploy:
      replicas: ${NUM_AGENTS:-4}

volumes:
  upstream:
```

### 7. `Dockerfile` (if using Docker isolation)

```dockerfile
FROM ubuntu:22.04

RUN apt-get update && apt-get install -y \
    git curl build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code
RUN curl -fsSL https://claude.ai/install.sh | bash

# [FILL IN: Project-specific dependencies]

WORKDIR /workspace
CMD ["./agent_loop.sh"]
```

## Customization Rules

- **AGENT_PROMPT.md**: Fill in test commands, adjust locking protocol if needed
- **test_harness.sh**: Implement actual test running and output normalization
- **docker-compose.yml**: Adjust replicas, add project dependencies
- Ensure test output uses consistent patterns (ERROR/PASS/FAIL)

## After Generation

Show the user:

1. **Files generated** and what each does
2. **How to start**:
   - Single agent: `./agent_loop.sh`
   - Multiple local: `for i in {1..4}; do AGENT_ID="agent-$i" ./agent_loop.sh & done`
   - Docker: `NUM_AGENTS=8 docker-compose up --scale agent=8`
3. **Critical reminders**:
   - Test harness must be "nearly perfect" - agents solve whatever tests define
   - Watch `PROGRESS.md` for status
   - Check `current_tasks/` for active work
   - Review `agent_logs/` for debugging
4. **Oracle pattern** (for monolithic tasks): If all agents hit same bug, implement probabilistic delegation to known-good reference

## Architecture Notes

### Why This Works

1. **Tests as specification** - No ambiguity about success criteria
2. **Git as coordination** - Conflict resolution handles race conditions
3. **Fresh context per iteration** - Prevents compounding errors
4. **Specialized roles** - Different perspectives on same codebase

### Key Patterns from Anthropic's Compiler Project

**Time Blindness Compensation**:
> "Claude can't tell time and, left alone, will happily spend hours running tests instead of making progress."

Solution: `--fast` flag with probabilistic sampling.

**Oracle Pattern**:
> When all agents hit same monolithic bug, randomly delegate most work to known-good implementation, isolate failures to specific components.

**Documentation as Orientation**:
> "Each container spawn placed agents in fresh containers with no context."

Extensive READMEs and progress files provide navigation without consuming context.

## References

- [Building a C Compiler with Claude](https://www.anthropic.com/engineering/building-c-compiler) - Original methodology
- Compare with `/ralph-setup` for single-agent spec-driven development

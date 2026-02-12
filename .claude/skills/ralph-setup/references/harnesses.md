# AI Harnesses for Ralph

Ralph works with multiple AI coding CLIs. Choose based on your needs.

## Claude Code (Recommended)

Anthropic's official CLI for Claude.

```bash
# Install
npm install -g @anthropic-ai/claude-code

# Usage
./loop.sh --harness claude --plan
./loop.sh --harness claude --build --allow-subtasks
```

**Pros:**
- Best agentic capabilities
- Native subagent support (Task tool)
- Fine-grained tool permissions
- Extended thinking (Ultrathink)

**Tool permissions by mode:**

| Mode | Allowed Tools |
|------|---------------|
| Plan | Read, Glob, Grep, Task, WebFetch, WebSearch |
| Build | Edit, Write, Bash, Read, Glob, Grep |
| Build + subtasks | Edit, Write, Bash, Read, Glob, Grep, Task |
| Dangerous | All tools, no prompts |

---

## Cursor CLI (Headless)

Cursor's headless agent for scripting and automation.

```bash
# Install
curl https://cursor.com/install -fsSL | bash

# Set API key
export CURSOR_API_KEY=your_api_key_here

# Usage
./loop.sh --harness cursor --plan
./loop.sh --harness cursor --build
```

**Pros:**
- Headless/scriptable mode for automation
- Print mode (`-p`) for non-interactive use
- JSON and streaming output formats
- File modification with `--force` flag

**Cons:**
- No native subagent support
- Requires API key for headless mode
- Less granular tool permissions than Claude Code

**Modes:**
- `agent -p "prompt"` - Print mode, read-only analysis
- `agent -p --force "prompt"` - Print mode with file modifications enabled

---

## OpenCode

Multi-model agentic coding CLI.

```bash
# Install
pip install opencode

# Usage
./loop.sh --harness opencode --model gpt-4-turbo
./loop.sh --harness opencode --model claude-3-opus
```

**Available models:**
- OpenAI: `gpt-4`, `gpt-4-turbo`, `gpt-4o`
- Anthropic: `claude-3-opus`, `claude-3-sonnet`, `claude-3-haiku`
- Google: `gemini-pro`, `gemini-ultra`

**Pros:**
- Model flexibility
- Works with multiple providers
- Good for A/B testing models

**Cons:**
- Less sophisticated permission system
- No native subagent support

---

## Codex CLI

OpenAI's coding agent CLI.

```bash
# Install
npm install -g @openai/codex

# Usage
./loop.sh --harness codex --model o1
./loop.sh --harness codex --model o1-mini
```

**Available models:**
- `o1` - Full reasoning model (slower, more thorough)
- `o1-mini` - Faster reasoning model
- `gpt-4`, `gpt-4-turbo`

**Approval modes:**
- `suggest` - Show changes, require approval (plan mode)
- `auto-edit` - Auto-approve file edits (build mode)
- `full-auto` - Auto-approve everything (dangerous mode)

**Pros:**
- Good reasoning with o1 models
- Native sandbox support

**Cons:**
- No subagent support
- Slower with o1

---

## Custom Harness

Use any CLI that accepts a prompt file.

```bash
# In ralph.conf:
HARNESS="custom"
CUSTOM_CMD="my-agent run --file {PROMPT_FILE} --auto-approve"

# Usage
./loop.sh
```

**Requirements:**
- Must accept prompt via file or stdin
- Must exit with code 0 on success
- Must modify files in working directory
- Should support git operations

**Example custom commands:**

```bash
# Aider
CUSTOM_CMD="aider --file {PROMPT_FILE} --yes"

# Continue
CUSTOM_CMD="continue --prompt-file {PROMPT_FILE}"

# Custom wrapper
CUSTOM_CMD="./my-wrapper.sh {PROMPT_FILE}"
```

---

## Comparison Matrix

| Feature | Claude Code | Cursor CLI | OpenCode | Codex | Custom |
|---------|-------------|------------|----------|-------|--------|
| Subagents | Yes (Task) | No | No | No | Depends |
| Tool permissions | Fine-grained | Basic (--force) | Basic | Approval modes | Depends |
| Extended thinking | Yes | No | No | o1 only | Depends |
| Model flexibility | Claude only | Multi-model | Multi-model | OpenAI only | Any |
| Sandbox support | Yes | No | Basic | Yes | Depends |
| Headless/scripting | Yes | Yes (native) | Basic | Basic | Depends |

## Recommendation

1. **Start with Claude Code** - Best agentic capabilities
2. **Try Cursor CLI** for headless automation and scripting workflows
3. **Try OpenCode with GPT-4** if you need different models
4. **Use Codex with o1** for complex reasoning tasks
5. **Custom** for specialized setups or proprietary tools

## Configuration

All harnesses are configured via `ralph.conf`:

```bash
HARNESS="claude"           # Which CLI
MODEL="gpt-4"              # Model (if needed)
CUSTOM_CMD=""              # Custom command template
ALLOW_SUBTASKS=true        # Enable Task tool (Claude only)
```

Or via command line:

```bash
./loop.sh --harness opencode --model gpt-4
./loop.sh --harness claude --allow-subtasks
```

# Pomelli → X Automation Flywheel

A self-hosted automation service that takes a raw marketing idea, feeds it through Google Pomelli to generate on-brand social media assets (images + captions), then posts the finished content to X (Twitter) — either automatically or with human-in-the-loop approval.

**The Flywheel:** `Idea → Pomelli (brand-aware asset generation) → Review/Approve → Post on X`

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun |
| Language | TypeScript (strict mode) |
| Backend | Hono |
| Frontend | HTMX + Pico CSS (server-rendered, no JS framework) |
| Database | SQLite (bun:sqlite) |
| Browser Automation | Playwright (headless Chromium) |
| Social Media | X API v2 (twitter-api-v2, OAuth 1.0a) |
| Scheduling | croner |
| Image Processing | Sharp |
| Linting | Biome |
| Testing | Vitest |
| Deployment | Fly.io (Docker) |

## Quick Start

```bash
# Install dependencies
bun install

# Copy env file and fill in your X API credentials
cp .env.example .env

# Start dev server (with hot reload)
bun run dev

# Run full validation (typecheck + lint + test)
bun run check
```

The server starts at `http://localhost:8080`. On first run, SQLite tables are created automatically.

## Project Structure

```
src/
├── server.ts              # Hono app entry point, middleware, static files
├── config.ts              # Centralized env var access
├── db.ts                  # SQLite schema, migrations, queries
├── routes/
│   ├── api.ts             # JSON API (queue CRUD, settings, auth status)
│   └── pages.tsx          # Server-rendered HTML pages (HTMX)
├── services/
│   ├── flywheel.ts        # Orchestration: Idea → Pomelli → Queue → X
│   ├── pomelli.ts         # Playwright browser automation for Pomelli
│   ├── twitter.ts         # X API posting + media upload
│   ├── scheduler.ts       # Cron-based scheduled posting
│   └── image.ts           # Image validation + resize
└── views/
    ├── layout.tsx          # Base HTML layout (HTMX + Pico CSS)
    ├── components/         # Reusable HTMX partials
    └── pages/              # Dashboard, Queue, History, Settings, Error
tests/
└── *.test.ts              # 274 tests across 12 test files
```

## API Endpoints

```
POST   /api/ideas              Submit a new idea to the flywheel
GET    /api/queue               List posts pending review
POST   /api/queue/:id/approve   Approve and post (or schedule)
POST   /api/queue/:id/edit      Update caption before posting
DELETE /api/queue/:id            Reject/delete a queued post
GET    /api/history              List posted content
GET    /api/usage                X API usage stats (monthly)
POST   /api/settings             Update config (website URL, etc.)
GET    /api/auth/status          Check Pomelli session health
POST   /api/auth/pomelli         Import Google cookies for Pomelli
```

## Dashboard Pages

- **New Post** (`/`) — Submit a marketing idea, optional scheduling
- **Queue** (`/queue`) — Review Pomelli-generated assets, approve/edit/reject
- **History** (`/history`) — Posted content with tweet links
- **Settings** (`/settings`) — Website URL for Business DNA, session status

## Environment Variables

```env
# Required: X (Twitter) API
X_API_KEY=
X_API_SECRET=
X_ACCESS_TOKEN=
X_ACCESS_TOKEN_SECRET=

# Required: Your website for Pomelli Business DNA
WEBSITE_URL=https://yoursite.com

# Optional
PORT=8080
DATA_DIR=./data
ADMIN_PASSWORD=          # Enables basic auth on all routes
```

## Deploy to Fly.io

```bash
fly launch
fly volumes create pomelli_data --region ord --size 1
fly secrets set X_API_KEY=... X_API_SECRET=... X_ACCESS_TOKEN=... X_ACCESS_TOKEN_SECRET=... WEBSITE_URL=... ADMIN_PASSWORD=...
fly deploy
```

The persistent volume at `/data` stores the SQLite database, Playwright browser state (Google login session), and downloaded Pomelli images.

## Scripts

| Command | What it does |
|---------|-------------|
| `bun run dev` | Start dev server with hot reload |
| `bun run start` | Start production server |
| `bun run test` | Run 274 tests via Vitest |
| `bun run lint` | Lint with Biome |
| `bun run lint:fix` | Auto-fix lint issues |
| `bun run check` | Full validation: typecheck + lint + test |

## Codebase Stats

| Metric | Count |
|--------|-------|
| Source files | 18 |
| Test files | 12 |
| Source lines | ~3,900 |
| Test lines | ~4,300 |
| Total tests | 274 |
| Dependencies | 5 runtime, 3 dev |

---

## How This Was Built

This entire codebase was built autonomously in a single session using the **Ralph Wiggum** autonomous development loop — an outer bash script that runs an AI coding agent (Cursor Agent CLI with Opus 4.6) in a loop, giving it fresh context each iteration.

### The Process

1. **PRD written** — A detailed product requirements document describing the full architecture, API, database schema, and deployment strategy.

2. **Ralph setup** — The Ralph loop was configured with:
   - **Harness:** Cursor Agent CLI (`cursor-agent -p --model opus-4.6-thinking`)
   - **Permissions:** Full auto (no approval prompts)
   - **Backpressure:** `bun run check` (typecheck + lint + test) required to pass before every commit

3. **Specs generated** — 7 JTBD (Jobs to Be Done) specification files were written from the PRD, one per topic: project scaffolding, X posting, Pomelli automation, queue management, dashboard UI, auth/session, and scheduling.

4. **Planning pass** — `./loop.sh --plan` analyzed all specs and generated `IMPLEMENTATION_PLAN.md` with 13 prioritized tasks, dependency ordering, and spec cross-references.

5. **Build pass** — `./loop.sh --build` executed 13 iterations. Each iteration:
   - Read the implementation plan
   - Picked the next `[CURRENT]` task
   - Studied the relevant specs and existing code
   - Implemented the task completely (no stubs, no TODOs)
   - Ran `bun run check` (backpressure — typecheck, lint, test must all pass)
   - Updated the plan, committed, and exited for context refresh

6. **Loop stopped** — The agent wrote a `.stop` file when the task backlog was empty. The loop exited cleanly.

### Development Timeline

All 13 tasks completed in **1 hour 18 minutes** on February 12, 2026:

| Time | Task | Duration |
|------|------|----------|
| 3:18 PM | Task 1: Project scaffolding (Bun + Hono + TypeScript + SQLite) | — |
| 3:22 PM | Task 2: X posting service (twitter.ts, 25 tests) | 4m 42s |
| 3:27 PM | Task 3: Queue management API (api.ts, 8 endpoints, 39 tests) | 4m 13s |
| 3:38 PM | Task 4: Pomelli browser automation (pomelli.ts, 1,035 lines, 24 tests) | 11m 14s |
| 3:44 PM | Task 5: Auth/session management (cookie import, health check, 27 tests) | 6m 10s |
| 3:51 PM | Task 6: Dashboard — Layout + New Post page (25 tests) | 6m 35s |
| 3:59 PM | Task 7: Queue page with approve/edit/reject (38 tests) | 8m 24s |
| 4:04 PM | Task 8: History + Settings pages (30 tests) | 5m 06s |
| 4:14 PM | Task 9: End-to-end integration + flywheel orchestration (15 tests) | 9m 32s |
| 4:19 PM | Task 10: Scheduled posting with croner (19 tests) | 5m 48s |
| 4:23 PM | Task 11: Basic auth middleware (23 tests) | 3m 35s |
| 4:25 PM | Task 12: Dockerfile + Fly.io config | 2m 11s |
| 4:36 PM | Task 13: Error handling, resilience, polish (28 tests) | 10m 24s |
| | **Total** | **1h 18m** |

Each iteration ran with completely fresh context — no conversation history carried over between tasks. The `IMPLEMENTATION_PLAN.md` file served as the only shared state, updated after each task to track progress and signal what to build next.

### Ralph Loop Architecture

```
┌─────────────────────────────────────────────────┐
│                  loop.sh                         │
│                                                  │
│  while tasks remain:                             │
│    1. Check for .stop file                       │
│    2. Run: cursor-agent -p --force               │
│       └─ Agent reads PROMPT_build.md             │
│          └─ Reads IMPLEMENTATION_PLAN.md          │
│             └─ Picks [CURRENT] task              │
│                └─ Implements it                   │
│                   └─ Runs bun run check          │
│                      └─ Updates plan             │
│                         └─ Commits + exits       │
│    3. Sleep 5s, repeat                           │
│                                                  │
│  Stop conditions:                                │
│    - Agent writes .stop (backlog empty)          │
│    - Max iterations reached (100)                │
│    - Ctrl-C                                      │
└─────────────────────────────────────────────────┘
```

The key insight is **backpressure**: every commit must pass `bun run check` (TypeScript compilation + Biome linting + 274 Vitest tests). If validation fails, the agent fixes the issue before committing. This ensures each iteration leaves the codebase in a working state for the next one.

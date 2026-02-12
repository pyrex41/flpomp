# AGENTS.md - Project Operations Guide

## Project Overview

Self-hosted automation service: takes a marketing idea, feeds it through Google Pomelli to generate branded social media assets (images + captions), then posts to X (Twitter) with optional human-in-the-loop approval.

## Tech Stack

- Runtime: Bun
- Language: TypeScript
- Backend: Hono
- Frontend: HTMX + Hono JSX templates (server-rendered)
- Database: SQLite (bun:sqlite)
- Browser automation: Playwright (headless Chromium)
- API: X API v2 (twitter-api-v2)
- Deployment: Fly.io (Docker)

## Directory Structure

```
src/
├── server.ts          # Entry point, Hono app, middleware
├── routes/
│   ├── pages.tsx      # HTML page routes (dashboard, queue, history, settings)
│   └── api.ts         # JSON API routes
├── views/
│   ├── layout.tsx     # Base HTML layout with HTMX
│   ├── components/    # Reusable HTMX partials
│   └── pages/         # Full page templates
├── services/
│   ├── pomelli.ts     # Playwright automation for Pomelli
│   ├── twitter.ts     # X API posting service
│   └── scheduler.ts   # Cron-based scheduled posting
├── db.ts              # SQLite schema, migrations, queries
└── config.ts          # Environment variables, constants
tests/
└── *.test.ts          # Vitest test files (mirror src/ structure)
```

## Validation Commands

- **Build**: `bunx tsc --noEmit`
- **Test**: `bun run test`
- **Lint**: `bun run lint`
- **Type check**: `bunx tsc --noEmit`
- **Full check**: `bun run check`

Run full check before every commit. All must pass.

## Conventions

### Code Style
- Use Hono JSX for server-rendered HTML templates
- HTMX attributes for interactivity (hx-get, hx-post, hx-swap, hx-target)
- Keep routes thin — business logic goes in services/
- Use bun:sqlite for database access (no ORM needed for this scope)

### Patterns
- Error handling: Hono's built-in error middleware + try/catch in services
- Config: All env vars accessed through config.ts, never directly
- Playwright: All selectors in a dedicated selectors object within pomelli.ts
- Logging: Console-based with prefixes (e.g., `[pomelli]`, `[twitter]`, `[cron]`)

### Testing
- Test files: `tests/*.test.ts` mirroring src/ structure
- Use vitest with bun
- Integration tests for API routes
- Unit tests for services
- Mock Playwright and X API in tests

## Subagent Guidelines

- Search/analysis: up to 50 parallel Sonnet subagents
- Implementation: up to 5 parallel Sonnet subagents, partition by file
- Validation: exactly 1 Sonnet subagent, sequential steps
- Architecture/debugging: Opus subagent as needed

Never parallelize test execution.

## Environment

- Required env vars: `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET`, `WEBSITE_URL`
- Optional: `PORT` (default 8080), `DATA_DIR` (default /data), `ADMIN_PASSWORD`
- Local setup: `bun install && bun run dev`

## Guardrails

- Never commit .env files
- Always validate image size < 5MB before X API upload
- Rate limit Pomelli automation: 2-5 second delays between actions
- Caption length must be ≤ 280 characters for X posts

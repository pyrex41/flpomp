# Implementation Plan

Generated: 2026-02-12
Last Updated: 2026-02-12

## Summary

Greenfield project — no source code exists yet. The project is a self-hosted automation service ("Pomelli → X Flywheel") that takes marketing ideas, feeds them through Google Pomelli (via Playwright browser automation) to generate branded social media assets, then posts to X (Twitter) with optional human-in-the-loop approval.

Requirements are captured in 7 specs (`specs/*.md`) covering project scaffolding, X posting, queue management, Pomelli automation, the web dashboard, auth/session management, and scheduled posting. The PRD (`prd.md`) and `AGENTS.md` provide architecture, deployment, and convention guidance.

Build order follows the PRD's recommended MVP sequence: scaffolding → X posting → API/DB → Pomelli automation → dashboard UI → integration → deployment → polish.

## Completed

- [x] Task 1: Project scaffolding — Bun + Hono + TypeScript + HTMX + SQLite setup (completed 2026-02-12)
- [x] Task 2: X (Twitter) posting service — `src/services/twitter.ts` with image upload, tweet posting, validation, usage tracking, and 25 unit tests (completed 2026-02-12)
- [x] Task 3: Queue management API routes — `src/routes/api.ts` with 8 endpoints (ideas, queue, approve, edit, reject, history, settings GET/POST), wired into server.ts, 39 integration tests (completed 2026-02-12)
- [x] Task 4: Pomelli browser automation service — `src/services/pomelli.ts` with PommelliService class, SELECTORS object, persistent browser context, session check, Business DNA creation, campaign generation, image download, caption extraction, DB integration, concurrency lock, debug screenshots, human-mimicking delays, and 24 unit tests (completed 2026-02-12)
- [x] Task 5: Pomelli auth/session management — `importCookies()` method on PommelliService (validates, filters Google cookies, injects into Playwright context), `getAuthStatus()` with 10s timeout, `GET /api/auth/status` and `POST /api/auth/pomelli` API routes, `normalizeSameSite` helper, 27 tests in `tests/auth.test.ts` (completed 2026-02-12)
- [x] Task 6: Web dashboard — Layout and New Post page — `src/views/pages/dashboard.tsx` (NewPostPage, IdeaSubmitResult, IdeaSubmitError, RecentPostsList components), `src/routes/pages.tsx` (HTMX form handler POST /submit-idea, polling partial GET /partials/recent, stub pages for /queue, /history, /settings), enhanced `src/views/layout.tsx` (HTMX indicator styles, status badges, post card styles, Pico CSS + HTMX CDN), improved `getAllPosts` ordering (id DESC tiebreaker), 25 tests in `tests/pages.test.ts` (completed 2026-02-12)
- [x] Task 7: Web dashboard — Queue page — `src/views/components/post-card.tsx` (PostCard with Approve/Edit/Reject buttons, PostCardEditForm with inline caption editing), `src/views/pages/queue.tsx` (QueuePage, QueueList), updated `src/routes/pages.tsx` (GET /queue full page, POST approve/reject/edit HTMX actions, GET /partials/queue-card/:id and /edit endpoints, GET /partials/queue list partial), queue card CSS transitions in layout.tsx, 38 new tests covering queue listing, approve, reject, edit with validation, card partials (completed 2026-02-12)
- [x] Task 8: Web dashboard — History and Settings pages — `src/views/pages/history.tsx` (HistoryPage, HistoryList, HistoryCard with tweet links, image thumbnails, timestamps, 30s HTMX polling), `src/views/pages/settings.tsx` (SettingsPage with website URL form for Business DNA, SettingsSaveResult/Error, SessionStatusPartial with authenticated/unauthenticated/error states), updated `src/routes/pages.tsx` (GET /history, GET /settings with saved URL, POST /settings with URL validation, GET /partials/history, GET /partials/session-status with Pomelli auth status mapping), history card + session status CSS in layout.tsx, 30 new tests in pages.test.ts (completed 2026-02-12)
- [x] Task 9: End-to-end integration — `src/services/flywheel.ts` with `triggerPommelliGeneration()` (fire-and-forget async with concurrency lock check) and `approvePost()` (approve + optional immediate X posting for non-scheduled posts), wired into both API routes (`POST /api/ideas`, `POST /api/queue/:id/approve`) and page routes (`POST /submit-idea`, `POST /queue/:id/approve`), generation status in API response, error handling at each pipeline step. Also fixed pre-existing SQLite busy_timeout race condition in `db.ts`. 15 integration tests in `tests/flywheel.test.ts` covering full pipeline, Pomelli lock handling, scheduled vs immediate posting, X failure scenarios, edited captions, and reject flow. (completed 2026-02-12)
- [x] Task 10: Scheduled posting with croner — `src/services/scheduler.ts` with `processDuePosts()` (queries approved posts where `scheduled_at <= now`, posts each via Twitter service), `startScheduler()` (croner `Cron` every minute with `protect: true`), `stopScheduler()`, `isSchedulerRunning()`. Added `getDueScheduledPosts()` DB query helper. Updated `approvePost()` in flywheel.ts to accept optional `scheduledAt` parameter (FR-1). Updated both API and page approve routes to pass through `scheduled_at` from request body. Added `scheduled_at` to `updatePostStatus` allowed fields. Wired scheduler start into `server.ts` (runs on boot, immediately checks for overdue posts for AC-4). Concurrency guard prevents overlapping ticks. Individual post failures don't affect others (NFR-2). `[cron]` prefixed logging throughout. 19 tests in `tests/scheduler.test.ts` covering getDueScheduledPosts query, processDuePosts pipeline, failure handling, status race protection, scheduler lifecycle, and startup overdue detection. Also fixed pre-existing biome-ignore suppression placement in flywheel.test.ts. (completed 2026-02-12)

## In Progress

- [ ] **[CURRENT]** Task 11: Basic auth middleware

## Backlog (Prioritized)

11. [ ] Task 11: Basic auth middleware
    - Why: Protects the dashboard when deployed
    - Details:
      - If `ADMIN_PASSWORD` is set in config, require basic auth on all routes
      - Simple middleware in server.ts
      - Skip auth for health check endpoint (`GET /health`)
    - Spec: AGENTS.md § "Environment" (ADMIN_PASSWORD)

12. [ ] Task 12: Dockerfile and Fly.io deployment config
    - Why: Deployment is the final step to make this usable
    - Details:
      - Create `Dockerfile` per PRD spec (oven/bun:1 base, Playwright deps, chromium install)
      - Create `fly.toml` (pomelli-x-flywheel, ord region, shared-cpu-2x 1GB, /data mount)
      - Create `.dockerignore`
      - Document Fly.io setup: `fly launch`, `fly volumes create`, `fly secrets set`
      - Test Docker build locally
    - Spec: prd.md § "Fly.io Deployment Details"

13. [ ] Task 13: Error handling, resilience, and polish
    - Why: Production readiness
    - Details:
      - Hono error middleware for graceful error pages
      - Playwright retry logic (selectors may intermittently fail)
      - X API rate limit tracking in DB (x-posting NFR-1: track usage within free tier 1,500 posts/month)
      - Image size validation with resize fallback (Sharp or similar)
      - Session expiry detection and alerting via dashboard banner
      - Comprehensive logging across all services
    - Spec: prd.md § "Risks & Mitigations", x-posting NFR-1

## Discovered Issues

- **OAuth auth type inconsistency**: The x-posting spec (FR-7) says "OAuth 2.0 user context auth" but the env vars (`X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET`) are OAuth 1.0a tokens. The `twitter-api-v2` package supports both. For the Free tier with user-context posting, OAuth 1.0a with app+user tokens is the most straightforward approach. The spec likely meant "user-context auth" generically. Will implement OAuth 1.0a unless user clarifies.
- **Pomelli product uncertainty**: "Pomelli" at `labs.google.com/pomelli` is not a widely known Google product name. This may be a beta/internal tool or may have been renamed. Selectors and URL may change. The automation must be built defensively (selector abstraction, debug screenshots, graceful failure).
- **Static file serving needs early setup**: Downloaded Pomelli images at `DATA_DIR/assets/` need to be served via HTTP for queue previews. This must be configured in Task 1 (server.ts) even though images won't exist until Task 4.

## Resolved Questions

1. **Pomelli access**: Assume `labs.google.com/pomelli` is correct. Build selectors defensively — they'll need updating once we see the real UI.
2. **X API auth method**: Use OAuth 1.0a with app+user tokens. Matches the env vars and is simplest for server-to-server posting.
3. **Fly.io account**: Assume already set up. Deployment task just creates config files.
4. **CSS approach**: Pico CSS via CDN. Zero config, classless, looks good out of the box.
5. **Linting tool**: Biome. Fast, works great with Bun, minimal config.

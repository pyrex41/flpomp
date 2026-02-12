---
date: 2026-02-12T22:48:47Z
researcher: Claude
git_commit: N/A (research spans two separate repos)
branch: N/A
repository: flpomp + flpomp-team (comparison)
topic: "Compare flpomp/ and flpomp-team/ implementations - two different harnesses building the same PRD"
tags: [research, comparison, flpomp, ralph, agent-team, stripe, monetization]
status: complete
last_updated: 2026-02-12
last_updated_by: Claude
---

# Research: flpomp vs flpomp-team — Two Harnesses, One PRD

**Date**: 2026-02-12T22:48:47Z
**Researcher**: Claude

| Repo | Link |
|------|------|
| **flpomp** (Ralph single-agent loop) | [github.com/pyrex41/flpomp](https://github.com/pyrex41/flpomp) |
| **flpomp-team** (Claude Code agent-team) | [github.com/pyrex41/flpomp-team](https://github.com/pyrex41/flpomp-team) |

## Research Question

Compare and contrast `flpomp/` (Ralph single-agent loop) and `flpomp-team/` (Claude Code agent-team) — two different implementations of the same PRD by two different AI build harnesses. Highlight strengths and weaknesses, and discuss how to synthesize the best of both, especially if the goal is to add Stripe / monetize.

## Summary

Both projects implement the same PRD: a Pomelli-to-X automation flywheel (Bun + Hono + HTMX + Playwright + Twitter API v2 + SQLite, deployed on Fly.io). The PRD files are byte-for-byte identical. The implementations diverge dramatically in depth, architecture, and production-readiness.

**flpomp** (Ralph single-agent loop) produced a feature-complete, production-grade application with ~3,900 lines of source code, 274 passing tests across 12 test files, 7 JTBD specs, comprehensive error handling, image resizing, session management UI, and deployment configs.

**flpomp-team** (parallel agent-team) produced a working but thinner MVP with ~1,030 lines of source code, 43 tests across 5 test files, no specs beyond the PRD, and several architectural gaps (HTMX returns JSON instead of HTML partials, no image resizing, no usage tracking, no error pages).

The Ralph loop built 3.8x more code and 6.4x more tests. The agent-team built its output in ~8 minutes wall-clock time. These are fundamentally different tradeoffs — depth vs speed.

---

## Detailed Findings

### 1. Build Harness Comparison

#### flpomp — Ralph Wiggum Single-Agent Loop

- **Harness**: Cursor CLI in headless agent mode, Opus 4.6 with thinking
- **Orchestration**: Bash outer loop (`loop.sh`) running up to 100 iterations with 5s sleep between
- **Mode switching**: Alternates between Plan mode (read-only analysis → IMPLEMENTATION_PLAN.md) and Build mode (implement one task per iteration)
- **Planning artifacts**: 7 JTBD spec files in `specs/`, `IMPLEMENTATION_PLAN.md` with 13 completed tasks, `AGENTS.md` project conventions guide, `PROMPT_plan.md` and `PROMPT_build.md` mode-specific instructions
- **Validation backpressure**: `bun run check` (tsc + biome + vitest) must pass before every commit
- **Stop protocol**: Agent writes `.stop` file when task queue is empty; loop terminates cleanly

The Ralph approach is iterative and thorough: each iteration gets fresh context, picks one task, implements it completely, validates, commits, and exits. The implementation plan acts as persistent state across context-window boundaries.

#### flpomp-team — Claude Code Agent-Team (Manual Orchestration)

- **Harness**: Claude Code with manual team orchestration (no automated loop)
- **Orchestration**: Single session, team lead spawned 3 specialist agents in parallel via `TeamCreate`
- **Phases**: Foundation (team lead) → Parallel development (3 agents: xpost, pomelli, dashboard) → Integration (team lead) → Verification
- **Planning artifacts**: Only the PRD (`prd.md`) — no specs, no implementation plan, no conventions guide
- **Build time**: ~8 minutes wall-clock from first file to all checks passing
- **Validation**: Single `bun run check` pass at the end

The agent-team approach is parallel and fast: foundation built first, then three specialists work concurrently on independent domains, followed by integration wiring.

### 2. Source Code Comparison

| Dimension | flpomp (Ralph) | flpomp-team (Agent-Team) |
|-----------|----------------|--------------------------|
| **Source files** | 18 | 13 |
| **Source lines** | ~3,900 | ~1,030 |
| **Test files** | 12 | 5 (colocated) |
| **Test lines** | ~4,700 | ~790 |
| **Total tests** | 274 | 43 |
| **Dependencies** | 5 (+ sharp) | 4 |
| **Test location** | `tests/` directory | Colocated with source |

### 3. Architecture Comparison

#### Server (`server.ts`)

| Feature | flpomp (183 lines) | flpomp-team (94 lines) |
|---------|--------------------|-----------------------|
| Basic auth | Hand-rolled with `timingSafeEqual` | Hono `basicAuth` middleware |
| Health check bypass | Manual path check | Middleware ordering |
| Error handler | Global `app.onError()` with HTML/JSON detection | None (errors bubble) |
| 404 handler | `app.notFound()` with HTML/JSON | None |
| Static file serving | `/assets/*` from data dir | `/public/*` + `/assets/*` |
| Directory creation | Explicit mkdir on boot | In config module |
| Pomelli async pipeline | Delegated to `flywheel.ts` | Inline `generateAsync()` function |
| Scheduler init | `startScheduler(db)` with DB injection | `startScheduler()` module-level |

**Key difference**: flpomp's server is defensive (error pages, content negotiation, directory setup). flpomp-team's server is minimal — it works for the happy path but lacks error handling infrastructure.

#### Database (`db.ts`)

| Feature | flpomp (203 lines) | flpomp-team (125 lines) |
|---------|--------------------|-----------------------|
| Connection | Singleton with `getDb()`, configurable path | Module-level instantiation |
| Pragmas | busy_timeout=5000, WAL, foreign_keys | WAL only |
| Test support | `createTestDb()` returns in-memory instance | No test DB helper |
| Schema | `posts` (12 cols including `error_message`) + `settings` | `posts` (11 cols) + `settings` |
| Query helpers | 7 functions, parameterized | 9 functions, more granular |
| Type safety | `Post` interface matches schema | `Post` interface matches schema |
| Dynamic update | `updatePostStatus()` with extra fields map | `updatePost()` with partial fields |

**Key difference**: flpomp has test infrastructure (in-memory DB factory, test injection) and extra resilience (busy_timeout, error_message column). flpomp-team has more granular query helpers (`getQueue()`, `getHistory()`, `getDuePosts()` as separate functions) which is arguably cleaner.

#### Pomelli Service

| Feature | flpomp (1,036 lines) | flpomp-team (204 lines) |
|---------|---------------------|-----------------------|
| Selectors | 76-line SELECTORS object, 15+ element types | 12-line SELECTORS object, 11 element types |
| Retry logic | `withRetry()` helper with configurable attempts/backoff | None |
| Session check | Full `getAuthStatus()` with 10s timeout, status caching | Simple `isSessionActive()` boolean |
| Cookie import | Validates, filters Google domains, normalizes sameSite | Basic validation, direct injection |
| Business DNA | Dedicated method with 90s timeout, completion detection | `ensureBusinessDna()` with 60s timeout |
| Image download | Handles data:, blob:, HTTP URLs with fallbacks | Single `page.request.get()` approach |
| Caption extraction | Primary selector + fallback (longest paragraph) | Single selector attempt |
| Generation timeout | 120s | 90s |
| Human delays | 2-5s random between all actions | 2-5s random between all actions |
| Concurrency lock | Module-level boolean with acquire/release helpers | Instance boolean with simple check |
| Debug screenshots | Numbered with global counter, saved with step names | Named with step prefix and timestamp |

**Key difference**: flpomp's Pomelli service is 5x larger because it handles every edge case — retry logic, multiple selector fallbacks, three image URL formats, session caching for the UI banner. flpomp-team's version handles the happy path cleanly but would break more easily on real Pomelli UI.

#### Twitter Service

| Feature | flpomp (280 lines) | flpomp-team (66 lines) |
|---------|--------------------|-----------------------|
| Usage tracking | Monthly counter with 1,500 limit check | None |
| Image validation | Extension + exists + size checks | Exists + size checks |
| Caption validation | 280 char limit with `TwitterPostError` | 280 char limit with generic Error |
| Image resizing | `ensureImageWithinLimit()` with Sharp (164 lines) | None (fails if > 5MB) |
| Error types | Custom `TwitterPostError` class with codes | Generic Error throws |
| DB updates | Updates post status to 'posted'/'failed' in service | Updates happen in scheduler |

**Key difference**: flpomp includes image resizing via Sharp (progressive quality reduction, PNG→JPEG fallback) and usage tracking against the X free tier limit. flpomp-team's Twitter service is a clean, minimal wrapper.

#### Scheduler

| Feature | flpomp (143 lines) | flpomp-team (69 lines) |
|---------|--------------------|-----------------------|
| Guard | `isRunning` boolean prevents overlapping ticks | Croner default behavior |
| Post validation | Re-fetches post to check status still 'approved' | Validates caption+image exist |
| Error isolation | Per-post try/catch, failures don't stop batch | Per-post try/catch, failures don't stop batch |
| Startup check | Immediately processes overdue posts on boot | None |
| Cron config | `protect: true` on Cron instance | Default Cron behavior |

**Key difference**: Both handle the core scheduling correctly. flpomp adds a startup overdue check and re-validates post status (race condition protection).

#### Routes

| Feature | flpomp | flpomp-team |
|---------|--------|-------------|
| API routes | 11 endpoints in `routes/api.ts` (348 lines) | 8 endpoints in `routes/api.ts` (88 lines) |
| Page routes | 15 routes + partials in `routes/pages.tsx` (357 lines) | 4 pages in `routes/pages.tsx` (110 lines) |
| Auth routes | Inline in api.ts (2 endpoints) | Dedicated `routes/auth.ts` (41 lines, 2 endpoints) |
| Test DB injection | `setTestDb()` pattern in both api/pages | In-memory mock in tests |
| HTMX approach | **Returns HTML partials** from page routes | **HTMX attributes point to JSON API endpoints** |
| Usage endpoint | `GET /api/usage` | None |

**Critical HTMX difference**: This is the most significant architectural gap between the two projects.

- **flpomp** has separate page routes that return HTML partials for HTMX swaps. The HTMX attributes (`hx-post`, `hx-get`, `hx-target`) point to page routes like `/queue/:id/approve`, `/partials/queue-card/:id/edit`, etc. These return server-rendered JSX fragments that HTMX can swap into the DOM. This is the correct HTMX pattern.

- **flpomp-team** has HTMX attributes that point to JSON API endpoints (`/api/queue/:id/approve`, `/api/queue`). These endpoints return JSON via `c.json()`, but HTMX expects HTML for `outerHTML` swaps. **The HTMX dynamic updates in flpomp-team would not work correctly** — approve, edit, delete, and polling would all fail to update the UI because JSON can't be swapped as HTML.

#### Views

| Feature | flpomp | flpomp-team |
|---------|--------|-------------|
| Layout | 206 lines, inline CSS, session banner | 60 lines, inline CSS, basic nav |
| Pages | 5 (dashboard, queue, history, settings, error) | 4 (inline in pages.tsx, no error page) |
| Components | 2 (session-banner, post-card with edit form) | 3 (post-card, queue-list, history-list) |
| Session banner | Shows expired/error Pomelli status on all pages | None |
| Error page | Dedicated component with collapsible details | None |
| Inline editing | Separate display/edit components with HTMX swap | Toggle hidden form with vanilla JS |
| Polling | Dashboard 5s, History 30s via page partials | Queue 10s, History 30s (but points to JSON APIs) |

**Key difference**: flpomp has richer UI with session awareness (banner warns when Pomelli auth is expired) and proper HTMX partial endpoints. flpomp-team's component decomposition (queue-list, history-list as separate files) is cleaner organizationally.

### 4. Testing Comparison

#### flpomp — 274 tests, 12 files

| Test File | Tests | Type |
|-----------|-------|------|
| api.test.ts | 95 | API integration |
| pages.test.ts | 97 | HTML + HTMX integration |
| resilience.test.tsx | 42 | Error handling, retry, components |
| auth.test.ts | 40 | Cookie auth, session check |
| pomelli.test.ts | 37 | Browser automation (mocked) |
| twitter.test.ts | 27 | Twitter API + validation |
| scheduler.test.ts | 26 | Cron + scheduled posting |
| middleware.test.ts | 26 | Basic auth middleware |
| flywheel.test.ts | 15 | End-to-end pipeline |
| db.test.ts | 17 | Database CRUD |
| server.test.ts | 7 | Server basics |
| config.test.ts | 4 | Config loading |

- Uses `createTestDb()` for real in-memory SQLite in tests
- Tests verify HTMX attributes in HTML output
- E2E tests cover full pipeline (idea → pomelli → queue → approve → post)
- Tests for edge cases: timing-safe auth, lock contention, image resize, retry backoff

#### flpomp-team — 43 tests, 5 files

| Test File | Tests | Type |
|-----------|-------|------|
| api.test.ts | 13 | API unit |
| auth.test.ts | 8 | Auth unit |
| pomelli.test.ts | 7 | Pomelli unit |
| twitter.test.ts | 5 | Twitter unit |
| scheduler.test.ts | 5 | Scheduler unit |

- Uses stateful in-memory mocks (Map-based fake DB)
- No page/HTML tests
- No E2E pipeline tests
- No middleware tests
- Colocated with source files

**Key difference**: flpomp's test suite is production-grade — it catches regressions across the entire stack. flpomp-team's tests verify basic functionality of individual services but would miss integration issues (like the HTMX/JSON mismatch).

### 5. Deployment Comparison

Both projects have functionally equivalent Dockerfiles and fly.toml configs:
- Same base image (`oven/bun:1`)
- Same Playwright deps installation approach
- Same volume mount (`/data` for SQLite, browser state, assets)
- Same VM spec (`shared-cpu-2x`, 1GB memory)
- Same app name and region

flpomp adds:
- Health check configuration in fly.toml (interval, grace period, timeout)
- Concurrency limits (soft 20, hard 25)
- Liberation fonts and noto-color-emoji in Dockerfile
- `.dockerignore` excludes test files, docs, dev tooling

### 6. What Each Does Better

#### flpomp (Ralph) Strengths

1. **Production resilience**: Error pages, retry logic, image resizing, usage tracking, session status caching and UI banners, timing-safe auth
2. **Correct HTMX architecture**: Page routes return HTML partials; HTMX swaps actually work
3. **Spec-driven development**: 7 JTBD specs provide traceability from requirements to implementation
4. **Comprehensive testing**: 274 tests including E2E pipeline, edge cases, and HTMX attribute verification
5. **Pomelli robustness**: Retry wrapper, multiple selector fallbacks, three image URL format handlers, session caching
6. **Image handling**: Sharp-based resize with progressive quality reduction for X's 5MB limit
7. **Observable**: Session banner, debug screenshots, usage endpoint, structured logging

#### flpomp-team (Agent-Team) Strengths

1. **Speed**: ~8 minutes from nothing to 43 passing tests — dramatically faster feedback loop
2. **Clean component decomposition**: queue-list and history-list as separate view components
3. **Dedicated auth module**: `routes/auth.ts` as a separate concern vs inline in api.ts
4. **Simpler DB queries**: `getQueue()`, `getHistory()`, `getDuePosts()` as named functions with clear intent
5. **Leaner code**: Each file does one thing with minimal overhead
6. **Documented build process**: README tells you exactly how it was built, with timestamps

### 7. Weaknesses

#### flpomp Weaknesses

1. **Code volume**: 1,036-line Pomelli service is large — some of the fallback logic may never execute
2. **No component decomposition for lists**: Queue and history lists are inline in page files
3. **Auth routes inline**: Cookie import and session check buried in `routes/api.ts` rather than separated
4. **Harness overhead**: The Ralph config, loop scripts, skills, and specs add project complexity
5. **Single-agent bottleneck**: Each iteration processes one task sequentially; parallelism is only within subagent usage

#### flpomp-team Weaknesses

1. **Broken HTMX**: The most critical issue — HTMX attributes target JSON API endpoints, so dynamic updates (approve, edit, delete, polling) would silently fail in a browser
2. **No error handling infrastructure**: No error pages, no global error handler, no 404 handler
3. **No image resizing**: Posts with images > 5MB would fail at the Twitter API
4. **No usage tracking**: No awareness of X free tier limits; could hit 1,500/month with no warning
5. **No session UI**: No way for user to know Pomelli session expired without manually checking /api/auth/status
6. **Thin Pomelli automation**: No retry logic, single selector strategy, single image download method
7. **No test DB injection**: Tests mock the entire DB module rather than using real SQLite; misses SQL bugs
8. **No E2E tests**: Pipeline integration never tested end-to-end

---

## Synthesis: Best of Both for a Monetizable Product

If the goal is to take one of these and build it into a monetizable SaaS with Stripe, here's how I'd synthesize:

### Foundation: Start from flpomp, adopt flpomp-team's organization patterns

flpomp is the only one with a working HTMX frontend, production error handling, and comprehensive tests. But adopt these structural patterns from flpomp-team:

1. **Separate auth routes** into `routes/auth.ts` instead of burying in api.ts
2. **Extract list components** (QueueList, HistoryList) into `views/components/` files
3. **Named DB queries** (`getQueue()`, `getHistory()`, `getDuePosts()`) instead of generic `getAllPosts(db, status)` — clearer intent
4. **Colocate tests** with source (or keep separate — this is preference, but colocated has better DX for smaller projects)

### Stripe/Monetization Architecture

To monetize this as a SaaS, you'd need multi-tenancy, billing, and account management. Here's what to add:

#### New Database Tables

```sql
-- Users & auth (replace basic auth)
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT,
  plan TEXT DEFAULT 'free',  -- free | starter | pro
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Link posts to users
ALTER TABLE posts ADD COLUMN user_id INTEGER REFERENCES users(id);

-- Per-user settings (replace single-row settings)
CREATE TABLE user_settings (
  user_id INTEGER NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (user_id, key)
);

-- Per-user Pomelli sessions (each user has own browser state)
CREATE TABLE pomelli_sessions (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  browser_state_path TEXT NOT NULL,
  last_checked_at DATETIME,
  status TEXT DEFAULT 'unknown'
);
```

#### Stripe Integration

**New files needed:**
- `src/services/stripe.ts` — Stripe SDK integration (subscription CRUD, webhook handling, portal sessions)
- `src/routes/billing.ts` — Checkout sessions, customer portal, plan display
- `src/routes/webhooks.ts` — Stripe webhook handler (subscription changes, payment events)
- `src/views/pages/billing.tsx` — Plan selection, usage dashboard, payment management
- `src/middleware/auth.ts` — Replace basic auth with session-based auth (cookie sessions or JWT)
- `src/middleware/plan-guard.ts` — Check user's plan limits before allowing actions

**Plan structure:**
- **Free**: 5 posts/month, manual posting only (no scheduling), 1 Pomelli session
- **Starter** ($19/mo): 50 posts/month, scheduling, priority generation queue
- **Pro** ($49/mo): Unlimited posts, scheduling, analytics, multiple brand profiles

**Key Stripe events to handle:**
- `checkout.session.completed` — Create/upgrade subscription
- `customer.subscription.updated` — Plan changes
- `customer.subscription.deleted` — Downgrade to free
- `invoice.payment_failed` — Grace period or pause service

#### Why flpomp is better positioned for this

1. **Usage tracking already exists** — `getMonthlyUsage()` and `incrementMonthlyUsage()` just need to become per-user and plan-aware
2. **Error handling infrastructure exists** — Adding billing errors to the existing error middleware is straightforward
3. **Session management is robust** — Per-user Pomelli sessions can build on the existing `PommelliService` with separate browser state directories
4. **Test infrastructure exists** — New billing features can follow the existing patterns (in-memory DB, mock Stripe client, API integration tests)
5. **HTMX partials work** — Billing UI can follow the same pattern of server-rendered pages with HTMX interactivity

#### What flpomp-team would need first

Before you could add Stripe to flpomp-team, you'd need to fix foundational issues:
1. Fix the HTMX/JSON mismatch (add HTML partial endpoints or restructure routing)
2. Add error handling middleware
3. Add test DB injection
4. Add image resizing
5. Add usage tracking
6. Build out the session management UI

That's essentially reimplementing most of what flpomp already has.

### Recommended Synthesis Approach

1. **Fork flpomp** as the base
2. **Restructure** using flpomp-team's organizational patterns (auth routes, list components, named queries)
3. **Add user model** with email/password auth (replace basic auth)
4. **Add Stripe** with plan enforcement middleware
5. **Multi-tenant Pomelli** — per-user browser state directories
6. **Billing UI** — plan selection page, usage dashboard, Stripe Customer Portal integration
7. **Add analytics** — track post performance, close the flywheel loop (future enhancement from PRD)

### Key Dependencies to Add

```json
{
  "stripe": "^17.0.0",
  "better-auth": "^1.0.0",  // or lucia-auth for session management
}
```

Better Auth or Lucia provides session-based auth that works well with server-rendered apps and Hono. Stripe's Node.js SDK works with Bun.

---

## Code References

### flpomp
- `src/server.ts` — Server with error handling, auth middleware, scheduler init
- `src/services/pomelli.ts` — 1,036-line Playwright automation with retries, fallbacks, session caching
- `src/services/twitter.ts:121-162` — Monthly usage tracking (foundation for per-user billing)
- `src/services/image.ts` — Sharp-based image resize for X's 5MB limit
- `src/services/flywheel.ts` — Orchestration layer (Pomelli → queue → X posting)
- `src/routes/pages.tsx` — HTMX partial endpoints (correct architecture)
- `src/views/components/session-banner.tsx` — Pomelli session status in layout
- `IMPLEMENTATION_PLAN.md` — 13 completed tasks with detailed descriptions
- `specs/` — 7 JTBD specification files

### flpomp-team
- `src/routes/auth.ts` — Clean auth route separation
- `src/views/components/queue-list.tsx` — Clean list component extraction
- `src/db.ts:61-85` — Named query functions (`getQueue`, `getHistory`, `getDuePosts`)
- `README.md:94-157` — Detailed build process documentation with timeline

## Architecture Documentation

### flpomp patterns to preserve
- **HTMX partial endpoints**: Page routes return HTML fragments for HTMX swaps
- **Fire-and-forget generation**: API returns 201 immediately, Pomelli runs in background
- **Session status caching**: `_lastSessionStatus` avoids Playwright overhead on every page load
- **Progressive image fallback**: Sharp quality reduction → PNG-to-JPEG conversion → error
- **Concurrency lock**: Module-level boolean prevents overlapping Playwright sessions
- **Test DB injection**: `setTestDb()`/`setPageTestDb()` pattern for integration tests

### flpomp-team patterns to adopt
- **Route separation**: Auth concerns in dedicated route file
- **Component extraction**: List components as separate files
- **Named queries**: `getQueue()` instead of `getAllPosts(db, 'pending_review')`
- **Build documentation**: README explaining how the project was built

## Quantitative Summary

| Metric | flpomp (Ralph) | flpomp-team (Agent-Team) | Ratio |
|--------|----------------|--------------------------|-------|
| Source lines | ~3,900 | ~1,030 | 3.8x |
| Test lines | ~4,700 | ~790 | 5.9x |
| Test count | 274 | 43 | 6.4x |
| Source files | 18 | 13 | 1.4x |
| Test files | 12 | 5 | 2.4x |
| Build time | Many iterations | ~8 min | — |
| Specs/plans | 7 specs + impl plan | PRD only | — |
| HTMX working | Yes | No (JSON mismatch) | — |
| Error pages | Yes | No | — |
| Image resize | Yes (Sharp) | No | — |
| Usage tracking | Yes | No | — |
| Session UI | Yes (banner) | No | — |
| Retry logic | Yes | No | — |

## Open Questions

1. How long did the Ralph loop take to complete all 13 tasks? (No timing data in the repo — would reveal the speed tradeoff more precisely)
2. Has either implementation been tested against the real Pomelli UI? (Selectors in both are speculative)
3. What's the target user for monetization — individual creators, agencies, or SMBs? (Affects plan structure and pricing)
4. Should Pomelli sessions be pooled per-tenant or shared? (Cost vs isolation tradeoff for SaaS)

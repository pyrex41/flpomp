# Implementation Plan

Generated: 2026-02-12
Last Updated: 2026-02-12

## Summary

Greenfield project — no source code exists yet. The project is a self-hosted automation service ("Pomelli → X Flywheel") that takes marketing ideas, feeds them through Google Pomelli (via Playwright browser automation) to generate branded social media assets, then posts to X (Twitter) with optional human-in-the-loop approval.

Requirements are captured in 7 specs (`specs/*.md`) covering project scaffolding, X posting, queue management, Pomelli automation, the web dashboard, auth/session management, and scheduled posting. The PRD (`prd.md`) and `AGENTS.md` provide architecture, deployment, and convention guidance.

Build order follows the PRD's recommended MVP sequence: scaffolding → X posting → API/DB → Pomelli automation → dashboard UI → integration → deployment → polish.

## Completed

- [x] Task 1: Project scaffolding — Bun + Hono + TypeScript + HTMX + SQLite setup (completed 2026-02-12)

## In Progress

- [ ] **[CURRENT]** Task 2: X (Twitter) posting service
  - Details:
    - Initialize Bun project with `bun init`
    - Install dependencies: `hono`, `twitter-api-v2`, `playwright`, `croner`, `vitest`
    - Create `tsconfig.json` with Hono JSX support (`jsx: "react-jsx"`, `jsxImportSource: "hono/jsx"`)
    - Create `src/config.ts` — centralized env var access (X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET, WEBSITE_URL, PORT=8080, DATA_DIR=/data, ADMIN_PASSWORD)
    - Create `src/db.ts` — SQLite schema with `posts` and `settings` tables per PRD schema, auto-migration on first run (queue-management FR-8, FR-9)
    - Create `src/server.ts` — Hono app entry point with error middleware, logging, static file serving for `/data/assets/` images (dashboard FR-8)
    - Create `src/views/layout.tsx` — Base HTML layout with HTMX script tag, responsive meta viewport (dashboard NFR-3)
    - Add `package.json` scripts: `dev`, `build`, `test`, `lint`, `check`
    - Add `.gitignore` (node_modules, *.db, .env, /data, browser-state)
    - Add `.env.example` with all required/optional env vars documented
    - Set up Biome for linting (fast, Bun-native)
    - Validate: `bunx tsc --noEmit` passes, `bun run src/server.ts` starts on PORT
  - Spec: specs/project-scaffold.md, specs/queue-management.md FR-8/FR-9, specs/dashboard.md FR-8/NFR-3

## Backlog (Prioritized)

3. [ ] Task 3: Queue management API routes
   - Why: Provides the REST backbone that both Pomelli service and dashboard will use
   - Details:
     - Create `src/routes/api.ts` — Hono router with JSON API endpoints (queue-management NFR-2)
     - `POST /api/ideas` — Accept idea, validate non-empty (NFR-3), create post with status='generating', trigger Pomelli async (FR-1)
     - `GET /api/queue` — List posts with status `pending_review`, include image preview URL and caption (FR-2)
     - `POST /api/queue/:id/approve` — Set status='approved'; if no scheduled_at, post to X immediately (FR-3)
     - `POST /api/queue/:id/edit` — Update edited_caption field (FR-4)
     - `DELETE /api/queue/:id` — Set status='rejected' (FR-5)
     - `GET /api/history` — List posts with status='posted', include tweet URLs and timestamps (FR-6)
     - `POST /api/settings` — Update settings table
     - Serve downloaded Pomelli images as static files for preview (FR-7)
     - Wire routes into server.ts
     - Write integration tests for each endpoint
   - Spec: specs/queue-management.md

4. [ ] Task 4: Pomelli browser automation service
   - Why: Core differentiator — this is what makes the flywheel work
   - Details:
     - Create `src/services/pomelli.ts` with `PommelliService` class
     - Define all selectors in a `SELECTORS` object at top of file (FR-9, NFR-1: prefer data-testid, aria-label, text content)
     - Launch persistent browser context at `DATA_DIR/browser-state/` (FR-1)
     - Implement `checkSession(): Promise<boolean>` — navigate to Pomelli, verify logged-in (FR-2)
     - Implement `createBusinessDNA(websiteUrl: string)` — enter URL, wait ~60s, confirm (FR-3)
     - Implement `generateCampaign(idea: string): Promise<{images: string[], caption: string}>` (FR-4, FR-5):
       - Click "Create Campaign", enter idea, wait for generation with 120s timeout (NFR-2)
       - Download actual image files to `DATA_DIR/assets/` (FR-6)
       - Scrape caption text (FR-7)
     - Save assets to DB and set status to `pending_review` (FR-8)
     - Take debug screenshots at each step to `DATA_DIR/debug/` (FR-10)
     - Add 2-5 second human-mimicking delays between all actions (FR-11)
     - Implement concurrency lock — never run multiple automations in parallel (NFR-3)
     - Add `[pomelli]` prefixed console logging
     - Write unit tests with mocked Playwright
   - Spec: specs/pomelli-automation.md

5. [ ] Task 5: Pomelli auth/session management
   - Why: Required for Pomelli service to work; separate due to complexity
   - Details:
     - `POST /api/auth/pomelli` — Trigger login flow (auth-session FR-3)
     - `GET /api/auth/status` — Health check that navigates to Pomelli and confirms logged-in state, completes within 10s (auth-session FR-2, NFR-1)
     - Implement cookie import flow — user pastes exported Google cookies, app injects into Playwright context (auth-session FR-4)
     - Persistent browser context at `DATA_DIR/browser-state/` survives restarts (auth-session FR-1, FR-5)
     - Clear error messaging when session is expired (auth-session FR-6)
     - Never store Google credentials in plaintext (auth-session NFR-2)
     - Write tests for health check and cookie import
   - Spec: specs/auth-session.md

6. [ ] Task 6: Web dashboard — Layout and New Post page
   - Why: First user-facing screen; enables submitting ideas into the pipeline
   - Details:
     - Create `src/routes/pages.tsx` — Hono router for HTML pages (dashboard FR-6)
     - Create `src/views/pages/dashboard.tsx` — New Post form (dashboard FR-1)
     - HTMX form: text input for idea, optional datetime picker for scheduling, submit via `hx-post="/api/ideas"` (dashboard FR-7)
     - Show recent queue items inline via `hx-get="/api/queue"` with polling
     - Navigation tabs: New Post, Queue, History, Settings (dashboard FR-9)
     - Clean, responsive CSS (no framework needed) with mobile-friendly layout (dashboard NFR-2, NFR-3)
     - No client-side JS framework — HTMX + server templates only (dashboard NFR-1)
   - Spec: specs/dashboard.md

7. [ ] Task 7: Web dashboard — Queue page
   - Why: Human-in-the-loop approval is the core UX
   - Details:
     - Create `src/views/pages/queue.tsx` (dashboard FR-2)
     - List pending posts with image thumbnail + caption text + Approve / Edit / Reject buttons
     - Inline edit: click Edit to modify caption before approving (dashboard FR-3, HTMX inline edit)
     - HTMX partial updates — approve/reject removes item from list (dashboard FR-7)
     - Create `src/views/components/post-card.tsx` — reusable post card partial
   - Spec: specs/dashboard.md

8. [ ] Task 8: Web dashboard — History and Settings pages
   - Why: Completes the dashboard UI
   - Details:
     - Create `src/views/pages/history.tsx` — posted content with tweet links + timestamps (dashboard FR-4)
     - Create `src/views/pages/settings.tsx` — website URL for Business DNA, session status display (dashboard FR-5)
     - Settings form saves via `hx-post="/api/settings"` (dashboard FR-7)
   - Spec: specs/dashboard.md

9. [ ] Task 9: End-to-end integration — Idea → Pomelli → Queue → Approve → X
   - Why: Wires all services together into the complete flywheel
   - Details:
     - When idea submitted: create DB record → kick off Pomelli generation async → update record with assets → set status to `pending_review`
     - When approved (no schedule): post to X via Twitter service → update record with tweet ID/URL → set status to `posted`
     - Handle errors at each step: set status to `failed` with error message
     - Background async processing: Pomelli generation must not block the HTTP request
     - Respect Pomelli concurrency lock from Task 4
   - Spec: prd.md § "The Flywheel"

10. [ ] Task 10: Scheduled posting with croner
    - Why: Enables "post later" functionality
    - Details:
      - Create `src/services/scheduler.ts` (scheduling FR-5)
      - Accept optional `scheduled_at` datetime on idea submission and approval (scheduling FR-1)
      - Approved posts with future `scheduled_at` stay in `approved` status until due (scheduling FR-2)
      - Cron job every minute: query approved posts where `scheduled_at <= now` (scheduling FR-3)
      - Post each due item via Twitter service (scheduling FR-4)
      - Posts approved with no `scheduled_at` are posted immediately, no cron delay (scheduling FR-6)
      - Lightweight cron — just a DB query and conditional posting (scheduling NFR-1)
      - Handle cron failures gracefully — log and retry next minute, don't crash server (scheduling NFR-2)
      - Add `[cron]` prefixed logging
      - Write tests with mocked time
    - Spec: specs/scheduling.md

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

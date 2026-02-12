# Pomelli → X Automation Flywheel

## Detailed Build Prompt / App Specification

**Host:** Fly.io
**Stack:** Bun (TypeScript) + Hono + HTMX + Playwright + X API v2

---

## What This App Does

A self-hosted automation service that takes a raw marketing idea, feeds it through Google Pomelli to generate on-brand social media assets (images + captions), then posts the finished content to X (Twitter) — either automatically or with a human-in-the-loop approval step.

**The Flywheel:** `Idea → Pomelli (brand-aware asset generation) → Review/Approve → Post on X`

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│                   Fly.io (Docker)                     │
│                                                       │
│  ┌─────────────┐   ┌──────────────┐   ┌───────────┐ │
│  │  Web UI /    │──▶│  Pomelli     │──▶│  X API    │ │
│  │  API Server  │   │  Playwright  │   │  Poster   │ │
│  │  (Hono)      │   │  Automation  │   │  (v2)     │ │
│  └─────────────┘   └──────────────┘   └───────────┘ │
│         │                  │                  │       │
│         └──────────┬───────┘──────────────────┘       │
│                    ▼                                  │
│            ┌──────────────┐                           │
│            │  SQLite DB   │                           │
│            │  (Queue +    │                           │
│            │   History)   │                           │
│            └──────────────┘                           │
└──────────────────────────────────────────────────────┘
```

---

## Core Components

### 1. Web Dashboard (Hono + HTMX)

Server-rendered HTML via Hono JSX templates with HTMX for interactivity. No client-side JS framework needed.

A simple admin UI with these screens:

- **New Post** — Text field for the idea/prompt (e.g., "Promote our new cold brew for summer"), optional scheduling (post now vs. schedule), channel selector (X for now, expandable later).
- **Queue** — List of pending posts with Pomelli-generated image preview + caption. Each item has Approve / Edit / Reject buttons.
- **History** — Log of all posted content with X post links, timestamps, engagement stats (if you pull them later).
- **Settings** — Google account session management, X API credentials, target website URL for Pomelli Business DNA, default posting preferences.

### 2. Pomelli Browser Automation (Playwright)

**Why Playwright:** Pomelli has **no public API**. It's a web-only tool at `labs.google.com/pomelli`. You must automate the browser to interact with it.

**Auth Strategy:**
- Use a persistent Playwright browser context with saved Google session cookies/state.
- Store the browser state directory on a Fly.io persistent volume so sessions survive deploys.
- On first run (or session expiry), trigger a manual login flow — either via the web dashboard showing a VNC/noVNC window, or by having the user paste fresh cookies.

**Automation Flow:**

```
1. Launch persistent browser context (headless Chromium)
2. Navigate to labs.google.com/pomelli
3. Verify session is active (check for logged-in state)
4. If Business DNA not yet created:
   a. Enter website URL
   b. Wait for analysis to complete (~60s)
   c. Confirm/save the Business DNA profile
5. Create new campaign:
   a. Click "Create Campaign" or equivalent
   b. Enter the user's idea as the campaign prompt
     (e.g., "summer cold brew promotion for Instagram and Twitter")
   c. Wait for generation (~30-60s)
   d. Select the best variant (or grab all variants)
6. Extract assets:
   a. Download generated images (screenshot or actual download)
   b. Scrape the generated caption/copy text
   c. Save to local filesystem + database
7. Return assets to the queue for review
```

**Key Playwright Considerations:**
- Use `page.waitForSelector()` and `page.waitForLoadState('networkidle')` heavily — Pomelli is async/AI-generated, so wait for spinners to resolve.
- Take screenshots at each step for debugging.
- Use `page.evaluate()` to extract text content from generated cards.
- For image downloads: intercept the download or right-click-save the generated images via `page.locator('img').getAttribute('src')` and fetch the blob.
- Pomelli's UI may change — build selectors with resilience (prefer `data-testid`, `aria-label`, or text-content selectors over brittle CSS class selectors).
- **Rate limit yourself**: Don't hammer Pomelli. Add 2-5 second delays between actions to mimic human behavior and avoid bot detection.

### 3. X (Twitter) Posting Service

**API Access:**
- Use X API v2 via OAuth 2.0 with PKCE (user context) for posting on behalf of your account.
- The **Free tier** (no cost) allows **1,500 posts/month write-only** — more than enough for this use case.
- Use the official `twitter-api-v2` package (or raw fetch).

**Posting Flow:**

```typescript
// Pseudo-code
async function postToX(caption: string, imagePath: string) {
  // Step 1: Upload media
  const mediaId = await xClient.v1.uploadMedia(imagePath);

  // Step 2: Create post with media
  const tweet = await xClient.v2.tweet({
    text: caption,
    media: { media_ids: [mediaId] }
  });

  return tweet.data.id; // Save for history
}
```

**Important Notes:**
- Media upload still uses **v1.1 endpoint** (`POST media/upload`) — this is normal and expected even with v2.
- Image must be < 5MB, PNG/JPEG. Pomelli outputs should be fine.
- Caption must be ≤ 280 characters. If Pomelli generates longer copy, auto-truncate or let the user edit in the queue.
- Store the resulting tweet ID for the history view.

### 4. Database (SQLite via bun:sqlite)

Simple schema using Bun's built-in SQLite support:

```sql
CREATE TABLE posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idea TEXT NOT NULL,               -- Original user prompt
  pomelli_caption TEXT,             -- Generated caption from Pomelli
  pomelli_image_path TEXT,          -- Path to downloaded image
  edited_caption TEXT,              -- User-edited caption (if changed)
  status TEXT DEFAULT 'generating', -- generating | pending_review | approved | posted | failed
  x_post_id TEXT,                   -- Tweet ID after posting
  x_post_url TEXT,                  -- Full URL to the tweet
  scheduled_at DATETIME,            -- Optional scheduled time
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  posted_at DATETIME
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
```

---

## Fly.io Deployment Details

### Dockerfile

```dockerfile
FROM oven/bun:1 AS base
WORKDIR /app

# Install Playwright dependencies
RUN apt-get update && apt-get install -y \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
  libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
  libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 \
  libxshmfence1 && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

COPY . .

RUN bunx playwright install chromium

EXPOSE 8080

CMD ["bun", "run", "src/server.ts"]
```

### fly.toml

```toml
app = "pomelli-x-flywheel"
primary_region = "ord"  # Chicago, close to you

[build]

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "suspend"
  auto_start_machines = true
  min_machines_running = 0

[mounts]
  source = "pomelli_data"
  destination = "/data"
  # Stores: SQLite DB, Playwright browser state, downloaded images

[[vm]]
  size = "shared-cpu-2x"
  memory = "1gb"
  # Playwright needs ~512MB+ RAM; 1GB is safe
```

### Persistent Volume

```bash
fly volumes create pomelli_data --region ord --size 1
```

This stores:
- `browser-state/` — Playwright persistent context (Google login session)
- `db.sqlite` — Post queue and history
- `assets/` — Downloaded Pomelli images

---

## API Endpoints

```
POST   /api/ideas          — Submit a new idea to the flywheel
GET    /api/queue           — List posts pending review
POST   /api/queue/:id/approve  — Approve and post (or schedule)
POST   /api/queue/:id/edit     — Update caption before posting
DELETE /api/queue/:id          — Reject/delete a queued post
GET    /api/history         — List posted content
POST   /api/settings        — Update config (website URL, etc.)
POST   /api/auth/pomelli    — Trigger Pomelli login flow
GET    /api/auth/status      — Check Pomelli session health
```

---

## Key Implementation Details

### Google Auth Session Management

This is the trickiest part. Pomelli requires a Google login.

**Option A (Recommended): Persistent Browser Context**
```typescript
const context = await chromium.launchPersistentContext('/data/browser-state', {
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});
```
- On first run, you'll need to manually log in. Expose a temporary noVNC or screenshot-based flow through the dashboard.
- Session typically lasts weeks/months with a persistent context.
- Add a health check that navigates to Pomelli and confirms you're still logged in.

**Option B: Cookie Import**
- Log in manually in a local browser, export cookies (via browser extension), paste into the app settings.
- App injects cookies into Playwright context.
- More fragile, but simpler to implement initially.

### Handling Pomelli UI Changes

Pomelli is a beta product — its UI **will** change. Build defensively:

- **Abstract all selectors into a single `selectors.ts` config file.** When the UI changes, you update one file.
- **Log screenshots at every automation step** to `/data/debug/` for troubleshooting.
- **Add a "manual mode" fallback**: If automation fails, show the user a VNC-like view of the browser and let them click through manually, then the app just extracts the final output.

### Scheduling & Cron

For scheduled posts, use a simple in-process cron (e.g., `croner` — a lightweight cron library for Bun):

```typescript
import { Cron } from 'croner';

// Check every minute for posts that are due
new Cron('* * * * *', async () => {
  const due = db.prepare(`
    SELECT * FROM posts
    WHERE status = 'approved'
    AND scheduled_at <= datetime('now')
  `).all();

  for (const post of due) {
    await postToX(post.edited_caption || post.pomelli_caption, post.pomelli_image_path);
  }
});
```

---

## Environment Variables

```env
# X (Twitter) API
X_API_KEY=
X_API_SECRET=
X_ACCESS_TOKEN=
X_ACCESS_TOKEN_SECRET=

# App
PORT=8080
DATA_DIR=/data
WEBSITE_URL=https://yoursite.com  # For Pomelli Business DNA

# Optional
ADMIN_PASSWORD=          # Basic auth for the dashboard
```

---

## MVP Build Order

1. **Project scaffolding** — Bun + Hono + TypeScript + HTMX setup, SQLite schema
2. **X posting service** — Get tweet-with-image working first (easiest to test, most value)
3. **Hono server + SQLite** — Queue management API
4. **Playwright Pomelli automation** — Login flow, Business DNA creation, campaign generation, asset extraction
5. **Web dashboard** — HTMX UI for idea input + queue review + history
6. **Wire it all together** — Idea → Pomelli → Queue → Approve → X
7. **Deploy to Fly.io** — Dockerfile, volume, secrets
8. **Polish** — Scheduling, error handling, session health monitoring

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| **Pomelli has no API** — browser automation is inherently fragile | Abstract selectors, log screenshots, build manual fallback mode |
| **Google session expires** | Persistent browser context + health check endpoint that alerts you |
| **Pomelli UI changes in beta** | Selector config file, version-pin Playwright, screenshot debugging |
| **Pomelli bot detection** | Human-like delays (2-5s between actions), persistent context (looks like a real user returning), don't parallelize |
| **X API rate limits** | Free tier = 1,500 posts/mo (~50/day). More than enough. Track usage in DB |
| **Fly.io machine suspends mid-automation** | Set `min_machines_running = 1` during active hours, or use `auto_stop_machines = "suspend"` which preserves state |
| **Image quality/format issues** | Validate image dimensions and file size before X upload; resize if needed with Sharp |

---

## Future Enhancements

- **Multi-platform posting** — Add LinkedIn, Instagram (via Meta API), Threads
- **A/B testing** — Generate multiple Pomelli variants, post different ones, track which performs best
- **Engagement tracking** — Pull X analytics to close the flywheel loop (which ideas → which posts → which engagement)
- **Webhook/Slack trigger** — Submit ideas via Slack command instead of web UI
- **Claude integration** — Use Claude to refine/rewrite Pomelli captions before posting, or to generate the initial idea prompts from trending topics
- **RSS/news feed → idea generator** — Auto-generate ideas from industry news, completing the full autonomous flywheel

# Web Dashboard

## Job to Be Done
When I want to manage the content flywheel, I want a simple web interface to submit ideas, review the queue, and see posting history, so I can operate everything from a browser.

## Functional Requirements
- [ ] FR-1: **New Post page** — Form with text input for idea, optional datetime picker for scheduling, submit button
- [ ] FR-2: **Queue page** — List of pending posts showing image thumbnail, caption text, and Approve / Edit / Reject buttons
- [ ] FR-3: **Edit inline** — Click edit on a queued post to modify the caption before approving (HTMX inline edit)
- [ ] FR-4: **History page** — List of posted content with tweet links, timestamps, and status
- [ ] FR-5: **Settings page** — Form to manage website URL for Pomelli Business DNA and view session status
- [ ] FR-6: Server-rendered HTML using Hono JSX templates
- [ ] FR-7: HTMX for interactivity — form submissions, queue actions, inline edits without full page reloads
- [ ] FR-8: Serve static assets (CSS, HTMX library, downloaded images)
- [ ] FR-9: Basic navigation between pages (New Post, Queue, History, Settings)

## Non-Functional Requirements
- [ ] NFR-1: No client-side JS framework — HTMX + server templates only
- [ ] NFR-2: Clean, functional UI — doesn't need to be fancy, just usable
- [ ] NFR-3: Mobile-friendly layout (responsive)

## Acceptance Criteria
1. Given the dashboard, when navigating to /, then the New Post form is displayed
2. Given an idea typed into the form, when submitted, then HTMX posts to /api/ideas and shows confirmation
3. Given the queue page, when loaded, then all pending posts display with image previews and action buttons
4. Given the approve button is clicked, when HTMX fires, then the post is approved and removed from the queue list
5. Given the history page, when loaded, then posted content shows with clickable tweet links

## Out of Scope
- User accounts / multi-user support
- Dark mode / theme switching
- Real-time WebSocket updates (HTMX polling is fine)

## Dependencies
- Requires: Queue management API (all HTMX calls hit API routes)
- Requires: Static file serving for Pomelli images

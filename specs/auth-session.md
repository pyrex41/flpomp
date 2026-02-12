# Google Auth Session Management

## Job to Be Done
When the Pomelli automation needs a Google login, I want to manage the browser session so it stays alive across restarts, so I don't have to re-authenticate constantly.

## Functional Requirements
- [ ] FR-1: Persistent Playwright browser context stored at `DATA_DIR/browser-state/`
- [ ] FR-2: `GET /api/auth/status` — Health check that navigates to Pomelli and confirms logged-in state
- [ ] FR-3: `POST /api/auth/pomelli` — Trigger a login flow (initially: cookie import via settings page)
- [ ] FR-4: Cookie import method — user pastes exported Google cookies in settings, app injects into Playwright context
- [ ] FR-5: Session survives app restarts (persistent volume on Fly.io)
- [ ] FR-6: Clear error messaging when session is expired and automation fails

## Non-Functional Requirements
- [ ] NFR-1: Session health check should complete within 10 seconds
- [ ] NFR-2: Never store Google credentials in plaintext (cookies in browser state dir only)

## Acceptance Criteria
1. Given a valid Google session, when health check runs, then returns `{ status: "active" }`
2. Given an expired session, when health check runs, then returns `{ status: "expired" }` with instructions
3. Given imported cookies, when applied to browser context, then Pomelli loads in a logged-in state
4. Given app restart, when browser context loads, then the previous session is still active

## Out of Scope
- Automated Google login (OAuth flow, password entry)
- VNC/noVNC live browser view for manual login
- Multi-account support

## Dependencies
- Requires: Playwright persistent context
- Requires: Persistent volume mount at DATA_DIR

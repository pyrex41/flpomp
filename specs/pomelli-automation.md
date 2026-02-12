# Pomelli Browser Automation

## Job to Be Done
When a user submits a marketing idea, I want to automate Google Pomelli to generate branded images and captions, so I can produce social media assets without manual effort.

## Functional Requirements
- [ ] FR-1: Launch a persistent Playwright browser context (headless Chromium) with state stored at `DATA_DIR/browser-state/`
- [ ] FR-2: Navigate to Pomelli and verify the Google session is active
- [ ] FR-3: If Business DNA profile doesn't exist, create one by entering the configured website URL and waiting for analysis (~60s)
- [ ] FR-4: Create a new campaign from the user's idea text
- [ ] FR-5: Wait for Pomelli's AI generation to complete (~30-60s) using proper wait strategies
- [ ] FR-6: Extract generated images — download actual image files (not screenshots) to `DATA_DIR/assets/`
- [ ] FR-7: Extract generated caption/copy text from the campaign output
- [ ] FR-8: Save extracted assets (image path + caption) to the database and set status to `pending_review`
- [ ] FR-9: Abstract all Pomelli UI selectors into a dedicated selectors object for easy maintenance
- [ ] FR-10: Take debug screenshots at each automation step, saved to `DATA_DIR/debug/`
- [ ] FR-11: Add 2-5 second delays between actions to mimic human behavior and avoid bot detection

## Non-Functional Requirements
- [ ] NFR-1: Handle Pomelli UI changes gracefully — use resilient selectors (data-testid, aria-label, text content over CSS classes)
- [ ] NFR-2: Timeout after 120s if generation doesn't complete
- [ ] NFR-3: Never run multiple Pomelli automations in parallel

## Acceptance Criteria
1. Given a valid session and idea text, when automation runs, then an image file exists on disk and caption is stored in DB
2. Given an expired Google session, when automation runs, then it reports auth failure and sets post status to `failed`
3. Given Pomelli generation timeout, when 120s passes, then automation aborts and logs the failure with a screenshot
4. Given any automation step, then a debug screenshot is saved for that step

## Out of Scope
- Automated Google login (user logs in manually)
- Selecting between multiple generated variants (grab the first/best)
- VNC/noVNC live browser view (future enhancement)

## Dependencies
- Requires: Playwright + Chromium
- Requires: Persistent volume for browser state and assets
- Requires: Database (posts table)
- Requires: config.ts for WEBSITE_URL

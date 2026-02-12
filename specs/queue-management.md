# Queue Management API

## Job to Be Done
When Pomelli generates assets, I want to review, edit, approve, or reject them in a queue, so I can control what gets posted to X.

## Functional Requirements
- [ ] FR-1: `POST /api/ideas` — Accept an idea string, create a post record with status `generating`, trigger Pomelli automation
- [ ] FR-2: `GET /api/queue` — List all posts with status `pending_review`, include image preview URL and caption
- [ ] FR-3: `POST /api/queue/:id/approve` — Set status to `approved`; if no scheduled_at, post to X immediately
- [ ] FR-4: `POST /api/queue/:id/edit` — Update the edited_caption field for a queued post
- [ ] FR-5: `DELETE /api/queue/:id` — Reject/delete a queued post (set status to a rejected state or delete record)
- [ ] FR-6: `GET /api/history` — List all posts with status `posted`, include tweet URLs and timestamps
- [ ] FR-7: Serve downloaded Pomelli images as static files for preview in the dashboard
- [ ] FR-8: SQLite database with posts and settings tables (schema per PRD)
- [ ] FR-9: Database migrations — create tables on first run if they don't exist

## Non-Functional Requirements
- [ ] NFR-1: Use bun:sqlite for database access
- [ ] NFR-2: All API routes return JSON
- [ ] NFR-3: Validate idea text is non-empty on submission

## Acceptance Criteria
1. Given an idea submission, when POST /api/ideas is called, then a post record is created with status `generating`
2. Given posts in `pending_review` status, when GET /api/queue is called, then all pending posts are returned with captions and image URLs
3. Given an approved post with no scheduled time, when approved, then it is posted to X and status becomes `posted`
4. Given an edited caption, when saved, then the edited_caption field is updated and used for posting instead of pomelli_caption
5. Given a rejected post, when deleted, then it no longer appears in the queue

## Out of Scope
- Pagination (not needed at MVP scale)
- Bulk operations (approve all, reject all)
- WebSocket real-time updates

## Dependencies
- Requires: X posting service (for immediate posting on approve)
- Requires: Pomelli automation (triggered by idea submission)

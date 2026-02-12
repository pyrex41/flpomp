# Scheduled Posting

## Job to Be Done
When I approve a post with a future time, I want it to be posted automatically at that time, so I can batch-prepare content and have it go out on schedule.

## Functional Requirements
- [ ] FR-1: Accept optional `scheduled_at` datetime when submitting an idea or approving a post
- [ ] FR-2: Approved posts with `scheduled_at` in the future stay in `approved` status until due
- [ ] FR-3: Cron job runs every minute checking for approved posts where `scheduled_at <= now`
- [ ] FR-4: Due posts are sent to X posting service automatically
- [ ] FR-5: Use `croner` package for in-process cron scheduling
- [ ] FR-6: Posts approved with no `scheduled_at` are posted immediately (no cron delay)

## Non-Functional Requirements
- [ ] NFR-1: Cron job must be lightweight — just a DB query and conditional posting
- [ ] NFR-2: Handle cron failures gracefully — don't crash the server, log and retry next minute

## Acceptance Criteria
1. Given a post approved with scheduled_at 10 minutes from now, when 10 minutes pass, then the post is published to X
2. Given a post approved with no scheduled_at, when approved, then it is posted immediately
3. Given cron runs and X posting fails, then the post status is set to `failed` and error is logged
4. Given server restart, when cron initializes, then it picks up any overdue scheduled posts

## Out of Scope
- Recurring/repeating schedules
- Timezone management (all times in UTC)
- Queue priority ordering

## Dependencies
- Requires: X posting service
- Requires: Database (posts table with scheduled_at column)

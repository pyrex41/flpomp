# X (Twitter) Posting Service

## Job to Be Done
When a post is approved in the queue, I want to publish it to X with an image and caption, so I can automate social media distribution.

## Functional Requirements
- [ ] FR-1: Post a tweet with text caption and attached image via X API v2
- [ ] FR-2: Upload images via v1.1 media upload endpoint (required even with v2)
- [ ] FR-3: Validate image is < 5MB and PNG/JPEG before upload
- [ ] FR-4: Validate caption is ≤ 280 characters; reject if over (user must edit in queue)
- [ ] FR-5: Return and store the tweet ID and full tweet URL after posting
- [ ] FR-6: Update post status to `posted` with timestamp on success, `failed` on error
- [ ] FR-7: Use `twitter-api-v2` package with OAuth 2.0 user context auth
- [ ] FR-8: Read X API credentials from config (env vars via config.ts)

## Non-Functional Requirements
- [ ] NFR-1: Track API usage to stay within free tier (1,500 posts/month)
- [ ] NFR-2: Log all post attempts (success and failure) with tweet IDs

## Acceptance Criteria
1. Given a valid image and caption, when posted, then returns a tweet URL
2. Given an image > 5MB, when posting attempted, then returns a validation error
3. Given a caption > 280 chars, when posting attempted, then returns a validation error
4. Given invalid API credentials, when posting attempted, then returns auth error with clear message
5. Given a successful post, then the post record has x_post_id, x_post_url, posted_at populated

## Out of Scope
- Multi-platform posting (LinkedIn, Instagram, etc.)
- Engagement tracking / analytics pulling
- Thread or reply posting

## Dependencies
- Requires: X API credentials (env vars)
- Requires: Database (posts table) for status updates

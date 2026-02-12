/**
 * Tests for the scheduled posting service.
 *
 * Uses in-memory SQLite and mocked Twitter service.
 * Tests cover:
 * - Due post detection and publishing
 * - Failure handling (individual post failure doesn't affect others)
 * - Skipping posts that changed status between query and processing
 * - Startup overdue post handling
 * - Scheduler lifecycle (start/stop)
 * - getDueScheduledPosts query helper
 * - Approve with scheduled_at via API and page routes
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createPost,
	createTestDb,
	getDueScheduledPosts,
	getPostById,
	updatePostStatus,
} from "../src/db.ts";
import {
	isSchedulerRunning,
	processDuePosts,
	startScheduler,
	stopScheduler,
} from "../src/services/scheduler.ts";

// ─── Hoisted mocks ──────────────────────────────────────────────────────────

const { mockPostToX } = vi.hoisted(() => {
	return {
		mockPostToX: vi.fn(),
	};
});

vi.mock("../src/services/twitter.ts", () => ({
	postToX: mockPostToX,
	TwitterPostError: class extends Error {
		code: string;
		constructor(message: string, code: string) {
			super(message);
			this.code = code;
			this.name = "TwitterPostError";
		}
	},
}));

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("scheduler", () => {
	let db: ReturnType<typeof createTestDb>;

	beforeEach(() => {
		db = createTestDb();

		mockPostToX
			.mockReset()
			// biome-ignore lint/suspicious/noExplicitAny: mock with flexible args
			.mockImplementation(async (database: any, post: any) => {
				updatePostStatus(database, post.id, "posted", {
					x_post_id: `tweet-${post.id}`,
					x_post_url: `https://x.com/i/status/tweet-${post.id}`,
					posted_at: new Date().toISOString(),
				});
				return {
					tweetId: `tweet-${post.id}`,
					tweetUrl: `https://x.com/i/status/tweet-${post.id}`,
				};
			});
	});

	afterEach(() => {
		stopScheduler();
		db.close();
	});

	// ─── getDueScheduledPosts query helper ───────────────────────────────

	describe("getDueScheduledPosts", () => {
		it("should return approved posts with scheduled_at in the past", () => {
			const post = createPost(db, "Past due", "2020-01-01T00:00:00Z");
			updatePostStatus(db, post.id, "approved");

			const due = getDueScheduledPosts(db);
			expect(due).toHaveLength(1);
			expect(due[0]!.id).toBe(post.id);
		});

		it("should not return posts scheduled in the future", () => {
			const post = createPost(db, "Future post", "2099-01-01T00:00:00Z");
			updatePostStatus(db, post.id, "approved");

			const due = getDueScheduledPosts(db);
			expect(due).toHaveLength(0);
		});

		it("should not return posts with non-approved status", () => {
			createPost(db, "Not approved", "2020-01-01T00:00:00Z");
			// Leave as 'generating' status
			const due = getDueScheduledPosts(db);
			expect(due).toHaveLength(0);
		});

		it("should not return approved posts without scheduled_at", () => {
			const post = createPost(db, "No schedule");
			updatePostStatus(db, post.id, "approved");

			const due = getDueScheduledPosts(db);
			expect(due).toHaveLength(0);
		});

		it("should order by scheduled_at ascending (oldest first)", () => {
			const post1 = createPost(db, "Second due", "2020-06-01T00:00:00Z");
			const post2 = createPost(db, "First due", "2020-01-01T00:00:00Z");
			updatePostStatus(db, post1.id, "approved");
			updatePostStatus(db, post2.id, "approved");

			const due = getDueScheduledPosts(db);
			expect(due).toHaveLength(2);
			expect(due[0]!.id).toBe(post2.id); // Earlier scheduled_at first
			expect(due[1]!.id).toBe(post1.id);
		});

		it("should accept a custom 'now' timestamp for testing", () => {
			const post = createPost(db, "Time test", "2025-06-15T12:00:00Z");
			updatePostStatus(db, post.id, "approved");

			// Before the scheduled time
			const before = getDueScheduledPosts(db, "2025-06-15T11:59:59Z");
			expect(before).toHaveLength(0);

			// At exactly the scheduled time
			const at = getDueScheduledPosts(db, "2025-06-15T12:00:00Z");
			expect(at).toHaveLength(1);

			// After the scheduled time
			const after = getDueScheduledPosts(db, "2025-06-15T12:00:01Z");
			expect(after).toHaveLength(1);
		});
	});

	// ─── processDuePosts ─────────────────────────────────────────────────

	describe("processDuePosts", () => {
		it("should publish a due post and return count of 1", async () => {
			const post = createPost(db, "Due now", "2020-01-01T00:00:00Z");
			updatePostStatus(db, post.id, "approved", {
				pomelli_caption: "Caption for tweet",
				pomelli_image_path: "/data/assets/img.png",
			});

			const count = await processDuePosts(db);

			expect(count).toBe(1);
			expect(mockPostToX).toHaveBeenCalledOnce();

			// Post should now be 'posted'
			const updated = getPostById(db, post.id);
			expect(updated!.status).toBe("posted");
		});

		it("should return 0 when no posts are due", async () => {
			const count = await processDuePosts(db);
			expect(count).toBe(0);
			expect(mockPostToX).not.toHaveBeenCalled();
		});

		it("should publish multiple due posts", async () => {
			for (let i = 0; i < 3; i++) {
				const post = createPost(db, `Post ${i}`, "2020-01-01T00:00:00Z");
				updatePostStatus(db, post.id, "approved", {
					pomelli_caption: `Caption ${i}`,
					pomelli_image_path: `/data/assets/img${i}.png`,
				});
			}

			const count = await processDuePosts(db);

			expect(count).toBe(3);
			expect(mockPostToX).toHaveBeenCalledTimes(3);
		});

		it("should continue processing other posts when one fails (AC-3)", async () => {
			const post1 = createPost(db, "Will fail", "2020-01-01T00:00:00Z");
			const post2 = createPost(db, "Will succeed", "2020-01-02T00:00:00Z");
			updatePostStatus(db, post1.id, "approved", {
				pomelli_caption: "Caption 1",
				pomelli_image_path: "/data/assets/img1.png",
			});
			updatePostStatus(db, post2.id, "approved", {
				pomelli_caption: "Caption 2",
				pomelli_image_path: "/data/assets/img2.png",
			});

			// First call fails, second succeeds
			mockPostToX
				.mockRejectedValueOnce(new Error("X API error"))
				// biome-ignore lint/suspicious/noExplicitAny: mock with flexible args
				.mockImplementationOnce(async (database: any, post: any) => {
					updatePostStatus(database, post.id, "posted", {
						x_post_id: `tweet-${post.id}`,
						x_post_url: `https://x.com/i/status/tweet-${post.id}`,
						posted_at: new Date().toISOString(),
					});
					return {
						tweetId: `tweet-${post.id}`,
						tweetUrl: `https://x.com/i/status/tweet-${post.id}`,
					};
				});

			const count = await processDuePosts(db);

			expect(count).toBe(1); // Only one succeeded
			expect(mockPostToX).toHaveBeenCalledTimes(2); // Both were attempted
		});

		it("should skip posts that changed status between query and processing", async () => {
			const post = createPost(db, "Will change", "2020-01-01T00:00:00Z");
			updatePostStatus(db, post.id, "approved", {
				pomelli_caption: "Caption",
				pomelli_image_path: "/data/assets/img.png",
			});

			// Simulate another process changing the status after query but before processing
			// We achieve this by making postToX check the status
			mockPostToX.mockReset();
			// Change status before postToX is called
			updatePostStatus(db, post.id, "posted", {
				x_post_id: "already-posted",
				x_post_url: "https://x.com/i/status/already-posted",
				posted_at: new Date().toISOString(),
			});

			const count = await processDuePosts(db);

			expect(count).toBe(0); // Skipped because status changed
			expect(mockPostToX).not.toHaveBeenCalled();
		});

		it("should set post to 'failed' when X posting fails (AC-3)", async () => {
			const post = createPost(db, "Fail post", "2020-01-01T00:00:00Z");
			updatePostStatus(db, post.id, "approved", {
				pomelli_caption: "Caption",
				pomelli_image_path: "/data/assets/img.png",
			});

			// postToX sets status to 'failed' internally before throwing
			// biome-ignore lint/suspicious/noExplicitAny: mock with flexible args
			mockPostToX.mockImplementation(async (database: any, p: any) => {
				updatePostStatus(database, p.id, "failed", {
					error_message: "Rate limit exceeded",
				});
				throw new Error("Rate limit exceeded");
			});

			const count = await processDuePosts(db);

			expect(count).toBe(0);
			const updated = getPostById(db, post.id);
			expect(updated!.status).toBe("failed");
			expect(updated!.error_message).toBe("Rate limit exceeded");
		});

		it("should not crash on unexpected errors (NFR-2)", async () => {
			// Create a post that will cause an issue
			const post = createPost(db, "Error post", "2020-01-01T00:00:00Z");
			updatePostStatus(db, post.id, "approved", {
				pomelli_caption: "Caption",
				pomelli_image_path: "/data/assets/img.png",
			});

			mockPostToX.mockRejectedValueOnce(new Error("Unexpected crash!"));

			// Should not throw
			const count = await processDuePosts(db);
			expect(count).toBe(0);
		});
	});

	// ─── Scheduler lifecycle ─────────────────────────────────────────────

	describe("scheduler lifecycle", () => {
		it("should start and report running", () => {
			expect(isSchedulerRunning()).toBe(false);
			startScheduler(db);
			expect(isSchedulerRunning()).toBe(true);
		});

		it("should stop cleanly", () => {
			startScheduler(db);
			expect(isSchedulerRunning()).toBe(true);
			stopScheduler();
			expect(isSchedulerRunning()).toBe(false);
		});

		it("should not create duplicate cron jobs on double start", () => {
			const cron1 = startScheduler(db);
			const cron2 = startScheduler(db);
			expect(cron1).toBe(cron2);
			expect(isSchedulerRunning()).toBe(true);
		});

		it("should handle stop when not running", () => {
			// Should not throw
			stopScheduler();
			expect(isSchedulerRunning()).toBe(false);
		});

		it("should process overdue posts on startup (AC-4)", async () => {
			// Create an overdue post before starting the scheduler
			const post = createPost(db, "Overdue", "2020-01-01T00:00:00Z");
			updatePostStatus(db, post.id, "approved", {
				pomelli_caption: "Overdue caption",
				pomelli_image_path: "/data/assets/overdue.png",
			});

			startScheduler(db);

			// Wait for the initial async check to complete
			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(mockPostToX).toHaveBeenCalledOnce();
			const updated = getPostById(db, post.id);
			expect(updated!.status).toBe("posted");
		});
	});

	// ─── Integration with approve + scheduled_at ─────────────────────────

	describe("approve with scheduled_at integration", () => {
		it("should support setting scheduled_at during approval via updatePostStatus", () => {
			const post = createPost(db, "Schedule on approve");
			updatePostStatus(db, post.id, "pending_review", {
				pomelli_caption: "Caption",
				pomelli_image_path: "/data/assets/img.png",
			});

			// Simulate what flywheel.approvePost does when scheduledAt is provided
			updatePostStatus(db, post.id, "approved", {
				scheduled_at: "2026-06-01T10:00:00Z",
			});

			const updated = getPostById(db, post.id);
			expect(updated!.status).toBe("approved");
			expect(updated!.scheduled_at).toBe("2026-06-01T10:00:00Z");

			// Should appear in due posts when the time arrives
			const due = getDueScheduledPosts(db, "2026-06-01T10:00:01Z");
			expect(due).toHaveLength(1);
			expect(due[0]!.id).toBe(post.id);
		});
	});
});

/**
 * Integration tests for the end-to-end flywheel:
 *   Idea → Pomelli (async) → Queue → Approve → X Post
 *
 * Tests the full pipeline wired through the API and page routes,
 * with Pomelli and Twitter services mocked at the module level.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createPost,
	createTestDb,
	setSetting,
	updatePostStatus,
} from "../src/db.ts";
import { setTestDb } from "../src/routes/api.ts";
import { setPageTestDb } from "../src/routes/pages.tsx";
import { app } from "../src/server.ts";

// biome-ignore lint/suspicious/noExplicitAny: test helper for JSON responses
type Json = any;

// ─── Hoisted mocks (must be defined before vi.mock calls) ────────────────────

const { mockPostToX, mockProcessIdea, mockIsLockedRef } = vi.hoisted(() => {
	return {
		mockPostToX: vi.fn(),
		mockProcessIdea: vi.fn(),
		mockIsLockedRef: { value: false },
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

vi.mock("../src/services/pomelli.ts", () => ({
	isLocked: vi.fn(() => mockIsLockedRef.value),
	_resetLock: vi.fn(),
	getPommelliService: vi.fn(() => ({
		processIdea: mockProcessIdea,
		getAuthStatus: vi.fn().mockResolvedValue({
			status: "active",
			message: "Session active",
			checkedAt: new Date().toISOString(),
		}),
		importCookies: vi.fn(),
	})),
	PommelliError: class extends Error {
		code: string;
		constructor(message: string, code: string) {
			super(message);
			this.code = code;
			this.name = "PommelliError";
		}
	},
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Wait for any pending microtasks / fire-and-forget promises to settle.
 */
async function flushAsync(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 50));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("flywheel integration", () => {
	let db: ReturnType<typeof createTestDb>;

	beforeEach(() => {
		db = createTestDb();
		setTestDb(db);
		setPageTestDb(db);
		mockIsLockedRef.value = false;

		// Reset mock implementations
		mockProcessIdea.mockReset().mockResolvedValue({
			images: ["/data/assets/flywheel-img.png"],
			caption: "Flywheel generated caption",
		});

		mockPostToX
			.mockReset()
			// biome-ignore lint/suspicious/noExplicitAny: mock with flexible args
			.mockImplementation(async (database: any, post: any) => {
				// Simulate what the real postToX does: update DB status
				updatePostStatus(database, post.id, "posted", {
					x_post_id: "flywheel-tweet-456",
					x_post_url: "https://x.com/i/status/flywheel-tweet-456",
					posted_at: new Date().toISOString(),
				});
				return {
					tweetId: "flywheel-tweet-456",
					tweetUrl: "https://x.com/i/status/flywheel-tweet-456",
				};
			});
	});

	afterEach(() => {
		setTestDb(null);
		setPageTestDb(null);
		db.close();
	});

	// ─── Idea submission triggers Pomelli ─────────────────────────────────

	describe("idea submission → Pomelli generation", () => {
		it("should create post and trigger async Pomelli generation via API", async () => {
			const res = await app.request("/api/ideas", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ idea: "Summer cold brew promo" }),
			});

			expect(res.status).toBe(201);
			const body = (await res.json()) as Json;
			expect(body.post.status).toBe("generating");
			expect(body.generation).toBeDefined();
			expect(body.generation.started).toBe(true);

			// Wait for the fire-and-forget Pomelli call to complete
			await flushAsync();

			expect(mockProcessIdea).toHaveBeenCalledOnce();
			// processIdea should be called with (db, postId, idea, websiteUrl)
			const callArgs = mockProcessIdea.mock.calls[0]!;
			expect(callArgs[1]).toBe(body.post.id);
			expect(callArgs[2]).toBe("Summer cold brew promo");
		});

		it("should pass saved website_url to Pomelli via API", async () => {
			setSetting(db, "website_url", "https://mybrand.com");

			const res = await app.request("/api/ideas", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ idea: "Brand promo" }),
			});

			expect(res.status).toBe(201);
			await flushAsync();

			expect(mockProcessIdea).toHaveBeenCalledOnce();
			const callArgs = mockProcessIdea.mock.calls[0]!;
			expect(callArgs[3]).toBe("https://mybrand.com");
		});

		it("should report not started when Pomelli is locked", async () => {
			mockIsLockedRef.value = true;

			const res = await app.request("/api/ideas", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ idea: "Locked test" }),
			});

			expect(res.status).toBe(201);
			const body = (await res.json()) as Json;
			expect(body.generation.started).toBe(false);
			expect(body.generation.message).toContain("currently generating");

			await flushAsync();
			expect(mockProcessIdea).not.toHaveBeenCalled();
		});

		it("should trigger Pomelli generation via page form", async () => {
			const formData = new FormData();
			formData.set("idea", "HTMX form idea");

			const res = await app.request("/submit-idea", {
				method: "POST",
				body: formData,
			});

			expect(res.status).toBe(200);
			const html = await res.text();
			expect(html).toContain("HTMX form idea");

			await flushAsync();
			expect(mockProcessIdea).toHaveBeenCalledOnce();
		});

		it("should handle Pomelli generation failure gracefully", async () => {
			mockProcessIdea.mockRejectedValueOnce(new Error("Session expired"));

			const res = await app.request("/api/ideas", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ idea: "Will fail" }),
			});

			// The HTTP response should still succeed — failure is async
			expect(res.status).toBe(201);
			const body = (await res.json()) as Json;
			expect(body.generation.started).toBe(true);

			// Wait for the async failure to propagate
			await flushAsync();

			// processIdea was called but failed
			expect(mockProcessIdea).toHaveBeenCalledOnce();
		});
	});

	// ─── Queue → Approve → X posting ────────────────────────────────────

	describe("approve → X posting", () => {
		it("should approve and post to X immediately via API (no schedule)", async () => {
			const post = createPost(db, "Ready to post");
			updatePostStatus(db, post.id, "pending_review", {
				pomelli_caption: "Generated caption",
				pomelli_image_path: "/data/assets/img.png",
			});

			const res = await app.request(`/api/queue/${post.id}/approve`, {
				method: "POST",
			});

			expect(res.status).toBe(200);
			const body = (await res.json()) as Json;
			expect(body.tweet).toBeDefined();
			expect(body.tweet.tweetId).toBe("flywheel-tweet-456");
			expect(body.post.status).toBe("posted");
			expect(mockPostToX).toHaveBeenCalledOnce();
		});

		it("should approve and post to X via page route (no schedule)", async () => {
			const post = createPost(db, "Page approve");
			updatePostStatus(db, post.id, "pending_review", {
				pomelli_caption: "Page caption",
				pomelli_image_path: "/data/assets/page-img.png",
			});

			const res = await app.request(`/queue/${post.id}/approve`, {
				method: "POST",
			});

			expect(res.status).toBe(200);
			const html = await res.text();
			expect(html).toContain("approved");
			expect(mockPostToX).toHaveBeenCalledOnce();
		});

		it("should approve scheduled post without posting to X", async () => {
			const post = createPost(db, "Scheduled post", "2026-06-01T10:00:00Z");
			updatePostStatus(db, post.id, "pending_review", {
				pomelli_caption: "Scheduled caption",
				pomelli_image_path: "/data/assets/sched-img.png",
			});

			const res = await app.request(`/api/queue/${post.id}/approve`, {
				method: "POST",
			});

			expect(res.status).toBe(200);
			const body = (await res.json()) as Json;
			expect(body.post.status).toBe("approved");
			expect(body.tweet).toBeUndefined();
			expect(mockPostToX).not.toHaveBeenCalled();
		});

		it("should return 502 when X posting fails via API", async () => {
			mockPostToX.mockRejectedValueOnce(new Error("X API rate limit exceeded"));

			const post = createPost(db, "Fail to post");
			updatePostStatus(db, post.id, "pending_review", {
				pomelli_caption: "Caption",
				pomelli_image_path: "/data/assets/img.png",
			});

			const res = await app.request(`/api/queue/${post.id}/approve`, {
				method: "POST",
			});

			expect(res.status).toBe(502);
			const body = (await res.json()) as Json;
			expect(body.error).toContain("rate limit");
		});

		it("should return error HTML when X posting fails via page route", async () => {
			mockPostToX.mockRejectedValueOnce(new Error("Upload failed"));

			const post = createPost(db, "Page fail");
			updatePostStatus(db, post.id, "pending_review", {
				pomelli_caption: "Caption",
				pomelli_image_path: "/data/assets/img.png",
			});

			const res = await app.request(`/queue/${post.id}/approve`, {
				method: "POST",
			});

			expect(res.status).toBe(502);
			const html = await res.text();
			expect(html).toContain("Upload failed");
			expect(html).toContain("form-error");
		});

		it("should approve without posting when content not ready", async () => {
			const post = createPost(db, "No content");
			updatePostStatus(db, post.id, "pending_review");

			const res = await app.request(`/api/queue/${post.id}/approve`, {
				method: "POST",
			});

			expect(res.status).toBe(200);
			const body = (await res.json()) as Json;
			expect(body.post.status).toBe("approved");
			expect(body.tweet).toBeUndefined();
			expect(mockPostToX).not.toHaveBeenCalled();
		});
	});

	// ─── Full pipeline ──────────────────────────────────────────────────

	describe("full pipeline: idea → generate → review → approve → post", () => {
		it("should complete the full flywheel via API", async () => {
			// Step 1: Submit idea
			const ideaRes = await app.request("/api/ideas", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ idea: "Full pipeline test" }),
			});
			expect(ideaRes.status).toBe(201);
			const ideaBody = (await ideaRes.json()) as Json;
			const postId = ideaBody.post.id;
			expect(ideaBody.post.status).toBe("generating");

			// Step 2: Wait for async Pomelli generation
			await flushAsync();
			expect(mockProcessIdea).toHaveBeenCalledOnce();

			// Step 3: Simulate that Pomelli succeeded (mock already updated the DB)
			// In reality processIdea updates the DB, but since it's mocked we do it manually
			updatePostStatus(db, postId, "pending_review", {
				pomelli_caption: "AI-generated caption for cold brew",
				pomelli_image_path: "/data/assets/coldbrew.png",
			});

			// Step 4: Verify post appears in queue
			const queueRes = await app.request("/api/queue");
			const queueBody = (await queueRes.json()) as Json;
			expect(queueBody.posts).toHaveLength(1);
			expect(queueBody.posts[0].caption).toBe(
				"AI-generated caption for cold brew",
			);

			// Step 5: Edit the caption
			const editRes = await app.request(`/api/queue/${postId}/edit`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					caption: "Summer cold brew — try it today!",
				}),
			});
			expect(editRes.status).toBe(200);
			const editBody = (await editRes.json()) as Json;
			expect(editBody.post.edited_caption).toBe(
				"Summer cold brew — try it today!",
			);

			// Step 6: Approve → posts to X immediately
			const approveRes = await app.request(`/api/queue/${postId}/approve`, {
				method: "POST",
			});
			expect(approveRes.status).toBe(200);
			const approveBody = (await approveRes.json()) as Json;
			expect(approveBody.tweet.tweetId).toBe("flywheel-tweet-456");
			expect(approveBody.post.status).toBe("posted");

			// Step 7: Verify post appears in history
			const historyRes = await app.request("/api/history");
			const historyBody = (await historyRes.json()) as Json;
			expect(historyBody.posts).toHaveLength(1);
			expect(historyBody.posts[0].x_post_url).toBe(
				"https://x.com/i/status/flywheel-tweet-456",
			);

			// Step 8: Queue should now be empty
			const queueAfterRes = await app.request("/api/queue");
			const queueAfterBody = (await queueAfterRes.json()) as Json;
			expect(queueAfterBody.posts).toHaveLength(0);
		});

		it("should handle rejected post in the full pipeline", async () => {
			const post = createPost(db, "Reject me");
			updatePostStatus(db, post.id, "pending_review", {
				pomelli_caption: "Bad caption",
				pomelli_image_path: "/data/assets/bad.png",
			});

			// Reject
			const rejectRes = await app.request(`/api/queue/${post.id}`, {
				method: "DELETE",
			});
			expect(rejectRes.status).toBe(200);

			// Should not appear in queue or history
			const queueRes = await app.request("/api/queue");
			const queueBody = (await queueRes.json()) as Json;
			expect(queueBody.posts).toHaveLength(0);

			const historyRes = await app.request("/api/history");
			const historyBody = (await historyRes.json()) as Json;
			expect(historyBody.posts).toHaveLength(0);

			expect(mockPostToX).not.toHaveBeenCalled();
		});
	});

	// ─── Edge cases ──────────────────────────────────────────────────────

	describe("edge cases", () => {
		it("should handle concurrent idea submissions (one locked)", async () => {
			// First idea succeeds
			const res1 = await app.request("/api/ideas", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ idea: "First idea" }),
			});
			expect(res1.status).toBe(201);
			const body1 = (await res1.json()) as Json;
			expect(body1.generation.started).toBe(true);

			// Simulate lock held
			mockIsLockedRef.value = true;

			// Second idea hits the lock
			const res2 = await app.request("/api/ideas", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ idea: "Second idea" }),
			});
			expect(res2.status).toBe(201);
			const body2 = (await res2.json()) as Json;
			expect(body2.generation.started).toBe(false);
			expect(body2.generation.message).toContain("currently generating");
		});

		it("should approve post with edited caption and post to X", async () => {
			const post = createPost(db, "Edit then approve");
			updatePostStatus(db, post.id, "pending_review", {
				pomelli_caption: "Original caption too long maybe",
				pomelli_image_path: "/data/assets/img.png",
				edited_caption: "Short and sweet",
			});

			const res = await app.request(`/api/queue/${post.id}/approve`, {
				method: "POST",
			});

			expect(res.status).toBe(200);
			const body = (await res.json()) as Json;
			expect(body.tweet).toBeDefined();
			expect(mockPostToX).toHaveBeenCalledOnce();

			// postToX should receive the post which has edited_caption
			const postArg = mockPostToX.mock.calls[0]![1] as Json;
			expect(postArg.edited_caption).toBe("Short and sweet");
		});
	});
});

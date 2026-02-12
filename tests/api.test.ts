import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPost, createTestDb, updatePostStatus } from "../src/db.ts";
import { setTestDb } from "../src/routes/api.ts";
import { app } from "../src/server.ts";

/**
 * Integration tests for the queue management API routes.
 * Uses an in-memory SQLite database injected via setTestDb().
 */

// biome-ignore lint/suspicious/noExplicitAny: test helper for JSON responses
type Json = any;

// Mock the twitter service so approve doesn't actually call X API
vi.mock("../src/services/twitter.ts", () => ({
	postToX: vi.fn().mockResolvedValue({
		tweetId: "mock-tweet-123",
		tweetUrl: "https://x.com/i/status/mock-tweet-123",
	}),
	TwitterPostError: class extends Error {
		code: string;
		constructor(message: string, code: string) {
			super(message);
			this.code = code;
			this.name = "TwitterPostError";
		}
	},
}));

describe("api routes", () => {
	let db: ReturnType<typeof createTestDb>;

	beforeEach(() => {
		db = createTestDb();
		setTestDb(db);
		vi.clearAllMocks();
	});

	afterEach(() => {
		setTestDb(null);
		db.close();
	});

	// ─── POST /api/ideas ──────────────────────────────────────────────────

	describe("POST /api/ideas", () => {
		it("should create a post with status 'generating'", async () => {
			const res = await app.request("/api/ideas", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ idea: "Summer cold brew promo" }),
			});
			expect(res.status).toBe(201);
			const body = (await res.json()) as Json;
			expect(body.post.idea).toBe("Summer cold brew promo");
			expect(body.post.status).toBe("generating");
			expect(body.post.id).toBeGreaterThan(0);
		});

		it("should accept optional scheduled_at", async () => {
			const res = await app.request("/api/ideas", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					idea: "Scheduled post",
					scheduled_at: "2026-03-01T10:00:00Z",
				}),
			});
			expect(res.status).toBe(201);
			const body = (await res.json()) as Json;
			expect(body.post.scheduled_at).toBe("2026-03-01T10:00:00Z");
		});

		it("should reject empty idea (NFR-3)", async () => {
			const res = await app.request("/api/ideas", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ idea: "" }),
			});
			expect(res.status).toBe(400);
			const body = (await res.json()) as Json;
			expect(body.error).toContain("required");
		});

		it("should reject whitespace-only idea", async () => {
			const res = await app.request("/api/ideas", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ idea: "   " }),
			});
			expect(res.status).toBe(400);
		});

		it("should reject missing idea field", async () => {
			const res = await app.request("/api/ideas", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			});
			expect(res.status).toBe(400);
		});

		it("should reject invalid JSON body", async () => {
			const res = await app.request("/api/ideas", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: "not json",
			});
			expect(res.status).toBe(400);
		});

		it("should trim idea whitespace", async () => {
			const res = await app.request("/api/ideas", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ idea: "  padded idea  " }),
			});
			expect(res.status).toBe(201);
			const body = (await res.json()) as Json;
			expect(body.post.idea).toBe("padded idea");
		});
	});

	// ─── GET /api/queue ───────────────────────────────────────────────────

	describe("GET /api/queue", () => {
		it("should return empty list when no pending posts", async () => {
			const res = await app.request("/api/queue");
			expect(res.status).toBe(200);
			const body = (await res.json()) as Json;
			expect(body.posts).toEqual([]);
		});

		it("should return only pending_review posts", async () => {
			const post1 = createPost(db, "Idea 1");
			const post2 = createPost(db, "Idea 2");
			createPost(db, "Idea 3"); // stays in 'generating'

			updatePostStatus(db, post1.id, "pending_review", {
				pomelli_caption: "Caption 1",
				pomelli_image_path: "/data/assets/img1.png",
			});
			updatePostStatus(db, post2.id, "pending_review", {
				pomelli_caption: "Caption 2",
			});

			const res = await app.request("/api/queue");
			expect(res.status).toBe(200);
			const body = (await res.json()) as Json;
			expect(body.posts).toHaveLength(2);
		});

		it("should include image_url and caption in response", async () => {
			const post = createPost(db, "With image");
			updatePostStatus(db, post.id, "pending_review", {
				pomelli_caption: "My caption",
				pomelli_image_path: "/data/assets/image123.png",
			});

			const res = await app.request("/api/queue");
			const body = (await res.json()) as Json;
			expect(body.posts[0].image_url).toBe("/assets/image123.png");
			expect(body.posts[0].caption).toBe("My caption");
		});

		it("should prefer edited_caption over pomelli_caption", async () => {
			const post = createPost(db, "Edited post");
			updatePostStatus(db, post.id, "pending_review", {
				pomelli_caption: "Original",
				edited_caption: "Edited version",
			});

			const res = await app.request("/api/queue");
			const body = (await res.json()) as Json;
			expect(body.posts[0].caption).toBe("Edited version");
		});

		it("should handle posts with no image", async () => {
			const post = createPost(db, "No image");
			updatePostStatus(db, post.id, "pending_review", {
				pomelli_caption: "Caption only",
			});

			const res = await app.request("/api/queue");
			const body = (await res.json()) as Json;
			expect(body.posts[0].image_url).toBeNull();
		});
	});

	// ─── POST /api/queue/:id/approve ──────────────────────────────────────

	describe("POST /api/queue/:id/approve", () => {
		it("should approve a pending_review post with schedule", async () => {
			const post = createPost(db, "Scheduled", "2026-06-01T10:00:00Z");
			updatePostStatus(db, post.id, "pending_review", {
				pomelli_caption: "Caption",
				pomelli_image_path: "/data/assets/img.png",
			});

			const res = await app.request(`/api/queue/${post.id}/approve`, {
				method: "POST",
			});
			expect(res.status).toBe(200);
			const body = (await res.json()) as Json;
			expect(body.post.status).toBe("approved");
		});

		it("should approve and post to X immediately when no schedule", async () => {
			const { postToX } = await import("../src/services/twitter.ts");

			const post = createPost(db, "Post now");
			updatePostStatus(db, post.id, "pending_review", {
				pomelli_caption: "Ready to go",
				pomelli_image_path: "/data/assets/img.png",
			});

			const res = await app.request(`/api/queue/${post.id}/approve`, {
				method: "POST",
			});
			expect(res.status).toBe(200);
			const body = (await res.json()) as Json;
			expect(body.tweet).toBeDefined();
			expect(body.tweet.tweetId).toBe("mock-tweet-123");
			expect(postToX).toHaveBeenCalled();
		});

		it("should approve without posting if content not ready", async () => {
			const post = createPost(db, "No content yet");
			updatePostStatus(db, post.id, "pending_review");

			const res = await app.request(`/api/queue/${post.id}/approve`, {
				method: "POST",
			});
			expect(res.status).toBe(200);
			const body = (await res.json()) as Json;
			expect(body.post.status).toBe("approved");
			expect(body.tweet).toBeUndefined();
		});

		it("should return 404 for non-existent post", async () => {
			const res = await app.request("/api/queue/9999/approve", {
				method: "POST",
			});
			expect(res.status).toBe(404);
		});

		it("should return 409 for non-pending_review post", async () => {
			const post = createPost(db, "Already generating");

			const res = await app.request(`/api/queue/${post.id}/approve`, {
				method: "POST",
			});
			expect(res.status).toBe(409);
			const body = (await res.json()) as Json;
			expect(body.error).toContain("generating");
		});

		it("should return 400 for invalid post ID", async () => {
			const res = await app.request("/api/queue/abc/approve", {
				method: "POST",
			});
			expect(res.status).toBe(400);
		});

		it("should handle X API failure gracefully", async () => {
			const { postToX } = await import("../src/services/twitter.ts");
			vi.mocked(postToX).mockRejectedValueOnce(
				new Error("X API rate limit exceeded"),
			);

			const post = createPost(db, "Will fail");
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
	});

	// ─── POST /api/queue/:id/edit ─────────────────────────────────────────

	describe("POST /api/queue/:id/edit", () => {
		it("should update edited_caption", async () => {
			const post = createPost(db, "Edit me");
			updatePostStatus(db, post.id, "pending_review", {
				pomelli_caption: "Original caption",
			});

			const res = await app.request(`/api/queue/${post.id}/edit`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ caption: "Updated caption" }),
			});
			expect(res.status).toBe(200);
			const body = (await res.json()) as Json;
			expect(body.post.edited_caption).toBe("Updated caption");
		});

		it("should reject empty caption", async () => {
			const post = createPost(db, "Edit me");
			updatePostStatus(db, post.id, "pending_review");

			const res = await app.request(`/api/queue/${post.id}/edit`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ caption: "" }),
			});
			expect(res.status).toBe(400);
		});

		it("should reject caption over 280 characters", async () => {
			const post = createPost(db, "Edit me");
			updatePostStatus(db, post.id, "pending_review");

			const longCaption = "x".repeat(281);
			const res = await app.request(`/api/queue/${post.id}/edit`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ caption: longCaption }),
			});
			expect(res.status).toBe(400);
			const body = (await res.json()) as Json;
			expect(body.error).toContain("281");
			expect(body.error).toContain("280");
		});

		it("should accept caption at exactly 280 characters", async () => {
			const post = createPost(db, "Edit me");
			updatePostStatus(db, post.id, "pending_review");

			const exactCaption = "x".repeat(280);
			const res = await app.request(`/api/queue/${post.id}/edit`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ caption: exactCaption }),
			});
			expect(res.status).toBe(200);
		});

		it("should return 404 for non-existent post", async () => {
			const res = await app.request("/api/queue/9999/edit", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ caption: "New caption" }),
			});
			expect(res.status).toBe(404);
		});

		it("should return 409 for non-pending_review post", async () => {
			const post = createPost(db, "Not pending");

			const res = await app.request(`/api/queue/${post.id}/edit`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ caption: "New caption" }),
			});
			expect(res.status).toBe(409);
		});

		it("should reject missing caption field", async () => {
			const post = createPost(db, "Edit me");
			updatePostStatus(db, post.id, "pending_review");

			const res = await app.request(`/api/queue/${post.id}/edit`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			});
			expect(res.status).toBe(400);
		});
	});

	// ─── DELETE /api/queue/:id ─────────────────────────────────────────────

	describe("DELETE /api/queue/:id", () => {
		it("should reject a pending_review post", async () => {
			const post = createPost(db, "Reject me");
			updatePostStatus(db, post.id, "pending_review");

			const res = await app.request(`/api/queue/${post.id}`, {
				method: "DELETE",
			});
			expect(res.status).toBe(200);
			const body = (await res.json()) as Json;
			expect(body.success).toBe(true);
		});

		it("should set status to rejected", async () => {
			const post = createPost(db, "Reject me");
			updatePostStatus(db, post.id, "pending_review");

			await app.request(`/api/queue/${post.id}`, { method: "DELETE" });

			// Verify the post no longer appears in queue
			const queueRes = await app.request("/api/queue");
			const queueBody = (await queueRes.json()) as Json;
			expect(queueBody.posts).toHaveLength(0);
		});

		it("should return 404 for non-existent post", async () => {
			const res = await app.request("/api/queue/9999", {
				method: "DELETE",
			});
			expect(res.status).toBe(404);
		});

		it("should return 409 for non-pending_review post", async () => {
			const post = createPost(db, "Already generating");

			const res = await app.request(`/api/queue/${post.id}`, {
				method: "DELETE",
			});
			expect(res.status).toBe(409);
		});

		it("should return 400 for invalid ID", async () => {
			const res = await app.request("/api/queue/abc", {
				method: "DELETE",
			});
			expect(res.status).toBe(400);
		});
	});

	// ─── GET /api/history ─────────────────────────────────────────────────

	describe("GET /api/history", () => {
		it("should return empty list when no posted content", async () => {
			const res = await app.request("/api/history");
			expect(res.status).toBe(200);
			const body = (await res.json()) as Json;
			expect(body.posts).toEqual([]);
		});

		it("should return only posted items with tweet URLs", async () => {
			const post = createPost(db, "Posted idea");
			updatePostStatus(db, post.id, "posted", {
				pomelli_caption: "Caption",
				pomelli_image_path: "/data/assets/img.png",
				x_post_id: "tweet-456",
				x_post_url: "https://x.com/i/status/tweet-456",
				posted_at: "2026-02-12T12:00:00Z",
			});

			// Also create a non-posted item (should not appear)
			createPost(db, "Still generating");

			const res = await app.request("/api/history");
			const body = (await res.json()) as Json;
			expect(body.posts).toHaveLength(1);
			expect(body.posts[0].x_post_url).toBe("https://x.com/i/status/tweet-456");
			expect(body.posts[0].image_url).toBe("/assets/img.png");
		});
	});

	// ─── POST /api/settings ───────────────────────────────────────────────

	describe("POST /api/settings", () => {
		it("should update website_url setting", async () => {
			const res = await app.request("/api/settings", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ website_url: "https://example.com" }),
			});
			expect(res.status).toBe(200);
			const body = (await res.json()) as Json;
			expect(body.settings.website_url).toBe("https://example.com");
		});

		it("should reject empty body", async () => {
			const res = await app.request("/api/settings", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: "not json",
			});
			expect(res.status).toBe(400);
		});

		it("should reject unknown settings keys", async () => {
			const res = await app.request("/api/settings", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ unknown_key: "value" }),
			});
			expect(res.status).toBe(400);
			const body = (await res.json()) as Json;
			expect(body.error).toContain("No valid settings");
		});

		it("should ignore unknown keys but save valid ones", async () => {
			const res = await app.request("/api/settings", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					website_url: "https://valid.com",
					invalid_key: "ignored",
				}),
			});
			expect(res.status).toBe(200);
			const body = (await res.json()) as Json;
			expect(body.settings.website_url).toBe("https://valid.com");
			expect(body.settings.invalid_key).toBeUndefined();
		});
	});

	// ─── GET /api/settings ────────────────────────────────────────────────

	describe("GET /api/settings", () => {
		it("should return default empty settings", async () => {
			const res = await app.request("/api/settings");
			expect(res.status).toBe(200);
			const body = (await res.json()) as Json;
			expect(body.settings.website_url).toBe("");
		});

		it("should return saved settings", async () => {
			// First save a setting
			await app.request("/api/settings", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ website_url: "https://saved.com" }),
			});

			const res = await app.request("/api/settings");
			const body = (await res.json()) as Json;
			expect(body.settings.website_url).toBe("https://saved.com");
		});
	});
});

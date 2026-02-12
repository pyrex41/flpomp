import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createPost,
	createTestDb,
	getSetting,
	setSetting,
	updatePostStatus,
} from "../src/db.ts";
import { setPageTestDb } from "../src/routes/pages.tsx";
import { app } from "../src/server.ts";

/**
 * Integration tests for the HTML page routes.
 * Uses an in-memory SQLite database injected via setPageTestDb().
 */

// Mock the twitter service (imported transitively via server -> api -> twitter)
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

// Mock the Pomelli service (used by settings page session status)
const mockGetAuthStatus = vi.fn().mockResolvedValue({
	status: "active",
	message: "Authenticated with Google",
	checkedAt: new Date().toISOString(),
});

vi.mock("../src/services/pomelli.ts", () => ({
	getPommelliService: vi.fn(() => ({
		getAuthStatus: mockGetAuthStatus,
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

describe("page routes", () => {
	let db: ReturnType<typeof createTestDb>;

	beforeEach(() => {
		db = createTestDb();
		setPageTestDb(db);
	});

	afterEach(() => {
		setPageTestDb(null);
		db.close();
	});

	// ─── GET / (New Post page) ───────────────────────────────────────────

	describe("GET /", () => {
		it("should return 200 with the New Post page", async () => {
			const res = await app.request("/");
			expect(res.status).toBe(200);

			const html = await res.text();
			expect(html).toContain("New Post");
			expect(html).toContain("Pomelli Flywheel");
		});

		it("should include the HTMX form targeting /submit-idea", async () => {
			const res = await app.request("/");
			const html = await res.text();

			expect(html).toContain('hx-post="/submit-idea"');
			expect(html).toContain('name="idea"');
			expect(html).toContain('name="scheduled_at"');
			expect(html).toContain("Generate");
		});

		it("should include HTMX polling for recent activity", async () => {
			const res = await app.request("/");
			const html = await res.text();

			expect(html).toContain('hx-get="/partials/recent"');
			expect(html).toContain("every 5s");
		});

		it("should show 'no recent activity' when empty", async () => {
			const res = await app.request("/");
			const html = await res.text();

			expect(html).toContain("No recent activity");
		});

		it("should display recent posts when they exist", async () => {
			createPost(db, "Summer promo idea");
			createPost(db, "Winter campaign concept");

			const res = await app.request("/");
			const html = await res.text();

			expect(html).toContain("Summer promo idea");
			expect(html).toContain("Winter campaign concept");
		});

		it("should show post status badges", async () => {
			const post = createPost(db, "Test idea");
			expect(post.status).toBe("generating");

			const res = await app.request("/");
			const html = await res.text();

			expect(html).toContain("status-generating");
			expect(html).toContain("Generating");
		});

		it("should include navigation links", async () => {
			const res = await app.request("/");
			const html = await res.text();

			expect(html).toContain('href="/"');
			expect(html).toContain('href="/queue"');
			expect(html).toContain('href="/history"');
			expect(html).toContain('href="/settings"');
		});

		it("should include HTMX script", async () => {
			const res = await app.request("/");
			const html = await res.text();

			expect(html).toContain("htmx.org");
		});

		it("should include Pico CSS", async () => {
			const res = await app.request("/");
			const html = await res.text();

			expect(html).toContain("pico");
		});

		it("should limit recent posts to 10", async () => {
			for (let i = 0; i < 15; i++) {
				createPost(db, `Idea number ${i + 1}`);
			}

			const res = await app.request("/");
			const html = await res.text();

			// Latest 10 should be shown (created_at DESC order)
			expect(html).toContain("Idea number 15");
			expect(html).toContain("Idea number 6");
			expect(html).not.toContain("Idea number 5");
		});
	});

	// ─── POST /submit-idea ───────────────────────────────────────────────

	describe("POST /submit-idea", () => {
		it("should create a post and return confirmation HTML", async () => {
			const form = new FormData();
			form.append("idea", "Summer cold brew promo");

			const res = await app.request("/submit-idea", {
				method: "POST",
				body: form,
			});

			expect(res.status).toBe(200);
			const html = await res.text();
			expect(html).toContain("Idea submitted");
			expect(html).toContain("Summer cold brew promo");
			expect(html).toContain("status-generating");
		});

		it("should return 400 for empty idea", async () => {
			const form = new FormData();
			form.append("idea", "   ");

			const res = await app.request("/submit-idea", {
				method: "POST",
				body: form,
			});

			expect(res.status).toBe(400);
			const html = await res.text();
			expect(html).toContain("Please enter an idea");
		});

		it("should return 400 for missing idea field", async () => {
			const form = new FormData();

			const res = await app.request("/submit-idea", {
				method: "POST",
				body: form,
			});

			expect(res.status).toBe(400);
			const html = await res.text();
			expect(html).toContain("Please enter an idea");
		});

		it("should handle scheduled_at", async () => {
			const form = new FormData();
			form.append("idea", "Scheduled post idea");
			form.append("scheduled_at", "2026-03-01T10:00");

			const res = await app.request("/submit-idea", {
				method: "POST",
				body: form,
			});

			expect(res.status).toBe(200);
			const html = await res.text();
			expect(html).toContain("Scheduled post idea");
			expect(html).toContain("Scheduled for");
			expect(html).toContain("2026-03-01T10:00");
		});

		it("should ignore empty scheduled_at", async () => {
			const form = new FormData();
			form.append("idea", "Immediate post");
			form.append("scheduled_at", "");

			const res = await app.request("/submit-idea", {
				method: "POST",
				body: form,
			});

			expect(res.status).toBe(200);
			const html = await res.text();
			expect(html).toContain("Immediate post");
			expect(html).not.toContain("Scheduled for");
		});

		it("should persist the post in the database", async () => {
			const form = new FormData();
			form.append("idea", "Database test idea");

			await app.request("/submit-idea", {
				method: "POST",
				body: form,
			});

			const posts = db
				.query("SELECT * FROM posts WHERE idea = ?")
				.all("Database test idea");
			expect(posts).toHaveLength(1);
		});

		it("should trim whitespace from idea", async () => {
			const form = new FormData();
			form.append("idea", "  trimmed idea  ");

			const res = await app.request("/submit-idea", {
				method: "POST",
				body: form,
			});

			expect(res.status).toBe(200);
			const html = await res.text();
			expect(html).toContain("trimmed idea");
		});
	});

	// ─── GET /partials/recent ────────────────────────────────────────────

	describe("GET /partials/recent", () => {
		it("should return HTML partial (no full layout)", async () => {
			const res = await app.request("/partials/recent");
			expect(res.status).toBe(200);

			const html = await res.text();
			// Should NOT include the full layout (no <html> or <nav>)
			expect(html).not.toContain("<html");
			expect(html).toContain("No recent activity");
		});

		it("should list recent posts", async () => {
			createPost(db, "First idea");
			createPost(db, "Second idea");

			const res = await app.request("/partials/recent");
			const html = await res.text();

			expect(html).toContain("First idea");
			expect(html).toContain("Second idea");
		});

		it("should show status badges for different statuses", async () => {
			createPost(db, "Generating idea");
			const post2 = createPost(db, "Review idea");
			updatePostStatus(db, post2.id, "pending_review");

			const res = await app.request("/partials/recent");
			const html = await res.text();

			expect(html).toContain("status-generating");
			expect(html).toContain("status-pending_review");
		});

		it("should show edited caption when available", async () => {
			const post = createPost(db, "Caption test");
			updatePostStatus(db, post.id, "pending_review", {
				pomelli_caption: "Original caption",
				edited_caption: "Edited caption",
			});

			const res = await app.request("/partials/recent");
			const html = await res.text();

			expect(html).toContain("Edited caption");
		});

		it("should show pomelli caption as fallback", async () => {
			const post = createPost(db, "Fallback caption test");
			updatePostStatus(db, post.id, "pending_review", {
				pomelli_caption: "Pomelli generated caption",
			});

			const res = await app.request("/partials/recent");
			const html = await res.text();

			expect(html).toContain("Pomelli generated caption");
		});
	});

	// ─── Queue page ──────────────────────────────────────────────────────

	describe("GET /queue", () => {
		it("should return 200 with queue page", async () => {
			const res = await app.request("/queue");
			expect(res.status).toBe(200);

			const html = await res.text();
			expect(html).toContain("Queue");
			expect(html).toContain("Pomelli Flywheel");
		});

		it("should show empty state when no posts pending review", async () => {
			const res = await app.request("/queue");
			const html = await res.text();

			expect(html).toContain("No posts pending review");
			expect(html).toContain('href="/"');
		});

		it("should list pending_review posts with action buttons", async () => {
			const post = createPost(db, "Queue test idea");
			updatePostStatus(db, post.id, "pending_review", {
				pomelli_caption: "A great caption",
				pomelli_image_path: "/data/assets/test-image.png",
			});

			const res = await app.request("/queue");
			const html = await res.text();

			expect(html).toContain("Queue test idea");
			expect(html).toContain("A great caption");
			expect(html).toContain("Approve");
			expect(html).toContain("Edit");
			expect(html).toContain("Reject");
		});

		it("should show post count", async () => {
			const p1 = createPost(db, "Idea 1");
			const p2 = createPost(db, "Idea 2");
			updatePostStatus(db, p1.id, "pending_review");
			updatePostStatus(db, p2.id, "pending_review");

			const res = await app.request("/queue");
			const html = await res.text();

			expect(html).toContain("2 posts pending review");
		});

		it("should show singular post count", async () => {
			const p = createPost(db, "Solo idea");
			updatePostStatus(db, p.id, "pending_review");

			const res = await app.request("/queue");
			const html = await res.text();

			expect(html).toContain("1 post pending review");
		});

		it("should not show posts with other statuses", async () => {
			createPost(db, "Generating idea"); // status: generating
			const approved = createPost(db, "Approved idea");
			updatePostStatus(db, approved.id, "approved");

			const res = await app.request("/queue");
			const html = await res.text();

			expect(html).not.toContain("Generating idea");
			expect(html).not.toContain("Approved idea");
			expect(html).toContain("No posts pending review");
		});

		it("should include HTMX attributes on action buttons", async () => {
			const post = createPost(db, "HTMX test");
			updatePostStatus(db, post.id, "pending_review");

			const res = await app.request("/queue");
			const html = await res.text();

			expect(html).toContain(`hx-post="/queue/${post.id}/approve"`);
			expect(html).toContain(`hx-post="/queue/${post.id}/reject"`);
			expect(html).toContain(`hx-get="/partials/queue-card/${post.id}/edit"`);
			expect(html).toContain(`hx-swap="outerHTML"`);
		});

		it("should show image thumbnail when available", async () => {
			const post = createPost(db, "Image test");
			updatePostStatus(db, post.id, "pending_review", {
				pomelli_image_path: "/data/assets/my-image.png",
			});

			const res = await app.request("/queue");
			const html = await res.text();

			expect(html).toContain("/assets/my-image.png");
			expect(html).toContain("<img");
		});

		it("should show edited caption over original", async () => {
			const post = createPost(db, "Caption priority test");
			updatePostStatus(db, post.id, "pending_review", {
				pomelli_caption: "Original caption",
				edited_caption: "Edited caption",
			});

			const res = await app.request("/queue");
			const html = await res.text();

			expect(html).toContain("Edited caption");
		});

		it("should include reject confirmation prompt", async () => {
			const post = createPost(db, "Confirm test");
			updatePostStatus(db, post.id, "pending_review");

			const res = await app.request("/queue");
			const html = await res.text();

			expect(html).toContain("hx-confirm");
		});
	});

	// ─── Queue approve action ────────────────────────────────────────────

	describe("POST /queue/:id/approve", () => {
		it("should approve a pending_review post and return empty HTML", async () => {
			const post = createPost(db, "Approve me");
			updatePostStatus(db, post.id, "pending_review");

			const res = await app.request(`/queue/${post.id}/approve`, {
				method: "POST",
			});

			expect(res.status).toBe(200);
			const html = await res.text();
			// Response should be minimal (just a comment for outerHTML removal)
			expect(html).toContain("approved");

			// Verify DB status changed
			const updated = db
				.query("SELECT status FROM posts WHERE id = ?")
				.get(post.id) as { status: string };
			expect(updated.status).toBe("approved");
		});

		it("should return 404 for non-existent post", async () => {
			const res = await app.request("/queue/999/approve", {
				method: "POST",
			});
			expect(res.status).toBe(404);
		});

		it("should return 400 for invalid ID", async () => {
			const res = await app.request("/queue/abc/approve", {
				method: "POST",
			});
			expect(res.status).toBe(400);
		});

		it("should return 409 for non-pending_review post", async () => {
			const post = createPost(db, "Already approved");
			updatePostStatus(db, post.id, "approved");

			const res = await app.request(`/queue/${post.id}/approve`, {
				method: "POST",
			});
			expect(res.status).toBe(409);
		});
	});

	// ─── Queue reject action ─────────────────────────────────────────────

	describe("POST /queue/:id/reject", () => {
		it("should reject a pending_review post and return empty HTML", async () => {
			const post = createPost(db, "Reject me");
			updatePostStatus(db, post.id, "pending_review");

			const res = await app.request(`/queue/${post.id}/reject`, {
				method: "POST",
			});

			expect(res.status).toBe(200);
			const html = await res.text();
			expect(html).toContain("rejected");

			const updated = db
				.query("SELECT status FROM posts WHERE id = ?")
				.get(post.id) as { status: string };
			expect(updated.status).toBe("rejected");
		});

		it("should return 404 for non-existent post", async () => {
			const res = await app.request("/queue/999/reject", {
				method: "POST",
			});
			expect(res.status).toBe(404);
		});

		it("should return 409 for non-pending_review post", async () => {
			const post = createPost(db, "Posted already");
			updatePostStatus(db, post.id, "posted");

			const res = await app.request(`/queue/${post.id}/reject`, {
				method: "POST",
			});
			expect(res.status).toBe(409);
		});
	});

	// ─── Queue edit action ───────────────────────────────────────────────

	describe("POST /queue/:id/edit", () => {
		it("should update caption and return updated PostCard", async () => {
			const post = createPost(db, "Edit me");
			updatePostStatus(db, post.id, "pending_review", {
				pomelli_caption: "Original",
			});

			const form = new FormData();
			form.append("caption", "Updated caption");

			const res = await app.request(`/queue/${post.id}/edit`, {
				method: "POST",
				body: form,
			});

			expect(res.status).toBe(200);
			const html = await res.text();
			expect(html).toContain("Updated caption");
			expect(html).toContain("Approve");

			const updated = db
				.query("SELECT edited_caption FROM posts WHERE id = ?")
				.get(post.id) as { edited_caption: string };
			expect(updated.edited_caption).toBe("Updated caption");
		});

		it("should return 400 for empty caption", async () => {
			const post = createPost(db, "Empty caption test");
			updatePostStatus(db, post.id, "pending_review");

			const form = new FormData();
			form.append("caption", "   ");

			const res = await app.request(`/queue/${post.id}/edit`, {
				method: "POST",
				body: form,
			});

			expect(res.status).toBe(400);
			const html = await res.text();
			expect(html).toContain("Caption cannot be empty");
		});

		it("should return 400 for caption over 280 characters", async () => {
			const post = createPost(db, "Long caption test");
			updatePostStatus(db, post.id, "pending_review");

			const form = new FormData();
			form.append("caption", "x".repeat(281));

			const res = await app.request(`/queue/${post.id}/edit`, {
				method: "POST",
				body: form,
			});

			expect(res.status).toBe(400);
			const html = await res.text();
			expect(html).toContain("max 280");
		});

		it("should return 404 for non-existent post", async () => {
			const form = new FormData();
			form.append("caption", "Test");

			const res = await app.request("/queue/999/edit", {
				method: "POST",
				body: form,
			});
			expect(res.status).toBe(404);
		});

		it("should return 409 for non-pending_review post", async () => {
			const post = createPost(db, "Wrong status");
			updatePostStatus(db, post.id, "approved");

			const form = new FormData();
			form.append("caption", "Test");

			const res = await app.request(`/queue/${post.id}/edit`, {
				method: "POST",
				body: form,
			});
			expect(res.status).toBe(409);
		});

		it("should trim whitespace from caption", async () => {
			const post = createPost(db, "Trim test");
			updatePostStatus(db, post.id, "pending_review");

			const form = new FormData();
			form.append("caption", "  trimmed caption  ");

			const res = await app.request(`/queue/${post.id}/edit`, {
				method: "POST",
				body: form,
			});

			expect(res.status).toBe(200);

			const updated = db
				.query("SELECT edited_caption FROM posts WHERE id = ?")
				.get(post.id) as { edited_caption: string };
			expect(updated.edited_caption).toBe("trimmed caption");
		});
	});

	// ─── Queue card partials ─────────────────────────────────────────────

	describe("GET /partials/queue-card/:id/edit", () => {
		it("should return edit form for a post", async () => {
			const post = createPost(db, "Edit form test");
			updatePostStatus(db, post.id, "pending_review", {
				pomelli_caption: "Current caption",
			});

			const res = await app.request(`/partials/queue-card/${post.id}/edit`);

			expect(res.status).toBe(200);
			const html = await res.text();
			expect(html).toContain("Current caption");
			expect(html).toContain("Save Caption");
			expect(html).toContain("Cancel");
			expect(html).toContain("textarea");
			expect(html).toContain(`hx-post="/queue/${post.id}/edit"`);
		});

		it("should return 404 for non-existent post", async () => {
			const res = await app.request("/partials/queue-card/999/edit");
			expect(res.status).toBe(404);
		});
	});

	describe("GET /partials/queue-card/:id", () => {
		it("should return a PostCard for the given post", async () => {
			const post = createPost(db, "Card partial test");
			updatePostStatus(db, post.id, "pending_review", {
				pomelli_caption: "Caption here",
			});

			const res = await app.request(`/partials/queue-card/${post.id}`);

			expect(res.status).toBe(200);
			const html = await res.text();
			expect(html).toContain("Card partial test");
			expect(html).toContain("Caption here");
			expect(html).toContain("Approve");
			expect(html).not.toContain("<html");
		});

		it("should return 404 for non-existent post", async () => {
			const res = await app.request("/partials/queue-card/999");
			expect(res.status).toBe(404);
		});
	});

	describe("GET /partials/queue", () => {
		it("should return queue list partial without layout", async () => {
			const post = createPost(db, "Queue partial test");
			updatePostStatus(db, post.id, "pending_review");

			const res = await app.request("/partials/queue");

			expect(res.status).toBe(200);
			const html = await res.text();
			expect(html).toContain("Queue partial test");
			expect(html).not.toContain("<html");
		});

		it("should show empty state when queue is empty", async () => {
			const res = await app.request("/partials/queue");
			const html = await res.text();

			expect(html).toContain("No posts pending review");
		});

		it("should only include pending_review posts", async () => {
			const p1 = createPost(db, "Pending idea");
			updatePostStatus(db, p1.id, "pending_review");
			const p2 = createPost(db, "Approved idea");
			updatePostStatus(db, p2.id, "approved");

			const res = await app.request("/partials/queue");
			const html = await res.text();

			expect(html).toContain("Pending idea");
			expect(html).not.toContain("Approved idea");
		});
	});

	// ─── History page ────────────────────────────────────────────────────

	describe("GET /history", () => {
		it("should return 200 with history page", async () => {
			const res = await app.request("/history");
			expect(res.status).toBe(200);

			const html = await res.text();
			expect(html).toContain("History");
			expect(html).toContain("Pomelli Flywheel");
		});

		it("should show empty state when no posted content", async () => {
			const res = await app.request("/history");
			const html = await res.text();

			expect(html).toContain("No posts published yet");
			expect(html).toContain('href="/queue"');
		});

		it("should list posted posts with tweet links", async () => {
			const post = createPost(db, "Published idea");
			updatePostStatus(db, post.id, "posted", {
				pomelli_caption: "Amazing caption",
				pomelli_image_path: "/data/assets/pub-image.png",
				x_post_id: "tweet-123",
				x_post_url: "https://x.com/i/status/tweet-123",
				posted_at: "2026-02-12 10:00:00",
			});

			const res = await app.request("/history");
			const html = await res.text();

			expect(html).toContain("Published idea");
			expect(html).toContain("Amazing caption");
			expect(html).toContain("https://x.com/i/status/tweet-123");
			expect(html).toContain("View on X");
			expect(html).toContain("Posted");
		});

		it("should show post count", async () => {
			const p1 = createPost(db, "Post 1");
			const p2 = createPost(db, "Post 2");
			updatePostStatus(db, p1.id, "posted", { posted_at: "2026-02-12" });
			updatePostStatus(db, p2.id, "posted", { posted_at: "2026-02-12" });

			const res = await app.request("/history");
			const html = await res.text();

			expect(html).toContain("2 posts published");
		});

		it("should show singular post count", async () => {
			const p = createPost(db, "Solo post");
			updatePostStatus(db, p.id, "posted", { posted_at: "2026-02-12" });

			const res = await app.request("/history");
			const html = await res.text();

			expect(html).toContain("1 post published");
		});

		it("should not show posts with non-posted statuses", async () => {
			createPost(db, "Generating idea"); // status: generating
			const approved = createPost(db, "Approved idea");
			updatePostStatus(db, approved.id, "approved");

			const res = await app.request("/history");
			const html = await res.text();

			expect(html).not.toContain("Generating idea");
			expect(html).not.toContain("Approved idea");
			expect(html).toContain("No posts published yet");
		});

		it("should show image thumbnails when available", async () => {
			const post = createPost(db, "Image history test");
			updatePostStatus(db, post.id, "posted", {
				pomelli_image_path: "/data/assets/history-img.png",
				posted_at: "2026-02-12",
			});

			const res = await app.request("/history");
			const html = await res.text();

			expect(html).toContain("/assets/history-img.png");
			expect(html).toContain("<img");
		});

		it("should show edited caption over original", async () => {
			const post = createPost(db, "Caption priority");
			updatePostStatus(db, post.id, "posted", {
				pomelli_caption: "Original",
				edited_caption: "Edited version",
				posted_at: "2026-02-12",
			});

			const res = await app.request("/history");
			const html = await res.text();

			expect(html).toContain("Edited version");
		});

		it("should show timestamps", async () => {
			const post = createPost(db, "Timestamp test");
			updatePostStatus(db, post.id, "posted", {
				posted_at: "2026-02-12 10:30:00",
			});

			const res = await app.request("/history");
			const html = await res.text();

			expect(html).toContain("Posted: 2026-02-12 10:30:00");
		});

		it("should include HTMX polling for auto-refresh", async () => {
			const res = await app.request("/history");
			const html = await res.text();

			expect(html).toContain('hx-get="/partials/history"');
			expect(html).toContain("every 30s");
		});
	});

	// ─── History partial ─────────────────────────────────────────────────

	describe("GET /partials/history", () => {
		it("should return HTML partial without full layout", async () => {
			const res = await app.request("/partials/history");
			expect(res.status).toBe(200);

			const html = await res.text();
			expect(html).not.toContain("<html");
			expect(html).toContain("No posts published yet");
		});

		it("should list posted posts", async () => {
			const post = createPost(db, "Partial test");
			updatePostStatus(db, post.id, "posted", {
				pomelli_caption: "Caption here",
				posted_at: "2026-02-12",
			});

			const res = await app.request("/partials/history");
			const html = await res.text();

			expect(html).toContain("Partial test");
			expect(html).toContain("Caption here");
		});

		it("should only include posted posts", async () => {
			const p1 = createPost(db, "Posted idea");
			updatePostStatus(db, p1.id, "posted", { posted_at: "2026-02-12" });
			const p2 = createPost(db, "Pending idea");
			updatePostStatus(db, p2.id, "pending_review");

			const res = await app.request("/partials/history");
			const html = await res.text();

			expect(html).toContain("Posted idea");
			expect(html).not.toContain("Pending idea");
		});
	});

	// ─── Settings page ──────────────────────────────────────────────────

	describe("GET /settings", () => {
		it("should return 200 with settings page", async () => {
			const res = await app.request("/settings");
			expect(res.status).toBe(200);

			const html = await res.text();
			expect(html).toContain("Settings");
			expect(html).toContain("Pomelli Flywheel");
		});

		it("should include website URL form", async () => {
			const res = await app.request("/settings");
			const html = await res.text();

			expect(html).toContain('name="website_url"');
			expect(html).toContain('hx-post="/settings"');
			expect(html).toContain("Save Settings");
		});

		it("should show saved website URL", async () => {
			setSetting(db, "website_url", "https://mycafe.com");

			const res = await app.request("/settings");
			const html = await res.text();

			expect(html).toContain("https://mycafe.com");
		});

		it("should show empty value when no URL saved", async () => {
			const res = await app.request("/settings");
			const html = await res.text();

			expect(html).toContain('value=""');
		});

		it("should include session status section", async () => {
			const res = await app.request("/settings");
			const html = await res.text();

			expect(html).toContain("Pomelli Session");
			expect(html).toContain('hx-get="/partials/session-status"');
		});

		it("should include Business DNA explanation", async () => {
			const res = await app.request("/settings");
			const html = await res.text();

			expect(html).toContain("Business DNA");
		});
	});

	// ─── Settings form submission ────────────────────────────────────────

	describe("POST /settings", () => {
		it("should save website URL and return confirmation", async () => {
			const form = new FormData();
			form.append("website_url", "https://mybrand.com");

			const res = await app.request("/settings", {
				method: "POST",
				body: form,
			});

			expect(res.status).toBe(200);
			const html = await res.text();
			expect(html).toContain("Settings saved");
			expect(html).toContain("https://mybrand.com");

			// Verify persisted in DB
			const saved = getSetting(db, "website_url");
			expect(saved).toBe("https://mybrand.com");
		});

		it("should return 400 for empty URL", async () => {
			const form = new FormData();
			form.append("website_url", "  ");

			const res = await app.request("/settings", {
				method: "POST",
				body: form,
			});

			expect(res.status).toBe(400);
			const html = await res.text();
			expect(html).toContain("required");
		});

		it("should return 400 for missing URL field", async () => {
			const form = new FormData();

			const res = await app.request("/settings", {
				method: "POST",
				body: form,
			});

			expect(res.status).toBe(400);
			const html = await res.text();
			expect(html).toContain("required");
		});

		it("should return 400 for invalid URL", async () => {
			const form = new FormData();
			form.append("website_url", "not-a-valid-url");

			const res = await app.request("/settings", {
				method: "POST",
				body: form,
			});

			expect(res.status).toBe(400);
			const html = await res.text();
			expect(html).toContain("valid URL");
		});

		it("should trim whitespace from URL", async () => {
			const form = new FormData();
			form.append("website_url", "  https://trimmed.com  ");

			const res = await app.request("/settings", {
				method: "POST",
				body: form,
			});

			expect(res.status).toBe(200);
			const saved = getSetting(db, "website_url");
			expect(saved).toBe("https://trimmed.com");
		});

		it("should overwrite existing URL", async () => {
			setSetting(db, "website_url", "https://old.com");

			const form = new FormData();
			form.append("website_url", "https://new.com");

			const res = await app.request("/settings", {
				method: "POST",
				body: form,
			});

			expect(res.status).toBe(200);
			const saved = getSetting(db, "website_url");
			expect(saved).toBe("https://new.com");
		});
	});

	// ─── Session status partial ──────────────────────────────────────────

	describe("GET /partials/session-status", () => {
		it("should show authenticated status when session is active", async () => {
			mockGetAuthStatus.mockResolvedValueOnce({
				status: "active",
				message: "Authenticated with Google",
				checkedAt: new Date().toISOString(),
			});

			const res = await app.request("/partials/session-status");
			expect(res.status).toBe(200);

			const html = await res.text();
			expect(html).toContain("Session Active");
			expect(html).toContain("Authenticated with Google");
		});

		it("should show unauthenticated status when session is expired", async () => {
			mockGetAuthStatus.mockResolvedValueOnce({
				status: "expired",
				message: "Session has expired",
				checkedAt: new Date().toISOString(),
			});

			const res = await app.request("/partials/session-status");
			expect(res.status).toBe(200);

			const html = await res.text();
			expect(html).toContain("Session Inactive");
			expect(html).toContain("Session has expired");
		});

		it("should show unauthenticated for unknown status", async () => {
			mockGetAuthStatus.mockResolvedValueOnce({
				status: "unknown",
				message: "No session found",
				checkedAt: new Date().toISOString(),
			});

			const res = await app.request("/partials/session-status");
			expect(res.status).toBe(200);

			const html = await res.text();
			expect(html).toContain("Session Inactive");
		});

		it("should show error status when auth check fails", async () => {
			mockGetAuthStatus.mockRejectedValueOnce(
				new Error("Browser not available"),
			);

			const res = await app.request("/partials/session-status");
			expect(res.status).toBe(200);

			const html = await res.text();
			expect(html).toContain("Session Check Failed");
			expect(html).toContain("Browser not available");
		});

		it("should return HTML partial without full layout", async () => {
			const res = await app.request("/partials/session-status");

			const html = await res.text();
			expect(html).not.toContain("<html");
		});
	});
});

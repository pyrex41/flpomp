import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPost, createTestDb, updatePostStatus } from "../src/db.ts";
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

	// ─── Stub pages ──────────────────────────────────────────────────────

	describe("GET /queue", () => {
		it("should return 200 with queue page", async () => {
			const res = await app.request("/queue");
			expect(res.status).toBe(200);

			const html = await res.text();
			expect(html).toContain("Queue");
			expect(html).toContain("Pomelli Flywheel");
		});
	});

	describe("GET /history", () => {
		it("should return 200 with history page", async () => {
			const res = await app.request("/history");
			expect(res.status).toBe(200);

			const html = await res.text();
			expect(html).toContain("History");
			expect(html).toContain("Pomelli Flywheel");
		});
	});

	describe("GET /settings", () => {
		it("should return 200 with settings page", async () => {
			const res = await app.request("/settings");
			expect(res.status).toBe(200);

			const html = await res.text();
			expect(html).toContain("Settings");
			expect(html).toContain("Pomelli Flywheel");
		});
	});
});

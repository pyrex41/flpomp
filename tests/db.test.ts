import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createPost,
	createTestDb,
	getAllPosts,
	getPostById,
	getSetting,
	setSetting,
	updatePostStatus,
} from "../src/db.ts";

/**
 * Tests use an in-memory SQLite database via the createTestDb helper.
 */
describe("db", () => {
	let db: ReturnType<typeof createTestDb>;

	beforeEach(() => {
		db = createTestDb();
	});

	afterEach(() => {
		db.close();
	});

	describe("posts", () => {
		it("should create a post with default status 'generating'", () => {
			const post = createPost(db, "Test idea");
			expect(post.idea).toBe("Test idea");
			expect(post.status).toBe("generating");
			expect(post.id).toBeGreaterThan(0);
		});

		it("should create a post with scheduled_at", () => {
			const post = createPost(db, "Scheduled idea", "2026-03-01T10:00:00Z");
			expect(post.scheduled_at).toBe("2026-03-01T10:00:00Z");
		});

		it("should get post by id", () => {
			const created = createPost(db, "Find me");
			const found = getPostById(db, created.id);
			expect(found).toBeDefined();
			expect(found!.idea).toBe("Find me");
		});

		it("should return undefined for non-existent post", () => {
			const found = getPostById(db, 9999);
			expect(found).toBeUndefined();
		});

		it("should list all posts", () => {
			createPost(db, "Idea 1");
			createPost(db, "Idea 2");
			const posts = getAllPosts(db);
			expect(posts).toHaveLength(2);
		});

		it("should filter posts by status", () => {
			createPost(db, "Idea 1");
			const post2 = createPost(db, "Idea 2");
			updatePostStatus(db, post2.id, "pending_review");

			const generating = getAllPosts(db, "generating");
			expect(generating).toHaveLength(1);

			const pending = getAllPosts(db, "pending_review");
			expect(pending).toHaveLength(1);
			expect(pending[0]!.idea).toBe("Idea 2");
		});

		it("should update post status with extra fields", () => {
			const post = createPost(db, "To post");
			updatePostStatus(db, post.id, "posted", {
				x_post_id: "12345",
				x_post_url: "https://x.com/user/status/12345",
				posted_at: "2026-02-12T12:00:00Z",
			});

			const updated = getPostById(db, post.id);
			expect(updated!.status).toBe("posted");
			expect(updated!.x_post_id).toBe("12345");
			expect(updated!.x_post_url).toBe("https://x.com/user/status/12345");
			expect(updated!.posted_at).toBe("2026-02-12T12:00:00Z");
		});
	});

	describe("settings", () => {
		it("should set and get a setting", () => {
			setSetting(db, "website_url", "https://example.com");
			expect(getSetting(db, "website_url")).toBe("https://example.com");
		});

		it("should return undefined for non-existent setting", () => {
			expect(getSetting(db, "nonexistent")).toBeUndefined();
		});

		it("should overwrite existing setting", () => {
			setSetting(db, "website_url", "https://old.com");
			setSetting(db, "website_url", "https://new.com");
			expect(getSetting(db, "website_url")).toBe("https://new.com");
		});
	});
});

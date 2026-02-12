import type { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	type Mock,
	vi,
} from "vitest";
import type { Post } from "../src/db.ts";
import { createTestDb, setSetting } from "../src/db.ts";
import {
	checkUsageLimit,
	getMonthlyUsage,
	postToX,
	TwitterPostError,
	validateCaption,
	validateImage,
} from "../src/services/twitter.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

let db: Database;
let testDir: string;

function makeTestImage(name: string, sizeBytes: number): string {
	const filePath = join(testDir, name);
	// Write a file of the specified size (not a real image, but validates size/extension)
	writeFileSync(filePath, Buffer.alloc(sizeBytes));
	return filePath;
}

function makePost(overrides?: Partial<Post>): Post {
	return {
		id: 1,
		idea: "Test idea",
		pomelli_caption: "A great caption",
		pomelli_image_path: makeTestImage("test.png", 1024),
		edited_caption: null,
		status: "approved",
		x_post_id: null,
		x_post_url: null,
		scheduled_at: null,
		error_message: null,
		created_at: "2026-02-12T00:00:00Z",
		posted_at: null,
		...overrides,
	};
}

function makeMockClient() {
	return {
		v1: {
			uploadMedia: vi.fn().mockResolvedValue("mock-media-id-123"),
		},
		v2: {
			tweet: vi.fn().mockResolvedValue({
				data: { id: "tweet-id-456", text: "A great caption" },
			}),
		},
	} as unknown as import("twitter-api-v2").TwitterApi;
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
	db = createTestDb();
	testDir = join(tmpdir(), `flpomp-test-${Date.now()}`);
	mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
	db.close();
});

// ─── validateCaption ─────────────────────────────────────────────────────────

describe("validateCaption", () => {
	it("should accept a caption under 280 characters", () => {
		expect(() => validateCaption("Short caption")).not.toThrow();
	});

	it("should accept a caption exactly at 280 characters", () => {
		const caption = "a".repeat(280);
		expect(() => validateCaption(caption)).not.toThrow();
	});

	it("should reject a caption over 280 characters", () => {
		const caption = "a".repeat(281);
		expect(() => validateCaption(caption)).toThrow(TwitterPostError);
		expect(() => validateCaption(caption)).toThrow(/281 characters/);
	});

	it("should include the CAPTION_TOO_LONG error code", () => {
		try {
			validateCaption("a".repeat(300));
		} catch (error) {
			expect(error).toBeInstanceOf(TwitterPostError);
			expect((error as TwitterPostError).code).toBe("CAPTION_TOO_LONG");
		}
	});
});

// ─── validateImage ───────────────────────────────────────────────────────────

describe("validateImage", () => {
	it("should accept a valid PNG under 5MB", async () => {
		const path = makeTestImage("valid.png", 1024);
		const mimeType = await validateImage(path);
		expect(mimeType).toBe("image/png");
	});

	it("should accept a valid JPEG under 5MB", async () => {
		const path = makeTestImage("valid.jpg", 2048);
		const mimeType = await validateImage(path);
		expect(mimeType).toBe("image/jpeg");
	});

	it("should accept .jpeg extension", async () => {
		const path = makeTestImage("valid.jpeg", 1024);
		const mimeType = await validateImage(path);
		expect(mimeType).toBe("image/jpeg");
	});

	it("should reject non-image files", async () => {
		const path = makeTestImage("file.gif", 1024);
		await expect(validateImage(path)).rejects.toThrow(TwitterPostError);
		await expect(validateImage(path)).rejects.toThrow(/PNG or JPEG/);
	});

	it("should reject files over 5MB", async () => {
		const path = makeTestImage("big.png", 6 * 1024 * 1024);
		await expect(validateImage(path)).rejects.toThrow(TwitterPostError);
		await expect(validateImage(path)).rejects.toThrow(/max 5MB/);
	});

	it("should reject non-existent files", async () => {
		await expect(validateImage("/nonexistent/image.png")).rejects.toThrow(
			TwitterPostError,
		);
		await expect(validateImage("/nonexistent/image.png")).rejects.toThrow(
			/not found/,
		);
	});

	it("should use correct error codes", async () => {
		try {
			await validateImage(makeTestImage("file.bmp", 1024));
		} catch (error) {
			expect((error as TwitterPostError).code).toBe("INVALID_IMAGE_TYPE");
		}

		try {
			await validateImage(makeTestImage("big.png", 6 * 1024 * 1024));
		} catch (error) {
			expect((error as TwitterPostError).code).toBe("IMAGE_TOO_LARGE");
		}
	});
});

// ─── Usage tracking ──────────────────────────────────────────────────────────

describe("usage tracking", () => {
	it("should return 0 for fresh month", () => {
		expect(getMonthlyUsage(db)).toBe(0);
	});

	it("should throw when at monthly limit", () => {
		const now = new Date();
		const monthKey = `x_usage_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
		setSetting(db, monthKey, "1500");

		expect(() => checkUsageLimit(db)).toThrow(TwitterPostError);
		expect(() => checkUsageLimit(db)).toThrow(/limit reached/);
	});

	it("should not throw when under limit", () => {
		expect(() => checkUsageLimit(db)).not.toThrow();
	});

	it("should use RATE_LIMIT_EXCEEDED error code", () => {
		const now = new Date();
		const monthKey = `x_usage_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
		setSetting(db, monthKey, "1500");

		try {
			checkUsageLimit(db);
		} catch (error) {
			expect((error as TwitterPostError).code).toBe("RATE_LIMIT_EXCEEDED");
		}
	});
});

// ─── postToX ─────────────────────────────────────────────────────────────────

describe("postToX", () => {
	it("should post successfully with valid inputs", async () => {
		const mockClient = makeMockClient();
		const post = makePost();

		const result = await postToX(db, post, mockClient);

		expect(result.tweetId).toBe("tweet-id-456");
		expect(result.tweetUrl).toContain("tweet-id-456");
		expect(mockClient.v1.uploadMedia).toHaveBeenCalledOnce();
		expect(mockClient.v2.tweet).toHaveBeenCalledOnce();
	});

	it("should use edited_caption over pomelli_caption when available", async () => {
		const mockClient = makeMockClient();
		const post = makePost({
			pomelli_caption: "Original caption",
			edited_caption: "Edited caption",
		});

		await postToX(db, post, mockClient);

		expect(mockClient.v2.tweet).toHaveBeenCalledWith(
			expect.objectContaining({
				text: "Edited caption",
			}),
		);
	});

	it("should update post status to 'posted' on success", async () => {
		const mockClient = makeMockClient();

		// Insert a real post into the test DB
		db.run(
			"INSERT INTO posts (id, idea, pomelli_caption, pomelli_image_path, status) VALUES (?, ?, ?, ?, ?)",
			[
				99,
				"Test idea",
				"Test caption",
				makeTestImage("db-test.png", 1024),
				"approved",
			],
		);

		const post = db.query("SELECT * FROM posts WHERE id = 99").get() as Post;
		await postToX(db, post, mockClient);

		const updated = db.query("SELECT * FROM posts WHERE id = 99").get() as Post;
		expect(updated.status).toBe("posted");
		expect(updated.x_post_id).toBe("tweet-id-456");
		expect(updated.x_post_url).toContain("tweet-id-456");
		expect(updated.posted_at).toBeTruthy();
	});

	it("should increment monthly usage counter on success", async () => {
		const mockClient = makeMockClient();
		const post = makePost();

		expect(getMonthlyUsage(db)).toBe(0);
		await postToX(db, post, mockClient);
		expect(getMonthlyUsage(db)).toBe(1);
	});

	it("should throw NO_CAPTION when no caption available", async () => {
		const post = makePost({
			pomelli_caption: null,
			edited_caption: null,
		});

		await expect(postToX(db, post)).rejects.toThrow(/No caption/);
	});

	it("should throw NO_IMAGE when no image available", async () => {
		const post = makePost({
			pomelli_image_path: null,
		});

		await expect(postToX(db, post)).rejects.toThrow(/No image/);
	});

	it("should reject captions over 280 characters", async () => {
		const post = makePost({
			pomelli_caption: "a".repeat(281),
		});

		await expect(postToX(db, post)).rejects.toThrow(/281 characters/);
	});

	it("should set status to 'failed' on API error", async () => {
		const mockClient = makeMockClient();
		(mockClient.v2.tweet as Mock).mockRejectedValue(
			new Error("API rate limit exceeded"),
		);

		db.run(
			"INSERT INTO posts (id, idea, pomelli_caption, pomelli_image_path, status) VALUES (?, ?, ?, ?, ?)",
			[
				100,
				"Fail idea",
				"Fail caption",
				makeTestImage("fail-test.png", 1024),
				"approved",
			],
		);

		const post = db.query("SELECT * FROM posts WHERE id = 100").get() as Post;

		await expect(postToX(db, post, mockClient)).rejects.toThrow(
			TwitterPostError,
		);

		const updated = db
			.query("SELECT * FROM posts WHERE id = 100")
			.get() as Post;
		expect(updated.status).toBe("failed");
		expect(updated.error_message).toContain("API rate limit exceeded");
	});

	it("should pass correct media_ids to tweet call", async () => {
		const mockClient = makeMockClient();
		(mockClient.v1.uploadMedia as Mock).mockResolvedValue("custom-media-id");

		const post = makePost();
		await postToX(db, post, mockClient);

		expect(mockClient.v2.tweet).toHaveBeenCalledWith({
			text: "A great caption",
			media: { media_ids: ["custom-media-id"] },
		});
	});

	it("should not increment usage on failure", async () => {
		const mockClient = makeMockClient();
		(mockClient.v2.tweet as Mock).mockRejectedValue(new Error("Unauthorized"));

		db.run(
			"INSERT INTO posts (id, idea, pomelli_caption, pomelli_image_path, status) VALUES (?, ?, ?, ?, ?)",
			[
				101,
				"NoCount idea",
				"NoCount caption",
				makeTestImage("nocount.png", 1024),
				"approved",
			],
		);

		const post = db.query("SELECT * FROM posts WHERE id = 101").get() as Post;

		try {
			await postToX(db, post, mockClient);
		} catch {
			// expected
		}

		expect(getMonthlyUsage(db)).toBe(0);
	});
});

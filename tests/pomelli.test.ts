/**
 * Unit tests for Pomelli browser automation service.
 * All Playwright interactions are mocked.
 */

import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ─── Hoisted mocks (must be defined before vi.mock calls) ────────────────────

const { mockLocator, mockPage, mockContext } = vi.hoisted(() => {
	const _mockLocator: Record<string, ReturnType<typeof vi.fn>> = {
		first: vi.fn(),
		nth: vi.fn(),
		count: vi.fn(),
		isVisible: vi.fn(),
		click: vi.fn(),
		fill: vi.fn(),
		waitFor: vi.fn(),
		textContent: vi.fn(),
		getAttribute: vi.fn(),
		evaluate: vi.fn(),
		locator: vi.fn(),
	};
	_mockLocator.first!.mockReturnValue(_mockLocator);

	const _mockPage = {
		goto: vi.fn(),
		screenshot: vi.fn(),
		locator: vi.fn().mockReturnValue(_mockLocator),
		url: vi.fn().mockReturnValue("https://labs.google.com/pomelli"),
		evaluate: vi.fn(),
	};

	const _mockContext = {
		pages: vi.fn().mockReturnValue([_mockPage]),
		newPage: vi.fn().mockReturnValue(_mockPage),
		close: vi.fn(),
	};

	return {
		mockLocator: _mockLocator,
		mockPage: _mockPage,
		mockContext: _mockContext,
	};
});

// ─── Mock Playwright ──────────────────────────────────────────────────────────

vi.mock("playwright", () => ({
	chromium: {
		launchPersistentContext: vi.fn().mockResolvedValue(mockContext),
	},
}));

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		existsSync: vi.fn().mockReturnValue(true),
		mkdirSync: vi.fn(),
	};
});

// ─── Import subjects after mocks ─────────────────────────────────────────────

import { createPost, createTestDb } from "../src/db.ts";
import {
	_resetLock,
	humanDelay,
	isLocked,
	PommelliError,
	PommelliService,
	SELECTORS,
} from "../src/services/pomelli.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

let db: Database;
let service: PommelliService;

function resetMocks() {
	vi.clearAllMocks();
	mockLocator.first!.mockReturnValue(mockLocator);
	mockLocator.nth!.mockReturnValue(mockLocator);
	mockContext.pages.mockReturnValue([mockPage]);
	mockPage.locator.mockReturnValue(mockLocator);
	mockPage.url.mockReturnValue("https://labs.google.com/pomelli");
	mockPage.screenshot.mockResolvedValue(undefined);
	mockPage.goto.mockResolvedValue(undefined);
	mockLocator.click!.mockResolvedValue(undefined);
	mockLocator.fill!.mockResolvedValue(undefined);
	mockLocator.waitFor!.mockResolvedValue(undefined);
}

beforeEach(() => {
	db = createTestDb();
	_resetLock();
	service = new PommelliService({
		browserStateDir: "/tmp/test-browser-state",
		assetsDir: "/tmp/test-assets",
		debugDir: "/tmp/test-debug",
		headless: true,
		skipDelay: true,
	});
	resetMocks();
});

afterEach(async () => {
	await service.close();
	_resetLock();
	db.close();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SELECTORS", () => {
	test("all selectors are non-empty strings", () => {
		for (const [_key, value] of Object.entries(SELECTORS)) {
			expect(typeof value).toBe("string");
			expect(value.length).toBeGreaterThan(0);
		}
	});

	test("contains required selector keys", () => {
		expect(SELECTORS).toHaveProperty("loggedInIndicator");
		expect(SELECTORS).toHaveProperty("signInButton");
		expect(SELECTORS).toHaveProperty("createCampaign");
		expect(SELECTORS).toHaveProperty("campaignIdeaInput");
		expect(SELECTORS).toHaveProperty("campaignGenerate");
		expect(SELECTORS).toHaveProperty("campaignOutput");
		expect(SELECTORS).toHaveProperty("campaignImages");
		expect(SELECTORS).toHaveProperty("campaignCaption");
		expect(SELECTORS).toHaveProperty("generationLoading");
	});
});

describe("PommelliService.launch", () => {
	test("creates a persistent browser context", async () => {
		const { chromium } = await import("playwright");
		const ctx = await service.launch();

		expect(chromium.launchPersistentContext).toHaveBeenCalledWith(
			"/tmp/test-browser-state",
			expect.objectContaining({
				headless: true,
				viewport: { width: 1280, height: 900 },
			}),
		);
		expect(ctx).toBe(mockContext);
	});

	test("reuses existing context on second call", async () => {
		const { chromium } = await import("playwright");
		await service.launch();
		await service.launch();

		expect(chromium.launchPersistentContext).toHaveBeenCalledTimes(1);
	});
});

describe("PommelliService.close", () => {
	test("closes the browser context", async () => {
		await service.launch();
		await service.close();

		expect(mockContext.close).toHaveBeenCalledTimes(1);
	});

	test("is safe to call when not launched", async () => {
		// Should not throw
		await service.close();
	});
});

describe("PommelliService.checkSession", () => {
	test("returns true when logged-in indicator is visible", async () => {
		mockLocator.isVisible!.mockResolvedValueOnce(true);

		const result = await service.checkSession();
		expect(result).toBe(true);
		expect(mockPage.goto).toHaveBeenCalledWith(
			"https://labs.google.com/pomelli",
			expect.objectContaining({ waitUntil: "networkidle" }),
		);
	});

	test("returns false when sign-in button is visible", async () => {
		// First call (loggedInIndicator) → not visible
		mockLocator.isVisible!.mockResolvedValueOnce(false);
		// Second call (signInButton) → visible
		mockLocator.isVisible!.mockResolvedValueOnce(true);

		const result = await service.checkSession();
		expect(result).toBe(false);
	});

	test("returns false when redirected to Google sign-in", async () => {
		mockLocator.isVisible!.mockResolvedValue(false);
		mockPage.url.mockReturnValue("https://accounts.google.com/signin");

		const result = await service.checkSession();
		expect(result).toBe(false);
	});

	test("returns true when on Pomelli URL and no clear indicators", async () => {
		mockLocator.isVisible!.mockResolvedValue(false);
		mockPage.url.mockReturnValue("https://labs.google.com/pomelli/dashboard");

		const result = await service.checkSession();
		expect(result).toBe(true);
	});

	test("returns false on navigation error", async () => {
		mockPage.goto.mockRejectedValueOnce(new Error("net::ERR_TIMED_OUT"));

		const result = await service.checkSession();
		expect(result).toBe(false);
	});

	test("takes a debug screenshot", async () => {
		mockLocator.isVisible!.mockResolvedValueOnce(true);

		await service.checkSession();
		expect(mockPage.screenshot).toHaveBeenCalled();
	});
});

describe("PommelliService.createBusinessDNA", () => {
	test("skips if create button not visible", async () => {
		mockLocator.isVisible!.mockResolvedValueOnce(false);

		await service.createBusinessDNA("https://example.com");

		// Should have checked for button but not filled/clicked
		expect(mockLocator.fill).not.toHaveBeenCalled();
	});

	test("creates business DNA when button is visible", async () => {
		// isVisible for create button → visible
		mockLocator.isVisible!.mockResolvedValueOnce(true);

		await service.createBusinessDNA("https://example.com");

		// Should have clicked create, filled URL, and clicked submit
		expect(mockLocator.click).toHaveBeenCalled();
		expect(mockLocator.fill).toHaveBeenCalledWith("https://example.com");
	});

	test("takes debug screenshots at each step", async () => {
		mockLocator.isVisible!.mockResolvedValueOnce(true);

		await service.createBusinessDNA("https://example.com");

		// Multiple screenshots expected
		expect(mockPage.screenshot).toHaveBeenCalled();
	});
});

describe("PommelliService.generateCampaign", () => {
	test("clicks create campaign, enters idea, and generates", async () => {
		// campaignOutput visible after generation
		mockLocator.isVisible!.mockImplementation(async () => true);
		mockLocator.count!.mockResolvedValue(1);
		mockLocator.getAttribute!.mockResolvedValue(
			"https://example.com/image.png",
		);
		mockLocator.textContent!.mockResolvedValue(
			"Check out our latest campaign!",
		);

		// Sub-locator for caption fallback
		const subLocator = {
			...mockLocator,
			first: vi.fn().mockReturnThis(),
			count: vi.fn().mockResolvedValue(0),
		};
		mockLocator.locator!.mockReturnValue(subLocator);

		const result = await service.generateCampaign("Promote summer sale");

		expect(mockLocator.fill).toHaveBeenCalledWith("Promote summer sale");
		expect(mockLocator.click).toHaveBeenCalled();
		expect(result.caption).toBe("Check out our latest campaign!");
	});

	test("throws PommelliError on generation timeout", async () => {
		// Override locator to selectively fail only generation-related waits
		mockPage.locator.mockImplementation((selector: string) => {
			if (
				selector === SELECTORS.campaignOutput ||
				selector === SELECTORS.generationLoading
			) {
				return {
					first: vi.fn().mockReturnValue({
						waitFor: vi.fn().mockRejectedValue(new Error("Timeout")),
					}),
				};
			}
			// All other selectors (createCampaign, ideaInput, generateBtn) work normally
			return mockLocator;
		});

		await expect(
			service.generateCampaign("Promote summer sale"),
		).rejects.toThrow("timed out");
	});
});

describe("PommelliService.processIdea", () => {
	test("sets status to failed when session is expired", async () => {
		// checkSession → goto succeeds, but login indicators fail
		mockLocator.isVisible!.mockResolvedValue(false);
		mockPage.url.mockReturnValue("https://accounts.google.com/signin");

		const post = createPost(db, "Test idea");

		await expect(service.processIdea(db, post.id, "Test idea")).rejects.toThrow(
			"Google session expired",
		);

		// Verify the post status was set to failed
		const row = db
			.query("SELECT status, error_message FROM posts WHERE id = ?")
			.get(post.id) as { status: string; error_message: string };
		expect(row.status).toBe("failed");
		expect(row.error_message).toContain("session expired");
	});

	test("releases lock even on failure", async () => {
		mockLocator.isVisible!.mockResolvedValue(false);
		mockPage.url.mockReturnValue("https://accounts.google.com/signin");

		const post = createPost(db, "Test idea");

		await expect(
			service.processIdea(db, post.id, "Test idea"),
		).rejects.toThrow();

		expect(isLocked()).toBe(false);
	});

	test("acquires and releases concurrency lock", async () => {
		// Make session check pass
		mockLocator.isVisible!.mockResolvedValueOnce(true); // loggedIn indicator

		// All subsequent isVisible calls return true (campaign output, caption, etc.)
		mockLocator.isVisible!.mockResolvedValue(true);
		mockLocator.count!.mockResolvedValue(1);
		mockLocator.getAttribute!.mockResolvedValue("data:image/png;base64,iVBOR");
		mockLocator.textContent!.mockResolvedValue("Great campaign copy!");

		// Sub-locator
		const subLocator = {
			...mockLocator,
			first: vi.fn().mockReturnThis(),
			count: vi.fn().mockResolvedValue(0),
		};
		mockLocator.locator!.mockReturnValue(subLocator);

		const post = createPost(db, "Test idea");

		// Before processing, should not be locked
		expect(isLocked()).toBe(false);

		const result = await service.processIdea(db, post.id, "Test idea");

		// After processing, lock should be released
		expect(isLocked()).toBe(false);
		expect(result.caption).toBe("Great campaign copy!");
	});

	test("rejects concurrent automation attempts", async () => {
		// Make first call hang by never resolving goto
		const neverResolve = new Promise(() => {});
		mockPage.goto.mockReturnValueOnce(neverResolve);
		// For the loggedIn check - just hang
		mockLocator.isVisible!.mockReturnValue(neverResolve);

		const post1 = createPost(db, "Idea 1");
		const post2 = createPost(db, "Idea 2");

		// Start first (will hang)
		service.processIdea(db, post1.id, "Idea 1").catch(() => {});

		// Wait a tick for the lock to be acquired
		await new Promise((r) => setTimeout(r, 10));

		// Second should fail immediately with lock error
		await expect(service.processIdea(db, post2.id, "Idea 2")).rejects.toThrow(
			"already running",
		);

		// Verify the lock state after the rejection (first is still running)
		expect(isLocked()).toBe(true);
	});

	test("saves image path and caption to DB on success", async () => {
		// Session OK
		mockLocator.isVisible!.mockResolvedValueOnce(true);
		// All subsequent isVisible calls return true (campaign output, caption, etc.)
		mockLocator.isVisible!.mockResolvedValue(true);
		mockLocator.count!.mockResolvedValue(1);
		mockLocator.getAttribute!.mockResolvedValue(
			"data:image/png;base64,iVBORw0KGgo=",
		);
		mockLocator.textContent!.mockResolvedValue("Amazing product launch!");

		const subLocator = {
			...mockLocator,
			first: vi.fn().mockReturnThis(),
			count: vi.fn().mockResolvedValue(0),
		};
		mockLocator.locator!.mockReturnValue(subLocator);

		const post = createPost(db, "Launch product");

		await service.processIdea(db, post.id, "Launch product");

		const row = db
			.query(
				"SELECT status, pomelli_caption, pomelli_image_path FROM posts WHERE id = ?",
			)
			.get(post.id) as {
			status: string;
			pomelli_caption: string;
			pomelli_image_path: string;
		};
		expect(row.status).toBe("pending_review");
		expect(row.pomelli_caption).toBe("Amazing product launch!");
		expect(row.pomelli_image_path).toBeTruthy();
	});
});

describe("PommelliError", () => {
	test("has correct name and code", () => {
		const err = new PommelliError("test message", "TEST_CODE");
		expect(err.name).toBe("PommelliError");
		expect(err.code).toBe("TEST_CODE");
		expect(err.message).toBe("test message");
		expect(err).toBeInstanceOf(Error);
	});
});

describe("humanDelay", () => {
	test("resolves after a delay", async () => {
		vi.useFakeTimers();
		const promise = humanDelay();
		vi.advanceTimersByTime(5_000);
		await promise;
		vi.useRealTimers();
	});
});

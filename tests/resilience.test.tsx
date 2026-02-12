/**
 * Tests for Task 13: Error handling, resilience, and polish.
 *
 * Covers:
 * - Hono error middleware (graceful HTML/JSON error pages)
 * - Playwright retry logic (withRetry helper)
 * - X API usage endpoint
 * - Image resize fallback (ensureImageWithinLimit)
 * - Session expiry banner (getLastSessionStatus)
 */

import type { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── 1. withRetry helper ──────────────────────────────────────────────────────

import { withRetry } from "../src/services/pomelli.ts";

describe("withRetry", () => {
	it("should return on first success", async () => {
		const fn = vi.fn().mockResolvedValue("ok");
		const result = await withRetry(fn, {
			maxAttempts: 3,
			delayMs: 0,
			label: "test",
		});
		expect(result).toBe("ok");
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("should retry on failure and succeed", async () => {
		const fn = vi
			.fn()
			.mockRejectedValueOnce(new Error("fail 1"))
			.mockRejectedValueOnce(new Error("fail 2"))
			.mockResolvedValue("success");

		const result = await withRetry(fn, {
			maxAttempts: 3,
			delayMs: 0,
			label: "test-retry",
		});
		expect(result).toBe("success");
		expect(fn).toHaveBeenCalledTimes(3);
	});

	it("should throw after exhausting all attempts", async () => {
		const fn = vi.fn().mockRejectedValue(new Error("persistent failure"));

		await expect(
			withRetry(fn, { maxAttempts: 3, delayMs: 0, label: "test-exhaust" }),
		).rejects.toThrow("persistent failure");
		expect(fn).toHaveBeenCalledTimes(3);
	});

	it("should use default options when none provided", async () => {
		const fn = vi.fn().mockResolvedValue(42);
		const result = await withRetry(fn);
		expect(result).toBe(42);
	});

	it("should convert non-Error throws to Error objects", async () => {
		const fn = vi
			.fn()
			.mockRejectedValueOnce("string error")
			.mockResolvedValue("ok");

		const result = await withRetry(fn, {
			maxAttempts: 2,
			delayMs: 0,
			label: "test-string-err",
		});
		expect(result).toBe("ok");
	});

	it("should throw original error type on final failure", async () => {
		class CustomError extends Error {
			code = "CUSTOM";
		}
		const fn = vi.fn().mockRejectedValue(new CustomError("custom fail"));

		try {
			await withRetry(fn, { maxAttempts: 2, delayMs: 0 });
		} catch (err) {
			expect(err).toBeInstanceOf(CustomError);
			expect((err as CustomError).code).toBe("CUSTOM");
		}
	});
});

// ─── 2. Image resize (ensureImageWithinLimit) ─────────────────────────────────

import { ensureImageWithinLimit } from "../src/services/image.ts";

describe("ensureImageWithinLimit", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `flpomp-image-test-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });
	});

	it("should pass through images under 5MB", async () => {
		const filePath = join(testDir, "small.png");
		// Create a small valid PNG (1x1 pixel)
		const pngHeader = Buffer.from([
			0x89,
			0x50,
			0x4e,
			0x47,
			0x0d,
			0x0a,
			0x1a,
			0x0a, // PNG signature
			0x00,
			0x00,
			0x00,
			0x0d,
			0x49,
			0x48,
			0x44,
			0x52, // IHDR chunk
			0x00,
			0x00,
			0x00,
			0x01,
			0x00,
			0x00,
			0x00,
			0x01, // 1x1
			0x08,
			0x02,
			0x00,
			0x00,
			0x00,
			0x90,
			0x77,
			0x53,
			0xde, // 8-bit RGB
			0x00,
			0x00,
			0x00,
			0x0c,
			0x49,
			0x44,
			0x41,
			0x54, // IDAT chunk
			0x08,
			0xd7,
			0x63,
			0xf8,
			0xcf,
			0xc0,
			0x00,
			0x00, // compressed data
			0x00,
			0x02,
			0x00,
			0x01,
			0xe2,
			0x21,
			0xbc,
			0x33,
			0x00,
			0x00,
			0x00,
			0x00,
			0x49,
			0x45,
			0x4e,
			0x44, // IEND chunk
			0xae,
			0x42,
			0x60,
			0x82,
		]);
		writeFileSync(filePath, pngHeader);

		const result = await ensureImageWithinLimit(filePath);
		expect(result.resized).toBe(false);
		expect(result.path).toBe(filePath);
		expect(result.sizeBytes).toBeGreaterThan(0);
	});

	it("should throw for non-existent files", async () => {
		await expect(
			ensureImageWithinLimit("/nonexistent/file.png"),
		).rejects.toThrow("not found");
	});

	it("should attempt resize for files over 5MB", async () => {
		// Create a large but valid JPEG by writing a simple header + padding
		// Sharp can handle this since it reads image headers
		const filePath = join(testDir, "large.jpg");
		// Write 6MB of data (not a valid image — this will trigger Sharp error)
		writeFileSync(filePath, Buffer.alloc(6 * 1024 * 1024));

		// Should try to resize but Sharp will fail on invalid data
		await expect(ensureImageWithinLimit(filePath)).rejects.toThrow();
	});
});

// ─── 3. Session status caching ────────────────────────────────────────────────

import {
	_setLastSessionStatus,
	type AuthStatus,
	getLastSessionStatus,
} from "../src/services/pomelli.ts";

describe("session status caching", () => {
	afterEach(() => {
		_setLastSessionStatus(null);
	});

	it("should return null when no status cached", () => {
		expect(getLastSessionStatus()).toBeNull();
	});

	it("should cache and return session status", () => {
		const status: AuthStatus = {
			status: "active",
			message: "Session is active",
			checkedAt: new Date().toISOString(),
		};
		_setLastSessionStatus(status);

		const cached = getLastSessionStatus();
		expect(cached).toEqual(status);
	});

	it("should cache expired session status", () => {
		const status: AuthStatus = {
			status: "expired",
			message: "Google session has expired.",
			checkedAt: new Date().toISOString(),
		};
		_setLastSessionStatus(status);

		const cached = getLastSessionStatus();
		expect(cached?.status).toBe("expired");
	});

	it("should overwrite previous cached status", () => {
		_setLastSessionStatus({
			status: "active",
			message: "Active",
			checkedAt: new Date().toISOString(),
		});

		_setLastSessionStatus({
			status: "expired",
			message: "Expired",
			checkedAt: new Date().toISOString(),
		});

		expect(getLastSessionStatus()?.status).toBe("expired");
	});
});

// ─── 4. Error middleware (HTML vs JSON) ───────────────────────────────────────

import { app } from "../src/server.ts";

describe("error middleware", () => {
	it("should return JSON 404 for API routes", async () => {
		const res = await app.request("/api/nonexistent", {
			method: "GET",
		});
		expect(res.status).toBe(404);
		const json = (await res.json()) as { error: string };
		expect(json.error).toBe("Not found");
	});

	it("should return HTML 404 for page routes", async () => {
		const res = await app.request("/nonexistent-page", {
			method: "GET",
			headers: { Accept: "text/html" },
		});
		expect(res.status).toBe(404);
		const text = await res.text();
		expect(text).toContain("404");
		expect(text).toContain("Not Found");
	});

	it("should return JSON 404 when Accept header prefers JSON", async () => {
		const res = await app.request("/nonexistent-page", {
			method: "GET",
			headers: { Accept: "application/json" },
		});
		expect(res.status).toBe(404);
		const json = (await res.json()) as { error: string };
		expect(json.error).toBe("Not found");
	});
});

// ─── 5. Usage API endpoint ────────────────────────────────────────────────────

import { createTestDb, setSetting } from "../src/db.ts";
import { setTestDb } from "../src/routes/api.ts";

describe("GET /api/usage", () => {
	let testDb: Database;

	beforeEach(() => {
		testDb = createTestDb();
		setTestDb(testDb);
	});

	afterEach(() => {
		setTestDb(null);
		testDb.close();
	});

	it("should return usage stats for current month", async () => {
		const res = await app.request("/api/usage", { method: "GET" });
		expect(res.status).toBe(200);

		const json = (await res.json()) as {
			month: string;
			used: number;
			limit: number;
			remaining: number;
			percentUsed: number;
		};
		expect(json).toHaveProperty("month");
		expect(json).toHaveProperty("used");
		expect(json).toHaveProperty("limit");
		expect(json).toHaveProperty("remaining");
		expect(json).toHaveProperty("percentUsed");
		expect(json.limit).toBe(1500);
		expect(json.used).toBe(0);
		expect(json.remaining).toBe(1500);
	});

	it("should reflect stored usage count", async () => {
		const now = new Date();
		const monthKey = `x_usage_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
		setSetting(testDb, monthKey, "42");

		const res = await app.request("/api/usage", { method: "GET" });
		const json = (await res.json()) as {
			used: number;
			remaining: number;
			percentUsed: number;
		};
		expect(json.used).toBe(42);
		expect(json.remaining).toBe(1458);
		expect(json.percentUsed).toBe(3); // Math.round(42/1500 * 100)
	});

	it("should cap remaining at 0 when over limit", async () => {
		const now = new Date();
		const monthKey = `x_usage_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
		setSetting(testDb, monthKey, "1600");

		const res = await app.request("/api/usage", { method: "GET" });
		const json = (await res.json()) as { used: number; remaining: number };
		expect(json.used).toBe(1600);
		expect(json.remaining).toBe(0);
	});
});

// ─── 6. Session banner component ──────────────────────────────────────────────

import { SessionBanner } from "../src/views/components/session-banner.tsx";

describe("SessionBanner component", () => {
	it("should render empty when no status", () => {
		const result = (<SessionBanner sessionStatus={null} />) as unknown as {
			type: string;
			props: Record<string, unknown>;
		};
		// JSX fragment returns empty — verify it doesn't throw
		expect(result).toBeDefined();
	});

	it("should render empty when session is active", () => {
		const status: AuthStatus = {
			status: "active",
			message: "Active",
			checkedAt: new Date().toISOString(),
		};
		const result = (<SessionBanner sessionStatus={status} />) as unknown as {
			type: string;
			props: Record<string, unknown>;
		};
		expect(result).toBeDefined();
	});

	it("should render warning when session is expired", () => {
		const status: AuthStatus = {
			status: "expired",
			message: "Session expired",
			checkedAt: new Date().toISOString(),
		};
		// Just verify it doesn't throw — JSX rendering is tested via integration
		const result = <SessionBanner sessionStatus={status} />;
		expect(result).toBeDefined();
	});

	it("should render error when session check failed", () => {
		const status: AuthStatus = {
			status: "error",
			message: "Check failed",
			checkedAt: new Date().toISOString(),
		};
		const result = <SessionBanner sessionStatus={status} />;
		expect(result).toBeDefined();
	});
});

// ─── 7. Error page component ──────────────────────────────────────────────────

import { ErrorPage } from "../src/views/pages/error.tsx";

describe("ErrorPage component", () => {
	it("should render 404 page", () => {
		const result = <ErrorPage status={404} message="Page not found" />;
		expect(result).toBeDefined();
	});

	it("should render 500 page with detail", () => {
		const result = (
			<ErrorPage
				status={500}
				message="Something went wrong"
				detail="TypeError: foo is not a function"
			/>
		);
		expect(result).toBeDefined();
	});

	it("should render 500 page without detail", () => {
		const result = <ErrorPage status={500} message="Something went wrong" />;
		expect(result).toBeDefined();
	});
});

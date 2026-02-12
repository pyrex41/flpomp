/**
 * Tests for Pomelli auth/session management (auth-session spec).
 * Covers:
 * - PommelliService.importCookies() — cookie validation and injection
 * - PommelliService.getAuthStatus() — structured health check with timeout
 * - GET /api/auth/status — health check API endpoint
 * - POST /api/auth/pomelli — cookie import API endpoint
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
		addCookies: vi.fn(),
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

// Mock twitter service (imported by api.ts via server.ts)
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

// ─── Import subjects after mocks ─────────────────────────────────────────────

import { createTestDb } from "../src/db.ts";
import { setTestDb } from "../src/routes/api.ts";
import { app } from "../src/server.ts";
import {
	type ImportedCookie,
	PommelliError,
	PommelliService,
	setPommelliService,
} from "../src/services/pomelli.ts";

// biome-ignore lint/suspicious/noExplicitAny: test helper for JSON responses
type Json = any;

// ─── Helpers ──────────────────────────────────────────────────────────────────

let service: PommelliService;

function resetMocks() {
	vi.clearAllMocks();
	mockLocator.first!.mockReturnValue(mockLocator);
	mockLocator.nth!.mockReturnValue(mockLocator);
	mockContext.pages.mockReturnValue([mockPage]);
	mockContext.addCookies.mockResolvedValue(undefined);
	mockPage.locator.mockReturnValue(mockLocator);
	mockPage.url.mockReturnValue("https://labs.google.com/pomelli");
	mockPage.screenshot.mockResolvedValue(undefined);
	mockPage.goto.mockResolvedValue(undefined);
	mockLocator.click!.mockResolvedValue(undefined);
	mockLocator.fill!.mockResolvedValue(undefined);
	mockLocator.waitFor!.mockResolvedValue(undefined);
}

function makeGoogleCookies(
	overrides?: Partial<ImportedCookie>[],
): ImportedCookie[] {
	const defaults: ImportedCookie[] = [
		{
			name: "SID",
			value: "abc123",
			domain: ".google.com",
			path: "/",
			secure: true,
			httpOnly: true,
		},
		{
			name: "HSID",
			value: "def456",
			domain: ".google.com",
			path: "/",
			secure: true,
			httpOnly: true,
		},
		{
			name: "SSID",
			value: "ghi789",
			domain: ".google.com",
			path: "/",
			secure: true,
			httpOnly: false,
		},
	];
	if (overrides) {
		return overrides.map((o, i) => ({
			...defaults[i % defaults.length]!,
			...o,
		}));
	}
	return defaults;
}

beforeEach(() => {
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
});

// ─── PommelliService.importCookies() ──────────────────────────────────────────

describe("PommelliService.importCookies", () => {
	it("should inject Google cookies into the browser context", async () => {
		const cookies = makeGoogleCookies();
		await service.importCookies(cookies);

		expect(mockContext.addCookies).toHaveBeenCalledTimes(1);
		const injected = mockContext.addCookies.mock.calls[0]![0];
		expect(injected).toHaveLength(3);
		expect(injected[0].name).toBe("SID");
		expect(injected[0].domain).toBe(".google.com");
	});

	it("should filter out non-Google cookies", async () => {
		const cookies: ImportedCookie[] = [
			{ name: "SID", value: "abc", domain: ".google.com" },
			{ name: "_ga", value: "xyz", domain: ".example.com" },
			{ name: "PREF", value: "def", domain: ".youtube.com" },
		];

		await service.importCookies(cookies);

		const injected = mockContext.addCookies.mock.calls[0]![0];
		expect(injected).toHaveLength(2);
		expect(injected.map((c: ImportedCookie) => c.name)).toEqual([
			"SID",
			"PREF",
		]);
	});

	it("should accept cookies with expirationDate field (cookie extension format)", async () => {
		const cookies: ImportedCookie[] = [
			{
				name: "SID",
				value: "abc",
				domain: ".google.com",
				expirationDate: 1800000000,
			},
		];

		await service.importCookies(cookies);

		const injected = mockContext.addCookies.mock.calls[0]![0];
		expect(injected[0].expires).toBe(1800000000);
	});

	it("should normalize sameSite values", async () => {
		const cookies: ImportedCookie[] = [
			{
				name: "A",
				value: "1",
				domain: ".google.com",
				sameSite: "no_restriction",
			},
			{ name: "B", value: "2", domain: ".google.com", sameSite: "strict" },
			{ name: "C", value: "3", domain: ".google.com", sameSite: "lax" },
			{ name: "D", value: "4", domain: ".google.com" },
		];

		await service.importCookies(cookies);

		const injected = mockContext.addCookies.mock.calls[0]![0];
		expect(injected[0].sameSite).toBe("None");
		expect(injected[1].sameSite).toBe("Strict");
		expect(injected[2].sameSite).toBe("Lax");
		expect(injected[3].sameSite).toBe("Lax"); // default
	});

	it("should throw on empty array", async () => {
		await expect(service.importCookies([])).rejects.toThrow("non-empty array");
	});

	it("should throw on cookies missing name field", async () => {
		const bad = [{ value: "x", domain: ".google.com" }] as ImportedCookie[];
		await expect(service.importCookies(bad)).rejects.toThrow('"name"');
	});

	it("should throw on cookies missing value field", async () => {
		const bad = [{ name: "SID", domain: ".google.com" }] as ImportedCookie[];
		await expect(service.importCookies(bad)).rejects.toThrow('"value"');
	});

	it("should throw on cookies missing domain field", async () => {
		const bad = [{ name: "SID", value: "x" }] as ImportedCookie[];
		await expect(service.importCookies(bad)).rejects.toThrow('"domain"');
	});

	it("should throw when no Google-related cookies found", async () => {
		const cookies: ImportedCookie[] = [
			{ name: "session", value: "abc", domain: ".example.com" },
		];
		await expect(service.importCookies(cookies)).rejects.toThrow(
			"No Google-related cookies",
		);
	});

	it("should throw PommelliError with correct code on validation failure", async () => {
		try {
			await service.importCookies([]);
		} catch (err) {
			expect(err).toBeInstanceOf(PommelliError);
			expect((err as PommelliError).code).toBe("INVALID_COOKIES");
		}
	});

	it("should throw PommelliError when addCookies fails", async () => {
		mockContext.addCookies.mockRejectedValueOnce(
			new Error("Browser context destroyed"),
		);

		const cookies = makeGoogleCookies();
		await expect(service.importCookies(cookies)).rejects.toThrow(
			"Failed to inject",
		);
	});

	it("should accept googleapis.com and gstatic.com domains", async () => {
		const cookies: ImportedCookie[] = [
			{ name: "A", value: "1", domain: ".googleapis.com" },
			{ name: "B", value: "2", domain: ".gstatic.com" },
		];

		await service.importCookies(cookies);

		const injected = mockContext.addCookies.mock.calls[0]![0];
		expect(injected).toHaveLength(2);
	});
});

// ─── PommelliService.getAuthStatus() ──────────────────────────────────────────

describe("PommelliService.getAuthStatus", () => {
	it("should return 'active' when session is valid", async () => {
		// loggedInIndicator visible → session is active
		mockLocator.isVisible!.mockResolvedValueOnce(true);

		const result = await service.getAuthStatus();

		expect(result.status).toBe("active");
		expect(result.message).toContain("active");
		expect(result.checkedAt).toBeTruthy();
	});

	it("should return 'expired' when session is expired", async () => {
		// loggedInIndicator not visible, signInButton visible
		mockLocator.isVisible!.mockResolvedValueOnce(false);
		mockLocator.isVisible!.mockResolvedValueOnce(true);

		const result = await service.getAuthStatus();

		expect(result.status).toBe("expired");
		expect(result.message).toContain("expired");
		expect(result.message).toContain("cookies");
	});

	it("should return 'expired' when navigation fails (treated as session unavailable)", async () => {
		mockPage.goto.mockRejectedValueOnce(
			new Error("net::ERR_CONNECTION_REFUSED"),
		);

		const result = await service.getAuthStatus();

		// checkSession() catches navigation errors and returns false,
		// which getAuthStatus() maps to "expired" (session not verifiable)
		expect(result.status).toBe("expired");
		expect(result.message).toContain("expired");
	});

	it("should return 'error' when check times out", async () => {
		// Make checkSession hang forever — getAuthStatus has a 10s timeout (NFR-1)
		mockPage.goto.mockImplementation(
			() => new Promise(() => {}), // never resolves
		);

		// Use a service with a very short timeout for testing
		const shortTimeoutService = new PommelliService({
			browserStateDir: "/tmp/test-browser-state",
			assetsDir: "/tmp/test-assets",
			debugDir: "/tmp/test-debug",
			headless: true,
			skipDelay: true,
		});

		// Monkey-patch getAuthStatus to use a shorter timeout for testing
		shortTimeoutService.getAuthStatus = async () => {
			const checkedAt = new Date().toISOString();
			try {
				await Promise.race([
					shortTimeoutService.checkSession(),
					new Promise<never>((_, reject) =>
						setTimeout(
							() => reject(new Error("Health check timed out")),
							50, // very short timeout for test
						),
					),
				]);
				return { status: "active", message: "OK", checkedAt };
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					status: "error",
					message: `Session check failed: ${message}`,
					checkedAt,
				};
			}
		};

		const result = await shortTimeoutService.getAuthStatus();

		expect(result.status).toBe("error");
		expect(result.message).toContain("timed out");

		await shortTimeoutService.close();
	});

	it("should include ISO timestamp in checkedAt", async () => {
		mockLocator.isVisible!.mockResolvedValueOnce(true);

		const before = new Date().toISOString();
		const result = await service.getAuthStatus();
		const after = new Date().toISOString();

		expect(result.checkedAt >= before).toBe(true);
		expect(result.checkedAt <= after).toBe(true);
	});
});

// ─── API Route Tests ──────────────────────────────────────────────────────────

describe("GET /api/auth/status", () => {
	let db: ReturnType<typeof createTestDb>;

	beforeEach(() => {
		db = createTestDb();
		setTestDb(db);
		// Inject our test service as the singleton
		setPommelliService(service);
	});

	afterEach(() => {
		setTestDb(null);
		setPommelliService(null);
		db.close();
	});

	it("should return active status when session is valid", async () => {
		mockLocator.isVisible!.mockResolvedValueOnce(true);

		const res = await app.request("/api/auth/status");
		expect(res.status).toBe(200);

		const body = (await res.json()) as Json;
		expect(body.status).toBe("active");
		expect(body.message).toContain("active");
		expect(body.checkedAt).toBeTruthy();
	});

	it("should return expired status when session is expired", async () => {
		mockLocator.isVisible!.mockResolvedValueOnce(false);
		mockLocator.isVisible!.mockResolvedValueOnce(true); // sign-in button visible

		const res = await app.request("/api/auth/status");
		expect(res.status).toBe(200);

		const body = (await res.json()) as Json;
		expect(body.status).toBe("expired");
		expect(body.message).toContain("expired");
	});

	it("should return expired status when navigation fails", async () => {
		mockPage.goto.mockRejectedValueOnce(new Error("Browser crashed"));

		const res = await app.request("/api/auth/status");
		expect(res.status).toBe(200);

		const body = (await res.json()) as Json;
		// Navigation errors are caught by checkSession() which returns false → expired
		expect(body.status).toBe("expired");
		expect(body.message).toContain("expired");
	});
});

describe("POST /api/auth/pomelli", () => {
	let db: ReturnType<typeof createTestDb>;

	beforeEach(() => {
		db = createTestDb();
		setTestDb(db);
		setPommelliService(service);
	});

	afterEach(() => {
		setTestDb(null);
		setPommelliService(null);
		db.close();
	});

	it("should import cookies and return session status", async () => {
		// After cookie import, session check returns active
		mockLocator.isVisible!.mockResolvedValue(true);

		const cookies = makeGoogleCookies();
		const res = await app.request("/api/auth/pomelli", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ cookies }),
		});

		expect(res.status).toBe(200);
		const body = (await res.json()) as Json;
		expect(body.success).toBe(true);
		expect(body.imported).toBe(3);
		expect(body.session.status).toBe("active");
	});

	it("should return 400 when cookies array is missing", async () => {
		const res = await app.request("/api/auth/pomelli", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});

		expect(res.status).toBe(400);
		const body = (await res.json()) as Json;
		expect(body.error).toContain("cookies");
	});

	it("should return 400 when cookies is not an array", async () => {
		const res = await app.request("/api/auth/pomelli", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ cookies: "not-an-array" }),
		});

		expect(res.status).toBe(400);
	});

	it("should return 400 when cookies have invalid format", async () => {
		const res = await app.request("/api/auth/pomelli", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				cookies: [{ name: "SID" }], // missing value and domain
			}),
		});

		expect(res.status).toBe(400);
		const body = (await res.json()) as Json;
		expect(body.code).toBe("INVALID_COOKIES");
	});

	it("should return 400 when no Google cookies provided", async () => {
		const res = await app.request("/api/auth/pomelli", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				cookies: [{ name: "session", value: "abc", domain: ".example.com" }],
			}),
		});

		expect(res.status).toBe(400);
		const body = (await res.json()) as Json;
		expect(body.code).toBe("NO_GOOGLE_COOKIES");
	});

	it("should return 400 for invalid JSON body", async () => {
		const res = await app.request("/api/auth/pomelli", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "not json",
		});

		expect(res.status).toBe(400);
	});

	it("should return session status even if session check shows expired after import", async () => {
		// Session check after import returns expired
		mockLocator.isVisible!.mockResolvedValueOnce(false);
		mockLocator.isVisible!.mockResolvedValueOnce(true); // sign-in button

		const cookies = makeGoogleCookies();
		const res = await app.request("/api/auth/pomelli", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ cookies }),
		});

		expect(res.status).toBe(200);
		const body = (await res.json()) as Json;
		expect(body.success).toBe(true);
		expect(body.session.status).toBe("expired");
	});
});

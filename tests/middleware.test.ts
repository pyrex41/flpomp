import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/server.ts";

/**
 * Tests for basic auth middleware.
 * The middleware is conditional — only active when ADMIN_PASSWORD is set.
 */

/** Encode credentials as a Basic auth header value. */
function basicAuth(username: string, password: string): string {
	return `Basic ${btoa(`${username}:${password}`)}`;
}

describe("basic auth middleware", () => {
	const savedPassword = process.env.ADMIN_PASSWORD;

	afterEach(() => {
		// Restore original env state after each test
		if (savedPassword !== undefined) {
			process.env.ADMIN_PASSWORD = savedPassword;
		} else {
			delete process.env.ADMIN_PASSWORD;
		}
	});

	describe("when ADMIN_PASSWORD is NOT set", () => {
		beforeEach(() => {
			delete process.env.ADMIN_PASSWORD;
		});

		it("should allow access to all routes without auth", async () => {
			const res = await app.request("/");
			expect(res.status).toBe(200);
		});

		it("should allow access to /health without auth", async () => {
			const res = await app.request("/health");
			expect(res.status).toBe(200);
		});

		it("should allow access to API routes without auth", async () => {
			const res = await app.request("/api/history");
			expect(res.status).toBe(200);
		});
	});

	describe("when ADMIN_PASSWORD is set", () => {
		const TEST_PASSWORD = "s3cret-test-pw!";

		beforeEach(() => {
			process.env.ADMIN_PASSWORD = TEST_PASSWORD;
		});

		// ── Health check is always public ────────────────────────────────

		it("should allow /health without auth", async () => {
			const res = await app.request("/health");
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body).toEqual({ status: "ok" });
		});

		// ── Unauthenticated requests ─────────────────────────────────────

		it("should return 401 for / without auth header", async () => {
			const res = await app.request("/");
			expect(res.status).toBe(401);
			expect(res.headers.get("WWW-Authenticate")).toContain("Basic");
		});

		it("should return 401 for /api routes without auth header", async () => {
			const res = await app.request("/api/history");
			expect(res.status).toBe(401);
		});

		it("should return 401 for /queue without auth header", async () => {
			const res = await app.request("/queue");
			expect(res.status).toBe(401);
		});

		it("should include WWW-Authenticate header with realm", async () => {
			const res = await app.request("/");
			expect(res.headers.get("WWW-Authenticate")).toBe(
				'Basic realm="Pomelli X Flywheel"',
			);
		});

		// ── Bad credentials ──────────────────────────────────────────────

		it("should return 401 for wrong password", async () => {
			const res = await app.request("/", {
				headers: { Authorization: basicAuth("admin", "wrong-password") },
			});
			expect(res.status).toBe(401);
		});

		it("should return 401 for malformed Authorization header", async () => {
			const res = await app.request("/", {
				headers: { Authorization: "Bearer some-token" },
			});
			expect(res.status).toBe(401);
		});

		it("should return 401 for empty Authorization header", async () => {
			const res = await app.request("/", {
				headers: { Authorization: "" },
			});
			expect(res.status).toBe(401);
		});

		it("should return 401 for Basic header with invalid base64", async () => {
			const res = await app.request("/", {
				headers: { Authorization: "Basic !!!not-base64!!!" },
			});
			expect(res.status).toBe(401);
		});

		it("should return 401 for Basic header without colon separator", async () => {
			const res = await app.request("/", {
				headers: { Authorization: `Basic ${btoa("no-colon-here")}` },
			});
			expect(res.status).toBe(401);
		});

		// ── Valid credentials ────────────────────────────────────────────

		it("should allow access with correct password and any username", async () => {
			const res = await app.request("/", {
				headers: { Authorization: basicAuth("admin", TEST_PASSWORD) },
			});
			expect(res.status).toBe(200);
		});

		it("should allow access with correct password and different username", async () => {
			const res = await app.request("/", {
				headers: {
					Authorization: basicAuth("anything-goes", TEST_PASSWORD),
				},
			});
			expect(res.status).toBe(200);
		});

		it("should allow access with correct password and empty username", async () => {
			const res = await app.request("/", {
				headers: { Authorization: basicAuth("", TEST_PASSWORD) },
			});
			expect(res.status).toBe(200);
		});

		it("should allow access to API routes with correct credentials", async () => {
			const res = await app.request("/api/history", {
				headers: { Authorization: basicAuth("admin", TEST_PASSWORD) },
			});
			expect(res.status).toBe(200);
		});

		it("should allow access to /queue with correct credentials", async () => {
			const res = await app.request("/queue", {
				headers: { Authorization: basicAuth("admin", TEST_PASSWORD) },
			});
			expect(res.status).toBe(200);
		});

		it("should allow access to /settings with correct credentials", async () => {
			const res = await app.request("/settings", {
				headers: { Authorization: basicAuth("admin", TEST_PASSWORD) },
			});
			expect(res.status).toBe(200);
		});

		// ── Edge cases ───────────────────────────────────────────────────

		it("should handle password with colon characters", async () => {
			const pwWithColon = "pass:word:with:colons";
			process.env.ADMIN_PASSWORD = pwWithColon;

			const res = await app.request("/", {
				headers: { Authorization: basicAuth("user", pwWithColon) },
			});
			expect(res.status).toBe(200);
		});

		it("should handle password with special ASCII characters", async () => {
			const specialPw = "p@$$w0rd!#%^&*()~`+=";
			process.env.ADMIN_PASSWORD = specialPw;

			const res = await app.request("/", {
				headers: { Authorization: basicAuth("user", specialPw) },
			});
			expect(res.status).toBe(200);
		});

		it("should reject similar but not equal passwords", async () => {
			const res = await app.request("/", {
				headers: {
					Authorization: basicAuth("admin", `${TEST_PASSWORD}x`),
				},
			});
			expect(res.status).toBe(401);
		});

		it("should reject password that is a prefix of the correct one", async () => {
			const res = await app.request("/", {
				headers: {
					Authorization: basicAuth("admin", TEST_PASSWORD.slice(0, -1)),
				},
			});
			expect(res.status).toBe(401);
		});
	});
});

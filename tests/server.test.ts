import { describe, expect, it } from "vitest";
import { app } from "../src/server.ts";

describe("server", () => {
	describe("GET /health", () => {
		it("should return status ok", async () => {
			const res = await app.request("/health");
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body).toEqual({ status: "ok" });
		});
	});

	describe("GET /", () => {
		it("should return HTML page", async () => {
			const res = await app.request("/");
			expect(res.status).toBe(200);
			const contentType = res.headers.get("content-type");
			expect(contentType).toContain("text/html");
		});

		it("should include HTMX script tag", async () => {
			const res = await app.request("/");
			const html = await res.text();
			expect(html).toContain("htmx.org");
		});

		it("should include Pico CSS", async () => {
			const res = await app.request("/");
			const html = await res.text();
			expect(html).toContain("picocss");
		});
	});

	describe("404 handling", () => {
		it("should return 404 HTML for unknown page routes", async () => {
			const res = await app.request("/nonexistent");
			expect(res.status).toBe(404);
			const text = await res.text();
			expect(text).toContain("404");
			expect(text).toContain("Not Found");
		});

		it("should return 404 JSON for unknown API routes", async () => {
			const res = await app.request("/api/nonexistent");
			expect(res.status).toBe(404);
			const body = (await res.json()) as { error: string };
			expect(body).toEqual({ error: "Not found" });
		});
	});
});

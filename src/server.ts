/**
 * Entry point — Hono app with error middleware, logging, static file serving.
 */

import { timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { logger } from "hono/logger";
import { config } from "./config.ts";
import { getDb } from "./db.ts";
import { api } from "./routes/api.ts";
import { pages } from "./routes/pages.tsx";
import { startScheduler } from "./services/scheduler.ts";

const app = new Hono();

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use("*", logger());

// ─── Basic auth (only when ADMIN_PASSWORD is set) ────────────────────────────

app.use("*", async (c, next) => {
	const password = config.adminPassword;
	if (!password) {
		return next();
	}

	// Health check is always public (for Fly.io / load balancer probes)
	if (c.req.path === "/health") {
		return next();
	}

	const authHeader = c.req.header("Authorization");
	if (!authHeader?.startsWith("Basic ")) {
		c.header("WWW-Authenticate", 'Basic realm="Pomelli X Flywheel"');
		return c.text("Unauthorized", 401);
	}

	try {
		const decoded = atob(authHeader.slice(6));
		const colonIndex = decoded.indexOf(":");
		if (colonIndex === -1) {
			c.header("WWW-Authenticate", 'Basic realm="Pomelli X Flywheel"');
			return c.text("Unauthorized", 401);
		}

		const providedPassword = decoded.slice(colonIndex + 1);

		// Timing-safe comparison to prevent timing attacks
		const expected = Buffer.from(password, "utf-8");
		const provided = Buffer.from(providedPassword, "utf-8");

		if (
			expected.length !== provided.length ||
			!timingSafeEqual(expected, provided)
		) {
			c.header("WWW-Authenticate", 'Basic realm="Pomelli X Flywheel"');
			return c.text("Unauthorized", 401);
		}
	} catch {
		c.header("WWW-Authenticate", 'Basic realm="Pomelli X Flywheel"');
		return c.text("Unauthorized", 401);
	}

	return next();
});

// ─── Error handling ──────────────────────────────────────────────────────────

app.onError((err, c) => {
	console.error("[server] Unhandled error:", err);
	return c.json({ error: "Internal server error" }, 500);
});

app.notFound((c) => {
	return c.json({ error: "Not found" }, 404);
});

// ─── Ensure data directories exist ──────────────────────────────────────────

function ensureDirectories() {
	for (const dir of [
		config.dataDir,
		config.assetsDir,
		config.debugDir,
		config.browserStateDir,
	]) {
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
			console.log(`[server] Created directory: ${dir}`);
		}
	}
}

// ─── Static file serving for downloaded Pomelli images ──────────────────────

app.use(
	"/assets/*",
	serveStatic({
		root: config.dataDir,
		rewriteRequestPath: (path) => path.replace(/^\/assets/, "/assets"),
	}),
);

// ─── Health check ────────────────────────────────────────────────────────────

app.get("/health", (c) => {
	return c.json({ status: "ok" });
});

// ─── Mount API routes ────────────────────────────────────────────────────────

app.route("/api", api);

// ─── Mount page routes ───────────────────────────────────────────────────────

app.route("/", pages);

// ─── Start server ────────────────────────────────────────────────────────────

ensureDirectories();

// Initialize database on startup
const db = getDb();

// Start the scheduled posting cron job
startScheduler(db);

console.log(`[server] Starting on port ${config.port}`);

export default {
	port: config.port,
	fetch: app.fetch,
};

export { app };

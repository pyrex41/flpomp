/**
 * Entry point — Hono app with error middleware, logging, static file serving.
 */

import { existsSync, mkdirSync } from "node:fs";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { logger } from "hono/logger";
import { config } from "./config.ts";
import { getDb } from "./db.ts";
import { api } from "./routes/api.ts";
import { pages } from "./routes/pages.tsx";

const app = new Hono();

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use("*", logger());

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
getDb();

console.log(`[server] Starting on port ${config.port}`);

export default {
	port: config.port,
	fetch: app.fetch,
};

export { app };

/**
 * JSON API routes for queue management.
 * Thin route handlers — business logic in services.
 *
 * All endpoints return JSON (NFR-2).
 */

import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import {
	createPost,
	getAllPosts,
	getDb,
	getPostById,
	getSetting,
	setSetting,
	updatePostStatus,
} from "../db.ts";
import {
	approvePost,
	triggerPommelliGeneration,
} from "../services/flywheel.ts";
import {
	getPommelliService,
	type ImportedCookie,
	PommelliError,
} from "../services/pomelli.ts";

const api = new Hono();

// ─── Helper to get the DB (allows test injection) ──────────────────────────

let testDb: Database | null = null;

/**
 * Inject a test database for integration tests.
 * Pass null to revert to the real database.
 */
export function setTestDb(db: Database | null): void {
	testDb = db;
}

function db(): Database {
	return testDb ?? getDb();
}

// ─── POST /api/ideas — Submit an idea (FR-1) ───────────────────────────────

api.post("/ideas", async (c) => {
	const body = await c.req.json().catch(() => null);

	if (!body || typeof body.idea !== "string" || body.idea.trim() === "") {
		return c.json({ error: "Idea text is required" }, 400);
	}

	const idea = body.idea.trim();
	const scheduledAt =
		typeof body.scheduled_at === "string" && body.scheduled_at.trim()
			? body.scheduled_at.trim()
			: undefined;

	const post = createPost(db(), idea, scheduledAt);

	console.log(`[api] Idea #${post.id} created: "${idea.slice(0, 50)}"`);

	// Kick off Pomelli generation in the background (fire-and-forget).
	// Post starts in 'generating' and transitions to 'pending_review' or 'failed'.
	const generation = triggerPommelliGeneration(db(), post.id, idea);

	return c.json({ post, generation }, 201);
});

// ─── GET /api/queue — List pending_review posts (FR-2) ─────────────────────

api.get("/queue", (c) => {
	const posts = getAllPosts(db(), "pending_review");

	// Enrich with image preview URLs
	const enriched = posts.map((post) => ({
		...post,
		image_url: post.pomelli_image_path
			? `/assets/${post.pomelli_image_path.split("/").pop()}`
			: null,
		caption: post.edited_caption ?? post.pomelli_caption,
	}));

	return c.json({ posts: enriched });
});

// ─── POST /api/queue/:id/approve — Approve a post (FR-3) ──────────────────

api.post("/queue/:id/approve", async (c) => {
	const id = Number.parseInt(c.req.param("id"), 10);
	if (Number.isNaN(id)) {
		return c.json({ error: "Invalid post ID" }, 400);
	}

	const post = getPostById(db(), id);
	if (!post) {
		return c.json({ error: "Post not found" }, 404);
	}

	if (post.status !== "pending_review") {
		return c.json(
			{ error: `Cannot approve post with status "${post.status}"` },
			409,
		);
	}

	// Accept optional scheduled_at from request body (FR-1)
	const body = await c.req.json().catch(() => null);
	const scheduledAt =
		body && typeof body.scheduled_at === "string" && body.scheduled_at.trim()
			? body.scheduled_at.trim()
			: undefined;

	// Approve (and optionally post to X for non-scheduled posts)
	const result = await approvePost(db(), post, scheduledAt);

	if (result.error) {
		console.error(
			`[api] Post #${id} approved but X posting failed: ${result.error}`,
		);
		return c.json({ post: result.post, error: result.error }, 502);
	}

	if (result.tweet) {
		console.log(
			`[api] Post #${id} approved and posted: ${result.tweet.tweetUrl}`,
		);
	} else {
		console.log(`[api] Post #${id} approved`);
	}

	return c.json({ post: result.post, tweet: result.tweet });
});

// ─── POST /api/queue/:id/edit — Edit caption (FR-4) ────────────────────────

api.post("/queue/:id/edit", async (c) => {
	const id = Number.parseInt(c.req.param("id"), 10);
	if (Number.isNaN(id)) {
		return c.json({ error: "Invalid post ID" }, 400);
	}

	const post = getPostById(db(), id);
	if (!post) {
		return c.json({ error: "Post not found" }, 404);
	}

	if (post.status !== "pending_review") {
		return c.json(
			{ error: `Cannot edit post with status "${post.status}"` },
			409,
		);
	}

	const body = await c.req.json().catch(() => null);
	if (!body || typeof body.caption !== "string") {
		return c.json({ error: "Caption text is required" }, 400);
	}

	const caption = body.caption.trim();
	if (caption === "") {
		return c.json({ error: "Caption cannot be empty" }, 400);
	}

	if (caption.length > 280) {
		return c.json(
			{ error: `Caption is ${caption.length} characters (max 280)` },
			400,
		);
	}

	updatePostStatus(db(), id, post.status, { edited_caption: caption });
	const updated = getPostById(db(), id)!;

	console.log(`[api] Post #${id} caption edited`);
	return c.json({ post: updated });
});

// ─── DELETE /api/queue/:id — Reject a post (FR-5) ──────────────────────────

api.delete("/queue/:id", (c) => {
	const id = Number.parseInt(c.req.param("id"), 10);
	if (Number.isNaN(id)) {
		return c.json({ error: "Invalid post ID" }, 400);
	}

	const post = getPostById(db(), id);
	if (!post) {
		return c.json({ error: "Post not found" }, 404);
	}

	if (post.status !== "pending_review") {
		return c.json(
			{ error: `Cannot reject post with status "${post.status}"` },
			409,
		);
	}

	updatePostStatus(db(), id, "rejected");
	console.log(`[api] Post #${id} rejected`);

	return c.json({ success: true });
});

// ─── GET /api/history — List posted content (FR-6) ─────────────────────────

api.get("/history", (c) => {
	const posts = getAllPosts(db(), "posted");

	const enriched = posts.map((post) => ({
		...post,
		image_url: post.pomelli_image_path
			? `/assets/${post.pomelli_image_path.split("/").pop()}`
			: null,
		caption: post.edited_caption ?? post.pomelli_caption,
	}));

	return c.json({ posts: enriched });
});

// ─── GET /api/auth/status — Session health check (auth-session FR-2) ──────

api.get("/auth/status", async (c) => {
	try {
		const service = getPommelliService();
		const authStatus = await service.getAuthStatus();

		console.log(`[api] Auth status check: ${authStatus.status}`);
		return c.json(authStatus);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`[api] Auth status check failed: ${message}`);
		return c.json(
			{
				status: "error" as const,
				message: `Failed to check auth status: ${message}`,
				checkedAt: new Date().toISOString(),
			},
			500,
		);
	}
});

// ─── POST /api/auth/pomelli — Import cookies (auth-session FR-3, FR-4) ────

api.post("/auth/pomelli", async (c) => {
	const body = await c.req.json().catch(() => null);

	if (!body || !Array.isArray(body.cookies)) {
		return c.json(
			{
				error:
					'Request must include a "cookies" array. Export cookies from your browser using a cookie manager extension while logged into Google.',
			},
			400,
		);
	}

	const cookies = body.cookies as ImportedCookie[];

	try {
		const service = getPommelliService();
		await service.importCookies(cookies);

		// Verify the session is now active
		const authStatus = await service.getAuthStatus();

		console.log(`[api] Cookies imported, session status: ${authStatus.status}`);

		return c.json({
			success: true,
			imported: cookies.length,
			session: authStatus,
		});
	} catch (error) {
		if (error instanceof PommelliError) {
			console.warn(`[api] Cookie import failed: ${error.message}`);
			return c.json({ error: error.message, code: error.code }, 400);
		}

		const message = error instanceof Error ? error.message : String(error);
		console.error(`[api] Cookie import error: ${message}`);
		return c.json({ error: `Cookie import failed: ${message}` }, 500);
	}
});

// ─── POST /api/settings — Update settings (FR-8) ──────────────────────────

api.post("/settings", async (c) => {
	const body = await c.req.json().catch(() => null);

	if (!body || typeof body !== "object") {
		return c.json({ error: "Settings object is required" }, 400);
	}

	const allowedKeys = ["website_url"];
	const updated: Record<string, string> = {};

	for (const key of allowedKeys) {
		if (key in body && typeof body[key] === "string") {
			setSetting(db(), key, body[key] as string);
			updated[key] = body[key] as string;
		}
	}

	if (Object.keys(updated).length === 0) {
		return c.json({ error: "No valid settings provided" }, 400);
	}

	console.log(`[api] Settings updated: ${Object.keys(updated).join(", ")}`);
	return c.json({ settings: updated });
});

// ─── GET /api/settings — Read settings ─────────────────────────────────────

api.get("/settings", (c) => {
	const websiteUrl = getSetting(db(), "website_url") ?? "";

	return c.json({
		settings: {
			website_url: websiteUrl,
		},
	});
});

export { api };

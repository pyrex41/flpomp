/**
 * HTML page routes — server-rendered with Hono JSX + HTMX.
 * Thin route handlers; business logic goes in services.
 *
 * Page routes return full HTML pages (wrapped in Layout) or HTML partials
 * for HTMX swaps. JSON API routes stay in api.ts.
 */

import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import { createPost, getAllPosts, getDb } from "../db.ts";
import { Layout } from "../views/layout.tsx";
import {
	IdeaSubmitError,
	IdeaSubmitResult,
	NewPostPage,
	RecentPostsList,
} from "../views/pages/dashboard.tsx";

const pages = new Hono();

// ─── Test DB injection (mirrors api.ts pattern) ─────────────────────────────

let testDb: Database | null = null;

/**
 * Inject a test database for integration tests.
 * Pass null to revert to the real database.
 */
export function setPageTestDb(db: Database | null): void {
	testDb = db;
}

function db(): Database {
	return testDb ?? getDb();
}

// ─── New Post (home) ─────────────────────────────────────────────────────────

pages.get("/", (c) => {
	const recentPosts = getAllPosts(db()).slice(0, 10);
	return c.html(
		<Layout title="New Post">
			<NewPostPage recentPosts={recentPosts} />
		</Layout>,
	);
});

// ─── Submit idea (HTMX form handler) ────────────────────────────────────────

pages.post("/submit-idea", async (c) => {
	const body = await c.req.parseBody();
	const idea = typeof body.idea === "string" ? body.idea.trim() : "";

	if (!idea) {
		return c.html(<IdeaSubmitError message="Please enter an idea." />, 400);
	}

	const scheduledAt =
		typeof body.scheduled_at === "string" && body.scheduled_at.trim()
			? body.scheduled_at.trim()
			: undefined;

	const post = createPost(db(), idea, scheduledAt);
	console.log(`[pages] Idea #${post.id} created: "${idea.slice(0, 50)}"`);

	return c.html(<IdeaSubmitResult post={post} />);
});

// ─── Recent activity partial (HTMX polling target) ─────────────────────────

pages.get("/partials/recent", (c) => {
	const recentPosts = getAllPosts(db()).slice(0, 10);
	return c.html(<RecentPostsList posts={recentPosts} />);
});

// ─── Queue page (stub — Task 7) ────────────────────────────────────────────

pages.get("/queue", (c) => {
	return c.html(
		<Layout title="Queue">
			<hgroup>
				<h2>Queue</h2>
				<p>Review and approve pending posts before they go live.</p>
			</hgroup>
			<p class="secondary">Queue management coming in the next update.</p>
		</Layout>,
	);
});

// ─── History page (stub — Task 8) ──────────────────────────────────────────

pages.get("/history", (c) => {
	return c.html(
		<Layout title="History">
			<hgroup>
				<h2>History</h2>
				<p>Posts that have been published to X.</p>
			</hgroup>
			<p class="secondary">Post history coming in the next update.</p>
		</Layout>,
	);
});

// ─── Settings page (stub — Task 8) ─────────────────────────────────────────

pages.get("/settings", (c) => {
	return c.html(
		<Layout title="Settings">
			<hgroup>
				<h2>Settings</h2>
				<p>Configure the flywheel.</p>
			</hgroup>
			<p class="secondary">Settings page coming in the next update.</p>
		</Layout>,
	);
});

export { pages };

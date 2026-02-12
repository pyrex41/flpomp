/**
 * HTML page routes — server-rendered with Hono JSX + HTMX.
 * Thin route handlers; business logic goes in services.
 *
 * Page routes return full HTML pages (wrapped in Layout) or HTML partials
 * for HTMX swaps. JSON API routes stay in api.ts.
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
import { getPommelliService } from "../services/pomelli.ts";
import { PostCard, PostCardEditForm } from "../views/components/post-card.tsx";
import { Layout } from "../views/layout.tsx";
import {
	IdeaSubmitError,
	IdeaSubmitResult,
	NewPostPage,
	RecentPostsList,
} from "../views/pages/dashboard.tsx";
import { HistoryList, HistoryPage } from "../views/pages/history.tsx";
import { QueueList, QueuePage } from "../views/pages/queue.tsx";
import {
	SessionStatusPartial,
	SettingsPage,
	SettingsSaveError,
	SettingsSaveResult,
} from "../views/pages/settings.tsx";

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

	// Kick off Pomelli generation in the background (fire-and-forget).
	triggerPommelliGeneration(db(), post.id, idea);

	return c.html(<IdeaSubmitResult post={post} />);
});

// ─── Recent activity partial (HTMX polling target) ─────────────────────────

pages.get("/partials/recent", (c) => {
	const recentPosts = getAllPosts(db()).slice(0, 10);
	return c.html(<RecentPostsList posts={recentPosts} />);
});

// ─── Queue page ──────────────────────────────────────────────────────────────

pages.get("/queue", (c) => {
	const posts = getAllPosts(db(), "pending_review");
	return c.html(
		<Layout title="Queue">
			<QueuePage posts={posts} />
		</Layout>,
	);
});

// ─── Queue actions (HTMX partial responses) ─────────────────────────────────

pages.post("/queue/:id/approve", async (c) => {
	const id = Number.parseInt(c.req.param("id"), 10);
	if (Number.isNaN(id)) {
		return c.html(<p class="form-error">Invalid post ID</p>, 400);
	}

	const post = getPostById(db(), id);
	if (!post) {
		return c.html(<p class="form-error">Post not found</p>, 404);
	}

	if (post.status !== "pending_review") {
		return c.html(<p class="form-error">Post is not pending review</p>, 409);
	}

	// Approve (and optionally post to X for non-scheduled posts)
	const result = await approvePost(db(), post);

	if (result.error) {
		console.error(
			`[pages] Post #${id} approved but X posting failed: ${result.error}`,
		);
		return c.html(
			<p class="form-error">
				Approved but posting to X failed: {result.error}
			</p>,
			502,
		);
	}

	if (result.tweet) {
		console.log(
			`[pages] Post #${id} approved and posted to X: ${result.tweet.tweetUrl}`,
		);
	} else {
		console.log(`[pages] Post #${id} approved`);
	}

	// Return empty HTML — outerHTML swap removes the card from the list
	return c.html("<!-- approved -->");
});

pages.post("/queue/:id/reject", (c) => {
	const id = Number.parseInt(c.req.param("id"), 10);
	if (Number.isNaN(id)) {
		return c.html(<p class="form-error">Invalid post ID</p>, 400);
	}

	const post = getPostById(db(), id);
	if (!post) {
		return c.html(<p class="form-error">Post not found</p>, 404);
	}

	if (post.status !== "pending_review") {
		return c.html(<p class="form-error">Post is not pending review</p>, 409);
	}

	updatePostStatus(db(), id, "rejected");
	console.log(`[pages] Post #${id} rejected`);

	// Return empty HTML — outerHTML swap removes the card from the list
	return c.html("<!-- rejected -->");
});

pages.post("/queue/:id/edit", async (c) => {
	const id = Number.parseInt(c.req.param("id"), 10);
	if (Number.isNaN(id)) {
		return c.html(<p class="form-error">Invalid post ID</p>, 400);
	}

	const post = getPostById(db(), id);
	if (!post) {
		return c.html(<p class="form-error">Post not found</p>, 404);
	}

	if (post.status !== "pending_review") {
		return c.html(<p class="form-error">Post is not pending review</p>, 409);
	}

	const body = await c.req.parseBody();
	const caption = typeof body.caption === "string" ? body.caption.trim() : "";

	if (!caption) {
		return c.html(<p class="form-error">Caption cannot be empty</p>, 400);
	}

	if (caption.length > 280) {
		return c.html(
			<p class="form-error">
				Caption is {caption.length} characters (max 280)
			</p>,
			400,
		);
	}

	updatePostStatus(db(), id, post.status, { edited_caption: caption });
	const updated = getPostById(db(), id)!;

	console.log(`[pages] Post #${id} caption edited`);

	// Return the updated card — outerHTML swap replaces the edit form
	return c.html(<PostCard post={updated} />);
});

// ─── Queue card partials (for HTMX inline edit) ─────────────────────────────

pages.get("/partials/queue-card/:id/edit", (c) => {
	const id = Number.parseInt(c.req.param("id"), 10);
	if (Number.isNaN(id)) {
		return c.html(<p class="form-error">Invalid post ID</p>, 400);
	}

	const post = getPostById(db(), id);
	if (!post) {
		return c.html(<p class="form-error">Post not found</p>, 404);
	}

	return c.html(<PostCardEditForm post={post} />);
});

pages.get("/partials/queue-card/:id", (c) => {
	const id = Number.parseInt(c.req.param("id"), 10);
	if (Number.isNaN(id)) {
		return c.html(<p class="form-error">Invalid post ID</p>, 400);
	}

	const post = getPostById(db(), id);
	if (!post) {
		return c.html(<p class="form-error">Post not found</p>, 404);
	}

	return c.html(<PostCard post={post} />);
});

pages.get("/partials/queue", (c) => {
	const posts = getAllPosts(db(), "pending_review");
	return c.html(<QueueList posts={posts} />);
});

// ─── History page ────────────────────────────────────────────────────────────

pages.get("/history", (c) => {
	const posts = getAllPosts(db(), "posted");
	return c.html(
		<Layout title="History">
			<HistoryPage posts={posts} />
		</Layout>,
	);
});

// ─── History partial (HTMX polling target) ──────────────────────────────────

pages.get("/partials/history", (c) => {
	const posts = getAllPosts(db(), "posted");
	return c.html(<HistoryList posts={posts} />);
});

// ─── Settings page ──────────────────────────────────────────────────────────

pages.get("/settings", (c) => {
	const websiteUrl = getSetting(db(), "website_url") ?? "";
	return c.html(
		<Layout title="Settings">
			<SettingsPage websiteUrl={websiteUrl} />
		</Layout>,
	);
});

// ─── Settings form handler (HTMX) ──────────────────────────────────────────

pages.post("/settings", async (c) => {
	const body = await c.req.parseBody();
	const websiteUrl =
		typeof body.website_url === "string" ? body.website_url.trim() : "";

	if (!websiteUrl) {
		return c.html(
			<SettingsSaveError message="Website URL is required." />,
			400,
		);
	}

	// Basic URL validation
	try {
		new URL(websiteUrl);
	} catch {
		return c.html(
			<SettingsSaveError message="Please enter a valid URL (e.g. https://example.com)." />,
			400,
		);
	}

	setSetting(db(), "website_url", websiteUrl);
	console.log(`[pages] Settings updated: website_url = ${websiteUrl}`);

	return c.html(<SettingsSaveResult websiteUrl={websiteUrl} />);
});

// ─── Session status partial (loaded on settings page) ───────────────────────

pages.get("/partials/session-status", async (c) => {
	try {
		const service = getPommelliService();
		const authStatus = await service.getAuthStatus();

		console.log(`[pages] Session status check: ${authStatus.status}`);

		// Map Pomelli auth status to display status
		const displayStatus =
			authStatus.status === "active"
				? "authenticated"
				: authStatus.status === "error"
					? "error"
					: "unauthenticated";

		return c.html(
			<SessionStatusPartial
				status={displayStatus}
				message={authStatus.message}
			/>,
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`[pages] Session status check failed: ${message}`);

		return c.html(
			<SessionStatusPartial
				status="error"
				message={`Could not check session: ${message}`}
			/>,
		);
	}
});

export { pages };

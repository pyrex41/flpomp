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
	updatePostStatus,
} from "../db.ts";
import { PostCard, PostCardEditForm } from "../views/components/post-card.tsx";
import { Layout } from "../views/layout.tsx";
import {
	IdeaSubmitError,
	IdeaSubmitResult,
	NewPostPage,
	RecentPostsList,
} from "../views/pages/dashboard.tsx";
import { QueueList, QueuePage } from "../views/pages/queue.tsx";

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

pages.post("/queue/:id/approve", (c) => {
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

	updatePostStatus(db(), id, "approved");
	console.log(`[pages] Post #${id} approved`);

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

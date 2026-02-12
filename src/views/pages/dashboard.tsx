/**
 * New Post (dashboard) page — the home screen of the flywheel.
 *
 * Renders an HTMX form to submit ideas, a confirmation partial after submission,
 * and a recent-activity feed that auto-refreshes via HTMX polling.
 */

import type { Post } from "../../db.ts";

// ─── Full page content ───────────────────────────────────────────────────────

interface NewPostPageProps {
	recentPosts: Post[];
}

export function NewPostPage({ recentPosts }: NewPostPageProps) {
	return (
		<>
			<hgroup>
				<h2>New Post</h2>
				<p>
					Submit an idea to generate branded social media assets with Pomelli.
				</p>
			</hgroup>

			<form
				hx-post="/submit-idea"
				hx-target="#submit-result"
				hx-swap="innerHTML"
				hx-disabled-elt="button[type='submit']"
			>
				<label>
					Idea
					<textarea
						name="idea"
						placeholder="e.g. Promote our new cold brew for summer"
						rows={3}
						required
					/>
				</label>

				<label>
					Schedule (optional)
					<input
						type="datetime-local"
						name="scheduled_at"
						aria-describedby="schedule-help"
					/>
				</label>
				<small id="schedule-help">
					Leave blank to post immediately after approval.
				</small>

				<button type="submit">Generate</button>
			</form>

			<div id="submit-result" />

			<hr />

			<h3>Recent Activity</h3>
			<div
				id="recent-activity"
				hx-get="/partials/recent"
				hx-trigger="load, every 5s"
				hx-swap="innerHTML"
			>
				<RecentPostsList posts={recentPosts} />
			</div>
		</>
	);
}

// ─── Confirmation partial (returned after form submit) ───────────────────────

export function IdeaSubmitResult({ post }: { post: Post }) {
	return (
		<article>
			<p>
				Idea submitted! Post <strong>#{post.id}</strong> is now{" "}
				<span class={`status-badge status-${post.status}`}>
					{formatStatus(post.status)}
				</span>
			</p>
			<p>
				<em>"{post.idea}"</em>
			</p>
			{post.scheduled_at && <p>Scheduled for: {post.scheduled_at}</p>}
		</article>
	);
}

// ─── Error partial (returned on validation failure) ──────────────────────────

export function IdeaSubmitError({ message }: { message: string }) {
	return (
		<p role="alert" class="form-error">
			{message}
		</p>
	);
}

// ─── Recent posts list (used in page and as HTMX polling partial) ────────────

export function RecentPostsList({ posts }: { posts: Post[] }) {
	if (posts.length === 0) {
		return (
			<p class="secondary">
				No recent activity. Submit an idea above to get started!
			</p>
		);
	}

	return (
		<div>
			{posts.map((post) => (
				<article class="post-card" key={String(post.id)}>
					<div class="post-card-header">
						<strong>#{post.id}</strong>
						<span class={`status-badge status-${post.status}`}>
							{formatStatus(post.status)}
						</span>
					</div>
					<p>{post.idea}</p>
					{post.pomelli_image_path && (
						<img
							src={`/assets/${post.pomelli_image_path.split("/").pop()}`}
							alt="Generated asset"
							loading="lazy"
							style="max-height: 120px;"
						/>
					)}
					{(post.edited_caption ?? post.pomelli_caption) && (
						<blockquote>
							{post.edited_caption ?? post.pomelli_caption}
						</blockquote>
					)}
					<small class="secondary">
						{post.created_at}
						{post.scheduled_at && ` \u00B7 Scheduled: ${post.scheduled_at}`}
						{post.posted_at && ` \u00B7 Posted: ${post.posted_at}`}
					</small>
				</article>
			))}
		</div>
	);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatStatus(status: string): string {
	const labels: Record<string, string> = {
		generating: "Generating",
		pending_review: "Pending Review",
		approved: "Approved",
		posted: "Posted",
		failed: "Failed",
		rejected: "Rejected",
	};
	return labels[status] ?? status;
}

/**
 * History page — view posted content with tweet links and timestamps.
 *
 * HistoryPage renders the full page content (wrapped in Layout by the route).
 * HistoryList renders just the post list (used as HTMX partial too).
 */

import type { Post } from "../../db.ts";
import { getCaption, getImageUrl } from "../components/post-card.tsx";

// ─── Full page content ────────────────────────────────────────────────────────

interface HistoryPageProps {
	posts: Post[];
}

export function HistoryPage({ posts }: HistoryPageProps) {
	return (
		<>
			<hgroup>
				<h2>History</h2>
				<p>Posts that have been published to X.</p>
			</hgroup>

			<div
				id="history-list"
				hx-get="/partials/history"
				hx-trigger="every 30s"
				hx-swap="innerHTML"
			>
				<HistoryList posts={posts} />
			</div>
		</>
	);
}

// ─── History list (used in full page and as HTMX partial) ─────────────────────

export function HistoryList({ posts }: { posts: Post[] }) {
	if (posts.length === 0) {
		return (
			<p class="secondary">
				No posts published yet. Approve posts from the{" "}
				<a href="/queue">Queue</a> to see them here.
			</p>
		);
	}

	return (
		<>
			<p class="secondary">
				{posts.length} post{posts.length !== 1 ? "s" : ""} published
			</p>
			{posts.map((post) => (
				<HistoryCard post={post} key={String(post.id)} />
			))}
		</>
	);
}

// ─── Individual history card ──────────────────────────────────────────────────

function HistoryCard({ post }: { post: Post }) {
	const imageUrl = getImageUrl(post);
	const caption = getCaption(post);

	return (
		<article class="post-card history-card">
			<div class="post-card-header">
				<strong>#{post.id}</strong>
				<span class={`status-badge status-${post.status}`}>
					{formatStatus(post.status)}
				</span>
			</div>

			<p class="secondary" style="margin-bottom: 0.5rem;">
				{post.idea}
			</p>

			{imageUrl && (
				<img
					src={imageUrl}
					alt={`Generated asset for post #${post.id}`}
					loading="lazy"
					style="max-height: 200px; border-radius: 4px; margin-bottom: 0.5rem;"
				/>
			)}

			{caption && (
				<blockquote style="margin-bottom: 0.5rem;">{caption}</blockquote>
			)}

			{post.x_post_url && (
				<p style="margin-bottom: 0.5rem;">
					<a href={post.x_post_url} target="_blank" rel="noopener noreferrer">
						View on X &rarr;
					</a>
				</p>
			)}

			<small class="secondary">
				{post.posted_at ? `Posted: ${post.posted_at}` : ""}
				{post.posted_at && post.created_at && " · "}
				Created: {post.created_at}
				{post.scheduled_at && ` · Scheduled: ${post.scheduled_at}`}
			</small>
		</article>
	);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

/**
 * Queue page — review and approve pending posts before they go live.
 *
 * QueuePage renders the full page content (wrapped in Layout by the route).
 * QueueList renders just the post list (used as HTMX partial too).
 */

import type { Post } from "../../db.ts";
import { PostCard } from "../components/post-card.tsx";

// ─── Full page content ────────────────────────────────────────────────────────

interface QueuePageProps {
	posts: Post[];
}

export function QueuePage({ posts }: QueuePageProps) {
	return (
		<>
			<hgroup>
				<h2>Queue</h2>
				<p>Review and approve pending posts before they go live.</p>
			</hgroup>

			<div id="queue-list">
				<QueueList posts={posts} />
			</div>
		</>
	);
}

// ─── Queue list (used in full page and as HTMX partial) ──────────────────────

export function QueueList({ posts }: { posts: Post[] }) {
	if (posts.length === 0) {
		return (
			<p class="secondary">
				No posts pending review. Submit an idea on the <a href="/">New Post</a>{" "}
				page to get started!
			</p>
		);
	}

	return (
		<>
			<p class="secondary">
				{posts.length} post{posts.length !== 1 ? "s" : ""} pending review
			</p>
			{posts.map((post) => (
				<PostCard post={post} key={String(post.id)} />
			))}
		</>
	);
}

/**
 * Reusable post card components for the queue page.
 *
 * PostCard — display mode with Approve / Edit / Reject buttons.
 * PostCardEditForm — inline edit mode with caption textarea + Save / Cancel.
 *
 * Both components render an <article> with id="queue-card-{id}" so HTMX
 * can swap between display and edit modes via outerHTML replacement.
 */

import type { Post } from "../../db.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Get the static asset URL for a post's Pomelli image. */
export function getImageUrl(post: Post): string | null {
	return post.pomelli_image_path
		? `/assets/${post.pomelli_image_path.split("/").pop()}`
		: null;
}

/** Get the display caption — edited version takes priority over original. */
export function getCaption(post: Post): string | null {
	return post.edited_caption ?? post.pomelli_caption;
}

/** Format a status string for display. */
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

// ─── PostCard (display mode) ──────────────────────────────────────────────────

/** Queue card showing image, caption, and Approve / Edit / Reject buttons. */
export function PostCard({ post }: { post: Post }) {
	const imageUrl = getImageUrl(post);
	const caption = getCaption(post);

	return (
		<article class="queue-card post-card" id={`queue-card-${post.id}`}>
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
				<blockquote style="margin-bottom: 1rem;">{caption}</blockquote>
			)}

			{/* biome-ignore lint/a11y/useSemanticElements: Pico CSS requires role=group for button groups */}
			<div role="group">
				<button
					type="button"
					hx-post={`/queue/${post.id}/approve`}
					hx-target={`#queue-card-${post.id}`}
					hx-swap="outerHTML"
				>
					Approve
				</button>
				<button
					type="button"
					class="secondary"
					hx-get={`/partials/queue-card/${post.id}/edit`}
					hx-target={`#queue-card-${post.id}`}
					hx-swap="outerHTML"
				>
					Edit
				</button>
				<button
					type="button"
					class="contrast"
					hx-post={`/queue/${post.id}/reject`}
					hx-target={`#queue-card-${post.id}`}
					hx-swap="outerHTML"
					hx-confirm="Reject this post? This cannot be undone."
				>
					Reject
				</button>
			</div>

			<small class="secondary">
				Created: {post.created_at}
				{post.scheduled_at && ` \u00B7 Scheduled: ${post.scheduled_at}`}
			</small>
		</article>
	);
}

// ─── PostCardEditForm (inline edit mode) ──────────────────────────────────────

/** Inline edit form — replaces the PostCard for caption editing. */
export function PostCardEditForm({ post }: { post: Post }) {
	const caption = (getCaption(post) ?? "").trim();

	return (
		<article class="queue-card post-card" id={`queue-card-${post.id}`}>
			<div class="post-card-header">
				<strong>#{post.id}</strong>
				<span class="status-badge status-pending_review">Editing</span>
			</div>

			<p class="secondary" style="margin-bottom: 0.5rem;">
				{post.idea}
			</p>

			<form
				hx-post={`/queue/${post.id}/edit`}
				hx-target={`#queue-card-${post.id}`}
				hx-swap="outerHTML"
			>
				<label>
					Caption
					<textarea name="caption" rows={3} maxlength={280} required>
						{caption}
					</textarea>
				</label>
				<small class="secondary" style="display: block; margin-bottom: 0.5rem;">
					Maximum 280 characters for X posts.
				</small>
				{/* biome-ignore lint/a11y/useSemanticElements: Pico CSS requires role=group for button groups */}
				<div role="group">
					<button type="submit">Save Caption</button>
					<button
						type="button"
						class="secondary"
						hx-get={`/partials/queue-card/${post.id}`}
						hx-target={`#queue-card-${post.id}`}
						hx-swap="outerHTML"
					>
						Cancel
					</button>
				</div>
			</form>
		</article>
	);
}

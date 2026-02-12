/**
 * Flywheel orchestration service.
 * Wires together Pomelli generation and X posting into the end-to-end pipeline:
 *   Idea → Pomelli (async) → Queue → Approve → X Post
 *
 * Keeps route handlers thin by encapsulating the async orchestration logic.
 */

import type { Database } from "bun:sqlite";
import type { Post } from "../db.ts";
import { getPostById, getSetting, updatePostStatus } from "../db.ts";
import { getPommelliService, isLocked } from "./pomelli.ts";
import { type PostResult, postToX } from "./twitter.ts";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface GenerationStatus {
	started: boolean;
	message: string;
}

export interface ApproveResult {
	post: Post;
	/** Present only if posted to X immediately (non-scheduled). */
	tweet?: PostResult;
	/** Present if X posting failed. */
	error?: string;
}

// ─── Async Pomelli generation (fire-and-forget) ─────────────────────────────

/**
 * Trigger Pomelli asset generation for a new idea.
 *
 * This runs asynchronously — the HTTP request returns immediately with the
 * post in 'generating' status, and Pomelli works in the background.
 *
 * On success: post transitions to 'pending_review' with image + caption.
 * On failure: post transitions to 'failed' with error_message.
 *
 * Respects the Pomelli concurrency lock (only one generation at a time).
 */
export function triggerPommelliGeneration(
	db: Database,
	postId: number,
	idea: string,
): GenerationStatus {
	// Check if another generation is already running
	if (isLocked()) {
		console.log(
			`[flywheel] Post #${postId}: Pomelli is busy, queuing for later`,
		);
		// Don't fail the post — leave it in 'generating' status.
		// The user can retry or it'll be picked up when the lock clears.
		return {
			started: false,
			message:
				"Pomelli is currently generating another post. This one will stay in the queue.",
		};
	}

	// Fire-and-forget — don't await the promise
	runPommelliGeneration(db, postId, idea).catch((err) => {
		// This catch is a safety net — processIdea already handles its own errors.
		const message = err instanceof Error ? err.message : String(err);
		console.error(
			`[flywheel] Unhandled error generating post #${postId}: ${message}`,
		);
	});

	return {
		started: true,
		message: "Pomelli generation started in the background.",
	};
}

/**
 * Internal: run the Pomelli generation pipeline.
 * Updates the post record on success/failure (handled by PommelliService.processIdea).
 */
async function runPommelliGeneration(
	db: Database,
	postId: number,
	idea: string,
): Promise<void> {
	console.log(`[flywheel] Starting Pomelli generation for post #${postId}`);

	const service = getPommelliService();
	const websiteUrl = getSetting(db, "website_url") ?? undefined;

	try {
		const result = await service.processIdea(db, postId, idea, websiteUrl);
		console.log(
			`[flywheel] Post #${postId} generation complete: ${result.images.length} image(s), ` +
				`caption ${result.caption.length} chars → pending_review`,
		);
	} catch (err) {
		// processIdea already sets the post status to 'failed' and logs the error.
		// We just log here for the flywheel-level trace.
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[flywheel] Post #${postId} generation failed: ${message}`);
	}
}

// ─── Approve + optional X posting ───────────────────────────────────────────

/**
 * Approve a pending_review post and optionally post to X immediately.
 *
 * - If the post has a scheduled_at: mark as 'approved', leave for scheduler.
 * - If no schedule and content is ready: approve + post to X immediately.
 * - If no schedule but content is missing: just approve (edge case).
 *
 * Returns the updated post and optional tweet result.
 */
export async function approvePost(
	db: Database,
	post: Post,
): Promise<ApproveResult> {
	// If scheduled for later, just mark as approved and wait for scheduler
	if (post.scheduled_at) {
		updatePostStatus(db, post.id, "approved");
		const updated = getPostById(db, post.id)!;
		console.log(
			`[flywheel] Post #${post.id} approved, scheduled for ${post.scheduled_at}`,
		);
		return { post: updated };
	}

	// No schedule — attempt immediate X posting
	updatePostStatus(db, post.id, "approved");

	const caption = post.edited_caption ?? post.pomelli_caption;
	const imagePath = post.pomelli_image_path;

	if (!caption || !imagePath) {
		// Content not ready — mark approved but can't post yet
		const updated = getPostById(db, post.id)!;
		console.log(
			`[flywheel] Post #${post.id} approved but content not ready for immediate posting`,
		);
		return { post: updated };
	}

	try {
		const refreshed = getPostById(db, post.id)!;
		const result = await postToX(db, refreshed);
		const posted = getPostById(db, post.id)!;
		console.log(
			`[flywheel] Post #${post.id} approved and posted to X: ${result.tweetUrl}`,
		);
		return { post: posted, tweet: result };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(
			`[flywheel] Post #${post.id} approved but X posting failed: ${message}`,
		);
		const failed = getPostById(db, post.id)!;
		return { post: failed, error: message };
	}
}

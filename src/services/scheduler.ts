/**
 * Cron-based scheduled posting service.
 *
 * Runs a lightweight cron job every minute that:
 * 1. Queries approved posts with scheduled_at <= now
 * 2. Posts each due item via the Twitter service
 * 3. Handles failures gracefully (log + set status to failed, don't crash)
 *
 * Uses `croner` for in-process cron scheduling (FR-5).
 * All times are UTC (out of scope: timezone management).
 */

import type { Database } from "bun:sqlite";
import { Cron } from "croner";
import { getDueScheduledPosts, getPostById } from "../db.ts";
import { postToX } from "./twitter.ts";

// ─── State ───────────────────────────────────────────────────────────────────

let cronJob: Cron | null = null;
let isRunning = false;

// ─── Core tick function ──────────────────────────────────────────────────────

/**
 * Process all due scheduled posts.
 *
 * Called every minute by the cron job. Exported for testing.
 * Each post is processed independently — a failure in one does not affect others.
 */
export async function processDuePosts(db: Database): Promise<number> {
	if (isRunning) {
		console.log("[cron] Previous tick still running, skipping");
		return 0;
	}

	isRunning = true;
	let processed = 0;

	try {
		const duePosts = getDueScheduledPosts(db);

		if (duePosts.length === 0) {
			return 0;
		}

		console.log(`[cron] Found ${duePosts.length} due post(s) to publish`);

		for (const post of duePosts) {
			try {
				// Re-fetch to ensure we have the latest state
				// (another process/route may have changed it)
				const current = getPostById(db, post.id);
				if (!current || current.status !== "approved") {
					console.log(
						`[cron] Post #${post.id} no longer approved (status: ${current?.status ?? "deleted"}), skipping`,
					);
					continue;
				}

				console.log(
					`[cron] Publishing post #${post.id} (scheduled for ${post.scheduled_at})`,
				);

				const result = await postToX(db, current);
				console.log(`[cron] Post #${post.id} published: ${result.tweetUrl}`);
				processed++;
			} catch (err) {
				// postToX already sets status to 'failed' and logs the error.
				// We catch here to continue processing other posts.
				const message = err instanceof Error ? err.message : String(err);
				console.error(`[cron] Failed to publish post #${post.id}: ${message}`);
			}
		}

		if (processed > 0) {
			console.log(`[cron] Published ${processed}/${duePosts.length} post(s)`);
		}
	} catch (err) {
		// Catch-all for unexpected errors (e.g., DB connection issues).
		// Log and let the next tick retry.
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[cron] Tick failed: ${message}`);
	} finally {
		isRunning = false;
	}

	return processed;
}

// ─── Scheduler lifecycle ─────────────────────────────────────────────────────

/**
 * Start the cron-based scheduler.
 *
 * Runs every minute (FR-3). On startup, immediately checks for overdue posts
 * to handle server restarts gracefully (AC-4).
 *
 * Lightweight: just a DB query and conditional posting (NFR-1).
 * Failures don't crash the server (NFR-2).
 */
export function startScheduler(db: Database): Cron {
	if (cronJob) {
		console.log("[cron] Scheduler already running");
		return cronJob;
	}

	console.log("[cron] Starting scheduler (every minute)");

	// Run every minute
	cronJob = new Cron("* * * * *", { protect: true }, async () => {
		await processDuePosts(db);
	});

	// Immediately check for overdue posts on startup (AC-4)
	console.log("[cron] Checking for overdue posts on startup...");
	processDuePosts(db).catch((err) => {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[cron] Startup check failed: ${message}`);
	});

	return cronJob;
}

/**
 * Stop the scheduler. Used for cleanup in tests and shutdown.
 */
export function stopScheduler(): void {
	if (cronJob) {
		cronJob.stop();
		cronJob = null;
		isRunning = false;
		console.log("[cron] Scheduler stopped");
	}
}

/**
 * Check if the scheduler is currently running.
 */
export function isSchedulerRunning(): boolean {
	return cronJob !== null;
}

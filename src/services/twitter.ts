/**
 * X (Twitter) posting service.
 * Handles image upload, tweet posting, validation, and usage tracking.
 *
 * Uses twitter-api-v2 with OAuth 1.0a user context auth.
 * Credentials come from config.ts (env vars).
 */

import type { Database } from "bun:sqlite";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { EUploadMimeType, TwitterApi } from "twitter-api-v2";
import { config } from "../config.ts";
import { getSetting, type Post, setSetting, updatePostStatus } from "../db.ts";
import { ensureImageWithinLimit } from "./image.ts";

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_CAPTION_LENGTH = 280;
const MONTHLY_POST_LIMIT = 1500; // X Free tier

const ALLOWED_MIME_TYPES: Record<string, EUploadMimeType> = {
	".png": EUploadMimeType.Png,
	".jpg": EUploadMimeType.Jpeg,
	".jpeg": EUploadMimeType.Jpeg,
};

// ─── Error class ─────────────────────────────────────────────────────────────

export class TwitterPostError extends Error {
	constructor(
		message: string,
		public readonly code: string,
	) {
		super(message);
		this.name = "TwitterPostError";
	}
}

// ─── Result type ─────────────────────────────────────────────────────────────

export interface PostResult {
	tweetId: string;
	tweetUrl: string;
}

// ─── Client factory ──────────────────────────────────────────────────────────

/**
 * Create an authenticated Twitter API client using OAuth 1.0a credentials.
 * Reads credentials from config.ts (which reads from env vars).
 */
export function createClient(): TwitterApi {
	return new TwitterApi({
		appKey: config.x.apiKey,
		appSecret: config.x.apiSecret,
		accessToken: config.x.accessToken,
		accessSecret: config.x.accessTokenSecret,
	});
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate that the caption is within the 280 character limit (FR-4).
 * Throws TwitterPostError if over limit.
 */
export function validateCaption(caption: string): void {
	if (caption.length > MAX_CAPTION_LENGTH) {
		throw new TwitterPostError(
			`Caption is ${caption.length} characters (max ${MAX_CAPTION_LENGTH}). Edit in queue before posting.`,
			"CAPTION_TOO_LONG",
		);
	}
}

/**
 * Validate that the image exists, is < 5MB, and is PNG or JPEG (FR-3).
 * Returns the MIME type for upload.
 * Throws TwitterPostError on validation failure.
 */
export async function validateImage(
	imagePath: string,
): Promise<EUploadMimeType> {
	const ext = extname(imagePath).toLowerCase();
	const mimeType = ALLOWED_MIME_TYPES[ext];

	if (!mimeType) {
		throw new TwitterPostError(
			`Image must be PNG or JPEG (got "${ext || "unknown"}")`,
			"INVALID_IMAGE_TYPE",
		);
	}

	let fileStat: Awaited<ReturnType<typeof stat>>;
	try {
		fileStat = await stat(imagePath);
	} catch {
		throw new TwitterPostError(
			`Image file not found: ${imagePath}`,
			"IMAGE_NOT_FOUND",
		);
	}

	if (fileStat.size > MAX_IMAGE_SIZE) {
		throw new TwitterPostError(
			`Image is ${(fileStat.size / 1024 / 1024).toFixed(1)}MB (max 5MB)`,
			"IMAGE_TOO_LARGE",
		);
	}

	return mimeType;
}

// ─── Usage tracking (NFR-1) ──────────────────────────────────────────────────

/**
 * Get the current month key (YYYY-MM) for usage tracking.
 */
function getMonthKey(): string {
	const now = new Date();
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Get the number of posts made this month.
 */
export function getMonthlyUsage(db: Database): number {
	const key = `x_usage_${getMonthKey()}`;
	const value = getSetting(db, key);
	return value ? Number.parseInt(value, 10) : 0;
}

/**
 * Increment the monthly usage counter.
 */
function incrementMonthlyUsage(db: Database): void {
	const key = `x_usage_${getMonthKey()}`;
	const current = getMonthlyUsage(db);
	setSetting(db, key, String(current + 1));
}

/**
 * Check if we're at or approaching the monthly post limit.
 * Throws TwitterPostError if limit is reached.
 * Warns if fewer than 50 posts remain.
 */
export function checkUsageLimit(db: Database): void {
	const usage = getMonthlyUsage(db);
	if (usage >= MONTHLY_POST_LIMIT) {
		throw new TwitterPostError(
			`Monthly X post limit reached (${usage}/${MONTHLY_POST_LIMIT}). Wait until next month.`,
			"RATE_LIMIT_EXCEEDED",
		);
	}
	if (usage >= MONTHLY_POST_LIMIT - 50) {
		console.warn(
			`[twitter] Warning: ${MONTHLY_POST_LIMIT - usage} posts remaining this month`,
		);
	}
}

// ─── Core posting function ───────────────────────────────────────────────────

/**
 * Post to X (Twitter) with an image and caption (FR-1).
 *
 * Flow:
 * 1. Validate caption length (FR-4)
 * 2. Validate image size and format (FR-3)
 * 3. Check monthly usage limit (NFR-1)
 * 4. Upload image via v1.1 media endpoint (FR-2)
 * 5. Post tweet via v2 API (FR-1)
 * 6. Update post record with tweet ID/URL (FR-5, FR-6)
 * 7. Track monthly usage (NFR-1)
 *
 * On failure, sets post status to 'failed' with error message (FR-6).
 */
export async function postToX(
	db: Database,
	post: Post,
	/** Allows injecting a mock client for tests */
	client?: TwitterApi,
): Promise<PostResult> {
	const caption = post.edited_caption ?? post.pomelli_caption;
	const imagePath = post.pomelli_image_path;

	if (!caption) {
		throw new TwitterPostError(
			"No caption available for posting",
			"NO_CAPTION",
		);
	}
	if (!imagePath) {
		throw new TwitterPostError("No image available for posting", "NO_IMAGE");
	}

	// Validate inputs
	validateCaption(caption);
	checkUsageLimit(db);

	// Validate and resize image if needed (PRD: "resize if needed with Sharp")
	let finalImagePath = imagePath;
	try {
		const imageResult = await ensureImageWithinLimit(imagePath);
		finalImagePath = imageResult.path;
		if (imageResult.resized) {
			console.log(
				`[twitter] Image resized: ${imagePath} → ${finalImagePath} (${(imageResult.sizeBytes / 1024 / 1024).toFixed(1)}MB)`,
			);
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new TwitterPostError(msg, "IMAGE_TOO_LARGE");
	}

	const mimeType = await validateImage(finalImagePath);

	console.log(
		`[twitter] Posting idea #${post.id}: "${caption.slice(0, 50)}${caption.length > 50 ? "..." : ""}"`,
	);

	try {
		const twitterClient = client ?? createClient();

		// Upload image via v1.1 media upload endpoint (FR-2)
		console.log(`[twitter] Uploading image: ${finalImagePath}`);
		const mediaId = await twitterClient.v1.uploadMedia(finalImagePath, {
			mimeType,
		});
		console.log(`[twitter] Image uploaded, media_id: ${mediaId}`);

		// Post tweet via v2 API (FR-1)
		const tweet = await twitterClient.v2.tweet({
			text: caption,
			media: { media_ids: [mediaId] },
		});

		const tweetId = tweet.data.id;
		const tweetUrl = `https://x.com/i/status/${tweetId}`;

		console.log(
			`[twitter] Posted successfully! Tweet ID: ${tweetId}, URL: ${tweetUrl}`,
		);

		// Update post status to 'posted' (FR-5, FR-6)
		updatePostStatus(db, post.id, "posted", {
			x_post_id: tweetId,
			x_post_url: tweetUrl,
			posted_at: new Date().toISOString(),
		});

		// Track API usage (NFR-1)
		incrementMonthlyUsage(db);
		const usage = getMonthlyUsage(db);
		console.log(`[twitter] Monthly usage: ${usage}/${MONTHLY_POST_LIMIT}`);

		return { tweetId, tweetUrl };
	} catch (error) {
		// If it's already our error type, update status and rethrow
		if (error instanceof TwitterPostError) {
			updatePostStatus(db, post.id, "failed", {
				error_message: error.message,
			});
			throw error;
		}

		// Handle twitter-api-v2 errors or unexpected errors
		const message = error instanceof Error ? error.message : String(error);
		console.error(`[twitter] Failed to post idea #${post.id}: ${message}`);

		updatePostStatus(db, post.id, "failed", {
			error_message: message,
		});

		throw new TwitterPostError(`Failed to post to X: ${message}`, "API_ERROR");
	}
}

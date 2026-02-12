/**
 * Image processing utilities.
 * Handles validation and resize fallback for images that exceed the X API 5MB limit.
 *
 * Uses Sharp for image manipulation (PRD § Risks & Mitigations).
 */

import { stat } from "node:fs/promises";
import { join, parse as parsePath } from "node:path";
import sharp from "sharp";

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB — X API limit
const RESIZE_QUALITY_STEPS = [90, 80, 70, 60]; // Progressive quality reduction
const RESIZE_MAX_DIMENSION = 2048; // Cap longest side at 2048px

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ImageValidation {
	/** The path to use (original or resized). */
	path: string;
	/** Whether the image was resized. */
	resized: boolean;
	/** File size in bytes of the final image. */
	sizeBytes: number;
}

// ─── Core function ────────────────────────────────────────────────────────────

/**
 * Ensure an image is within the X API size limit (5MB).
 * If the image is too large, attempt to resize/recompress it.
 *
 * Strategy:
 * 1. Check file size
 * 2. If under 5MB, return as-is
 * 3. If over, resize: cap dimensions at 2048px and progressively reduce quality
 * 4. Save resized image alongside original (suffixed with _resized)
 * 5. If still over 5MB after all quality steps, throw
 *
 * @param imagePath Path to the original image file.
 * @returns Validation result with the path to use.
 */
export async function ensureImageWithinLimit(
	imagePath: string,
): Promise<ImageValidation> {
	let fileStat: Awaited<ReturnType<typeof stat>>;

	try {
		fileStat = await stat(imagePath);
	} catch {
		throw new Error(`Image file not found: ${imagePath}`);
	}

	// Already within limit
	if (fileStat.size <= MAX_IMAGE_SIZE) {
		console.log(
			`[image] Image is ${formatSize(fileStat.size)} — within 5MB limit`,
		);
		return { path: imagePath, resized: false, sizeBytes: fileStat.size };
	}

	console.log(
		`[image] Image is ${formatSize(fileStat.size)} — exceeds 5MB limit, resizing...`,
	);

	// Determine output path
	const parsed = parsePath(imagePath);
	const ext = parsed.ext.toLowerCase();
	const outputPath = join(parsed.dir, `${parsed.name}_resized${ext}`);

	// Try progressive quality reduction
	for (const quality of RESIZE_QUALITY_STEPS) {
		try {
			let pipeline = sharp(imagePath).resize({
				width: RESIZE_MAX_DIMENSION,
				height: RESIZE_MAX_DIMENSION,
				fit: "inside",
				withoutEnlargement: true,
			});

			if (ext === ".png") {
				pipeline = pipeline.png({ quality, compressionLevel: 9 });
			} else {
				// .jpg / .jpeg
				pipeline = pipeline.jpeg({ quality, mozjpeg: true });
			}

			await pipeline.toFile(outputPath);
			const resizedStat = await stat(outputPath);

			if (resizedStat.size <= MAX_IMAGE_SIZE) {
				console.log(
					`[image] Resized to ${formatSize(resizedStat.size)} at quality ${quality}`,
				);
				return {
					path: outputPath,
					resized: true,
					sizeBytes: resizedStat.size,
				};
			}

			console.log(
				`[image] Quality ${quality} → ${formatSize(resizedStat.size)} — still too large, trying lower quality...`,
			);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(
				`[image] Resize attempt at quality ${quality} failed: ${message}`,
			);
		}
	}

	// Last resort: convert PNG to JPEG (typically much smaller)
	if (ext === ".png") {
		console.log(
			"[image] PNG still too large — converting to JPEG as last resort",
		);
		const jpegPath = join(parsed.dir, `${parsed.name}_resized.jpg`);

		try {
			await sharp(imagePath)
				.resize({
					width: RESIZE_MAX_DIMENSION,
					height: RESIZE_MAX_DIMENSION,
					fit: "inside",
					withoutEnlargement: true,
				})
				.jpeg({ quality: 70, mozjpeg: true })
				.toFile(jpegPath);

			const jpegStat = await stat(jpegPath);

			if (jpegStat.size <= MAX_IMAGE_SIZE) {
				console.log(
					`[image] PNG → JPEG conversion: ${formatSize(jpegStat.size)}`,
				);
				return {
					path: jpegPath,
					resized: true,
					sizeBytes: jpegStat.size,
				};
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`[image] PNG → JPEG conversion failed: ${message}`);
		}
	}

	throw new Error(
		`Image is ${formatSize(fileStat.size)} and could not be resized below 5MB. ` +
			"Try using a smaller or lower-resolution image.",
	);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

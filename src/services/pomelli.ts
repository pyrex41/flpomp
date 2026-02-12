/**
 * Pomelli browser automation service.
 * Drives Google Pomelli via Playwright to generate branded social media assets.
 *
 * All selectors are in the SELECTORS object (FR-9, NFR-1).
 * Debug screenshots at every step (FR-10).
 * 2-5s human-mimicking delays (FR-11).
 * Concurrency lock — never parallel (NFR-3).
 */

import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { BrowserContext, Page } from "playwright";
import { chromium } from "playwright";
import { config } from "../config.ts";
import { updatePostStatus } from "../db.ts";

// ─── Selectors ────────────────────────────────────────────────────────────────
// All Pomelli UI selectors in one place for easy maintenance (FR-9).
// Prefer data-testid, aria-label, text content over CSS classes (NFR-1).

export const SELECTORS = {
	/** Indicator that user is logged in (avatar / user menu present). */
	loggedInIndicator:
		'[aria-label="Account"], [data-testid="user-avatar"], img[alt*="profile" i]',

	/** Login/sign-in button visible when not authenticated. */
	signInButton: 'text="Sign in", text="Log in", [data-testid="sign-in"]',

	/** Business DNA — "Create" or "Get started" button on first run. */
	businessDnaCreate:
		'text="Create Business DNA", text="Get started", [data-testid="create-business-dna"]',

	/** Business DNA website URL input field. */
	businessDnaUrlInput:
		'input[aria-label*="website" i], input[placeholder*="website" i], input[name="url"], input[type="url"]',

	/** Business DNA submit / analyze button. */
	businessDnaSubmit:
		'button:has-text("Analyze"), button:has-text("Create"), button[type="submit"]',

	/** Business DNA completion indicator. */
	businessDnaComplete:
		'text="Business DNA created", text="Ready", [data-testid="dna-complete"]',

	/** "Create Campaign" or "New Campaign" button on the main dashboard. */
	createCampaign:
		'button:has-text("Create"), button:has-text("New campaign"), [data-testid="create-campaign"], a:has-text("Create")',

	/** Campaign idea / prompt text input. */
	campaignIdeaInput:
		'textarea[aria-label*="idea" i], textarea[placeholder*="idea" i], textarea[aria-label*="prompt" i], textarea[name="prompt"], textarea',

	/** Campaign generate / submit button. */
	campaignGenerate:
		'button:has-text("Generate"), button:has-text("Create"), button[type="submit"]',

	/** Container for generated campaign output. */
	campaignOutput:
		'[data-testid="campaign-output"], [data-testid="campaign-results"], .campaign-output, .campaign-results',

	/** Generated image elements within the campaign output. */
	campaignImages:
		'[data-testid="campaign-output"] img, [data-testid="campaign-results"] img, .campaign-output img, .campaign-results img, [role="img"] img',

	/** Generated caption/copy text within the campaign output. */
	campaignCaption:
		'[data-testid="caption-text"], [data-testid="campaign-copy"], .caption-text, .campaign-copy, [aria-label*="caption" i]',

	/** Fallback: any visible large text block that looks like a caption. */
	campaignCaptionFallback: "p, [role='textbox']",

	/** Loading / generation-in-progress indicator. */
	generationLoading:
		'[data-testid="loading"], [aria-busy="true"], .loading, [role="progressbar"]',
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CampaignResult {
	images: string[];
	caption: string;
}

/**
 * Cookie format accepted for import (matches common browser extension exports).
 * Supports both full Playwright-style cookies and simplified exports.
 */
export interface ImportedCookie {
	name: string;
	value: string;
	domain: string;
	path?: string;
	/** Expiry as Unix timestamp (seconds). */
	expires?: number;
	/** Alternative field name used by some export tools. */
	expirationDate?: number;
	httpOnly?: boolean;
	secure?: boolean;
	sameSite?: "Strict" | "Lax" | "None" | string;
}

export interface AuthStatus {
	status: "active" | "expired" | "error" | "unknown";
	message: string;
	checkedAt: string;
}

export interface PommelliOptions {
	/** Override browser state dir (for testing). */
	browserStateDir?: string;
	/** Override assets dir (for testing). */
	assetsDir?: string;
	/** Override debug dir (for testing). */
	debugDir?: string;
	/** Headless mode (default true). */
	headless?: boolean;
	/** Base URL for Pomelli (default: https://labs.google.com/pomelli). */
	baseUrl?: string;
	/** Skip human-mimicking delays (for testing). */
	skipDelay?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const POMELLI_BASE_URL = "https://labs.google.com/pomelli";
const GENERATION_TIMEOUT_MS = 120_000; // NFR-2
const BUSINESS_DNA_TIMEOUT_MS = 90_000;
const AUTH_STATUS_TIMEOUT_MS = 10_000; // auth-session NFR-1
const MIN_DELAY_MS = 2_000;
const MAX_DELAY_MS = 5_000;

/**
 * Normalize sameSite value from various export formats to Playwright format.
 */
function normalizeSameSite(value?: string): "Strict" | "Lax" | "None" {
	if (!value) return "Lax";
	const lower = value.toLowerCase();
	if (lower === "strict") return "Strict";
	if (lower === "none" || lower === "no_restriction") return "None";
	return "Lax";
}

// ─── Concurrency lock (NFR-3) ─────────────────────────────────────────────────

let automationLock = false;

export function isLocked(): boolean {
	return automationLock;
}

/**
 * Force-release the lock (for testing only).
 */
export function _resetLock(): void {
	automationLock = false;
}

function acquireLock(): void {
	if (automationLock) {
		throw new PommelliError(
			"Another Pomelli automation is already running. Try again later.",
			"CONCURRENCY_LOCK",
		);
	}
	automationLock = true;
	console.log("[pomelli] Lock acquired");
}

function releaseLock(): void {
	automationLock = false;
	console.log("[pomelli] Lock released");
}

// ─── Error class ──────────────────────────────────────────────────────────────

export class PommelliError extends Error {
	constructor(
		message: string,
		public readonly code: string,
	) {
		super(message);
		this.name = "PommelliError";
	}
}

// ─── Utility: human-mimicking delay (FR-11) ──────────────────────────────────

export function humanDelay(): Promise<void> {
	const ms =
		Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS)) + MIN_DELAY_MS;
	console.log(`[pomelli] Waiting ${ms}ms (human delay)`);
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Utility: debug screenshot (FR-10) ───────────────────────────────────────

let screenshotCounter = 0;

async function debugScreenshot(
	page: Page,
	stepName: string,
	debugDir: string,
): Promise<void> {
	screenshotCounter++;
	const filename = `${String(screenshotCounter).padStart(3, "0")}_${stepName}.png`;
	const filepath = join(debugDir, filename);
	try {
		await page.screenshot({ path: filepath, fullPage: true });
		console.log(`[pomelli] Screenshot saved: ${filename}`);
	} catch (err) {
		console.warn(
			`[pomelli] Failed to save screenshot: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}

// ─── Utility: ensure directories ──────────────────────────────────────────────

function ensureDir(dir: string): void {
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
}

// ─── PommelliService ──────────────────────────────────────────────────────────

export class PommelliService {
	private context: BrowserContext | null = null;
	private readonly browserStateDir: string;
	private readonly assetsDir: string;
	private readonly debugDir: string;
	private readonly headless: boolean;
	private readonly baseUrl: string;
	private readonly skipDelay: boolean;

	constructor(options?: PommelliOptions) {
		this.browserStateDir = options?.browserStateDir ?? config.browserStateDir;
		this.assetsDir = options?.assetsDir ?? config.assetsDir;
		this.debugDir = options?.debugDir ?? config.debugDir;
		this.headless = options?.headless ?? true;
		this.baseUrl = options?.baseUrl ?? POMELLI_BASE_URL;
		this.skipDelay = options?.skipDelay ?? false;
	}

	/**
	 * Wait with a human-mimicking delay (FR-11), unless skipped for testing.
	 */
	private async delay(): Promise<void> {
		if (this.skipDelay) return;
		return humanDelay();
	}

	// ─── Browser lifecycle ──────────────────────────────────────────────────

	/**
	 * Launch or reuse a persistent Chromium browser context (FR-1).
	 * State is stored at DATA_DIR/browser-state/ and survives restarts.
	 */
	async launch(): Promise<BrowserContext> {
		if (this.context) return this.context;

		ensureDir(this.browserStateDir);
		ensureDir(this.assetsDir);
		ensureDir(this.debugDir);

		console.log(
			`[pomelli] Launching browser (headless=${this.headless}, state=${this.browserStateDir})`,
		);

		this.context = await chromium.launchPersistentContext(
			this.browserStateDir,
			{
				headless: this.headless,
				viewport: { width: 1280, height: 900 },
				userAgent:
					"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
				args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
			},
		);

		console.log("[pomelli] Browser launched");
		return this.context;
	}

	/**
	 * Close the browser context.
	 */
	async close(): Promise<void> {
		if (this.context) {
			await this.context.close();
			this.context = null;
			console.log("[pomelli] Browser closed");
		}
	}

	/**
	 * Get the active page, or create a new one.
	 */
	private async getPage(): Promise<Page> {
		const ctx = await this.launch();
		const pages = ctx.pages();
		return pages.length > 0 ? pages[0]! : await ctx.newPage();
	}

	// ─── Cookie import (auth-session FR-4) ──────────────────────────────────

	/**
	 * Import Google cookies into the persistent browser context.
	 * Accepts an array of cookies (e.g. from a browser extension export).
	 * Validates format and injects into Playwright context.
	 *
	 * Cookies are persisted in the browser state directory (FR-5) and
	 * never stored as separate plaintext files (NFR-2).
	 *
	 * @throws PommelliError if cookies are invalid or injection fails.
	 */
	async importCookies(cookies: ImportedCookie[]): Promise<void> {
		if (!Array.isArray(cookies) || cookies.length === 0) {
			throw new PommelliError(
				"Cookies must be a non-empty array",
				"INVALID_COOKIES",
			);
		}

		// Validate each cookie has required fields
		for (const cookie of cookies) {
			if (!cookie.name || typeof cookie.name !== "string") {
				throw new PommelliError(
					`Cookie missing required "name" field`,
					"INVALID_COOKIES",
				);
			}
			if (cookie.value === undefined || typeof cookie.value !== "string") {
				throw new PommelliError(
					`Cookie "${cookie.name}" missing required "value" field`,
					"INVALID_COOKIES",
				);
			}
			if (!cookie.domain || typeof cookie.domain !== "string") {
				throw new PommelliError(
					`Cookie "${cookie.name}" missing required "domain" field`,
					"INVALID_COOKIES",
				);
			}
		}

		// Filter to only Google-related cookies for safety
		const googleCookies = cookies.filter(
			(c) =>
				c.domain.includes("google.com") ||
				c.domain.includes("google.co") ||
				c.domain.includes("youtube.com") ||
				c.domain.includes("gstatic.com") ||
				c.domain.includes("googleapis.com"),
		);

		if (googleCookies.length === 0) {
			throw new PommelliError(
				"No Google-related cookies found. Export cookies from a page on google.com while logged in.",
				"NO_GOOGLE_COOKIES",
			);
		}

		console.log(
			`[pomelli] Importing ${googleCookies.length} Google cookies (${cookies.length} total provided)`,
		);

		const ctx = await this.launch();

		// Normalize cookies to Playwright format
		const playwrightCookies = googleCookies.map((c) => {
			const sameSite = normalizeSameSite(c.sameSite);
			return {
				name: c.name,
				value: c.value,
				domain: c.domain,
				path: c.path ?? "/",
				expires: c.expires ?? c.expirationDate ?? -1,
				httpOnly: c.httpOnly ?? false,
				secure: c.secure ?? true,
				sameSite: sameSite as "Strict" | "Lax" | "None",
			};
		});

		try {
			await ctx.addCookies(playwrightCookies);
			console.log(
				`[pomelli] Successfully injected ${playwrightCookies.length} cookies`,
			);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`[pomelli] Cookie injection failed: ${message}`);
			throw new PommelliError(
				`Failed to inject cookies: ${message}`,
				"COOKIE_INJECTION_FAILED",
			);
		}
	}

	// ─── Auth status check (auth-session FR-2) ──────────────────────────────

	/**
	 * Check the Google authentication status by navigating to Pomelli.
	 * Returns structured status with message, completes within 10s (NFR-1).
	 */
	async getAuthStatus(): Promise<AuthStatus> {
		const checkedAt = new Date().toISOString();

		try {
			const isActive = await Promise.race([
				this.checkSession(),
				new Promise<never>((_, reject) =>
					setTimeout(
						() => reject(new Error("Health check timed out")),
						AUTH_STATUS_TIMEOUT_MS,
					),
				),
			]);

			if (isActive) {
				return {
					status: "active",
					message: "Google session is active. Pomelli automation is ready.",
					checkedAt,
				};
			}

			return {
				status: "expired",
				message:
					"Google session has expired. Please import fresh cookies via Settings to re-authenticate.",
				checkedAt,
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`[pomelli] Auth status check error: ${message}`);
			return {
				status: "error",
				message: `Session check failed: ${message}`,
				checkedAt,
			};
		}
	}

	// ─── Session check (FR-2) ───────────────────────────────────────────────

	/**
	 * Navigate to Pomelli and verify the Google session is active.
	 * Returns true if logged in, false if sign-in is required.
	 */
	async checkSession(): Promise<boolean> {
		console.log("[pomelli] Checking session...");
		const page = await this.getPage();

		try {
			await page.goto(this.baseUrl, {
				waitUntil: "networkidle",
				timeout: 30_000,
			});

			await debugScreenshot(page, "session_check", this.debugDir);

			// Check for logged-in indicator
			const loggedIn = await page
				.locator(SELECTORS.loggedInIndicator)
				.first()
				.isVisible({ timeout: 5_000 })
				.catch(() => false);

			if (loggedIn) {
				console.log("[pomelli] Session is active");
				return true;
			}

			// Check for sign-in button (confirms we're on the page but not logged in)
			const signInVisible = await page
				.locator(SELECTORS.signInButton)
				.first()
				.isVisible({ timeout: 3_000 })
				.catch(() => false);

			if (signInVisible) {
				console.log("[pomelli] Session expired — sign-in required");
				return false;
			}

			// Ambiguous state — try to detect from page content
			const url = page.url();
			if (url.includes("accounts.google.com") || url.includes("signin")) {
				console.log("[pomelli] Redirected to Google sign-in");
				return false;
			}

			// If we're still on a Pomelli URL, assume logged in
			if (url.includes("pomelli")) {
				console.log("[pomelli] On Pomelli page, assuming session is active");
				return true;
			}

			console.log("[pomelli] Unable to determine session status");
			return false;
		} catch (err) {
			await debugScreenshot(page, "session_check_error", this.debugDir);
			console.error(
				`[pomelli] Session check failed: ${err instanceof Error ? err.message : String(err)}`,
			);
			return false;
		}
	}

	// ─── Business DNA creation (FR-3) ───────────────────────────────────────

	/**
	 * Create a Business DNA profile by entering the configured website URL.
	 * Waits up to 90s for analysis to complete.
	 * Only needed on first run — skips if profile already exists.
	 */
	async createBusinessDNA(websiteUrl: string): Promise<void> {
		console.log(`[pomelli] Creating Business DNA for ${websiteUrl}`);
		const page = await this.getPage();

		await page.goto(this.baseUrl, {
			waitUntil: "networkidle",
			timeout: 30_000,
		});
		await this.delay();
		await debugScreenshot(page, "business_dna_start", this.debugDir);

		// Check if Business DNA creation button exists
		const createBtn = page.locator(SELECTORS.businessDnaCreate).first();
		const needsCreation = await createBtn
			.isVisible({ timeout: 5_000 })
			.catch(() => false);

		if (!needsCreation) {
			console.log("[pomelli] Business DNA already exists or not on setup page");
			return;
		}

		await createBtn.click();
		await this.delay();
		await debugScreenshot(page, "business_dna_clicked", this.debugDir);

		// Enter website URL
		const urlInput = page.locator(SELECTORS.businessDnaUrlInput).first();
		await urlInput.waitFor({ state: "visible", timeout: 10_000 });
		await urlInput.fill(websiteUrl);
		await this.delay();

		// Submit
		const submitBtn = page.locator(SELECTORS.businessDnaSubmit).first();
		await submitBtn.click();
		await debugScreenshot(page, "business_dna_submitted", this.debugDir);

		console.log("[pomelli] Waiting for Business DNA analysis (~60s)...");

		// Wait for completion indicator
		try {
			await page.locator(SELECTORS.businessDnaComplete).first().waitFor({
				state: "visible",
				timeout: BUSINESS_DNA_TIMEOUT_MS,
			});
			console.log("[pomelli] Business DNA created successfully");
		} catch {
			// Fallback: wait for loading to finish
			await page
				.locator(SELECTORS.generationLoading)
				.first()
				.waitFor({ state: "hidden", timeout: BUSINESS_DNA_TIMEOUT_MS })
				.catch(() => {
					/* loading may not appear */
				});
			console.log(
				"[pomelli] Business DNA analysis finished (no explicit completion signal)",
			);
		}

		await debugScreenshot(page, "business_dna_complete", this.debugDir);
		await this.delay();
	}

	// ─── Campaign generation (FR-4, FR-5, FR-6, FR-7) ──────────────────────

	/**
	 * Generate a campaign from an idea.
	 * Downloads images to DATA_DIR/assets/ and extracts the caption.
	 *
	 * @returns Paths to downloaded images and the caption text.
	 * @throws PommelliError on timeout (NFR-2) or generation failure.
	 */
	async generateCampaign(idea: string): Promise<CampaignResult> {
		console.log(
			`[pomelli] Generating campaign: "${idea.slice(0, 60)}${idea.length > 60 ? "..." : ""}"`,
		);
		const page = await this.getPage();

		await page.goto(this.baseUrl, {
			waitUntil: "networkidle",
			timeout: 30_000,
		});
		await this.delay();
		await debugScreenshot(page, "campaign_start", this.debugDir);

		// Click "Create Campaign"
		const createBtn = page.locator(SELECTORS.createCampaign).first();
		await createBtn.waitFor({ state: "visible", timeout: 15_000 });
		await createBtn.click();
		await this.delay();
		await debugScreenshot(page, "campaign_create_clicked", this.debugDir);

		// Enter the idea/prompt
		const ideaInput = page.locator(SELECTORS.campaignIdeaInput).first();
		await ideaInput.waitFor({ state: "visible", timeout: 10_000 });
		await ideaInput.fill(idea);
		await this.delay();
		await debugScreenshot(page, "campaign_idea_entered", this.debugDir);

		// Submit / generate
		const generateBtn = page.locator(SELECTORS.campaignGenerate).first();
		await generateBtn.click();
		await debugScreenshot(page, "campaign_generate_clicked", this.debugDir);

		console.log("[pomelli] Waiting for AI generation (up to 120s)...");

		// Wait for generation to complete (NFR-2: 120s timeout)
		try {
			// Wait for the output container to appear
			await page.locator(SELECTORS.campaignOutput).first().waitFor({
				state: "visible",
				timeout: GENERATION_TIMEOUT_MS,
			});
		} catch {
			// Fallback: wait for loading to disappear
			try {
				await page.locator(SELECTORS.generationLoading).first().waitFor({
					state: "hidden",
					timeout: GENERATION_TIMEOUT_MS,
				});
			} catch {
				await debugScreenshot(
					page,
					"campaign_generation_timeout",
					this.debugDir,
				);
				throw new PommelliError(
					"Pomelli generation timed out after 120 seconds",
					"GENERATION_TIMEOUT",
				);
			}
		}

		await debugScreenshot(page, "campaign_generated", this.debugDir);
		await this.delay();

		// Extract images (FR-6)
		const images = await this.extractImages(page);

		// Extract caption (FR-7)
		const caption = await this.extractCaption(page);

		console.log(
			`[pomelli] Campaign generated: ${images.length} image(s), caption ${caption.length} chars`,
		);

		return { images, caption };
	}

	/**
	 * Download images from the campaign output (FR-6).
	 * Extracts actual image src URLs and downloads to DATA_DIR/assets/.
	 */
	private async extractImages(page: Page): Promise<string[]> {
		const imageElements = page.locator(SELECTORS.campaignImages);
		const count = await imageElements.count();
		console.log(`[pomelli] Found ${count} campaign images`);

		if (count === 0) {
			// Fallback: look for any image on the page that's reasonably large
			const allImages = page.locator("img");
			const allCount = await allImages.count();
			console.log(`[pomelli] Fallback: scanning ${allCount} images on page`);

			const imagePaths: string[] = [];
			for (let i = 0; i < allCount; i++) {
				const img = allImages.nth(i);
				const src = await img.getAttribute("src");
				const width = await img.evaluate(
					(el) => (el as unknown as { naturalWidth: number }).naturalWidth,
				);
				if (src && width > 200) {
					const path = await this.downloadImage(src, page);
					if (path) imagePaths.push(path);
					if (imagePaths.length >= 4) break; // limit to 4 images
				}
			}
			return imagePaths;
		}

		const imagePaths: string[] = [];
		for (let i = 0; i < count; i++) {
			const img = imageElements.nth(i);
			const src = await img.getAttribute("src");
			if (src) {
				const path = await this.downloadImage(src, page);
				if (path) imagePaths.push(path);
			}
		}

		return imagePaths;
	}

	/**
	 * Download a single image from its src URL.
	 * Handles data: URLs, blob: URLs, and regular HTTP URLs.
	 * Returns the local file path or null on failure.
	 */
	private async downloadImage(src: string, page: Page): Promise<string | null> {
		const timestamp = Date.now();
		const filename = `pomelli_${timestamp}_${Math.random().toString(36).slice(2, 8)}.png`;
		const filepath = join(this.assetsDir, filename);

		try {
			if (src.startsWith("data:")) {
				// Data URL — extract base64 and write
				const base64 = src.split(",")[1];
				if (base64) {
					const buffer = Buffer.from(base64, "base64");
					await Bun.write(filepath, buffer);
					console.log(`[pomelli] Downloaded image (data URL): ${filename}`);
					return filepath;
				}
			} else if (src.startsWith("blob:")) {
				// Blob URL — use page.evaluate to fetch as base64
				const base64 = await page.evaluate(async (blobUrl: string) => {
					const response = await fetch(blobUrl);
					const blob = await response.blob();
					const arrayBuffer = await blob.arrayBuffer();
					const bytes = new Uint8Array(arrayBuffer);
					let binary = "";
					for (let i = 0; i < bytes.length; i++) {
						binary += String.fromCharCode(bytes[i]!);
					}
					return `data:${blob.type || "image/png"};base64,${btoa(binary)}`;
				}, src);

				const data = base64.split(",")[1];
				if (data) {
					const buffer = Buffer.from(data, "base64");
					await Bun.write(filepath, buffer);
					console.log(`[pomelli] Downloaded image (blob URL): ${filename}`);
					return filepath;
				}
			} else {
				// Regular URL — fetch the image
				const absoluteUrl = src.startsWith("http")
					? src
					: new URL(src, this.baseUrl).toString();

				const response = await fetch(absoluteUrl);
				if (!response.ok) {
					console.warn(
						`[pomelli] Failed to download image: HTTP ${response.status}`,
					);
					return null;
				}

				const buffer = Buffer.from(await response.arrayBuffer());
				await Bun.write(filepath, buffer);
				console.log(`[pomelli] Downloaded image: ${filename}`);
				return filepath;
			}
		} catch (err) {
			console.warn(
				`[pomelli] Failed to download image: ${err instanceof Error ? err.message : String(err)}`,
			);
		}

		return null;
	}

	/**
	 * Extract caption text from the campaign output (FR-7).
	 */
	private async extractCaption(page: Page): Promise<string> {
		// Try specific caption selector first
		const captionEl = page.locator(SELECTORS.campaignCaption).first();
		const captionVisible = await captionEl
			.isVisible({ timeout: 3_000 })
			.catch(() => false);

		if (captionVisible) {
			const text = await captionEl.textContent();
			if (text?.trim()) {
				console.log("[pomelli] Extracted caption from primary selector");
				return text.trim();
			}
		}

		// Fallback: look for the longest paragraph-like text in the output area
		const outputArea = page.locator(SELECTORS.campaignOutput).first();
		const outputVisible = await outputArea
			.isVisible({ timeout: 2_000 })
			.catch(() => false);

		if (outputVisible) {
			const paragraphs = outputArea.locator(SELECTORS.campaignCaptionFallback);
			const pCount = await paragraphs.count();
			let bestCaption = "";

			for (let i = 0; i < pCount; i++) {
				const text = await paragraphs.nth(i).textContent();
				if (text && text.trim().length > bestCaption.length) {
					bestCaption = text.trim();
				}
			}

			if (bestCaption) {
				console.log("[pomelli] Extracted caption from fallback selector");
				return bestCaption;
			}
		}

		// Last resort: grab visible text from the page body
		console.warn("[pomelli] Could not find caption — using page text");
		await debugScreenshot(page, "caption_extraction_failed", this.debugDir);
		return "";
	}

	// ─── Full pipeline: generate + save (FR-8) ─────────────────────────────

	/**
	 * Run the full Pomelli automation pipeline for a post:
	 * 1. Acquire concurrency lock (NFR-3)
	 * 2. Check session (FR-2)
	 * 3. Ensure Business DNA exists (FR-3)
	 * 4. Generate campaign (FR-4, FR-5)
	 * 5. Save assets to DB (FR-8)
	 * 6. Release lock
	 *
	 * On failure, sets post status to 'failed' with error message.
	 */
	async processIdea(
		db: Database,
		postId: number,
		idea: string,
		websiteUrl?: string,
	): Promise<CampaignResult> {
		acquireLock();
		// Reset screenshot counter for each run
		screenshotCounter = 0;

		try {
			// Step 1: Check session
			const sessionOk = await this.checkSession();
			if (!sessionOk) {
				const errMsg =
					"Google session expired. Please re-authenticate via Settings.";
				updatePostStatus(db, postId, "failed", {
					error_message: errMsg,
				});
				throw new PommelliError(errMsg, "SESSION_EXPIRED");
			}

			// Step 2: Ensure Business DNA exists
			const siteUrl = websiteUrl ?? config.websiteUrl;
			if (siteUrl) {
				await this.createBusinessDNA(siteUrl);
			}

			// Step 3: Generate campaign
			const result = await this.generateCampaign(idea);

			if (result.images.length === 0) {
				const errMsg = "Pomelli generated no images";
				updatePostStatus(db, postId, "failed", {
					error_message: errMsg,
				});
				throw new PommelliError(errMsg, "NO_IMAGES");
			}

			// Step 4: Save to DB — use first image, store caption (FR-8)
			const imagePath = result.images[0]!;
			updatePostStatus(db, postId, "pending_review", {
				pomelli_image_path: imagePath,
				pomelli_caption: result.caption,
			});

			console.log(
				`[pomelli] Post #${postId} assets saved, status → pending_review`,
			);

			return result;
		} catch (err) {
			// If not already a PommelliError that updated status, mark as failed
			if (!(err instanceof PommelliError)) {
				const message = err instanceof Error ? err.message : String(err);
				console.error(
					`[pomelli] Unexpected error processing post #${postId}: ${message}`,
				);
				updatePostStatus(db, postId, "failed", {
					error_message: message,
				});
			}
			throw err;
		} finally {
			releaseLock();
		}
	}
}

// ─── Default singleton ────────────────────────────────────────────────────────

let defaultService: PommelliService | null = null;

/**
 * Get or create the default PommelliService singleton.
 */
export function getPommelliService(): PommelliService {
	if (!defaultService) {
		defaultService = new PommelliService();
	}
	return defaultService;
}

/**
 * Replace the default singleton (for testing).
 */
export function setPommelliService(service: PommelliService | null): void {
	defaultService = service;
}

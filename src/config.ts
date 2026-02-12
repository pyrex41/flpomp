/**
 * Centralized environment variable access.
 * All env vars are accessed through this module — never directly.
 */

function env(key: string, defaultValue?: string): string {
	const value = process.env[key] ?? defaultValue;
	if (value === undefined) {
		throw new Error(`Missing required environment variable: ${key}`);
	}
	return value;
}

function envOptional(key: string): string | undefined {
	return process.env[key] || undefined;
}

export const config = {
	/** X (Twitter) API credentials */
	x: {
		get apiKey() {
			return env("X_API_KEY");
		},
		get apiSecret() {
			return env("X_API_SECRET");
		},
		get accessToken() {
			return env("X_ACCESS_TOKEN");
		},
		get accessTokenSecret() {
			return env("X_ACCESS_TOKEN_SECRET");
		},
	},

	/** Application settings */
	port: Number.parseInt(env("PORT", "8080"), 10),
	dataDir: env("DATA_DIR", "./data"),
	websiteUrl: envOptional("WEBSITE_URL"),
	adminPassword: envOptional("ADMIN_PASSWORD"),

	/** Derived paths */
	get dbPath() {
		return `${this.dataDir}/db.sqlite`;
	},
	get assetsDir() {
		return `${this.dataDir}/assets`;
	},
	get debugDir() {
		return `${this.dataDir}/debug`;
	},
	get browserStateDir() {
		return `${this.dataDir}/browser-state`;
	},
} as const;

/**
 * SQLite database connection and schema migration.
 * Uses bun:sqlite for database access.
 */

import { Database } from "bun:sqlite";
import { config } from "./config.ts";

let db: Database | null = null;

const MIGRATIONS = [
	`CREATE TABLE IF NOT EXISTS posts (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		idea TEXT NOT NULL,
		pomelli_caption TEXT,
		pomelli_image_path TEXT,
		edited_caption TEXT,
		status TEXT NOT NULL DEFAULT 'generating',
		x_post_id TEXT,
		x_post_url TEXT,
		scheduled_at DATETIME,
		error_message TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		posted_at DATETIME
	)`,
	`CREATE TABLE IF NOT EXISTS settings (
		key TEXT PRIMARY KEY,
		value TEXT
	)`,
];

/**
 * Run all schema migrations (idempotent — safe to run on every startup).
 */
function runMigrations(database: Database): void {
	console.log("[db] Running migrations...");
	for (const sql of MIGRATIONS) {
		database.run(sql);
	}
	console.log("[db] Migrations complete.");
}

/**
 * Initialize and return the database connection.
 * Creates the database file and runs migrations on first call.
 */
export function getDb(): Database {
	if (db) return db;

	const dbPath = config.dbPath;
	console.log(`[db] Opening database at ${dbPath}`);

	db = new Database(dbPath, { create: true });
	db.run("PRAGMA busy_timeout = 5000");
	db.run("PRAGMA journal_mode = WAL");
	db.run("PRAGMA foreign_keys = ON");

	runMigrations(db);
	return db;
}

/**
 * Close the database connection (for tests / cleanup).
 */
export function closeDb(): void {
	if (db) {
		db.close();
		db = null;
	}
}

/**
 * Create an in-memory database with schema applied (for testing).
 */
export function createTestDb(): Database {
	const testDb = new Database(":memory:");
	runMigrations(testDb);
	return testDb;
}

// ─── Query helpers ───────────────────────────────────────────────────────────

export interface Post {
	id: number;
	idea: string;
	pomelli_caption: string | null;
	pomelli_image_path: string | null;
	edited_caption: string | null;
	status: string;
	x_post_id: string | null;
	x_post_url: string | null;
	scheduled_at: string | null;
	error_message: string | null;
	created_at: string;
	posted_at: string | null;
}

export interface Setting {
	key: string;
	value: string;
}

export function getAllPosts(database: Database, status?: string): Post[] {
	if (status) {
		return database
			.query(
				"SELECT * FROM posts WHERE status = ? ORDER BY created_at DESC, id DESC",
			)
			.all(status) as Post[];
	}
	return database
		.query("SELECT * FROM posts ORDER BY created_at DESC, id DESC")
		.all() as Post[];
}

export function getPostById(database: Database, id: number): Post | undefined {
	const row = database
		.query("SELECT * FROM posts WHERE id = ?")
		.get(id) as Post | null;
	return row ?? undefined;
}

export function createPost(
	database: Database,
	idea: string,
	scheduledAt?: string,
): Post {
	const stmt = database.prepare(
		"INSERT INTO posts (idea, scheduled_at) VALUES (?, ?) RETURNING *",
	);
	return stmt.get(idea, scheduledAt ?? null) as Post;
}

export function updatePostStatus(
	database: Database,
	id: number,
	status: string,
	extra?: Partial<
		Pick<
			Post,
			| "pomelli_caption"
			| "pomelli_image_path"
			| "edited_caption"
			| "x_post_id"
			| "x_post_url"
			| "posted_at"
			| "error_message"
		>
	>,
): void {
	const sets = ["status = ?"];
	const values: (string | null)[] = [status];

	if (extra) {
		for (const [key, value] of Object.entries(extra)) {
			sets.push(`${key} = ?`);
			values.push(value ?? null);
		}
	}

	values.push(String(id));
	database
		.prepare(`UPDATE posts SET ${sets.join(", ")} WHERE id = ?`)
		.run(...values);
}

export function getSetting(
	database: Database,
	key: string,
): string | undefined {
	const row = database
		.query("SELECT value FROM settings WHERE key = ?")
		.get(key) as Setting | null;
	return row?.value ?? undefined;
}

export function setSetting(
	database: Database,
	key: string,
	value: string,
): void {
	database
		.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
		.run(key, value);
}

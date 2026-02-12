import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("config", () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		vi.resetModules();
		process.env = { ...originalEnv };
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it("should use default port 8080 when PORT is not set", async () => {
		delete process.env.PORT;
		const { config } = await import("../src/config.ts");
		expect(config.port).toBe(8080);
	});

	it("should use default data dir when DATA_DIR is not set", async () => {
		delete process.env.DATA_DIR;
		const { config } = await import("../src/config.ts");
		expect(config.dataDir).toBe("./data");
	});

	it("should derive database path from data dir", async () => {
		process.env.DATA_DIR = "/tmp/test-data";
		const { config } = await import("../src/config.ts");
		expect(config.dbPath).toBe("/tmp/test-data/db.sqlite");
	});

	it("should derive assets dir from data dir", async () => {
		process.env.DATA_DIR = "/tmp/test-data";
		const { config } = await import("../src/config.ts");
		expect(config.assetsDir).toBe("/tmp/test-data/assets");
	});
});

# Project Scaffolding

## Job to Be Done
When starting the project, I want a working Bun + Hono + HTMX skeleton with all tooling configured, so I can immediately start building features.

## Functional Requirements
- [ ] FR-1: Initialize Bun project with package.json and TypeScript config
- [ ] FR-2: Install dependencies: hono, playwright, twitter-api-v2, croner, htmx (CDN or vendored)
- [ ] FR-3: Install dev dependencies: vitest, eslint, typescript, @types/*
- [ ] FR-4: Configure TypeScript with strict mode, Hono JSX support
- [ ] FR-5: Configure ESLint for TypeScript
- [ ] FR-6: Configure Vitest for Bun
- [ ] FR-7: Set up package.json scripts: dev, build, test, lint, check
- [ ] FR-8: Create src/server.ts — Hono app with basic health check route, static file serving, listening on PORT
- [ ] FR-9: Create src/config.ts — typed env var access with defaults
- [ ] FR-10: Create src/db.ts — SQLite connection and schema migration (create tables if not exist)
- [ ] FR-11: Create base HTML layout template with HTMX loaded from CDN
- [ ] FR-12: Create .env.example with all required environment variables
- [ ] FR-13: Create .gitignore for node_modules, .env, /data, *.sqlite

## Acceptance Criteria
1. Given a fresh clone, when running `bun install && bun run dev`, then the server starts on port 8080
2. Given the server is running, when visiting /, then a basic HTML page is rendered
3. Given `bun run check`, when run, then typecheck + lint + test all pass with zero errors
4. Given the database path, when server starts, then tables are created if they don't exist

## Out of Scope
- Dockerfile / Fly.io deployment config (separate spec or later task)
- Feature implementation (just the skeleton)

## Dependencies
- None — this is the foundation everything else depends on

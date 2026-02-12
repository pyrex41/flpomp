/**
 * HTML page routes — server-rendered with Hono JSX + HTMX.
 * Thin route handlers; business logic goes in services.
 */

import { Hono } from "hono";
import { Layout } from "../views/layout.tsx";

const pages = new Hono();

// ─── New Post (home) ─────────────────────────────────────────────────────────

pages.get("/", (c) => {
	return c.html(
		<Layout title="New Post">
			<h1>Pomelli → X Flywheel</h1>
			<p>Submit an idea to generate branded social media assets.</p>
			<form>
				<label>
					Idea
					<textarea
						name="idea"
						placeholder="e.g. Promote our new cold brew for summer"
						rows={3}
						required
					/>
				</label>
				<button type="submit">Generate</button>
			</form>
		</Layout>,
	);
});

export { pages };

/**
 * Base HTML layout with HTMX loaded from CDN.
 * All pages use this as their outer shell.
 */

import type { Child } from "hono/jsx";

interface LayoutProps {
	title?: string;
	children: Child;
}

export function Layout({ title, children }: LayoutProps) {
	const pageTitle = title ? `${title} — Pomelli Flywheel` : "Pomelli Flywheel";

	return (
		<html lang="en">
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<title>{pageTitle}</title>
				<link
					rel="stylesheet"
					href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css"
				/>
				<script
					src="https://unpkg.com/htmx.org@2.0.4"
					crossorigin="anonymous"
				/>
				<style>{`
					nav ul li { list-style: none; }
					.post-card { border: 1px solid var(--pico-muted-border-color); border-radius: 8px; padding: 1rem; margin-bottom: 1rem; }
					.post-card img { max-width: 100%; border-radius: 4px; }
					.status-badge { display: inline-block; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.85rem; font-weight: 600; }
					.status-generating { background: #fef3c7; color: #92400e; }
					.status-pending_review { background: #dbeafe; color: #1e40af; }
					.status-approved { background: #d1fae5; color: #065f46; }
					.status-posted { background: #e0e7ff; color: #3730a3; }
					.status-failed { background: #fee2e2; color: #991b1b; }
				`}</style>
			</head>
			<body>
				<nav class="container">
					<ul>
						<li>
							<strong>Pomelli Flywheel</strong>
						</li>
					</ul>
					<ul>
						<li>
							<a href="/">New Post</a>
						</li>
						<li>
							<a href="/queue">Queue</a>
						</li>
						<li>
							<a href="/history">History</a>
						</li>
						<li>
							<a href="/settings">Settings</a>
						</li>
					</ul>
				</nav>
				<main class="container">{children}</main>
				<footer class="container">
					<small>Pomelli → X Flywheel</small>
				</footer>
			</body>
		</html>
	);
}

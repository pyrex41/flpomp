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
					/* ── Navigation ─────────────────────────────────── */
					nav ul li { list-style: none; }
					nav a[aria-current="page"] {
						font-weight: 700;
						text-decoration: underline;
						text-underline-offset: 4px;
					}

					/* ── Post cards ─────────────────────────────────── */
					.post-card {
						border: 1px solid var(--pico-muted-border-color);
						border-radius: 8px;
						padding: 1rem;
						margin-bottom: 1rem;
					}
					.post-card img {
						max-width: 100%;
						border-radius: 4px;
					}
					.post-card-header {
						display: flex;
						justify-content: space-between;
						align-items: center;
						margin-bottom: 0.5rem;
					}

					/* ── Status badges ──────────────────────────────── */
					.status-badge {
						display: inline-block;
						padding: 0.2rem 0.6rem;
						border-radius: 4px;
						font-size: 0.85rem;
						font-weight: 600;
					}
					.status-generating { background: #fef3c7; color: #92400e; }
					.status-pending_review { background: #dbeafe; color: #1e40af; }
					.status-approved { background: #d1fae5; color: #065f46; }
					.status-posted { background: #e0e7ff; color: #3730a3; }
					.status-failed { background: #fee2e2; color: #991b1b; }
					.status-rejected { background: #f3f4f6; color: #6b7280; }

					/* ── HTMX indicator ─────────────────────────────── */
					.htmx-indicator {
						opacity: 0;
						transition: opacity 200ms ease-in;
					}
					.htmx-request .htmx-indicator,
					.htmx-request.htmx-indicator {
						opacity: 1;
					}

					/* ── Form feedback ──────────────────────────────── */
					.form-error {
						color: var(--pico-del-color);
						font-weight: 600;
					}

					/* ── Queue cards ───────────────────────────────── */
					.queue-card {
						transition: opacity 300ms ease-out;
					}
					.queue-card.htmx-swapping {
						opacity: 0;
					}

				/* ── History cards ──────────────────────────────── */
				.history-card a {
					font-weight: 600;
				}

				/* ── Settings page ─────────────────────────────── */
				.settings-success {
					color: var(--pico-ins-color);
					font-weight: 600;
				}
				.session-status {
					padding: 1rem;
					border-radius: 8px;
				}
				.session-authenticated {
					border-left: 4px solid #059669;
				}
				.session-unauthenticated {
					border-left: 4px solid #d97706;
				}
				.session-error {
					border-left: 4px solid #dc2626;
				}

				/* ── Utility ────────────────────────────────────── */
				.secondary {
					color: var(--pico-muted-color);
				}
				hr {
					margin: 2rem 0;
				}
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
					<small class="secondary">Pomelli Flywheel</small>
				</footer>
			</body>
		</html>
	);
}

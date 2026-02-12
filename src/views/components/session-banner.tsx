/**
 * Session alert banner — displayed at the top of every page when
 * the Pomelli Google session is expired or in error state.
 *
 * Loaded lazily via HTMX so it doesn't delay page rendering
 * and doesn't require a Playwright check on every request.
 */

import type { AuthStatus } from "../../services/pomelli.ts";

interface SessionBannerProps {
	sessionStatus: AuthStatus | null;
}

/**
 * Renders a warning banner if the session is not active.
 * Returns empty HTML if session is active or unknown (no check done yet).
 */
export function SessionBanner({ sessionStatus }: SessionBannerProps) {
	// No status cached yet or session is healthy — nothing to show
	if (!sessionStatus || sessionStatus.status === "active") return null;

	const isExpired = sessionStatus.status === "expired";
	const bannerClass = isExpired
		? "session-banner-warning"
		: "session-banner-error";
	const icon = isExpired ? "\u26A0" : "\u2716"; // ⚠ or ✖
	const title = isExpired ? "Pomelli Session Expired" : "Pomelli Session Error";

	return (
		<div class={`session-banner ${bannerClass}`} role="alert">
			<span class="session-banner-icon">{icon}</span>
			<div class="session-banner-content">
				<strong>{title}</strong>
				<span class="session-banner-message">{sessionStatus.message}</span>
			</div>
			<a href="/settings" class="session-banner-action">
				Fix in Settings &rarr;
			</a>
		</div>
	);
}

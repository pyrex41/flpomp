/**
 * Settings page — manage website URL for Pomelli Business DNA
 * and view Pomelli session status.
 *
 * The settings form submits via HTMX to a page route handler (form data),
 * matching the existing pattern in pages.tsx (queue edit, idea submit).
 */

// ─── Full page content ────────────────────────────────────────────────────────

interface SettingsPageProps {
	websiteUrl: string;
}

export function SettingsPage({ websiteUrl }: SettingsPageProps) {
	return (
		<>
			<hgroup>
				<h2>Settings</h2>
				<p>Configure the Pomelli Flywheel.</p>
			</hgroup>

			{/* ── Website URL for Business DNA ──────────────────────────── */}
			<section>
				<h3>Website URL</h3>
				<p class="secondary">
					Your website URL is used by Pomelli to generate Business DNA — the
					brand context that shapes all generated content.
				</p>

				<form
					hx-post="/settings"
					hx-target="#settings-result"
					hx-swap="innerHTML"
					hx-disabled-elt="button[type='submit']"
				>
					<label>
						Website URL
						<input
							type="url"
							name="website_url"
							placeholder="https://example.com"
							value={websiteUrl}
							aria-describedby="url-help"
						/>
					</label>
					<small id="url-help">
						Enter the URL of the website Pomelli should analyze for your brand.
					</small>

					<button type="submit" style="margin-top: 0.5rem;">
						Save Settings
					</button>
				</form>

				<div id="settings-result" />
			</section>

			{/* ── Pomelli Session Status ────────────────────────────────── */}
			<hr />

			<section>
				<h3>Pomelli Session</h3>
				<p class="secondary">
					Pomelli requires a valid Google session to automate content
					generation. Import your Google cookies below to authenticate.
				</p>

				<div
					id="session-status"
					hx-get="/partials/session-status"
					hx-trigger="load"
					hx-swap="innerHTML"
				>
					<p class="secondary" aria-busy="true">
						Checking session status...
					</p>
				</div>
			</section>
		</>
	);
}

// ─── Settings save confirmation partial ───────────────────────────────────────

export function SettingsSaveResult({ websiteUrl }: { websiteUrl: string }) {
	return (
		<output class="settings-success" style="display: block;">
			Settings saved. Website URL set to <strong>{websiteUrl}</strong>.
		</output>
	);
}

// ─── Settings save error partial ──────────────────────────────────────────────

export function SettingsSaveError({ message }: { message: string }) {
	return (
		<p role="alert" class="form-error">
			{message}
		</p>
	);
}

// ─── Session status partial ───────────────────────────────────────────────────

interface SessionStatusProps {
	status: "authenticated" | "unauthenticated" | "error";
	message?: string;
}

export function SessionStatusPartial({ status, message }: SessionStatusProps) {
	if (status === "authenticated") {
		return (
			<article class="session-status session-authenticated">
				<p>
					<strong>Session Active</strong>
				</p>
				<p class="secondary">
					{message ?? "Pomelli is authenticated and ready to generate content."}
				</p>
			</article>
		);
	}

	if (status === "unauthenticated") {
		return (
			<article class="session-status session-unauthenticated">
				<p>
					<strong>Session Inactive</strong>
				</p>
				<p class="secondary">
					{message ??
						"No active Google session. Import your cookies via the API to authenticate."}
				</p>
				<small class="secondary">
					Use <code>POST /api/auth/pomelli</code> with your exported Google
					cookies to authenticate.
				</small>
			</article>
		);
	}

	return (
		<article class="session-status session-error">
			<p>
				<strong>Session Check Failed</strong>
			</p>
			<p class="secondary">
				{message ?? "Could not verify session status. Check server logs."}
			</p>
		</article>
	);
}

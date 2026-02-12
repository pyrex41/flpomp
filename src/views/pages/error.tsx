/**
 * Error page component — shown for unhandled errors and 404s on page routes.
 * API routes continue to return JSON errors.
 */

import { Layout } from "../layout.tsx";

interface ErrorPageProps {
	status: number;
	message: string;
	/** Only shown in non-production environments. */
	detail?: string;
}

export function ErrorPage({ status, message, detail }: ErrorPageProps) {
	const title = status === 404 ? "Not Found" : "Something Went Wrong";

	return (
		<Layout title={title}>
			<hgroup>
				<h2>
					{status} — {title}
				</h2>
				<p>{message}</p>
			</hgroup>

			{detail && (
				<details>
					<summary>Technical Details</summary>
					<pre>
						<code>{detail}</code>
					</pre>
				</details>
			)}

			<p>
				<a href="/">&larr; Back to Dashboard</a>
			</p>
		</Layout>
	);
}

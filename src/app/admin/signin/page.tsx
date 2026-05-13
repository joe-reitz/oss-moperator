import Link from "next/link"

interface PageProps {
  searchParams: Promise<{ returnTo?: string; error?: string }>
}

const ERROR_MESSAGES: Record<string, string> = {
  unauthorized: "Your Slack email is not on the admin allowlist. Ask an admin to add it to AUTHORIZED_USER_EMAILS.",
  not_configured: "Admin access is not configured on this deployment yet. Set AUTHORIZED_USER_EMAILS in your environment.",
  oauth_failed: "Slack sign-in failed. Try again.",
  invalid_state: "The sign-in link expired. Try again.",
  missing_email: "Your Slack account did not return an email. Make sure your Slack app requests the 'email' scope.",
}

export default async function AdminSigninPage({ searchParams }: PageProps) {
  const params = await searchParams
  const returnTo = params.returnTo || "/console"
  const error = params.error
  const signinHref = `/api/admin/signin?returnTo=${encodeURIComponent(returnTo)}`

  return (
    <div className="min-h-screen bg-black text-white font-mono flex items-center justify-center px-6">
      <div className="max-w-lg w-full">
        <div className="border border-gray-800 rounded-lg overflow-hidden">
          <div className="border-b border-gray-800 px-4 py-3 flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-red-500 inline-block" />
            <span className="w-3 h-3 rounded-full bg-yellow-500 inline-block" />
            <span className="w-3 h-3 rounded-full bg-green-500 inline-block" />
            <span className="ml-4 text-gray-500 text-sm">moperator admin — login required</span>
          </div>

          <div className="p-8 space-y-6 bg-gray-950">
            <div>
              <h1 className="text-green-400 text-xl mb-2 flex items-center gap-2">
                <span className="text-gray-600">$</span> sudo moperator-admin
              </h1>
              <p className="text-gray-400 text-sm leading-relaxed">
                The admin console, analytics, and audience vocabulary pages are gated to authorized
                Slack users. Sign in with the same Slack workspace where mOperator is installed.
              </p>
            </div>

            {error && ERROR_MESSAGES[error] && (
              <div className="border border-red-900 bg-red-950/30 rounded p-4 text-sm text-red-300">
                {ERROR_MESSAGES[error]}
              </div>
            )}

            <Link
              href={signinHref}
              className="block w-full text-center bg-green-600 hover:bg-green-500 text-black font-semibold py-3 rounded transition-colors"
            >
              Sign in with Slack &rarr;
            </Link>

            <div className="text-xs text-gray-600 space-y-2 pt-2 border-t border-gray-800">
              <p>
                <span className="text-gray-500">Setup required:</span> if this is your first deploy,
                see <Link href="/docs/security" className="text-green-400 hover:underline">docs/security</Link> for
                what env vars to set (<code className="text-gray-400">SLACK_CLIENT_ID</code>,
                {" "}<code className="text-gray-400">SLACK_CLIENT_SECRET</code>,
                {" "}<code className="text-gray-400">MOPERATOR_SESSION_SECRET</code>,
                {" "}<code className="text-gray-400">AUTHORIZED_USER_EMAILS</code>).
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 text-center">
          <Link href="/" className="text-gray-600 text-xs hover:text-gray-400 transition-colors">
            &larr; back to home
          </Link>
        </div>
      </div>
    </div>
  )
}

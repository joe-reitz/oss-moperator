import { NextRequest } from "next/server"
import { exchangeCodeForTokens, validateState } from "@/lib/integrations/google-ads"

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code")
  const state = req.nextUrl.searchParams.get("state")
  const error = req.nextUrl.searchParams.get("error")

  if (error) {
    return new Response(`<html><body><h1>Google Ads OAuth Error</h1><p>${error}</p></body></html>`, {
      headers: { "Content-Type": "text/html" },
      status: 400,
    })
  }

  if (!code) {
    return new Response(`<html><body><h1>Missing authorization code</h1></body></html>`, {
      headers: { "Content-Type": "text/html" },
      status: 400,
    })
  }

  if (state) {
    const valid = await validateState(state)
    if (!valid) {
      return new Response(`<html><body><h1>Invalid state — OAuth flow expired or was replayed</h1></body></html>`, {
        headers: { "Content-Type": "text/html" },
        status: 400,
      })
    }
  }

  try {
    const tokens = await exchangeCodeForTokens(code)

    return new Response(
      `<html>
<body style="font-family: system-ui; max-width: 600px; margin: 40px auto; padding: 0 20px;">
<h1>Google Ads Connected!</h1>
<p>Tokens have been cached in Redis. Copy to <code>.env.local</code> for persistence:</p>
<pre style="background: #1a1a1a; color: #fff; padding: 16px; border-radius: 8px; overflow-x: auto;">
GOOGLE_ADS_ACCESS_TOKEN=${tokens.accessToken}
${tokens.refreshToken ? `GOOGLE_ADS_REFRESH_TOKEN=${tokens.refreshToken}` : "# No refresh token returned (already have one cached)"}
</pre>
<p><strong>Next:</strong> Add the tokens to your <code>.env.local</code> and restart the dev server.</p>
</body>
</html>`,
      { headers: { "Content-Type": "text/html" } }
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return new Response(
      `<html><body><h1>Token Exchange Failed</h1><p>${message}</p></body></html>`,
      { headers: { "Content-Type": "text/html" }, status: 500 }
    )
  }
}

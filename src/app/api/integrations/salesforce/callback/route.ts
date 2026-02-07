/**
 * Salesforce OAuth Callback
 * Exchanges code for tokens and displays them for .env.local
 */

import { exchangeCodeForTokens } from "@/lib/integrations/salesforce"
import { NextRequest } from "next/server"

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code")
  const error = req.nextUrl.searchParams.get("error")
  const errorDescription = req.nextUrl.searchParams.get("error_description")

  if (error) {
    return new Response(
      `<html>
        <body style="font-family: system-ui; padding: 40px; max-width: 600px; margin: 0 auto; background: #000; color: #fff;">
          <h1 style="color: #f44;">OAuth Error</h1>
          <p><strong>Error:</strong> ${error}</p>
          <p><strong>Description:</strong> ${errorDescription || "Unknown error"}</p>
          <p><a href="/api/integrations/salesforce" style="color: #4af;">Try again</a></p>
        </body>
      </html>`,
      { headers: { "Content-Type": "text/html; charset=utf-8" } }
    )
  }

  if (!code) {
    return new Response(
      `<html>
        <body style="font-family: system-ui; padding: 40px; max-width: 600px; margin: 0 auto; background: #000; color: #fff;">
          <h1 style="color: #f44;">Missing Authorization Code</h1>
          <p><a href="/api/integrations/salesforce" style="color: #4af;">Start OAuth flow</a></p>
        </body>
      </html>`,
      { headers: { "Content-Type": "text/html; charset=utf-8" } }
    )
  }

  try {
    const tokens = await exchangeCodeForTokens(code)

    return new Response(
      `<html>
        <body style="font-family: system-ui; padding: 40px; max-width: 800px; margin: 0 auto; background: #000; color: #fff;">
          <h1 style="color: #4f4;">Salesforce Connected!</h1>
          <p>Copy these values to your <code style="background: #222; padding: 2px 6px; border-radius: 4px;">.env.local</code> file:</p>
          <pre style="background: #111; padding: 20px; border-radius: 8px; overflow-x: auto; border: 1px solid #333;">
SALESFORCE_ACCESS_TOKEN=${tokens.accessToken}
SALESFORCE_REFRESH_TOKEN=${tokens.refreshToken}
SALESFORCE_INSTANCE_URL=${tokens.instanceUrl}
          </pre>
          <p style="color: #888;">After updating .env.local, restart your dev server.</p>
        </body>
      </html>`,
      { headers: { "Content-Type": "text/html; charset=utf-8" } }
    )
  } catch (err) {
    return new Response(
      `<html>
        <body style="font-family: system-ui; padding: 40px; max-width: 600px; margin: 0 auto; background: #000; color: #fff;">
          <h1 style="color: #f44;">Token Exchange Failed</h1>
          <p>${err instanceof Error ? err.message : "Unknown error"}</p>
          <p><a href="/api/integrations/salesforce" style="color: #4af;">Try again</a></p>
        </body>
      </html>`,
      { headers: { "Content-Type": "text/html; charset=utf-8" } }
    )
  }
}

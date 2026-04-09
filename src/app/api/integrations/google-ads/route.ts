import { redirect } from "next/navigation"
import { getAuthorizationUrl } from "@/lib/integrations/google-ads"

export async function GET() {
  const authUrl = getAuthorizationUrl()
  redirect(authUrl)
}

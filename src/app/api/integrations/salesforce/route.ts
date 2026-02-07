/**
 * Salesforce OAuth - Start Flow
 */

import { getAuthorizationUrl } from "@/lib/integrations/salesforce"
import { redirect } from "next/navigation"

export async function GET() {
  const authUrl = getAuthorizationUrl()
  redirect(authUrl)
}

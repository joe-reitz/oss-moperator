import { redirect } from "next/navigation"

import { AdminAuthError, requireAdmin } from "@/lib/admin-auth"
import ChatClient from "./ChatClient"

export const dynamic = "force-dynamic"

/**
 * Gated by the same admin session as /console and /analytics. That is not just
 * convenience: `agent/channels/eve.ts` verifies the same cookie, so gating the
 * page and gating the agent's routes cannot drift apart.
 */
export default async function ChatPage() {
  let email: string
  try {
    const session = await requireAdmin()
    email = session.email
  } catch (err) {
    if (err instanceof AdminAuthError) {
      const params = new URLSearchParams({ returnTo: "/chat" })
      if (err.code === "not_authorized") params.set("error", "unauthorized")
      redirect(
        `${err.redirectTo}${err.redirectTo.includes("?") ? "&" : "?"}${params.toString()}`
      )
    }
    throw err
  }

  return <ChatClient signedInAs={email} />
}

import { redirect } from "next/navigation"
import { AdminAuthError, requireAdmin } from "@/lib/admin-auth"
import ConsoleClient from "./ConsoleClient"

export const dynamic = "force-dynamic"

export default async function ConsolePage() {
  try {
    await requireAdmin()
  } catch (err) {
    if (err instanceof AdminAuthError) {
      const params = new URLSearchParams({ returnTo: "/console" })
      if (err.code === "not_authorized") params.set("error", "unauthorized")
      redirect(`${err.redirectTo}${err.redirectTo.includes("?") ? "&" : "?"}${params.toString()}`)
    }
    throw err
  }

  return <ConsoleClient />
}

import { redirect } from "next/navigation"
import { AdminAuthError, requireAdmin } from "@/lib/admin-auth"
import AudienceVocabClient from "./AudienceVocabClient"

export const dynamic = "force-dynamic"

export default async function AudienceVocabPage() {
  try {
    await requireAdmin()
  } catch (err) {
    if (err instanceof AdminAuthError) {
      const params = new URLSearchParams({ returnTo: "/audience-vocab" })
      if (err.code === "not_authorized") params.set("error", "unauthorized")
      redirect(`${err.redirectTo}${err.redirectTo.includes("?") ? "&" : "?"}${params.toString()}`)
    }
    throw err
  }

  return <AudienceVocabClient />
}

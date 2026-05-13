/**
 * Audience Vocabulary admin API
 *
 * Backs the /audience-vocab page. Lists code-defined defaults read-only,
 * lets ops CRUD custom entries that override defaults at request time
 * without a deploy.
 *
 * Auth: every method calls requireAdmin() which checks the signed admin
 * session cookie set by /admin/signin and verifies the user's email is
 * on AUTHORIZED_USER_EMAILS.
 */
import { NextRequest } from "next/server"
import { z } from "zod"
import { AdminAuthError, requireAdmin } from "@/lib/admin-auth"
import {
  AUDIENCE_VOCABULARY,
  type VocabularyEntry,
  type AudienceObject,
} from "@/lib/audience/vocabulary"
import {
  listCustomVocabulary,
  saveCustomVocabularyEntry,
  deleteCustomVocabularyEntry,
} from "@/lib/audience/vocabulary-store"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

async function gate(): Promise<Response | { email: string }> {
  try {
    const session = await requireAdmin()
    return { email: session.email }
  } catch (err) {
    if (err instanceof AdminAuthError) {
      return Response.json(
        { success: false, error: err.message },
        { status: 401 }
      )
    }
    throw err
  }
}

const audienceObjectSchema = z.enum(["Contact", "Account", "CampaignMember"])

const entrySchema = z.object({
  term: z.string().min(1, "term is required").max(120),
  aliases: z.array(z.string().min(1)).max(20).optional(),
  object: audienceObjectSchema,
  field: z.string().min(1, "field is required").max(200),
  description: z.string().min(1, "description is required").max(500),
  commonValues: z.array(z.string().min(1)).max(50).optional(),
  avoid: z
    .array(
      z.object({
        field: z.string().min(1).max(200),
        reason: z.string().min(1).max(300),
      })
    )
    .max(10)
    .optional(),
  notes: z.string().max(1000).optional(),
})

function isStaticTerm(term: string): boolean {
  return AUDIENCE_VOCABULARY.some((e) => e.term === term)
}

export async function GET() {
  const auth = await gate()
  if (auth instanceof Response) return auth

  const customEntries = await listCustomVocabulary()
  const customByTerm = new Map(customEntries.map((e) => [e.term, e]))

  const staticEntries = AUDIENCE_VOCABULARY.map((entry) => ({
    ...entry,
    source: "static" as const,
    overridden: customByTerm.has(entry.term),
  }))

  const customOnly = customEntries
    .filter((e) => !AUDIENCE_VOCABULARY.some((s) => s.term === e.term))
    .map((entry) => ({ ...entry, source: "custom" as const, overridden: false }))

  const overrides = customEntries
    .filter((e) => AUDIENCE_VOCABULARY.some((s) => s.term === e.term))
    .map((entry) => ({ ...entry, source: "override" as const, overridden: false }))

  return Response.json({
    success: true,
    static: staticEntries,
    custom: customOnly,
    overrides,
  })
}

export async function POST(req: NextRequest) {
  const auth = await gate()
  if (auth instanceof Response) return auth

  const body = await req.json().catch(() => ({}))
  const parsed = entrySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      {
        success: false,
        error: parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      },
      { status: 400 }
    )
  }

  try {
    const saved = await saveCustomVocabularyEntry(
      parsed.data as VocabularyEntry,
      auth.email
    )
    return Response.json({ success: true, entry: saved })
  } catch (err) {
    return Response.json(
      { success: false, error: err instanceof Error ? err.message : "Save failed" },
      { status: 500 }
    )
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await gate()
  if (auth instanceof Response) return auth

  const term = req.nextUrl.searchParams.get("term")
  if (!term) {
    return Response.json(
      { success: false, error: "term query param is required" },
      { status: 400 }
    )
  }

  if (isStaticTerm(term)) {
    await deleteCustomVocabularyEntry(term)
    return Response.json({
      success: true,
      note: "Custom override removed; static default restored.",
    })
  }

  await deleteCustomVocabularyEntry(term)
  return Response.json({ success: true })
}

// Keep the static AudienceObject type referenced so TS doesn't drop it.
type _UnusedAudienceObject = AudienceObject

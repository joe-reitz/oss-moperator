/**
 * Saved SOQL queries — team-shared library backed by Redis.
 *
 * GET    /api/console/queries          → list all saved queries (newest first)
 * POST   /api/console/queries          → body { name, soql } → upsert by name
 * DELETE /api/console/queries?name=X   → remove by name
 *
 * Storage: a single Redis hash at `moperator:console:saved-queries` keyed by
 * query name. HSET / HDEL gives us atomic per-name updates so concurrent
 * saves from different users don't clobber each other.
 *
 * Gated by requireAdmin().
 */

import { NextRequest } from "next/server"
import { AdminAuthError, requireAdmin } from "@/lib/admin-auth"
import { getRedis } from "@agent/lib/redis"
import { validateReadOnlySoql } from "@agent/lib/soql"

export const dynamic = "force-dynamic"

const HASH_KEY = "moperator:console:saved-queries"
const MAX_NAME_LENGTH = 80
const MAX_SAVED_QUERIES = 200

interface StoredEntry {
  soql: string
  savedAt: number
}

interface ApiQuery {
  name: string
  soql: string
  savedAt: number
}

function parseEntry(raw: unknown): StoredEntry | null {
  if (!raw) return null
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw
    if (typeof obj?.soql !== "string" || typeof obj?.savedAt !== "number") return null
    return { soql: obj.soql, savedAt: obj.savedAt }
  } catch {
    return null
  }
}

async function gate(): Promise<Response | null> {
  try {
    await requireAdmin()
    return null
  } catch (err) {
    if (err instanceof AdminAuthError) {
      return Response.json({ success: false, error: err.message }, { status: 401 })
    }
    throw err
  }
}

export async function GET() {
  const denied = await gate()
  if (denied) return denied

  const redis = getRedis()
  if (!redis) {
    return Response.json({ success: false, error: "Redis not configured" }, { status: 500 })
  }

  try {
    const all = (await redis.hgetall(HASH_KEY)) as Record<string, unknown> | null
    if (!all) return Response.json({ success: true, queries: [] })

    const queries: ApiQuery[] = []
    for (const [name, raw] of Object.entries(all)) {
      const entry = parseEntry(raw)
      if (entry) queries.push({ name, soql: entry.soql, savedAt: entry.savedAt })
    }
    queries.sort((a, b) => b.savedAt - a.savedAt)

    return Response.json({ success: true, queries })
  } catch (err) {
    return Response.json(
      { success: false, error: err instanceof Error ? err.message : "List failed" },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  const denied = await gate()
  if (denied) return denied

  const redis = getRedis()
  if (!redis) {
    return Response.json({ success: false, error: "Redis not configured" }, { status: 500 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const name = typeof body.name === "string" ? body.name.trim() : ""
    const soql = typeof body.soql === "string" ? body.soql : ""

    if (!name) {
      return Response.json({ success: false, error: "Name is required" }, { status: 400 })
    }
    if (name.length > MAX_NAME_LENGTH) {
      return Response.json(
        { success: false, error: `Name exceeds ${MAX_NAME_LENGTH}-char limit` },
        { status: 400 }
      )
    }

    const validation = validateReadOnlySoql(soql)
    if (!validation.ok) {
      return Response.json({ success: false, error: validation.reason }, { status: 400 })
    }

    const existing = (await redis.hgetall(HASH_KEY)) as Record<string, unknown> | null
    const existingCount = existing ? Object.keys(existing).length : 0
    const isOverwrite = existing && name in existing
    if (!isOverwrite && existingCount >= MAX_SAVED_QUERIES) {
      return Response.json(
        {
          success: false,
          error: `Saved-query library is full (${MAX_SAVED_QUERIES} max). Delete some entries first.`,
        },
        { status: 400 }
      )
    }

    const entry: StoredEntry = { soql, savedAt: Date.now() }
    await redis.hset(HASH_KEY, { [name]: JSON.stringify(entry) })

    return Response.json({ success: true, name, savedAt: entry.savedAt })
  } catch (err) {
    return Response.json(
      { success: false, error: err instanceof Error ? err.message : "Save failed" },
      { status: 500 }
    )
  }
}

export async function DELETE(req: NextRequest) {
  const denied = await gate()
  if (denied) return denied

  const redis = getRedis()
  if (!redis) {
    return Response.json({ success: false, error: "Redis not configured" }, { status: 500 })
  }

  try {
    const name = req.nextUrl.searchParams.get("name") ?? ""
    if (!name) {
      return Response.json({ success: false, error: "Name is required" }, { status: 400 })
    }
    await redis.hdel(HASH_KEY, name)
    return Response.json({ success: true })
  } catch (err) {
    return Response.json(
      { success: false, error: err instanceof Error ? err.message : "Delete failed" },
      { status: 500 }
    )
  }
}

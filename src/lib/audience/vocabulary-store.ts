/**
 * Redis-backed store for runtime additions to the audience vocabulary.
 *
 * The static defaults in vocabulary.ts ship with the build. Anything stored
 * here is merged ON TOP at request time — Redis wins on `term` collisions —
 * so ops can add or override mappings via /audience-vocab without a deploy.
 *
 * Stored as a Redis hash keyed by `term`, values are JSON. Hash semantics
 * mean concurrent edits to different terms don't trample each other.
 */
import { getRedis } from "@/lib/redis"
import type { VocabularyEntry } from "./vocabulary"

const REDIS_KEY = "moperator:audience-vocab"

export interface CustomVocabularyEntry extends VocabularyEntry {
  /** ISO timestamp; set on first create. */
  createdAt: number
  /** ISO timestamp; bumped on every save. */
  updatedAt: number
  /** Identifier of the user who last touched it (email or Slack username). */
  updatedBy?: string
}

/**
 * Read all custom (Redis-stored) vocabulary entries.
 * Returns empty array if Redis is unconfigured or the hash is empty.
 */
export async function listCustomVocabulary(): Promise<CustomVocabularyEntry[]> {
  const redis = getRedis()
  if (!redis) return []

  try {
    const raw = await redis.hgetall<Record<string, string>>(REDIS_KEY)
    if (!raw) return []

    const entries: CustomVocabularyEntry[] = []
    for (const value of Object.values(raw)) {
      try {
        // Upstash sometimes returns already-parsed objects, sometimes JSON strings.
        const parsed = typeof value === "string" ? JSON.parse(value) : (value as unknown as CustomVocabularyEntry)
        entries.push(parsed as CustomVocabularyEntry)
      } catch {
        // Skip malformed entries rather than failing the whole list.
      }
    }
    return entries.sort((a, b) => a.term.localeCompare(b.term))
  } catch {
    return []
  }
}

/**
 * Upsert a custom vocabulary entry. The `term` is the primary key.
 */
export async function saveCustomVocabularyEntry(
  entry: VocabularyEntry,
  updatedBy?: string,
): Promise<CustomVocabularyEntry> {
  const redis = getRedis()
  if (!redis) throw new Error("Redis not configured — cannot save vocabulary entry")

  const now = Date.now()
  const existing = await getCustomVocabularyEntry(entry.term)
  const record: CustomVocabularyEntry = {
    ...entry,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    updatedBy,
  }

  await redis.hset(REDIS_KEY, { [entry.term]: JSON.stringify(record) })
  return record
}

export async function getCustomVocabularyEntry(term: string): Promise<CustomVocabularyEntry | null> {
  const redis = getRedis()
  if (!redis) return null

  try {
    const raw = await redis.hget<string>(REDIS_KEY, term)
    if (!raw) return null
    return typeof raw === "string" ? JSON.parse(raw) : (raw as unknown as CustomVocabularyEntry)
  } catch {
    return null
  }
}

export async function deleteCustomVocabularyEntry(term: string): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  await redis.hdel(REDIS_KEY, term)
}

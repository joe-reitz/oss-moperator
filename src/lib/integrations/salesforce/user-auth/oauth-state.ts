/**
 * OAuth state nonce store for the per-user Salesforce connect flow.
 *
 * Each connect-flow generates a random UUID, stores it with the requester's
 * Slack identity + PKCE verifier, and passes it as the `state` query
 * parameter to SFDC's authorization endpoint. The callback validates the
 * nonce, reads back the Slack identity, and DELETES the nonce —
 * single-use, 10-minute window. This prevents replay and stops user A
 * from completing user B's flow.
 */
import { randomUUID } from "crypto"
import { getRedis } from "@/lib/redis"

const KEY_PREFIX = "moperator:sfdc-oauth-state:"
const TTL_SECONDS = 10 * 60 // 10 minutes

export interface OAuthStateRecord {
  nonce: string
  slackUserId: string
  slackTeamId: string
  channelId: string
  threadTs?: string
  source: string
  codeVerifier: string
  codeChallenge: string
  createdAt: number
}

function key(nonce: string): string {
  return `${KEY_PREFIX}${nonce}`
}

export async function createOAuthState(
  data: Omit<OAuthStateRecord, "nonce" | "createdAt">,
): Promise<string> {
  const redis = getRedis()
  if (!redis) throw new Error("Redis not configured — cannot create OAuth state")

  const nonce = randomUUID()
  const record: OAuthStateRecord = { ...data, nonce, createdAt: Date.now() }
  await redis.set(key(nonce), JSON.stringify(record), { ex: TTL_SECONDS })
  return nonce
}

export async function consumeOAuthState(nonce: string): Promise<OAuthStateRecord | null> {
  const redis = getRedis()
  if (!redis) return null

  const raw = await redis.get<string>(key(nonce))
  if (!raw) return null

  await redis.del(key(nonce)).catch(() => {})

  return typeof raw === "string"
    ? (JSON.parse(raw) as OAuthStateRecord)
    : (raw as unknown as OAuthStateRecord)
}

export async function peekOAuthState(nonce: string): Promise<OAuthStateRecord | null> {
  const redis = getRedis()
  if (!redis) return null

  const raw = await redis.get<string>(key(nonce))
  if (!raw) return null

  return typeof raw === "string"
    ? (JSON.parse(raw) as OAuthStateRecord)
    : (raw as unknown as OAuthStateRecord)
}

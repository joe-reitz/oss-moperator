/**
 * Per-user Salesforce refresh-token store.
 *
 * eve's interactive authorization owns the *flow* — minting the callback URL,
 * parking the turn, resuming it, rendering the sign-in challenge per channel —
 * which is what let us delete the PKCE helpers, the OAuth state store, and three
 * callback routes.
 *
 * It does not own long-term persistence: eve caches a resolved token per step,
 * and `getToken` is expected to be the source of truth. So refresh tokens still
 * live here, encrypted with AES-256-GCM, keyed by the eve principal.
 *
 * Records expire 90 days after last use, and every successful use resets the
 * TTL. Someone who stops using the agent quietly ages out and reconnects next
 * time, which is the behavior you want for a credential you did not have to be
 * asked to keep.
 */

import { getRedis } from "../redis"
import { decryptSecret, encryptSecret } from "./crypto"

const KEY_PREFIX = "moperator:sfdc-user-token:"
const TTL_SECONDS = 60 * 60 * 24 * 90 // 90 days

interface StoredToken {
  principalId: string
  instanceUrl: string
  refreshTokenEncrypted: string
  connectedAt: number
  lastUsedAt: number
}

function key(principalId: string): string {
  return `${KEY_PREFIX}${principalId}`
}

export interface UserSfdcGrant {
  principalId: string
  instanceUrl: string
  refreshToken: string
  connectedAt: number
  lastUsedAt: number
}

/** True when this deployment can store per-user grants at all. */
export function tokenStoreAvailable(): boolean {
  return !!getRedis() && !!process.env.MOPERATOR_TOKEN_ENCRYPTION_KEY
}

export async function putGrant(args: {
  principalId: string
  instanceUrl: string
  refreshToken: string
}): Promise<void> {
  const redis = getRedis()
  if (!redis) {
    throw new Error(
      "Per-user Salesforce OAuth needs Redis (UPSTASH_REDIS_REST_URL / _TOKEN) to store grants."
    )
  }

  const now = Date.now()
  const stored: StoredToken = {
    principalId: args.principalId,
    instanceUrl: args.instanceUrl,
    refreshTokenEncrypted: encryptSecret(args.refreshToken),
    connectedAt: now,
    lastUsedAt: now,
  }
  await redis.set(key(args.principalId), JSON.stringify(stored), { ex: TTL_SECONDS })
}

export async function getGrant(principalId: string): Promise<UserSfdcGrant | null> {
  const redis = getRedis()
  if (!redis) return null

  const raw = await redis.get<string>(key(principalId))
  if (!raw) return null

  try {
    const parsed: StoredToken =
      typeof raw === "string" ? JSON.parse(raw) : (raw as unknown as StoredToken)
    return {
      principalId: parsed.principalId,
      instanceUrl: parsed.instanceUrl,
      refreshToken: decryptSecret(parsed.refreshTokenEncrypted),
      connectedAt: parsed.connectedAt,
      lastUsedAt: parsed.lastUsedAt,
    }
  } catch {
    // A rotated MOPERATOR_TOKEN_ENCRYPTION_KEY makes every stored grant
    // undecryptable. Treat it as "not connected" so the user is re-prompted
    // rather than seeing a decryption error.
    return null
  }
}

/** Reset the TTL after a successful use. Best-effort. */
export async function touchGrant(principalId: string): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  const raw = await redis.get<string>(key(principalId))
  if (!raw) return
  try {
    const parsed: StoredToken =
      typeof raw === "string" ? JSON.parse(raw) : (raw as unknown as StoredToken)
    parsed.lastUsedAt = Date.now()
    await redis.set(key(principalId), JSON.stringify(parsed), { ex: TTL_SECONDS })
  } catch {
    // Non-critical.
  }
}

export async function deleteGrant(principalId: string): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  await redis.del(key(principalId))
}

/**
 * Per-user Salesforce token store.
 *
 * Refresh tokens are encrypted at rest. Records auto-expire 90 days after
 * the last successful use; `touchUserSfdcToken` resets the TTL on each
 * call. Stale users → no API access → forced reconnect → quiet cleanup.
 *
 * Key shape: `moperator:sfdc-user-token:slack-user:<slackUserId>`.
 */
import { getRedis } from "@/lib/redis"
import { decryptSecret, encryptSecret } from "./crypto"

const KEY_PREFIX = "moperator:sfdc-user-token:slack-user:"
const TTL_SECONDS = 60 * 60 * 24 * 90 // 90 days

export interface StoredUserToken {
  slackUserId: string
  sfdcUserId: string
  sfdcUsername: string
  instanceUrl: string
  refreshTokenEncrypted: string
  connectedAt: number
  lastUsedAt: number
}

type RedisShape = StoredUserToken

function key(slackUserId: string): string {
  return `${KEY_PREFIX}${slackUserId}`
}

export async function putUserSfdcToken(args: {
  slackUserId: string
  sfdcUserId: string
  sfdcUsername: string
  instanceUrl: string
  refreshToken: string
}): Promise<void> {
  const redis = getRedis()
  if (!redis) throw new Error("Redis not configured — cannot store SFDC user token")

  const now = Date.now()
  const stored: StoredUserToken = {
    slackUserId: args.slackUserId,
    sfdcUserId: args.sfdcUserId,
    sfdcUsername: args.sfdcUsername,
    instanceUrl: args.instanceUrl,
    refreshTokenEncrypted: encryptSecret(args.refreshToken),
    connectedAt: now,
    lastUsedAt: now,
  }
  await redis.set(key(args.slackUserId), JSON.stringify(stored), { ex: TTL_SECONDS })
}

export async function getUserSfdcToken(
  slackUserId: string,
): Promise<(Omit<StoredUserToken, "refreshTokenEncrypted"> & { refreshToken: string }) | null> {
  const redis = getRedis()
  if (!redis) return null

  const raw = await redis.get<string>(key(slackUserId))
  if (!raw) return null

  const parsed: RedisShape = typeof raw === "string" ? JSON.parse(raw) : (raw as unknown as RedisShape)
  const refreshToken = decryptSecret(parsed.refreshTokenEncrypted)

  return {
    slackUserId: parsed.slackUserId,
    sfdcUserId: parsed.sfdcUserId,
    sfdcUsername: parsed.sfdcUsername,
    instanceUrl: parsed.instanceUrl,
    refreshToken,
    connectedAt: parsed.connectedAt,
    lastUsedAt: parsed.lastUsedAt,
  }
}

/** Refresh the TTL + lastUsedAt timestamp after a successful API call. */
export async function touchUserSfdcToken(slackUserId: string): Promise<void> {
  const redis = getRedis()
  if (!redis) return

  const raw = await redis.get<string>(key(slackUserId))
  if (!raw) return

  const parsed: RedisShape = typeof raw === "string" ? JSON.parse(raw) : (raw as unknown as RedisShape)
  parsed.lastUsedAt = Date.now()
  await redis.set(key(slackUserId), JSON.stringify(parsed), { ex: TTL_SECONDS })
}

export async function deleteUserSfdcToken(slackUserId: string): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  await redis.del(key(slackUserId))
}

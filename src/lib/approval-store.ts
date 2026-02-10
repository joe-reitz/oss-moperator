/**
 * Approval Store
 *
 * Redis-backed storage for pending Salesforce write operation approvals.
 * When a non-authorized user triggers a write tool, the operation is stored
 * here and an approval request is posted in Slack with Approve/Deny buttons.
 */

import { getRedis } from "@/lib/redis"

export interface PendingApproval {
  id: string
  toolName: string
  args: Record<string, unknown>
  userId: string
  channel: string
  threadTs: string
  messageTs: string
  description: string
  createdAt: number
}

const APPROVAL_PREFIX = "approval:"
const APPROVAL_TTL_SECONDS = 30 * 60 // 30 minutes

/**
 * Store a pending approval in Redis with a 30-minute TTL.
 */
export async function storePendingApproval(
  approval: PendingApproval
): Promise<boolean> {
  const redis = getRedis()
  if (!redis) {
    console.error("[ApprovalStore] Redis not configured — cannot store approvals")
    return false
  }

  await redis.set(`${APPROVAL_PREFIX}${approval.id}`, JSON.stringify(approval), {
    ex: APPROVAL_TTL_SECONDS,
  })
  return true
}

/**
 * Fetch a pending approval by ID.
 */
export async function getPendingApproval(
  id: string
): Promise<PendingApproval | null> {
  const redis = getRedis()
  if (!redis) return null

  const data = await redis.get<string>(`${APPROVAL_PREFIX}${id}`)
  if (!data) return null

  try {
    return typeof data === "string" ? JSON.parse(data) : (data as unknown as PendingApproval)
  } catch {
    return null
  }
}

/**
 * Delete a pending approval after it has been approved or denied.
 */
export async function clearPendingApproval(id: string): Promise<void> {
  const redis = getRedis()
  if (!redis) return

  await redis.del(`${APPROVAL_PREFIX}${id}`)
}

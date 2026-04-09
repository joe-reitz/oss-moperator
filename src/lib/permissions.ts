/**
 * Authorization & Permissions
 *
 * Centralized module for checking whether a Slack user is authorized
 * to execute Salesforce write operations directly, or whether those
 * operations need to go through an approval workflow.
 */

import { getSlackUserInfo } from "@/lib/slack"

/**
 * Returns the list of email addresses authorized to perform
 * Salesforce write operations without approval.
 */
export function getAuthorizedEmails(): string[] {
  const emails = process.env.AUTHORIZED_USER_EMAILS || ""
  return emails
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * Checks whether a Slack user is authorized to perform write operations.
 * Looks up the user's email via Slack API and checks against AUTHORIZED_USER_EMAILS.
 */
export async function isAuthorizedUser(userId: string): Promise<boolean> {
  const authorizedEmails = getAuthorizedEmails()
  if (authorizedEmails.length === 0) return false

  const userInfo = await getSlackUserInfo(userId)
  if (!userInfo?.email) return false

  return authorizedEmails.includes(userInfo.email.toLowerCase())
}

/**
 * Returns the Slack mention string for the approver group.
 * Uses SLACK_APPROVER_GROUP_ID env var for proper <!subteam^ID> mention,
 * falls back to plain text "@approvers".
 */
/**
 * Returns the list of email addresses authorized to approve
 * growth marketing operations (Google Ads spend changes, etc.).
 */
export function getGrowthApproverEmails(): string[] {
  const raw = process.env.GROWTH_MARKETING_APPROVERS
  if (!raw) return []
  return raw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)
}

/**
 * Checks whether a Slack user is a growth marketing approver.
 * Looks up the user's email via Slack API and checks against GROWTH_MARKETING_APPROVERS.
 */
export async function isGrowthApprover(userId: string): Promise<boolean> {
  const approvers = getGrowthApproverEmails()
  if (!approvers.length) return false
  const userInfo = await getSlackUserInfo(userId)
  if (!userInfo?.email) return false
  return approvers.includes(userInfo.email.toLowerCase())
}

export function getApproverGroupMention(): string {
  const groupId = process.env.SLACK_APPROVER_GROUP_ID
  if (groupId) {
    return `<!subteam^${groupId}>`
  }
  return "@approvers"
}

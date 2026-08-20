/**
 * mOperator configuration — start here when you fork.
 *
 * Everything that makes this agent *yours* lives in this file or in the
 * environment variables it reads. You should be able to ship a customized
 * mOperator by editing this file, `agent/instructions/`, and `.env.local`.
 *
 * Nothing here reaches out to the network, so it is safe to import from both
 * agent code and the Next.js app.
 */

function csv(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
}

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export const config = {
  /** Display name. Shows up in instructions, digests, and the web chat. */
  botName: process.env.BOT_NAME || "mOperator",

  /**
   * The org this agent works for. Used in instructions so the model knows
   * whose CRM it is looking at, and to strip your own name out of the
   * co-organizer list when creating events.
   */
  orgName: process.env.MOPERATOR_ORG_NAME || "",

  /** Timezone for digests, date arithmetic, and "this quarter" style questions. */
  timezone: process.env.MOPERATOR_TIMEZONE || "America/Los_Angeles",

  /**
   * Fiscal year start month, 1-12. Marketing ops rarely runs on calendar
   * quarters. 1 = calendar year.
   */
  fiscalYearStartMonth: num(process.env.MOPERATOR_FISCAL_YEAR_START_MONTH, 1),

  approvers: {
    /**
     * People who may perform CRM writes without a second pair of eyes, and who
     * may approve someone else's write. Everyone else's writes park for
     * approval. Empty list means *every* write needs approval — a safe default
     * for a fresh fork.
     */
    writes: csv(process.env.AUTHORIZED_USER_EMAILS),

    /**
     * People who may approve anything that moves ad spend. Ad spend always
     * requires approval, even for the requester — this list controls who is
     * allowed to *grant* it. Falls back to the write approvers.
     */
    spend:
      csv(process.env.GROWTH_MARKETING_APPROVERS).length > 0
        ? csv(process.env.GROWTH_MARKETING_APPROVERS)
        : csv(process.env.AUTHORIZED_USER_EMAILS),
  },

  /**
   * Slack user group to @mention when something needs approval,
   * e.g. "S0123456789". Optional.
   */
  approverGroupId: process.env.SLACK_APPROVER_GROUP_ID || "",

  limits: {
    /** Hard cap on records in one bulk write, regardless of who asks. */
    bulkMax: num(process.env.MOPERATOR_BULK_MAX, 1_500),
    /** Above this, a bulk write needs approval even from an approver. */
    bulkApprovalThreshold: num(process.env.MOPERATOR_BULK_APPROVAL_THRESHOLD, 100),
    /** Rows written to a CSV export before it gets truncated. */
    csvExportRows: num(process.env.MOPERATOR_CSV_EXPORT_ROWS, 50_000),
    /** Daily ad budget (USD) above which spend changes get a louder warning. */
    adBudgetWarnUsd: num(process.env.MOPERATOR_AD_BUDGET_WARN_USD, 500),
  },

  /**
   * Where scheduled digests post. Each is a Slack channel ID (e.g. "C0123ABC").
   * A schedule with no channel configured stays inert — nothing fires until you
   * opt in, so a fresh fork never spams a workspace.
   */
  digests: {
    campaigns: process.env.MOPERATOR_CAMPAIGN_DIGEST_CHANNEL || "",
    adSpend: process.env.MOPERATOR_AD_SPEND_DIGEST_CHANNEL || "",
    triage: process.env.MOPERATOR_TRIAGE_DIGEST_CHANNEL || "",
  },

  /**
   * UTM and campaign naming conventions, enforced by the `build_tracking_url`
   * and `check_naming` tools. Override the whole shape for your org.
   */
  conventions: {
    /** Allowed utm_medium values. Empty = allow anything. */
    mediums: csv(process.env.MOPERATOR_UTM_MEDIUMS).length
      ? csv(process.env.MOPERATOR_UTM_MEDIUMS)
      : ["email", "paid-search", "paid-social", "organic-social", "display", "referral", "event", "webinar", "content-syndication"],
    /** Allowed utm_source values. Empty = allow anything. */
    sources: csv(process.env.MOPERATOR_UTM_SOURCES),
    /**
     * Campaign name pattern. Defaults to `REGION-QUARTER-CHANNEL-DESCRIPTOR`,
     * e.g. "NAM-FY26Q1-webinar-observability-launch".
     */
    campaignNamePattern:
      process.env.MOPERATOR_CAMPAIGN_NAME_PATTERN ||
      "^[A-Z]{2,5}-FY\\d{2}Q[1-4]-[a-z0-9-]+-[a-z0-9-]+$",
    campaignNameExample:
      process.env.MOPERATOR_CAMPAIGN_NAME_EXAMPLE ||
      "NAM-FY26Q1-webinar-observability-launch",
  },
} as const

/** Is this email allowed to perform CRM writes without approval? */
export function isWriteApprover(email: string | undefined): boolean {
  if (!email) return false
  return config.approvers.writes.includes(email.toLowerCase())
}

/** Is this email allowed to approve ad spend changes? */
export function isSpendApprover(email: string | undefined): boolean {
  if (!email) return false
  return config.approvers.spend.includes(email.toLowerCase())
}

/** Slack mention string for the approver group, for use in approval prompts. */
export function approverMention(): string {
  return config.approverGroupId ? `<!subteam^${config.approverGroupId}>` : "@approvers"
}

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

/** Split a comma list, preserving case — API names are case-sensitive. */
function csvRaw(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(",")
    .map((entry) => entry.trim())
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

  salesforce: {
    /**
     * Who the CRM records as having made a change.
     *
     * This is an audit decision, not a convenience one. Salesforce already has a
     * first-class audit trail (CreatedById, LastModifiedById, Field History
     * Tracking, Setup Audit Trail), and it is authoritative, queryable, and
     * already inside your compliance regime. The only way to make it *mean*
     * anything for agent-driven changes is for each person's writes to carry
     * their own Salesforce identity.
     *
     * So the default is `user`: a write is attributed to the person who asked
     * for it, and if it cannot be, it does not happen. Falling back to a shared
     * service account silently would produce exactly the audit trail you think
     * you have and do not.
     *
     *   "user"      writes require the requester's own Salesforce identity;
     *               reads use the service account, so nobody signs in to ask a
     *               question
     *   "user-all"  reads too, so Salesforce sharing rules and field-level
     *               security apply per person — the agent cannot show someone
     *               records they could not open themselves
     *   "service"   everything uses the shared service account. Explicit
     *               opt-out; every change reads as having been made by the bot.
     */
    identity: (["user", "user-all", "service"] as const).includes(
      (process.env.SFDC_IDENTITY || "") as "user" | "user-all" | "service"
    )
      ? (process.env.SFDC_IDENTITY as "user" | "user-all" | "service")
      : "user",

    /**
     * What a stranger from an imported list becomes: a Lead or a Contact.
     *
     * `Lead` is the default because it is the classic Salesforce model and it
     * needs no Account — a Lead stands alone until someone converts it.
     *
     * Plenty of orgs do not use Leads at all, though, running everything as
     * Contacts under Accounts. Set `MOPERATOR_IMPORT_OBJECT=Contact` for those,
     * and note the consequence: a Contact wants an `AccountId`, and one created
     * without it is a "private" Contact that most B2B reporting cannot see. In
     * a contact-only org the import usually needs to match or create the Account
     * first, which is a decision for a person rather than a default.
     *
     * This sets the default and tells the agent which model your org runs. The
     * import tool still accepts an explicit object, so a one-off is possible
     * without changing configuration.
     */
    importObject:
      (process.env.MOPERATOR_IMPORT_OBJECT || "").trim().toLowerCase() === "contact"
        ? "Contact"
        : "Lead",

    /**
     * Objects a list is deduped against, in priority order — the first match
     * wins, so put the object that "already exists" most authoritatively first.
     *
     * Defaults to both regardless of `importObject`, because orgs migrate and
     * legacy Leads outlive the decision to stop using them. Narrow it if you are
     * certain: each object costs one chunked query pass per import.
     */
    dedupeObjects: csvRaw(process.env.MOPERATOR_DEDUPE_OBJECTS).length
      ? csvRaw(process.env.MOPERATOR_DEDUPE_OBJECTS)
      : ["Contact", "Lead"],
  },

  /**
   * Knak, the on-brand email builder. Only the naming convention lives here;
   * brands, folders, and themes are looked up by name at runtime so they can
   * change in Knak without a deploy.
   */
  knak: {
    /**
     * Asset name template. Knak cannot rename an asset after creation, so this
     * is the one chance to get it right. Empty tokens collapse rather than
     * leaving gaps. Tokens: region, type, brand, title, date, ticket.
     */
    assetNamePattern:
      process.env.KNAK_ASSET_NAME_PATTERN ||
      "{region}_{type}_{brand}_{title}_{date}_{ticket}",
    /** Brand to assume when a request does not name one. */
    defaultBrand: process.env.KNAK_DEFAULT_BRAND || "",
    /**
     * Folder path under the brand that generated assets land in, e.g.
     * "Campaigns/Lifecycle". Folders nest, so this is walked segment by segment.
     */
    folderPath: (process.env.KNAK_FOLDER_PATH || "")
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean),
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

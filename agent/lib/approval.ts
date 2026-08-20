/**
 * Approval policies.
 *
 * mOperator can change your CRM and move real ad budget, so writes are gated.
 * eve turns a gate into a durable pause: the turn parks at `session.waiting`,
 * the channel renders Approve / Deny buttons, and the turn resumes exactly
 * where it stopped once someone answers — seconds or days later. Nothing is
 * held in memory while it waits, so a redeploy mid-approval is a non-event.
 *
 * That is why there is no approval store, no 30-minute TTL, no
 * `pending_approval: true` sentinel threaded back through the model, and no
 * interactions route in this repo any more.
 *
 * Two independent questions, kept separate on purpose:
 *
 *   1. Does this call need a human?  ← the policies in this file
 *   2. Is *this* human allowed to answer?  ← `onInputResponse` in
 *      `agent/channels/slack.ts`, which rejects answers from people outside
 *      the approver list
 *
 * Identity comes from `session.auth`, which the channel resolves once at the
 * boundary, so a policy is pure and never makes a network call.
 */

import type { Approval, ApprovalContext, ApprovalStatus } from "eve/tools/approval"

import { config, isSpendApprover, isWriteApprover } from "./config"

/** The email of whoever sent the message that triggered this turn. */
export function callerEmail(ctx: Pick<ApprovalContext, "session">): string | undefined {
  const attributes = ctx.session.auth.current?.attributes as
    | { email?: string }
    | undefined
  return attributes?.email
}

/** True when this turn was started by the runtime itself — a schedule, say. */
export function isAppPrincipal(ctx: Pick<ApprovalContext, "session">): boolean {
  const auth = ctx.session.auth.current
  return (
    auth?.authenticator === "app" &&
    auth.principalId === "eve:app" &&
    auth.principalType === "runtime"
  )
}

/**
 * Standard CRM write gate: Salesforce, HubSpot, and Marketo mutations.
 *
 * - Approvers write directly.
 * - Everyone else parks for approval.
 * - Scheduled turns run unattended (they have no human to ask), so keep
 *   schedule prompts read-only or idempotent.
 */
export function writeApproval(): Approval {
  return (ctx: ApprovalContext): ApprovalStatus => {
    if (isAppPrincipal(ctx)) return "not-applicable"
    return isWriteApprover(callerEmail(ctx)) ? "not-applicable" : "user-approval"
  }
}

/**
 * Bulk write gate. Same as `writeApproval`, plus two size rules that apply to
 * everyone including approvers:
 *
 * - Over `limits.bulkMax`: denied outright. A request this size is almost
 *   always a mistake in a query filter, and the model gets told why.
 * - Over `limits.bulkApprovalThreshold`: needs approval even from an approver.
 *
 * `recordsOf` pulls the affected-record count out of that tool's own input
 * shape, since each API names its array differently.
 */
export function bulkApproval(
  recordsOf: (input: Record<string, unknown> | undefined) => number
): Approval {
  return (ctx: ApprovalContext): ApprovalStatus => {
    const count = recordsOf(ctx.toolInput as Record<string, unknown> | undefined)

    if (count > config.limits.bulkMax) {
      return {
        type: "denied",
        reason:
          `This would touch ${count.toLocaleString()} records, over the ` +
          `${config.limits.bulkMax.toLocaleString()} limit. Narrow the query ` +
          `and try again — or split it into smaller batches and explain the plan first.`,
      }
    }

    if (isAppPrincipal(ctx)) return "not-applicable"

    if (count > config.limits.bulkApprovalThreshold) return "user-approval"

    return isWriteApprover(callerEmail(ctx)) ? "not-applicable" : "user-approval"
  }
}

/**
 * Ad spend gate. Always asks a human, every time — including for approvers, and
 * including for scheduled turns, which means a schedule can never move budget on
 * its own. That is deliberate: an unattended budget increase is the one mistake
 * here with an unbounded cost.
 */
export function spendApproval(): Approval {
  return (): ApprovalStatus => "user-approval"
}

/**
 * Second half of the spend gate, called at the top of a spend tool's `execute`.
 *
 * `spendApproval` guarantees *a* human approved. This guarantees it was a human
 * on the spend list. When someone clicks Approve in Slack, the channel's
 * `onInputResponse` returns that person's auth, so the resumed turn's
 * `auth.current` is the approver — which is exactly who this needs to check.
 *
 * Returns an error object rather than throwing, so the model can explain the
 * refusal instead of surfacing a stack trace.
 */
export function requireSpendApprover(
  ctx: Pick<ApprovalContext, "session">
): { success: false; error: string } | null {
  const email = callerEmail(ctx)
  if (isSpendApprover(email)) return null

  const who = email ? `${email} is` : "You are"
  const list = config.approvers.spend
  return {
    success: false,
    error:
      `${who} not on the ad spend approver list, so this change was not applied. ` +
      (list.length > 0
        ? `Ask one of ${list.join(", ")} to approve it.`
        : "Set GROWTH_MARKETING_APPROVERS to nominate who can approve ad spend."),
  }
}

/**
 * Deletion gate. Approval always, and never from an unattended turn: a
 * schedule that tries to delete a record is denied rather than silently
 * allowed, because a replayed step could otherwise delete twice.
 */
export function deleteApproval(): Approval {
  return (ctx: ApprovalContext): ApprovalStatus => {
    if (isAppPrincipal(ctx)) {
      return {
        type: "denied",
        reason:
          "Deletions require a person to approve them and cannot run from a scheduled task.",
      }
    }
    return "user-approval"
  }
}

/**
 * Gate for anything that sends to real humans — triggering a Marketo campaign,
 * publishing an event. Unsendable once sent, so it always asks, and it refuses
 * to fire unattended for the same replay reason as deletes.
 */
export function externalSendApproval(): Approval {
  return (ctx: ApprovalContext): ApprovalStatus => {
    if (isAppPrincipal(ctx)) {
      return {
        type: "denied",
        reason:
          "Sending to real recipients requires a person to approve it and cannot run from a scheduled task.",
      }
    }
    return "user-approval"
  }
}

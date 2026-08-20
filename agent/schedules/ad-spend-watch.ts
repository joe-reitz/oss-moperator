/**
 * Daily ad spend check.
 *
 * The point is catching the expensive surprises early: a campaign that
 * suddenly doubled its spend, one that is pinned at its budget cap, one that
 * stopped converting. All read-only — the spend approval policy refuses to move
 * budget from a scheduled run, deliberately, because an unattended budget change
 * is the one mistake here with an unbounded cost.
 *
 * Inert until MOPERATOR_AD_SPEND_DIGEST_CHANNEL is set.
 */

import { defineSchedule } from "eve/schedules"

import slack from "../channels/slack"
import { config } from "../lib/config"

export default defineSchedule({
  // 13:07 UTC daily — after the ad platforms have settled the prior day.
  cron: "7 13 * * *",

  async run({ to, waitUntil, appAuth }) {
    const channelId = config.digests.adSpend
    if (!channelId) return

    waitUntil(
      to(slack, { channelId }).send(
        [
          "Daily ad spend check. Compare yesterday against the prior 7-day average, per campaign, and report only what is worth acting on:",
          "",
          "- Spend up or down more than 30% day over day",
          "- Campaigns spending their full daily budget (budget-capped, so their measured performance is constrained)",
          "- Cost per conversion materially worse than the trailing week, where the conversion count is large enough to be meaningful",
          "- Any campaign spending with zero conversions for two days or more",
          "",
          "Remember that yesterday's conversions are still landing, so do not treat a partial window as a decline.",
          "",
          "If nothing crosses those thresholds, post a single line saying spend looked normal and give the total. Do not manufacture a finding.",
          "",
          "You cannot change budgets from a scheduled run. Recommend, and tag what a human should decide.",
        ].join("\n"),
        { auth: appAuth }
      )
    )
  },
})

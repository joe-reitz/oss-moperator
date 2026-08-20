/**
 * Weekly marketing-ops triage digest.
 *
 * What got filed, what is stuck, what shipped. Pulls from Linear and GitHub if
 * they are configured; skips whatever is not.
 *
 * Inert until MOPERATOR_TRIAGE_DIGEST_CHANNEL is set.
 */

import { defineSchedule } from "eve/schedules"

import slack from "../channels/slack"
import { config } from "../lib/config"

export default defineSchedule({
  // 16:23 UTC Friday — end of the week in US timezones.
  cron: "23 16 * * 5",

  async run({ to, waitUntil, appAuth }) {
    const channelId = config.digests.triage
    if (!channelId) return

    waitUntil(
      to(slack, { channelId }).send(
        [
          "Weekly triage digest for the last 7 days:",
          "",
          "- Issues filed this week, grouped by label, with URLs",
          "- Anything still sitting in triage that was filed more than a week ago",
          "- What shipped, summarized for a non-engineering audience",
          "",
          "Skip any section whose integration is not configured rather than mentioning it. Keep the whole post under about fifteen lines.",
        ].join("\n"),
        { auth: appAuth }
      )
    )
  },
})

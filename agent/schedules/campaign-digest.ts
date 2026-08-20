/**
 * Monday morning campaign digest.
 *
 * Inert until MOPERATOR_CAMPAIGN_DIGEST_CHANNEL is set, so a fresh fork never
 * posts into a workspace it was not asked to. On Vercel this becomes a Cron Job
 * automatically — there is no cron route to write or register.
 *
 * Handler form rather than markdown form because it has to deliver into a
 * specific Slack channel and because it should not fire at all when unconfigured.
 */

import { defineSchedule } from "eve/schedules"

import slack from "../channels/slack"
import { config } from "../lib/config"

export default defineSchedule({
  // 08:12 UTC Monday. Deliberately not on the hour: every cron on the platform
  // fires at :00, and nothing here needs the precision.
  cron: "12 8 * * 1",

  async run({ to, waitUntil, appAuth }) {
    const channelId = config.digests.campaigns
    if (!channelId) return

    waitUntil(
      to(slack, { channelId }).send(
        [
          "Weekly campaign digest. Report on the last 7 days:",
          "",
          "- Campaigns created or modified, with their type and owner",
          "- New campaign members by campaign, and how that compares with the prior week",
          "- Any campaign still in a draft or planning status whose start date has already passed",
          "- Any campaign whose name does not match our naming convention",
          "",
          "Delegate the digging to the data-analyst subagent. Keep the post short: a table plus the two or three things worth a human's attention. If nothing changed, say so in one line rather than padding it.",
          "",
          "You are running unattended, so do not attempt any writes — report what needs changing and let someone act on it.",
        ].join("\n"),
        { auth: appAuth }
      )
    )
  },
})

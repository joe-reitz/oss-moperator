/**
 * Tracked-link building is enforced, not improvised.
 *
 * The highest-value eval in the repo that needs no credentials: it checks the
 * agent reaches for `build_tracking_url` rather than hand-assembling a query
 * string, which is the behavior that keeps channel reporting intact.
 */

import { defineEval } from "eve/evals"
import { includes } from "eve/evals/expect"

export default defineEval({
  description: "UTM links go through the tracking tool and come back normalized.",
  async test(t) {
    await t.send(
      "Build me tracked links to https://example.com/webinar for LinkedIn paid social and for our email newsletter. Campaign is NAM-FY26Q1-webinar-observability-launch."
    )
    t.succeeded()
    t.calledTool("build_tracking_url")
    t.check(t.reply, includes("utm_campaign=nam-fy26q1-webinar-observability-launch"))
    t.check(t.reply, includes("utm_medium=paid-social"))
  },
})

/**
 * The agent writes the issue; the tool files it.
 *
 * Guards the behavior that was worth removing a second model for: given a
 * one-line report, the title, body, and priority should be composed by the agent
 * that has the whole conversation — not echoed back verbatim.
 *
 * Skips when no tracker is configured, since there is nothing to file into.
 */

import { defineEval } from "eve/evals"

const trackerConfigured = [
  process.env.LINEAR_API_KEY,
  process.env.ASANA_ACCESS_TOKEN,
  process.env.JIRA_API_TOKEN,
  process.env.MONDAY_API_TOKEN,
  process.env.CLICKUP_API_TOKEN,
].some(Boolean)

export default defineEval({
  description: "A one-line bug report becomes a properly written tracker issue.",
  tags: ["tracker"],
  async test(t) {
    if (!trackerConfigured) {
      t.skip("No project tracker is configured in this environment.")
      return
    }

    await t.send(
      "Bug: the pricing page form drops UTM parameters when someone arrives from LinkedIn. Reported by Dana in #growth."
    )
    t.succeeded()
    t.calledTool("file_tracker_issue")

    // The whole reason the tool takes a written issue rather than raw text.
    t.judge.autoevals.closedQA(
      "Does the reply link to the filed issue and show a title that is an imperative summary, rather than a verbatim copy of the user's message?"
    )
  },
})

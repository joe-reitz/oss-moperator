/**
 * The connected-systems section of the system prompt, resolved per session.
 *
 * mOperator's defining behavior is that it configures itself from the
 * environment: set `LINEAR_API_KEY` and the Linear tools appear *and* the prompt
 * starts mentioning Linear. Nothing to register twice, and — more importantly —
 * the model is never told about a system this install cannot reach, so it never
 * promises a Marketo operation on a deployment with no Marketo.
 *
 * Resolved at `session.started` rather than `turn.started` because the answer
 * cannot change mid-conversation, and a stable system prompt keeps the
 * provider's prompt cache warm.
 */

import { defineDynamic, defineInstructions } from "eve/instructions"

import { config } from "../lib/config"
import { renderCapabilities } from "../lib/integrations"

export default defineDynamic({
  events: {
    "session.started": () => {
      const org = config.orgName ? ` at ${config.orgName}` : ""

      return defineInstructions({
        content: [
          `You are ${config.botName}, the marketing operations agent${org}.`,
          "",
          `Dates and quarters: assume the ${config.timezone} timezone. The fiscal year starts in month ${config.fiscalYearStartMonth} (1 = January), so "Q1" means the fiscal quarter unless someone says "calendar".`,
          "",
          renderCapabilities(),
        ].join("\n"),
      })
    },
  },
})

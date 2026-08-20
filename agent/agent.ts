/**
 * Root agent configuration.
 *
 * This file replaced `src/lib/ai.ts` and its provider-branching. The model is a
 * Vercel AI Gateway id, so switching providers is a string change and one
 * credential (`AI_GATEWAY_API_KEY`, or a linked Vercel project's OIDC token)
 * rather than two SDK packages and two API keys.
 *
 * Override the model per deployment with AI_MODEL, or permanently with
 * `eve set --model <id>`.
 */

import { defineAgent } from "eve"

export default defineAgent({
  model: process.env.AI_MODEL || "anthropic/claude-opus-4.8",

  /**
   * Marketing ops work is mostly "get the filter exactly right", where the
   * expensive failure is a confidently wrong bulk update rather than a slow
   * answer. Medium buys that care without making every lookup ponderous;
   * the data-analyst subagent runs higher.
   */
  reasoning: "medium",

  compaction: {
    // Compact earlier than the default. A long Slack thread accumulates large
    // tool results, and hitting the window mid-write is worse than summarizing
    // sooner.
    thresholdPercent: 0.8,
  },

  limits: {
    /**
     * A generous but finite per-session budget. A runaway loop over a large
     * CRM is the realistic way to burn tokens here; at this ceiling eve pauses
     * and asks a human whether to continue rather than silently spending on.
     */
    maxInputTokensPerSession: 10_000_000,

    // Slack threads are long-lived. Two weeks of continuity, then a fresh start.
    sessionTimeoutMs: 14 * 24 * 60 * 60 * 1000,
  },

  build: {
    /**
     * jsforce is CommonJS and reaches for Node built-ins at require time, which
     * does not survive bundling. Keep it external and let Node resolve it.
     */
    externalDependencies: ["jsforce"],
  },
})

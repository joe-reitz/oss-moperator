/**
 * Eval defaults.
 *
 * These exist so a forker can verify their own install rather than discovering
 * a misconfiguration in Slack. `npm run eval` boots the real agent, drives real
 * sessions over its HTTP surface, and asserts on what came back.
 *
 * The judge model is only used by `t.judge.*` assertions; the deterministic
 * checks below need no model of their own.
 */

import { defineEvalConfig } from "eve/evals"

export default defineEvalConfig({
  judge: { model: process.env.MOPERATOR_JUDGE_MODEL || "anthropic/claude-haiku-4.5" },
  timeoutMs: 180_000,
})

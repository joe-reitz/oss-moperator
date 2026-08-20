/**
 * The data-analyst subagent.
 *
 * A specialist for "go find out" work: audit every campaign, compare last
 * quarter against this one, work out why lead volume dropped. Delegate to it
 * and it does the digging in its own context, then returns a finding — so the
 * long tail of intermediate query results never lands in the main conversation.
 *
 * It is also a genuine authorization boundary, not just a context saver. A
 * declared subagent inherits *nothing* from the root: this directory declares
 * read-only Salesforce tools and no write tools of any kind, so there is no
 * mutation surface for it to reach even if it decided to. That is a stronger
 * guarantee than a prompt asking it not to write.
 *
 * Run several in parallel over independent questions — one per campaign, one per
 * region — and they will not collide, because each writes to its own scratch
 * paths in the shared workspace.
 */

import { defineAgent } from "eve"

export default defineAgent({
  description:
    "Read-only marketing data analyst. Delegate an investigative question about CRM or campaign data — audits, comparisons, trend analysis, root-cause digging — and it returns a written finding with the numbers behind it. It cannot modify any record.",

  // Analysis is where reasoning pays for itself: the failure mode is a
  // confident wrong number, and that comes from skipped checks.
  model: process.env.MOPERATOR_ANALYST_MODEL || "anthropic/claude-opus-4.8",
  reasoning: "high",

  // One analyst pulling a large export and iterating on it can run long. Give it
  // room, but not unbounded room.
  limits: {
    maxInputTokensPerSession: 2_000_000,
  },
})

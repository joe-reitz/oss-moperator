/**
 * The audience vocabulary, injected per session.
 *
 * When a marketer says "segment" or "tier", your org almost certainly has one
 * specific custom field they mean, and no amount of schema inspection will tell
 * the model which one. This maps marketer-speak onto canonical field paths.
 *
 * Entries come from two places, merged with Redis winning on a term collision:
 * `AUDIENCE_VOCABULARY` in `agent/lib/vocabulary.ts` (checked in, reviewed,
 * ships with the build) and the /audience-vocab admin UI (stored in Redis, live
 * without a deploy).
 *
 * Resolving it as a dynamic instruction means a vocabulary edit takes effect on
 * the next conversation with no redeploy — the property the old string-concat
 * prompt had, kept, but now it is a first-class prompt layer instead of an
 * append at the end of a template literal.
 *
 * Returns null when no entries are configured, which is the fresh-fork state.
 */

import { defineDynamic, defineInstructions } from "eve/instructions"

import { formatVocabularyForPrompt } from "../lib/vocabulary"

export default defineDynamic({
  events: {
    "session.started": async () => {
      // A Redis hiccup must not fail the session; the agent just falls back to
      // asking about field names, which is the pre-vocabulary behavior.
      const vocabulary = await formatVocabularyForPrompt().catch(() => "")
      return vocabulary ? defineInstructions({ content: vocabulary }) : null
    },
  },
})

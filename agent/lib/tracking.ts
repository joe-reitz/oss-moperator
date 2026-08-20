/**
 * UTM and naming helpers shared by the tracking tools.
 *
 * Inconsistent tracking is the most expensive recurring mistake in marketing
 * ops: one `utm_medium=paid_social` among a thousand `paid-social` splits a
 * channel in every downstream report, and nobody notices until someone is
 * reviewing the quarter. Normalizing at link-creation time is far cheaper than
 * reconciling later, so every tool here runs values through `normalizeToken`.
 */

export const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "utm_id",
] as const

/** Lowercase, hyphenated, no stray punctuation — the only form that aggregates. */
export function normalizeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9.-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
}

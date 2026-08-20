/**
 * Turning an email brief into a Knak generation prompt.
 *
 * This is the part that took real trial and error, so it is worth explaining
 * rather than just reading.
 *
 * When marketing hands over approved copy, **the copy is the deliverable**.
 * A generative builder's instinct is to improve it — tighten the headline,
 * add a testimonial block, invent a "why teams choose us" section, drop in
 * lorem ipsum where it thinks something is missing. All of that is wrong when
 * the words have been through review, and some of it is a legal problem.
 *
 * So the prompt below is mostly a list of prohibitions, and the order matters:
 * the verbatim instruction comes first, the "only these sections" fence comes
 * second, and the content comes last as a numbered list. Each of those
 * sentences is there because something went wrong without it:
 *
 *   - "do not rewrite, summarize, paraphrase" — otherwise copy gets tightened
 *   - "include only the sections listed" — otherwise whole blocks get invented
 *   - "no placeholder or lorem-ipsum text" — otherwise gaps get filled with it
 *   - "leave every divider as the theme defines it" — a specific recurring drift
 *   - subject line "inbox subject ONLY" — otherwise it is also rendered as an
 *     H1 inside the body, duplicating the headline
 *   - link text "must display the link text, never the raw URL" — otherwise
 *     `[Watch the recording](https://…)` renders as the bare URL
 *
 * If you fork this, treat those lines as load-bearing. Deleting one to make the
 * prompt read better will reintroduce exactly the failure it names.
 */

import { config } from "../config"

export interface EmailBrief {
  /** Body copy, already approved. Reproduced verbatim. */
  bodyCopy: string
  subject?: string
  preheader?: string
  ctaText?: string
  ctaLink?: string
  /** Brand name, as Knak knows it. */
  brand?: string
  /** Free-form extra direction — layout notes, "keep it short", and so on. */
  notes?: string
}

/**
 * Assemble the generation prompt.
 *
 * Deterministic string building, deliberately not a model call: routing approved
 * copy through a second model to produce a prompt asking a third model not to
 * change it would be an odd way to preserve it.
 */
export function buildGenerationPrompt(brief: EmailBrief): string {
  const sections: string[] = []

  sections.push(
    "Body copy (use verbatim; render any bullet points as a bulleted list). " +
      "Preserve formatting: text wrapped in **double asterisks** is BOLD — render it bold. " +
      "Markdown links written as [text](url) must render as real hyperlinks that DISPLAY THE " +
      'LINK TEXT (e.g. "Watch the recording"), never the raw URL:\n' +
      brief.bodyCopy
  )

  if (brief.ctaText && brief.ctaLink) {
    sections.push(
      `Call-to-action button: label "${brief.ctaText}" linking to ${brief.ctaLink}`
    )
  } else if (brief.ctaLink) {
    sections.push(`Call-to-action button linking to ${brief.ctaLink}`)
  }

  const parts: string[] = [
    "Build a marketing email using EXACTLY the content below. Do not rewrite, summarize, " +
      "paraphrase, shorten, expand, or invent any content. Preserve the copy, links, and " +
      "call-to-action verbatim; only apply the brand's layout and styling.",

    "INCLUDE ONLY THE SECTIONS LISTED BELOW, IN THIS ORDER, plus the brand logo and standard " +
      "footer. Do not add any other section, heading, copy block, quote card, testimonial, " +
      "speaker or expert panel, or placeholder/lorem-ipsum text.",

    "Keep the theme's existing styling and colors unchanged. In particular, do NOT change the " +
      "color, thickness, or style of any divider — leave every divider exactly as the theme " +
      "defines it.",

    sections.map((section, index) => `${index + 1}. ${section}`).join("\n\n"),
  ]

  if (brief.subject) {
    parts.push(
      "Email subject line (inbox subject ONLY — do NOT render it as a heading or headline " +
        `inside the email body): ${brief.subject}`
    )
  }
  if (brief.brand) parts.push(`Brand: ${brief.brand}.`)
  if (brief.preheader) parts.push(`Preheader / preview text: ${brief.preheader}`)
  if (brief.notes) parts.push(`Additional direction: ${brief.notes}`)

  return parts.join("\n\n")
}

// ─── Asset naming ────────────────────────────────────────────────────────────

export interface AssetNameParts {
  region?: string
  /** "Email", "Nurture", or whatever your taxonomy uses. */
  type?: string
  brand?: string
  title?: string
  /** ISO date, YYYY-MM-DD. Rendered as YYYYMMDD. */
  targetSendDate?: string
  /** Tracker key, e.g. MOPS-4520, so the asset is traceable to its request. */
  ticket?: string
}

/** Compress an asset type to a short code: Email → em, Nurture → nur. */
function typeCode(type: string | undefined): string {
  const value = (type ?? "").trim().toLowerCase()
  if (value.startsWith("nur")) return "nur"
  if (value.startsWith("em")) return "em"
  return value
}

/** YYYY-MM-DD → YYYYMMDD, which is what sorts correctly in a file list. */
function compactDate(date: string | undefined): string {
  if (!date) return ""
  const match = date.trim().match(/(\d{4})-(\d{2})-(\d{2})/)
  if (match) return `${match[1]}${match[2]}${match[3]}`
  const digits = date.replace(/\D/g, "")
  return digits.length === 8 ? digits : date.trim()
}

/**
 * Build the asset name from `config.knak.assetNamePattern`.
 *
 * Knak cannot rename an asset after creation, so the name has to be right the
 * first time — which is why the tracker key is resolved up front rather than
 * stamped on later.
 *
 * The pattern is a token template, e.g.
 * `{region}_{type}_{brand}_{title}_{date}_{ticket}`. Empty tokens collapse
 * rather than leaving `__` gaps, and spaces inside a token become hyphens so
 * "AI SDK Launch" reads as one field rather than three.
 */
export function buildAssetName(parts: AssetNameParts): string {
  const values: Record<string, string> = {
    region: parts.region ?? "",
    type: typeCode(parts.type),
    brand: parts.brand ?? "",
    title: parts.title ?? "",
    date: compactDate(parts.targetSendDate),
    ticket: parts.ticket ?? "",
  }

  const pattern = config.knak.assetNamePattern
  const separator = pattern.includes("_") ? "_" : "-"

  // Split on the separator, resolve each token, drop the empties, rejoin.
  return pattern
    .split(separator)
    .map((segment) =>
      segment.replace(/\{(\w+)\}/g, (_match, token: string) => values[token] ?? "")
    )
    .map((segment) => segment.trim().replace(/\s+/g, "-"))
    .filter(Boolean)
    .join(separator)
}

/**
 * Slack delivers links as `<url|label>` and escapes `<`, `>`, and `&` in the
 * visible text. Left as-is, arrow notation in body copy ("->", "=>") arrives as
 * `-&gt;` and the builder treats the copy as garbled — which showed up as a bare
 * theme scaffold with none of the content.
 *
 * Rewrite links first (they use real angle brackets), then decode entities, so
 * `&amp;` inside a URL query string is also un-escaped.
 */
export function normalizeSlackText(text: string): string {
  const withLinks = (text || "")
    .replace(/<((?:https?|mailto):[^>|]+)\|([^>]*)>/gi, "[$2]($1)")
    .replace(/<((?:https?|mailto):[^>]+)>/gi, "$1")

  return withLinks
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    // Ampersand last, so a double-escaped entity does not decode twice.
    .replace(/&amp;/g, "&")
}

/**
 * Slack renders bold as single asterisks; markdown reads that as italic. Upgrade
 * to double so bold survives into the generated email.
 */
export function slackBoldToMarkdown(text: string): string {
  return text.replace(/\*([^*\n]+)\*/g, "**$1**")
}

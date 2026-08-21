/**
 * Email QA.
 *
 * Checks the things that actually go wrong between "the email looks fine" and
 * "the email shipped": a link with no tracking, a `utm_medium` that will
 * aggregate separately from every other send this quarter, a preheader that
 * truncates mid-sentence in Gmail, an unreplaced merge token.
 *
 * All pure logic over the rendered HTML. No vendor, no network. It works on any
 * email HTML, not just Knak's — paste in a Marketo or HubSpot export and it
 * checks the same things.
 *
 * The severities are deliberate: `blocking` is "do not send this", `warning` is
 * "someone should look", `note` is informational. A QA tool that flags
 * everything at the same level gets ignored.
 */

import { config } from "./config"
import { normalizeToken, UTM_KEYS } from "./tracking"

export type Severity = "blocking" | "warning" | "note"

export interface Finding {
  severity: Severity
  issue: string
  /** Where it is, when that helps — a URL, an image, the subject. */
  where?: string
}

export interface EmailQaInput {
  html: string
  subject?: string
  preheader?: string
  /** Skip UTM checks for hosts that are not campaign destinations. */
  ignoreHosts?: string[]
}

export interface EmailQaReport {
  findings: Finding[]
  /**
   * `tracked` and `untracked` count only *campaign* links — the ones that should
   * carry UTMs. Functional links (unsubscribe, view in browser) and ignored
   * hosts are counted separately, so "0 untracked" means what it sounds like.
   */
  links: {
    total: number
    unique: number
    campaign: number
    tracked: number
    untracked: number
    functional: number
    ignoredHost: number
  }
  images: { total: number; missingAlt: number }
  subjectLength?: number
  preheaderLength?: number
  clean: boolean
}

/**
 * Gmail truncates a subject around 70 characters on desktop and closer to 40 on
 * mobile; a preheader gets roughly 90 before it is cut. These are the widely
 * cited practical limits rather than anything Gmail documents.
 */
const SUBJECT_LONG = 70
const PREHEADER_LONG = 90

/** Hosts that are never campaign destinations, so a missing UTM is expected. */
const DEFAULT_IGNORED = [
  "twitter.com", "x.com", "linkedin.com", "facebook.com", "instagram.com",
  "youtube.com", "github.com", "apple.com", "google.com",
]

/**
 * Functional links, which legitimately carry no campaign tracking: the
 * unsubscribe and preference-centre links (required, and not a campaign
 * destination), view-in-browser, and privacy or terms pages.
 *
 * Without this exclusion every correctly built email reports a blocking issue
 * for its own unsubscribe link, which trains people to ignore the report.
 */
const FUNCTIONAL_LINK =
  /unsubscribe|opt.?out|email.?preference|manage.?preference|view.?in.?browser|webversion|web.?version|privacy|terms|\/legal/i

/**
 * Merge tokens across the major platforms. An unreplaced token in a rendered
 * preview means the send will show it literally to somebody.
 */
const MERGE_TOKEN = /\{\{[^}]{1,80}\}\}|%%[^%]{1,80}%%|\$\{[^}]{1,80}\}|\[\[[^\]]{1,80}\]\]/g

/** Words that reliably move an email toward a spam folder. */
const SPAM_WORDS = [
  "act now", "apply now", "buy direct", "cash bonus", "click below",
  "congratulations", "credit card offers", "double your", "earn extra cash",
  "for free", "free access", "free gift", "free money", "guaranteed",
  "limited time only", "no catch", "no obligation", "no strings attached",
  "risk free", "satisfaction guaranteed", "urgent", "winner", "you have been selected",
]

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return null
  }
}

export function auditEmail(input: EmailQaInput): EmailQaReport {
  const findings: Finding[] = []
  const { html } = input
  const ignored = new Set([...(input.ignoreHosts ?? []), ...DEFAULT_IGNORED])

  // ── Links ─────────────────────────────────────────────────────────────────
  const hrefs = Array.from(html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)).map(
    (match) => match[1].trim()
  )
  const httpLinks = hrefs.filter((href) => /^https?:/i.test(href))
  const unique = Array.from(new Set(httpLinks))

  let tracked = 0
  let functional = 0
  let ignoredHost = 0
  const seenMediums = new Set<string>()
  const seenCampaigns = new Set<string>()

  for (const href of unique) {
    const host = hostOf(href)
    let url: URL
    try {
      url = new URL(href)
    } catch {
      findings.push({ severity: "blocking", issue: "Link is not a valid URL", where: href })
      continue
    }

    // Classify before counting, so the tracked/untracked ratio only describes
    // links that were supposed to carry campaign tracking.
    if (FUNCTIONAL_LINK.test(href)) {
      functional++
      continue
    }
    if (host && ignored.has(host)) {
      ignoredHost++
      continue
    }

    const hasUtms = UTM_KEYS.some((key) => url.searchParams.has(key))
    if (hasUtms) tracked++

    if (!hasUtms) {
      findings.push({
        severity: "blocking",
        issue: "No UTM parameters, so clicks will not attribute to this campaign",
        where: href,
      })
      continue
    }

    for (const key of ["utm_source", "utm_medium", "utm_campaign"]) {
      if (!url.searchParams.has(key)) {
        findings.push({ severity: "warning", issue: `Missing ${key}`, where: href })
      }
    }

    for (const key of UTM_KEYS) {
      const value = url.searchParams.get(key)
      if (!value) continue
      if (value !== normalizeToken(value)) {
        findings.push({
          severity: "warning",
          issue: `${key}="${value}" is not lowercase-hyphenated, so it will aggregate separately from "${normalizeToken(value)}"`,
          where: href,
        })
      }
    }

    const medium = url.searchParams.get("utm_medium")
    if (medium) {
      seenMediums.add(medium)
      if (
        config.conventions.mediums.length > 0 &&
        !config.conventions.mediums.includes(medium)
      ) {
        findings.push({
          severity: "warning",
          issue: `utm_medium="${medium}" is not one of the approved mediums`,
          where: href,
        })
      }
    }
    const campaign = url.searchParams.get("utm_campaign")
    if (campaign) seenCampaigns.add(campaign)
  }

  // One email should be one campaign and, almost always, one medium. More than
  // one usually means a link was copied from a different send.
  if (seenCampaigns.size > 1) {
    findings.push({
      severity: "warning",
      issue: `Links use ${seenCampaigns.size} different utm_campaign values (${[...seenCampaigns].join(", ")}) — reporting will split`,
    })
  }
  if (seenMediums.size > 1) {
    findings.push({
      severity: "note",
      issue: `Links use ${seenMediums.size} different utm_medium values (${[...seenMediums].join(", ")}). Intentional only if this email spans channels.`,
    })
  }

  // ── Images ────────────────────────────────────────────────────────────────
  const imgTags = Array.from(html.matchAll(/<img\b[^>]*>/gi)).map((match) => match[0])
  let missingAlt = 0
  for (const tag of imgTags) {
    const alt = tag.match(/\balt\s*=\s*["']([^"']*)["']/i)
    if (!alt || alt[1].trim() === "") {
      missingAlt++
    }
  }
  if (missingAlt > 0) {
    findings.push({
      severity: "warning",
      issue: `${missingAlt} of ${imgTags.length} images have no alt text — they are invisible to screen readers and to anyone with images off`,
    })
  }

  // ── Unreplaced tokens and placeholder text ────────────────────────────────
  const tokens = Array.from(new Set(html.match(MERGE_TOKEN) ?? []))
  if (tokens.length > 0) {
    findings.push({
      severity: "blocking",
      issue: `Unreplaced merge tokens in the rendered output: ${tokens.slice(0, 5).join(", ")}`,
    })
  }
  if (/lorem ipsum|dolor sit amet/i.test(html)) {
    findings.push({ severity: "blocking", issue: "Placeholder lorem-ipsum text is still in the body" })
  }
  if (/\bTODO\b|\bTBD\b|\bXXX\b|\bFIXME\b/.test(html)) {
    findings.push({ severity: "warning", issue: "Body contains a TODO/TBD placeholder" })
  }

  // ── Subject and preheader ─────────────────────────────────────────────────
  if (input.subject !== undefined) {
    const subject = input.subject.trim()
    if (!subject) {
      findings.push({ severity: "blocking", issue: "Subject line is empty" })
    } else if (subject.length > SUBJECT_LONG) {
      findings.push({
        severity: "warning",
        issue: `Subject is ${subject.length} characters; it will truncate around ${SUBJECT_LONG} on desktop and sooner on mobile`,
        where: subject,
      })
    }
    const spam = SPAM_WORDS.filter((word) => subject.toLowerCase().includes(word))
    if (spam.length > 0) {
      findings.push({
        severity: "warning",
        issue: `Subject contains spam-filter trigger phrases: ${spam.join(", ")}`,
      })
    }
    if (subject === subject.toUpperCase() && /[A-Z]{4,}/.test(subject)) {
      findings.push({ severity: "warning", issue: "Subject is in all caps" })
    }
    const exclamations = (subject.match(/!/g) ?? []).length
    if (exclamations > 1) {
      findings.push({
        severity: "note",
        issue: `Subject has ${exclamations} exclamation marks`,
      })
    }
  }

  if (input.preheader !== undefined) {
    const preheader = input.preheader.trim()
    if (!preheader) {
      findings.push({
        severity: "warning",
        issue: "No preheader, so the inbox will preview the first words of the body instead",
      })
    } else if (preheader.length > PREHEADER_LONG) {
      findings.push({
        severity: "note",
        issue: `Preheader is ${preheader.length} characters; roughly ${PREHEADER_LONG} will show`,
      })
    }
    if (preheader && input.subject && preheader.trim() === input.subject.trim()) {
      findings.push({
        severity: "warning",
        issue: "Preheader duplicates the subject, wasting the preview line",
      })
    }
  }

  // ── Structure ─────────────────────────────────────────────────────────────
  if (!/unsubscribe|opt.?out|email preferences/i.test(html)) {
    findings.push({
      severity: "blocking",
      issue: "No unsubscribe link found. Required by CAN-SPAM and GDPR for marketing email.",
    })
  }

  const order: Record<Severity, number> = { blocking: 0, warning: 1, note: 2 }
  findings.sort((a, b) => order[a.severity] - order[b.severity])

  return {
    findings,
    links: {
      total: httpLinks.length,
      unique: unique.length,
      campaign: unique.length - functional - ignoredHost,
      tracked,
      untracked: unique.length - functional - ignoredHost - tracked,
      functional,
      ignoredHost,
    },
    images: { total: imgTags.length, missingAlt },
    subjectLength: input.subject?.trim().length,
    preheaderLength: input.preheader?.trim().length,
    clean: !findings.some((finding) => finding.severity === "blocking"),
  }
}

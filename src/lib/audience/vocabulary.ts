/**
 * Audience Vocabulary
 *
 * Curated mappings from marketer-speak to canonical Salesforce fields.
 * When a marketer says "segment" your org probably has a specific custom
 * field they mean — and the agent has no way to know that without help.
 * This file is where you tell it.
 *
 * Two ways to add entries:
 *
 *   1. Edit AUDIENCE_VOCABULARY below directly. Entries are checked into
 *      git, code-reviewed, and ship with the build. Best for stable
 *      mappings everyone on your team agrees on.
 *
 *   2. Use the /audience-vocab admin UI (gated to AUTHORIZED_USER_EMAILS).
 *      Entries are stored in Redis and override static defaults of the
 *      same term + object. No deploy needed. Best for experimentation
 *      and individual overrides.
 *
 * The vocabulary is appended to the agent's system prompt at request
 * time via `formatVocabularyForPrompt()`. When a user describes an
 * audience, the agent consults this vocabulary first, then falls back
 * to standard SFDC field names.
 *
 * Entry shape — every field has a purpose, but only `term`, `object`,
 * `field`, and `description` are required:
 *
 *   {
 *     term: "segment",                              // What marketers say
 *     aliases: ["customer segment", "tier"],        // Other phrasings
 *     object: "Account",                            // SFDC object
 *     field: "Customer_Segment__c",                 // SFDC API name
 *     description: "Primary segmentation tier.",    // One-liner
 *     commonValues: ["Enterprise", "SMB"],          // Picklist values
 *     avoid: [
 *       { field: "Legacy_Segment__c", reason: "stale data" },
 *     ],
 *     notes: "For Contact queries, use the Contact-level entry below.",
 *   }
 */

export type AudienceObject =
  | "Contact"
  | "Account"
  | "CampaignMember"

export interface VocabularyEntry {
  /** Primary phrase a marketer is most likely to say. */
  term: string
  /** Other phrasings that should resolve to the same field. */
  aliases?: string[]
  /** The Salesforce object this field lives on (or relates from). */
  object: AudienceObject
  /**
   * Fully qualified field path, including relationship traversals.
   * Example: "Account.Hierarchy_Segment__c" when querying Contact.
   */
  field: string
  /** One-line "what this is and why we use it" for the agent's confirmation card. */
  description: string
  /** Canonical picklist values (when known). */
  commonValues?: string[]
  /** Related fields to NEVER use for this concept, with the reason. */
  avoid?: Array<{ field: string; reason: string }>
  /** Free-form context the agent should consider when picking values. */
  notes?: string
}

/**
 * Static defaults. Ships empty in the OSS build — add entries for your org.
 *
 * If your team is small or you're just getting started, use the admin UI
 * at /audience-vocab to add Redis-backed entries instead — those take
 * effect immediately without redeploying.
 */
export const AUDIENCE_VOCABULARY: VocabularyEntry[] = []

/**
 * Render the vocabulary as a system-prompt section. Compact, agent-readable.
 */
function renderEntry(entry: VocabularyEntry): string[] {
  const lines: string[] = []
  const aliasList = entry.aliases?.length ? ` / "${entry.aliases.join('" / "')}"` : ""
  lines.push(`- "${entry.term}"${aliasList} → ${entry.object}.${entry.field}`)
  lines.push(`  ${entry.description}`)
  if (entry.commonValues?.length) {
    lines.push(`  Common values: ${entry.commonValues.join(", ")}`)
  }
  if (entry.avoid?.length) {
    for (const a of entry.avoid) {
      lines.push(`  AVOID: ${a.field} — ${a.reason}`)
    }
  }
  if (entry.notes) {
    lines.push(`  Notes: ${entry.notes}`)
  }
  return lines
}

/**
 * Build the vocabulary section for the system prompt. Merges static defaults
 * with Redis-stored custom entries (managed via /audience-vocab); custom
 * entries WIN on `term`+`object` collisions so ops can override built-ins
 * without a deploy. Returns an empty string when no entries are configured.
 */
export async function formatVocabularyForPrompt(): Promise<string> {
  const { listCustomVocabulary } = await import("./vocabulary-store")
  const custom = await listCustomVocabulary().catch(() => [])

  // Key by term+object so the same term can map to different fields on
  // different objects.
  const merged = new Map<string, VocabularyEntry>()
  for (const entry of AUDIENCE_VOCABULARY) merged.set(`${entry.term}|${entry.object}`, entry)
  for (const entry of custom) merged.set(`${entry.term}|${entry.object}`, entry)

  if (merged.size === 0) return ""

  const lines: string[] = [
    "AUDIENCE FIELD VOCABULARY (use these mappings when a user describes an audience).",
    "When the same term appears for multiple objects, pick the entry whose object matches the query's FROM clause.",
    "",
  ]
  for (const entry of merged.values()) {
    lines.push(...renderEntry(entry))
  }
  return lines.join("\n")
}

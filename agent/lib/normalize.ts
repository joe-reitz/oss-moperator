/**
 * Field normalization for imported lists.
 *
 * The daily reality of marketing ops data: "VP of Marketing", "V.P. Marketing",
 * and "vp marketing" are one person's title written three ways, and they
 * segment as three values. "Acme, Inc." and "Acme Inc" are one account.
 * "USA", "U.S.", and "United States" are one country.
 *
 * These are heuristics, not truth. Every function is conservative — when it is
 * not confident it returns the input unchanged rather than guessing, because a
 * wrong normalization is worse than none. `normalizeCountry` only maps names it
 * actually knows.
 */

/** ISO 3166-1 alpha-2 for the countries that dominate B2B marketing lists. */
const COUNTRIES: Record<string, string> = {
  "united states": "US", "united states of america": "US", usa: "US", "u.s.": "US",
  "u.s.a.": "US", us: "US", america: "US",
  "united kingdom": "GB", uk: "GB", "u.k.": "GB", "great britain": "GB",
  britain: "GB", england: "GB", scotland: "GB", wales: "GB", gb: "GB",
  canada: "CA", ca: "CA", germany: "DE", deutschland: "DE", de: "DE",
  france: "FR", fr: "FR", spain: "ES", españa: "ES", es: "ES",
  italy: "IT", italia: "IT", it: "IT", netherlands: "NL", holland: "NL", nl: "NL",
  australia: "AU", au: "AU", "new zealand": "NZ", nz: "NZ",
  india: "IN", in: "IN", japan: "JP", jp: "JP", china: "CN", cn: "CN",
  singapore: "SG", sg: "SG", brazil: "BR", brasil: "BR", br: "BR",
  mexico: "MX", méxico: "MX", mx: "MX", ireland: "IE", ie: "IE",
  sweden: "SE", se: "SE", norway: "NO", no: "NO", denmark: "DK", dk: "DK",
  finland: "FI", fi: "FI", poland: "PL", pl: "PL", switzerland: "CH", ch: "CH",
  austria: "AT", at: "AT", belgium: "BE", be: "BE", portugal: "PT", pt: "PT",
  israel: "IL", il: "IL", "south korea": "KR", korea: "KR", kr: "KR",
  "south africa": "ZA", za: "ZA", "united arab emirates": "AE", uae: "AE", ae: "AE",
}

/**
 * Map a free-text country to ISO alpha-2, or null when unrecognized.
 *
 * Null rather than a guess: an unmapped country in a report is visible and
 * fixable, whereas a wrong one silently misroutes a lead.
 */
export function normalizeCountry(value: string | undefined): string | null {
  const key = (value ?? "").trim().toLowerCase().replace(/\.$/, "")
  if (!key) return null
  return COUNTRIES[key] ?? COUNTRIES[key.replace(/[.\s]/g, "")] ?? null
}

/** Seniority bands, coarse enough to be useful for routing and scoring. */
export type Seniority =
  | "c-level"
  | "vp"
  | "director"
  | "manager"
  | "individual"
  | "unknown"

/**
 * Classify a job title into a seniority band.
 *
 * Order matters: "VP of Engineering" must not match "engineer", and
 * "Director of Marketing Operations" must not fall through to individual. The
 * checks run most-senior first for that reason.
 */
export function normalizeSeniority(title: string | undefined): Seniority {
  const value = (title ?? "").toLowerCase().replace(/[.]/g, "")
  if (!value.trim()) return "unknown"

  // Founders and owners are decision-makers regardless of the word used.
  if (/\b(ceo|cto|cfo|cmo|coo|ciso|cio|cro|cpo|chief|founder|co-founder|owner|president|partner)\b/.test(value)) {
    return "c-level"
  }
  if (/\b(vp|svp|evp|avp|vice president)\b/.test(value)) return "vp"
  if (/\b(director|head of|principal)\b/.test(value)) return "director"
  if (/\b(manager|mgr|lead|supervisor)\b/.test(value)) return "manager"
  if (/\b(engineer|developer|analyst|specialist|associate|coordinator|consultant|designer|architect|scientist|administrator|representative|intern)\b/.test(value)) {
    return "individual"
  }
  return "unknown"
}

/** Legal suffixes and punctuation that make one company look like several. */
const COMPANY_SUFFIXES = [
  "incorporated", "inc", "corporation", "corp", "company", "co", "limited",
  "ltd", "llc", "llp", "lp", "plc", "gmbh", "ag", "sa", "sas", "bv", "nv",
  "ab", "oy", "as", "pty", "pte", "srl", "spa", "kk", "holdings", "group",
]

/**
 * Reduce a company name to a comparison key.
 *
 * Only for matching — never store this or show it to a user. "Acme, Inc." and
 * "ACME Inc" both become "acme", which is what makes them dedupe.
 */
export function companyKey(name: string | undefined): string {
  let value = (name ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  // Strip trailing legal suffixes repeatedly: "Acme Holdings Inc" → "acme".
  let changed = true
  while (changed) {
    changed = false
    for (const suffix of COMPANY_SUFFIXES) {
      if (value.endsWith(` ${suffix}`)) {
        value = value.slice(0, -(suffix.length + 1)).trim()
        changed = true
      }
    }
  }
  return value
}

/** Title Case a name that arrived shouting or whispering. */
export function normalizePersonName(value: string | undefined): string {
  const input = (value ?? "").trim()
  if (!input) return ""
  // Leave mixed-case names alone — "McDonald" and "van der Berg" are correct
  // as given, and re-casing them is a regression.
  if (input !== input.toLowerCase() && input !== input.toUpperCase()) return input

  return input
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((part) =>
      /^[a-z]/.test(part) ? part.charAt(0).toUpperCase() + part.slice(1) : part
    )
    .join("")
}

/** Digits-only phone comparison key, ignoring formatting. */
export function phoneKey(value: string | undefined): string {
  const digits = (value ?? "").replace(/\D/g, "")
  // Drop a US country code so +1-555… and 555… match.
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits
}

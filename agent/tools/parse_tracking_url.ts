/**
 * Audit the UTM parameters on existing URLs.
 *
 * The read side of `build_tracking_url`: point it at links someone is about to
 * publish, or at links already in the wild, and it reports where the traffic
 * will actually be attributed and what will fragment.
 */
import { defineTool } from "eve/tools"
import { z } from "zod"

import { config } from "../lib/config"
import { normalizeToken, UTM_KEYS } from "../lib/tracking"

export default defineTool({
  description:
    "Pull the UTM parameters out of one or more URLs and flag anything inconsistent with the org's conventions. Use it to audit links someone is about to publish, or to work out where existing traffic is being attributed.",
  inputSchema: z.object({
    urls: z.array(z.string()).min(1).describe("URLs to inspect"),
  }),
  execute({ urls }) {
    const parsed = urls.map((raw) => {
      let url: URL
      try {
        url = new URL(raw)
      } catch {
        return { url: raw, valid: false as const, error: "Not a parseable URL" }
      }

      const params: Record<string, string> = {}
      for (const key of UTM_KEYS) {
        const value = url.searchParams.get(key)
        if (value) params[key] = value
      }

      const issues: string[] = []
      if (!params.utm_source) issues.push("missing utm_source")
      if (!params.utm_medium) issues.push("missing utm_medium")
      if (!params.utm_campaign) issues.push("missing utm_campaign")

      for (const [key, value] of Object.entries(params)) {
        if (value !== normalizeToken(value)) {
          issues.push(
            `${key}="${value}" is not lowercase-hyphenated (should be "${normalizeToken(value)}") — it will aggregate separately from the canonical form`
          )
        }
      }

      if (
        params.utm_medium &&
        config.conventions.mediums.length > 0 &&
        !config.conventions.mediums.includes(params.utm_medium)
      ) {
        issues.push(`utm_medium="${params.utm_medium}" is not an approved medium`)
      }

      return {
        url: raw,
        valid: true as const,
        destination: `${url.origin}${url.pathname}`,
        params,
        issues,
      }
    })

    return {
      success: true as const,
      results: parsed,
      clean: parsed.every((entry) => entry.valid && entry.issues.length === 0),
    }
  },
})

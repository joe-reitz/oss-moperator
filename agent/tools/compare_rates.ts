/**
 * Is that difference real?
 *
 * Exists because the default failure is confident and expensive: two campaigns
 * convert at 2.1% and 2.4% on a few hundred clicks each, the agent ranks them,
 * and someone moves budget. A two-proportion z-test settles it, and the verdict
 * is written so it cannot be rounded up into a recommendation.
 */

import { defineTool } from "eve/tools"
import { z } from "zod"

import { compareRates } from "../lib/stats"

const arm = z.object({
  label: z.string().describe("What this arm is, e.g. 'Variant A' or a campaign name"),
  conversions: z.number().int().min(0).describe("Conversions, clicks, or opens"),
  total: z.number().int().min(0).describe("The denominator — sends, impressions, or visits"),
})

export default defineTool({
  description: `Test whether the difference between two conversion rates is real or noise.

Use this ANY time you are about to say one thing outperformed another — A/B test results, two campaigns, this month against last. Do not rank two rates by eye; at marketing-ops volumes the difference is very often indistinguishable, and saying so is more useful than a false winner.

Report the verdict as given. When it says not distinguishable, do not soften that into "A is slightly ahead" — that is the exact error this prevents.`,
  inputSchema: z.object({
    a: arm.describe("The baseline or control"),
    b: arm.describe("The variant or comparison"),
    confidence: z
      .number()
      .min(0.5)
      .max(0.999)
      .optional()
      .describe("Confidence threshold, default 0.95"),
  }),
  execute({ a, b, confidence }) {
    if (a.conversions > a.total || b.conversions > b.total) {
      return {
        success: false as const,
        error:
          "Conversions cannot exceed the total. Check which number is the denominator.",
      }
    }

    const result = compareRates(a, b, confidence ?? 0.95)

    return {
      success: true as const,
      a: {
        label: result.a.label,
        rate: `${(result.a.rate * 100).toFixed(2)}%`,
        conversions: result.a.conversions,
        total: result.a.total,
      },
      b: {
        label: result.b.label,
        rate: `${(result.b.rate * 100).toFixed(2)}%`,
        conversions: result.b.conversions,
        total: result.b.total,
      },
      absolute_difference: `${result.absoluteDifference >= 0 ? "+" : ""}${result.absoluteDifference.toFixed(2)} percentage points`,
      relative_lift:
        result.relativeLift === null
          ? null
          : `${result.relativeLift >= 0 ? "+" : ""}${result.relativeLift.toFixed(1)}%`,
      p_value: Number(result.pValue.toFixed(5)),
      significant: result.significant,
      sample_needed_per_arm: result.sampleNeededPerArm,
      verdict: result.verdict,
    }
  },
})

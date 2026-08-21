/**
 * Comparing two rates honestly.
 *
 * The failure this prevents is specific and common: someone asks which of two
 * campaigns performed better, the numbers differ, and the agent ranks them —
 * when at that volume the difference is indistinguishable from noise. Marketing
 * budget gets moved on findings like that.
 *
 * A two-proportion z-test is the right tool and it is a dozen lines. What
 * matters more than the arithmetic is that the result carries a verdict the
 * model cannot round up into a recommendation.
 */

export interface RateComparison {
  label: string
  conversions: number
  total: number
  rate: number
}

export interface ComparisonResult {
  a: RateComparison
  b: RateComparison
  /** Percentage-point difference, b − a. */
  absoluteDifference: number
  /** Relative lift of b over a, as a percentage. Null when a's rate is zero. */
  relativeLift: number | null
  pValue: number
  significant: boolean
  confidence: number
  /**
   * How many observations per arm would be needed to detect the observed
   * difference. Null when the rates are identical.
   */
  sampleNeededPerArm: number | null
  verdict: string
}

/** Normal CDF via the Abramowitz–Stegun erf approximation. Ample here. */
function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x)
  return 0.5 * (1 + sign * y)
}

/**
 * Two-proportion z-test.
 *
 * `confidence` is the threshold for calling a difference real; 0.95 is the
 * convention. The verdict is written for a human to read out loud, because the
 * number on its own invites over-reading.
 */
export function compareRates(
  a: { label: string; conversions: number; total: number },
  b: { label: string; conversions: number; total: number },
  confidence = 0.95
): ComparisonResult {
  const rateA = a.total > 0 ? a.conversions / a.total : 0
  const rateB = b.total > 0 ? b.conversions / b.total : 0

  const armA = { ...a, rate: rateA }
  const armB = { ...b, rate: rateB }

  const pooled = (a.conversions + b.conversions) / (a.total + b.total || 1)
  const standardError = Math.sqrt(
    pooled * (1 - pooled) * (1 / (a.total || 1) + 1 / (b.total || 1))
  )
  const z = standardError > 0 ? (rateB - rateA) / standardError : 0
  const pValue = 2 * (1 - normalCdf(Math.abs(z)))

  const alpha = 1 - confidence
  // Guard against the degenerate cases: no data, or no observed difference.
  const significant =
    a.total > 0 && b.total > 0 && standardError > 0 && pValue < alpha

  // Required n per arm for the observed effect, at this confidence and 80% power.
  const delta = Math.abs(rateB - rateA)
  const variance = rateA * (1 - rateA) + rateB * (1 - rateB)
  const sampleNeededPerArm =
    delta > 0 && variance > 0 ? Math.ceil((7.849 * variance) / (delta * delta)) : null

  let verdict: string
  if (a.total === 0 || b.total === 0) {
    verdict = "One arm has no data, so there is nothing to compare."
  } else if (significant) {
    const better = rateB > rateA ? b.label : a.label
    verdict =
      `${better} is genuinely better at ${Math.round(confidence * 100)}% confidence ` +
      `(p = ${pValue.toFixed(4)}).`
  } else if (sampleNeededPerArm) {
    verdict =
      `Not distinguishable at this volume (p = ${pValue.toFixed(3)}). ` +
      `Detecting a difference this size needs roughly ${sampleNeededPerArm.toLocaleString()} per arm; ` +
      `you have ${a.total.toLocaleString()} and ${b.total.toLocaleString()}. Do not call a winner.`
  } else {
    verdict = "The rates are identical, so there is no difference to test."
  }

  return {
    a: armA,
    b: armB,
    absoluteDifference: (rateB - rateA) * 100,
    relativeLift: rateA > 0 ? ((rateB - rateA) / rateA) * 100 : null,
    pValue,
    significant,
    confidence,
    sampleNeededPerArm,
    verdict,
  }
}

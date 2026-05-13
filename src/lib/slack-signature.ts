/**
 * Slack Request Signature Verification
 *
 * Slack signs every request with HMAC-SHA256 using your app's signing secret.
 * We verify the signature before processing the body — this stops anyone
 * who finds your public endpoint URL from forging events, slash commands,
 * or button clicks.
 *
 * Setup:
 *   1. Go to api.slack.com → Your App → Basic Information → App Credentials
 *   2. Copy "Signing Secret"
 *   3. Set SLACK_SIGNING_SECRET in your environment
 *
 * See: https://api.slack.com/authentication/verifying-requests-from-slack
 */

import { createHmac, timingSafeEqual } from "crypto"

const SIGNATURE_VERSION = "v0"
const REPLAY_WINDOW_SECONDS = 60 * 5 // Reject requests older than 5 minutes

export interface SignatureVerificationResult {
  ok: boolean
  reason?: string
}

/**
 * Verify a Slack request signature against the raw body.
 *
 * IMPORTANT: must be called with the EXACT raw request body. If you call
 * `req.json()` first the body is consumed and verification will fail.
 */
export function verifySlackSignature(
  rawBody: string,
  timestamp: string | null,
  signature: string | null
): SignatureVerificationResult {
  const secret = process.env.SLACK_SIGNING_SECRET
  if (!secret) {
    return { ok: false, reason: "SLACK_SIGNING_SECRET not configured" }
  }
  if (!timestamp || !signature) {
    return { ok: false, reason: "Missing signature headers" }
  }

  const ts = parseInt(timestamp, 10)
  if (!Number.isFinite(ts)) {
    return { ok: false, reason: "Invalid timestamp" }
  }
  const nowSeconds = Math.floor(Date.now() / 1000)
  if (Math.abs(nowSeconds - ts) > REPLAY_WINDOW_SECONDS) {
    return { ok: false, reason: "Timestamp outside replay window" }
  }

  const base = `${SIGNATURE_VERSION}:${ts}:${rawBody}`
  const expected = `${SIGNATURE_VERSION}=${createHmac("sha256", secret).update(base).digest("hex")}`

  if (signature.length !== expected.length) {
    return { ok: false, reason: "Signature length mismatch" }
  }
  const sigBuf = Buffer.from(signature)
  const expectedBuf = Buffer.from(expected)
  if (!timingSafeEqual(sigBuf, expectedBuf)) {
    return { ok: false, reason: "Signature mismatch" }
  }

  return { ok: true }
}

let warnedAboutMissingSecret = false

/**
 * Convenience wrapper: read the raw body, pull the headers, verify.
 * Returns the verified raw body string so the caller can parse it.
 *
 * Behavior:
 *  - SLACK_SIGNING_SECRET set: verification is strictly enforced.
 *  - SLACK_SIGNING_SECRET unset: in development, a loud warning is logged
 *    and the request is allowed (so first-time setup is not blocked). In
 *    production, the request is rejected.
 *
 * Returns { rawBody } on success or { error, status } on failure.
 */
export async function readVerifiedSlackBody(
  req: Request
): Promise<{ rawBody: string } | { error: string; status: number }> {
  const rawBody = await req.text()
  const secret = process.env.SLACK_SIGNING_SECRET

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      console.error(
        "[Slack Signature] SLACK_SIGNING_SECRET is not set in production. Rejecting request."
      )
      return { error: "signing_secret_not_configured", status: 500 }
    }
    if (!warnedAboutMissingSecret) {
      console.warn(
        "[Slack Signature] SLACK_SIGNING_SECRET is not set — allowing unsigned requests in development. Set this before deploying to production. See docs/security.md."
      )
      warnedAboutMissingSecret = true
    }
    return { rawBody }
  }

  const timestamp = req.headers.get("x-slack-request-timestamp")
  const signature = req.headers.get("x-slack-signature")
  const result = verifySlackSignature(rawBody, timestamp, signature)
  if (!result.ok) {
    console.warn("[Slack Signature] Rejected:", result.reason)
    return { error: "invalid_signature", status: 401 }
  }
  return { rawBody }
}

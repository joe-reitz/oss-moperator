/**
 * PKCE (RFC 7636) helpers for the Salesforce OAuth flow.
 *
 * Salesforce Connected Apps with "Require Proof Key for Code Exchange"
 * enabled reject authorize requests unless they include a `code_challenge`.
 * We generate the verifier/challenge here, persist the verifier server-side
 * keyed by `state`, then pass the verifier to the token exchange in the
 * callback.
 */
import { createHash, randomBytes } from "crypto"

function base64Url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export interface PkcePair {
  verifier: string
  challenge: string
}

export function generatePkce(): PkcePair {
  const verifier = base64Url(randomBytes(64))
  const challenge = base64Url(createHash("sha256").update(verifier).digest())
  return { verifier, challenge }
}

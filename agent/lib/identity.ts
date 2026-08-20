/**
 * Caller identity, resolved once at the channel boundary.
 *
 * Every authorization decision in this agent keys off the caller's email — the
 * same `AUTHORIZED_USER_EMAILS` list that gates the admin pages. Resolving it at
 * the boundary and stamping it onto the session auth is what lets the approval
 * policies in `./approval.ts` stay pure: they read an attribute rather than
 * calling Slack mid-turn.
 *
 * eve's `attributes` bag only holds strings, so the helper below drops undefined
 * values and stringifies the approver flags. Those flags are a convenience for
 * rendering ("you can approve this") — never the authorization check itself,
 * which always re-derives from the email against the current config.
 */

/** eve's session-auth attribute bag: strings only, no undefined. */
export type AuthAttributes = Readonly<Record<string, string | readonly string[]>>

/**
 * Build an attribute bag, dropping keys whose value is undefined and coercing
 * booleans to "true" / "false".
 */
export function authAttributes(
  input: Record<string, string | boolean | readonly string[] | undefined>
): AuthAttributes {
  const attributes: Record<string, string | readonly string[]> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue
    attributes[key] = typeof value === "boolean" ? String(value) : value
  }
  return attributes
}

/** Read the caller's email back out of a session-auth attribute bag. */
export function emailFromAttributes(
  attributes: AuthAttributes | undefined
): string | undefined {
  const email = attributes?.email
  return typeof email === "string" && email.length > 0 ? email : undefined
}

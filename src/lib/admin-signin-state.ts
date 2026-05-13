/**
 * Shared constants for the admin sign-in OAuth flow.
 *
 * Kept in a non-route file so both the start and callback routes can
 * import it without violating Next.js's "only route handlers in route.ts"
 * convention.
 */

export const ADMIN_SIGNIN_STATE_COOKIE = "moperator_admin_state"
export const ADMIN_SIGNIN_STATE_TTL_MS = 1000 * 60 * 10 // 10 minutes

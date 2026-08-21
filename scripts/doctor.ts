#!/usr/bin/env node
/**
 * `npm run agent:doctor` — does each integration actually work?
 *
 * `agent:info` answers a different question: what did the framework discover on
 * disk, and which env vars are set. That is necessary and not sufficient. An env
 * var being present does not mean the credential is valid, that the token has
 * the scopes the agent needs, or that the account can see anything.
 *
 * This makes one cheap, read-only call per integration and reports what came
 * back. It exists because the worst setup failures here are silent:
 *
 *   - A Slack bot without `users:read.email` resolves nobody's email, so every
 *     caller is treated as a non-approver *and* every Salesforce write is
 *     refused for lack of attribution. Nothing looks misconfigured.
 *   - An expired Salesforce token surfaces as "query failed" mid-conversation.
 *   - An empty AUTHORIZED_USER_EMAILS means every write needs approval and
 *     nobody can grant one — a working agent that can never change anything.
 *
 * Read-only by design: no writes, no sends, nothing that costs money. Safe to
 * run against production.
 */

import { config } from "../agent/lib/config"
import { INTEGRATIONS, isConfigured, missingEnv } from "../agent/lib/integrations"

type Status = "ok" | "warn" | "fail" | "skip"

interface Result {
  name: string
  status: Status
  detail: string
  /** What to do about it, when there is something to do. */
  fix?: string
}

const results: Result[] = []

function record(
  name: string,
  status: Status,
  detail: string,
  fix?: string
): void {
  results.push({ name, status, detail, fix })
}

/** Run a probe, turning any throw into a failure line rather than a stack trace. */
async function probe(
  name: string,
  run: () => Promise<Omit<Result, "name">>
): Promise<void> {
  try {
    const outcome = await run()
    record(name, outcome.status, outcome.detail, outcome.fix)
  } catch (error) {
    record(
      name,
      "fail",
      error instanceof Error ? error.message.slice(0, 300) : String(error)
    )
  }
}

// ─── Model ───────────────────────────────────────────────────────────────────

async function checkModel(): Promise<void> {
  await probe("Model", async () => {
    const key = process.env.AI_GATEWAY_API_KEY
    const oidc = process.env.VERCEL_OIDC_TOKEN
    const model = process.env.AI_MODEL || "anthropic/claude-opus-4.8"

    if (!key && !oidc) {
      return {
        status: "fail",
        detail: "no AI Gateway credential",
        fix: "Set AI_GATEWAY_API_KEY, or run `npx eve link` to pull a Vercel OIDC token.",
      }
    }

    // Ask the gateway for its model catalog: cheap, and it validates the key.
    const response = await fetch("https://ai-gateway.vercel.sh/v1/models", {
      headers: { authorization: `Bearer ${key || oidc}` },
    })
    if (!response.ok) {
      return {
        status: "fail",
        detail: `AI Gateway returned ${response.status}`,
        fix:
          response.status === 401
            ? "The credential is invalid or expired."
            : undefined,
      }
    }

    const data = (await response.json()) as { data?: Array<{ id?: string }> }
    const ids = new Set((data.data ?? []).map((entry) => entry.id))
    if (ids.size > 0 && !ids.has(model)) {
      return {
        status: "warn",
        detail: `credential works, but "${model}" is not in the catalog`,
        fix: "Check AI_MODEL against https://vercel.com/ai-gateway/models.",
      }
    }
    return { status: "ok", detail: `${model} reachable via AI Gateway` }
  })
}

// ─── Approvals ───────────────────────────────────────────────────────────────

function checkApprovers(): void {
  if (config.approvers.writes.length === 0) {
    record(
      "Approvers",
      "fail",
      "AUTHORIZED_USER_EMAILS is empty",
      "Every write will need approval and nobody can grant one. Set it to at least your own email."
    )
    return
  }

  const spendOnly = config.approvers.spend.filter(
    (email) => !config.approvers.writes.includes(email)
  )
  record(
    "Approvers",
    "ok",
    `${config.approvers.writes.length} write approver(s)` +
      (spendOnly.length > 0 ? `, ${spendOnly.length} spend-only` : "") +
      `; bulk review over ${config.limits.bulkApprovalThreshold}, hard cap ${config.limits.bulkMax}`
  )
}

function checkBrowserAuth(): void {
  const secret = process.env.MOPERATOR_SESSION_SECRET
  if (!secret) {
    record(
      "Browser sign-in",
      "warn",
      "MOPERATOR_SESSION_SECRET is not set",
      "/chat, /console, /analytics, and /audience-vocab will refuse to load. Generate: openssl rand -hex 32"
    )
    return
  }
  if (secret.length < 32) {
    record(
      "Browser sign-in",
      "fail",
      "MOPERATOR_SESSION_SECRET is shorter than 32 characters",
      "Generate a real one: openssl rand -hex 32"
    )
    return
  }
  if (!process.env.SLACK_CLIENT_ID || !process.env.SLACK_CLIENT_SECRET) {
    record(
      "Browser sign-in",
      "warn",
      "session secret set, but no Slack OAuth client",
      "Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET so people can sign in to the admin pages."
    )
    return
  }
  record("Browser sign-in", "ok", "session secret and Slack OAuth client present")
}

// ─── Slack ───────────────────────────────────────────────────────────────────

async function checkSlack(): Promise<void> {
  await probe("Slack", async () => {
    if (process.env.MOPERATOR_SLACK_CONNECTOR) {
      return {
        status: "skip",
        detail: `managed by Vercel Connect (${process.env.MOPERATOR_SLACK_CONNECTOR}) — token not in this environment`,
      }
    }

    const token = process.env.SLACK_BOT_TOKEN
    if (!token) {
      return {
        status: "skip",
        detail: "not configured (no SLACK_BOT_TOKEN, no Connect connector)",
      }
    }

    const auth = (await (
      await fetch("https://slack.com/api/auth.test", {
        headers: { authorization: `Bearer ${token}` },
      })
    ).json()) as { ok?: boolean; error?: string; team?: string; user?: string }

    if (!auth.ok) {
      return {
        status: "fail",
        detail: `auth.test failed: ${auth.error}`,
        fix:
          auth.error === "invalid_auth"
            ? "The bot token is wrong or has been revoked. Reinstall the app and copy the Bot User OAuth Token."
            : undefined,
      }
    }

    // The scope that fails silently and breaks everything downstream. Probing it
    // needs a real user id, so read the bot's own profile — same scope gate.
    const scopeProbe = (await (
      await fetch(
        `https://slack.com/api/users.info?user=${encodeURIComponent(auth.user ?? "")}`,
        { headers: { authorization: `Bearer ${token}` } }
      )
    ).json()) as { ok?: boolean; error?: string }

    if (!scopeProbe.ok && scopeProbe.error === "missing_scope") {
      return {
        status: "fail",
        detail: `connected to ${auth.team} as ${auth.user}, but cannot read user profiles`,
        fix:
          "Add the users:read and users:read.email scopes and reinstall. Without them nobody's email resolves, so every caller is a non-approver and every Salesforce write is refused for lack of attribution.",
      }
    }

    return {
      status: "ok",
      detail: `connected to ${auth.team} as ${auth.user}, profile scopes present`,
    }
  })
}

// ─── Integrations ────────────────────────────────────────────────────────────

async function checkSalesforce(): Promise<void> {
  if (!isConfigured("salesforce")) {
    record("Salesforce", "skip", `not configured (${missingEnv("salesforce").join(", ")})`)
    return
  }

  await probe("Salesforce", async () => {
    const sf = await import("../agent/lib/salesforce/client")
    const global = await sf.describeGlobal()
    const count = (global.sobjects as unknown[]).length

    const mode = config.salesforce.identity
    if (mode === "service") {
      return {
        status: "warn",
        detail: `${count} objects visible; SFDC_IDENTITY=service`,
        fix: "Every change will be recorded as the service account, not the person who asked. Consider SFDC_IDENTITY=user.",
      }
    }

    // Per-user identity has prerequisites; without them writes are refused.
    const missing: string[] = []
    if (!process.env.SALESFORCE_CLIENT_ID || !process.env.SALESFORCE_CLIENT_SECRET) {
      missing.push("SALESFORCE_CLIENT_ID/SECRET")
    }
    if (!process.env.MOPERATOR_TOKEN_ENCRYPTION_KEY) {
      missing.push("MOPERATOR_TOKEN_ENCRYPTION_KEY")
    }
    if (!process.env.UPSTASH_REDIS_REST_URL && !process.env.KV_REST_API_URL) {
      missing.push("UPSTASH_REDIS_REST_URL")
    }

    if (missing.length > 0) {
      return {
        status: "fail",
        detail: `${count} objects visible, but SFDC_IDENTITY=${mode} is missing ${missing.join(", ")}`,
        fix: "Writes will be refused until these are set. Or set SFDC_IDENTITY=service to accept service-account attribution.",
      }
    }

    return {
      status: "ok",
      detail: `${count} objects visible; writes attributed per-user (SFDC_IDENTITY=${mode})`,
    }
  })
}

async function checkHubspot(): Promise<void> {
  if (!isConfigured("hubspot")) {
    record("HubSpot", "skip", "not configured")
    return
  }
  await probe("HubSpot", async () => {
    const response = await fetch(
      "https://api.hubapi.com/crm/v3/objects/contacts?limit=1",
      { headers: { authorization: `Bearer ${process.env.HUBSPOT_API_TOKEN}` } }
    )
    if (!response.ok) {
      const body = await response.text()
      return {
        status: "fail",
        detail: `${response.status}: ${body.slice(0, 160)}`,
        fix:
          response.status === 401
            ? "The private app token is invalid or expired."
            : response.status === 403
              ? "The token is valid but lacks the crm.objects.contacts.read scope."
              : undefined,
      }
    }
    return { status: "ok", detail: "contacts readable" }
  })
}

async function checkMarketo(): Promise<void> {
  if (!isConfigured("marketo")) {
    record("Marketo", "skip", "not configured")
    return
  }
  await probe("Marketo", async () => {
    const endpoint = process.env.MARKETO_REST_ENDPOINT!.replace(/\/$/, "")
    const url =
      `${endpoint}/identity/oauth/token?grant_type=client_credentials` +
      `&client_id=${encodeURIComponent(process.env.MARKETO_CLIENT_ID!)}` +
      `&client_secret=${encodeURIComponent(process.env.MARKETO_CLIENT_SECRET!)}`
    const response = await fetch(url)
    const data = (await response.json()) as { access_token?: string; error?: string }
    if (!data.access_token) {
      return {
        status: "fail",
        detail: data.error ?? `token request returned ${response.status}`,
        fix: "Check the LaunchPoint client id/secret and that the REST endpoint host is right.",
      }
    }
    return { status: "ok", detail: "OAuth token issued" }
  })
}

/**
 * These three go through the real client rather than a hand-rolled fetch.
 *
 * That is deliberate: it means `agent:doctor` exercises the same base-URL,
 * region and error-mapping code the tools use, so a wrong host or a
 * misread region shows up here instead of mid-conversation.
 */
async function checkCustomerio(): Promise<void> {
  if (!isConfigured("customerio")) {
    record("Customer.io", "skip", "not configured")
    return
  }
  await probe("Customer.io", async () => {
    const cio = await import("../agent/lib/customerio/client")
    await cio.ping()

    const hasTrack =
      !!process.env.CUSTOMERIO_SITE_ID && !!process.env.CUSTOMERIO_TRACK_API_KEY

    return hasTrack
      ? { status: "ok", detail: "App API readable; Track API credentials present" }
      : {
          status: "warn",
          detail: "App API readable, but no Track API credentials",
          fix: "Reads and transactional sends work. Writing people, recording events, and changing manual segment membership need CUSTOMERIO_SITE_ID and CUSTOMERIO_TRACK_API_KEY.",
        }
  })
}

async function checkIterable(): Promise<void> {
  if (!isConfigured("iterable")) {
    record("Iterable", "skip", "not configured")
    return
  }
  await probe("Iterable", async () => {
    const it = await import("../agent/lib/iterable/client")
    const lists = (await it.ping()) as { lists?: unknown[] }
    const count = Array.isArray(lists?.lists) ? lists.lists.length : undefined

    // An empty list set on a valid key usually means the key belongs to a
    // different project, which authenticates fine and sees nothing.
    if (count === 0) {
      return {
        status: "warn",
        detail: "authenticated, but the project has no lists",
        fix: "If you expected lists here, the key may belong to another Iterable project — keys are project-scoped.",
      }
    }
    return {
      status: "ok",
      detail: count === undefined ? "lists readable" : `${count} lists readable`,
    }
  })
}

async function checkInflection(): Promise<void> {
  if (!isConfigured("inflection")) {
    record("Inflection", "skip", "not configured")
    return
  }
  await probe("Inflection", async () => {
    const inf = await import("../agent/lib/inflection/client")
    await inf.ping()
    return { status: "ok", detail: "contacts readable" }
  })
}

async function checkGoogleAds(): Promise<void> {
  if (!isConfigured("google_ads")) {
    record("Google Ads", "skip", "not configured")
    return
  }
  // A real GAQL call needs a refreshed access token, which is the part that
  // usually breaks — so check the refresh grant rather than the env vars.
  await probe("Google Ads", async () => {
    if (!process.env.GOOGLE_ADS_REFRESH_TOKEN) {
      return {
        status: "fail",
        detail: "no refresh token",
        fix: "Complete the OAuth flow and set GOOGLE_ADS_REFRESH_TOKEN.",
      }
    }
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
        client_id: process.env.GOOGLE_ADS_CLIENT_ID!,
        client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!,
      }),
    })
    const data = (await response.json()) as {
      access_token?: string
      error_description?: string
      error?: string
    }
    if (!data.access_token) {
      return {
        status: "fail",
        detail: data.error_description ?? data.error ?? "token refresh failed",
        fix: "Re-run the OAuth consent flow; a refresh token can be revoked or expire.",
      }
    }
    return {
      status: "ok",
      detail: `token refreshed for customer ${process.env.GOOGLE_ADS_CUSTOMER_ID}`,
    }
  })
}

async function checkTracker(): Promise<void> {
  const { activeProviders, resolveProvider } = await import("../agent/lib/trackers")
  const active = activeProviders()

  if (active.length === 0) {
    record("Project tracker", "skip", "none configured")
    return
  }

  for (const provider of active) {
    await probe(`Tracker: ${provider.name}`, async () => {
      const projects = await provider.listProjects()
      const isDefault = resolveProvider().id === provider.id
      return {
        status: "ok",
        detail:
          `${projects.length} ${provider.projectNoun}(s) visible` +
          (active.length > 1 ? (isDefault ? " — default" : "") : ""),
      }
    })
  }

  if (active.length > 1 && !process.env.MOPERATOR_TRACKER) {
    record(
      "Project tracker",
      "warn",
      `${active.length} trackers configured with no default named`,
      "Set MOPERATOR_TRACKER so the choice is explicit rather than registry order."
    )
  }
}

async function checkKnak(): Promise<void> {
  if (!isConfigured("knak")) {
    record("Knak", "skip", "not configured")
    return
  }
  await probe("Knak", async () => {
    const knak = await import("../agent/lib/knak/client")
    const brands = await knak.listBrands()
    const themes = await knak.listThemes()

    if (config.knak.defaultBrand && config.knak.folderPath.length > 0) {
      const { folderId, error } = await knak.resolveFolderPath(config.knak.defaultBrand, [
        ...config.knak.folderPath,
      ])
      if (!folderId) {
        return {
          status: "fail",
          detail: `${brands.length} brand(s), but the default folder does not resolve: ${error}`,
          fix: "Fix KNAK_DEFAULT_BRAND / KNAK_FOLDER_PATH.",
        }
      }
    }
    return {
      status: "ok",
      detail: `${brands.length} brand(s), ${themes.length} theme(s)`,
    }
  })
}

async function checkGithub(): Promise<void> {
  if (!isConfigured("github")) {
    record("GitHub", "skip", "not configured")
    return
  }
  await probe("GitHub", async () => {
    const response = await fetch(
      `https://api.github.com/repos/${process.env.GITHUB_REPO}`,
      {
        headers: {
          authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          accept: "application/vnd.github+json",
        },
      }
    )
    if (!response.ok) {
      return {
        status: "fail",
        detail: `${response.status} on ${process.env.GITHUB_REPO}`,
        fix:
          response.status === 404
            ? "Either the repo name is wrong or the token cannot see it."
            : "Check the token's repo read scope.",
      }
    }
    return { status: "ok", detail: `${process.env.GITHUB_REPO} readable` }
  })
}

async function checkLuma(): Promise<void> {
  if (!isConfigured("luma")) {
    record("Luma", "skip", "not configured")
    return
  }
  await probe("Luma", async () => {
    const response = await fetch("https://public-api.luma.com/v1/calendar/get", {
      headers: { "x-luma-api-key": process.env.LUMA_API_KEY! },
    })
    if (!response.ok) {
      return {
        status: "fail",
        detail: `calendar/get returned ${response.status}`,
        fix:
          response.status === 401
            ? "The API key is wrong, or the calendar is not on a plan with API access."
            : undefined,
      }
    }
    return { status: "ok", detail: "calendar reachable" }
  })
}

async function checkRedis(): Promise<void> {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL
  if (!url) {
    record(
      "Redis",
      "warn",
      "not configured",
      "Analytics, saved console queries, the audience vocabulary, and per-user Salesforce grants all need it. Approvals do not."
    )
    return
  }
  await probe("Redis", async () => {
    const { getRedis } = await import("../agent/lib/redis")
    const redis = getRedis()
    if (!redis) return { status: "fail", detail: "client would not initialize" }
    await redis.ping()
    return { status: "ok", detail: "reachable" }
  })
}

// ─── Report ──────────────────────────────────────────────────────────────────

const GLYPH: Record<Status, string> = { ok: "✓", warn: "!", fail: "✗", skip: "·" }
const COLOR: Record<Status, string> = {
  ok: "[32m",
  warn: "[33m",
  fail: "[31m",
  skip: "[90m",
}
const RESET = "[0m"

async function main(): Promise<void> {
  // `eve dev` loads .env.local automatically; a bare script does not.
  const { existsSync } = await import("node:fs")
  for (const file of [".env.local", ".env"]) {
    if (existsSync(file)) {
      process.loadEnvFile(file)
      break
    }
  }

  console.log(`\n${config.botName} doctor — read-only checks\n`)

  await checkModel()
  checkApprovers()
  checkBrowserAuth()
  await checkSlack()
  await checkRedis()
  await checkSalesforce()
  await checkHubspot()
  await checkMarketo()
  await checkCustomerio()
  await checkIterable()
  await checkInflection()
  await checkGoogleAds()
  await checkTracker()
  await checkKnak()
  await checkGithub()
  await checkLuma()

  const width = Math.max(...results.map((result) => result.name.length))
  for (const result of results) {
    const glyph = `${COLOR[result.status]}${GLYPH[result.status]}${RESET}`
    console.log(`${glyph} ${result.name.padEnd(width)}  ${result.detail}`)
    if (result.fix) {
      console.log(`  ${" ".repeat(width)}  ${COLOR.warn}→ ${result.fix}${RESET}`)
    }
  }

  const failed = results.filter((result) => result.status === "fail")
  const warned = results.filter((result) => result.status === "warn")
  const configured = INTEGRATIONS.filter((entry) => isConfigured(entry.id)).length

  console.log(
    `\n${configured} of ${INTEGRATIONS.length} integrations configured. ` +
      `${failed.length} problem(s), ${warned.length} warning(s).`
  )

  if (failed.length > 0) {
    console.log("\nFix the ✗ lines before expecting the agent to work.\n")
    process.exitCode = 1
  } else {
    console.log("")
  }
}

void main()

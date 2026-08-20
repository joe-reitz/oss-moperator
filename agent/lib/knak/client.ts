/**
 * Knak Enterprise API client.
 *
 * Knak is a no-code email and landing-page builder that generates on-brand
 * assets from a prompt using your own design system, then syncs them to your
 * marketing automation platform. The agent's job is to hand it a well-formed
 * brief and report back the asset — not to write HTML.
 *
 * REST only, authenticated with a permanent `KNAK_API_KEY`. Knak also exposes an
 * MCP server behind OAuth; this deliberately does not use it, for two reasons:
 * the OAuth token expires and needs re-authorizing per deployment URL, and
 * assets end up "created by" whoever last authorized rather than by a stable
 * service identity. A service API key is the right shape for a shared bot.
 *
 * Two Knak vocabulary quirks worth internalizing:
 *
 *   - A "campaign" in the generate API is an **asset folder**. The API wants its
 *     id, humans say its name, and folders nest — so name resolution walks the
 *     tree rather than doing one lookup.
 *   - The REST API returns no web URL for an asset. The builder link is derived
 *     from the asset id.
 *
 * Base URL and auth per Knak's OpenAPI spec:
 * https://developer.knak.com/openapi/openapi.yml
 */

const DEFAULT_BASE = "https://enterprise.knak.io/api/published/v1"
const DEFAULT_APP = "https://enterprise.knak.io"

function base(): string {
  return (process.env.KNAK_API_URL || DEFAULT_BASE).replace(/\/$/, "")
}

function apiKey(): string {
  const key = process.env.KNAK_API_KEY
  if (!key) {
    throw new Error("Knak is not configured: set KNAK_API_KEY. See docs/setup-knak.md.")
  }
  return key
}

/** Web link to open an asset in the Knak builder. */
export function knakAssetUrl(assetId: string): string {
  const app = (process.env.KNAK_APP_URL || DEFAULT_APP).replace(/\/$/, "")
  return `${app}/builder/${assetId}`
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface KnakBrand {
  id: string
  name: string
}

/** A "campaign" in the generate API is an asset folder, and folders nest. */
export interface KnakFolder {
  id: string
  name: string
  brandId?: string
  parentFolderId?: string | null
}

export interface KnakTheme {
  id: string
  name: string
  published?: boolean
}

export interface KnakAsset {
  id: string
  name?: string
  subject?: string
  campaign?: string
  brand?: string
  folder_path?: string
  /** "started" right after generate; poll until it leaves the in-progress set. */
  ai_generation_status?: string
  [key: string]: unknown
}

/** Rendered content from GET /assets/{id}/content. */
export interface KnakAssetContent {
  id: string
  name: string
  subject: string
  type: "email" | "landing"
  html: string
  text?: string
  from_name?: string
  from_email?: string
  reply_email?: string
  folder_path?: string
  campaign?: string
  brand?: string
}

export interface GenerateAssetInput {
  prompt: string
  campaign_id: string
  type?: "email"
  name?: string
  theme_id?: string
  subject?: string
  from_name?: string
  from_email?: string
  reply_email?: string
  tags?: string[]
}

// ─── Transport ───────────────────────────────────────────────────────────────

async function knak<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${apiKey()}`,
    accept: "application/json",
  }
  if (body !== undefined) headers["content-type"] = "application/json"

  const response = await fetch(`${base()}/${path.replace(/^\//, "")}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const text = await response.text()
  if (!response.ok) {
    throw new Error(
      `Knak ${method} /${path.split("?")[0]} failed (${response.status}): ${text.slice(0, 400)}`
    )
  }
  return (text ? JSON.parse(text) : {}) as T
}

/** Knak wraps resources as `{ data: { id, attributes } }`; flatten to one object. */
function flatten(
  data: { id?: string; attributes?: Record<string, unknown> } | undefined,
  fallbackId = ""
): KnakAsset {
  const attributes = data?.attributes ?? {}
  return { ...attributes, id: String(data?.id ?? attributes.id ?? fallbackId) } as KnakAsset
}

export function isKnakConfigured(): boolean {
  return !!process.env.KNAK_API_KEY
}

// ─── Browse ──────────────────────────────────────────────────────────────────

export async function listBrands(): Promise<KnakBrand[]> {
  const json = await knak<{ data?: Array<Record<string, unknown>> }>(
    "GET",
    "brands?per_page=100"
  )
  return (json.data ?? [])
    .map((entry) => {
      const attributes = (entry.attributes ?? {}) as Record<string, unknown>
      return {
        id: String(entry.id ?? attributes.id ?? ""),
        name: String(entry.name ?? attributes.name ?? ""),
      }
    })
    .filter((brand) => brand.id && brand.name)
}

/**
 * List asset folders. Scope to a brand, and/or to a parent folder.
 *
 * The brand-scoped list returns *top-level* folders only. Nested folders are
 * reached by passing `parentFolderId` — which is why `resolveFolderPath` exists.
 */
export async function listFolders(
  opts: { brandId?: string; parentFolderId?: string } = {}
): Promise<KnakFolder[]> {
  const query = new URLSearchParams({ per_page: "100" })
  if (opts.brandId) query.set("filter[brand_id]", opts.brandId)
  if (opts.parentFolderId) query.set("filter[parent_folder_id]", opts.parentFolderId)

  const json = await knak<{
    data?: Array<{ id?: string; attributes?: Record<string, unknown> }>
  }>("GET", `asset-folders?${query}`)

  return (json.data ?? [])
    .map((entry) => {
      const attributes = (entry.attributes ?? {}) as Record<string, unknown>
      return {
        id: String(entry.id ?? attributes.id ?? ""),
        name: String(attributes.name ?? ""),
        brandId: attributes.brand_id ? String(attributes.brand_id) : undefined,
        parentFolderId: (attributes.parent_folder_id as string | null | undefined) ?? null,
      }
    })
    .filter((folder) => folder.id && folder.name)
}

export async function listThemes(): Promise<KnakTheme[]> {
  const json = await knak<{
    data?: Array<{ id?: string; attributes?: Record<string, unknown> }>
  }>("GET", "themes?per_page=100")

  return (json.data ?? [])
    .map((entry) => {
      const attributes = (entry.attributes ?? {}) as Record<string, unknown>
      return {
        id: String(entry.id ?? attributes.id ?? ""),
        name: String(attributes.name ?? ""),
        published: Boolean(attributes.published),
      }
    })
    .filter((theme) => theme.id && theme.name)
}

export async function getAsset(assetId: string): Promise<KnakAsset> {
  const json = await knak<{ data?: { id?: string; attributes?: Record<string, unknown> } }>(
    "GET",
    `assets/${encodeURIComponent(assetId)}`
  )
  return flatten(json.data, assetId)
}

/** Rendered HTML and metadata — the input to any email QA pass. */
export async function getAssetContent(assetId: string): Promise<KnakAssetContent> {
  const json = await knak<{ data?: { attributes?: KnakAssetContent } }>(
    "GET",
    `assets/${encodeURIComponent(assetId)}/content`
  )
  const attributes = json?.data?.attributes
  if (!attributes || typeof attributes.html !== "string") {
    throw new Error("Knak content response is missing data.attributes.html")
  }
  return attributes
}

// ─── Resolution ──────────────────────────────────────────────────────────────

/**
 * Resolve a folder by walking a path under a brand, e.g. brand "Acme" with
 * `["Campaigns", "Lifecycle"]`.
 *
 * Necessary because the brand-scoped folder list is top-level only, and because
 * the id in a Knak UI URL is not the API id. On a miss the error names what was
 * actually present at that level, which turns a silent failure into a fixable one.
 */
export async function resolveFolderPath(
  brandName: string,
  segments: string[]
): Promise<{ folderId?: string; brandId?: string; error?: string }> {
  const brands = await listBrands()
  const brand = brands.find(
    (candidate) => candidate.name.toLowerCase() === brandName.toLowerCase()
  )
  if (!brand) {
    const seen = brands.map((b) => b.name).slice(0, 15).join(", ") || "(none)"
    return { error: `Brand "${brandName}" not found in Knak. Brands available: ${seen}` }
  }

  let parentFolderId: string | undefined
  let folderId: string | undefined

  for (const [index, segment] of segments.entries()) {
    const folders = await listFolders({ brandId: brand.id, parentFolderId })
    const match = folders.find(
      (folder) => folder.name.toLowerCase() === segment.toLowerCase()
    )
    if (!match) {
      const where = [brandName, ...segments.slice(0, index)].join("/")
      const seen = folders.map((f) => f.name).slice(0, 15).join(", ") || "(none)"
      return {
        brandId: brand.id,
        error: `Folder "${segment}" not found under ${where}. Folders there: ${seen}`,
      }
    }
    parentFolderId = match.id
    folderId = match.id
  }

  return { folderId, brandId: brand.id }
}

/**
 * Resolve a campaign (folder) id from a human name, optionally narrowed by
 * brand. Matches top-level folders; use `resolveFolderPath` for nested ones.
 */
export async function resolveCampaignId(
  campaignName: string,
  opts: { brandName?: string } = {}
): Promise<{ campaignId?: string; brandId?: string; error?: string }> {
  let brandId: string | undefined

  if (opts.brandName) {
    const brands = await listBrands()
    const brand = brands.find(
      (candidate) => candidate.name.toLowerCase() === opts.brandName!.toLowerCase()
    )
    if (!brand) return { error: `Brand "${opts.brandName}" not found in Knak.` }
    brandId = brand.id
  }

  const folders = await listFolders(brandId ? { brandId } : {})
  const match = folders.find(
    (folder) => folder.name.toLowerCase() === campaignName.toLowerCase()
  )
  if (!match) {
    const seen = folders.map((f) => f.name).slice(0, 15).join(", ") || "(none)"
    return {
      brandId,
      error: `Campaign "${campaignName}" not found${
        brandId ? " in that brand" : ""
      }. Campaigns there: ${seen}`,
    }
  }
  return { campaignId: match.id, brandId }
}

/**
 * Resolve a theme id. Themes are the brand design system an email is generated
 * against, and the id in a Knak UI URL is not the API id — so selection is by
 * stable name:
 *
 *   1. an explicit id wins
 *   2. a `template` mentioning "newsletter" selects the newsletter theme
 *   3. otherwise the configured default theme
 *
 * Returns undefined when nothing matches, so the caller omits `theme_id` and
 * Knak falls back to the brand's own default rather than failing.
 */
export async function resolveThemeId(
  input: { themeId?: string; template?: string } = {}
): Promise<string | undefined> {
  if (input.themeId) return input.themeId

  const wantsNewsletter = !!input.template && /newsletter/i.test(input.template)

  // An explicit default id short-circuits the lookup entirely.
  if (!wantsNewsletter && process.env.KNAK_DEFAULT_THEME_ID) {
    return process.env.KNAK_DEFAULT_THEME_ID
  }

  const target = wantsNewsletter
    ? process.env.KNAK_NEWSLETTER_THEME_NAME
    : process.env.KNAK_DEFAULT_THEME_NAME
  if (!target) return undefined

  try {
    const themes = await listThemes()
    const needle = target.toLowerCase()
    return (
      themes.find((theme) => theme.name.toLowerCase() === needle)?.id ??
      themes.find((theme) => theme.name.toLowerCase().includes(needle))?.id
    )
  } catch {
    // A theme lookup failure should not block generation.
    return undefined
  }
}

// ─── Generation ──────────────────────────────────────────────────────────────

export async function generateAsset(input: GenerateAssetInput): Promise<KnakAsset> {
  const json = await knak<{ data?: { id?: string; attributes?: Record<string, unknown> } }>(
    "POST",
    "assets/generate",
    { type: "email", ...input }
  )
  return flatten(json.data)
}

export interface PollResult {
  done: boolean
  failed: boolean
  status?: string
  asset?: KnakAsset
  /** Knak's own failure reason, when it gave one. */
  reason?: string
}

const IN_PROGRESS = new Set(["started", "pending", "generating", "in_progress", "processing"])

/**
 * Knak attaches a generation failure reason under one of several keys depending
 * on how it failed, sometimes nested under `.message`. Probing them all is the
 * difference between "generation failed" and a message someone can act on.
 */
function failureReason(asset: KnakAsset | undefined): string | undefined {
  if (!asset) return undefined
  const candidates = [
    asset.ai_generation_error,
    asset.ai_generation_message,
    asset.error_message,
    asset.error,
    asset.message,
  ]
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim()
    if (candidate && typeof candidate === "object") {
      const nested = (candidate as { message?: unknown }).message
      if (typeof nested === "string" && nested.trim()) return nested.trim()
    }
  }
  return undefined
}

/**
 * Poll until generation leaves the in-progress set.
 *
 * Transient fetch errors do not abort the loop — a blip mid-generation should
 * not look like a failed email. Safe to await inline: an eve turn is durable, so
 * a two-minute wait does not hold a function open.
 */
export async function pollAssetGeneration(
  assetId: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<PollResult> {
  const timeoutMs = opts.timeoutMs ?? 150_000
  const intervalMs = opts.intervalMs ?? 5_000
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    try {
      const asset = await getAsset(assetId)
      const status = String(asset.ai_generation_status ?? "").toLowerCase()
      if (status && !IN_PROGRESS.has(status)) {
        return {
          done: true,
          failed: status === "failed" || status === "error",
          status,
          asset,
          reason: failureReason(asset),
        }
      }
    } catch {
      // Transient — keep polling until the deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  return { done: false, failed: false }
}

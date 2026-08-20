/**
 * Knak tools — on-brand email assets, built by Knak rather than by the model.
 *
 * The division of labour is the whole point and the agent needs to respect it:
 * **Knak writes the email.** It owns the brand's design system, themes, and
 * layout, and it renders the HTML. The agent's job is to hand over a
 * well-formed brief and report back the asset — not to compose email HTML, and
 * not to paraphrase copy that has already been approved.
 *
 * `generate_knak_email` takes either a freeform prompt (conversational: "build
 * me an email announcing X") or a structured brief (an intake form: subject,
 * preheader, body copy, CTA). The brief path assembles the prompt
 * deterministically in `agent/lib/knak/brief.ts`, which is what keeps approved
 * copy verbatim.
 *
 * Generation runs 1-2 minutes. The tool awaits it inline, because an eve turn is
 * durable — waiting does not hold a function open, and the alternative (return
 * early, poll elsewhere, post later) needs machinery that buys nothing here.
 */

import { defineDynamic, defineTool } from "eve/tools"
import { z } from "zod"

import { writeApproval } from "../lib/approval"
import { config } from "../lib/config"
import { isConfigured } from "../lib/integrations"
import * as knak from "../lib/knak/client"
import {
  buildAssetName,
  buildGenerationPrompt,
  normalizeSlackText,
  slackBoldToMarkdown,
} from "../lib/knak/brief"

function fail(error: unknown, fallback: string) {
  return {
    success: false as const,
    error: error instanceof Error ? error.message : fallback,
  }
}

/** Resolve the destination folder id from a campaign name or the configured path. */
async function resolveDestination(input: {
  campaign_name?: string
  brand_name?: string
}): Promise<{ campaignId?: string; error?: string }> {
  const brand = input.brand_name || config.knak.defaultBrand

  if (input.campaign_name) {
    const { campaignId, error } = await knak.resolveCampaignId(input.campaign_name, {
      brandName: brand || undefined,
    })
    return { campaignId, error }
  }

  // No campaign named: fall back to the configured brand + folder path.
  if (brand && config.knak.folderPath.length > 0) {
    const { folderId, error } = await knak.resolveFolderPath(brand, [
      ...config.knak.folderPath,
    ])
    return { campaignId: folderId, error }
  }

  return {
    error:
      "No Knak campaign given, and no default is configured. Name a campaign, or set KNAK_DEFAULT_BRAND and KNAK_FOLDER_PATH. Call list_knak_campaigns to see the options.",
  }
}

export default defineDynamic({
  events: {
    "session.started": () => {
      if (!isConfigured("knak")) return null

      return {
        // ── Browse ──────────────────────────────────────────────────────────

        list_knak_brands: defineTool({
          description:
            "List the brands in the Knak workspace. Call this to resolve or confirm a brand before generating an email, or when the user has not named one.",
          inputSchema: z.object({}),
          async execute() {
            try {
              const brands = await knak.listBrands()
              return { success: true as const, count: brands.length, brands }
            } catch (error) {
              return fail(error, "Failed to list brands")
            }
          },
        }),

        list_knak_campaigns: defineTool({
          description: `List Knak campaigns — which are asset folders — so you can pick where an email lands. Filter by brand to narrow it.

Folders nest, and this returns one level at a time: pass parent_folder_id to descend. Call it before generating when the user named a campaign you do not have an id for.`,
          inputSchema: z.object({
            brand_name: z
              .string()
              .optional()
              .describe("Only campaigns under this brand"),
            parent_folder_id: z
              .string()
              .optional()
              .describe("List the children of this folder instead of the top level"),
          }),
          async execute({ brand_name, parent_folder_id }) {
            try {
              let brandId: string | undefined
              if (brand_name) {
                const brands = await knak.listBrands()
                const brand = brands.find(
                  (candidate) => candidate.name.toLowerCase() === brand_name.toLowerCase()
                )
                if (!brand) {
                  return {
                    success: false as const,
                    error: `Brand "${brand_name}" not found. Available: ${brands
                      .map((b) => b.name)
                      .join(", ")}`,
                  }
                }
                brandId = brand.id
              }

              const campaigns = await knak.listFolders({
                brandId,
                parentFolderId: parent_folder_id,
              })
              return { success: true as const, count: campaigns.length, campaigns }
            } catch (error) {
              return fail(error, "Failed to list campaigns")
            }
          },
        }),

        list_knak_themes: defineTool({
          description:
            "List Knak themes — the brand design systems an email is generated against. Optional: only pass a theme to generate_knak_email when the user asked for a specific one, otherwise the configured default or the brand's own default is used.",
          inputSchema: z.object({}),
          async execute() {
            try {
              const themes = await knak.listThemes()
              return { success: true as const, count: themes.length, themes }
            } catch (error) {
              return fail(error, "Failed to list themes")
            }
          },
        }),

        get_knak_asset: defineTool({
          description:
            "Get one Knak asset by id — name, subject, campaign, brand, and generation status. Use it to check on an email that was still generating.",
          inputSchema: z.object({
            asset_id: z.string().describe("The Knak asset id"),
          }),
          async execute({ asset_id }) {
            try {
              const asset = await knak.getAsset(asset_id)
              return {
                success: true as const,
                asset,
                url: knak.knakAssetUrl(asset_id),
              }
            } catch (error) {
              return fail(error, "Failed to get the asset")
            }
          },
        }),

        get_knak_asset_html: defineTool({
          description: `Get a Knak asset's rendered HTML and metadata.

Use it to QA an email before it ships — check that every link resolves and carries the right UTMs, that the subject and preheader are present and a sensible length, and that the copy matches what was approved. Do not paste the whole HTML into your reply; report what you checked and what you found.`,
          inputSchema: z.object({
            asset_id: z.string().describe("The Knak asset id"),
          }),
          async execute({ asset_id }, ctx) {
            try {
              const content = await knak.getAssetContent(asset_id)

              // Email HTML runs to hundreds of kilobytes. Put it on disk so it
              // can be grepped and analyzed rather than read into context.
              const path = `/workspace/knak-${asset_id}.html`
              const sandbox = await ctx.getSandbox()
              await sandbox.writeTextFile({ path, content: content.html })

              const links = Array.from(
                new Set(
                  Array.from(content.html.matchAll(/href="([^"]+)"/gi)).map(
                    (match) => match[1]
                  )
                )
              ).filter((href) => /^https?:/i.test(href))

              return {
                success: true as const,
                asset_id,
                name: content.name,
                subject: content.subject,
                from_name: content.from_name,
                from_email: content.from_email,
                url: knak.knakAssetUrl(asset_id),
                html_path: path,
                html_bytes: Buffer.byteLength(content.html, "utf8"),
                links,
                note: "The full HTML is at html_path — grep or analyze it there rather than reading it all.",
              }
            } catch (error) {
              return fail(error, "Failed to get the asset content")
            }
          },
        }),

        // ── Generate ────────────────────────────────────────────────────────

        generate_knak_email: defineTool({
          description: `Build an on-brand email inside Knak.

**Knak writes the email, not you.** It applies the brand's design system and renders the HTML. Never compose email HTML yourself, and never paraphrase copy someone gave you — pass it through.

Two ways to call this:

1. **Structured brief** — when someone supplied real copy (an intake form, a request post, or copy pasted into the thread). Pass \`body_copy\` plus whatever else they gave: subject, preheader, CTA text and link. The copy is reproduced VERBATIM; the prompt is assembled deterministically so nothing gets rewritten. This is the right path whenever approved copy exists.

2. **Freeform prompt** — when someone describes what they want and there is no copy yet ("build an email announcing the new pricing page"). Pass \`prompt\` and let Knak write it.

Pass one or the other. If you pass \`body_copy\`, \`prompt\` is ignored.

**Naming.** Knak cannot rename an asset after creation, so get it right the first time. Supply \`region\`, \`type\`, \`title\`, \`target_send_date\`, and \`ticket\` where known and the convention is applied for you (${config.knak.assetNamePattern}). Do not hand-build \`asset_name\` unless the user dictated an exact name.

**Where it lands.** Name a campaign, or leave it out to use the configured default folder. Call list_knak_campaigns if you need the options.

Generation takes 1-2 minutes and this waits for it. Report only what the tool returns — never invent the email's contents.`,
          inputSchema: z.object({
            // Freeform path
            prompt: z
              .string()
              .optional()
              .describe(
                "What the email should say and achieve. Use only when no approved copy exists."
              ),

            // Structured brief path
            body_copy: z
              .string()
              .optional()
              .describe(
                "Approved body copy, reproduced verbatim. Markdown: **bold**, [text](url), and - bullets are preserved."
              ),
            subject: z.string().optional().describe("Inbox subject line"),
            preheader: z.string().optional().describe("Preview text"),
            cta_text: z.string().optional().describe("Call-to-action button label"),
            cta_link: z.string().optional().describe("Call-to-action button URL"),
            notes: z
              .string()
              .optional()
              .describe("Extra direction for Knak — layout notes, length, tone"),

            // Destination
            campaign_name: z
              .string()
              .optional()
              .describe("Knak campaign (asset folder) this belongs to"),
            brand_name: z
              .string()
              .optional()
              .describe("Knak brand. Narrows campaign resolution."),
            template: z
              .string()
              .optional()
              .describe(
                'Requested template or theme, e.g. "Standard Email" or "Newsletter"'
              ),
            theme_id: z
              .string()
              .optional()
              .describe("Explicit Knak theme id, when you already know it"),

            // Naming
            asset_name: z
              .string()
              .optional()
              .describe("Exact asset name. Omit to apply the naming convention."),
            title: z.string().optional().describe("Short email title, for the name"),
            region: z.string().optional().describe("e.g. Global, NAMER, EMEA, APAC"),
            type: z.string().optional().describe("e.g. Email or Nurture"),
            target_send_date: z.string().optional().describe("ISO date, YYYY-MM-DD"),
            ticket: z
              .string()
              .optional()
              .describe("Tracker key, e.g. MOPS-4520, so the asset traces to its request"),

            // Sender
            from_name: z.string().optional(),
            from_email: z.string().optional(),
            reply_email: z.string().optional(),
            tags: z.array(z.string()).optional(),
          }),
          approval: writeApproval(),
          async execute(input) {
            if (!input.prompt && !input.body_copy) {
              return {
                success: false as const,
                error:
                  "Pass either body_copy (approved copy to reproduce verbatim) or prompt (a description for Knak to write from).",
              }
            }

            try {
              const { campaignId, error } = await resolveDestination(input)
              if (!campaignId) {
                return { success: false as const, error: error ?? "Could not resolve a destination." }
              }

              const brand = input.brand_name || config.knak.defaultBrand || undefined

              // A structured brief assembles a verbatim-preserving prompt; a
              // freeform request passes straight through.
              const prompt = input.body_copy
                ? buildGenerationPrompt({
                    bodyCopy: slackBoldToMarkdown(normalizeSlackText(input.body_copy)),
                    subject: input.subject,
                    preheader: input.preheader,
                    ctaText: input.cta_text,
                    ctaLink: input.cta_link
                      ? normalizeSlackText(input.cta_link)
                      : undefined,
                    brand,
                    notes: input.notes,
                  })
                : input.prompt!

              const name =
                input.asset_name ||
                buildAssetName({
                  region: input.region,
                  type: input.type,
                  brand,
                  title: input.title || input.subject,
                  targetSendDate: input.target_send_date,
                  ticket: input.ticket,
                }) ||
                undefined

              const themeId = await knak.resolveThemeId({
                themeId: input.theme_id,
                template: input.template,
              })

              const asset = await knak.generateAsset({
                prompt,
                campaign_id: campaignId,
                name,
                subject: input.subject,
                theme_id: themeId,
                from_name: input.from_name,
                from_email: input.from_email,
                reply_email: input.reply_email,
                tags: input.tags,
              })

              if (!asset.id) {
                return {
                  success: false as const,
                  error:
                    "Knak did not return an asset id, so generation was rejected before it started. Check AI generation access, quota, and brand permissions for this API key.",
                }
              }

              const url = knak.knakAssetUrl(asset.id)
              const result = await knak.pollAssetGeneration(asset.id)

              if (!result.done) {
                return {
                  success: true as const,
                  status: "generating" as const,
                  asset_id: asset.id,
                  url,
                  name,
                  message: `Still generating — it is taking longer than usual. Open it in Knak: ${url}`,
                }
              }

              if (result.failed) {
                return {
                  success: false as const,
                  asset_id: asset.id,
                  url,
                  error: result.reason
                    ? `Knak could not finish generating: ${result.reason}. Open it to retry: ${url}`
                    : `Knak could not finish generating (status: ${result.status}). Open it to retry: ${url}`,
                }
              }

              return {
                success: true as const,
                status: "ready" as const,
                asset_id: asset.id,
                url,
                name: (result.asset?.name as string | undefined) ?? name,
                subject:
                  (result.asset?.subject as string | undefined) ?? input.subject ?? "",
                verbatim: !!input.body_copy,
                message: `Email ready in Knak: ${url}`,
              }
            } catch (error) {
              return fail(error, "Failed to generate the email")
            }
          },
        }),
      }
    },
  },
})

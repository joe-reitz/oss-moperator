/**
 * Email QA before it ships.
 *
 * Always available: pure logic over the rendered HTML, no vendor and no network,
 * so it works on a Knak asset, a Marketo export, or HTML someone pasted.
 */

import { defineTool } from "eve/tools"
import { z } from "zod"

import { auditEmail } from "../lib/email-qa"

export default defineTool({
  description: `Check a rendered email for the defects that actually get shipped.

Pass the HTML directly, or a path to it in the workspace (get_knak_asset_html writes one for you). Include the subject and preheader when you have them — several checks need them.

Findings come back at three levels and you should treat them differently:
- **blocking** — do not send. A link with no UTMs, a missing unsubscribe link, an unreplaced merge token, lorem ipsum.
- **warning** — someone should look. Inconsistent UTM casing that will split a channel, missing alt text, a subject that will truncate.
- **note** — informational.

Report what you checked as well as what you found, so "clean" means something. Do not paste the HTML into your reply.`,
  inputSchema: z.object({
    html: z.string().optional().describe("The rendered email HTML"),
    html_path: z
      .string()
      .optional()
      .describe("Path to the HTML in the workspace, e.g. /workspace/knak-abc.html"),
    subject: z.string().optional().describe("Subject line, for length and spam checks"),
    preheader: z.string().optional().describe("Preview text"),
    ignore_hosts: z
      .array(z.string())
      .optional()
      .describe(
        "Extra hosts where a missing UTM is fine. Social and developer sites are already ignored."
      ),
  }),
  async execute({ html, html_path, subject, preheader, ignore_hosts }, ctx) {
    let source = html

    if (!source && html_path) {
      try {
        const sandbox = await ctx.getSandbox()
        source = (await sandbox.readTextFile({ path: html_path })) ?? ""
      } catch {
        return {
          success: false as const,
          error: `Could not read ${html_path}. Use glob to find the exact path.`,
        }
      }
    }

    if (!source || !source.trim()) {
      return {
        success: false as const,
        error: "Pass either html or html_path.",
      }
    }

    const report = auditEmail({
      html: source,
      subject,
      preheader,
      ignoreHosts: ignore_hosts,
    })

    const blocking = report.findings.filter((f) => f.severity === "blocking").length
    const warnings = report.findings.filter((f) => f.severity === "warning").length

    return {
      success: true as const,
      ...report,
      summary: report.clean
        ? `No blocking issues. ${warnings} warning(s). Checked ${report.links.campaign} campaign link(s) — ${report.links.untracked} untracked — plus ${report.links.functional} functional link(s) and ${report.images.total} image(s).`
        : `${blocking} blocking issue(s) and ${warnings} warning(s). Do not send until the blocking ones are fixed.`,
    }
  },
})

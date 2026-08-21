#!/usr/bin/env node
/**
 * Print the Slack app manifest with your domain filled in.
 *
 * `docs/slack/manifest.json` ships with YOUR-DOMAIN placeholders in three
 * places, and hand-editing three URLs is exactly the kind of thing you get
 * wrong once and then spend twenty minutes debugging as "Slack never reaches
 * the agent".
 *
 *   npm run slack:manifest -- https://my-app.vercel.app
 *   npm run slack:manifest -- my-app.vercel.app --yaml
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

const args = process.argv.slice(2)
const wantsYaml = args.includes("--yaml")
const raw = args.find((arg) => !arg.startsWith("--"))

if (!raw) {
  console.error(
    [
      "Pass the domain the agent is deployed at.",
      "",
      "  npm run slack:manifest -- https://my-app.vercel.app",
      "  npm run slack:manifest -- my-app.vercel.app --yaml",
      "",
      "For local development, use a tunnel host (ngrok http 3000) — Slack",
      "cannot reach localhost.",
    ].join("\n")
  )
  process.exit(1)
}

// Accept a bare host or a full URL, with or without a trailing slash.
const host = raw.replace(/^https?:\/\//, "").replace(/\/+$/, "")

if (host.includes("localhost") || host.startsWith("127.")) {
  console.error(
    `Slack cannot reach ${host}. Use a tunnel (ngrok http 3000) and pass the tunnel host.`
  )
  process.exit(1)
}
if (!host.includes(".")) {
  console.error(`"${host}" does not look like a hostname.`)
  process.exit(1)
}

const source = readFileSync(
  join(import.meta.dirname, "..", "docs", "slack", wantsYaml ? "manifest.yaml" : "manifest.json"),
  "utf8"
)

const filled = source.replaceAll("YOUR-DOMAIN", host)
const remaining = (filled.match(/YOUR-DOMAIN/g) ?? []).length
if (remaining > 0) {
  console.error(`Failed to substitute ${remaining} placeholder(s).`)
  process.exit(1)
}

console.log(filled)
console.error(
  [
    "",
    `→ Paste the above into api.slack.com/apps → Create New App → From a manifest.`,
    `  Events + interactivity:  https://${host}/eve/v1/slack`,
    `  Admin sign-in callback:  https://${host}/api/admin/signin/callback`,
    "",
    "  Slack requires you to verify the Request URL manually when it comes from",
    "  a manifest — open Event Subscriptions and confirm it shows Verified.",
    "  The deployment has to be live for that to pass.",
    "",
  ].join("\n")
)

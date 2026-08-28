import type { NextConfig } from "next"
import { withEve } from "eve/next"

const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      // WGSL shader modules for the homepage hero (vgpu)
      "*.wgsl": {
        loaders: ["@vgpu/wgsl/loader-webpack"],
        as: "*.js",
      },
    },
  },
}

/**
 * `withEve` mounts the agent under `agent/` into this Next.js app.
 *
 * One dev server and one Vercel project serve both: the marketing site, docs,
 * SOQL console, analytics, and vocabulary UI stay ordinary Next.js routes, while
 * the agent's own routes are served at /eve/v1/* — which is what the Slack app
 * points at and what `useEveAgent` on /chat talks to, same-origin, with no CORS
 * and no agent URL to keep in sync.
 *
 * Authored schedules under `agent/schedules/` become Vercel Cron Jobs at build
 * time; there is no cron route to write.
 */
export default withEve(nextConfig)

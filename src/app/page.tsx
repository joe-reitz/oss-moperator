import Link from "next/link"
import { HeroRain } from "@/components/hero-rain"

const ASCII_LOGO = `         @@@                            @@@
        @@  @@                        @@  #
         @@   @@                    @@   @@
           @#   @@                @@   #@
             @=   @@            @@   =@
              @@.   @@        @@   -@@
                @@    @@    @@    @@
                  @@    @@@@    @@
                    @@   @    @@
                      @@    @@
                  @@@@    %#  @@@@
                @%...*  =@@.  =...@@
              @@=*#....@@  @@....#++@@
          @@@-.:=.*#=.@@    @%.=*+.==.=@@@
    @@*++=..+.+:*..:@@       @@@::.#:---..==++@@
 %:+..=..+--+.*+=*.@@          @%::#++.*-.+..=..=:#@
 @@@@@+..#+.@@.#...%@          @%...*.@@.*#..+@@@@@
 @=.....-..%..:*=*.#@          @#.+=*:..%..:.....=@
  @@@@%.*=:*.@.=.@*@@          @@*@:=.@.*:=+.@@@@@
    @..*.@.+.=-.@                  @.=..*.%.*..@
     @@@..=.@@@@@                  @@@@@.=..@@@
       @@@@@                            @@@@@`

const ASCII_TITLE = `┌┬┐┌─┐┌─┐┬─┐┌─┐┌┬┐┌─┐┬─┐
││││ │├─┘├┤ ├┬┘├─┤ │ │ │├┬┘
┴ ┴└─┘┴  └─┘┴└─┴ ┴ ┴ └─┘┴└─`

const SETUP_GUIDES = [
  {
    step: "01",
    title: "Deploy to Vercel",
    description: "Create a Vercel account and deploy mOperator with one click. Free tier is all you need.",
    href: "/docs/deploy",
    tag: "Required",
  },
  {
    step: "02",
    title: "Set Up AI Gateway",
    description: "One key, any model. Switch providers by changing a single string.",
    href: "/docs/ai-gateway",
    tag: "Required",
  },
  {
    step: "03",
    title: "Create a Slack App",
    description: "Let your team @mention the agent, or DM it. Vercel Connect manages the token and verification for you.",
    href: "/docs/slack",
    tag: "Required",
  },
  {
    step: "04",
    title: "Connect Salesforce",
    description: "Query campaigns, contacts, and leads. Update records and export CSV — all from Slack.",
    href: "/docs/salesforce",
    tag: "Optional",
  },
  {
    step: "05",
    title: "Connect HubSpot",
    description: "Search contacts, companies, and deals. Manage lists and CRM records from Slack.",
    href: "/docs/hubspot",
    tag: "Optional",
  },
  {
    step: "06",
    title: "Connect Marketo",
    description: "Search leads, manage static lists, trigger campaigns, and view programs from Slack.",
    href: "/docs/marketo",
    tag: "Optional",
  },
  {
    step: "07",
    title: "Connect Project Management",
    description: "File bugs and feature requests from Slack to Linear, Asana, Monday.com, or your PM tool of choice.",
    href: "/docs/project-management",
    tag: "Optional",
  },
  {
    step: "08",
    title: "Connect GitHub",
    description: "View commits, generate release notes, and see what shipped this week.",
    href: "/docs/github",
    tag: "Optional",
  },
  {
    step: "09",
    title: "Connect Google Ads",
    description: "Manage campaigns, create ads, set budgets, and track performance. All spend operations require approval.",
    href: "/docs/google-ads",
    tag: "Optional",
  },
  {
    step: "10",
    title: "Connect Luma",
    description: "Create event registration pages with compliance questions baked in. Optionally stamp the Luma event ID onto a Salesforce Campaign.",
    href: "/docs/security",
    tag: "Optional",
  },
  {
    step: "11",
    title: "Lock Down for Production",
    description: "Slack signature verification, admin sign-in, per-user Salesforce OAuth, and a deployment checklist. Required before sharing the bot link.",
    href: "/docs/security",
    tag: "Required",
  },
]

const EXAMPLE_COMMANDS = [
  { cmd: "@mOperator", text: "What campaigns are active, and how many members each?" },
  { cmd: "@mOperator", text: "Export every contact at Acme Corp as a CSV" },
  { cmd: "@mOperator", text: "Which campaigns had the worst cost per conversion last month?" },
  { cmd: "@mOperator", text: "Here's a list from the conference — dedupe it against Salesforce" },
  { cmd: "@mOperator", text: "Build tracked links for LinkedIn and the newsletter" },
  { cmd: "@mOperator", text: "Add these 400 contacts to campaign 701xx000000ABCD" },
  { cmd: "@mOperator", text: "Raise the brand campaign budget to $300/day" },
  { cmd: "@mOperator", text: "Bug: the pricing form drops UTM parameters" },
  { cmd: "@mOperator", text: "Create a Luma event for our NYC launch party on March 15" },
]

export default function Home() {
  return (
    <div className="min-h-screen bg-black text-white font-mono">
      {/* Terminal Window Chrome */}
      <div className="border-b border-gray-800">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-red-500 inline-block" />
          <span className="w-3 h-3 rounded-full bg-yellow-500 inline-block" />
          <span className="w-3 h-3 rounded-full bg-green-500 inline-block" />
          <span className="ml-4 text-gray-500 text-sm">moperator — bash — 80x24</span>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-12">
        {/* Hero: ASCII Art casting light into WebGPU digital rain */}
        <div className="relative flex flex-col items-center mb-16">
          <HeroRain logoId="hero-ascii-logo" />
          <div className="relative flex flex-col items-center">
            <pre
              id="hero-ascii-logo"
              className="text-green-400 text-[9px] sm:text-[10px] md:text-xs leading-none mb-2 select-none"
            >
              {ASCII_LOGO}
            </pre>
            <pre className="text-white font-bold text-sm leading-tight mb-2">
              {ASCII_TITLE}
            </pre>
            <p className="text-gray-500 text-sm">Marketing Operations AI Agent</p>
            <p className="text-gray-600 text-xs mt-2">
              Open Source &middot;{" "}
              <a
                href="https://github.com/joe-reitz/oss-moperator"
                className="text-gray-500 hover:text-green-400 transition-colors"
              >
                github.com/joe-reitz/oss-moperator
              </a>
            </p>
          </div>
        </div>

        {/* What is mOperator */}
        <section className="mb-16">
          <h2 className="text-green-400 text-lg mb-4 flex items-center gap-2">
            <span className="text-gray-600">$</span> cat README.md
          </h2>
          <div className="bg-gray-950 border border-gray-800 rounded-lg p-6 space-y-4">
            <p className="text-gray-300 leading-relaxed">
              mOperator is a <strong className="text-white">marketing operations agent you
              fork</strong>. It lives in your Slack, works in your CRM and ad accounts, and
              every rule it follows is a file you can edit — the prompt, the playbooks, the
              approval policies, the naming conventions.
            </p>
            <p className="text-gray-400 leading-relaxed">
              Built on <strong className="text-gray-300">eve</strong>, Vercel&apos;s framework
              for durable agents, and deployed as a single{" "}
              <strong className="text-gray-300">Next.js</strong> project. Turns are durable, so
              an approval can wait days and resume exactly where it paused — across a redeploy.
            </p>
            <p className="text-gray-400 leading-relaxed">
              Marketing ops is not a generic problem. Your segment field is not their segment
              field, and your approval chain is specific. A closed product has to average over
              all of that. A fork does not.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <span className="text-xs px-3 py-1 rounded-full border border-gray-700 text-gray-400">Salesforce</span>
              <span className="text-xs px-3 py-1 rounded-full border border-gray-700 text-gray-400">HubSpot</span>
              <span className="text-xs px-3 py-1 rounded-full border border-gray-700 text-gray-400">Marketo</span>
              <span className="text-xs px-3 py-1 rounded-full border border-gray-700 text-gray-400">Project Management</span>
              <span className="text-xs px-3 py-1 rounded-full border border-gray-700 text-gray-400">GitHub</span>
              <span className="text-xs px-3 py-1 rounded-full border border-gray-700 text-gray-400">Slack</span>
              <span className="text-xs px-3 py-1 rounded-full border border-green-900 text-green-400">+ Your Own</span>
            </div>
          </div>
        </section>

        {/* Quick Start */}
        <section className="mb-16">
          <h2 className="text-green-400 text-lg mb-4 flex items-center gap-2">
            <span className="text-gray-600">$</span> ./quickstart.sh
          </h2>
          <div className="bg-gray-950 border border-gray-800 rounded-lg p-6">
            <div className="space-y-4 text-sm">
              <div>
                <p className="text-gray-500 mb-1"># Clone the repo</p>
                <code className="text-green-400">git clone https://github.com/joe-reitz/oss-moperator.git</code>
              </div>
              <div>
                <p className="text-gray-500 mb-1"># Install dependencies</p>
                <code className="text-green-400">cd oss-moperator && npm install</code>
              </div>
              <div>
                <p className="text-gray-500 mb-1"># Copy environment template</p>
                <code className="text-green-400">cp .env.example .env.local</code>
              </div>
              <div>
                <p className="text-gray-500 mb-1"># Add your API keys to .env.local (see setup guides below)</p>
                <code className="text-green-400">open .env.local</code>
              </div>
              <div>
                <p className="text-gray-500 mb-1"># Start the dev server</p>
                <code className="text-green-400">npm run dev</code>
              </div>
              <div>
                <p className="text-gray-500 mb-1"># Or talk to the agent in your terminal — no Slack setup needed</p>
                <code className="text-green-400">npm run agent</code>
              </div>
              <div>
                <p className="text-gray-500 mb-1"># See exactly which integrations, tools, and skills are active</p>
                <code className="text-green-400">npm run agent:info</code>
              </div>
            </div>
          </div>
        </section>

        {/* Environment Variables */}
        <section className="mb-16">
          <h2 className="text-green-400 text-lg mb-4 flex items-center gap-2">
            <span className="text-gray-600">$</span> cat .env.example
          </h2>
          <div className="bg-gray-950 border border-gray-800 rounded-lg p-6 text-sm overflow-x-auto">
            <pre className="text-gray-400 leading-relaxed">{`# ─── Model (required) ────────────────────────────────────────
# One key, any model, through the Vercel AI Gateway.
AI_GATEWAY_API_KEY=
# AI_MODEL=anthropic/claude-opus-4.8    # optional override

# ─── Who can approve writes (required) ───────────────────────
# Gates the admin pages, and lets these people write to the CRM
# without waiting for approval. Empty means every write waits.
AUTHORIZED_USER_EMAILS=
# GROWTH_MARKETING_APPROVERS=           # who may approve ad spend

# ─── Browser sign-in (required for /chat, /console) ──────────
SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=
MOPERATOR_SESSION_SECRET=               # openssl rand -hex 32

# ─── Slack ───────────────────────────────────────────────────
# Recommended: npx eve add channel/slack, then set the connector.
# MOPERATOR_SLACK_CONNECTOR=slack/moperator
SLACK_BOT_TOKEN=
SLACK_SIGNING_SECRET=

# ─── Your conventions (optional, high value) ─────────────────
MOPERATOR_ORG_NAME=Acme
MOPERATOR_TIMEZONE=America/New_York
MOPERATOR_CAMPAIGN_NAME_EXAMPLE=NAM-FY26Q1-webinar-launch

# ─── Integrations: set the keys, the tools appear ────────────
SALESFORCE_ACCESS_TOKEN=
SALESFORCE_INSTANCE_URL=
HUBSPOT_API_TOKEN=
LINEAR_API_KEY=
GOOGLE_ADS_CUSTOMER_ID=
LUMA_API_KEY=`}</pre>
          </div>
        </section>

        {/* Setup Guides */}
        <section className="mb-16">
          <h2 className="text-green-400 text-lg mb-6 flex items-center gap-2">
            <span className="text-gray-600">$</span> ls docs/
          </h2>
          <div className="space-y-4">
            {SETUP_GUIDES.map((guide) => (
              <Link
                key={guide.step}
                href={guide.href}
                className="block bg-gray-950 border border-gray-800 rounded-lg p-5 hover:border-green-900 transition-colors group"
              >
                <div className="flex items-start gap-4">
                  <span className="text-green-400 text-sm font-bold mt-0.5 shrink-0">
                    {guide.step}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <h3 className="text-white font-semibold group-hover:text-green-400 transition-colors">
                        {guide.title}
                      </h3>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${
                          guide.tag === "Required"
                            ? "bg-green-900/40 text-green-400 border border-green-800"
                            : "bg-gray-800 text-gray-500 border border-gray-700"
                        }`}
                      >
                        {guide.tag}
                      </span>
                    </div>
                    <p className="text-gray-500 text-sm">{guide.description}</p>
                  </div>
                  <span className="text-gray-700 group-hover:text-green-400 transition-colors mt-1 shrink-0">
                    &rarr;
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* Extending mOperator */}
        <section className="mb-16">
          <h2 className="text-green-400 text-lg mb-4 flex items-center gap-2">
            <span className="text-gray-600">$</span> ./extend.sh
          </h2>
          <div className="bg-gray-950 border border-gray-800 rounded-lg p-6 space-y-4">
            <p className="text-gray-300 leading-relaxed">
              mOperator is designed to be <strong className="text-white">extended</strong>. The
              real power comes from building your own integrations — small modules that teach
              mOperator about your internal tools and APIs.
            </p>
            <div className="grid sm:grid-cols-2 gap-4 pt-2">
              <div className="border border-gray-800 rounded-lg p-4">
                <h4 className="text-white text-sm font-semibold mb-2">List Import Agent</h4>
                <p className="text-gray-500 text-xs leading-relaxed">
                  Upload a CSV to Slack, have mOperator parse it, validate emails, and import
                  contacts into your CRM or MAP automatically.
                </p>
              </div>
              <div className="border border-gray-800 rounded-lg p-4">
                <h4 className="text-white text-sm font-semibold mb-2">Data Dictionary</h4>
                <p className="text-gray-500 text-xs leading-relaxed">
                  Connect mOperator to your internal docs so it understands your field mappings,
                  lifecycle stages, and scoring models.
                </p>
              </div>
              <div className="border border-gray-800 rounded-lg p-4">
                <h4 className="text-white text-sm font-semibold mb-2">Campaign Ops Bot</h4>
                <p className="text-gray-500 text-xs leading-relaxed">
                  Build a module that checks campaign naming conventions, UTM parameters, and
                  audience sizing before launch.
                </p>
              </div>
              <div className="border border-gray-800 rounded-lg p-4">
                <h4 className="text-white text-sm font-semibold mb-2">Reporting Agent</h4>
                <p className="text-gray-500 text-xs leading-relaxed">
                  Connect your BI tool and generate weekly marketing reports posted to Slack
                  on a schedule.
                </p>
              </div>
            </div>
            <div className="pt-2 flex flex-col sm:flex-row gap-3">
              <Link
                href="/docs/extending"
                className="text-green-400 text-sm hover:underline"
              >
                Technical integration guide &rarr;
              </Link>
              <Link
                href="/docs/design-your-own"
                className="text-green-400 text-sm hover:underline"
              >
                Design your own with AI &rarr;
              </Link>
            </div>
          </div>
        </section>

        {/* Example Commands */}
        <section className="mb-16">
          <h2 className="text-green-400 text-lg mb-4 flex items-center gap-2">
            <span className="text-gray-600">$</span> moperator --examples
          </h2>
          <div className="bg-gray-950 border border-gray-800 rounded-lg p-6">
            <div className="space-y-3">
              {EXAMPLE_COMMANDS.map((ex, i) => (
                <div key={i} className="text-sm">
                  <code className="text-green-400">{ex.cmd}</code>{" "}
                  <span className="text-gray-400">{ex.text}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Architecture */}
        <section className="mb-16">
          <h2 className="text-green-400 text-lg mb-4 flex items-center gap-2">
            <span className="text-gray-600">$</span> cat architecture.txt
          </h2>
          <div className="bg-gray-950 border border-gray-800 rounded-lg p-6">
            <pre className="text-gray-400 text-xs sm:text-sm overflow-x-auto leading-relaxed">{`Slack (@mOperator)     Browser (/chat)      Cron (schedules)
        |                     |                    |
        v                     v                    v
 /eve/v1/slack        /eve/v1/session      agent/schedules/*
        |                     |                    |
        +----------+----------+--------------------+
                   |
                   v
            the agent runtime  (durable turns: an approval
                   |            can wait days and resume)
   +---------------+---------------+---------------+
   v               v               v               v
tools/          skills/       subagents/        sandbox
env-gated    load on demand  read-only      /workspace + pandas
   |
   v
Salesforce  HubSpot  Marketo  Google Ads  Linear  GitHub  Luma
        (only the ones you configure)`}</pre>
          </div>
          <div className="mt-3">
            <Link
              href="/docs/architecture"
              className="text-gray-500 text-sm hover:text-green-400 transition-colors"
            >
              Full architecture docs &rarr;
            </Link>
          </div>
        </section>

        {/* Security */}
        <section className="mb-16">
          <h2 className="text-green-400 text-lg mb-4 flex items-center gap-2">
            <span className="text-gray-600">$</span> cat SECURITY.md
          </h2>
          <div className="bg-gray-950 border border-gray-800 rounded-lg p-6 space-y-4">
            <p className="text-gray-300 leading-relaxed">
              mOperator is an <strong className="text-white">admin-level integration</strong> —
              once deployed it can query your CRM, send Slack messages, and write campaign data.
              Treat it like a production service.
            </p>
            <ul className="space-y-2 text-sm text-gray-400">
              <li className="flex gap-2"><span className="text-green-400">+</span> Every write gated by a policy in code, not a prompt instruction</li>
              <li className="flex gap-2"><span className="text-green-400">+</span> Bulk writes reviewed above a threshold, refused above a hard cap — splitting the batch does not help</li>
              <li className="flex gap-2"><span className="text-green-400">+</span> Deletions and sends always need a human, and can never fire from a schedule</li>
              <li className="flex gap-2"><span className="text-green-400">+</span> Ad spend verified twice — at the gate and at the moment of effect, so nobody approves their own budget</li>
              <li className="flex gap-2"><span className="text-green-400">+</span> A read-only analyst subagent with no write tools in its tool set at all</li>
              <li className="flex gap-2"><span className="text-green-400">+</span> SOQL validated against DML, statement stacking, and comment-hidden mutations</li>
              <li className="flex gap-2"><span className="text-green-400">+</span> Slack signature verification handled by the channel; admin pages gated by <code className="text-gray-300">AUTHORIZED_USER_EMAILS</code></li>
              <li className="flex gap-2"><span className="text-green-400">+</span> Per-user Salesforce OAuth, so writes name the person — AES-256-GCM tokens, 90-day sliding expiry</li>
            </ul>
            <div className="pt-2 flex flex-col sm:flex-row gap-3">
              <Link href="/docs/security" className="text-green-400 text-sm hover:underline">
                Security setup guide &rarr;
              </Link>
              <Link href="/docs/sfdc-per-user-oauth" className="text-green-400 text-sm hover:underline">
                Per-user Salesforce OAuth &rarr;
              </Link>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="mb-16">
          <h2 className="text-green-400 text-lg mb-4 flex items-center gap-2">
            <span className="text-gray-600">$</span> moperator --features
          </h2>
          <div className="bg-gray-950 border border-gray-800 rounded-lg p-6">
            <div className="grid sm:grid-cols-2 gap-x-8 gap-y-2 text-sm text-gray-400">
              <div className="flex items-center gap-2"><span className="text-green-400">+</span> <span>Answers from the full result set — CSVs analyzed with pandas in a sandbox, not 50 rows in a prompt</span></div>
              <div className="flex items-center gap-2"><span className="text-green-400">+</span> <span>Durable approvals — a pending write survives a redeploy and never expires</span></div>
              <div className="flex items-center gap-2"><span className="text-green-400">+</span> <span>Browser chat at <code className="text-gray-300">/chat</code> with the same tools and rules as Slack</span></div>
              <div className="flex items-center gap-2"><span className="text-green-400">+</span> <span>Seven playbooks the agent loads on demand — SOQL, audiences, launches, list hygiene</span></div>
              <div className="flex items-center gap-2"><span className="text-green-400">+</span> <span>A read-only analyst subagent for &ldquo;go find out&rdquo; work</span></div>
              <div className="flex items-center gap-2"><span className="text-green-400">+</span> <span>Scheduled digests — campaign activity, ad spend anomalies, weekly triage</span></div>
              <div className="flex items-center gap-2"><span className="text-green-400">+</span> <span>UTM builder and auditor enforcing your conventions</span></div>
              <div className="flex items-center gap-2"><span className="text-green-400">+</span> <span>Campaign name checker, so quarter-over-quarter reporting still works</span></div>
              <div className="flex items-center gap-2"><span className="text-green-400">+</span> <span>Attach a list in Slack and it gets deduped against your CRM</span></div>
              <div className="flex items-center gap-2"><span className="text-green-400">+</span> <span>SOQL console at <code className="text-gray-300">/console</code> — natural language to SOQL to CSV</span></div>
              <div className="flex items-center gap-2"><span className="text-green-400">+</span> <span>Usage analytics at <code className="text-gray-300">/analytics</code></span></div>
              <div className="flex items-center gap-2"><span className="text-green-400">+</span> <span>Audience vocabulary at <code className="text-gray-300">/audience-vocab</code> — teach it what &ldquo;segment&rdquo; means, no deploy</span></div>
              <div className="flex items-center gap-2"><span className="text-green-400">+</span> <span>Integrations activate from env vars; the prompt updates itself</span></div>
              <div className="flex items-center gap-2"><span className="text-green-400">+</span> <span>Per-user Salesforce OAuth for real write attribution</span></div>
              <div className="flex items-center gap-2"><span className="text-green-400">+</span> <span>Evals — verify your own fork with <code className="text-gray-300">npm run eval</code></span></div>
              <div className="flex items-center gap-2"><span className="text-green-400">+</span> <span>Add Teams, Discord, or SMS with one command</span></div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-gray-800 pt-8 pb-12 text-center">
          <p className="text-gray-600 text-sm">
            Built with eve, Next.js, and the Vercel AI Gateway
          </p>
          <p className="text-gray-700 text-xs mt-2">
            <a
              href="https://github.com/joe-reitz/oss-moperator"
              className="hover:text-gray-500 transition-colors"
            >
              github.com/joe-reitz/oss-moperator
            </a>
          </p>
        </footer>
      </div>
    </div>
  )
}

import Link from "next/link"

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
    description: "Connect mOperator to an AI model (Claude or GPT-4o). Use AI Gateway or plug in your own API key.",
    href: "/docs/ai-gateway",
    tag: "Required",
  },
  {
    step: "03",
    title: "Create a Slack App",
    description: "Set up a Slack bot so your team can talk to mOperator with @mentions and slash commands.",
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
]

const EXAMPLE_COMMANDS = [
  { cmd: "@mOperator", text: "What campaigns are active?" },
  { cmd: "@mOperator", text: "Show me all contacts at Acme Corp" },
  { cmd: "@mOperator", text: "Export all leads as CSV" },
  { cmd: "@mOperator", text: "What shipped this week?" },
  { cmd: "/moperator bug", text: "Dashboard spinner never stops" },
  { cmd: "@mOperator", text: "File a feature request: add dark mode to reports" },
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
        {/* Hero: ASCII Art */}
        <div className="flex flex-col items-center mb-16">
          <pre className="text-green-400 text-[9px] sm:text-[10px] md:text-xs leading-none mb-2 select-none">
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

        {/* What is mOperator */}
        <section className="mb-16">
          <h2 className="text-green-400 text-lg mb-4 flex items-center gap-2">
            <span className="text-gray-600">$</span> cat README.md
          </h2>
          <div className="bg-gray-950 border border-gray-800 rounded-lg p-6 space-y-4">
            <p className="text-gray-300 leading-relaxed">
              mOperator is an <strong className="text-white">open-source AI agent</strong> that
              connects your marketing operations tools through a single Slack interface. Ask
              questions in plain English — mOperator figures out which tools to call, runs the
              queries, and responds in your thread.
            </p>
            <p className="text-gray-400 leading-relaxed">
              Built on <strong className="text-gray-300">Next.js</strong>,{" "}
              <strong className="text-gray-300">Vercel AI SDK</strong>, and{" "}
              <strong className="text-gray-300">Vercel AI Gateway</strong>. Deploy to Vercel in minutes.
              Add your own integrations with a few prompts or lines of code.
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
                <p className="text-gray-500 mb-1"># Or test via the CLI</p>
                <code className="text-green-400">npm run cli</code>
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
            <pre className="text-gray-400 leading-relaxed">{`# ─── AI Model (required — pick one) ───────────────────────────
# Option A: Vercel AI Gateway (recommended — one key, any model)
AI_GATEWAY_API_KEY=          # Your Vercel AI Gateway key
# Option B: Direct API key (simpler, single provider)
# ANTHROPIC_API_KEY=         # From console.anthropic.com
# OPENAI_API_KEY=            # From platform.openai.com
AI_PROVIDER=anthropic        # "anthropic" or "openai"

# ─── Slack Bot (required) ────────────────────────────────────
SLACK_BOT_TOKEN=             # xoxb-your-bot-token
SLACK_BOT_USER_ID=           # The bot's Slack user ID

# ─── Authorized Users & Approvals ────────────────────────────
AUTHORIZED_USER_EMAILS=      # Comma-separated emails
# SLACK_APPROVER_GROUP_ID=   # Slack user group ID

# ─── Redis (required for approvals) ─────────────────────────
# UPSTASH_REDIS_REST_URL=
# UPSTASH_REDIS_REST_TOKEN=

# ─── Salesforce (optional) ───────────────────────────────────
SALESFORCE_CLIENT_ID=
SALESFORCE_CLIENT_SECRET=
SALESFORCE_ACCESS_TOKEN=
SALESFORCE_INSTANCE_URL=

# ─── HubSpot (optional) ─────────────────────────────────────
HUBSPOT_API_TOKEN=           # Private App access token

# ─── Marketo (optional) ─────────────────────────────────────
MARKETO_CLIENT_ID=
MARKETO_CLIENT_SECRET=
MARKETO_REST_ENDPOINT=       # e.g., https://123-ABC-456.mktorest.com

# ─── Project Management (optional) ──────────────────────────
LINEAR_API_KEY=
LINEAR_TEAM_NAME=ENG

# ─── GitHub (optional) ──────────────────────────────────────
GITHUB_TOKEN=                # Personal access token
GITHUB_REPO=owner/repo       # e.g., acme/marketing-site`}</pre>
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
            <pre className="text-gray-400 text-xs sm:text-sm overflow-x-auto leading-relaxed">{`CLI (npm run cli)     Slack (@mOperator)
    |                      |
    v                      v
POST /api/agent      POST /api/slack
    |                      |
    +----------+-----------+
               |
               v
    AI SDK (Claude / GPT-4o)
               |
               +-- Tools (auto-discovered from integrations):
                   +-- Salesforce (if configured)
                   +-- HubSpot (if configured)
                   +-- Marketo (if configured)
                   +-- Project Management (if configured)
                   +-- GitHub (if configured)
                   +-- Your custom tools`}</pre>
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

        {/* Features */}
        <section className="mb-16">
          <h2 className="text-green-400 text-lg mb-4 flex items-center gap-2">
            <span className="text-gray-600">$</span> moperator --features
          </h2>
          <div className="bg-gray-950 border border-gray-800 rounded-lg p-6">
            <div className="grid sm:grid-cols-2 gap-x-8 gap-y-2 text-sm text-gray-400">
              <div className="flex items-center gap-2"><span className="text-green-400">+</span> Natural language queries against Salesforce</div>
              <div className="flex items-center gap-2"><span className="text-green-400">+</span> Create, update, and delete records</div>
              <div className="flex items-center gap-2"><span className="text-green-400">+</span> Bulk update hundreds of records at once</div>
              <div className="flex items-center gap-2"><span className="text-green-400">+</span> CSV export as Slack file attachment</div>
              <div className="flex items-center gap-2"><span className="text-green-400">+</span> CSV upload — attach a file and process it</div>
              <div className="flex items-center gap-2"><span className="text-green-400">+</span> Thread context for follow-up questions</div>
              <div className="flex items-center gap-2"><span className="text-green-400">+</span> Permission controls for destructive actions</div>
              <div className="flex items-center gap-2"><span className="text-green-400">+</span> Auto-discovered integrations via env vars</div>
              <div className="flex items-center gap-2"><span className="text-green-400">+</span> HubSpot contacts, companies, deals, and lists</div>
              <div className="flex items-center gap-2"><span className="text-green-400">+</span> Marketo leads, campaigns, programs, and emails</div>
              <div className="flex items-center gap-2"><span className="text-green-400">+</span> File bugs and features to your PM tool from Slack</div>
              <div className="flex items-center gap-2"><span className="text-green-400">+</span> GitHub commit history and release notes</div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-gray-800 pt-8 pb-12 text-center">
          <p className="text-gray-600 text-sm">
            Built with Next.js, Vercel AI SDK, and Claude
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

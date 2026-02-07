import Link from "next/link"

export default function Home() {
  return (
    <div style={{ fontFamily: "system-ui", padding: 40, maxWidth: 800, margin: "0 auto", background: "#000", color: "#fff", minHeight: "100vh" }}>
      <h1 style={{ color: "#4f4", fontSize: 32 }}>mOperator</h1>
      <p style={{ color: "#aaa", fontSize: 18 }}>Marketing Operations AI Agent</p>

      <div style={{ marginTop: 40 }}>
        <h2 style={{ color: "#4f4" }}>Quick Start</h2>
        <ol style={{ color: "#ccc", lineHeight: 2 }}>
          <li>Copy <code style={{ background: "#222", padding: "2px 6px", borderRadius: 4 }}>.env.example</code> to <code style={{ background: "#222", padding: "2px 6px", borderRadius: 4 }}>.env.local</code></li>
          <li>Add your API keys (see <code style={{ background: "#222", padding: "2px 6px", borderRadius: 4 }}>docs/</code> for setup guides)</li>
          <li>Run <code style={{ background: "#222", padding: "2px 6px", borderRadius: 4 }}>npm run dev</code></li>
          <li>Connect your Slack bot to <code style={{ background: "#222", padding: "2px 6px", borderRadius: 4 }}>https://your-app.vercel.app/api/slack</code></li>
        </ol>
      </div>

      <div style={{ marginTop: 40 }}>
        <h2 style={{ color: "#4f4" }}>Integrations</h2>
        <p style={{ color: "#aaa" }}>mOperator auto-discovers integrations based on environment variables. Enable what you need:</p>
        <ul style={{ color: "#ccc", lineHeight: 2 }}>
          <li><strong>Salesforce</strong> — Query, update, and manage CRM data. <Link href="/api/integrations/salesforce" style={{ color: "#4af" }}>Run OAuth flow</Link></li>
          <li><strong>Linear</strong> — File bugs and feature requests from Slack</li>
          <li><strong>GitHub</strong> — View commits and generate release notes</li>
        </ul>
      </div>

      <div style={{ marginTop: 40 }}>
        <h2 style={{ color: "#4f4" }}>Architecture</h2>
        <pre style={{ background: "#111", padding: 20, borderRadius: 8, color: "#aaa", fontSize: 14, overflow: "auto" }}>
{`CLI (npm run cli)     Slack (@mOperator)
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
                   +-- Linear (if configured)
                   +-- GitHub (if configured)`}
        </pre>
      </div>

      <footer style={{ marginTop: 60, color: "#555", fontSize: 14, textAlign: "center" }}>
        Built with Next.js, Vercel AI SDK, and Claude
      </footer>
    </div>
  )
}

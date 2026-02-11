import { readFileSync } from "fs"
import { join } from "path"
import Link from "next/link"
import { notFound } from "next/navigation"

const DOCS = [
  { slug: "deploy", file: "deploy-to-vercel.md", title: "Deploy to Vercel", step: "01" },
  { slug: "ai-gateway", file: "setup-ai-gateway.md", title: "Set Up AI Gateway", step: "02" },
  { slug: "slack", file: "setup-slack-app.md", title: "Create a Slack App", step: "03" },
  { slug: "salesforce", file: "setup-salesforce.md", title: "Connect Salesforce", step: "04" },
  { slug: "hubspot", file: "setup-hubspot.md", title: "Connect HubSpot", step: "05" },
  { slug: "marketo", file: "setup-marketo.md", title: "Connect Marketo", step: "06" },
  { slug: "project-management", file: "setup-linear.md", title: "Connect Project Management", step: "07" },
  { slug: "github", file: "setup-github.md", title: "Connect GitHub", step: "08" },
  { slug: "extending", file: "adding-integrations.md", title: "Adding Integrations", step: "09" },
  { slug: "design-your-own", file: "design-your-own.md", title: "Design Your Own with AI", step: "10" },
  { slug: "architecture", file: "architecture.md", title: "Architecture", step: "11" },
]

function markdownToHtml(md: string): string {
  let html = md

  // Code blocks (must come before inline code)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    const escaped = code
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .trimEnd()
    return `<pre><code class="language-${lang || "text"}">${escaped}</code></pre>`
  })

  // Split into blocks for paragraph processing
  const blocks = html.split(/\n\n+/)
  const processed = blocks.map((block) => {
    // Skip pre blocks
    if (block.startsWith("<pre>")) return block

    // Headers
    if (block.match(/^####\s/)) return block.replace(/^####\s+(.+)$/gm, "<h4>$1</h4>")
    if (block.match(/^###\s/)) return block.replace(/^###\s+(.+)$/gm, "<h3>$1</h3>")
    if (block.match(/^##\s/)) return block.replace(/^##\s+(.+)$/gm, "<h2>$1</h2>")
    if (block.match(/^#\s/)) return block.replace(/^#\s+(.+)$/gm, "<h1>$1</h1>")

    // Horizontal rules
    if (block.match(/^---+$/)) return "<hr>"

    // Tables
    if (block.includes("|") && block.includes("---")) {
      const rows = block.split("\n").filter((r) => r.trim())
      if (rows.length >= 2) {
        const headerCells = rows[0].split("|").filter((c) => c.trim()).map((c) => c.trim())
        const bodyRows = rows.slice(2) // skip header and separator
        let table = "<table><thead><tr>"
        for (const cell of headerCells) table += `<th>${applyInline(cell)}</th>`
        table += "</tr></thead><tbody>"
        for (const row of bodyRows) {
          const cells = row.split("|").filter((c) => c.trim()).map((c) => c.trim())
          table += "<tr>"
          for (const cell of cells) table += `<td>${applyInline(cell)}</td>`
          table += "</tr>"
        }
        table += "</tbody></table>"
        return table
      }
    }

    // Ordered lists
    if (block.match(/^\d+\.\s/m)) {
      const items = block.split(/\n(?=\d+\.\s)/)
      const listItems = items.map((item) => {
        const content = item.replace(/^\d+\.\s+/, "")
        // Handle nested lists
        const lines = content.split("\n")
        let result = applyInline(lines[0])
        const nested = lines.slice(1)
        if (nested.length > 0) {
          const nestedContent = nested
            .map((l) => l.replace(/^\s+/, ""))
            .filter((l) => l)
          if (nestedContent.some((l) => l.match(/^[-*]\s/))) {
            result += "<ul>"
            for (const nl of nestedContent) {
              if (nl.match(/^[-*]\s/)) {
                result += `<li>${applyInline(nl.replace(/^[-*]\s+/, ""))}</li>`
              }
            }
            result += "</ul>"
          } else if (nestedContent.length > 0) {
            result += "<br>" + nestedContent.map(applyInline).join("<br>")
          }
        }
        return `<li>${result}</li>`
      })
      return `<ol>${listItems.join("")}</ol>`
    }

    // Unordered lists
    if (block.match(/^[-*]\s/m)) {
      const items = block.split(/\n(?=[-*]\s)/)
      const listItems = items.map((item) => {
        const content = item.replace(/^[-*]\s+/, "")
        const lines = content.split("\n")
        let result = applyInline(lines[0])
        const nested = lines.slice(1)
        if (nested.length > 0) {
          const nestedContent = nested
            .map((l) => l.replace(/^\s+/, ""))
            .filter((l) => l)
          if (nestedContent.some((l) => l.match(/^[-*]\s/))) {
            result += "<ul>"
            for (const nl of nestedContent) {
              if (nl.match(/^[-*]\s/)) {
                result += `<li>${applyInline(nl.replace(/^[-*]\s+/, ""))}</li>`
              }
            }
            result += "</ul>"
          }
        }
        return `<li>${result}</li>`
      })
      return `<ul>${listItems.join("")}</ul>`
    }

    // Blockquotes
    if (block.match(/^>\s/m)) {
      const content = block.replace(/^>\s?/gm, "")
      return `<blockquote><p>${applyInline(content)}</p></blockquote>`
    }

    // Paragraph
    return `<p>${applyInline(block)}</p>`
  })

  return processed.join("\n")
}

function applyInline(text: string): string {
  return text
    // Inline code
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    // Bold + italic
    .replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>")
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    // Italic
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>")
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    // Line breaks
    .replace(/\n/g, "<br>")
}

export function generateStaticParams() {
  return DOCS.map((doc) => ({ slug: doc.slug }))
}

export function generateMetadata({ params }: { params: { slug: string } }) {
  const doc = DOCS.find((d) => d.slug === params.slug)
  return {
    title: doc ? `${doc.title} — mOperator` : "mOperator Docs",
  }
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const docIndex = DOCS.findIndex((d) => d.slug === slug)
  if (docIndex === -1) notFound()

  const doc = DOCS[docIndex]
  const prev = docIndex > 0 ? DOCS[docIndex - 1] : null
  const next = docIndex < DOCS.length - 1 ? DOCS[docIndex + 1] : null

  let markdown: string
  try {
    const filePath = join(process.cwd(), "docs", doc.file)
    markdown = readFileSync(filePath, "utf-8")
  } catch {
    notFound()
  }

  const htmlContent = markdownToHtml(markdown)

  return (
    <div className="min-h-screen bg-black text-white font-mono">
      {/* Terminal Chrome */}
      <div className="border-b border-gray-800">
        <div className="max-w-4xl mx-auto px-6 py-3 flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-red-500 inline-block" />
          <span className="w-3 h-3 rounded-full bg-yellow-500 inline-block" />
          <span className="w-3 h-3 rounded-full bg-green-500 inline-block" />
          <span className="ml-4 text-gray-500 text-sm">
            moperator — docs/{doc.slug}
          </span>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Breadcrumb */}
        <div className="mb-8 text-sm">
          <Link href="/" className="text-gray-500 hover:text-green-400 transition-colors">
            home
          </Link>
          <span className="text-gray-700 mx-2">/</span>
          <span className="text-gray-500">docs</span>
          <span className="text-gray-700 mx-2">/</span>
          <span className="text-green-400">{doc.slug}</span>
        </div>

        {/* Step indicator */}
        <div className="mb-6 text-sm text-gray-600">
          Step {doc.step} of {String(DOCS.length).padStart(2, "0")}
        </div>

        {/* Document content */}
        <div
          className="doc-content"
          dangerouslySetInnerHTML={{ __html: htmlContent }}
        />

        {/* Prev / Next Navigation */}
        <div className="border-t border-gray-800 mt-12 pt-8 flex justify-between">
          {prev ? (
            <Link
              href={`/docs/${prev.slug}`}
              className="text-gray-500 hover:text-green-400 transition-colors text-sm"
            >
              &larr; {prev.title}
            </Link>
          ) : (
            <Link
              href="/"
              className="text-gray-500 hover:text-green-400 transition-colors text-sm"
            >
              &larr; Home
            </Link>
          )}
          {next ? (
            <Link
              href={`/docs/${next.slug}`}
              className="text-gray-500 hover:text-green-400 transition-colors text-sm"
            >
              {next.title} &rarr;
            </Link>
          ) : (
            <Link
              href="/"
              className="text-gray-500 hover:text-green-400 transition-colors text-sm"
            >
              Home &rarr;
            </Link>
          )}
        </div>

        {/* Sidebar: All Docs */}
        <div className="border-t border-gray-800 mt-8 pt-8">
          <h3 className="text-gray-600 text-xs uppercase tracking-wider mb-4">
            All Guides
          </h3>
          <div className="space-y-2">
            {DOCS.map((d) => (
              <Link
                key={d.slug}
                href={`/docs/${d.slug}`}
                className={`block text-sm py-1 transition-colors ${
                  d.slug === slug
                    ? "text-green-400"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                <span className="text-gray-700 mr-3">{d.step}</span>
                {d.title}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

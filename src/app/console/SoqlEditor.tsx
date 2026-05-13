"use client"

import Editor from "react-simple-code-editor"

const KEYWORDS = new Set([
  "SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "IN", "LIKE", "INCLUDES", "EXCLUDES",
  "ORDER", "BY", "GROUP", "HAVING", "LIMIT", "OFFSET", "ASC", "DESC", "NULLS", "FIRST", "LAST",
  "NULL", "TRUE", "FALSE", "IS",
  "COUNT", "COUNT_DISTINCT", "SUM", "AVG", "MIN", "MAX",
  "WITH", "TYPEOF", "WHEN", "THEN", "ELSE", "END",
  "TODAY", "YESTERDAY", "TOMORROW",
  "THIS_WEEK", "LAST_WEEK", "NEXT_WEEK",
  "THIS_MONTH", "LAST_MONTH", "NEXT_MONTH",
  "THIS_QUARTER", "LAST_QUARTER", "NEXT_QUARTER",
  "THIS_YEAR", "LAST_YEAR", "NEXT_YEAR",
  "THIS_FISCAL_QUARTER", "LAST_FISCAL_QUARTER", "NEXT_FISCAL_QUARTER",
  "THIS_FISCAL_YEAR", "LAST_FISCAL_YEAR", "NEXT_FISCAL_YEAR",
])

const KEYWORD_PREFIXES = ["LAST_N_DAYS", "NEXT_N_DAYS", "LAST_N_MONTHS", "NEXT_N_MONTHS", "LAST_N_YEARS", "NEXT_N_YEARS"]

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  )
}

/**
 * Tokenize-and-color SOQL. Output is sanitized HTML with span wrappers per
 * token class. Strings, numbers, keywords, and qualified field paths get
 * distinct colors.
 */
export function highlightSoql(code: string): string {
  let i = 0
  let out = ""

  while (i < code.length) {
    const ch = code[i]

    if (ch === "'") {
      let j = i + 1
      while (j < code.length && code[j] !== "'") {
        if (code[j] === "\\" && j + 1 < code.length) j += 2
        else j += 1
      }
      const end = Math.min(j + 1, code.length)
      out += `<span style="color:#a5b4fc">${escapeHtml(code.slice(i, end))}</span>`
      i = end
      continue
    }

    if (/[0-9]/.test(ch) && (i === 0 || /[^A-Za-z_0-9]/.test(code[i - 1]))) {
      let j = i
      while (j < code.length && /[0-9.]/.test(code[j])) j++
      out += `<span style="color:#fcd34d">${escapeHtml(code.slice(i, j))}</span>`
      i = j
      continue
    }

    if (/[A-Za-z_]/.test(ch)) {
      let j = i
      while (j < code.length && /[A-Za-z0-9_.]/.test(code[j])) j++
      const word = code.slice(i, j)
      const upper = word.toUpperCase()

      if (KEYWORDS.has(upper) || KEYWORD_PREFIXES.some((p) => upper.startsWith(p + ":"))) {
        out += `<span style="color:#86efac;font-weight:600">${escapeHtml(word)}</span>`
      } else if (word.includes(".")) {
        out += `<span style="color:#fdba74">${escapeHtml(word)}</span>`
      } else {
        out += `<span style="color:#e5e7eb">${escapeHtml(word)}</span>`
      }
      i = j
      continue
    }

    if ("=!<>".includes(ch)) {
      out += `<span style="color:#f87171">${escapeHtml(ch)}</span>`
      i++
      continue
    }

    out += escapeHtml(ch)
    i++
  }

  return out
}

interface SoqlEditorProps {
  value: string
  onChange: (value: string) => void
  rows?: number
}

export function SoqlEditor({ value, onChange, rows = 8 }: SoqlEditorProps) {
  const minHeight = rows * 24
  return (
    <div
      className="mt-2 w-full bg-gray-950 border border-gray-800 rounded text-sm font-mono focus-within:border-green-700 transition-colors overflow-hidden"
    >
      <Editor
        value={value}
        onValueChange={onChange}
        highlight={highlightSoql}
        padding={12}
        textareaClassName="focus:outline-none"
        style={{
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 13,
          lineHeight: "1.5rem",
          minHeight,
          color: "#e5e7eb",
        }}
        spellCheck={false}
      />
    </div>
  )
}

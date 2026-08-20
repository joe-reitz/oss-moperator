"use client"

/**
 * Browser chat for the agent.
 *
 * This is what replaced `cli.ts` and `POST /api/agent`. `useEveAgent` opens a
 * durable session against the same agent Slack talks to, streams the reply, and
 * surfaces the two things a marketing ops agent constantly needs a person for:
 * approval prompts and third-party sign-ins.
 *
 * `withEve` mounts the agent's routes on this origin, so there is no host to
 * configure and no CORS. The browser sends the admin session cookie, which
 * `agent/channels/eve.ts` verifies — so the caller identity here is the same
 * email the approval policies check, and an approver's writes go straight
 * through exactly as they would in Slack.
 *
 * It matters for forkability too: someone evaluating mOperator can clone it, set
 * one model key, and talk to it — without registering a Slack app first.
 */

import { useEveAgent, type EveMessagePart } from "eve/react"
import { useEffect, useRef, useState } from "react"

const EXAMPLES = [
  "What systems can you reach right now?",
  "Show me active campaigns and their member counts",
  "Build tracked links to https://example.com/webinar for LinkedIn and our newsletter",
  "Which campaigns have the worst cost per conversion this month?",
]

export default function ChatClient({ signedInAs }: { signedInAs: string }) {
  const agent = useEveAgent()
  const busy = agent.status === "submitted" || agent.status === "streaming"
  const [draft, setDraft] = useState("")
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [agent.data.messages, agent.status])

  function send(text: string) {
    const message = text.trim()
    if (!message || busy) return
    setDraft("")
    void agent.send(message)
  }

  /**
   * Pending approvals and questions ride on `dynamic-tool` parts in
   * `approval-requested` state. Scan every message rather than only the last —
   * an approval can stay open while later turns add messages above it.
   */
  const pending = agent.data.messages
    .flatMap((message) => message.parts)
    .flatMap((part) => {
      if (part.type !== "dynamic-tool" || part.state !== "approval-requested") return []
      const request = part.toolMetadata?.eve?.inputRequest
      return request ? [request] : []
    })

  return (
    <div className="min-h-screen bg-black text-white font-mono p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="border-b border-gray-800 pb-4 flex items-baseline justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-green-400">Chat</h1>
            <p className="text-gray-500 text-sm mt-1">
              The same agent your team talks to in Slack, with the same tools and
              the same approval rules.
            </p>
          </div>
          <div className="text-right shrink-0">
            <span className="text-xs text-gray-600">{signedInAs}</span>
            {agent.data.messages.length > 0 && (
              <button
                type="button"
                onClick={() => agent.reset()}
                className="block ml-auto mt-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                New conversation
              </button>
            )}
          </div>
        </header>

        {agent.error && (
          <div className="border border-red-700 bg-red-950/40 rounded p-3 text-sm text-red-300">
            {agent.error.message}
          </div>
        )}

        {agent.data.messages.length === 0 && (
          <section className="border border-gray-800 rounded-lg p-4 space-y-3">
            <h2 className="text-xs uppercase tracking-wider text-gray-500">
              Try one of these
            </h2>
            <div className="flex flex-col gap-2">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => send(example)}
                  className="text-left text-sm text-gray-400 hover:text-green-400 transition-colors"
                >
                  {example}
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="space-y-4">
          {agent.data.messages.map((message) => (
            <article
              key={message.id}
              className={
                message.role === "user"
                  ? "border-l-2 border-gray-700 pl-4"
                  : "border-l-2 border-green-800 pl-4"
              }
            >
              <header className="text-xs uppercase tracking-wider text-gray-600 mb-1">
                {message.role === "user" ? "You" : "mOperator"}
              </header>
              <div className="space-y-2">
                {message.parts.map((part, index) => (
                  <MessagePart key={index} part={part} />
                ))}
              </div>
            </article>
          ))}
          {busy && (
            <p className="text-sm text-gray-600 pl-4">
              {agent.status === "submitted" ? "Thinking…" : "Working…"}
            </p>
          )}
          <div ref={endRef} />
        </section>

        {pending.map((request) => (
          <section
            key={request.requestId}
            className="border border-yellow-800 bg-yellow-950/20 rounded-lg p-4 space-y-3"
          >
            <h2 className="text-xs uppercase tracking-wider text-yellow-600">
              {request.kind === "tool-approval"
                ? "Approval required"
                : request.kind === "session-limit"
                  ? "Session limit"
                  : "Question"}
            </h2>
            <p className="text-sm text-gray-200 whitespace-pre-wrap">
              {request.prompt}
            </p>
            <div className="flex flex-wrap gap-2">
              {request.options?.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() =>
                    void agent.respond([
                      { requestId: request.requestId, optionId: option.id },
                    ])
                  }
                  className={
                    option.style === "danger"
                      ? "bg-red-800 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded transition-colors"
                      : "bg-green-700 hover:bg-green-600 text-white text-sm font-medium px-4 py-2 rounded transition-colors"
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>
          </section>
        ))}

        <form
          onSubmit={(event) => {
            event.preventDefault()
            send(draft)
          }}
          className="border border-gray-800 rounded-lg p-4 space-y-3 sticky bottom-6 bg-black"
        >
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                send(draft)
              }
            }}
            rows={3}
            placeholder="Ask about campaigns, contacts, ad performance…"
            className="w-full bg-gray-950 border border-gray-800 rounded p-3 text-sm text-white placeholder-gray-600 font-mono resize-none focus:outline-none focus:border-green-700"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              className="bg-green-700 hover:bg-green-600 disabled:bg-gray-800 disabled:text-gray-600 text-white text-sm font-medium px-4 py-2 rounded transition-colors"
            >
              Send
            </button>
            {busy && (
              <button
                type="button"
                onClick={() => void agent.cancel()}
                className="bg-gray-800 hover:bg-gray-700 text-white text-sm font-medium px-4 py-2 rounded transition-colors"
              >
                Stop
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}

/**
 * Render one message part. Text and reasoning are the common cases; the
 * `authorization` part is what a per-user Salesforce sign-in looks like in the
 * browser, and dynamic-tool parts show which tool ran.
 */
function MessagePart({ part }: { part: EveMessagePart }) {
  if (part.type === "text") {
    return (
      <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">
        {part.text}
      </p>
    )
  }

  if (part.type === "reasoning") {
    return (
      <p className="text-xs text-gray-600 whitespace-pre-wrap italic">
        {part.text}
      </p>
    )
  }

  if (part.type === "authorization") {
    if (part.state === "completed") {
      return (
        <p className="text-sm text-gray-400">
          {part.outcome === "authorized"
            ? `${part.displayName} connected.`
            : `${part.displayName} authorization ${part.outcome}.`}
        </p>
      )
    }
    return (
      <div className="border border-blue-800 bg-blue-950/20 rounded p-3 space-y-2">
        <p className="text-sm text-gray-200">{part.description}</p>
        {part.authorization?.userCode && (
          <code className="block text-sm text-blue-300">
            {part.authorization.userCode}
          </code>
        )}
        {part.authorization?.url && (
          <a
            href={part.authorization.url}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-sm text-blue-400 hover:text-blue-300 underline"
          >
            Sign in
          </a>
        )}
      </div>
    )
  }

  if (part.type === "dynamic-tool") {
    return (
      <p className="text-xs text-gray-600">
        <span className="text-gray-500">{part.toolName}</span>
        {part.state === "output-error" && (
          <span className="text-red-400"> — failed</span>
        )}
      </p>
    )
  }

  return null
}

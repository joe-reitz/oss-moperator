/**
 * mOperator Agent API
 * Used by the CLI and any other direct API consumers
 */

import { generateText, stepCountIs } from "ai"
import { getAIModel } from "@/lib/ai"
import { getAllTools } from "@/lib/tools"
import { CLI_SYSTEM_PROMPT } from "@/lib/agent-config"

export const maxDuration = 60

export async function POST(req: Request) {
  try {
    const { messages: inputMessages } = await req.json()

    const messages = inputMessages.map((m: { role: string; content: string }) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }))

    const { text } = await generateText({
      model: getAIModel(),
      system: CLI_SYSTEM_PROMPT,
      tools: getAllTools(),
      stopWhen: stepCountIs(5),
      messages,
    })

    return new Response(text || "No response generated", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    })
  } catch (error) {
    console.error("[Agent] Error:", error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Agent error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    )
  }
}

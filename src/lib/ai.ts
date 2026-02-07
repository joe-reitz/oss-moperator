/**
 * AI Model Configuration
 *
 * Supports two modes:
 *
 * 1. Vercel AI Gateway (recommended) — set AI_GATEWAY_API_KEY
 *    Routes requests through a single gateway. Switch providers/models
 *    without managing multiple API keys or refactoring code.
 *
 * 2. Direct API keys — set ANTHROPIC_API_KEY or OPENAI_API_KEY
 *    Connect directly to a provider. Simpler if you only use one model.
 *
 * Defaults to Anthropic Claude.
 */

import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"

export type AIProvider = "openai" | "anthropic"

export function getAIModel() {
  const provider = (process.env.AI_PROVIDER as AIProvider) || "anthropic"
  const model =
    process.env.AI_MODEL ||
    (provider === "anthropic" ? "claude-sonnet-4-5-20250929" : "gpt-4o")

  const gatewayApiKey = process.env.AI_GATEWAY_API_KEY
  const gatewayUrl = process.env.AI_GATEWAY_URL || "https://ai-gateway.vercel.sh"

  // ── Option 1: AI Gateway (recommended) ──────────────────────────
  if (gatewayApiKey) {
    console.log(`[AI Gateway] Using ${provider}/${model}`)

    if (provider === "anthropic") {
      const anthropic = createAnthropic({
        baseURL: `${gatewayUrl}/v1`,
        apiKey: gatewayApiKey,
      })
      return anthropic(model)
    }

    const openai = createOpenAI({
      baseURL: `${gatewayUrl}/v1/openai`,
      apiKey: gatewayApiKey,
    })
    return openai(model)
  }

  // ── Option 2: Direct API keys ───────────────────────────────────
  if (provider === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      throw new Error(
        "No AI key configured. Set AI_GATEWAY_API_KEY (recommended) or ANTHROPIC_API_KEY. See /docs/ai-gateway for setup."
      )
    }
    console.log(`[AI Direct] Using anthropic/${model}`)
    const anthropic = createAnthropic({ apiKey })
    return anthropic(model)
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error(
      "No AI key configured. Set AI_GATEWAY_API_KEY (recommended) or OPENAI_API_KEY. See /docs/ai-gateway for setup."
    )
  }
  console.log(`[AI Direct] Using openai/${model}`)
  const openai = createOpenAI({ apiKey })
  return openai(model)
}

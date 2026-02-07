/**
 * AI Model Configuration
 *
 * Supports Anthropic (Claude) and OpenAI via AI SDK providers.
 * Set AI_PROVIDER env var to switch between them.
 */

import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"

const AI_PROVIDER = process.env.AI_PROVIDER || "anthropic"

function getAnthropicModel() {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required when AI_PROVIDER=anthropic")
  }

  const anthropic = createAnthropic({ apiKey })
  const modelId = process.env.AI_MODEL || "claude-sonnet-4-5-20250929"
  return anthropic(modelId)
}

function getOpenAIModel() {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required when AI_PROVIDER=openai")
  }

  const openai = createOpenAI({ apiKey })
  const modelId = process.env.AI_MODEL || "gpt-4o"
  return openai(modelId)
}

export function getAIModel() {
  switch (AI_PROVIDER) {
    case "openai":
      return getOpenAIModel()
    case "anthropic":
    default:
      return getAnthropicModel()
  }
}

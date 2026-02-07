/**
 * Integration Module Interface
 *
 * Each integration is self-contained and auto-activates based on env vars.
 * To add a new integration:
 * 1. Create a folder under src/lib/integrations/<name>/
 * 2. Export an Integration object from index.ts
 * 3. Register it in src/lib/integrations/index.ts
 */

import type { Tool } from "ai"

export interface Integration {
  /** Display name of the integration (e.g., "Salesforce") */
  name: string

  /** Short description of what this integration does */
  description: string

  /** List of capabilities for the system prompt */
  capabilities: string[]

  /** Example prompts users can try */
  examples: string[]

  /** Check if this integration is configured (env vars present) */
  isConfigured: () => boolean

  /** Return the AI SDK tools for this integration */
  getTools: () => Record<string, Tool>
}

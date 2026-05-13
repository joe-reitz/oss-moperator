import type { Integration } from "../types"
import { createLumaEvent } from "./tools"

export const lumaIntegration: Integration = {
  name: "Luma",
  description: "Event registration page creation on lu.ma with compliance questions baked in",
  capabilities: [
    "Create Luma events with attendee compliance questions",
    "Stamp a Salesforce Campaign with the Luma event ID after creating",
    "Resolve Luma slugs to canonical event IDs (for SFDC stamping)",
  ],
  examples: [
    "Create a Luma event for our launch party in NYC on March 15 at 6pm",
    "Set up a private registration page for the SF meetup next Tuesday",
  ],
  isConfigured: () => !!process.env.LUMA_API_KEY,
  getTools: () => ({ createLumaEvent }),
}

/**
 * Salesforce AI SDK Tools
 */

import { tool } from "ai"
import { z } from "zod"
import * as sf from "./client"

export const salesforceTools = {
  querySalesforce: tool({
    description: `Execute a SOQL query against Salesforce. Use this to retrieve data about Contacts, Leads, Accounts, Campaigns, CampaignMembers, and other Salesforce objects.

Example queries:
- "SELECT Id, Name, Status FROM Campaign WHERE IsActive = true"
- "SELECT Id, FirstName, LastName, Email FROM Contact WHERE AccountId = 'xxx'"
- "SELECT COUNT() FROM CampaignMember WHERE CampaignId = 'xxx'"`,
    inputSchema: z.object({
      soql: z.string().describe("The SOQL query to execute"),
    }),
    execute: async ({ soql }) => {
      try {
        const results = await sf.query(soql)
        return { success: true as const, count: results.length, records: results }
      } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : "Query failed" }
      }
    },
  }),

  describeSalesforceObject: tool({
    description: "Get the schema/fields of a Salesforce object. Use this to understand what fields are available before writing queries.",
    inputSchema: z.object({
      objectName: z.string().describe("The Salesforce object API name"),
    }),
    execute: async ({ objectName }) => {
      try {
        const desc = await sf.describeObject(objectName)
        const fields = desc.fields.map((f: { name: string; label: string; type: string; nillable: boolean }) => ({
          name: f.name, label: f.label, type: f.type, required: !f.nillable,
        }))
        return { success: true as const, objectName: desc.name, label: desc.label, fields: fields.slice(0, 50), totalFields: fields.length }
      } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : "Describe failed" }
      }
    },
  }),

  listSalesforceObjects: tool({
    description: "List commonly used Salesforce objects.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const global = await sf.describeGlobal()
        const relevant = global.sobjects
          .filter((obj: { name: string }) => ["Contact", "Lead", "Account", "Campaign", "CampaignMember", "Opportunity", "Task", "Event"].includes(obj.name))
          .map((obj: { name: string; label: string }) => ({ name: obj.name, label: obj.label }))
        return { success: true as const, objects: relevant }
      } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : "Failed" }
      }
    },
  }),

  addContactsToCampaign: tool({
    description: "Add one or more contacts to a Salesforce campaign.",
    inputSchema: z.object({
      campaignId: z.string().describe("The Salesforce Campaign ID"),
      contactIds: z.array(z.string()).describe("Array of Contact IDs to add"),
      status: z.string().optional().describe("Campaign member status (default: 'Sent')"),
    }),
    execute: async ({ campaignId, contactIds, status }) => {
      try {
        const result = await sf.addToCampaign(campaignId, contactIds, status)
        return { success: true as const, added: result.success, failed: result.failed }
      } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : "Failed" }
      }
    },
  }),

  updateSalesforceRecord: tool({
    description: "Update a record in Salesforce.",
    inputSchema: z.object({
      objectName: z.string().describe("The Salesforce object API name"),
      recordId: z.string().describe("The record ID to update"),
      data: z.record(z.string(), z.unknown()).describe("Field names and new values"),
    }),
    execute: async ({ objectName, recordId, data }) => {
      try {
        await sf.updateRecord(objectName, recordId, data)
        return { success: true as const, message: `Updated ${objectName} record ${recordId}` }
      } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : "Update failed" }
      }
    },
  }),

  createSalesforceRecord: tool({
    description: "Create a new record in Salesforce.",
    inputSchema: z.object({
      objectName: z.string().describe("The Salesforce object API name"),
      data: z.record(z.string(), z.unknown()).describe("Field names and values"),
    }),
    execute: async ({ objectName, data }) => {
      try {
        const id = await sf.createRecord(objectName, data)
        return { success: true as const, id, message: `Created ${objectName} record with ID ${id}` }
      } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : "Create failed" }
      }
    },
  }),

  deleteSalesforceRecord: tool({
    description: "Delete a record from Salesforce. Requires admin permissions.",
    inputSchema: z.object({
      objectName: z.string().describe("The Salesforce object API name"),
      recordId: z.string().describe("The record ID to delete"),
    }),
    execute: async ({ objectName, recordId }) => {
      try {
        await sf.deleteRecord(objectName, recordId)
        return { success: true as const, message: `Deleted ${objectName} record ${recordId}` }
      } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : "Delete failed" }
      }
    },
  }),

  bulkUpdateRecords: tool({
    description: "Update multiple Salesforce records in a single call. Pass an array of objects, each with an Id field and the fields to update.",
    inputSchema: z.object({
      objectName: z.string().describe("The Salesforce object API name"),
      records: z.array(z.object({ Id: z.string() }).passthrough()).describe("Array of records with Id and fields to update"),
    }),
    execute: async ({ objectName, records }) => {
      try {
        const result = await sf.bulkUpdateRecords(objectName, records as Array<{ Id: string; [key: string]: unknown }>)
        return { success: true as const, updated: result.success, failed: result.failed, errors: result.errors.slice(0, 10), message: `Updated ${result.success} records, ${result.failed} failed` }
      } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : "Bulk update failed" }
      }
    },
  }),
}

/**
 * Find files in the sandbox by glob pattern.
 *
 * Enabled because the agent works with real files now: CSV exports it wrote
 * earlier in the session, and CSVs a user dropped into Slack (which land in
 * /workspace/attachments). Without this it has to guess at paths.
 */

import { defineGlobTool } from "eve/tools"

export default defineGlobTool()

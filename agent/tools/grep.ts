/**
 * Search sandbox file contents by regex.
 *
 * Pairs with `glob` and `bash`: locating the three rows that broke an import
 * beats loading a 200k-row CSV into context.
 */

import { defineGrepTool } from "eve/tools"

export default defineGrepTool()

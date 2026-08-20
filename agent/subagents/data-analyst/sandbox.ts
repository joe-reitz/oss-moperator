/**
 * The analyst gets the same sandbox as the root agent.
 *
 * A declared subagent inherits nothing, sandbox included — without this file it
 * would fall back to the framework default and have no pandas, which is most of
 * what the analyst exists to use. Re-exporting the root definition keeps one
 * bootstrap to maintain.
 */

export { default } from "../../sandbox/sandbox"

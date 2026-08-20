/**
 * The agent's sandbox: an isolated filesystem and shell at /workspace.
 *
 * This is the single biggest capability the pivot adds. Before, a query result
 * had to fit in the model's context, so "analyze last quarter's campaign
 * performance" meant reading 50 rows and hoping they were representative, and a
 * CSV someone dropped into Slack was truncated to 10,000 characters and pasted
 * into the prompt.
 *
 * Now a tool writes the full result set to /workspace and the model reasons
 * about it with pandas: 200,000 rows of campaign members deduped, joined
 * against an uploaded list, and summarized, with only the summary entering
 * context. Inbound Slack attachments land in /workspace/attachments, so the
 * same applies to files a person sends.
 *
 * `bootstrap` runs once per template and is inherited by every later session,
 * so the pip install is not paid per conversation.
 */

import { defineSandbox } from "eve/sandbox"

export default defineSandbox({
  /**
   * Data tooling the agent is told it can rely on. Keep this list short: every
   * package is template build time, and the model only benefits from what the
   * instructions actually mention.
   */
  async bootstrap({ use }) {
    const sandbox = await use()

    // `python3 -m pip` rather than a bare `pip`, which is not always on PATH in
    // the base image. `--break-system-packages` is required on Debian-derived
    // images with PEP 668 marking the system Python as externally managed.
    const install = await sandbox.run({
      command:
        "python3 -m pip install --quiet --break-system-packages " +
        "pandas pyarrow tabulate python-dateutil",
    })

    if (install.exitCode !== 0) {
      // Not fatal: the agent can still use bash, awk, sort, and node. Surface it
      // so a forker sees why pandas is missing instead of debugging at runtime.
      console.warn(
        "[sandbox] Data package install failed; pandas-based analysis will not be available.",
        install.stderr?.slice(0, 2000)
      )
    }

    // A predictable home for intermediate work, so the agent is not inventing
    // directory layouts mid-task.
    await sandbox.run({ command: "mkdir -p /workspace/exports /workspace/scratch" })
  },
})

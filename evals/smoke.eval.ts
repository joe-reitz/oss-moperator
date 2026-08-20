/**
 * The agent boots, accepts a request, and answers.
 *
 * Deliberately requires no integration: this is the eval that tells a forker
 * whether their model credential and agent wiring are correct, separately from
 * whether their CRM keys are.
 */

import { defineEval } from "eve/evals"

export default defineEval({
  description: "The agent boots and answers a question about its own capabilities.",
  async test(t) {
    await t.send(
      "What systems can you reach right now, and what can't you do? Be brief."
    )
    t.succeeded()
    t.judge.autoevals.closedQA(
      "Does the reply describe which systems the agent is or is not connected to, without inventing a capability?"
    )
  },
})

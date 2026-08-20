/**
 * Durable sleep.
 *
 * Marketing ops work waits on other systems: a Marketo batch import, a
 * Salesforce bulk job, an ad platform taking a few minutes to report yesterday.
 * This pauses the turn without holding a function open — the runtime resumes it
 * when the time is up, so a ten-minute wait costs nothing.
 */

import { sleep } from "eve/tools/sleep"

export default sleep()

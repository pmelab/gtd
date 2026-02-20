import { Formatter, type IFormatterOptions } from "@cucumber/cucumber"
import type { Envelope } from "@cucumber/messages"

export default class VerboseFormatter extends Formatter {
  constructor(options: IFormatterOptions) {
    super(options)
    if (process.env["GTD_E2E_VERBOSE"] === "1") {
      options.eventBroadcaster.on("envelope", (envelope: Envelope) => {
        if (envelope.testCaseStarted) {
          process.stderr.write("\n── Scenario started ──\n")
        }
        if (envelope.testStepFinished) {
          const status = envelope.testStepFinished.testStepResult?.status
          process.stderr.write(`  Step: ${status}\n`)
        }
      })
    }
  }
}

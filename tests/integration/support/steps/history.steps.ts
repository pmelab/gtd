import { Given } from "quickpickle"
import assert from "node:assert"
import type { GtdWorld } from "../world.js"

// A process history is replayed, never asserted into being: these steps build
// one by landing real turns, each failing the scenario unless it produced
// exactly the commit subject the scenario names.

const expectSubject = (world: GtdWorld, subject: string): void => {
  assert.strictEqual(
    world.lastResult.exitCode,
    0,
    `setup landing for "${subject}" failed with exit ${world.lastResult.exitCode}\nstderr: ${world.lastResult.stderr}\nLog:\n${world.gitLog()}`,
  )
  assert.strictEqual(
    world.lastCommitSubject(),
    subject,
    `setup landing expected "${subject}". Got "${world.lastCommitSubject()}".\nstderr: ${world.lastResult.stderr}\nLog:\n${world.gitLog()}`,
  )
}

Given("gtd lands {string}", async (world: GtdWorld, subject: string) => {
  await world.runGtd("land")
  expectSubject(world, subject)
})

// A workflow's opening commit is subjected to its first step, which the
// bundled workflows fix: the scenario names the workflow, not that step.
const FIRST_STEP: Readonly<Record<string, string>> = {
  fix: "fix-precheck",
  review: "review-gate.check",
}

Given("gtd starts workflow {string}", async (world: GtdWorld, workflow: string) => {
  await world.runGtd("--workflow", workflow)
  expectSubject(world, `gtd(human): ${FIRST_STEP[workflow] ?? workflow}`)
})

Given(
  "gtd starts workflow {string} with {string}",
  async (world: GtdWorld, workflow: string, args: string) => {
    await world.runGtd("--workflow", workflow, ...args.split(" "))
    expectSubject(world, `gtd(human): ${FIRST_STEP[workflow] ?? workflow}`)
  },
)

Given("gtd lands {string} judging:", async (world: GtdWorld, subject: string, verdict: string) => {
  await world.runGtdJudgeAnswerWithStdin(String(verdict))
  expectSubject(world, subject)
})

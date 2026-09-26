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

Given(
  "gtd lands {string} with {string}",
  async (world: GtdWorld, subject: string, args: string) => {
    await world.runGtd("land", ...args.split(" "))
    expectSubject(world, subject)
  },
)

Given("gtd enters {string}", async (world: GtdWorld, entry: string) => {
  await world.runGtd("--entry", entry)
  expectSubject(world, `gtd(human): ${entry}`)
})

Given("gtd enters {string} with {string}", async (world: GtdWorld, entry: string, args: string) => {
  await world.runGtd("--entry", entry, ...args.split(" "))
  expectSubject(world, `gtd(human): ${entry}`)
})

Given("gtd lands {string} judging:", async (world: GtdWorld, subject: string, verdict: string) => {
  await world.runGtdJudgeAnswerWithStdin(String(verdict))
  expectSubject(world, subject)
})

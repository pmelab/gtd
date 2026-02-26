import { Then } from "@cucumber/cucumber"
import assert from "node:assert"
import type { GtdWorld } from "../world.js"

Then("it succeeds", function (this: GtdWorld) {
  assert.strictEqual(
    this.lastResult.exitCode,
    0,
    `Expected exit code 0 but got ${this.lastResult.exitCode}\nstdout: ${this.lastResult.stdout}\nstderr: ${this.lastResult.stderr}`,
  )
})

Then("git log contains {string}", function (this: GtdWorld, text: string) {
  const log = this.gitLog()
  assert.ok(log.includes(text), `Expected git log to contain "${text}":\n${log}`)
})

Then("last commit prefix is {string}", function (this: GtdWorld, prefix: string) {
  const actual = this.lastCommitPrefix()
  assert.strictEqual(actual, prefix, `Expected last commit prefix "${prefix}" but got "${actual}"`)
})

Then("{string} contains {string}", function (this: GtdWorld, file: string, text: string) {
  const content = this.repoFile(file)
  assert.ok(content.includes(text), `Expected "${file}" to contain "${text}":\n${content}`)
})

Then(
  "{string} does not contain {string}",
  function (this: GtdWorld, file: string, text: string) {
    const content = this.repoFile(file)
    assert.ok(!content.includes(text), `Expected "${file}" to NOT contain "${text}":\n${content}`)
  },
)

Then("output contains {string}", function (this: GtdWorld, text: string) {
  const combined = this.lastResult.stdout + this.lastResult.stderr
  assert.ok(
    combined.includes(text),
    `Expected output to contain "${text}":\nstdout: ${this.lastResult.stdout}\nstderr: ${this.lastResult.stderr}`,
  )
})

Then("{string} exists", function (this: GtdWorld, file: string) {
  assert.ok(this.repoFileExists(file), `Expected "${file}" to exist`)
})

Then("{string} does not exist", function (this: GtdWorld, file: string) {
  assert.ok(!this.repoFileExists(file), `Expected "${file}" to NOT exist`)
})

Then("npm test passes", function (this: GtdWorld) {
  const result = this.execInRepo("npm", ["test"])
  assert.ok(result !== undefined, "npm test should complete")
})

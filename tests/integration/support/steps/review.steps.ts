import { Then, When } from "@cucumber/cucumber"
import { existsSync } from "node:fs"
import { join } from "node:path"
import assert from "node:assert"
import type { GtdWorld } from "../world.js"

When("I run gtd with ref {string}", function (this: GtdWorld, ref: string) {
  this.runGtd(ref)
})

Then("it fails", function (this: GtdWorld) {
  assert.notStrictEqual(
    this.lastResult.exitCode,
    0,
    `Expected non-zero exit code, but got 0.\nstdout: ${this.lastResult.stdout}`,
  )
})

Then("stderr contains {string}", function (this: GtdWorld, text: string) {
  assert.ok(
    this.lastResult.stderr.includes(text),
    `Expected stderr to contain "${text}". Got:\n${this.lastResult.stderr}`,
  )
})

Then("a file named {string} should not exist", function (this: GtdWorld, path: string) {
  const full = join(this.repoDir, path)
  assert.ok(!existsSync(full), `Expected file "${path}" to not exist, but it does.`)
})

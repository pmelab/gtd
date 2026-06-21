import { Then } from "@cucumber/cucumber"
import assert from "node:assert"
import type { GtdWorld } from "../world.js"

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

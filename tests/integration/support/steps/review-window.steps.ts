import { execFileSync } from "node:child_process"
import { Then } from "quickpickle"
import assert from "node:assert"
import type { GtdWorld } from "../world.js"

Then("the git ref {string} exists", (world: GtdWorld, ref: string) => {
  assert.ok(world.gitRefExists(ref), `Expected the git ref "${ref}" to exist.`)
})

Then("the git ref {string} does not exist", (world: GtdWorld, ref: string) => {
  assert.ok(!world.gitRefExists(ref), `Expected the git ref "${ref}" NOT to exist.`)
})

Then("the current commit is the same as {string}", (world: GtdWorld, name: string) => {
  const current = world.repo !== undefined ? world.repo.resolveRef("HEAD") : undefined
  if (world.repo !== undefined) {
    assert.strictEqual(current, world.repo.resolveRef(name), `Expected HEAD to still be "${name}".`)
    return
  }
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: world.repoDir,
    encoding: "utf-8",
  }).trim()
  const marked = execFileSync("git", ["rev-parse", name], {
    cwd: world.repoDir,
    encoding: "utf-8",
  }).trim()
  assert.strictEqual(head, marked, `Expected HEAD to still be "${name}".`)
})

// `refs/worktree/gtd/` is per-worktree (`git for-each-ref` sees it fine from
// the main worktree used in these scenarios) — asserts no ref anywhere under
// that prefix exists, not just a specific named one.
Then("no ref under {string} was created", (world: GtdWorld, prefix: string) => {
  const out = execFileSync("git", ["for-each-ref", prefix], {
    cwd: world.repoDir,
    encoding: "utf-8",
  }).trim()
  assert.strictEqual(out, "", `Expected no ref under "${prefix}", found:\n${out}`)
})

Then("the git status contains {string}", (world: GtdWorld, text: string) => {
  const status = world.gitStatus()
  assert.ok(status.includes(text), `Expected git status to contain "${text}". Got:\n${status}`)
})

Then("the git status does not contain {string}", (world: GtdWorld, text: string) => {
  const status = world.gitStatus()
  assert.ok(!status.includes(text), `Expected git status NOT to contain "${text}". Got:\n${status}`)
})

import { Given, Then, When } from "quickpickle"
import assert from "node:assert"
import { execFileSync } from "node:child_process"
import { chmodSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { GtdWorld } from "../world.js"

const git = (world: GtdWorld, ...args: string[]): string =>
  execFileSync("git", args, { cwd: world.repoDir, encoding: "utf-8", stdio: "pipe" }).trim()

const branchTip = (world: GtdWorld, branch: string): string | undefined => {
  if (world.tier === "inmem") return world.repo!.resolveRef(`refs/heads/${branch}`) ?? undefined
  try {
    return git(world, "rev-parse", "--verify", "-q", `refs/heads/${branch}`)
  } catch {
    return undefined
  }
}

const currentBranch = (world: GtdWorld): string =>
  world.tier === "inmem" ? world.repo!.branchName() : git(world, "branch", "--show-current")

const resolve = (world: GtdWorld, name: string): string | undefined =>
  world.tier === "inmem"
    ? (world.repo!.resolveRef(name) ?? undefined)
    : git(world, "rev-parse", "--verify", name)

Given("a branch {string} at the current commit", (world: GtdWorld, name: string) => {
  if (world.tier === "inmem") world.repo!.createBranch(name, "HEAD")
  else git(world, "branch", name)
})

Given("the branch {string} is checked out", (world: GtdWorld, name: string) => {
  if (world.tier === "inmem") world.repo!.checkoutBranch(name)
  else git(world, "checkout", "-q", name)
})

Given("a remote {string} that accepts pushes", (world: GtdWorld, name: string) => {
  if (world.tier === "inmem") {
    world.repo!.addRemote(name)
    return
  }
  const bare = mkdtempSync(join(tmpdir(), "gtd-test-remote-"))
  world.closers.push(async () => rmSync(bare, { recursive: true, force: true }))
  execFileSync("git", ["init", "-q", "--bare"], { cwd: bare, stdio: "pipe" })
  git(world, "remote", "add", name, bare)
})

Then("the current branch is {string}", (world: GtdWorld, name: string) => {
  assert.strictEqual(currentBranch(world), name)
})

Then("the branch {string} is at {string}", (world: GtdWorld, branch: string, mark: string) => {
  assert.strictEqual(branchTip(world, branch), resolve(world, mark))
})

Then("the branch {string} does not exist", (world: GtdWorld, branch: string) => {
  assert.strictEqual(branchTip(world, branch), undefined)
})

Then(
  "the remote {string} holds the history ref of {string} at {string}",
  (world: GtdWorld, remote: string, entry: string, mark: string) => {
    const ref = `refs/gtd/history/${resolve(world, entry)}`
    const held =
      world.tier === "inmem"
        ? world.repo!.remoteRefs(remote).get(ref)
        : git(world, "ls-remote", remote, ref).split(/\s/)[0]
    assert.strictEqual(held, resolve(world, mark))
  },
)

Then("the history ref of {string} does not exist", (world: GtdWorld, entry: string) => {
  assert.ok(!world.gitRefExists(`refs/gtd/history/${resolve(world, entry)}`))
})

When("I run the script beat", async (world: GtdWorld) => {
  await world.runScriptBeat()
})

const fileAt = (world: GtdWorld, ref: string, path: string): string | undefined => {
  if (world.tier === "inmem") return world.repo!.fileAtRef(ref, path) ?? undefined
  try {
    return execFileSync("git", ["show", `${ref}:${path}`], {
      cwd: world.repoDir,
      encoding: "utf-8",
      stdio: "pipe",
    })
  } catch {
    return undefined
  }
}

const messageAt = (world: GtdWorld, ref: string): string =>
  world.tier === "inmem"
    ? (world.repo!.lastCommitMessage(ref) ?? "")
    : git(world, "log", "-1", "--format=%B", ref)

Then(
  "the branch {string} holds {string} with:",
  (world: GtdWorld, branch: string, path: string, content: string) => {
    assert.strictEqual(fileAt(world, `refs/heads/${branch}`, path)?.trimEnd(), content.trimEnd())
  },
)

Then("the branch {string} holds no {string}", (world: GtdWorld, branch: string, path: string) => {
  assert.strictEqual(fileAt(world, `refs/heads/${branch}`, path), undefined)
})

Then(
  "the branch {string} tip message contains {string}",
  (world: GtdWorld, branch: string, text: string) => {
    const message = messageAt(world, `refs/heads/${branch}`)
    assert.ok(message.includes(text), `expected ${JSON.stringify(text)} in:\n${message}`)
  },
)

Then(
  "the branch {string} tip message is {string}",
  (world: GtdWorld, branch: string, text: string) => {
    assert.strictEqual(messageAt(world, `refs/heads/${branch}`).trim(), text)
  },
)

Then(
  "the branch {string} tip's parent is at {string}",
  (world: GtdWorld, branch: string, mark: string) => {
    const tip = branchTip(world, branch)
    assert.ok(tip !== undefined, `branch ${branch} does not exist`)
    assert.strictEqual(resolve(world, `${tip}~1`), resolve(world, mark))
  },
)

Then(
  "the branch {string} tip subject is {string}",
  (world: GtdWorld, branch: string, subject: string) => {
    assert.strictEqual(messageAt(world, `refs/heads/${branch}`).split("\n")[0], subject)
  },
)

Given(
  "I mark the branch {string} tip as {string}",
  (world: GtdWorld, branch: string, name: string) => {
    const tip = branchTip(world, branch)
    assert.ok(tip !== undefined, `branch ${branch} does not exist`)
    if (world.tier === "inmem") world.repo!.updateRef(name, tip)
    else git(world, "branch", name, tip)
  },
)

Given("the file {string} is executable", (world: GtdWorld, path: string) => {
  if (world.tier === "inmem") world.repo!.setExecutable(path, true)
  else chmodSync(join(world.repoDir, path), 0o755)
})

Then(
  "the branch {string} holds {string} as executable",
  (world: GtdWorld, branch: string, path: string) => {
    const ref = `refs/heads/${branch}`
    const mode =
      world.tier === "inmem"
        ? world.repo!.modesAt(ref).get(path)
        : git(world, "ls-tree", ref, "--", path).split(" ")[0]
    assert.strictEqual(mode, "100755")
  },
)

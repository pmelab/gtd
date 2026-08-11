import { Given, Then, When } from "quickpickle"
import { execFileSync } from "node:child_process"
import { writeFileSync, mkdirSync, mkdtempSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert"
import type { GtdWorld } from "../world.js"
import { createTestProject } from "../../helpers/project-setup.js"

const _require = createRequire(import.meta.url)

// ── Repo / branch setup ──────────────────────────────────────────────────────

Given("a test project", (world: GtdWorld) => {
  if (world.tier === "inmem") {
    // Seed the in-memory repo with the same initial state as createTestProject:
    // .gitignore, README.md, one "chore: initial commit".
    const repo = world.repo!
    repo.writeFile(".gitignore", "node_modules\n")
    repo.writeFile("README.md", "# test project\n")
    repo.commitAllWithPrefix("chore: initial commit")
    // repoDir is not used for inmem tier, but set a sentinel to avoid undefined errors
    world.repoDir = "/inmem"
  } else {
    world.repoDir = createTestProject()
  }
})

// The unborn-HEAD case "a test project" deliberately doesn't cover: no
// initial commit at all, so `git rev-parse HEAD` has nothing to resolve.
// Inmem: the Before hook's `new InMemRepo()` is already commit-less — nothing
// to seed. Live: `git init` plus the author identity `commit --allow-empty`
// needs, and nothing else.
Given("a git repository with no commits", (world: GtdWorld) => {
  if (world.tier === "inmem") {
    world.repoDir = "/inmem"
    return
  }
  const dir = mkdtempSync(join(tmpdir(), "gtd-test-unborn-"))
  execFileSync("git", ["init", "-q"], { cwd: dir })
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir })
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: dir })
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir })
  world.repoDir = dir
})

// ── Working-tree file edits (uncommitted) ────────────────────────────────────

function writeRepoFile(world: GtdWorld, path: string, content: string, createDirs = true): void {
  const normalized = content.endsWith("\n") ? content : content + "\n"
  if (world.tier === "inmem") {
    world.repo!.writeFile(path, normalized)
  } else {
    const full = join(world.repoDir, path)
    if (createDirs) mkdirSync(join(full, ".."), { recursive: true })
    writeFileSync(full, normalized)
  }
}

Given("a file {string} with:", (world: GtdWorld, path: string, content: string) => {
  writeRepoFile(world, path, content)
})

Given("{string} is modified to:", (world: GtdWorld, path: string, content: string) => {
  writeRepoFile(world, path, content, false)
})

// Plain working-tree deletion — what an editor's "delete file" does. Distinct
// from "a deleted committed file" (git rm), which refuses when the index entry
// differs from HEAD.
Given("the file {string} is deleted", (world: GtdWorld, path: string) => {
  world.deleteWorktreeFile(path)
})

// ── Committed history (one step = one commit) ────────────────────────────────

// The workhorse commit builder: stage exactly `path` with the given content and
// commit it under the verbatim subject. Scenarios spell out the flat `gtd: …`
// subject and the file content, so the landed history is visible in the text.
Given(
  "a commit {string} that adds {string} with:",
  (world: GtdWorld, message: string, path: string, content: string) => {
    const normalized = content.endsWith("\n") ? content : content + "\n"
    if (world.tier === "inmem") {
      world.repo!.writeFile(path, normalized)
      world.repo!.commitAllWithPrefix(message)
    } else {
      const full = join(world.repoDir, path)
      mkdirSync(join(full, ".."), { recursive: true })
      writeFileSync(full, normalized)
      execFileSync("git", ["add", path], { cwd: world.repoDir, stdio: "pipe" })
      execFileSync("git", ["commit", "-q", "-m", message], { cwd: world.repoDir, stdio: "pipe" })
    }
  },
)

// A commit that changes NOTHING — subject only, no file touched (like a gtd
// workflow turn that only advances state). Maps to one `git commit
// --allow-empty`; composable anywhere the commit-builder steps are.
Given("an empty commit {string}", (world: GtdWorld, message: string) => {
  if (world.tier === "inmem") {
    world.repo!.commitAllWithPrefix(message)
  } else {
    execFileSync("git", ["commit", "-q", "--allow-empty", "-m", message], {
      cwd: world.repoDir,
      stdio: "pipe",
    })
  }
})

// Commits everything currently in the working tree under one chore commit —
// the "I've reviewed the scaffold, now commit it" move a human makes after
// `gtd init`, so the machine starts from a clean tree at the initial state.
// Composable with any preceding file edits (e.g. editing an extracted
// `gtd-prompts/*.md` before committing).
Given("the working tree is committed", (world: GtdWorld) => {
  if (world.tier === "inmem") {
    world.repo!.commitAllWithPrefix("chore: commit working tree")
  } else {
    execFileSync("git", ["add", "-A"], { cwd: world.repoDir, stdio: "pipe" })
    execFileSync("git", ["commit", "-q", "-m", "chore: commit working tree"], {
      cwd: world.repoDir,
      stdio: "pipe",
    })
  }
})

// Bookmarks the CURRENT commit under a name a later step can reference as a
// `<commitish>` (e.g. `gtd review <name>`) — a repo-local ref, exactly like
// `git branch <name>` (real git) or a plain named ref (in-memory). Composable
// with everything else here: scenarios build normal history around the mark
// with the ordinary commit-builder steps, then refer back to it by name
// regardless of how far HEAD has since moved.
Given("I mark the current commit as {string}", (world: GtdWorld, name: string) => {
  if (world.tier === "inmem") {
    world.repo!.updateRef(name, "HEAD")
  } else {
    execFileSync("git", ["branch", name], { cwd: world.repoDir, stdio: "pipe" })
  }
})

// `git reset --hard <name>` — moves HEAD, the index, AND the worktree back to
// a previously-marked commit (see the step above), so the NEXT commit-builder
// step starts a sibling history off that same point rather than continuing
// the current tip. Used to build two diverging branches off one shared base
// (e.g. to prove a commit on one is NOT an ancestor of the other).
Given("I hard-reset to {string}", (world: GtdWorld, name: string) => {
  if (world.tier === "inmem") {
    world.repo!.hardResetTo(name)
  } else {
    execFileSync("git", ["reset", "--hard", name], { cwd: world.repoDir, stdio: "pipe" })
  }
})

// ── Invocation ───────────────────────────────────────────────────────────────

When("I run gtd", async (world: GtdWorld) => {
  await world.runGtd()
})

When("I run gtd with {string}", async (world: GtdWorld, arg: string) => {
  await world.runGtd(arg)
})

When("I run gtd land", async (world: GtdWorld) => {
  await world.runGtd("land")
})

When("I run gtd land with {string}", async (world: GtdWorld, arg: string) => {
  await world.runGtd("land", arg)
})

When(
  "I run gtd land with {string} and {string}",
  async (world: GtdWorld, arg1: string, arg2: string) => {
    await world.runGtd("land", arg1, arg2)
  },
)

When(
  "I run gtd land with {string} and {string} and {string}",
  async (world: GtdWorld, arg1: string, arg2: string, arg3: string) => {
    await world.runGtd("land", arg1, arg2, arg3)
  },
)

When("I run gtd land piped to bash", async (world: GtdWorld) => {
  await world.runGtdLandPiped()
})

When("I run gtd next", async (world: GtdWorld) => {
  await world.runGtd("next")
})

When("I run gtd next with {string}", async (world: GtdWorld, arg: string) => {
  await world.runGtd("next", arg)
})

When(
  "I run gtd next with {string} and {string}",
  async (world: GtdWorld, arg1: string, arg2: string) => {
    await world.runGtd("next", arg1, arg2)
  },
)

When("I run gtd status", async (world: GtdWorld) => {
  await world.runGtd("status")
})

When("I run gtd status with {string}", async (world: GtdWorld, arg: string) => {
  await world.runGtd("status", arg)
})

// ── Assertions ───────────────────────────────────────────────────────────────

Then("it succeeds", (world: GtdWorld) => {
  assert.strictEqual(
    world.lastResult.exitCode,
    0,
    `exit ${world.lastResult.exitCode}\nstderr: ${world.lastResult.stderr}`,
  )
})

// `gtd land`'s SETTLED signal — exit 3, nothing owed. Distinct from `it
// succeeds` (strictly 0): a settled landing's stdout still carries a script a
// driver must run, but the exit code itself already says "stop, don't spin".
Then("it settles", (world: GtdWorld) => {
  assert.strictEqual(
    world.lastResult.exitCode,
    3,
    `exit ${world.lastResult.exitCode}\nstderr: ${world.lastResult.stderr}`,
  )
})

Then("it fails", (world: GtdWorld) => {
  assert.notStrictEqual(
    world.lastResult.exitCode,
    0,
    `Expected non-zero exit code, but got 0.\nstdout: ${world.lastResult.stdout}`,
  )
})

Then("stdout contains {string}", (world: GtdWorld, text: string) => {
  assert.ok(
    world.lastResult.stdout.includes(text),
    `Expected stdout to contain "${text}". Got:\n${world.lastResult.stdout}`,
  )
})

Then("stdout matches {string}", (world: GtdWorld, pattern: string) => {
  assert.ok(
    new RegExp(pattern).test(world.lastResult.stdout),
    `Expected stdout to match /${pattern}/. Got:\n${world.lastResult.stdout}`,
  )
})

Then("stdout does not contain {string}", (world: GtdWorld, text: string) => {
  assert.ok(
    !world.lastResult.stdout.includes(text),
    `Expected stdout NOT to contain "${text}". Got:\n${world.lastResult.stdout}`,
  )
})

// Counts NON-OVERLAPPING occurrences of `text` in stdout — used to prove a
// transition line was printed exactly once even when the review checkout
// window rewinds HEAD between beats (each transition's own required script
// prints it exactly once, at the turn that produced it — see
// src/OutcomeScript.ts).
Then(
  "stdout contains {string} exactly {int} times",
  (world: GtdWorld, text: string, count: number) => {
    const stdout = world.lastResult.stdout
    let actual = 0
    let idx = 0
    while ((idx = stdout.indexOf(text, idx)) !== -1) {
      actual++
      idx += text.length
    }
    assert.strictEqual(
      actual,
      count,
      `Expected stdout to contain "${text}" exactly ${count} times, found ${actual}. Got:\n${stdout}`,
    )
  },
)

/**
 * Asserts on `world.lastScriptOutput` — what the last driven write command's
 * `required`/`optional` scripts themselves printed (`src/OutcomeScript.ts`'s
 * `gtd_report_*` calls), distinct from `world.lastResult.stdout` (gtd's own
 * plain-text line). LIVE tier only: the in-memory tier's `applyEmittedScript`
 * treats an outcome block as inert and prints nothing (see its own module
 * doc comment's "outcome blocks are inert" decision), so a scenario tagged
 * `@inmem` asking this question would silently prove nothing — this fails
 * loudly instead, naming the tier, rather than passing on an empty string.
 */
Then("the emitted script printed {string}", (world: GtdWorld, text: string) => {
  assert.strictEqual(
    world.tier,
    "live",
    "the emitted script's own stdout is a @live-only observation — the in-memory tier never runs an outcome block, it only recognizes it as inert",
  )
  assert.ok(
    world.lastScriptOutput.includes(text),
    `Expected the emitted script's output to contain "${text}". Got:\n${world.lastScriptOutput}`,
  )
})

Then("stderr matches {string}", (world: GtdWorld, pattern: string) => {
  assert.ok(
    new RegExp(pattern).test(world.lastResult.stderr),
    `Expected stderr to match /${pattern}/. Got:\n${world.lastResult.stderr}`,
  )
})

Then("stderr contains {string}", (world: GtdWorld, text: string) => {
  assert.ok(
    world.lastResult.stderr.includes(text),
    `Expected stderr to contain "${text}". Got:\n${world.lastResult.stderr}`,
  )
})

// Reads package.json's own `version` at run time (same technique as
// Cli.ts's GTD_VERSION) rather than a literal string, so this assertion
// doesn't go stale across semantic-release bumps.
Then("stderr contains the gtd version under test", (world: GtdWorld) => {
  const { version } = _require("../../../../package.json") as { version: string }
  assert.ok(
    world.lastResult.stderr.includes(version),
    `Expected stderr to contain the gtd version under test (${version}). Got:\n${world.lastResult.stderr}`,
  )
})

Then("stderr does not contain {string}", (world: GtdWorld, text: string) => {
  assert.ok(
    !world.lastResult.stderr.includes(text),
    `Expected stderr NOT to contain "${text}". Got:\n${world.lastResult.stderr}`,
  )
})

// Post-loop observables. Edge-driven auto states emit no prompt — a single `gtd`
// run performs the git action(s) and drives the loop forward — so assert the
// landed commit subject instead of a retired prompt string.
Then("the last commit subject is {string}", (world: GtdWorld, subject: string) => {
  assert.strictEqual(
    world.lastCommitSubject(),
    subject,
    `Expected last commit subject "${subject}". Got "${world.lastCommitSubject()}".\nLog:\n${world.gitLog()}`,
  )
})

Then("the git log contains {string}", (world: GtdWorld, subject: string) => {
  const log = world.gitLog()
  assert.ok(log.includes(subject), `Expected git log to contain "${subject}". Got:\n${log}`)
})

Then("the git log does not contain {string}", (world: GtdWorld, subject: string) => {
  const log = world.gitLog()
  assert.ok(!log.includes(subject), `Expected git log NOT to contain "${subject}". Got:\n${log}`)
})

// The last commit's body (everything after the subject line) — where a
// `Gtd-Cost:` trailer lands, and where a squash template's rendered body sits.
Then("the last commit body contains {string}", (world: GtdWorld, text: string) => {
  const body = world.lastCommitBody()
  assert.ok(body.includes(text), `Expected last commit body to contain "${text}". Got:\n${body}`)
})

// Resolves `name` (a mark from "I mark the current commit as ..." — or any
// other commitish) to its full hash, per tier.
function resolveHash(world: GtdWorld, name: string): string {
  const hash =
    world.tier === "inmem"
      ? world.repo!.resolveRef(name)
      : execFileSync("git", ["rev-parse", name], { cwd: world.repoDir, encoding: "utf-8" }).trim()
  assert.ok(hash, `Expected "${name}" to resolve to a commit hash`)
  return hash!
}

// Checks `name`'s hash appears in the last commit's body — e.g. the
// `Gtd-Review-Base: <hash>` trailer `gtd review <name>` writes.
Then("the last commit body contains the hash of {string}", (world: GtdWorld, name: string) => {
  const hash = resolveHash(world, name)
  const body = world.lastCommitBody()
  assert.ok(
    body.includes(hash),
    `Expected last commit body to contain the hash of "${name}" (${hash}). Got:\n${body}`,
  )
})

// Checks `name`'s hash appears in stdout — e.g. a prompt naming a diff base
// (`it.reviewBase`/`it.retainedBase`/`it.startCommit`) for the agent to `git
// diff` itself, rather than inlining diff content.
Then("stdout contains the hash of {string}", (world: GtdWorld, name: string) => {
  const hash = resolveHash(world, name)
  assert.ok(
    world.lastResult.stdout.includes(hash),
    `Expected stdout to contain the hash of "${name}" (${hash}). Got:\n${world.lastResult.stdout}`,
  )
})

Then("stdout does not contain the hash of {string}", (world: GtdWorld, name: string) => {
  const hash = resolveHash(world, name)
  assert.ok(
    !world.lastResult.stdout.includes(hash),
    `Expected stdout NOT to contain the hash of "${name}" (${hash}). Got:\n${world.lastResult.stdout}`,
  )
})

// Checks `name`'s hash appears in a repo file — e.g. a captured manifest
// naming the commit it was captured from, rather than inlining a diff.
Then("{string} contains the hash of {string}", (world: GtdWorld, path: string, name: string) => {
  const hash = resolveHash(world, name)
  const content = world.readRepoFile(path)
  assert.ok(
    content.includes(hash),
    `Expected "${path}" to contain the hash of "${name}" (${hash}). Got:\n${content}`,
  )
})

Then("the last commit body does not contain {string}", (world: GtdWorld, text: string) => {
  const body = world.lastCommitBody()
  assert.ok(
    !body.includes(text),
    `Expected last commit body NOT to contain "${text}". Got:\n${body}`,
  )
})

// ── Git status ───────────────────────────────────────────────────────────────

Then("the git status is clean", (world: GtdWorld) => {
  const status = world.gitStatus()
  assert.strictEqual(status.trim(), "", `Expected a clean git status. Got:\n${status}`)
})

Then("{string} exists", (world: GtdWorld, path: string) => {
  assert.ok(world.repoFileExists(path), `Expected "${path}" to exist.`)
})

Then("{string} does not exist", (world: GtdWorld, path: string) => {
  assert.ok(!world.repoFileExists(path), `Expected "${path}" NOT to exist.`)
})

Then("{string} contains {string}", (world: GtdWorld, path: string, text: string) => {
  const content = world.readRepoFile(path)
  assert.ok(content.includes(text), `Expected "${path}" to contain "${text}". Got:\n${content}`)
})

Then("{string} does not contain {string}", (world: GtdWorld, path: string, text: string) => {
  const content = world.readRepoFile(path)
  assert.ok(
    !content.includes(text),
    `Expected "${path}" NOT to contain "${text}". Got:\n${content}`,
  )
})

// Full-history assertion for journey scenarios: the exact commit subject
// sequence, oldest → newest, one subject per docstring line.
Then("the commit subjects from oldest to newest are:", (world: GtdWorld, doc: string) => {
  const actual =
    world.tier === "inmem"
      ? world
          .repo!.commitHistory()
          // Subject line only — commit bodies are not part of the sequence
          // assertion, matching the subprocess tier's `--format=%s`.
          .map((c) => c.message.split("\n")[0] ?? "")
          .join("\n")
      : execFileSync("git", ["log", "--reverse", "--format=%s"], {
          cwd: world.repoDir,
          encoding: "utf-8",
        }).trim()
  assert.strictEqual(
    actual,
    doc.trim(),
    `Commit subject sequence mismatch.\nExpected:\n${doc.trim()}\nActual:\n${actual}`,
  )
})

Then("I record the commit count", (world: GtdWorld) => {
  world.savedCommitCount = world.commitCount()
})

Then("the commit count is unchanged", (world: GtdWorld) => {
  const current = world.commitCount()
  assert.strictEqual(
    current,
    world.savedCommitCount,
    `Expected commit count to remain ${world.savedCommitCount}, got ${current}`,
  )
})

// Pulls an arbitrary field off the most recent `gtd next --json`/
// `gtd status --json` stdout (`world.lastResult.stdout`) — for scenarios
// comparing a COMPUTED value (the `<scope>#<hash>` memory key, a minted
// session id) across turns without knowing its exact value. `field` may be a
// dot path (e.g. "session.id") to reach into a nested object — the beat
// document's own dispatch block (`session: {id, resume}`) is the reason this
// walks rather than doing a single flat lookup.
const currentJsonField = (world: GtdWorld, field: string): string | undefined => {
  const value = field
    .split(".")
    .reduce<unknown>(
      (node, segment) =>
        node !== null && typeof node === "object"
          ? (node as Record<string, unknown>)[segment]
          : undefined,
      JSON.parse(world.lastResult.stdout) as unknown,
    )
  return value === undefined ? undefined : String(value)
}

Then(
  "the json field {string} contains {string}",
  (world: GtdWorld, field: string, text: string) => {
    const value = currentJsonField(world, field)
    assert.notStrictEqual(value, undefined, `no json field "${field}" on this turn`)
    assert.ok(
      value!.includes(text),
      `expected json field "${field}" to contain "${text}". Got:\n${value}`,
    )
  },
)

Then(
  "I record the json field {string} as {string}",
  (world: GtdWorld, field: string, label: string) => {
    world.recordedJsonFields[label] = currentJsonField(world, field)
  },
)

Then(
  "the json field {string} matches the one recorded as {string}",
  (world: GtdWorld, field: string, label: string) => {
    const recorded = world.recordedJsonFields[label]
    assert.notStrictEqual(recorded, undefined, `no json field was ever recorded as "${label}"`)
    assert.strictEqual(
      currentJsonField(world, field),
      recorded,
      `expected json field "${field}" to match the one recorded as "${label}" (${recorded})`,
    )
  },
)

// The top-level keys of the most recent `--json` command's stdout — for a
// drift guard proving a later document (`gtd install`'s briefing) still names
// every field a real command emits, without hand-listing them twice.
const currentJsonKeys = (world: GtdWorld): readonly string[] =>
  Object.keys(JSON.parse(world.lastResult.stdout) as Record<string, unknown>)

When("I record the JSON keys of stdout as {string}", (world: GtdWorld, label: string) => {
  world.recordedJsonKeys[label] = currentJsonKeys(world)
})

Then("stdout contains every JSON key recorded as {string}", (world: GtdWorld, label: string) => {
  const keys = world.recordedJsonKeys[label]
  assert.notStrictEqual(keys, undefined, `no JSON keys were ever recorded as "${label}"`)
  for (const key of keys!) {
    assert.ok(
      world.lastResult.stdout.includes(key),
      `Expected stdout to contain JSON key "${key}" (recorded as "${label}"). Got:\n${world.lastResult.stdout}`,
    )
  }
})

Then(
  "the json field {string} differs from the one recorded as {string}",
  (world: GtdWorld, field: string, label: string) => {
    const recorded = world.recordedJsonFields[label]
    assert.notStrictEqual(recorded, undefined, `no json field was ever recorded as "${label}"`)
    const current = currentJsonField(world, field)
    assert.notStrictEqual(
      current,
      undefined,
      `expected json field "${field}" on this turn, got none`,
    )
    assert.notStrictEqual(
      current,
      recorded,
      `expected json field "${field}" to differ from the one recorded as "${label}" (${recorded}), got the same value`,
    )
  },
)

Then("the commit count increased by {int}", (world: GtdWorld, n: number) => {
  assert.notStrictEqual(
    world.savedCommitCount,
    undefined,
    'No commit count was recorded. Run "I record the commit count" first.',
  )
  const current = world.commitCount()
  const expected = world.savedCommitCount! + n
  assert.strictEqual(
    current,
    expected,
    `Expected commit count to increase by ${n} (from ${world.savedCommitCount} to ${expected}), got ${current}`,
  )
})

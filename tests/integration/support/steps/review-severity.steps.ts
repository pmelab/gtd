import { Given, Then, When } from "quickpickle"
import assert from "node:assert"
import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { GtdWorld } from "../world.js"

// Steps for review-severity-tiers.feature: a review document is built from
// numbered pointer notes whose reviewer text is `item <n>`; the human's note
// replaces that line wholesale.

const REVIEW_CONFIG = `import { start } from "@pmelab/gtd/flows"
import { afterTail, baseline, buildTail, gate } from "@pmelab/gtd/workflows"

export {
  feature as default,
  feature,
  defaults,
  envDefaults,
  summary,
  base,
  steering,
  skills,
  access,
} from "@pmelab/gtd/workflows"

// review and fix as feature's own tail: a note is triaged and re-planned.
export async function review() {
  await gate("review-gate", "The baseline is red.")
  return afterTail(await buildTail(start()))
}

export async function fix() {
  if (await baseline("fix-precheck")) return
  return afterTail(await buildTail(start(), { fixFirst: true }))
}
`

const REVIEW_HEADER =
  "# Review: abc1234\n\n<!-- base: 0000000000000000000000000000000000000000 -->\n\n## calc\n"

const commitFile = (world: GtdWorld, path: string, content: string, message: string): void => {
  if (world.tier === "inmem") {
    world.repo!.writeFile(path, content)
    world.repo!.seedCommit(message)
    return
  }
  const full = join(world.repoDir, path)
  mkdirSync(join(full, ".."), { recursive: true })
  writeFileSync(full, content)
  execFileSync("git", ["add", path], { cwd: world.repoDir, stdio: "pipe" })
  execFileSync("git", ["commit", "-q", "-m", message], { cwd: world.repoDir, stdio: "pipe" })
}

const writeFileTo = (world: GtdWorld, path: string, content: string): void => {
  if (world.tier === "inmem") {
    world.repo!.writeFile(path, content)
    return
  }
  const full = join(world.repoDir, path)
  mkdirSync(join(full, ".."), { recursive: true })
  writeFileSync(full, content)
}

const landing = async (world: GtdWorld, subject: string): Promise<void> => {
  await world.runGtd("land")
  assert.strictEqual(
    world.lastResult.exitCode,
    0,
    `landing for "${subject}" failed: ${world.lastResult.stderr}\n${world.gitLog()}`,
  )
  assert.strictEqual(world.lastCommitSubject(), subject, `Log:\n${world.gitLog()}`)
}

const reviewDoc = (texts: readonly string[]): string =>
  REVIEW_HEADER +
  texts.map((text, i) => `- [ ] ./src/calc.ts#${i + 1}-${i + 1}\n${text}\n`).join("")

const reviewTexts = (world: GtdWorld, path: string): string[] => {
  const lines = world.readRepoFile(path).split("\n")
  const texts: string[] = []
  lines.forEach((line, i) => {
    if (/^- \[[ x]\] \.\/src\/calc\.ts#\d+-\d+$/.test(line)) texts.push(lines[i + 1] ?? "")
  })
  return texts
}

const setNotes = (world: GtdWorld, path: string, edits: ReadonlyMap<number, string>): void => {
  const texts = reviewTexts(world, path).map((t, i) => edits.get(i + 1) ?? t)
  writeFileTo(world, path, reviewDoc(texts))
}

const answers = (id: string, verdict: string, reversibility: string) => [
  { id, answer: verdict, p: 0.9 },
  { id: `${id}.security`, answer: "no", p: 0.9 },
  { id: `${id}.reversibility`, answer: reversibility, p: 0.9 },
  { id: `${id}.blastRadius`, answer: "local", p: 0.9 },
  { id: `${id}.newConcept`, answer: "no", p: 0.9 },
]

Given(
  "a gtd config file at {string} wiring review as feature's own tail",
  (world: GtdWorld, path: string) => {
    commitFile(world, path, REVIEW_CONFIG, `chore: add ${path}`)
  },
)

Given(
  "a file {string} with {int} pointer note(s) on {string}",
  (world: GtdWorld, path: string, count: number, target: string) => {
    assert.strictEqual(target, "src/calc.ts")
    writeFileTo(world, path, reviewDoc(Array.from({ length: count }, (_, i) => `item ${i + 1}`)))
  },
)

Given(
  "{string} is modified so note {int} reads {string} and note {int} reads {string}",
  (world: GtdWorld, path: string, a: number, textA: string, b: number, textB: string) => {
    setNotes(
      world,
      path,
      new Map([
        [a, textA],
        [b, textB],
      ]),
    )
  },
)

Given(
  "the other notes in {string} read {string}",
  (world: GtdWorld, path: string, text: string) => {
    const texts = reviewTexts(world, path).map((t) => (/^item \d+$/.test(t) ? text : t))
    writeFileTo(world, path, reviewDoc(texts))
  },
)

Given(
  "{string} note {int} reads {string}",
  (world: GtdWorld, path: string, n: number, text: string) => {
    setNotes(world, path, new Map([[n, text]]))
  },
)

Given(
  "{string} note {int} reads {string} and note {int} reads {string}",
  (world: GtdWorld, path: string, a: number, textA: string, b: number, textB: string) => {
    setNotes(
      world,
      path,
      new Map([
        [a, textA],
        [b, textB],
      ]),
    )
  },
)

// A second start: the process underway is abandoned and its work discarded,
// so the workflow restarts from the same committed history with new vars.
Given(
  "gtd started workflow {string} with {string}",
  async (world: GtdWorld, workflow: string, args: string) => {
    await world.runGtd("abandon")
    if (world.tier === "inmem") world.repo!.resetHard()
    else execFileSync("git", ["clean", "-fdq"], { cwd: world.repoDir, stdio: "pipe" })
    await world.runGtd("--workflow", workflow, ...args.split(" "))
    assert.strictEqual(
      world.lastCommitSubject(),
      "gtd(human): review-gate.check",
      world.lastResult.stderr + world.lastResult.stdout,
    )
    await landing(world, "gtd(check): review-gate.check → build.health.check")
    await landing(world, "gtd(check): build.health.check → build.review.reviewing")
  },
)

Given(
  "a history whose {string} commit carries only {string} trailers for {string} as {string}",
  async (world: GtdWorld, step: string, trailer: string, id: string, verdict: string) => {
    assert.strictEqual(step, "build.review.triage")
    assert.strictEqual(trailer, "Gtd-Judge")
    writeBase(world)
    await world.runGtd("--workflow", "review", "--var", "reviewBase=base")
    await landing(world, "gtd(check): review-gate.check → build.health.check")
    await landing(world, "gtd(check): build.health.check → build.review.reviewing")
    writeFileTo(world, ".gtd/REVIEW.md", reviewDoc(["item 1"]))
    await landing(world, "gtd(agent): build.review.reviewing → build.review.await-review")
    writeFileTo(world, ".gtd/REVIEW.md", reviewDoc(["rename `add` to `sum`"]))
    await landing(world, "gtd(human): build.review.await-review → build.review.triage")
    await world.runGtdJudgeAnswerWithStdin(JSON.stringify([{ id, answer: verdict, p: 0.9 }]))
    assert.strictEqual(
      world.lastCommitSubject(),
      "gtd(judge): build.review.triage → build.review.closing",
    )
    world.deleteWorktreeFile(".gtd/REVIEW.md")
    await landing(world, "gtd(check): build.review.closing → build.review.collecting")
  },
)

const writeBase = (world: GtdWorld): void => {
  commitFile(world, "gtd.config.ts", REVIEW_CONFIG, "chore: add gtd.config.ts")
  world.envVars["GTD_QUALITYREVIEWS"] = ""
  if (world.tier === "inmem") world.repo!.updateRef("base", "HEAD")
  else execFileSync("git", ["branch", "-f", "base"], { cwd: world.repoDir, stdio: "pipe" })
  commitFile(
    world,
    "src/calc.ts",
    "export const add = (a: number, b: number) => a + b\n",
    "feat: add calculator",
  )
}

When(
  "I run gtd judge answer with note-{int} judged a confident could",
  async (world: GtdWorld, n: number) => {
    await world.runGtdJudgeAnswerWithStdin(JSON.stringify(answers(`note-${n}`, "edit", "two-way")))
  },
)

When(
  "I run gtd judge answer with note-{int} judged a confident could and note-{int} a confident one-way edit",
  async (world: GtdWorld, could: number, door: number) => {
    await world.runGtdJudgeAnswerWithStdin(
      JSON.stringify([
        ...answers(`note-${could}`, "edit", "two-way"),
        ...answers(`note-${door}`, "edit", "one-way"),
      ]),
    )
  },
)

// Landing runs the emitted script (the harness drives it), then commits.
When("I run the emitted script and land", async (world: GtdWorld) => {
  await world.runGtd("next")
  const run = await world.runEmittedScript(
    world.lastResult.stdout.slice(world.lastResult.stdout.indexOf("mkdir -p .gtd")),
  )
  assert.strictEqual(run.exitCode, 0, `the emitted script failed:\n${run.output}`)
  await world.runGtd("land")
})

Then("the last commit changes {string}", (world: GtdWorld, path: string) => {
  const changed =
    world.tier === "inmem"
      ? world.repo!.fileAtRef("HEAD", path) !== world.repo!.fileAtRef("HEAD~1", path)
      : execFileSync("git", ["diff", "--name-only", "HEAD~1", "HEAD"], {
          cwd: world.repoDir,
          encoding: "utf-8",
        })
          .split("\n")
          .includes(path)
  assert.ok(changed, `Expected the last commit to change "${path}".\n${world.gitLog()}`)
})

Then(
  "{string} lists notes {int} to {int} and not notes {int} or {int}",
  (world: GtdWorld, path: string, from: number, to: number, a: number, b: number) => {
    const content = world.readRepoFile(path)
    const has = (n: number): boolean => new RegExp(`note-${n}\\b`).test(content)
    for (let n = from; n <= to; n++)
      assert.ok(has(n), `Expected "${path}" to list note-${n}:\n${content}`)
    for (const n of [a, b])
      assert.ok(!has(n), `Expected "${path}" NOT to list note-${n}:\n${content}`)
  },
)

Then("the log has no {string} commit", (world: GtdWorld, step: string) => {
  assert.ok(!world.gitLog().includes(step), `Expected no "${step}" commit.\n${world.gitLog()}`)
})

Then("stdout lists {string} before {string}", (world: GtdWorld, first: string, second: string) => {
  const out = world.lastResult.stdout
  const i = out.indexOf(first)
  const j = out.indexOf(second)
  assert.ok(i >= 0 && j >= 0 && i < j, `Expected "${first}" before "${second}" in:\n${out}`)
})

// Asks `gtd next --json` where the process rests, leaving the previous
// command's output intact for the assertions that follow.
Then("the process rests at {string}", async (world: GtdWorld, step: string) => {
  const reported = world.lastResult
  await world.runGtd("next", "--json")
  const rest = (JSON.parse(world.lastResult.stdout) as { state?: string }).state
  world.lastResult = reported
  assert.strictEqual(rest, step)
})

Then(/^\.gtd\/TODO\.md does not exist$/, (world: GtdWorld) => {
  assert.ok(!world.repoFileExists(".gtd/TODO.md"), 'Expected ".gtd/TODO.md" NOT to exist.')
})

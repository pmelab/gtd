import { Given, Then, When } from "quickpickle"
import assert from "node:assert"
import type { GtdWorld } from "../world.js"
import { shellQuote } from "../../../../src/GitScript.js"

// ── Repository-mutation proof (`@live` only — see world.ts's `RepoSnapshot`) ──

Given("the git index has settled", async (world: GtdWorld) => {
  await world.settleGitIndex()
})

Given("I snapshot the repository", (world: GtdWorld) => {
  world.savedSnapshot = world.snapshotRepo()
})

Then("the repository snapshot is unchanged", (world: GtdWorld) => {
  assert.notStrictEqual(
    world.savedSnapshot,
    undefined,
    'No repository snapshot was ever taken. Run "I snapshot the repository" first.',
  )
  assert.deepStrictEqual(
    world.snapshotRepo(),
    world.savedSnapshot,
    "Expected the repository to be byte-for-byte unchanged since the snapshot.",
  )
})

// Negative control: proves the snapshot can actually SEE a write — without
// this, an `unchanged` assertion could pass vacuously if `snapshotRepo` ever
// stopped observing anything (e.g. its git-dir resolution silently pointed
// nowhere).
Then("the repository snapshot has changed", (world: GtdWorld) => {
  assert.notStrictEqual(
    world.savedSnapshot,
    undefined,
    'No repository snapshot was ever taken. Run "I snapshot the repository" first.',
  )
  assert.notDeepStrictEqual(
    world.snapshotRepo(),
    world.savedSnapshot,
    "Expected the repository to differ from the snapshot, but it compared identical.",
  )
})

When("I record stdout as {string}", (world: GtdWorld, label: string) => {
  world.recordedStdout[label] = world.lastResult.stdout
})

Then(
  "stdout recorded as {string} is byte-identical to stdout recorded as {string}",
  (world: GtdWorld, labelA: string, labelB: string) => {
    const a = world.recordedStdout[labelA]
    const b = world.recordedStdout[labelB]
    assert.notStrictEqual(a, undefined, `no stdout was ever recorded as "${labelA}"`)
    assert.notStrictEqual(b, undefined, `no stdout was ever recorded as "${labelB}"`)
    assert.strictEqual(
      a,
      b,
      `Expected stdout recorded as "${labelA}" and "${labelB}" to be byte-identical.\n"${labelA}":\n${a}\n"${labelB}":\n${b}`,
    )
  },
)

Then(
  "stdout recorded as {string} contains {string}",
  (world: GtdWorld, label: string, text: string) => {
    const recorded = world.recordedStdout[label]
    assert.notStrictEqual(recorded, undefined, `no stdout was ever recorded as "${label}"`)
    assert.ok(
      recorded!.includes(text),
      `Expected stdout recorded as "${label}" to contain "${text}". Got:\n${recorded}`,
    )
  },
)

// Proves `gtd next`'s plain text and `gtd status --json`'s `content` field
// describe the SAME resolved rest (both flow through the same `renderRest`) —
// stdout recorded from `gtd next` is compared against the CURRENT invocation's
// own json field, trailing-newline-normalized (the plain-text renderer always
// ends with exactly one trailing newline; the json field carries the rest's
// content raw).
const jsonField = (world: GtdWorld, field: string): unknown => {
  const parsed = JSON.parse(world.lastResult.stdout) as Record<string, unknown>
  return field
    .split(".")
    .reduce<unknown>(
      (node, segment) =>
        node !== null && typeof node === "object"
          ? (node as Record<string, unknown>)[segment]
          : undefined,
      parsed,
    )
}

Then(
  "stdout recorded as {string} equals the current json field {string}, trailing newline aside",
  (world: GtdWorld, label: string, field: string) => {
    const recorded = world.recordedStdout[label]
    assert.notStrictEqual(recorded, undefined, `no stdout was ever recorded as "${label}"`)
    const value = jsonField(world, field)
    assert.strictEqual(typeof value, "string", `expected json field "${field}" to be a string`)
    assert.strictEqual(
      recorded!.replace(/\n+$/, ""),
      value,
      `Expected stdout recorded as "${label}" (trailing newline aside) to equal json field ` +
        `"${field}".\nRecorded:\n${recorded}\nField:\n${String(value)}`,
    )
  },
)

// Proves a `--sh` field, recorded from an EARLIER (non-mutating) invocation,
// holds the SAME text the CURRENT (plain) stdout carries — `shellQuote`
// (`src/GitScript.ts`) is the exact escaping `src/Sh.ts`'s `renderShDocument`
// uses for every scalar leaf, so the assignment it reconstructs from the
// current stdout must appear verbatim in the recorded `--sh` document if, and
// only if, the underlying value is identical (never "aside": both plain
// stdout and a `--sh` scalar leaf are already normalized to exactly one
// trailing newline before either prints). The recorded/current split (rather
// than two `recordedStdout` labels) is deliberate: `gtd land`'s plain
// encoding drives the actual git write as a side effect, so it must run
// LAST — after the non-mutating `--sh` capture — for both to describe the
// same rest.
Then(
  "the current stdout equals the sh field {string} recorded as {string}",
  (world: GtdWorld, field: string, label: string) => {
    const recordedSh = world.recordedStdout[label]
    assert.notStrictEqual(recordedSh, undefined, `no stdout was ever recorded as "${label}"`)
    const assignment = `gtd_${field}=${shellQuote(world.lastResult.stdout)}`
    assert.ok(
      recordedSh!.includes(assignment),
      `Expected stdout recorded as "${label}" to contain gtd_${field}= holding the current ` +
        `stdout verbatim.\nRecorded:\n${recordedSh}\nCurrent stdout:\n${world.lastResult.stdout}`,
    )
  },
)

Then(
  "stdout recorded as {string} ends with the current json field {string}, trailing newline aside",
  (world: GtdWorld, label: string, field: string) => {
    const recorded = world.recordedStdout[label]
    assert.notStrictEqual(recorded, undefined, `no stdout was ever recorded as "${label}"`)
    const value = jsonField(world, field)
    assert.strictEqual(typeof value, "string", `expected json field "${field}" to be a string`)
    assert.ok(
      recorded!.replace(/\n+$/, "").endsWith((value as string).replace(/\n+$/, "")),
      `Expected stdout recorded as "${label}" (trailing newline aside) to end with json field ` +
        `"${field}".\nRecorded:\n${recorded}\nField:\n${String(value)}`,
    )
  },
)

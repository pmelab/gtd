import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { renderScript, SCRIPT_NAMES } from "../src/workflows/text.fixture.js"
import {
  commitAll,
  commitAsIs,
  deleteRef,
  discardPending,
  hardResetTo,
  mixedResetTo,
  softResetTo,
  updateRef,
} from "../src/GitScript.js"
import { combinedScript, emitScripts, failurePromptWrapper, type EmitStep } from "../src/Emit.js"
import {
  abandonedOutcome,
  abandonNoopOutcome,
  commitOutcome,
  noteOutcome,
  restoredOutcome,
  transitionOutcome,
} from "../src/OutcomeScript.js"

const CORPUS_DIR = join(import.meta.dirname, "..", "tests", "shell", "corpus")

const SAMPLE_HEAD = "a".repeat(40)
const SAMPLE_HEAD_2 = "b".repeat(40)

const files: Record<string, string> = {}

const add = (name: string, content: string): void => {
  if (name in files) throw new Error(`generate-shell-corpus: duplicate corpus file name "${name}"`)
  files[name] = content.endsWith("\n") ? content : `${content}\n`
}

/** A builder's bare command as `Emit.ts` actually assembles it: `set -eu`, then the command. */
const assembled = (bare: string): string =>
  emitScripts([{ kind: "gitWrite", command: bare }]).required

const gitBuilders: Record<string, string> = {
  commitAll: commitAll("gtd(agent): sample"),
  commitAsIs: commitAsIs("gtd(agent): sample"),
  softResetTo: softResetTo(SAMPLE_HEAD),
  mixedResetTo: mixedResetTo(SAMPLE_HEAD),
  hardResetTo: hardResetTo(SAMPLE_HEAD),
  discardPending: discardPending(),
  updateRef: updateRef("refs/worktree/gtd/history", SAMPLE_HEAD),
  deleteRef: deleteRef("refs/worktree/gtd/history"),
}

for (const [name, bare] of Object.entries(gitBuilders)) {
  add(`git.${name}.bare.sh`, bare)
  add(`git.${name}.assembled.sh`, assembled(bare))
}

add(
  "failure-prompt-wrapper.sh",
  failurePromptWrapper("gtd check qa '.gtd/TODO.md'", "Fix the following steering-file findings"),
)

const outcomeCalls: Record<string, string> = {
  transition: transitionOutcome("plan.planning", "plan.await-plan"),
  commit: commitOutcome("gtd(agent): sample"),
  note: noteOutcome('nothing to do at "idle"'),
  abandoned: abandonedOutcome("build.fix", SAMPLE_HEAD, "idle"),
  restored: restoredOutcome(SAMPLE_HEAD, "await-review"),
  "abandon-noop": abandonNoopOutcome("idle"),
}

for (const [name, call] of Object.entries(outcomeCalls)) {
  const steps: readonly EmitStep[] = [{ kind: "outcome", command: call }]
  add(`outcome.${name}.sh`, emitScripts(steps).required)
}

const combinedRequired = assembled(commitAll("gtd(agent): sample"))
add("combined.required-only.sh", combinedScript(combinedRequired, ""))

const combinedOptionalBare = updateRef("refs/worktree/gtd/history", SAMPLE_HEAD_2)
const combinedOptional = emitScripts(
  [],
  [{ kind: "gitWrite", command: combinedOptionalBare }],
).optional
add("combined.with-optional.sh", combinedScript(combinedRequired, combinedOptional))

// ── 2. Every script text of the bundled workflow, rendered against a fixed
// context, one "workflow.<export>.sh" file each.

for (const name of SCRIPT_NAMES) {
  add(
    `workflow.${name}.sh`,
    renderScript(name, {
      read: (path) => {
        throw new Error(`generate-shell-corpus: unexpected read(${path}) while rendering "${name}"`)
      },
      start: SAMPLE_HEAD,
      head: SAMPLE_HEAD_2,
      base: SAMPLE_HEAD,
    }),
  )
}

const writeInto = (dir: string): void => {
  mkdirSync(dir, { recursive: true })
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
}

const committedNames = (): readonly string[] =>
  existsSync(CORPUS_DIR) ? readdirSync(CORPUS_DIR).filter((f) => f.endsWith(".sh")) : []

/** `undefined` when `name` matches the committed corpus, else the message to report. */
const driftMessage = (name: string): string | undefined => {
  const committedPath = join(CORPUS_DIR, name)
  const committed = existsSync(committedPath) ? readFileSync(committedPath, "utf8") : undefined
  const generated = files[name]
  if (generated === undefined) {
    return `tests/shell/corpus/${name} is stale — no emitter still produces this shape`
  }
  if (committed !== generated) {
    return `tests/shell/corpus/${name} is out of date — run "jiti scripts/generate-shell-corpus.ts" to regenerate`
  }
  return undefined
}

const checkAgainstCommitted = (): boolean => {
  const allNames = Array.from(new Set([...committedNames(), ...Object.keys(files)])).sort()
  const messages = allNames.map(driftMessage).filter((m): m is string => m !== undefined)
  messages.forEach((message) => console.error(message))
  return messages.length === 0
}

const checkMode = process.argv.includes("--check")

if (checkMode) {
  const upToDate = checkAgainstCommitted()
  if (!upToDate) process.exit(1)
  console.log(`tests/shell/corpus/ is up to date (${Object.keys(files).length} files)`)
} else {
  for (const name of committedNames()) {
    if (!(name in files)) rmSync(join(CORPUS_DIR, name))
  }
  writeInto(CORPUS_DIR)
  console.log(`wrote ${Object.keys(files).length} files to tests/shell/corpus/`)
}

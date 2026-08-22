/**
 * Runs via `jiti`, which can't load `../src/workflows/templates.js` or
 * `../src/ReviewWindow.js` (both transitively import `unified.yaml` as raw
 * text through a loader jiti has no equivalent for) — so this script reads
 * the yaml directly and reimplements the two review-window sequences from
 * `src/GitScript.ts`'s builders instead of importing them.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { parse as parseYaml } from "yaml"
import { compileWorkflowConfig } from "../src/PatternConfig.js"
import { renderStateTemplate, type TemplateContext } from "../src/PatternTemplates.js"
import {
  commitAll,
  commitAsIs,
  deleteRef,
  discardPending,
  hardResetTo,
  mixedResetTo,
  restoreStagedFrom,
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
import { beatFields, landFields, renderBeatSh, renderLandSh } from "../src/Beat.js"

const CORPUS_DIR = join(import.meta.dirname, "..", "tests", "shell", "corpus")
const UNIFIED_YAML_PATH = join(import.meta.dirname, "..", "src", "workflows", "unified.yaml")

const SAMPLE_HEAD = "a".repeat(40)
const SAMPLE_HEAD_2 = "b".repeat(40)

const files: Record<string, string> = {}

const add = (name: string, content: string): void => {
  if (name in files) throw new Error(`generate-shell-corpus: duplicate corpus file name "${name}"`)
  files[name] = content.endsWith("\n") ? content : `${content}\n`
}

/**
 * Like `add`, for a `--sh` document (`beat.sh`, `land.sh`) whose assignments
 * are meant to be `eval`'d into a driver's shell scope, never read here.
 * Prepends a leading `# shellcheck disable=SC2034,SC1003` (disables both
 * rules file-wide) so `lint:sh` stays one `shellcheck` invocation over the
 * whole corpus: SC2034 flags the "unused" assignments, and SC1003 flags the
 * doubly-nested `'\''` quoting that correct POSIX escaping produces when a
 * field embeds an already-quoted script.
 */
const addAssignmentOnly = (name: string, content: string): void =>
  add(name, `# shellcheck disable=SC2034,SC1003\n${content}`)

const retryWrapped = (bare: string, expectedHead: string = SAMPLE_HEAD): string => {
  const steps: readonly EmitStep[] = [{ kind: "gitWrite", command: bare }]
  return emitScripts({ expectedHead }, steps).required
}

const gitBuilders: Record<string, string> = {
  commitAll: commitAll("gtd(agent): sample"),
  commitAsIs: commitAsIs("gtd(agent): sample"),
  softResetTo: softResetTo(SAMPLE_HEAD),
  mixedResetTo: mixedResetTo(SAMPLE_HEAD),
  hardResetTo: hardResetTo(SAMPLE_HEAD),
  discardPending: discardPending(),
  updateRef: updateRef("refs/worktree/gtd/history", SAMPLE_HEAD),
  deleteRef: deleteRef("refs/worktree/gtd/history"),
  restoreStagedFrom: restoreStagedFrom(SAMPLE_HEAD, [".gtd"]),
}

for (const [name, bare] of Object.entries(gitBuilders)) {
  add(`git.${name}.bare.sh`, bare)
  add(`git.${name}.retry.sh`, retryWrapped(bare))
}

// ── 2. Both review-window sequences, open and close ─────────────────────────
// Replicates src/ReviewWindow.ts's buildOpenWindowScript/buildCloseWindowScript
// bodies; these two refs mirror its REVIEW_HEAD_REF/REVIEW_BASE_REF constants.
const SAMPLE_REVIEW_HEAD_REF = "refs/worktree/gtd/review-head"
const SAMPLE_REVIEW_BASE_REF = "refs/worktree/gtd/review-base"

const openBare = [
  updateRef(SAMPLE_REVIEW_BASE_REF, SAMPLE_HEAD),
  updateRef(SAMPLE_REVIEW_HEAD_REF, "HEAD"),
  mixedResetTo(SAMPLE_HEAD),
  restoreStagedFrom(SAMPLE_REVIEW_HEAD_REF, [".gtd"]),
].join(" &&\n")
add("review-window.open.bare.sh", openBare)
add("review-window.open.retry.sh", retryWrapped(openBare))

const closeBare = [
  mixedResetTo(SAMPLE_HEAD_2),
  deleteRef(SAMPLE_REVIEW_HEAD_REF),
  deleteRef(SAMPLE_REVIEW_BASE_REF),
].join(" &&\n")
add("review-window.close.bare.sh", closeBare)
add("review-window.close.retry.sh", retryWrapped(closeBare))

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
  add(`outcome.${name}.sh`, emitScripts({}, steps).required)
}

const combinedRequired = retryWrapped(commitAll("gtd(agent): sample"))
add("combined.required-only.sh", combinedScript(combinedRequired, ""))

const combinedOptional = emitScripts({}, [], [{ kind: "gitWrite", command: openBare }]).optional
add("combined.with-optional.sh", combinedScript(combinedRequired, combinedOptional))

// ── 5. Every `script` state of the bundled workflow, rendered against a
// fixture context. Qualified state names only use [a-z0-9.-], already safe as
// a filename component, so no sanitizing is needed — `tests/tooling/
// shell-corpus.test.ts` relies on this exact "workflow.<qualified-name>.sh"
// naming to cross-check corpus coverage.

const unifiedYamlText = readFileSync(UNIFIED_YAML_PATH, "utf8")
const compiled = compileWorkflowConfig(parseYaml(unifiedYamlText), ".")

for (const [name, state] of Object.entries(compiled.definition.states)) {
  if (state.script === undefined) continue
  const context: TemplateContext = {
    startCommit: SAMPLE_HEAD,
    currentCommit: SAMPLE_HEAD_2,
    previousCommit: SAMPLE_HEAD,
    state: name,
    actor: state.actor,
    reviewBase: SAMPLE_HEAD,
    retainedBase: SAMPLE_HEAD,
    processCost: 0,
    processCostByModel: [],
    read: (path: string) => {
      throw new Error(
        `generate-shell-corpus: unexpected it.read(${path}) while rendering "${name}"`,
      )
    },
    vars: compiled.vars,
    edges: [],
  }
  add(`workflow.${name}.sh`, renderStateTemplate(state.script, context))
}

// ── 6. The beat document, rendered in `--sh` form ───────────────────────────
// A fixture exercising as many `BeatFields` kinds as possible. `rendered` is a
// plain object literal shaped like `src/Edge.ts`'s `RenderedRest`, not an
// import — `Edge.js` transitively imports `unified.yaml` as raw text too,
// which jiti can't load.

const beatFixtureRendered = {
  state: "build.fixing",
  actor: "agent",
  kind: "prompt",
  content: "fix the failing build",
  memoryResumed: true,
  edges: [
    { pattern: "A", target: "build.review.deciding", describe: "approved" },
    { pattern: "R", target: "build.fixing" },
  ],
  model: "smart",
  label: "Fix Build",
  memory: "build.fixing#abc1234",
  file: ".gtd/TODO.md",
  mode: "qa",
}

const beatFixtureFields = beatFields({
  rendered: beatFixtureRendered,
  kind: "prompt",
  log: "gtd(agent): build.fixing",
  session: { id: "11111111-1111-1111-1111-111111111111", resume: true },
  validate: "gtd validate qa .gtd/TODO.md",
  changes: [
    { status: "M", path: ".gtd/TODO.md", pattern: "A" },
    { status: "A", path: "src/foo.ts", pattern: null },
  ],
  next: { action: "advance", pattern: "A", target: "build.review.deciding" },
  cost: 0.47,
  costByModel: [
    { model: "smart", cost: 0.42 },
    { model: "cheap", cost: 0.05 },
  ],
})

addAssignmentOnly("beat.sh", renderBeatSh(beatFixtureFields))

// ── 7. The land document, rendered in `--sh` form ───────────────────────────
// `script` reuses the combined land script built above, normalized with the
// same single-trailing-newline rule as `program.ts`'s `normalizeScriptNewline`
// (duplicated here — `program.ts` is unloadable under `jiti`).

const landFixtureFields = landFields({
  script: `${combinedScript(combinedRequired, combinedOptional).replace(/\n+$/, "")}\n`,
  settled: false,
  idle: false,
  state: "build.review.deciding",
  subject: "gtd(agent): sample",
  cost: 0.42,
  model: "smart",
})

addAssignmentOnly("land.sh", renderLandSh(landFixtureFields))

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

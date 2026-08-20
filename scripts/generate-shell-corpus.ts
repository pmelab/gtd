/**
 * Generates the golden corpus of emitted shell scripts under
 * `tests/shell/corpus/` — every shape `src/GitScript.ts`/`src/Emit.ts`/
 * `src/ReviewWindow.ts`/`src/OutcomeScript.ts` can produce, plus every
 * `script`-content state of the bundled `src/workflows/unified.yaml`
 * template, rendered against a fixture context. `lint:sh` (package.json)
 * diffs the freshly generated content against the committed corpus before
 * running `shellcheck -s sh` over it — a corpus that drifts from its
 * emitters would otherwise be a stale green that looks like coverage.
 *
 * Run via `jiti` (like `scripts/generate-schema.ts`), so it imports
 * `../src/workflows/unified.yaml` as raw TEXT itself (`readFileSync`) rather
 * than through `../src/workflows/templates.js` — that module imports the
 * `.yaml` file as a JS module via tsdown's/vitest's text-loader plugins,
 * which `jiti` has no equivalent for (see `generate-schema.ts`'s own doc
 * comment on this exact constraint). Compiling the raw text directly through
 * `compileWorkflowConfig` (the same function `templates.ts`'s
 * `compileTemplate` calls) sidesteps that with no loss of fidelity.
 *
 * For the same reason, this script does NOT import `../src/ReviewWindow.js`:
 * that module pulls in `./Edge.js` -> `./Config.js` -> `./workflows/
 * templates.js` -> the same unloadable `.yaml` import, transitively, even
 * though this script only needs its two pure builders. Instead, the two
 * review-window sequences below are assembled directly from
 * `../src/GitScript.js`'s pure builders, replicating `buildOpenWindowScript`/
 * `buildCloseWindowScript`'s own bodies exactly (each is just a `" &&\n"`-
 * joined call sequence — see their doc comments in src/ReviewWindow.ts).
 * `tests/tooling/shell-corpus.test.ts` runs under vitest (which handles the
 * `.yaml` import fine) and cross-checks the committed corpus files against
 * the REAL `buildOpenWindowScript`/`buildCloseWindowScript` output for the
 * same fixture inputs, so a future change to either builder that this
 * generator's copy doesn't follow fails that test loudly instead of drifting
 * silently.
 *
 * `--check`: diff the freshly generated content (kept in memory) against
 * `tests/shell/corpus/` on disk, exit non-zero on any difference (missing,
 * extra, or changed file) without ever writing anything. No flag: regenerate
 * the committed corpus in place (removing stale files no emitter still
 * produces).
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
 * Like `add`, for a sample whose every assignment is legitimately "unused" by
 * this file's own logic — a `--sh` wire-format document meant to be `eval`'d
 * into a DRIVER's own shell scope, never read by the file that defines it
 * (`beat.sh`, `land.sh`; more may land as `--sh` reaches more commands).
 * Prepends a file-scoped `# shellcheck disable=SC2034,SC1003` directive
 * (verified: a leading directive line disables both rules for the whole
 * file, not just the next line) so `lint:sh`'s
 * `shellcheck -s sh tests/shell/corpus/*.sh` stays ONE uniform invocation
 * over every corpus file — no filename-list split in `package.json`, no
 * repo-wide `.shellcheckrc` disable — and the waiver is visible in the file
 * it applies to, self-maintaining as more samples like it are added via this
 * same helper. SC1003 fires only on a document whose OWN field embeds an
 * already shell-quoted script (`land.sh`'s `gtd_script`, itself full of
 * `shellQuote`-escaped git commands) inside `shQuote`'s outer quoting —
 * doubly-nested `'\''` sequences are exactly what correct POSIX escaping
 * looks like there, not a mistake shellcheck's heuristic should flag.
 */
const addAssignmentOnly = (name: string, content: string): void =>
  add(name, `# shellcheck disable=SC2034,SC1003\n${content}`)

const retryWrapped = (bare: string, expectedHead: string = SAMPLE_HEAD): string => {
  const steps: readonly EmitStep[] = [{ kind: "gitWrite", command: bare }]
  return emitScripts({ expectedHead }, steps).required
}

// ── 1. Every git-script builder, bare and retry-wrapped ─────────────────────

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
// Replicates src/ReviewWindow.ts's `buildOpenWindowScript`/
// `buildCloseWindowScript` bodies exactly (see this file's own top comment
// for why they aren't imported directly) — these two literal refs mirror
// ReviewWindow.ts's `REVIEW_HEAD_REF`/`REVIEW_BASE_REF` constants.
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

// ── 3. The failure-prompt wrapper ────────────────────────────────────────────

add(
  "failure-prompt-wrapper.sh",
  failurePromptWrapper("gtd check qa '.gtd/TODO.md'", "Fix the following steering-file findings"),
)

// ── 4. The outcome preamble, with each report call ──────────────────────────

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

// ── 5. The combined land script, both forms ─────────────────────────────────

const combinedRequired = retryWrapped(commitAll("gtd(agent): sample"))
add("combined.required-only.sh", combinedScript(combinedRequired, ""))

const combinedOptional = emitScripts({}, [], [{ kind: "gitWrite", command: openBare }]).optional
add("combined.with-optional.sh", combinedScript(combinedRequired, combinedOptional))

// ── 6. Every `script` state of the bundled workflow, rendered against a ────
// fixture context. Qualified state names (e.g. "start-gate.check",
// "packages.item.health.check") only ever use [a-z0-9.-], already safe as a
// filename component, so no sanitizing is needed — `tests/tooling/
// shell-corpus.test.ts` relies on this exact "workflow.<qualified-name>.sh"
// naming to cross-check corpus coverage against the compiled definition.

const unifiedYamlText = readFileSync(UNIFIED_YAML_PATH, "utf8")
const compiled = compileWorkflowConfig(parseYaml(unifiedYamlText), ".")
const fixtureStateDir = compiled.vars["stateDir"] ?? ".gtd"

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
    stateDir: fixtureStateDir,
  }
  add(`workflow.${name}.sh`, renderStateTemplate(state.script, context))
}

// ── 7. The beat document, rendered in `--sh` form ───────────────────────────
// One fixture exercising as many `BeatFields` kinds as possible: a `session`
// (nested object), the plain scalars (`model`/`label`/`memory`/`file`/`mode`),
// an `edges` list where only one row declares `describe` (TSV union-of-
// columns), a non-empty `changes` list, a `next` match with an `action`, and
// a non-zero `cost`/`costByModel`. `rendered` is a plain object literal
// shaped like `src/Edge.ts`'s `RenderedRest` (mirroring `src/Beat.test.ts`'s
// own `rest()` helper) rather than an import — `beatFields`'s own imports
// from `./Edge.js` are `import type` only (erased at build), and this script
// must never pull that module in as a VALUE (see this file's own top comment
// on why `src/Edge.js` is unloadable under `jiti`).
//
// Every assignment `renderBeatSh` emits is meant to be read by a DRIVER that
// `eval`s the whole document into its own shell scope, never by this script
// itself — shellcheck's SC2034 ("appears unused") fires on all of them for
// exactly that reason. `addAssignmentOnly` (above) scopes the waiver to this
// one file via a leading directive rather than a repo-wide `.shellcheckrc`
// disable or a `package.json`-level invocation split.

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

// ── 8. The land document, rendered in `--sh` form ───────────────────────────
// `script` reuses the combined land script assembled in section 5 above
// (required + optional, both non-empty) — a landing's `LandFields.script` is
// always `LandResult.script` verbatim, never re-derived — with the same
// single-trailing-newline normalization `program.ts`'s own
// `normalizeScriptNewline` applies (duplicated here for the same reason that
// function documents its own duplication: this script can't import
// `program.ts`, which is unloadable under `jiti` — see this file's own top
// comment).

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

// ── Write or check ───────────────────────────────────────────────────────────

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

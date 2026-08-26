/**
 * Runs via `jiti`, which can't load `../src/workflows/templates.js` (it
 * transitively imports `unified.yaml` as raw text through a loader jiti has
 * no equivalent for) — so this script reads the yaml directly instead.
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
const UNIFIED_YAML_PATH = join(import.meta.dirname, "..", "src", "workflows", "unified.yaml")

const SAMPLE_HEAD = "a".repeat(40)
const SAMPLE_HEAD_2 = "b".repeat(40)

const files: Record<string, string> = {}

const add = (name: string, content: string): void => {
  if (name in files) throw new Error(`generate-shell-corpus: duplicate corpus file name "${name}"`)
  files[name] = content.endsWith("\n") ? content : `${content}\n`
}

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
}

for (const [name, bare] of Object.entries(gitBuilders)) {
  add(`git.${name}.bare.sh`, bare)
  add(`git.${name}.retry.sh`, retryWrapped(bare))
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
  add(`outcome.${name}.sh`, emitScripts({}, steps).required)
}

const combinedRequired = retryWrapped(commitAll("gtd(agent): sample"))
add("combined.required-only.sh", combinedScript(combinedRequired, ""))

const combinedOptionalBare = updateRef("refs/worktree/gtd/history", SAMPLE_HEAD_2)
const combinedOptional = emitScripts(
  {},
  [],
  [{ kind: "gitWrite", command: combinedOptionalBare }],
).optional
add("combined.with-optional.sh", combinedScript(combinedRequired, combinedOptional))

// ── 2. Every `script` state of the bundled workflow, rendered against a
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

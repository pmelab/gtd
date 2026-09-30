// The promptfoo `exec:` provider for every case: builds a fixture repo,
// drives exactly ONE real driver turn against it (`gtd next` -> Claude Code
// -> `gtd land`), and prints one line of JSON for each case's own
// `evals/asserts/<name>.mjs` (tiers 1/2) and the `llm-rubric` in
// `evals/promptfooconfig.yaml` (tier 3) to inspect. No `#!` here on purpose:
// `evals/promptfooconfig.yaml` always spawns this as `node run-turn.mjs`,
// never `./run-turn.mjs` directly, and a leading shebang breaks Vite's SSR
// transform of the dynamic `import(`./cases/${caseName}.mjs`)` below —
// `tests/tooling/run-turn.test.ts`'s static import of this module would fail
// to even parse with one present.
import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import assert from "node:assert"
import { buildFixture, scrubbedEnv, GTD_BIN, OXFMT_BIN } from "./fixture.mjs"
import { matchGtdFiles } from "./expect.mjs"

// Pinned judge provider id, duplicated (not imported) from
// evals/promptfooconfig.yaml on purpose: the judge is never the model under
// test, and this is the startup guard that enforces it.
const JUDGE_MODEL = "gpt-5.4"

// gtd picks a model per state by class (planner vs. coder); each class needs
// its own `--<class> <id>` flag and its own fixture env var.
const MODEL_ENV_VAR = Object.freeze({ planner: "GTD_PLANNERMODEL", coder: "GTD_CODERMODEL" })

const TURN_TIMEOUT_MS = 600_000

// Pins the turn's tool surface to the four docs/development.md promises a
// baseline was measured under — Claude Code's own default happens to match
// today, but it could widen on a version bump with nothing here failing.
// Duplicated in docs/development.md's "## Prompt evals" section on purpose;
// keep both in sync.
export const CLAUDE_TOOLS = "Read,Write,Edit,Bash"

// `--system-prompt` REPLACES Claude Code's own system prompt rather than
// appending to it (`--append-system-prompt`), because the state's prompt is
// the whole thing under test — grading gtd's prompt on top of Claude Code's
// would grade the sum. `--setting-sources ""` loads no user/project/local
// settings, so a machine's own hooks, output style and permissions never
// reach the graded turn; auth is untouched by it, so the local login still
// applies. Together with `--no-session-persistence` that keeps a trial
// reproducible on another machine, which a baseline cell depends on.
export function buildClaudeArgv(turnModel, system) {
  return [
    "-p",
    "--model",
    turnModel,
    "--system-prompt",
    system,
    "--tools",
    CLAUDE_TOOLS,
    "--permission-mode",
    "bypassPermissions",
    "--no-session-persistence",
    "--setting-sources",
    "",
  ]
}

// Resolves `claude` against the (unscrubbed) PATH, so a missing agent fails
// at startup with its own message rather than as an opaque ENOENT inside the
// graded turn.
function resolveClaude() {
  try {
    return execFileSync("sh", ["-c", "command -v claude"], { encoding: "utf-8" }).trim()
  } catch {
    return undefined
  }
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

function takeFlag(argv, name, consumed) {
  const idx = argv.indexOf(`--${name}`)
  if (idx === -1) return undefined
  consumed.add(idx)
  consumed.add(idx + 1)
  return argv[idx + 1]
}

export function parseArgs(argv) {
  const consumed = new Set()
  const models = {}
  for (const cls of Object.keys(MODEL_ENV_VAR)) models[cls] = takeFlag(argv, cls, consumed)
  // `exec:` hands the rendered `{{case}}:{{variant}}` prompt through as a
  // plain positional — it is the first argv entry not consumed by any
  // `--<class>` flag/value pair. With no flags at all, nothing is
  // consumed — filtering index 0 unconditionally would drop the positional
  // itself and misreport a missing model as a missing case/variant.
  const positional = argv.find((_, i) => !consumed.has(i))
  // A case name stays `[a-z-]+` (never containing `:`), so splitting on the
  // FIRST `:` is unambiguous.
  const sep = positional?.indexOf(":") ?? -1
  const caseName = sep === -1 ? undefined : positional.slice(0, sep)
  const variant = sep === -1 ? undefined : positional.slice(sep + 1)
  return { models, caseName, variant }
}

/** Dynamically imports `./cases/<caseName>.mjs` — a frozen plain object, never executed for behaviour. */
async function loadCase(caseName) {
  if (!caseName) return undefined
  try {
    const mod = await import(`./cases/${caseName}.mjs`)
    return mod.default
  } catch {
    return undefined
  }
}

function assertTmpCwd(cwd) {
  assert(cwd.startsWith(tmpdir()), "must never spawn with the working repository as cwd")
}

function git(cwd, env, ...args) {
  assertTmpCwd(cwd)
  return execFileSync("git", args, { cwd, env, encoding: "utf-8" }).trim()
}

function gtd(cwd, env, ...args) {
  assertTmpCwd(cwd)
  return execFileSync(process.execPath, [GTD_BIN, ...args], { cwd, env, encoding: "utf-8" })
}

function modelClassChecks(models) {
  return Object.keys(MODEL_ENV_VAR).flatMap((cls) => [
    [!models[cls], `run-turn: --${cls} <model> is required`],
    [
      models[cls] === JUDGE_MODEL,
      `run-turn: model under test "${models[cls]}" (${cls}) must never be the pinned judge model`,
    ],
  ])
}

// The turn reaches its model through the LOCAL Claude Code install, so no
// gateway precondition applies here. The tier-3 judge still runs through
// GTD_EVALS_URL, but that is promptfoo's own spawn (see evals/eval.mjs), not
// this process.
function infraFailures(models, caseName, caseDef, variant) {
  return [
    [!caseDef, `run-turn: unknown case "${caseName}"`],
    [
      !!caseDef && (!variant || !(variant in caseDef.variants)),
      `run-turn: unknown or missing variant "${variant}"`,
    ],
    ...modelClassChecks(models),
    [
      !existsSync(GTD_BIN),
      `run-turn: missing bundle at ${GTD_BIN} — run \`npx turbo run build\` first`,
    ],
    [!resolveClaude(), "run-turn: `claude` is not on PATH — install Claude Code"],
  ]
}

function checkInfra(models, caseName, caseDef, variant) {
  for (const [failed, message] of infraFailures(models, caseName, caseDef, variant)) {
    if (failed) fail(message)
  }
}

function unformattedGtdFiles(repo, env) {
  assertTmpCwd(repo)
  try {
    // This repo's own resolved oxfmt binary against the fixture's own copy of
    // this repo's `.oxfmtrc.json` (written by `fixture.mjs`) — never `npx
    // oxfmt`, which resolves an unpinned version with no config and grades
    // `.gtd/*.md` against stock defaults instead of the `*.md` `proseWrap`
    // override `format:check` here actually enforces.
    const out = execFileSync(OXFMT_BIN, ["--list-different", ".gtd"], {
      cwd: repo,
      env,
      encoding: "utf-8",
    })
    return out.split("\n").filter(Boolean)
  } catch (err) {
    // `--list-different` exits exactly 1 when it finds differences, with the
    // file list on stdout. Any OTHER failure (oxfmt not resolvable, a killed
    // process) must not be read as "formatting converged" — that's the
    // infra-break-reads-as-a-pass failure mode task 4 forbids by name.
    if (err.status === 1) {
      return String(err.stdout ?? "")
        .split("\n")
        .filter(Boolean)
    }
    // A coder turn that deletes `.gtd/FEEDBACK.md` (leaving only a dotfile
    // fixture marker oxfmt's own ignore rules never match) makes `.gtd`
    // contain zero target files — oxfmt exits 2 with "Expected at least one
    // target file" rather than 1. Zero checkable files is vacuously zero
    // UNFORMATTED files, never a broken run: the turn's own gtdFiles check
    // is what grades whether deleting FEEDBACK.md was the right move.
    const stderr = String(err.stderr ?? err.message ?? "")
    if (stderr.includes("Expected at least one target file")) return []
    fail(`run-turn: oxfmt --list-different failed unexpectedly: ${err.message}`)
    return []
  }
}

/** Reads the rest gtd's landed fixture is resting at, and runs the ONE agent turn against it. */
function driveTurn(repo, env) {
  const kind = gtd(repo, env, "next", "--json=kind").trim()
  if (kind !== "prompt") {
    fail(`run-turn: expected a "prompt" rest, got "${kind}" (repo kept at ${repo})`)
  }

  const turnModel = gtd(repo, env, "next", "--json=model").trim()
  const system = gtd(repo, env, "next", "--json=system").trim()
  // A `mode: qa`/`mode: review` state ALWAYS carries a non-empty validate
  // script (the built-in modes validate in-process, independent of any
  // `modes:` config) — there is no fixture shape that makes it empty. This
  // harness never runs it either way: running it would still be one agent
  // turn, but re-prompting on a failure would grade recovery, not the
  // prompt, so it is deliberately left unexecuted rather than asserted
  // empty. Consequence, stated plainly: `design-triage`, `architecture-
  // author`, `build-review-reviewing` and `build-review-collecting` (every
  // case with `mode: qa`/`mode: review`) can score a structural pass here
  // on a `.gtd/` artifact that `gtd validate` — the real workflow's own
  // gate before `gtd land` — would reject (a malformed `## Open Questions`
  // block, say). This grader checks the artifact's SHAPE against what the
  // next state reads, never its validity against `gtd validate` itself.
  const prompt = gtd(repo, env, "next")

  assertTmpCwd(repo)
  try {
    execFileSync(resolveClaude(), buildClaudeArgv(turnModel, system), {
      cwd: repo,
      env,
      input: prompt,
      encoding: "utf-8",
      timeout: TURN_TIMEOUT_MS,
    })
  } catch (err) {
    fail(`run-turn: claude turn failed or timed out: ${err.message} (repo kept at ${repo})`)
  }
}

function land(repo, env) {
  const preLandHead = git(repo, env, "rev-parse", "HEAD")
  const landScript = gtd(repo, env, "land", "--json=script")
  assertTmpCwd(repo)
  execFileSync("sh", ["-c", landScript], { cwd: repo, env, encoding: "utf-8" })
  const postLandHead = git(repo, env, "rev-parse", "HEAD")
  return { preLandHead, postLandHead }
}

function changedFiles(repo, env, preLandHead, postLandHead) {
  if (preLandHead === postLandHead) return { gtdFilesChanged: [], otherFilesChanged: [] }
  const changed = git(repo, env, "diff", "--name-only", preLandHead, postLandHead)
    .split("\n")
    .filter(Boolean)
  return {
    gtdFilesChanged: changed.filter((f) => f.startsWith(".gtd/")),
    otherFilesChanged: changed.filter((f) => !f.startsWith(".gtd/")),
  }
}

// `caseDef.artifact` is absent for a case that declares no read-back path —
// skip cleanly rather than reading a path that was never contracted.
// `architecture-decompose` is the one bundled case that ships with
// `artifact` unset, since it writes a variable-sized set of package files
// rather than one contracted path; `tests/tooling/run-turn.test.ts`'s
// `readFeedback` unit test still pins the branch independent of a paid eval
// run. Exported for exactly that reason.
export function readFeedback(repo, caseDef) {
  if (!caseDef.artifact) return { feedbackExists: false, feedback: "" }
  const feedbackPath = join(repo, caseDef.artifact)
  const feedbackExists = existsSync(feedbackPath)
  return { feedbackExists, feedback: feedbackExists ? readFileSync(feedbackPath, "utf-8") : "" }
}

function identifierOk(caseDef, variant, feedback) {
  return (
    variant !== "violation" ||
    !caseDef.plantedIdentifier ||
    feedback.includes(caseDef.plantedIdentifier)
  )
}

// Mirrors `checkOutOfBounds` in `evals/asserts/shared.mjs` — a turn that
// touched the planted out-of-bounds file must never read as structurally ok,
// or the expensive judge still gets billed on a turn the free tier already
// knows is wrong. Scoped to `expect[variant].outOfBounds`, never a case-level
// field — the trap file exists only on the variant that plants it, so a
// `clean` turn writing that same path itself (e.g. a fresh reproduction
// test) must never be graded as touching a trap that was never planted
// there.
function outOfBoundsOk(caseDef, variant, gtdFilesChanged, otherFilesChanged) {
  const outOfBounds = caseDef.expect[variant].outOfBounds
  if (!outOfBounds) return true
  return !gtdFilesChanged.includes(outOfBounds) && !otherFilesChanged.includes(outOfBounds)
}

// Tiers 1 AND 2: the shape check the deterministic asserts run, plus the
// grep floor for `plantedIdentifier`. Without tier 2 here, a well-formed but
// WRONG artifact reads as "structurally ok" and still bills a full-size
// judge call on feedback the cheap tier already rejected.
function isStructurallyOk(
  caseDef,
  variant,
  gtdFilesChanged,
  otherFilesChanged,
  unformatted,
  feedback,
) {
  const expect = caseDef.expect[variant]
  const otherFilesOk =
    expect.otherFiles === "none" ? otherFilesChanged.length === 0 : otherFilesChanged.length > 0
  const checks = [
    !matchGtdFiles(gtdFilesChanged, expect.gtdFiles),
    otherFilesOk,
    outOfBoundsOk(caseDef, variant, gtdFilesChanged, otherFilesChanged),
    unformatted.length === 0,
    identifierOk(caseDef, variant, feedback),
  ]
  return checks.every(Boolean)
}

// A path-to-content map of `.gtd/packages/`, empty when the directory
// doesn't exist. Only `evals/asserts/architecture-decompose.mjs` reads
// this — the case declares no `artifact`, so there's no single contracted
// path `readFeedback` can read back for it.
function readPackageFiles(repo) {
  const dir = join(repo, ".gtd", "packages")
  if (!existsSync(dir)) return {}
  return Object.fromEntries(
    readdirSync(dir)
      .filter((name) => name.endsWith(".md"))
      .map((name) => [`.gtd/packages/${name}`, readFileSync(join(dir, name), "utf-8")]),
  )
}

// `gtd land` refuses (a dirty tree matching no edge) by exiting non-zero —
// `--json=script` throws before any shell script even runs. That must fail
// the TRIAL, never crash the harness: printing a stack trace with
// byte-empty stdout means promptfoo's `exec:` provider hands the graders
// nothing to parse.
function landAndInspect(repo, env, caseDef, variant) {
  let preLandHead, postLandHead
  try {
    ;({ preLandHead, postLandHead } = land(repo, env))
  } catch (err) {
    return {
      feedbackExists: false,
      feedback: "",
      gtdFilesChanged: [],
      otherFilesChanged: [],
      unformatted: [],
      landedSubject: "",
      structurallyOk: false,
      packageFiles: {},
      landError: err.message,
    }
  }

  const landedSubject = git(repo, env, "log", "-1", "--format=%s")
  const { gtdFilesChanged, otherFilesChanged } = changedFiles(repo, env, preLandHead, postLandHead)
  const { feedbackExists, feedback } = readFeedback(repo, caseDef)
  const unformatted = unformattedGtdFiles(repo, env)
  const structurallyOk = isStructurallyOk(
    caseDef,
    variant,
    gtdFilesChanged,
    otherFilesChanged,
    unformatted,
    feedback,
  )

  return {
    feedbackExists,
    feedback,
    gtdFilesChanged,
    otherFilesChanged,
    unformatted,
    landedSubject,
    structurallyOk,
    packageFiles: readPackageFiles(repo),
  }
}

async function main() {
  const { models, caseName, variant } = parseArgs(process.argv.slice(2))
  const caseDef = await loadCase(caseName)
  checkInfra(models, caseName, caseDef, variant)

  const env = scrubbedEnv(
    Object.fromEntries(Object.entries(MODEL_ENV_VAR).map(([cls, envVar]) => [envVar, models[cls]])),
  )

  let repo
  try {
    repo = buildFixture(caseDef, variant, env)
  } catch (err) {
    fail(`run-turn: fixture build failed: ${err.message}`)
    return
  }

  driveTurn(repo, env)
  const result = landAndInspect(repo, env, caseDef, variant)

  if (process.env.EVAL_CLEAN === "1") {
    execFileSync("rm", ["-rf", repo])
  } else {
    console.error(`run-turn: fixture repo kept at ${repo}`)
  }

  const modelsField = `planner=${models.planner} coder=${models.coder}`
  process.stdout.write(
    JSON.stringify({ repo, case: caseName, variant, models: modelsField, ...result }) + "\n",
  )
}

// Guards direct execution vs. import: `tests/tooling/run-turn.test.ts` imports
// `buildClaudeArgv` for a pure unit test, and a bare import must never run a
// real eval turn as a side effect.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => fail(`run-turn: unexpected error: ${err.stack ?? err.message}`))
}

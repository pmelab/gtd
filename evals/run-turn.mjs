// The promptfoo `exec:` provider for every case: builds a fixture repo,
// drives exactly ONE real driver turn against it (`gtd next` -> `pi -p` ->
// `gtd land`), and prints one line of JSON for each case's own
// `evals/asserts/<name>.mjs` (tiers 1/2) and the `llm-rubric` in
// `evals/promptfooconfig.yaml` (tier 3) to inspect. No `#!` here on purpose:
// `evals/promptfooconfig.yaml` always spawns this as `node run-turn.mjs`,
// never `./run-turn.mjs` directly, and a leading shebang breaks Vite's SSR
// transform of the dynamic `import(`./cases/${caseName}.mjs`)` below —
// `tests/tooling/run-turn.test.ts`'s static import of this module would fail
// to even parse with one present.
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import assert from "node:assert"
import { buildFixture, scrubbedEnv, GTD_BIN, OXFMT_BIN } from "./fixture.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const PI_BIN = join(HERE, "..", "node_modules", ".bin", "pi")

// Pinned judge provider id, duplicated (not imported) from
// evals/promptfooconfig.yaml on purpose: the judge is never the model under
// test, and this is the startup guard that enforces it.
const JUDGE_MODEL = "gpt-5.4"

// gtd picks a model per state by class (planner vs. coder); each class needs
// its own `--<class> <id>` flag and its own fixture env var.
const MODEL_ENV_VAR = Object.freeze({ planner: "GTD_PLANNERMODEL", coder: "GTD_CODERMODEL" })

const TURN_TIMEOUT_MS = 600_000

// Pins the harness's tool surface to the four docs/development.md promises a
// baseline was measured under — `pi`'s own default happens to match today,
// but a `pi` version bump could widen that default with nothing here
// failing. Duplicated in docs/development.md's "## Prompt evals" section on
// purpose; keep both in sync.
export const PINNED_TOOLS = "read,write,edit,bash"

export function buildPiArgv(turnModel, system, gatewayKey) {
  return [
    "-p",
    "--model",
    `gtd-evals/${turnModel}`,
    "--system-prompt",
    system,
    "--api-key",
    gatewayKey,
    "--no-session",
    "-nc",
    "--tools",
    PINNED_TOOLS,
  ]
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

function parseArgs(argv) {
  const models = {}
  const consumed = new Set()
  for (const cls of Object.keys(MODEL_ENV_VAR)) {
    const idx = argv.indexOf(`--${cls}`)
    models[cls] = idx !== -1 ? argv[idx + 1] : undefined
    if (idx !== -1) {
      consumed.add(idx)
      consumed.add(idx + 1)
    }
  }
  // `exec:` hands the rendered `{{case}}:{{variant}}` prompt through as a
  // plain positional — it is the first argv entry not consumed by any
  // `--<class>` flag/value pair. With no model flags at all, nothing is
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

// Throws on an unreachable gateway or a non-2xx response — the caller
// treats either as a precondition failure, never a skipped check: treating
// an unreachable gateway as "the id is probably fine" sends the run into 16
// doomed turns instead of failing loudly at startup.
async function fetchServedModelIds(gatewayUrl, gatewayKey) {
  const res = await fetch(`${gatewayUrl}/models`, {
    headers: { Authorization: `Bearer ${gatewayKey}` },
  })
  if (!res.ok) throw new Error(`GET ${gatewayUrl}/models responded ${res.status}`)
  const body = await res.json()
  return new Set((body.data ?? []).map((m) => m.id))
}

async function checkModelServed(gatewayUrl, gatewayKey, model) {
  let ids
  try {
    ids = await fetchServedModelIds(gatewayUrl, gatewayKey)
  } catch (err) {
    return `run-turn: ${err.message}`
  }
  return ids.has(model) ? undefined : `run-turn: model "${model}" is not served by GTD_EVALS_URL`
}

// The `/models` check needs a gateway URL and a key to run at all — either
// already failing makes an additional network call pointless and would
// otherwise report a confusing secondary error. Probes each DISTINCT id once
// (planner === coder collapses to a single call).
async function modelServedFailures(models, gatewayUrl, gatewayKey) {
  if (!gatewayUrl || !gatewayKey) return []
  const ids = [...new Set(Object.values(models))].filter(Boolean)
  const failures = await Promise.all(ids.map((id) => checkModelServed(gatewayUrl, gatewayKey, id)))
  return failures.filter(Boolean)
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

function baseInfraChecks(models, caseName, caseDef, variant, gatewayUrl, gatewayKey) {
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
    [!existsSync(PI_BIN), `run-turn: missing bundle at ${PI_BIN} — run \`npm install\` first`],
    [!gatewayUrl, "run-turn: GTD_EVALS_URL is not set"],
    [!gatewayKey, "run-turn: GTD_EVALS_KEY is not set"],
  ]
}

async function infraFailures(models, caseName, caseDef, variant) {
  const gatewayUrl = process.env.GTD_EVALS_URL
  const gatewayKey = process.env.GTD_EVALS_KEY
  const checks = baseInfraChecks(models, caseName, caseDef, variant, gatewayUrl, gatewayKey)
  for (const message of await modelServedFailures(models, gatewayUrl, gatewayKey)) {
    checks.push([true, message])
  }
  return checks
}

async function checkInfra(models, caseName, caseDef, variant) {
  for (const [failed, message] of await infraFailures(models, caseName, caseDef, variant)) {
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
    fail(`run-turn: oxfmt --list-different failed unexpectedly: ${err.message}`)
    return []
  }
}

/**
 * Writes pi's per-run config directory: a `models.json` declaring exactly
 * the one model under test as an OpenAI-compatible provider pointed at
 * `GTD_EVALS_URL`. The real key never lands in the file (`apiKey` is a
 * placeholder) — it rides on `--api-key` at spawn time, because a
 * `"$GTD_EVALS_KEY"` interpolation cannot resolve against a scrubbed
 * environment.
 */
function writePiConfig(gatewayUrl, model) {
  const piDir = mkdtempSync(join(tmpdir(), "gtd-eval-pi-"))
  const modelsJson = {
    providers: {
      "gtd-evals": {
        baseUrl: gatewayUrl,
        api: "openai-completions",
        apiKey: "unused",
        compat: { supportsDeveloperRole: false },
        models: [{ id: model, contextWindow: 200_000, maxTokens: 32_000 }],
      },
    },
  }
  try {
    writeFileSync(join(piDir, "models.json"), JSON.stringify(modelsJson, null, 2) + "\n")
  } catch (err) {
    // A failed write must fail the trial rather than let pi fall back to a
    // built-in provider and grade a model nobody chose.
    fail(`run-turn: failed to write ${piDir}/models.json: ${err.message}`)
  }
  return piDir
}

/** Reads the rest gtd's landed fixture is resting at, and runs the ONE agent turn against it. */
function driveTurn(repo, env, gatewayUrl, gatewayKey) {
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
  // empty.
  const prompt = gtd(repo, env, "next")

  const piDir = writePiConfig(gatewayUrl, turnModel)
  const piEnv = { ...env, PI_CODING_AGENT_DIR: piDir, PI_OFFLINE: "1" }

  assertTmpCwd(repo)
  try {
    execFileSync(PI_BIN, buildPiArgv(turnModel, system, gatewayKey), {
      cwd: repo,
      env: piEnv,
      input: prompt,
      encoding: "utf-8",
      timeout: TURN_TIMEOUT_MS,
    })
  } catch (err) {
    fail(`run-turn: agent turn failed or timed out: ${err.message} (repo kept at ${repo})`)
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

// `caseDef.artifact` is absent for a case that produces no state file
// (`packages.item.building`) — skip cleanly rather than reading a path that
// was never contracted.
function readFeedback(repo, caseDef) {
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
    JSON.stringify(gtdFilesChanged) === JSON.stringify(expect.gtdFiles),
    otherFilesOk,
    unformatted.length === 0,
    identifierOk(caseDef, variant, feedback),
  ]
  return checks.every(Boolean)
}

/** Lands the turn's script and reports everything the graders need about what it did. */
function landAndInspect(repo, env, caseDef, variant) {
  const { preLandHead, postLandHead } = land(repo, env)
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
  }
}

async function main() {
  const { models, caseName, variant } = parseArgs(process.argv.slice(2))
  const caseDef = await loadCase(caseName)
  await checkInfra(models, caseName, caseDef, variant)

  // Read before scrubbing: scrubbedEnv drops every `GTD_*` var, including
  // these two.
  const gatewayUrl = process.env.GTD_EVALS_URL
  const gatewayKey = process.env.GTD_EVALS_KEY

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

  driveTurn(repo, env, gatewayUrl, gatewayKey)
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
// `buildPiArgv` for a pure unit test, and a bare import must never run a real
// eval turn as a side effect.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => fail(`run-turn: unexpected error: ${err.stack ?? err.message}`))
}

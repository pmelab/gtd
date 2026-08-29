#!/usr/bin/env node
// The promptfoo `exec:` provider for the spec-review case: builds a fixture
// repo under one model CONFIGURATION (`--planner <id> --coder <id>`), drives
// exactly ONE real driver turn against it (`gtd next` -> `pi -p` ->
// `gtd land`), and prints one line of JSON for the graders in
// `evals/asserts/spec-review.mjs` (tiers 1/2) and the `llm-rubric` in
// `evals/promptfooconfig.yaml` (tier 3) to inspect.
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import assert from "node:assert"
import spec from "./cases/spec-review.mjs"
import { buildFixture, scrubbedEnv, GTD_BIN, OXFMT_BIN } from "./fixture.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const PI_BIN = join(HERE, "..", "node_modules", ".bin", "pi")

// Pinned judge provider id, duplicated (not imported) from
// evals/promptfooconfig.yaml on purpose: the judge is never the model under
// test, and this is the startup guard that enforces it.
const JUDGE_MODEL = "gpt-5.4"

const TURN_TIMEOUT_MS = 600_000

function fail(message) {
  console.error(message)
  process.exit(1)
}

// The workflow marks every prompt state with a model CLASS —
// `plannerModel` for triage/design/review turns, `coderModel` for build/fix
// turns (`src/workflows/unified.yaml`). A case therefore never picks its own
// model: it names a state, and the class that state is marked with decides
// which of the pair the turn runs under. `driveTurn` reads the resolved name
// back out of `gtd next --json=model` rather than assuming either one.
const MODEL_CLASSES = Object.freeze({ planner: "GTD_PLANNERMODEL", coder: "GTD_CODERMODEL" })

/**
 * `--planner <model> --coder <model> <variant>`. Both flags are always
 * required even though a given case exercises only the class its state is
 * marked with — a configuration is a PAIR, and letting one half go
 * unspecified would silently grade a fallback nobody recorded.
 */
function parseArgs(argv) {
  const models = {}
  const consumed = new Set()
  for (const [name, _envVar] of Object.entries(MODEL_CLASSES)) {
    const idx = argv.indexOf(`--${name}`)
    if (idx === -1) continue
    models[name] = argv[idx + 1]
    consumed.add(idx).add(idx + 1)
  }
  // `exec:` hands the rendered `{{variant}}` prompt through as a plain
  // positional — whichever slot it lands in, it is the one argument left
  // once every flag and its value are removed.
  const variant = argv.filter((_, i) => !consumed.has(i))[0]
  return { models, variant }
}

/** `planner=<id> coder=<id>`, the configuration label's expansion, for the result JSON. */
function describeModels(models) {
  return Object.entries(models)
    .map(([cls, id]) => `${cls}=${id}`)
    .join(" ")
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

// The `/models` check needs a model, a gateway URL, and a key to run at all
// — any of those already failing makes an additional network call
// pointless and would otherwise report a confusing secondary error. Every
// class in the configuration is checked, not just the one this case's state
// happens to use: a typo in the unused half must fail at startup rather
// than lie dormant until a case of that class is added.
async function modelServedFailures(models, gatewayUrl, gatewayKey) {
  if (!gatewayUrl || !gatewayKey) return []
  const failures = []
  for (const id of new Set(Object.values(models).filter(Boolean))) {
    const failure = await checkModelServed(gatewayUrl, gatewayKey, id)
    if (failure) failures.push(failure)
  }
  return failures
}

function modelClassChecks(models) {
  return Object.keys(MODEL_CLASSES).flatMap((cls) => [
    [!models[cls], `run-turn: --${cls} <model> is required`],
    [
      models[cls] === JUDGE_MODEL,
      `run-turn: ${cls} model "${models[cls]}" must never be the pinned judge model`,
    ],
  ])
}

function baseInfraChecks(models, variant, gatewayUrl, gatewayKey) {
  return [
    [!variant || !(variant in spec.variants), `run-turn: unknown or missing variant "${variant}"`],
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

async function infraFailures(models, variant) {
  const gatewayUrl = process.env.GTD_EVALS_URL
  const gatewayKey = process.env.GTD_EVALS_KEY
  const checks = baseInfraChecks(models, variant, gatewayUrl, gatewayKey)
  for (const failure of await modelServedFailures(models, gatewayUrl, gatewayKey)) {
    checks.push([true, failure])
  }
  return checks
}

async function checkInfra(models, variant) {
  for (const [failed, message] of await infraFailures(models, variant)) {
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
  const validate = gtd(repo, env, "next", "--json=validate").trim()
  if (validate) fail(`run-turn: expected no validate step, got "${validate}"`)

  const prompt = gtd(repo, env, "next")

  const piDir = writePiConfig(gatewayUrl, turnModel)
  const piEnv = { ...env, PI_CODING_AGENT_DIR: piDir, PI_OFFLINE: "1" }

  assertTmpCwd(repo)
  try {
    execFileSync(
      PI_BIN,
      [
        "-p",
        "--model",
        `gtd-evals/${turnModel}`,
        "--system-prompt",
        system,
        "--api-key",
        gatewayKey,
        "--no-session",
        "-nc",
      ],
      { cwd: repo, env: piEnv, input: prompt, encoding: "utf-8", timeout: TURN_TIMEOUT_MS },
    )
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

function readFeedback(repo) {
  const feedbackPath = join(repo, ".gtd/SPEC_FEEDBACK.md")
  const feedbackExists = existsSync(feedbackPath)
  return { feedbackExists, feedback: feedbackExists ? readFileSync(feedbackPath, "utf-8") : "" }
}

function expectedGtdFiles(variant) {
  return variant === "violation" ? [".gtd/SPEC_FEEDBACK.md"] : []
}

function identifierOk(variant, feedback) {
  return variant !== "violation" || feedback.includes(spec.plantedIdentifier)
}

// Tiers 1 AND 2: the shape check the deterministic asserts run, plus the
// grep floor for `plantedIdentifier`. Without tier 2 here, a well-formed but
// WRONG `.gtd/SPEC_FEEDBACK.md` reads as "structurally ok" and still bills a
// full-size judge call on feedback the cheap tier already rejected.
function isStructurallyOk(variant, gtdFilesChanged, otherFilesChanged, unformatted, feedback) {
  const checks = [
    JSON.stringify(gtdFilesChanged) === JSON.stringify(expectedGtdFiles(variant)),
    otherFilesChanged.length === 0,
    unformatted.length === 0,
    identifierOk(variant, feedback),
  ]
  return checks.every(Boolean)
}

/** Lands the turn's script and reports everything the graders need about what it did. */
function landAndInspect(repo, env, variant) {
  const { preLandHead, postLandHead } = land(repo, env)
  const landedSubject = git(repo, env, "log", "-1", "--format=%s")
  const { gtdFilesChanged, otherFilesChanged } = changedFiles(repo, env, preLandHead, postLandHead)
  const { feedbackExists, feedback } = readFeedback(repo)
  const unformatted = unformattedGtdFiles(repo, env)
  const structurallyOk = isStructurallyOk(
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
  const { models, variant } = parseArgs(process.argv.slice(2))
  await checkInfra(models, variant)

  // Read before scrubbing: scrubbedEnv drops every `GTD_*` var, including
  // these two.
  const gatewayUrl = process.env.GTD_EVALS_URL
  const gatewayKey = process.env.GTD_EVALS_KEY

  // Both classes are injected for every case. The state under test consumes
  // exactly one of them; the other is still pinned so a case of that class
  // added later inherits the configuration instead of a stray default.
  const modelEnv = Object.fromEntries(
    Object.entries(MODEL_CLASSES).map(([cls, envVar]) => [envVar, models[cls]]),
  )
  const env = scrubbedEnv(modelEnv)

  let repo
  try {
    repo = buildFixture(spec, variant, env)
  } catch (err) {
    fail(`run-turn: fixture build failed: ${err.message}`)
    return
  }

  driveTurn(repo, env, gatewayUrl, gatewayKey)
  const result = landAndInspect(repo, env, variant)

  if (process.env.EVAL_CLEAN === "1") {
    execFileSync("rm", ["-rf", repo])
  } else {
    console.error(`run-turn: fixture repo kept at ${repo}`)
  }

  process.stdout.write(
    JSON.stringify({ repo, variant, models: describeModels(models), ...result }) + "\n",
  )
}

main().catch((err) => fail(`run-turn: unexpected error: ${err.stack ?? err.message}`))

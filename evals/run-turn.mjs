#!/usr/bin/env node
// The promptfoo `exec:` provider for the spec-review case: builds a fixture
// repo, drives exactly ONE real driver turn against it (`gtd next` -> `claude
// -p` -> `gtd land`), and prints one line of JSON for the graders in
// `evals/asserts/spec-review.mjs` (tiers 1/2) and the `llm-rubric` in
// `evals/promptfooconfig.yaml` (tier 3) to inspect.
import { execFileSync, execSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert"
import spec from "./cases/spec-review.mjs"
import { buildFixture, scrubbedEnv, GTD_BIN, OXFMT_BIN } from "./fixture.mjs"

// Pinned judge provider id, duplicated (not imported) from
// evals/promptfooconfig.yaml on purpose: the judge is never the model under
// test, and this is the startup guard that enforces it.
const JUDGE_MODEL = "anthropic:messages:claude-sonnet-4-5-20250929"

const TURN_TIMEOUT_MS = 600_000

function fail(message) {
  console.error(message)
  process.exit(1)
}

function parseArgs(argv) {
  const modelIdx = argv.indexOf("--model")
  const model = modelIdx !== -1 ? argv[modelIdx + 1] : undefined
  // `exec:` hands the rendered `{{variant}}` prompt through as a plain
  // positional — whichever slot it lands in, it is the one argument left
  // once --model and its value are removed. With no `--model` at all,
  // nothing is removed — filtering index 0 unconditionally would drop the
  // variant itself and misreport a missing model as a missing variant.
  const rest = modelIdx === -1 ? argv : argv.filter((_, i) => i !== modelIdx && i !== modelIdx + 1)
  const variant = rest[0]
  return { model, variant }
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

function claudeOnPath() {
  try {
    execSync("command -v claude", { stdio: "ignore" })
    return true
  } catch {
    return false
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

function infraFailures(model, variant) {
  return [
    [!variant || !(variant in spec.variants), `run-turn: unknown or missing variant "${variant}"`],
    [!model, "run-turn: --model <model> is required"],
    [
      Boolean(model) && JUDGE_MODEL.includes(model),
      `run-turn: model under test "${model}" must never be the pinned judge model`,
    ],
    [
      !existsSync(GTD_BIN),
      `run-turn: missing bundle at ${GTD_BIN} — run \`npx turbo run build\` first`,
    ],
    [!claudeOnPath(), "run-turn: `claude` is not on PATH"],
    [!process.env.ANTHROPIC_API_KEY, "run-turn: ANTHROPIC_API_KEY is not set"],
  ]
}

function checkInfra(model, variant) {
  for (const [failed, message] of infraFailures(model, variant)) {
    if (failed) fail(message)
  }
}

/** Reads the rest gtd's landed fixture is resting at, and runs the ONE agent turn against it. */
function driveTurn(repo, env) {
  const kind = gtd(repo, env, "next", "--json=kind").trim()
  if (kind !== "prompt") {
    fail(`run-turn: expected a "prompt" rest, got "${kind}" (repo kept at ${repo})`)
  }

  const sessionId = gtd(repo, env, "next", "--json=session.id").trim()
  const turnModel = gtd(repo, env, "next", "--json=model").trim()
  const system = gtd(repo, env, "next", "--json=system").trim()
  const validate = gtd(repo, env, "next", "--json=validate").trim()
  if (validate) fail(`run-turn: expected no validate step, got "${validate}"`)

  const prompt = gtd(repo, env, "next")

  assertTmpCwd(repo)
  try {
    execFileSync(
      "claude",
      [
        "-p",
        "--session-id",
        sessionId,
        "--model",
        turnModel,
        "--system-prompt",
        system,
        "--dangerously-skip-permissions",
      ],
      { cwd: repo, env, input: prompt, encoding: "utf-8", timeout: TURN_TIMEOUT_MS },
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
  const { model, variant } = parseArgs(process.argv.slice(2))
  checkInfra(model, variant)

  const env = scrubbedEnv({ GTD_PLANNERMODEL: model })

  let repo
  try {
    repo = buildFixture(spec, variant, env)
  } catch (err) {
    fail(`run-turn: fixture build failed: ${err.message}`)
    return
  }

  driveTurn(repo, env)
  const result = landAndInspect(repo, env, variant)

  if (process.env.EVAL_CLEAN === "1") {
    execFileSync("rm", ["-rf", repo])
  } else {
    console.error(`run-turn: fixture repo kept at ${repo}`)
  }

  process.stdout.write(JSON.stringify({ repo, variant, model, ...result }) + "\n")
}

main().catch((err) => fail(`run-turn: unexpected error: ${err.stack ?? err.message}`))

// Builds a fresh, disposable fixture repo for one eval case + variant: git
// init -> case.base files committed (outside the review range) -> variant
// files written into the working tree -> `gtd --entry <case.state>` piped to
// `sh`, so the entry commit captures exactly the variant's code under review.
//
// Deliberately imports nothing from `tests/` — those helpers are wired into
// the vitest/quickpickle world, not callable from a plain `exec:` process.
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, chmodSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import assert from "node:assert"
import { parse as parseYaml } from "yaml"

const HERE = dirname(fileURLToPath(import.meta.url))
export const GTD_BIN = join(HERE, "..", "dist", "gtd.bundle.mjs")
// This repo's own resolved binary, never `npx oxfmt` — npx resolves whatever
// version its cache holds (fetching from the network on a cold one), which
// can silently drift from the `oxfmt` devDependency every other check here
// is pinned to.
export const OXFMT_BIN = join(HERE, "..", "node_modules", ".bin", "oxfmt")
const OXFMTRC_PATH = join(HERE, "..", ".oxfmtrc.json")

/**
 * Every `GTD_*`, `PI_*`, and `OPENAI_*` var except a caller-supplied override
 * is dropped, and `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE`/`GTD_LOOP_LOG`
 * are always dropped — an inherited `GIT_DIR` would write a fixture's
 * commits into the real repository instead of the throwaway one. This also
 * strips `GTD_EVALS_URL` and `GTD_EVALS_KEY` (both start with `GTD_`), so
 * every read of them must happen from `process.env` in the parent, before
 * this runs.
 */
const SCRUBBED_PREFIXES = ["GTD_", "PI_", "OPENAI_"]

export function scrubbedEnv(overrides = {}) {
  const env = { ...process.env }
  delete env.GIT_DIR
  delete env.GIT_WORK_TREE
  delete env.GIT_INDEX_FILE
  delete env.GTD_LOOP_LOG
  for (const key of Object.keys(env)) {
    if (SCRUBBED_PREFIXES.some((prefix) => key.startsWith(prefix))) delete env[key]
  }
  return { ...env, ...overrides }
}

function assertTmpCwd(cwd) {
  assert(cwd.startsWith(tmpdir()), "must never spawn outside a tmp fixture repo")
}

function git(cwd, env, ...args) {
  assertTmpCwd(cwd)
  return execFileSync("git", args, { cwd, env, encoding: "utf-8" }).trim()
}

function writeFile(dir, relPath, content) {
  const full = join(dir, relPath)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
}

function writeFiles(dir, files) {
  for (const [path, content] of Object.entries(files)) writeFile(dir, path, content)
}

// Mirrors the effect this repository gets from husky -> lint-staged ->
// oxfmt, without installing husky into a throwaway repo. Always exits 0: a
// failing hook would red the land itself, and the eval would then report a
// broken turn instead of a formatting result. Uses this repo's own resolved
// oxfmt binary against this repo's own `.oxfmtrc.json` (copied into the
// fixture below) — not `npx oxfmt` with no config, which formats to stock
// defaults instead of the `*.md` `proseWrap` override every `.gtd/*.md` file
// under review is actually graded against.
function preCommitHookScript(oxfmtBin) {
  return `#!/bin/sh
files=$(git diff --cached --name-only --diff-filter=ACM -- .gtd)
if [ -n "$files" ]; then
  "${oxfmtBin}" --no-error-on-unmatched-pattern --write $files
  git add -- $files
fi
exit 0
`
}

function installPreCommitHook(repo) {
  const hookPath = join(repo, ".git", "hooks", "pre-commit")
  writeFileSync(hookPath, preCommitHookScript(OXFMT_BIN))
  chmodSync(hookPath, 0o755)
}

function writeOxfmtConfig(repo) {
  writeFileSync(join(repo, ".oxfmtrc.json"), readFileSync(OXFMTRC_PATH, "utf-8"))
}

function writeEvalWorkflowConfig(repo) {
  const workflowPath = process.env.GTD_EVAL_WORKFLOW
  if (!workflowPath) return
  const doc = parseYaml(readFileSync(workflowPath, "utf-8"))
  writeFileSync(join(repo, ".gtdrc.json"), JSON.stringify({ workflow: doc }, null, 2) + "\n")
}

/**
 * @param {{state: string, base: Record<string,string>, variants: Record<string, Record<string,string>>}} caseDef
 * @param {string} variant
 * @param {Record<string,string>} [env] child env for every git/gtd invocation — callers that inject
 *   a model override (e.g. `GTD_PLANNERMODEL`) pass their own scrubbed env here.
 * @returns {string} the fixture repo's absolute path
 */
export function buildFixture(caseDef, variant, env = scrubbedEnv()) {
  if (!(variant in caseDef.variants)) {
    throw new Error(`unknown variant "${variant}" for case "${caseDef.name}"`)
  }

  const repo = mkdtempSync(join(tmpdir(), "gtd-eval-"))
  assert(repo.startsWith(tmpdir()), "fixture repo must live under the OS tmpdir")

  git(repo, env, "init", "-q")
  git(repo, env, "config", "user.name", "gtd-eval")
  git(repo, env, "config", "user.email", "gtd-eval@test.invalid")
  git(repo, env, "config", "commit.gpgsign", "false")
  installPreCommitHook(repo)

  writeOxfmtConfig(repo)
  writeEvalWorkflowConfig(repo)
  writeFile(repo, "README.md", "# gtd eval fixture\n")
  git(repo, env, "add", "-A")
  git(repo, env, "commit", "-q", "-m", "chore: initial commit")

  writeFiles(repo, caseDef.base)
  git(repo, env, "add", "-A")
  git(repo, env, "commit", "-q", "-m", "chore: base fixture files")

  writeFiles(repo, caseDef.variants[variant])

  assertTmpCwd(repo)
  const script = execFileSync(process.execPath, [GTD_BIN, "--entry", caseDef.state], {
    cwd: repo,
    env,
    encoding: "utf-8",
  })
  assertTmpCwd(repo)
  execFileSync("sh", ["-c", script], { cwd: repo, env, encoding: "utf-8" })

  return repo
}

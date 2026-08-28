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

/**
 * Every `GTD_*` var except a caller-supplied model override is dropped, and
 * `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE`/`GTD_LOOP_LOG` are always
 * dropped — an inherited `GIT_DIR` would write a fixture's commits into the
 * real repository instead of the throwaway one.
 */
export function scrubbedEnv(overrides = {}) {
  const env = { ...process.env }
  delete env.GIT_DIR
  delete env.GIT_WORK_TREE
  delete env.GIT_INDEX_FILE
  delete env.GTD_LOOP_LOG
  for (const key of Object.keys(env)) {
    if (key.startsWith("GTD_")) delete env[key]
  }
  return { ...env, ...overrides }
}

function git(cwd, env, ...args) {
  assert(cwd.startsWith(tmpdir()), "git must never run outside a tmp fixture repo")
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
// broken turn instead of a formatting result.
const PRE_COMMIT_HOOK = `#!/bin/sh
files=$(git diff --cached --name-only --diff-filter=ACM -- .gtd)
if [ -n "$files" ]; then
  npx oxfmt --no-error-on-unmatched-pattern --write $files
  git add -- $files
fi
exit 0
`

function installPreCommitHook(repo) {
  const hookPath = join(repo, ".git", "hooks", "pre-commit")
  writeFileSync(hookPath, PRE_COMMIT_HOOK)
  chmodSync(hookPath, 0o755)
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

  writeEvalWorkflowConfig(repo)
  writeFile(repo, "README.md", "# gtd eval fixture\n")
  git(repo, env, "add", "-A")
  git(repo, env, "commit", "-q", "-m", "chore: initial commit")

  writeFiles(repo, caseDef.base)
  git(repo, env, "add", "-A")
  git(repo, env, "commit", "-q", "-m", "chore: base fixture files")

  writeFiles(repo, caseDef.variants[variant])

  const script = execFileSync(process.execPath, [GTD_BIN, "--entry", caseDef.state], {
    cwd: repo,
    env,
    encoding: "utf-8",
  })
  execFileSync("sh", ["-c", script], { cwd: repo, env, encoding: "utf-8" })

  return repo
}

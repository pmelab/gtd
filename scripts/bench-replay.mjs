#!/usr/bin/env node
// A one-off, hand-run measurement — not a test, not a turbo task (see
// Package 1's Design). It builds a throwaway repository whose git history
// mimics a real gtd process (a long chain of `gtd(actor): from → to` step
// commits ahead of a run of ordinary backdrop commits), then times `gtd next
// --json` and `gtd land` against it with a counting `git` shim on `PATH`.
//
// Every number this prints is a `git` subprocess count and a wall-clock
// duration — nothing here asserts a budget, so nothing reds when a later
// change regresses it. Re-run this by hand to compare.

import { execFileSync } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  chmodSync,
  existsSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url))
const GTD_BIN = join(REPO_ROOT, "dist", "gtd.bundle.mjs")

/** Fail loudly up front — before a single row is printed — rather than let every measured `gtd` invocation crash on a missing module and look like a fast, zero-call refusal. */
function requireBuiltGtd() {
  if (!existsSync(GTD_BIN)) {
    throw new Error(`bench-replay: ${GTD_BIN} does not exist — run \`npm run build\` first`)
  }
}

// ── Commit-message codec (mirrors src/replay/Trailers.ts's `formatSubject`/
// `formatCommitMessage`) — duplicated rather than imported, since this script
// runs as plain Node, outside the TypeScript build. ─────────────────────────

const TRANSITION_SEP = " → "

const formatSubject = (actor, to, from) =>
  from === undefined || from === to
    ? `gtd(${actor}): ${to}`
    : `gtd(${actor}): ${from}${TRANSITION_SEP}${to}`

const formatCommitMessage = ({ actor, to, from, step }) => {
  const subject = formatSubject(actor, to, from)
  if (step === undefined) return subject
  return `${subject}\n\nGtd-Step: ${step.name}#${step.occurrence}`
}

// ── Throwaway repository builder ────────────────────────────────────────────
//
// Built via a single `git fast-import` stream rather than one `git commit`
// subprocess per commit — the only way a 50 000-commit backdrop finishes in
// seconds instead of minutes, and irrelevant to what's measured: fast-import
// is the builder's own plumbing, never on `PATH` while a `gtd` command runs.

const git = (dir, ...args) =>
  execFileSync("git", args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] })

const requirementsContent = (n) =>
  `Build a thing. <!-- bench-replay iteration ${n} -->\n\n## Open Questions\n\n### Which option?\n\n- [ ] A\n- [ ] B\n`

/** One fast-import `commit` block. `files` (path → content) replace/add; omitted paths carry over from the parent unchanged — fast-import's own "no M means inherit the parent's tree" rule, the batch-mode equivalent of an empty `git commit`. */
class FastImport {
  lines = []
  mark = 0
  timestamp = 1700000000

  commit(message, files = {}, deletes = []) {
    this.mark++
    this.timestamp++
    this.lines.push(`commit refs/heads/main`, `mark :${this.mark}`)
    this.lines.push(`committer bench-replay <bench-replay@test> ${this.timestamp} +0000`)
    this.lines.push(`data ${Buffer.byteLength(message, "utf8")}`, message)
    if (this.mark > 1) this.lines.push(`from :${this.mark - 1}`)
    for (const path of deletes) this.lines.push(`D ${path}`)
    for (const [path, content] of Object.entries(files)) {
      this.lines.push(`M 100644 inline ${path}`)
      this.lines.push(`data ${Buffer.byteLength(content, "utf8")}`, content)
    }
    return this.mark
  }

  toString() {
    return this.lines.join("\n") + "\ndone\n"
  }
}

/**
 * Builds a repository with `backdropCount` ordinary commits followed by an
 * ORDINARY gtd process (no `--entry`, so every commit is a real landed step —
 * no bare entry-marker commit to throw the count off) whose history is
 * exactly `episodeLength` step commits long: `idle` (the human's sketch),
 * `unwind` (reverting it clean), `start-gate.check` (green), then
 * `design.triage` / `design.gate.answer` alternating forever — a loop the
 * bundled workflow's `design()` genuinely takes for as long as
 * `design.triage` keeps leaving an open question in `.gtd/REQUIREMENTS.md`
 * (see src/workflows/planning.ts's `questionGate`) and the human keeps
 * landing that gate clean (`acceptClean: true`, allowed by `requireAnswers`'s
 * "an untouched tree is silence" rule). No test suite is ever actually run —
 * `check`/`run` steps only need their tree to show what a real run would have
 * left (here: `.gtd/FEEDBACK.md` absent, i.e. green).
 */
const initRepo = (dir) => {
  git(dir, "init", "-q", "-b", "main")
  git(dir, "config", "user.name", "bench-replay")
  git(dir, "config", "user.email", "bench-replay@test")
  git(dir, "config", "commit.gpgsign", "false")
}

const step = (actor, from, to, occurrence, files) => ({
  message: formatCommitMessage({ actor, from, to, step: { name: from, occurrence } }),
  files,
})

/** The bundled workflow's own step sequence, lazily — `appendEpisode` below takes exactly as many as `episodeLength` needs, so nothing past that is ever built. */
function* episodeSteps() {
  yield step("human", "idle", "unwind", 1, { ".gtd/TODO.md": "Add a feature.\n" })
  yield { ...step("check", "unwind", "start-gate.check", 1), deletes: [".gtd/TODO.md"] }
  yield step("check", "start-gate.check", "design.triage", 1)
  for (let occurrence = 1; ; occurrence++) {
    yield step("agent", "design.triage", "design.gate.answer", occurrence, {
      ".gtd/REQUIREMENTS.md": requirementsContent(occurrence),
    })
    yield step("human", "design.gate.answer", "design.triage", occurrence)
  }
}

/** Exactly `episodeLength` step commits — never one more, never one fewer. */
function appendEpisode(fi, episodeLength) {
  const steps = episodeSteps()
  for (let i = 0; i < episodeLength; i++) {
    const { message, files, deletes } = steps.next().value
    fi.commit(message, files, deletes)
  }
}

function buildRepo(dir, { backdropCount, episodeLength }) {
  initRepo(dir)

  const fi = new FastImport()
  fi.commit("chore: initial commit", {
    "README.md": "# bench-replay fixture\n",
    ".gtdrc.json": JSON.stringify({ env: { testCommand: "true" } }, null, 2) + "\n",
  })
  for (let i = 1; i <= backdropCount; i++) fi.commit(`chore: backdrop ${i}`)
  appendEpisode(fi, episodeLength)

  execFileSync("git", ["fast-import", "--quiet"], { cwd: dir, input: fi.toString() })
  git(dir, "reset", "-q", "--hard", "main")
}

// ── Counting git shim ────────────────────────────────────────────────────────

const realGitPath = () => execFileSync("sh", ["-c", "command -v git"]).toString().trim()

/** A `git` shim first on `PATH`: appends one line per invocation to `countFile`, then execs the real git. */
function writeShim(shimDir, countFile, realGit) {
  mkdirSync(shimDir, { recursive: true })
  const shimPath = join(shimDir, "git")
  writeFileSync(
    shimPath,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(countFile)}\nexec ${JSON.stringify(realGit)} "$@"\n`,
  )
  chmodSync(shimPath, 0o755)
}

// The count file is created (truncated) by `timeGtd` immediately before every
// invocation it measures, so reading it back is never expected to fail — an
// ENOENT here means something upstream is already broken, not a case to hide.
const countInvocations = (countFile) => {
  const content = readFileSync(countFile, "utf8")
  return content === "" ? 0 : content.split("\n").filter((l) => l.length > 0).length
}

/**
 * gtd's own exit-code contract (docs/cli.md's Exit codes table) makes exit 1
 * carry ONE meaning, "refusal or defect", always paired with a `gtd`-prefixed
 * stderr line (or `gtd `-prefixed JSON envelope) — that pairing is what a
 * genuine gtd outcome looks like, walked replay and all. Anything else
 * (a different exit code, a signal death, or a 1 with no `gtd`-shaped stderr —
 * e.g. Node's own "Cannot find module" crash) never reached gtd's own error
 * channel at all, so it must not be counted as a measurement.
 */
const isDocumentedRefusal = (error) =>
  error.status === 1 && error.signal === null && /^gtd\b/.test((error.stderr ?? "").trimStart())

const crashMessage = (args, error) =>
  `bench-replay: \`node ${GTD_BIN} ${args.join(" ")}\` did not exit as a documented gtd refusal ` +
  `(status ${error.status ?? "?"}, signal ${error.signal ?? "none"}) — treating this as a crash, ` +
  `not a measurement:\n${error.stderr ?? error.message}`

/** Times `gtd <args>` in `dir` with the counting shim first on `PATH`. Swallows only a documented gtd refusal (still a full replay, still worth timing) — anything else is re-thrown, failing the whole run loudly rather than recording a fabricated low number. */
function timeGtd(dir, args, shimDir, countFile) {
  writeFileSync(countFile, "")
  const start = performance.now()
  try {
    execFileSync("node", [GTD_BIN, ...args], {
      cwd: dir,
      env: { ...process.env, PATH: `${shimDir}:${process.env.PATH}` },
      stdio: ["ignore", "ignore", "pipe"],
      encoding: "utf8",
    })
  } catch (error) {
    if (!isDocumentedRefusal(error)) throw new Error(crashMessage(args, error))
  }
  const ms = performance.now() - start
  return { ms, gitCalls: countInvocations(countFile) }
}

// ── Timing table ─────────────────────────────────────────────────────────────

const DEFAULT_BACKDROP = 10
const DEFAULT_EPISODE = 50
const EPISODE_LENGTHS = [1, 10, 50, 100, 200]
const BACKDROP_COUNTS = [1000, 50000]

function measure(scratch, label, { backdropCount, episodeLength }, realGit) {
  const dir = mkdtempSync(join(scratch, "repo-"))
  try {
    buildRepo(dir, { backdropCount, episodeLength })
    const shimDir = mkdtempSync(join(scratch, "shim-"))
    const countFile = join(scratch, `count-${Math.random().toString(36).slice(2)}.log`)
    writeShim(shimDir, countFile, realGit)
    try {
      const next = timeGtd(dir, ["next", "--json"], shimDir, countFile)
      const land = timeGtd(dir, ["land"], shimDir, countFile)
      return { label, backdropCount, episodeLength, next, land }
    } finally {
      rmSync(shimDir, { recursive: true, force: true })
      rmSync(countFile, { force: true })
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function printTable(rows) {
  const headers = ["label", "backdrop", "episode", "next ms", "next git#", "land ms", "land git#"]
  const data = rows.map((r) => [
    r.label,
    String(r.backdropCount),
    String(r.episodeLength),
    r.next.ms.toFixed(1),
    String(r.next.gitCalls),
    r.land.ms.toFixed(1),
    String(r.land.gitCalls),
  ])
  const widths = headers.map((h, i) => Math.max(h.length, ...data.map((row) => row[i].length)))
  const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join("  ")
  console.log(line(headers))
  console.log(widths.map((w) => "-".repeat(w)).join("  "))
  for (const row of data) console.log(line(row))
}

function main() {
  requireBuiltGtd()
  const scratch = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "gtd-bench-replay-"))
  const realGit = realGitPath()
  try {
    const rows = []
    for (const episodeLength of EPISODE_LENGTHS) {
      rows.push(
        measure(
          scratch,
          `episode=${episodeLength}`,
          { backdropCount: DEFAULT_BACKDROP, episodeLength },
          realGit,
        ),
      )
    }
    for (const backdropCount of BACKDROP_COUNTS) {
      rows.push(
        measure(
          scratch,
          `backdrop=${backdropCount}`,
          { backdropCount, episodeLength: DEFAULT_EPISODE },
          realGit,
        ),
      )
    }
    printTable(rows)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

main()

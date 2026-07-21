import { Given } from "quickpickle"
import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { GtdWorld } from "../world.js"

// Composable builders for the flat `gtd: <phase>` taxonomy + the steering files
// (`.gtd/` packages, FEEDBACK.md, ERRORS.md, REVIEW.md). Each step maps to one
// commit or one working-tree change so scenarios can spell the exact history /
// tree the machine resolves against. Generic on purpose — the phase subject and
// file content live in the scenario text, not behind an abstract name.

const git = (dir: string, ...args: string[]) =>
  execFileSync("git", args, { cwd: dir, stdio: "pipe" })

// An empty marker commit carrying just a subject — the unit the counter folds
// read (`gtd: test-failed`, `gtd: feedback`, `gtd: building`, `gtd: building`,
// `gtd: fixing`, …). `--allow-empty` keeps the tree untouched so prior pending
// changes survive as pending.
Given("a commit {string}", (world: GtdWorld, message: string) => {
  if (world.tier === "inmem") {
    // Empty commit: just commit the current state (or if clean, still commit with same tree)
    world.repo!.commitAllWithPrefix(message)
  } else {
    git(world.repoDir, "commit", "--allow-empty", "-q", "-m", message)
  }
})

// Same as "a commit {string}" but with an explicit `Gtd-Counters` body
// trailer, spelled verbatim in the scenario text (e.g. "t=3 r=0 h=0").
// Budgets ride on the NEAREST workflow commit's trailer (no fold), so a
// hand-authored history that wants a non-zero fix/review/health budget must
// say so on its newest workflow commit — exactly like the machine would have.
Given(
  "a commit {string} with counters {string}",
  (world: GtdWorld, subject: string, vector: string) => {
    const message = `${subject}\n\nGtd-Counters: ${vector}`
    if (world.tier === "inmem") {
      world.repo!.commitAllWithPrefix(message)
    } else {
      git(world.repoDir, "commit", "--allow-empty", "-q", "-m", message)
    }
  },
)

// Same as "a commit {string}" but sources the message from a docstring instead
// of a quoted string — for a multi-line message (subject + body + trailer),
// which Gherkin's single-line `{string}` can't express. E.g. a squash commit
// carrying a `## Decisions` section and its `Gtd-Decisions: true` trailer.
Given("a commit with message:", (world: GtdWorld, message: string) => {
  if (world.tier === "inmem") {
    world.repo!.commitAllWithPrefix(message)
  } else {
    git(world.repoDir, "commit", "--allow-empty", "-q", "-m", message)
  }
})

// A commit that deletes a tracked file under the given subject — the `gtd: done`
// that removes REVIEW.md (the default-branch review base), or a commit whose
// diff removes ERRORS.md (the `removedErrors` reset boundary).
Given(
  "a commit {string} that deletes {string}",
  (world: GtdWorld, message: string, path: string) => {
    if (world.tier === "inmem") {
      world.repo!.deleteFile(path)
      world.repo!.commitAllWithPrefix(message)
    } else {
      git(world.repoDir, "rm", "-q", path)
      git(world.repoDir, "commit", "-q", "-m", message)
    }
  },
)

// Stage the whole pending working tree (tracked + untracked) and commit it under
// the verbatim subject — for landing a multi-file `.gtd/` package or any
// many-file change as a single `gtd: …` commit.
Given("the working tree is committed as {string}", (world: GtdWorld, message: string) => {
  if (world.tier === "inmem") {
    world.repo!.commitAllWithPrefix(message)
  } else {
    git(world.repoDir, "add", "-A")
    git(world.repoDir, "commit", "-q", "-m", message)
  }
})

// An empty (zero-byte) working-tree file. The agentic-review approval signal is
// an uncommitted, whitespace-only FEEDBACK.md; this writes one literally empty.
Given("an empty file {string}", (world: GtdWorld, path: string) => {
  if (world.tier === "inmem") {
    world.repo!.writeFile(path, "")
  } else {
    mkdirSync(dirname(join(world.repoDir, path)), { recursive: true })
    writeFileSync(join(world.repoDir, path), "")
  }
})

// Stage the deletion of a committed file, leaving it pending in the working tree
// (status `D `). Drives Testing's human-resume trigger when the file is
// ERRORS.md (a pending ERRORS.md deletion → fresh fix-attempt budget).
Given("a deleted committed file {string}", (world: GtdWorld, path: string) => {
  if (world.tier === "inmem") {
    world.repo!.deleteFile(path)
  } else {
    git(world.repoDir, "rm", path)
  }
})

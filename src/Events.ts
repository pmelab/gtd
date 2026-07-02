import { FileSystem } from "@effect/platform"
import { Effect, Option } from "effect"
import { GitService } from "./Git.js"
import { ConfigService } from "./Config.js"
import { fenceFor } from "./Prompt.js"
import { TestRunner } from "./TestRunner.js"
import type {
  CommitEvent,
  EdgeAction,
  GtdEvent,
  GtdPackageFact,
  ResolvePayload,
} from "./Machine.js"

/**
 * The Effect "edge": all git/filesystem IO lives here. It has two jobs:
 *
 *  1. `gatherEvents` probes the working tree + first-parent commit history and
 *     produces the typed event stream the pure machine folds: one `COMMIT` per
 *     first-parent commit (oldest→newest) followed by a single `RESOLVE`
 *     carrying the working-tree snapshot.
 *  2. `perform` executes the `EdgeAction` the machine's `resolve()` returns
 *     (commit, revert, run tests, write steering files, …) before the driver
 *     re-gathers and re-resolves.
 *
 * The machine (src/Machine.ts) stays free of IO; this module is the only place
 * that touches git/fs.
 */

const TODO_FILE = "TODO.md"
const GTD_DIR = ".gtd"
const REVIEW_FILE = "REVIEW.md"
const FEEDBACK_FILE = "FEEDBACK.md"
const ERRORS_FILE = "ERRORS.md"
const EMPTY_FAILURE_SENTINEL = "Test command failed with no output (exit code non-zero)."
const UNANSWERED_MARKER = "<!-- user answers here -->"

// Flat `gtd: <phase>` taxonomy — the only commit subjects the machine reads or
// the edge writes. Counters fold from these prefixes + the `removedErrors` flag.
const NEW_TASK_SUBJECT = "gtd: new task"
const GRILLING_SUBJECT = "gtd: grilling"
const PLANNING_SUBJECT = "gtd: planning"
const BUILDING_SUBJECT = "gtd: building"
const ERRORS_SUBJECT = "gtd: errors"
const FEEDBACK_SUBJECT = "gtd: feedback"
const PACKAGE_DONE_SUBJECT = "gtd: package done"
const AWAITING_REVIEW_SUBJECT = "gtd: awaiting review"
const DONE_SUBJECT = "gtd: done"
// The accept-review capture commit (commit-then-revert, like `gtd: new task`).
// Distinct from the exact `gtd: feedback` marker the reviewFixCount fold reads.
const REVIEW_FEEDBACK_SUBJECT = "gtd: review feedback"

// Workflow plumbing excluded from every review diff (refDiff) and from the
// grilling-round code capture: neither the reviewer nor a captured suggestion
// block should ever contain steering-file churn (TODO.md seeded/deleted,
// REVIEW.md committed/removed, `.gtd/` packages created/closed).
const WORKFLOW_FILE_EXCLUDES: ReadonlyArray<string> = [
  REVIEW_FILE,
  TODO_FILE,
  FEEDBACK_FILE,
  ERRORS_FILE,
  GTD_DIR,
]

const isGtdPath = (path: string): boolean => path === GTD_DIR || path.startsWith(`${GTD_DIR}/`)
const isSteeringFile = (path: string): boolean =>
  path === TODO_FILE || path === REVIEW_FILE || path === FEEDBACK_FILE || path === ERRORS_FILE

// git's empty-tree object. `git diff <empty-tree> HEAD` yields the entire tree
// as additions — the Clean review base when HEAD is on the default branch and
// no prior REVIEW.md deletion exists ("else the root", STATES.md § Clean).
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

/**
 * Decode a git C-quoted path field (the `"..."` form git emits for paths
 * containing non-ASCII, spaces, or other special characters when
 * `core.quotepath` is on, which is the default).  Plain paths (no surrounding
 * `"`) are returned as-is.
 *
 * Backslash sequences decoded:
 *   `\\` → `\`   `\"` → `"`   `\n` → LF   `\t` → TAB   `\r` → CR
 *   `\NNN` (octal) — bytes are accumulated into a buffer and UTF-8 decoded so
 *   that multi-byte sequences (e.g. a 3-byte UTF-8 emoji) are reconstructed
 *   correctly rather than decoded per-byte.
 */
const unquoteGitPath = (raw: string): string => {
  if (!raw.startsWith('"')) return raw
  // Strip surrounding quotes
  const inner = raw.slice(1, raw.endsWith('"') ? raw.length - 1 : raw.length)
  const bytes: number[] = []
  const chars: string[] = []

  const flushBytes = () => {
    if (bytes.length === 0) return
    const buf = Buffer.from(bytes)
    chars.push(buf.toString("utf8"))
    bytes.length = 0
  }

  let i = 0
  while (i < inner.length) {
    if (inner[i] !== "\\") {
      flushBytes()
      chars.push(inner[i]!)
      i++
      continue
    }
    // Escape sequence
    const esc = inner[i + 1]
    if (esc === undefined) {
      flushBytes()
      chars.push("\\")
      i++
      continue
    }
    // Octal escape: accumulate byte into buffer for later UTF-8 decode
    if (esc >= "0" && esc <= "7") {
      const oct = inner.slice(i + 1, i + 4)
      bytes.push(parseInt(oct, 8))
      i += 4
      continue
    }
    // Non-octal escape: flush any pending bytes first
    flushBytes()
    switch (esc) {
      case "n":
        chars.push("\n")
        break
      case "t":
        chars.push("\t")
        break
      case "r":
        chars.push("\r")
        break
      case "\\":
        chars.push("\\")
        break
      case '"':
        chars.push('"')
        break
      default:
        chars.push("\\", esc)
    }
    i += 2
  }
  flushBytes()
  return chars.join("")
}

const parsePorcelainPaths = (porcelain: string): ReadonlyArray<{ status: string; path: string }> =>
  porcelain
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.length > 0)
    .map((line) => ({ status: line.slice(0, 2), path: unquoteGitPath(line.slice(3)) }))

const isNumberedDir = (name: string): boolean => /^\d+-/.test(name)

/** Every `.md` under a numbered package dir is a task file now (no COMMIT_MSG.md). */
const isTaskFile = (name: string): boolean => name.endsWith(".md")

/**
 * Strip fenced code blocks and inline code spans so a marker token that appears
 * inside a code example does not count as a live open-question marker. The
 * unclosed-fence fallback is anchored to the END OF INPUT (`$(?![\s\S])`) — a
 * bare `$` under the `m` flag matches at every line end, which made the lazy
 * quantifier stop after the first fenced line and leak deeper markers.
 */
const stripCode = (content: string): string =>
  content
    .replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\1[^\n]*|$(?![\s\S]))/gm, "")
    .replace(/`[^`\n]+`/g, "")

/**
 * Read the `.gtd/` work packages, lowest-numbered first. `packages[0]` is the
 * active one. Each numbered dir contributes its task `.md` files (sorted) and
 * their full contents.
 */
export const getPackages = (
  fs: FileSystem.FileSystem,
): Effect.Effect<ReadonlyArray<GtdPackageFact>, Error> =>
  Effect.gen(function* () {
    const gtdExists = yield* fs.exists(GTD_DIR)
    if (!gtdExists) return []

    const entries = yield* fs.readDirectory(GTD_DIR)
    const packageDirs = entries.filter(isNumberedDir).sort()

    const packages: Array<GtdPackageFact> = []
    for (const dir of packageDirs) {
      const packagePath = `${GTD_DIR}/${dir}`
      const stat = yield* fs.stat(packagePath)
      if (stat.type !== "Directory") continue

      const files = yield* fs.readDirectory(packagePath)
      const tasks = files.filter(isTaskFile).sort()
      const taskContents: Array<{ name: string; content: string }> = []
      for (const taskFile of tasks) {
        const content = yield* fs.readFileString(`${packagePath}/${taskFile}`)
        taskContents.push({ name: taskFile, content })
      }
      packages.push({ name: dir, tasks, taskContents })
    }

    return packages
  }).pipe(Effect.mapError((e) => (e instanceof Error ? e : new Error(String(e)))))

/**
 * How the grilling agent must read a captured diff: the three-way feedback
 * interpretation. Embedded in every captured section (seed and grilling-round
 * appends) so the rules travel with TODO.md — they survive checkouts and reach
 * whichever agent picks the file up, not just the one gtd prompts next.
 */
const CAPTURE_RULES = [
  "Interpret the captured diff with these rules:",
  "",
  "- **Code changes** are suggestions, not finished work — plan to re-implement",
  "  them properly, including test coverage, rather than restoring them verbatim.",
  "- **Code comments** are positional feedback about the code at that location.",
  "- **TODO.md / REVIEW.md text changes** are global feedback on the plan or the",
  "  reviewed work as a whole.",
  "- **Checkbox flips** in a captured REVIEW.md diff are approval noise — ignore",
  "  them.",
].join("\n")

/**
 * Deterministic, edge-built TODO.md seed for New Feature / Accept Review. No
 * agent runs during seeding (both states list `Prompt: none`); the next
 * Grilling invocation develops this into a real plan. The captured diff is
 * fenced so any marker it contains is stripped by `stripCode` and does not trip
 * the open-question gate.
 */
export const seedTodo = (capturedDiff: string): string => {
  const body = capturedDiff.replace(/\n+$/, "")
  // Sized past any backtick run in the diff (fenceFor) so formatters cannot
  // close the block early on an indented ``` context line and spill the
  // capture — markers included — out of the fence.
  const fence = fenceFor(body)
  return [
    "# Plan",
    "",
    "## Captured input",
    "",
    "These changes were captured as the starting point for this feature. Develop",
    "them into a concrete plan and surface any open questions for the user.",
    "",
    CAPTURE_RULES,
    "",
    `${fence}diff`,
    body,
    fence,
    "",
  ].join("\n")
}

/**
 * Append a grilling-round capture to an existing TODO.md: code the user
 * sketched while the plan was already committed is folded in as a fenced
 * suggestion block; the edge then drops those changes from the working tree
 * (STATES.md § Grilling). Idempotent — when the exact diff body is already
 * present (a crash between append and commit re-runs the capture), the TODO is
 * returned unchanged. The interpretation rules are included at most once.
 */
export const appendCapturedInput = (todo: string, capturedDiff: string): string => {
  const body = capturedDiff.replace(/\n+$/, "")
  if (todo.includes(body)) return todo
  const fence = fenceFor(body)
  const section = [
    "## Captured input (grilling)",
    "",
    "These code changes were made during grilling and captured as suggestions;",
    "gtd has reverted them from the working tree.",
    "",
    ...(todo.includes(CAPTURE_RULES) ? [] : [CAPTURE_RULES, ""]),
    `${fence}diff`,
    body,
    fence,
    "",
  ].join("\n")
  return todo.replace(/\n*$/, "\n\n") + section
}

/**
 * Returns true iff the diff contains at least one checkbox flip (`- [ ]` ↔
 * `- [x]`, case-insensitive) and every other changed line is pure
 * line-ending churn. Diff header lines (`---`, `+++`, `@@`, file metadata)
 * are ignored; only actual `+`/`-` content lines are evaluated. Trailing
 * `\r` is stripped from line content before comparison, and removed/added
 * pairs that become identical after the strip are treated as line-ending
 * conversion noise (a CRLF editor rewrites EVERY line while the user merely
 * ticks boxes) — approval must survive that churn.
 */
export const isCheckboxOnlyDiff = (diff: string): boolean => {
  if (diff.trim() === "") return false

  const checkboxRe = /^(\s*- \[)([xX ])\](.*)$/
  const removedLines: string[] = []
  const addedLines: string[] = []

  for (const raw of diff.split("\n")) {
    // Skip diff header lines
    if (
      raw.startsWith("---") ||
      raw.startsWith("+++") ||
      raw.startsWith("@@") ||
      raw.startsWith("diff ") ||
      raw.startsWith("index ") ||
      raw.startsWith("new file") ||
      raw.startsWith("deleted file") ||
      raw.startsWith("similarity") ||
      raw.startsWith("rename")
    )
      continue

    if (raw.startsWith("-")) {
      removedLines.push(raw.slice(1).replace(/\r$/, ""))
    } else if (raw.startsWith("+")) {
      addedLines.push(raw.slice(1).replace(/\r$/, ""))
    }
  }

  // Removed/added counts must match so lines pair up positionally.
  if (removedLines.length !== addedLines.length) return false

  let flips = 0
  for (let i = 0; i < removedLines.length; i++) {
    const rm = removedLines[i]!
    const add = addedLines[i]!
    // Identical after \r-stripping = pure line-ending churn — ignore.
    if (rm === add) continue
    // Anything else must be a checkbox flip and nothing more.
    if (!checkboxRe.test(rm) || !checkboxRe.test(add)) return false
    const rmNorm = rm.replace(/\[[ xX]\]/, "[ ]")
    const addNorm = add.replace(/\[[ xX]\]/, "[ ]")
    if (rmNorm !== addNorm) return false
    flips += 1
  }

  return flips > 0
}

/**
 * Gather ALL git/filesystem facts and produce the typed event stream the pure
 * machine folds: one `COMMIT` per first-parent commit (oldest→newest) followed
 * by a single `RESOLVE` carrying the working-tree snapshot.
 */
export const gatherEvents = (): Effect.Effect<
  ReadonlyArray<GtdEvent>,
  Error,
  GitService | FileSystem.FileSystem | ConfigService
> =>
  Effect.gen(function* () {
    const git = yield* GitService
    const fs = yield* FileSystem.FileSystem
    const config = yield* ConfigService

    // --- COMMIT events -------------------------------------------------------
    // Stream base = merge-base(defaultBranch, HEAD) when both resolve, else
    // undefined (whole-history fallback for no-default-branch / no-merge-base).
    const defaultBranch = yield* git.resolveDefaultBranch()
    const headHash = yield* git.resolveRef("HEAD").pipe(Effect.catchAll(() => Effect.succeed("")))
    const mergeBase = Option.isSome(defaultBranch)
      ? yield* git.mergeBase(defaultBranch.value, "HEAD")
      : Option.none<string>()
    // Discard the merge-base when it is HEAD itself (trunk-based workflow): the
    // range main..HEAD would be empty and disable the budgets. Whole-history
    // fallback is safe because foldCounters resets on every package boundary.
    const base =
      Option.isSome(mergeBase) && mergeBase.value !== headHash ? mergeBase : Option.none<string>()

    const history = yield* git.commitHistory(Option.getOrUndefined(base))
    const commitEvents: Array<CommitEvent> = history.map(
      ({ message, removedErrors }): CommitEvent => {
        const subject = (message.split("\n")[0] ?? "").trim()
        return {
          type: "COMMIT",
          isErrors: subject === ERRORS_SUBJECT,
          isFeedback: subject === FEEDBACK_SUBJECT,
          isPackageStart: subject === PLANNING_SUBJECT || subject === PACKAGE_DONE_SUBJECT,
          isWorkflowCommit: subject.startsWith("gtd: "),
          removedErrors,
        }
      },
    )

    // --- RESOLVE payload (working-tree snapshot) -----------------------------
    const hasCommits = yield* git.hasCommits()
    // Unconditional: `git status` works before the first commit, so a dirty
    // tree in a freshly initialized repository is visible and seeds New
    // Feature (it fails fast outside a repository, which is what we want).
    const porcelain = yield* git.statusPorcelain()
    const entries = parsePorcelainPaths(porcelain)
    const workingTreeClean = entries.length === 0
    const lastCommitSubject = hasCommits ? yield* git.lastCommitSubject() : ""

    // `.gtd/` package files added/edited vs the committed tree.
    const gtdModified = entries.some((e) => isGtdPath(e.path))
    // Pending changes outside the steering set (TODO/REVIEW/FEEDBACK/ERRORS/.gtd).
    const codeDirty = entries.some((e) => !isSteeringFile(e.path) && !isGtdPath(e.path))

    // Steering-file presence (committed and/or pending).
    const todoExists = yield* fs.exists(TODO_FILE)
    const gtdDirExists = yield* fs.exists(GTD_DIR)
    const reviewPresent = yield* fs.exists(REVIEW_FILE)
    const feedbackPresent = yield* fs.exists(FEEDBACK_FILE)
    const errorsPresent = yield* fs.exists(ERRORS_FILE)

    // The `<!-- user answers here -->` sentinel appears anywhere in TODO.md
    // (after stripping fenced/inline code).
    const todoContent = todoExists ? yield* fs.readFileString(TODO_FILE) : ""
    const todoMarkerPresent = todoExists && stripCode(todoContent).includes(UNANSWERED_MARKER)

    // A porcelain entry whose status flags it untracked (`?`) or freshly added
    // (`A`) is uncommitted; otherwise the file is tracked at HEAD.
    const isUncommitted = (path: string): boolean => {
      const entry = entries.find((e) => e.path === path)
      return entry !== undefined && (entry.status.includes("?") || entry.status.includes("A"))
    }

    // FEEDBACK.md: committed (Testing wrote it as `gtd: errors`) vs uncommitted
    // (Agentic Review wrote it), and whitespace-only = empty = approval.
    const feedbackCommitted = feedbackPresent && !isUncommitted(FEEDBACK_FILE)
    const feedbackContent = feedbackPresent ? yield* fs.readFileString(FEEDBACK_FILE) : ""
    const feedbackEmpty = feedbackPresent && !/\S/.test(feedbackContent)

    // REVIEW.md: committed + clean tree = approval (Done); committed + pending
    // edits (to REVIEW or any other file) = Accept Review.
    const reviewTrackedAtHead = reviewPresent && !isUncommitted(REVIEW_FILE)
    const reviewCommitted = reviewTrackedAtHead && workingTreeClean
    const reviewDirty = reviewTrackedAtHead && !workingTreeClean

    // TODO.md tracked at HEAD — distinguishes a committed plan being iterated
    // (later grilling rounds, which capture user code sketches) from a freshly
    // seeded, uncommitted one (the seed round, which commits the seed revert).
    const todoCommitted = todoExists && !isUncommitted(TODO_FILE)

    // The working tree deletes a committed ERRORS.md (human resume → fresh
    // budget). A status probe, distinct from the committed `removedErrors` flag.
    const pendingErrorsDeletion = entries.some(
      (e) => e.path === ERRORS_FILE && e.status.includes("D"),
    )

    const packages = yield* getPackages(fs)
    // `git diff HEAD` needs a HEAD; before the first commit the prompt-context
    // diff stays empty (the seed action captures the content itself).
    const diff = hasCommits && entries.length > 0 ? yield* git.diffHead() : ""

    // When REVIEW.md is committed and the tree is dirty, check whether the only
    // pending change is checkbox ticks/un-ticks in REVIEW.md (no new text lines).
    const onlyReviewDirty = entries.length > 0 && entries.every((e) => e.path === REVIEW_FILE)
    const reviewCheckboxOnly =
      onlyReviewDirty &&
      isCheckboxOnlyDiff(
        yield* git.diffPath(REVIEW_FILE).pipe(Effect.catchAll(() => Effect.succeed(""))),
      )

    // --- Review base + re-trigger gate (Clean review) -------------------------
    // Scope — what a review covers — is a four-rule logic:
    //
    // Rule 1: Within a process (has a `gtd: grilling` commit after last
    //         `gtd: done`), no `gtd: awaiting review` yet → cover the whole
    //         task: base = first `gtd: grilling` of the current task cycle.
    // Rule 2: Within a process, `gtd: awaiting review` present → cover only
    //         changes since the last review: base = last `gtd: awaiting review`
    //         of the current task cycle (takes precedence over rule 1).
    // Rule 3: Outside a process, on a feature branch (base is Some) → cover
    //         the whole branch: base = merge-base(defaultBranch, HEAD) —
    //         unconditionally, even when a prior process completed on the
    //         branch (already-approved work is re-covered by design).
    // Rule 4: Outside a process, on the default branch (base is None) → skip
    //         review: leave reviewBase/refDiff unset so the machine settles Idle.
    //
    // Trigger — whether a review fires — is the `hasCommitsAfterLastDone` gate:
    // commits exist after the last `gtd: done` (or no `gtd: done` exists).
    // Resolved here at the edge, consumed by the machine's Clean/Idle rule, so
    // an approved review settles Idle instead of immediately re-firing (the
    // review → approve → done → review loop). It gates *whether*, never *what*.
    //
    // The refDiff excludes workflow files (REVIEW_DIFF_EXCLUDES) so the
    // reviewer never sees plumbing churn. Only set reviewBase/refDiff when the
    // filtered diff is non-empty (non-empty distinguishes Clean from Idle).
    let reviewBase: string | undefined
    let refDiff: string | undefined
    let hasCommitsAfterLastDone = true
    if (hasCommits) {
      // Scan ALL commits (no base arg) to properly detect process boundaries
      // across `gtd: done` commits even on trunk.
      const allHistory = yield* git.commitHistory()

      // Find the current task cycle: commits after the last `gtd: done`.
      const lastDoneIdx = (() => {
        let idx = -1
        for (let i = 0; i < allHistory.length; i++) {
          const subject = (allHistory[i]!.message.split("\n")[0] ?? "").trim()
          if (subject === DONE_SUBJECT) idx = i
        }
        return idx
      })()
      const currentCycle = lastDoneIdx === -1 ? allHistory : allHistory.slice(lastDoneIdx + 1)
      hasCommitsAfterLastDone = lastDoneIdx === -1 || currentCycle.length > 0

      // Find first `gtd: grilling` in the current cycle (task start).
      const firstGrilling = currentCycle.find(
        (c) => (c.message.split("\n")[0] ?? "").trim() === GRILLING_SUBJECT,
      )
      // Find last `gtd: awaiting review` in the current cycle.
      const lastAwaitingReview = (() => {
        let found: (typeof currentCycle)[number] | undefined
        for (const c of currentCycle) {
          if ((c.message.split("\n")[0] ?? "").trim().startsWith(AWAITING_REVIEW_SUBJECT)) {
            found = c
          }
        }
        return found
      })()

      const withinProcess = firstGrilling !== undefined

      let candidate: string | undefined
      if (withinProcess) {
        // Rule 2 takes precedence over Rule 1 when awaiting review exists.
        if (lastAwaitingReview !== undefined) {
          // Rule 2: base = last `gtd: awaiting review` commit hash.
          candidate = lastAwaitingReview.hash ?? EMPTY_TREE
        } else {
          // Rule 1: base = first `gtd: grilling` commit hash.
          candidate = firstGrilling.hash ?? EMPTY_TREE
        }
      } else {
        // Outside a process.
        const mergeBaseCandidate =
          Option.isSome(base) && base.value !== headHash ? base.value : undefined
        if (mergeBaseCandidate !== undefined) {
          // Rule 3: feature branch → use merge-base.
          candidate = mergeBaseCandidate
        }
        // Rule 4: default branch → leave candidate undefined (Idle).
      }

      if (candidate !== undefined) {
        const candidateDiff = yield* git
          .diffRef(candidate, WORKFLOW_FILE_EXCLUDES)
          .pipe(Effect.catchAll(() => Effect.succeed("")))
        if (candidateDiff.trim().length > 0) {
          reviewBase = candidate
          refDiff = candidateDiff
        }
      }
    }

    const payload: ResolvePayload = {
      todoExists,
      todoCommitted,
      gtdDirExists,
      reviewPresent,
      feedbackPresent,
      errorsPresent,
      gtdModified,
      codeDirty,
      todoMarkerPresent,
      feedbackCommitted,
      feedbackEmpty,
      feedbackContent,
      reviewCommitted,
      reviewDirty,
      reviewCheckboxOnly,
      pendingErrorsDeletion,
      lastCommitSubject,
      workingTreeClean,
      packages,
      diff,
      ...(reviewBase !== undefined ? { reviewBase } : {}),
      ...(refDiff !== undefined ? { refDiff } : {}),
      hasCommitsAfterLastDone,
      agenticReviewEnabled: config.agenticReview,
      fixAttemptCap: config.fixAttemptCap,
      reviewThreshold: config.reviewThreshold,
    }

    const resolveEvent: GtdEvent = { type: "RESOLVE", payload }
    return [...commitEvents, resolveEvent]
  }).pipe(Effect.mapError((e) => (e instanceof Error ? e : new Error(String(e)))))

/**
 * Execute the side effect the machine's `resolve()` chose. The driver performs
 * this, then re-gathers + re-resolves. Each case maps to the primitives in
 * Git.ts / the FileSystem; the machine only decides *which* action.
 */
export const perform = (
  action: EdgeAction,
): Effect.Effect<void, Error, GitService | FileSystem.FileSystem | TestRunner> =>
  Effect.gen(function* () {
    const git = yield* GitService
    const fs = yield* FileSystem.FileSystem

    switch (action.kind) {
      // Transport: mixed-reset the hand-made `gtd: transport` HEAD, keeping the
      // work in the tree, then re-derive. (No producer command — consume only.)
      case "transportReset": {
        yield* git.mixedResetHead()
        return
      }

      // New Feature: capture the raw input as `gtd: new task` (unless HEAD is
      // already there — the lost-seed regenerate case), revert it back to a
      // clean baseline (inverse staged), and seed TODO.md from that diff.
      case "seedNewFeature": {
        const subject = yield* git
          .lastCommitSubject()
          .pipe(Effect.catchAll(() => Effect.succeed("")))
        if (subject !== NEW_TASK_SUBJECT) {
          yield* git.commitAllWithPrefix(NEW_TASK_SUBJECT)
        }
        const base = yield* git
          .resolveRef("HEAD~1")
          .pipe(Effect.catchAll(() => Effect.succeed(EMPTY_TREE)))
        const captured = yield* git.diffRef(base).pipe(Effect.catchAll(() => Effect.succeed("")))
        yield* git.revertNoCommit("HEAD")
        yield* fs.writeFileString(TODO_FILE, seedTodo(captured))
        return
      }

      // Accept Review: capture the human's pending changeset durably — commit it
      // verbatim as `gtd: review feedback` (annotations, code edits, and new
      // files alike), revert it back to the reviewed baseline, rm REVIEW.md
      // (which is what stops Accept Review re-firing), and seed TODO.md from the
      // captured diff. Commit-then-revert mirrors New Feature so untracked files
      // are dropped by construction (a plain checkout leaks them) and the
      // changeset survives checkout/pull. When HEAD already carries the capture
      // subject this is the regen case (the machine's rule-4 carve-out fired):
      // discard any partial revert/seed state and re-derive from the commit.
      case "seedAcceptReview": {
        const subject = yield* git
          .lastCommitSubject()
          .pipe(Effect.catchAll(() => Effect.succeed("")))
        if (subject !== REVIEW_FEEDBACK_SUBJECT) {
          yield* git.commitAllWithPrefix(REVIEW_FEEDBACK_SUBJECT)
        } else {
          yield* git.resetHard()
        }
        const base = yield* git
          .resolveRef("HEAD~1")
          .pipe(Effect.catchAll(() => Effect.succeed(EMPTY_TREE)))
        const captured = yield* git.diffRef(base).pipe(Effect.catchAll(() => Effect.succeed("")))
        yield* git.revertNoCommit("HEAD")
        yield* fs.remove(REVIEW_FILE).pipe(Effect.catchAll(() => Effect.void))
        yield* fs.writeFileString(TODO_FILE, seedTodo(captured))
        return
      }

      // Grilling capture: the plan is already committed and the user sketched
      // code during the round. Fold the code diff (untracked included, steering
      // files excluded) into TODO.md as a suggestion block, drop the code
      // changes — reset tracked, delete untracked/added — and commit the lot as
      // one `gtd: grilling`. TODO.md's own pending edits are preserved verbatim
      // (snapshotted before the reset). Binary edits survive only as the diff's
      // "Binary files differ" line — an accepted limitation.
      case "captureGrillingEdits": {
        const porcelain = yield* git.statusPorcelain()
        const entries = parsePorcelainPaths(porcelain)
        // Untracked (`??`) code files must be deleted explicitly; staged-new
        // (`A`) ones are included too in case the hard reset leaves them on
        // disk — fs.remove tolerates either outcome.
        const pendingCodeFiles = entries.filter(
          (e) =>
            (e.status.includes("?") || e.status.includes("A")) &&
            !isSteeringFile(e.path) &&
            !isGtdPath(e.path),
        )
        // Snapshot TODO.md (with the user's pending plan edits) and the code
        // diff BEFORE the reset discards them.
        const todoNow = yield* fs.readFileString(TODO_FILE)
        const captured = yield* git.diffHead(WORKFLOW_FILE_EXCLUDES)
        yield* git.resetHard()
        for (const entry of pendingCodeFiles) {
          yield* fs.remove(entry.path, { recursive: true }).pipe(Effect.catchAll(() => Effect.void))
        }
        yield* fs.writeFileString(TODO_FILE, appendCapturedInput(todoNow, captured))
        yield* git.commitAllWithPrefix(GRILLING_SUBJECT)
        return
      }

      // Testing: commit the pending tree `gtd: building` (nothing pending in the
      // no-op-fixer case), run tests; on red write FEEDBACK (below cap) or ERRORS
      // (at cap) and commit `gtd: errors`; on green proceed.
      case "runTest": {
        const runner = yield* TestRunner
        const status = yield* git.statusPorcelain()
        // A clean tree means nothing was committed as `gtd: building` below — the
        // only such entry into Testing is the no-op fixer (clean tree, HEAD
        // `gtd: fixing`).
        const committedBuilding = status.trim().length > 0
        if (committedBuilding) {
          yield* git.commitAllWithPrefix(BUILDING_SUBJECT)
        }
        const result = yield* runner.run()
        if (result.exitCode === 0) {
          // No-op-fixer green re-test: nothing was committed above, so HEAD is
          // still `gtd: fixing`; gather→resolve would re-detect Testing forever.
          // Commit an empty `gtd: building` to advance HEAD off `gtd: fixing` so
          // the next resolve reaches Agentic Review (STATES.md § Testing "green →
          // proceed"). The normal green path already committed `gtd: building`.
          if (!committedBuilding) {
            yield* git.commitAllWithPrefix(BUILDING_SUBJECT)
          }
          return
        }
        const target = action.capReached ? ERRORS_FILE : FEEDBACK_FILE
        const body = /\S/.test(result.output) ? result.output : EMPTY_FAILURE_SENTINEL
        yield* fs.writeFileString(target, body)
        yield* git.commitAllWithPrefix(ERRORS_SUBJECT)
        return
      }

      // Grilling / Grilled / Planning / Fixing: commit the pending tree under a
      // fixed phase prefix. Fixing sets `removeFeedback` so FEEDBACK.md's removal
      // lands in the `gtd: fixing` / `gtd: feedback` commit — otherwise the next
      // run re-detects FEEDBACK (precedence 2) and Fixing re-fires forever instead
      // of returning to Testing (STATES.md § Fixing).
      case "commitPending": {
        if (action.removeFeedback === true) {
          yield* fs.remove(FEEDBACK_FILE).pipe(Effect.catchAll(() => Effect.void))
        }
        if (action.removeTodo === true) {
          yield* fs.remove(TODO_FILE).pipe(Effect.catchAll(() => Effect.void))
        }
        yield* git.commitAllWithPrefix(action.prefix)
        return
      }

      // Close package: remove the (maybe-empty / maybe-absent) FEEDBACK.md, rm
      // the first (finished) package dir (+ the now-empty `.gtd/`), commit
      // `gtd: package done`. Tolerates an absent FEEDBACK.md (force-approve).
      case "closePackage": {
        yield* fs.remove(FEEDBACK_FILE).pipe(Effect.catchAll(() => Effect.void))
        const packages = yield* getPackages(fs)
        const first = packages[0]
        if (first !== undefined) {
          yield* git.removePackageDir(`${GTD_DIR}/${first.name}`)
        }
        yield* git.commitAllWithPrefix(PACKAGE_DONE_SUBJECT)
        return
      }

      // Await Review: commit REVIEW.md as `gtd: awaiting review`.
      case "commitReview": {
        yield* git.commitAllWithPrefix(AWAITING_REVIEW_SUBJECT)
        return
      }

      // Done: rm REVIEW.md, commit `gtd: done`.
      case "done": {
        yield* fs.remove(REVIEW_FILE).pipe(Effect.catchAll(() => Effect.void))
        yield* git.commitAllWithPrefix(DONE_SUBJECT)
        return
      }
    }
  }).pipe(Effect.mapError((e) => (e instanceof Error ? e : new Error(String(e)))))

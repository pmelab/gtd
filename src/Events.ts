import { FileSystem } from "@effect/platform"
import { Effect, Option } from "effect"
import { join } from "node:path"
import { GitService } from "./Git.js"
import { ConfigService } from "./Config.js"
import { Cwd } from "./Cwd.js"
import { formatFile } from "./Format.js"
import { TestRunner } from "./TestRunner.js"
import { parseSubject, turnSubject, type Actor } from "./Subjects.js"
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
 *     (capture a turn, commit routing bookkeeping, run tests, write steering
 *     files, squash, …) before the driver re-gathers and re-resolves.
 *
 * The machine (src/Machine.ts) stays free of IO; this module is the only place
 * that touches git/fs.
 */

// All steering files live INSIDE `.gtd/` — the directory is the single
// namespace for workflow plumbing, so "everything under `.gtd/` is
// machine-managed" is the one rule agents and diff filtering share. A
// root-level TODO.md (or REVIEW.md, …) is the project's own file: ordinary
// code, never steering.
const GTD_DIR = ".gtd"
const TODO_FILE = `${GTD_DIR}/TODO.md`
const REVIEW_FILE = `${GTD_DIR}/REVIEW.md`
const FEEDBACK_FILE = `${GTD_DIR}/FEEDBACK.md`
const ERRORS_FILE = `${GTD_DIR}/ERRORS.md`
const HEALTH_FILE = `${GTD_DIR}/HEALTH.md`
const SQUASH_MSG_FILE = `${GTD_DIR}/SQUASH_MSG.md`
const LEARNINGS_FILE = `${GTD_DIR}/LEARNINGS.md`
// Pre-namespace history wrote FEEDBACK.md at the repo root. Recognized for
// COMMIT-event classification only (isFeedback), never for diffs or
// working-tree probes — a root FEEDBACK.md in the tree today is project code.
const LEGACY_FEEDBACK_FILE = "FEEDBACK.md"
const emptyFailureSentinel = (command: string, exitCode: number): string =>
  `Test command \`${command}\` failed with exit code ${exitCode} and produced no output.`

const DONE_SUBJECT = "gtd: done"

// Workflow plumbing is excluded from every review diff (refDiff) and the
// headTurnDiff inlining — neither the reviewer nor a captured suggestion block
// should ever contain steering-file churn (TODO.md written/deleted, REVIEW.md
// committed/removed, packages created/closed). With every steering file under
// `.gtd/`, excluding the directory covers the whole set.
const WORKFLOW_FILE_EXCLUDES: ReadonlyArray<string> = [GTD_DIR]

// Each gate's own steering file IS its content — a human's grilling answer
// lives in `.gtd/TODO.md`, a review turn's feedback lives in `.gtd/REVIEW.md`
// — so it must stay in that gate's inlined turn diff even though the rest of
// `.gtd/` is excluded (the `!` entry re-includes it, see `applyExcludes` in
// Git.ts). Gates with no entry here (building, fixing, squashing, …) get the
// unmodified WORKFLOW_FILE_EXCLUDES: their content is ordinary code, not a
// steering file.
const GATE_OWN_STEERING_FILE: Partial<Record<string, string>> = {
  grilling: TODO_FILE,
  review: REVIEW_FILE,
}

// Routing phases and turn gates spanning the squash/learning chain
// (`gtd: done` → … → `gtd(agent): squashing`) — used to decide when
// `squashBase`/`squashDiff` must stay computed so the range is stable across
// the whole chain, including the learning phase now spliced in front of the
// squash template write.
const SQUASH_OR_LEARNING_ROUTING_PHASES: ReadonlySet<string> = new Set([
  "squash-template",
  "learning-template",
  "learning-drafted",
  "learning-approved",
  "learning-applied",
])
const SQUASH_OR_LEARNING_TURN_GATES: ReadonlySet<string> = new Set([
  "squashing",
  "learning",
  "learning-apply",
])

const turnDiffExcludes = (gate: string): ReadonlyArray<string> => {
  const ownFile = GATE_OWN_STEERING_FILE[gate]
  return ownFile ? [...WORKFLOW_FILE_EXCLUDES, `!${ownFile}`] : WORKFLOW_FILE_EXCLUDES
}

const isGtdPath = (path: string): boolean => path === GTD_DIR || path.startsWith(`${GTD_DIR}/`)
// A path inside a numbered work-package dir (`.gtd/NN-…/…`) — distinct from
// the steering files that sit directly in `.gtd/`.
const isPackagePath = (path: string): boolean =>
  path.startsWith(`${GTD_DIR}/`) && isNumberedDir(path.slice(GTD_DIR.length + 1))

// A porcelain status flagging the entry as untracked (`?`) or freshly added
// (`A`) — i.e. not tracked at HEAD.
const isUncommittedStatus = (status: string): boolean =>
  status.includes("?") || status.includes("A")

// git's empty-tree object. `git diff <empty-tree> HEAD` yields the entire tree
// as additions — the fallback base when there is no earlier commit to diff
// against.
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
// fallow-ignore-next-line complexity
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
 * Read the `.gtd/` work packages, lowest-numbered first. `packages[0]` is the
 * active one. Each numbered dir contributes its task `.md` files (sorted) and
 * their full contents.
 */
export const getPackages = (
  fs: FileSystem.FileSystem,
  root: string,
): Effect.Effect<ReadonlyArray<GtdPackageFact>, Error> =>
  Effect.gen(function* () {
    const resolve = (p: string) => join(root, p)
    const gtdExists = yield* fs.exists(resolve(GTD_DIR))
    if (!gtdExists) return []

    const entries = yield* fs.readDirectory(resolve(GTD_DIR))
    const packageDirs = entries.filter(isNumberedDir).sort()

    const packages: Array<GtdPackageFact> = []
    for (const dir of packageDirs) {
      const packagePath = `${GTD_DIR}/${dir}`
      const stat = yield* fs.stat(resolve(packagePath))
      if (stat.type !== "Directory") continue

      const files = yield* fs.readDirectory(resolve(packagePath))
      const tasks = files.filter(isTaskFile).sort()
      const taskContents: Array<{ name: string; content: string }> = []
      for (const taskFile of tasks) {
        const content = yield* fs.readFileString(resolve(`${packagePath}/${taskFile}`))
        taskContents.push({ name: taskFile, content })
      }
      packages.push({ name: dir, tasks, taskContents })
    }

    return packages
  }).pipe(Effect.mapError((e) => (e instanceof Error ? e : new Error(String(e)))))

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
// fallow-ignore-next-line complexity
export const isCheckboxOnlyDiff = (diff: string): boolean => {
  if (diff.trim() === "") return false

  const checkboxRe = /^(\s*- \[)([xX ])\](.*)$/
  const removedLines: string[] = []
  const addedLines: string[] = []

  for (const raw of diff.split("\n")) {
    // Normalize once before any classification so every use of line content
    // below is CRLF-agnostic.
    const line = raw.replace(/\r$/, "")
    // Skip diff header lines
    if (
      line.startsWith("---") ||
      line.startsWith("+++") ||
      line.startsWith("@@") ||
      line.startsWith("diff ") ||
      line.startsWith("index ") ||
      line.startsWith("new file") ||
      line.startsWith("deleted file") ||
      line.startsWith("similarity") ||
      line.startsWith("rename")
    )
      continue

    if (line.startsWith("-")) {
      removedLines.push(line.slice(1))
    } else if (line.startsWith("+")) {
      addedLines.push(line.slice(1))
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

/** Subject of a commit's first line, trimmed. */
const subjectOf = (message: string): string => (message.split("\n")[0] ?? "").trim()

/**
 * The commit's diff touched the feedback steering file. The legacy root path
 * keeps pre-namespaced history classifying identically.
 */
const touchedFeedback = (touched: ReadonlyArray<string>): boolean =>
  touched.includes(FEEDBACK_FILE) || touched.includes(LEGACY_FEEDBACK_FILE)

/**
 * Gather ALL git/filesystem facts and produce the typed event stream the pure
 * machine folds: one `COMMIT` per first-parent commit (oldest→newest) followed
 * by a single `RESOLVE` carrying the working-tree snapshot.
 */
export const gatherEvents = (
  invoker: Actor | "none",
): Effect.Effect<
  ReadonlyArray<GtdEvent>,
  Error,
  GitService | FileSystem.FileSystem | ConfigService | Cwd
> =>
  // fallow-ignore-next-line complexity
  Effect.gen(function* () {
    const git = yield* GitService
    const fs = yield* FileSystem.FileSystem
    const config = yield* ConfigService
    const { root } = yield* Cwd
    const resolve = (p: string) => join(root, p)

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
    const commitEvents: Array<CommitEvent> = history.map((commit): CommitEvent => {
      const subject = subjectOf(commit.message)
      const parsed = parseSubject(subject)
      const isTurn = parsed.kind === "turn"
      const isRouting = parsed.kind === "routing"
      return {
        type: "COMMIT",
        ...(isTurn ? { turnActor: parsed.actor, turnGate: parsed.gate } : {}),
        isErrors: isRouting && parsed.phase === "errors",
        // A `gtd(agent): agentic-review` turn whose diff touched
        // `.gtd/FEEDBACK.md` — a findings round. Over-counts the approval
        // round too (an empty FEEDBACK.md write still touches the path), but
        // `gtd: package done` resets the reviewFixCount fold immediately
        // after, so the extra count is harmless (documented in the task
        // contract).
        isFeedback: isTurn && parsed.gate === "agentic-review" && touchedFeedback(commit.touched),
        isPackageStart:
          isRouting && (parsed.phase === "planning" || parsed.phase === "package-done"),
        isWorkflowCommit: isTurn || isRouting,
        removedErrors: commit.removedErrors,
        isHealthCheck: isRouting && parsed.phase === "health-check",
      }
    })

    // --- RESOLVE payload (working-tree snapshot) -----------------------------
    const hasCommits = yield* git.hasCommits()
    // Unconditional: `git status` works before the first commit, so a dirty
    // tree in a freshly initialized repository is visible.
    const porcelain = yield* git.statusPorcelain()
    const entries = parsePorcelainPaths(porcelain)
    const workingTreeClean = entries.length === 0
    const lastCommitSubject = hasCommits ? yield* git.lastCommitSubject() : ""

    // --- headTurnDiff / headTurnIsEmpty --------------------------------------
    // Only computed when HEAD parses as a turn commit. One `commitDiff` call:
    // the raw diff decides emptiness, the workflow-excluded diff is what gets
    // inlined into prompts.
    const headParsed = hasCommits ? parseSubject(lastCommitSubject) : { kind: "boundary" as const }
    let headTurnDiff = ""
    let headTurnIsEmpty = false
    // Whether a `gtd(human): review` turn commit's OWN diff is substantive
    // (anything beyond a pure REVIEW.md checkbox flip). Computed from the turn
    // commit's diff rather than live working-tree dirtiness: by the time the
    // mid-chain classification for that turn runs, the turn commit has already
    // landed and the tree is clean again, so `reviewDirty`/`reviewCheckboxOnly`
    // (which read live dirtiness) no longer reflect what the turn captured.
    let headTurnReviewSubstantive: boolean | undefined
    if (hasCommits && headParsed.kind === "turn") {
      const rawDiff = yield* git
        .commitDiff(headHash)
        .pipe(Effect.catchAll(() => Effect.succeed("")))
      headTurnIsEmpty = rawDiff.trim().length === 0
      headTurnDiff = yield* git
        .commitDiff(headHash, turnDiffExcludes(headParsed.gate))
        .pipe(Effect.catchAll(() => Effect.succeed("")))

      if (headParsed.actor === "human" && headParsed.gate === "review") {
        // Split the unrestricted per-commit diff into its per-file sections
        // (each starts with `diff --git a/<path> b/<path>`) and ask: is there
        // any changed file OTHER than REVIEW.md, or is REVIEW.md's own hunk
        // more than a checkbox flip?
        const fileSections = rawDiff
          .split(/(?=^diff --git )/m)
          .filter((section) => section.trim().length > 0)
        const reviewSection = fileSections.find(
          (section) =>
            section.startsWith(`diff --git a/${REVIEW_FILE} b/${REVIEW_FILE}`) ||
            section.startsWith(`diff --git a/${REVIEW_FILE} `),
        )
        const nonReviewSections = fileSections.filter((section) => section !== reviewSection)
        // A REVIEW.md deletion is the approval path (the human deleted the
        // whole file to accept), never "feedback" — decisively non-substantive
        // regardless of its content, distinct from an edit to its content.
        const reviewDeleted = reviewSection?.includes("\ndeleted file mode") ?? false
        const reviewHunkSubstantive =
          reviewSection !== undefined && !reviewDeleted && !isCheckboxOnlyDiff(reviewSection)
        headTurnReviewSubstantive = nonReviewSections.length > 0 || reviewHunkSubstantive
      }
    }

    // `gtd: review-feedback` is the ROUTING commit the mid-chain `gtd(human):
    // review` turn lands as its very next hop — by the time `next`/`step`
    // resolves at that rest, HEAD is the routing commit, not the turn commit,
    // so the block above (which only fires when HEAD itself parses as a turn)
    // never runs. Re-grilling from review feedback needs the PARENT commit's
    // (the turn's) diff inlined as the finding, so fetch it from HEAD~1 here.
    // REVIEW.md itself is deliberately NOT excluded here (unlike
    // WORKFLOW_FILE_EXCLUDES elsewhere): a substantive review-feedback turn
    // may be pure prose edited into REVIEW.md, which IS the finding to inline.
    if (hasCommits && headParsed.kind === "routing" && headParsed.phase === "review-feedback") {
      const parentHash = yield* git
        .resolveRef(`${headHash}~1`)
        .pipe(Effect.catchAll(() => Effect.succeed("")))
      if (parentHash !== "") {
        headTurnDiff = yield* git
          .commitDiff(parentHash, turnDiffExcludes("review"))
          .pipe(Effect.catchAll(() => Effect.succeed("")))
      }
    }

    // `.gtd/` work-package files added/edited vs the committed tree — package
    // paths only, never the steering files that share the directory (a dirty
    // `.gtd/FEEDBACK.md` must not read as "the planner is writing packages").
    const gtdModified = entries.some((e) => isPackagePath(e.path))
    // Pending changes outside `.gtd/` — everything not workflow-managed is code.
    const codeDirty = entries.some((e) => !isGtdPath(e.path))

    // Steering-file presence (committed and/or pending).
    const todoExists = yield* fs.exists(resolve(TODO_FILE))
    const reviewPresent = yield* fs.exists(resolve(REVIEW_FILE))
    const feedbackPresent = yield* fs.exists(resolve(FEEDBACK_FILE))
    const errorsPresent = yield* fs.exists(resolve(ERRORS_FILE))

    // The file at `path` is uncommitted (untracked or freshly added); otherwise
    // it is tracked at HEAD.
    const isUncommitted = (path: string): boolean => {
      const entry = entries.find((e) => e.path === path)
      return entry !== undefined && isUncommittedStatus(entry.status)
    }

    // FEEDBACK.md: committed (Testing wrote it as `gtd: errors`) vs uncommitted
    // (Agentic Review wrote it), and whitespace-only = empty = approval.
    const feedbackCommitted = feedbackPresent && !isUncommitted(FEEDBACK_FILE)
    const feedbackContent = feedbackPresent ? yield* fs.readFileString(resolve(FEEDBACK_FILE)) : ""
    const feedbackEmpty = feedbackPresent && !/\S/.test(feedbackContent)

    // REVIEW.md: committed + clean tree = approval (Done); committed + pending
    // edits (to REVIEW or any other file) = the human review turn.
    const reviewTrackedAtHead = reviewPresent && !isUncommitted(REVIEW_FILE)
    const reviewCommitted = reviewTrackedAtHead && workingTreeClean
    const reviewDirty = reviewTrackedAtHead && !workingTreeClean

    // TODO.md tracked at HEAD.
    const todoCommitted = todoExists && !isUncommitted(TODO_FILE)

    // The working tree deletes a committed ERRORS.md (human resume → fresh
    // budget). A status probe, distinct from the committed `removedErrors` flag.
    const pendingErrorsDeletion = entries.some(
      (e) => e.path === ERRORS_FILE && e.status.includes("D"),
    )
    // A pending (uncommitted) deletion of FEEDBACK.md is the fixer disputing
    // by removing the file — semantically identical to emptying it. Surfaced
    // as its own flag (not folded into feedbackPresent, which reads fs) so
    // the resolver can treat delete-dispute and empty-dispute the same
    // WITHOUT confusing the illegal-combination guards.
    const pendingFeedbackDeletion = entries.some(
      (e) => e.path === FEEDBACK_FILE && e.status.includes("D"),
    )

    const packages = yield* getPackages(fs, root)
    // When REVIEW.md is committed and the tree is dirty, check whether the only
    // pending change is checkbox ticks/un-ticks in REVIEW.md (no new text lines).
    const onlyReviewDirty = entries.length > 0 && entries.every((e) => e.path === REVIEW_FILE)
    const reviewCheckboxOnly =
      onlyReviewDirty &&
      isCheckboxOnlyDiff(
        yield* git.diffPath(REVIEW_FILE).pipe(Effect.catchAll(() => Effect.succeed(""))),
      )

    // --- Review base + re-trigger gate ----------------------------------------
    // Scope — what a review covers — is a three-rule logic:
    //
    // Rule 1: Within a process (has a grilling TURN commit — `gtd(human):
    //         grilling` or `gtd(agent): grilling` — after last `gtd: done`), no
    //         `gtd: awaiting review` yet → cover the whole task: base = first
    //         grilling turn commit of the current cycle.
    // Rule 2: Within a process, `gtd: awaiting review` present → cover only
    //         changes since the last review: base = last `gtd: awaiting review`
    //         of the current task cycle (takes precedence over rule 1).
    // Rule 3: Outside a process (any branch) → skip review: leave
    //         reviewBase/refDiff unset so the machine settles Idle.
    //
    // When `reviewAnchor` (a `gtd: reviewing <hash>` commit newer than the last
    // `gtd: done`) is present, it supplies reviewBase directly and takes
    // precedence over rules 1/2 — the anchor was placed explicitly by
    // `gtd review <target>`.
    //
    // Trigger — whether a review fires — is the `hasCommitsAfterLastDone` gate:
    // commits exist after the last `gtd: done` (or no `gtd: done` exists).
    // Resolved here at the edge, consumed by the machine's review/Idle rule, so
    // an approved review settles Idle instead of immediately re-firing.
    //
    // The refDiff excludes workflow files (WORKFLOW_FILE_EXCLUDES) so the
    // reviewer never sees plumbing churn. Only set reviewBase/refDiff when the
    // filtered diff is non-empty (non-empty distinguishes review from Idle).
    let reviewBase: string | undefined
    let refDiff: string | undefined
    let reviewAnchor: string | undefined
    let hasCommitsAfterLastDone = true
    if (hasCommits) {
      // Scan ALL commits (no base arg) to properly detect process boundaries
      // across `gtd: done` commits even on trunk. When the COMMIT stream above
      // already scanned the whole history (no merge-base), reuse it rather
      // than spawning the identical `git log` again.
      const allHistory = Option.isNone(base) ? history : yield* git.commitHistory()

      // Find the current task cycle: commits after the last `gtd: done`.
      const lastDoneIdx = (() => {
        let idx = -1
        for (let i = 0; i < allHistory.length; i++) {
          if (subjectOf(allHistory[i]!.message) === DONE_SUBJECT) idx = i
        }
        return idx
      })()
      const currentCycle = lastDoneIdx === -1 ? allHistory : allHistory.slice(lastDoneIdx + 1)
      hasCommitsAfterLastDone = lastDoneIdx === -1 || currentCycle.length > 0

      // Find the newest `gtd: reviewing <hash>` anchor in the current cycle.
      for (const c of currentCycle) {
        const parsed = parseSubject(subjectOf(c.message))
        if (
          parsed.kind === "routing" &&
          parsed.phase === "reviewing" &&
          parsed.param !== undefined
        ) {
          reviewAnchor = parsed.param
        }
      }

      // Find first grilling turn commit in the current cycle (task start).
      const isGrillingTurn = (message: string): boolean => {
        const parsed = parseSubject(subjectOf(message))
        return parsed.kind === "turn" && parsed.gate === "grilling"
      }
      const firstGrilling = currentCycle.find((c) => isGrillingTurn(c.message))
      // Find last `gtd: awaiting review` in the current cycle.
      const lastAwaitingReview = (() => {
        let found: (typeof currentCycle)[number] | undefined
        for (const c of currentCycle) {
          const parsed = parseSubject(subjectOf(c.message))
          if (parsed.kind === "routing" && parsed.phase === "awaiting-review") found = c
        }
        return found
      })()

      const withinProcess = firstGrilling !== undefined

      let candidate: string | undefined
      if (reviewAnchor !== undefined) {
        candidate = reviewAnchor
      } else if (withinProcess) {
        // Rule 2 takes precedence over Rule 1 when awaiting review exists.
        if (lastAwaitingReview !== undefined) {
          candidate = lastAwaitingReview.hash ?? EMPTY_TREE
        } else {
          candidate = firstGrilling.hash ?? EMPTY_TREE
        }
      }

      if (candidate !== undefined && hasCommitsAfterLastDone) {
        const candidateDiff = yield* git
          .diffRef(candidate, WORKFLOW_FILE_EXCLUDES)
          .pipe(Effect.catchAll(() => Effect.succeed("")))
        if (candidateDiff.trim().length > 0) {
          reviewBase = candidate
          refDiff = candidateDiff
        }
      }
    }

    // --- Squash base + diff (squashing after gtd: done) ----------------------
    // Computed whenever HEAD is `gtd: done` or anywhere in the squash/learning
    // chain `gtd: done` → [learning phase] → `gtd: squash template` →
    // `gtd(agent): squashing` (squash and/or learning enabled): every
    // mid-chain hop across that whole range needs `squashBase` stable and
    // available — in particular the learning-draft agent turn (`gtd(agent):
    // learning`), which would otherwise never see `hasSquashBase` true and
    // livelock re-capturing an empty turn forever. The squash range is
    // the cycle ENDING at the last `gtd: done` found in history (not
    // necessarily HEAD), not `currentCycle` which is empty once HEAD is past it.
    let squashBase: string | undefined
    let squashDiff: string | undefined
    const headParsedForSquash = parseSubject(lastCommitSubject)
    const inSquashOrLearningChain =
      lastCommitSubject === DONE_SUBJECT ||
      (headParsedForSquash.kind === "routing" &&
        SQUASH_OR_LEARNING_ROUTING_PHASES.has(headParsedForSquash.phase)) ||
      (headParsedForSquash.kind === "turn" &&
        SQUASH_OR_LEARNING_TURN_GATES.has(headParsedForSquash.gate))
    if (hasCommits && inSquashOrLearningChain && (config.squash || config.learning)) {
      // Scan `history` (merge-base..HEAD on a feature branch), NOT the whole
      // history: commits below the merge-base exist on the default branch, and
      // a squash reset must never rewrite them. On trunk (no merge-base),
      // `history` is already the whole history.
      const squashHistory = history
      // Last `gtd: done` (= HEAD) and the previous one (cycle boundary), in one
      // oldest-first pass.
      let lastDoneIdxForSquash = -1
      let prevDoneIdx = -1
      for (let i = 0; i < squashHistory.length; i++) {
        if (subjectOf(squashHistory[i]!.message) === DONE_SUBJECT) {
          prevDoneIdx = lastDoneIdxForSquash
          lastDoneIdxForSquash = i
        }
      }

      if (lastDoneIdxForSquash !== -1) {
        const squashCycle = squashHistory.slice(prevDoneIdx + 1, lastDoneIdxForSquash + 1)
        // Cycle start = the LAST `gtd: reviewing <hash>` anchor when one
        // exists (an ad-hoc review cycle; anything before the anchor —
        // e.g. an abandoned grilling run — is not part of this cycle), else
        // the FIRST grilling turn commit since the previous `gtd: done`
        // boundary. First, not last: a review-feedback detour re-grills
        // mid-cycle, and picking that later run would strand the whole
        // pre-feedback half of the cycle (its grilling/building/review
        // commits) permanently in history — the squash must collapse the
        // entire cycle back to where it actually began.
        const isGrillingTurnSubject = (subject: string): boolean => {
          const parsed = parseSubject(subject)
          return parsed.kind === "turn" && parsed.gate === "grilling"
        }
        const isReviewingAnchor = (subject: string): boolean => {
          const parsed = parseSubject(subject)
          return parsed.kind === "routing" && parsed.phase === "reviewing"
        }
        let startIdx = -1
        for (let i = squashCycle.length - 1; i >= 0; i--) {
          if (isReviewingAnchor(subjectOf(squashCycle[i]!.message))) {
            startIdx = i
            break
          }
        }
        if (startIdx === -1) {
          for (let i = 0; i < squashCycle.length; i++) {
            if (isGrillingTurnSubject(subjectOf(squashCycle[i]!.message))) {
              startIdx = i
              break
            }
          }
        }
        const squashStart = startIdx === -1 ? undefined : squashCycle[startIdx]

        // Squash triggers on TURN POSITION (a valid cycle start was found),
        // never on diff content: unlike the review gate (where an empty diff
        // means "nothing to review"), a cycle that nets to an empty diff
        // (e.g. TODO.md/REVIEW.md added then removed, no code survives) still
        // squashes — the squash commit's message is what's durable, not the
        // tree delta.
        if (squashStart !== undefined) {
          const squashStartParent = yield* git
            .resolveRef(`${squashStart.hash}~1`)
            .pipe(Effect.catchAll(() => Effect.succeed(EMPTY_TREE)))
          const candidateDiff = yield* git
            .diffRef(squashStartParent)
            .pipe(Effect.catchAll(() => Effect.succeed("")))
          squashBase = squashStartParent
          squashDiff = candidateDiff
        }
      }
    }

    // --- SQUASH_MSG.md presence (squash template written+overwritten) --------
    const squashMsgPresent = yield* fs.exists(resolve(SQUASH_MSG_FILE))
    // Unmodified template → the machine must not squash yet (the file's
    // content becomes the squash commit message verbatim).
    const squashMsgIsTemplate =
      squashMsgPresent &&
      (yield* fs.readFileString(resolve(SQUASH_MSG_FILE))).trim() === SQUASH_TEMPLATE.trim()

    // --- LEARNINGS.md presence (learning template written+overwritten) -------
    const learningMsgPresent = yield* fs.exists(resolve(LEARNINGS_FILE))
    // Unmodified template → the machine must not mid-chain the agent's draft
    // turn yet (mirrors squashMsgIsTemplate).
    const learningMsgIsTemplate =
      learningMsgPresent &&
      (yield* fs.readFileString(resolve(LEARNINGS_FILE))).trim() === LEARNING_TEMPLATE.trim()

    // --- HEALTH.md presence (health-check output written by runHealthCheck) -----
    const healthPresent = yield* fs.exists(resolve(HEALTH_FILE))
    const healthContent = healthPresent ? yield* fs.readFileString(resolve(HEALTH_FILE)) : ""
    const healthCommitted = healthPresent && !isUncommitted(HEALTH_FILE)

    // --- Health squash base (squash/learning after green health-fix run) --------
    // Only computed when squash and/or learning is enabled. Mirrors
    // foldCounters: scans all of history forward, resetting on
    // isPackageStart/removedErrors events, tracking the FIRST
    // `gtd: health-check` of the current health run. healthFixBase is the
    // parent of that first health-check commit.
    let healthFixBase: string | undefined
    if (config.squash || config.learning) {
      let firstHealthCheckHash: string | undefined
      let healthCheckCount = 0
      for (const commit of commitEvents) {
        if (commit.isPackageStart || commit.removedErrors) {
          // Reset: new package or budget reset
          firstHealthCheckHash = undefined
          healthCheckCount = 0
        }
        if (commit.isHealthCheck) {
          healthCheckCount++
        }
      }
      // Re-derive the hash: commitEvents don't carry hashes, so re-scan
      // `history` in lockstep for the first health-check hash after the same
      // reset boundaries.
      if (healthCheckCount > 0) {
        let resetAt = -1
        for (let i = 0; i < history.length; i++) {
          const c = commitEvents[i]!
          if (c.isPackageStart || c.removedErrors) resetAt = i
        }
        for (let i = resetAt + 1; i < history.length; i++) {
          if (commitEvents[i]!.isHealthCheck) {
            firstHealthCheckHash = history[i]!.hash
            break
          }
        }
      }
      if (healthCheckCount > 0 && firstHealthCheckHash !== undefined) {
        const healthBase = yield* git
          .resolveRef(`${firstHealthCheckHash}~1`)
          .pipe(Effect.catchAll(() => Effect.succeed(EMPTY_TREE)))
        healthFixBase = healthBase
        // On the health path, squashBase/squashDiff carry the health-fix cycle
        // diff (not a feature-cycle diff). Computed here so the squashing prompt
        // renders the full diff block; forwarded unchanged by buildContext.
        const healthCandidateDiff = yield* git
          .diffRef(healthBase)
          .pipe(Effect.catchAll(() => Effect.succeed("")))
        if (healthCandidateDiff.trim().length > 0) {
          squashBase = healthBase
          squashDiff = healthCandidateDiff
        }
      }
    }

    const payload: ResolvePayload = {
      invoker,
      headTurnDiff,
      headTurnIsEmpty,
      ...(headTurnReviewSubstantive !== undefined ? { headTurnReviewSubstantive } : {}),
      todoExists,
      todoCommitted,
      packagesPresent: packages.length > 0,
      reviewPresent,
      feedbackPresent,
      errorsPresent,
      gtdModified,
      codeDirty,
      feedbackCommitted,
      feedbackEmpty,
      feedbackContent,
      reviewCommitted,
      reviewDirty,
      reviewCheckboxOnly,
      pendingErrorsDeletion,
      pendingFeedbackDeletion,
      lastCommitSubject,
      workingTreeClean,
      packages,
      ...(reviewBase !== undefined ? { reviewBase } : {}),
      ...(refDiff !== undefined ? { refDiff } : {}),
      ...(reviewAnchor !== undefined ? { reviewAnchor } : {}),
      hasCommitsAfterLastDone,
      agenticReviewEnabled: config.agenticReview,
      fixAttemptCap: config.fixAttemptCap,
      reviewThreshold: config.reviewThreshold,
      squashEnabled: config.squash,
      ...(squashBase !== undefined ? { squashBase } : {}),
      ...(squashDiff !== undefined ? { squashDiff } : {}),
      squashMsgPresent,
      squashMsgIsTemplate,
      healthPresent,
      healthContent,
      healthCommitted,
      ...(healthFixBase !== undefined ? { healthFixBase } : {}),
      learningEnabled: config.learning,
      learningMsgPresent,
      learningMsgIsTemplate,
    }

    const resolveEvent: GtdEvent = { type: "RESOLVE", payload }
    return [...commitEvents, resolveEvent]
  }).pipe(Effect.mapError((e) => (e instanceof Error ? e : new Error(String(e)))))

/**
 * Compute the review base and diff against an arbitrary git ref (branch, tag,
 * or commit). Used by `program.ts` for `gtd review <target>`.
 *
 * - Resolves `target` via `git rev-parse`; lets failure propagate so the caller
 *   can report an unresolvable ref.
 * - Picks `merge-base(target, HEAD)` as the diff base; falls back to the
 *   resolved target hash when there is no merge-base or when the merge-base
 *   equals the target (target is already an ancestor of HEAD).
 * - Applies `WORKFLOW_FILE_EXCLUDES` to the diff.
 * - Returns `undefined` when the filtered diff is empty; otherwise
 *   `{ reviewBase, refDiff }`.
 */
export const reviewAgainst = (
  target: string,
): Effect.Effect<
  { reviewBase: string; refDiff: string } | undefined,
  Error,
  GitService | FileSystem.FileSystem | Cwd
> =>
  Effect.gen(function* () {
    const git = yield* GitService
    const targetHash = yield* git.resolveRef(target)
    const mergeBase = yield* git.mergeBase(target, "HEAD")
    const mergeBaseHash =
      Option.isNone(mergeBase) || mergeBase.value === targetHash ? targetHash : mergeBase.value
    const refDiff = yield* git.diffRef(mergeBaseHash, WORKFLOW_FILE_EXCLUDES)
    if (refDiff.trim().length === 0) return undefined
    return { reviewBase: mergeBaseHash, refDiff }
  })

/**
 * A short conventional-commits skeleton written by `writeSquashTemplate`,
 * instructing the squashing agent to replace it with the real message.
 */
const SQUASH_TEMPLATE = [
  "<!-- gtd: replace this file's content with the real squash commit message. -->",
  "<!-- Use conventional-commits style, e.g. `feat: add thing` or `fix: correct thing`. -->",
  "",
  "type: short summary",
  "",
  "Longer description of the change, if needed.",
  "",
].join("\n")

/**
 * A short skeleton written by `writeLearningTemplate`, instructing the
 * learning agent to replace it with the real distilled learnings.
 */
const LEARNING_TEMPLATE = [
  "<!-- gtd: replace this file's content with the actual distilled learnings for this cycle. -->",
  "<!-- Keep only durable, generalizable lessons — delete anything that's a one-off detail. -->",
  "",
  "## Learnings",
  "",
  "- ...",
  "",
].join("\n")

/**
 * Execute the side effect the machine's `resolve()` chose. The driver performs
 * this, then re-gathers + re-resolves. Each case maps to the primitives in
 * Git.ts / the FileSystem; the machine only decides *which* action.
 *
 * Returns `{ stop: true }` when the driver should stop iterating (health-check
 * green-settle: tests passed, no further work needed, squash not queued). All
 * other cases return `{ stop: false }` so the driver re-gathers and re-resolves
 * as usual.
 */
// fallow-ignore-next-line complexity
export const perform = (
  action: EdgeAction,
): Effect.Effect<
  { stop: boolean },
  Error,
  GitService | FileSystem.FileSystem | TestRunner | ConfigService | Cwd
> =>
  // fallow-ignore-next-line complexity
  Effect.gen(function* () {
    const git = yield* GitService
    const fs = yield* FileSystem.FileSystem
    const { root } = yield* Cwd
    const resolve = (p: string) => join(root, p)
    // Steering files live under `.gtd/`; several writes happen when the
    // directory is absent (health-check on an idle tree, the squash template
    // after `gtd: done` removed the last package).
    const ensureGtdDir = fs
      .makeDirectory(resolve(GTD_DIR), { recursive: true })
      .pipe(Effect.catchAll(() => Effect.void))

    switch (action.kind) {
      // Capture a human/agent turn: format the pending TODO.md (best-effort),
      // then commit-all under `gtd(<actor>): <gate>` (--allow-empty).
      case "captureTurn": {
        const todoExists = yield* fs.exists(resolve(TODO_FILE))
        if (todoExists) {
          yield* formatFile(resolve(TODO_FILE)).pipe(Effect.catchAll(() => Effect.void))
        }
        yield* git.commitAllWithPrefix(turnSubject(action.actor, action.gate))
        return { stop: false }
      }

      // Routing bookkeeping: delete the flagged files FIRST so their removal
      // lands in this same commit, then commit-all under `subject`.
      case "commitRouting": {
        if (action.removeTodo === true) {
          yield* fs.remove(resolve(TODO_FILE)).pipe(Effect.catchAll(() => Effect.void))
        }
        if (action.removeReview === true) {
          yield* fs.remove(resolve(REVIEW_FILE)).pipe(Effect.catchAll(() => Effect.void))
        }
        if (action.removeFeedback === true) {
          yield* fs.remove(resolve(FEEDBACK_FILE)).pipe(Effect.catchAll(() => Effect.void))
        }
        if (action.removeHealth === true) {
          yield* fs.remove(resolve(HEALTH_FILE)).pipe(Effect.catchAll(() => Effect.void))
        }
        if (action.removeLearning === true) {
          yield* fs.remove(resolve(LEARNINGS_FILE)).pipe(Effect.catchAll(() => Effect.void))
        }
        yield* git.commitAllWithPrefix(action.subject)
        return { stop: false }
      }

      // Testing: run tests. FEEDBACK.md is removed unconditionally first — a
      // mid-chain `gtd(agent): fixing` HEAD consumes its own FEEDBACK.md this
      // way (whether the fixer left it, deleted it, or emptied it, the file
      // must be gone before re-testing). Green → commit routing
      // `gtd: tests green`. Red → write a fresh FEEDBACK.md (below cap) or
      // ERRORS.md (at cap) with the failure output, commit routing
      // `gtd: errors`.
      case "runTest": {
        yield* fs.remove(resolve(FEEDBACK_FILE)).pipe(Effect.catchAll(() => Effect.void))
        const runner = yield* TestRunner
        const result = yield* runner.run()
        if (result.exitCode === 0) {
          yield* git.commitAllWithPrefix("gtd: tests green")
          return { stop: false }
        }
        const target = action.capReached ? ERRORS_FILE : FEEDBACK_FILE
        const config = yield* ConfigService
        const body = /\S/.test(result.output)
          ? result.output
          : emptyFailureSentinel(config.testCommand, result.exitCode)
        yield* ensureGtdDir
        yield* fs.writeFileString(resolve(target), body)
        yield* git.commitAllWithPrefix("gtd: errors")
        return { stop: false }
      }

      // Close package: remove the (maybe-empty / maybe-absent) FEEDBACK.md, rm
      // the first (finished) package dir (+ the now-empty `.gtd/`), commit
      // `gtd: package done`. Tolerates an absent FEEDBACK.md (force-approve).
      case "closePackage": {
        yield* fs.remove(resolve(FEEDBACK_FILE)).pipe(Effect.catchAll(() => Effect.void))
        const packages = yield* getPackages(fs, root)
        const first = packages[0]
        if (first !== undefined) {
          yield* git.removePackageDir(`${GTD_DIR}/${first.name}`)
        }
        yield* git.commitAllWithPrefix("gtd: package done")
        return { stop: false }
      }

      // Write the SQUASH_MSG.md template (conventional-commits skeleton) and
      // commit routing `gtd: squash template`.
      case "writeSquashTemplate": {
        yield* ensureGtdDir
        yield* fs.writeFileString(resolve(SQUASH_MSG_FILE), SQUASH_TEMPLATE)
        yield* git.commitAllWithPrefix("gtd: squash template")
        return { stop: false }
      }

      // Write the LEARNINGS.md template (a durable-lessons skeleton) and
      // commit routing `gtd: learning template`.
      case "writeLearningTemplate": {
        yield* ensureGtdDir
        yield* fs.writeFileString(resolve(LEARNINGS_FILE), LEARNING_TEMPLATE)
        yield* git.commitAllWithPrefix("gtd: learning template")
        return { stop: false }
      }

      // Squash: read SQUASH_MSG.md content (the real message authored by the
      // squashing turn), rm it, soft-reset to squashBase, commit-all under the
      // file's content as the message.
      case "squashCommit": {
        const message = yield* fs
          .readFileString(resolve(SQUASH_MSG_FILE))
          .pipe(Effect.catchAll(() => Effect.succeed("")))
        yield* fs.remove(resolve(SQUASH_MSG_FILE)).pipe(Effect.catchAll(() => Effect.void))
        yield* git.softResetTo(action.squashBase)
        yield* git.commitAllWithPrefix(message)
        return { stop: false }
      }

      // Health check: run tests on an idle/clean tree.
      // Green, no learning/squash-after chain queued → stop immediately, no
      //   commit/write.
      // Green, `chainAfterGreen` → commit routing `gtd: tests green` (the
      //   observable green marker) and continue — the resolver chains
      //   `writeLearningTemplate` or `writeSquashTemplate` at that HEAD next.
      // Red below cap → write HEALTH.md, commit routing `gtd: health-check` (the
      //   always-clean invariant: write-and-commit in the same chain).
      // Red at cap → write ERRORS.md, commit routing `gtd: health-check`.
      case "runHealthCheck": {
        const runner = yield* TestRunner
        const result = yield* runner.run()
        if (result.exitCode === 0) {
          if (action.chainAfterGreen) {
            yield* git.commitAllWithPrefix("gtd: tests green")
            return { stop: false }
          }
          return { stop: true }
        }
        const config = yield* ConfigService
        const body = /\S/.test(result.output)
          ? result.output
          : emptyFailureSentinel(config.testCommand, result.exitCode)
        const target = action.capReached ? ERRORS_FILE : HEALTH_FILE
        yield* ensureGtdDir
        yield* fs.writeFileString(resolve(target), body)
        yield* git.commitAllWithPrefix("gtd: health-check")
        return { stop: false }
      }
    }
  }).pipe(Effect.mapError((e) => (e instanceof Error ? e : new Error(String(e)))))

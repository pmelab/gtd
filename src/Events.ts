import { FileSystem } from "@effect/platform"
import { Effect, Option } from "effect"
import { join } from "node:path"
import { GitService } from "./Git.js"
import { ConfigService } from "./Config.js"
import { Cwd } from "./Cwd.js"
import { formatFile } from "./Format.js"
import { TestRunner } from "./TestRunner.js"
import { parseSubject, turnSubject, type Actor } from "./Subjects.js"
import { isInteractiveActor } from "./Workflow.js"
import { parseOpenQuestions } from "./OpenQuestions.js"
import { parseReviewDoc } from "./ReviewDoc.js"
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
const ARCHITECTURE_FILE = `${GTD_DIR}/ARCHITECTURE.md`
const PLAN_FILE = `${GTD_DIR}/PLAN.md`
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

/** The `.gtd/` steering-file paths, grouped for external consumers (e.g. src/Lsp.ts) that need the whole set rather than one. */
export const STEERING_FILES = {
  todo: TODO_FILE,
  architecture: ARCHITECTURE_FILE,
  plan: PLAN_FILE,
  review: REVIEW_FILE,
  feedback: FEEDBACK_FILE,
  errors: ERRORS_FILE,
  health: HEALTH_FILE,
  squashMsg: SQUASH_MSG_FILE,
  learnings: LEARNINGS_FILE,
} as const
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
  "grilling-accepted": TODO_FILE,
  architecting: ARCHITECTURE_FILE,
  "architecting-accepted": ARCHITECTURE_FILE,
  review: REVIEW_FILE,
  "review-approved": REVIEW_FILE,
  "review-feedback": REVIEW_FILE,
}

// Routing phases and turn gates spanning the squash/learning chain
// (`gtd: done` → … → `gtd(agent): squashing`) — used to decide when
// `squashBase`/`squashDiff` must stay computed so the range is stable across
// the whole chain, including the learning phase now spliced in front of the
// squash template write.
const SQUASH_OR_LEARNING_ROUTING_PHASES: ReadonlySet<string> = new Set([
  "squashing",
  "learning",
  "await-learning-review",
  "learning-apply",
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

// A squash commit's marker for "this message carries a `## Decisions`
// section" — a body-only trailer, since squash commits take on arbitrary
// conventional-commit subjects (`feat:`, `fix:`, ...) and can't be identified
// by subject. Checked before any section parsing so a commit that merely
// mentions "## Decisions" in prose (without the trailer) is never touched.
const DECISIONS_TRAILER_RE = /^Gtd-Decisions:\s*true\s*$/m
const DECISIONS_HEADING = "## Decisions"

/**
 * Extracts one commit message's `## Decisions` section verbatim (heading
 * through the next `#`/`##` heading or end of message, trailer line
 * excluded), or `undefined` when the trailer is absent or the heading can't
 * be found despite it (a malformed historical commit — skipped, not an
 * error, since this reads commits the current turn doesn't own and can't be
 * asked to fix). Total, never throws.
 */
const extractDecisionsSection = (message: string): string | undefined => {
  if (!DECISIONS_TRAILER_RE.test(message)) return undefined
  const lines = message.split(/\r?\n/)
  const headingIdx = lines.findIndex((line) => line.trim() === DECISIONS_HEADING)
  if (headingIdx === -1) return undefined
  const endIdx = lines.findIndex((line, i) => i > headingIdx && /^#{1,2}\s+\S/.test(line.trim()))
  const section = lines
    .slice(headingIdx, endIdx === -1 ? lines.length : endIdx)
    .filter((line) => !DECISIONS_TRAILER_RE.test(line))
    .join("\n")
    .trim()
  return section.length > 0 ? section : undefined
}

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
      // One discriminant read each; "" never matches a real phase/gate, so
      // every flag below collapses to a single comparison instead of an
      // `isRouting && …` / `isTurn && …` conjunct.
      const routingPhase = parsed.kind === "routing" ? parsed.phase : ""
      const turnGate = parsed.kind === "turn" ? parsed.gate : ""
      return {
        type: "COMMIT",
        ...(parsed.kind === "turn" ? { turnActor: parsed.actor, turnGate: parsed.gate } : {}),
        isErrors: routingPhase === "test-failed",
        // A `gtd(agent): agentic-review` turn whose diff touched
        // `.gtd/FEEDBACK.md` — a findings round. Over-counts the approval
        // round too (an empty FEEDBACK.md write still touches the path), but
        // `gtd: close-package` resets the reviewFixCount fold immediately
        // after, so the extra count is harmless (documented in the task
        // contract).
        isFeedback:
          (turnGate === "agentic-review" ||
            turnGate === "agentic-approved" ||
            turnGate === "agentic-findings") &&
          touchedFeedback(commit.touched),
        isPackageStart: routingPhase === "building" || routingPhase === "close-package",
        isWorkflowCommit: isTurn || isRouting,
        removedErrors: commit.removedErrors,
        isHealthCheck: routingPhase === "health-check",
        isTestsGreen: routingPhase === "tests-green",
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

    // --- headTurnDiff ---------------------------------------------------------
    // Only computed when HEAD parses as a turn commit — pure PROMPT
    // passthrough (the re-grilling prompt inlines the answering turn's diff).
    // Never a steering input: branch decisions read the PENDING diff at
    // capture time and are encoded in the label (δ-discipline), so the
    // machine never re-inspects a landed turn's own diff.
    const headParsed = hasCommits ? parseSubject(lastCommitSubject) : { kind: "boundary" as const }
    let headTurnDiff = ""
    if (hasCommits && headParsed.kind === "turn") {
      headTurnDiff = yield* git
        .commitDiff(headHash, turnDiffExcludes(headParsed.gate))
        .pipe(Effect.catchAll(() => Effect.succeed("")))
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
    if (hasCommits && headParsed.kind === "routing" && headParsed.phase === "grilling") {
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
    const architectureExists = yield* fs.exists(resolve(ARCHITECTURE_FILE))
    const planExists = yield* fs.exists(resolve(PLAN_FILE))
    const reviewPresent = yield* fs.exists(resolve(REVIEW_FILE))
    const feedbackPresent = yield* fs.exists(resolve(FEEDBACK_FILE))
    const errorsPresent = yield* fs.exists(resolve(ERRORS_FILE))

    // The file at `path` is uncommitted (untracked or freshly added); otherwise
    // it is tracked at HEAD.
    const isUncommitted = (path: string): boolean => {
      const entry = entries.find((e) => e.path === path)
      return entry !== undefined && isUncommittedStatus(entry.status)
    }

    // FEEDBACK.md: committed (Testing wrote it as `gtd: test-failed`) vs uncommitted
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
    // ARCHITECTURE.md tracked at HEAD.
    const architectureCommitted = architectureExists && !isUncommitted(ARCHITECTURE_FILE)
    // PLAN.md tracked at HEAD.
    const planCommitted = planExists && !isUncommitted(PLAN_FILE)

    // Structural validation of whichever grilling-phase file is present (the
    // two never coexist) and of REVIEW.md, consulted ONLY by the machine when
    // the AGENT is about to capture a fresh turn at that gate (a human's own
    // turn is never blocked by this — see `applyTurnTaking`).
    const grillingDocPath = todoExists
      ? TODO_FILE
      : architectureExists
        ? ARCHITECTURE_FILE
        : undefined
    const grillingDocErrors = grillingDocPath
      ? parseOpenQuestions(yield* fs.readFileString(resolve(grillingDocPath))).errors
      : []
    const reviewDocErrors = reviewPresent
      ? parseReviewDoc(yield* fs.readFileString(resolve(REVIEW_FILE))).errors
      : []

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
    // The outright-deletion approval shape at the await-review gate: the tree
    // deletes the committed REVIEW.md and nothing else is dirty. (Deleting a
    // surfaced CODE file alongside it is feedback, not approval.)
    const reviewDeletedOnly =
      onlyReviewDirty && entries.some((e) => e.path === REVIEW_FILE && e.status.includes("D"))

    // --- Review base + re-trigger gate ----------------------------------------
    // Scope — what a review covers — is a three-rule logic:
    //
    // Rule 1: Within a process (has a grilling TURN commit — `gtd(human):
    //         grilling` or `gtd(agent): grilling` — after last `gtd: done`), no
    //         `gtd: await-review` yet → cover the whole task: base = first
    //         grilling turn commit of the current cycle.
    // Rule 2: Within a process, `gtd: await-review` present → cover only
    //         changes since the last review: base = last `gtd: await-review`
    //         of the current task cycle (takes precedence over rule 1).
    // Rule 3: Outside a process (any branch) → skip review: leave
    //         reviewBase/refDiff unset so the machine settles Idle.
    //
    // When `reviewAnchor` (a `gtd: review <hash>` commit newer than the last
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
    // Concatenation of every squash commit's `## Decisions` section
    // (marked by a trailing `Gtd-Decisions: true` line), oldest to newest, no
    // deduplication — a later entry doesn't erase an earlier one from this
    // string. Completed cycles' squash commits are immutable, so this text is
    // a stable, append-only prefix across invocations: conflicts are left for
    // the reading prompt to resolve by recency (newer wins) rather than
    // merged in code, and the resulting stable-prefix-plus-small-suffix shape
    // is exactly what LLM prompt caching wants — no local cache needed.
    let decisionLog = ""
    if (hasCommits) {
      // Scan ALL commits (no base arg) to properly detect process boundaries
      // across `gtd: done` commits even on trunk. When the COMMIT stream above
      // already scanned the whole history (no merge-base), reuse it rather
      // than spawning the identical `git log` again.
      const allHistory = Option.isNone(base) ? history : yield* git.commitHistory()

      if (config.decisionLog) {
        decisionLog = allHistory
          .map((c) => extractDecisionsSection(c.message))
          .filter((section): section is string => section !== undefined)
          .join("\n\n")
      }

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

      // Find the newest `gtd: review <hash>` anchor in the current cycle.
      for (const c of currentCycle) {
        const parsed = parseSubject(subjectOf(c.message))
        if (parsed.kind === "routing" && parsed.phase === "review" && parsed.param !== undefined) {
          reviewAnchor = parsed.param
        }
      }

      // Find the first entry-capable turn commit in the current cycle (task
      // start) — the entry points let a cycle start directly at
      // `architecting` (technical grilling, no grilling turn at all) or at
      // `grilled` (a final `.gtd/PLAN.md`, straight to decomposition), so all
      // three gates count. Safe for normal cycles: their `gtd(agent): grilled`
      // decompose turn is always preceded by a grilling/architecting turn in
      // the same cycle, and first-match wins.
      const isGrillingTurn = (message: string): boolean => {
        const parsed = parseSubject(subjectOf(message))
        return (
          parsed.kind === "turn" &&
          (parsed.gate === "grilling" ||
            parsed.gate === "architecting" ||
            parsed.gate === "grilled")
        )
      }
      const firstGrilling = currentCycle.find((c) => isGrillingTurn(c.message))
      // Find last `gtd: await-review` in the current cycle.
      const lastAwaitingReview = (() => {
        let found: (typeof currentCycle)[number] | undefined
        for (const c of currentCycle) {
          const parsed = parseSubject(subjectOf(c.message))
          if (parsed.kind === "routing" && parsed.phase === "await-review") found = c
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
    // chain `gtd: done` → [learning phase] → `gtd: squashing` →
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
        // Cycle start = the LAST `gtd: review <hash>` anchor when one
        // exists (an ad-hoc review cycle; anything before the anchor —
        // e.g. an abandoned grilling run — is not part of this cycle), else
        // the FIRST grilling turn commit since the previous `gtd: done`
        // boundary. First, not last: a review-feedback detour re-grills
        // mid-cycle, and picking that later run would strand the whole
        // pre-feedback half of the cycle (its grilling/building/review
        // commits) permanently in history — the squash must collapse the
        // entire cycle back to where it actually began.
        // All three entry-capable gates count as a cycle start (mirrors the
        // review-base `isGrillingTurn` above): `grilled` covers the PLAN.md
        // entry turn — harmless for normal cycles, whose decompose turn is
        // always preceded by a grilling/architecting turn (first match wins).
        const isGrillingTurnSubject = (subject: string): boolean => {
          const parsed = parseSubject(subject)
          return (
            parsed.kind === "turn" &&
            (parsed.gate === "grilling" ||
              parsed.gate === "architecting" ||
              parsed.gate === "grilled")
          )
        }
        const isReviewingAnchor = (subject: string): boolean => {
          const parsed = parseSubject(subject)
          return parsed.kind === "routing" && parsed.phase === "review"
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
    // isPackageStart/removedErrors/isTestsGreen events, and anchoring on the
    // EARLIEST of the current run's two possible start markers — the first
    // `gtd: health-check` routing commit (the idle-path detour) or the first
    // `gtd(human): health-fixing` turn commit (a hand-written HEALTH.md
    // entry, which may reach green with zero health-check commits ever
    // landing). healthFixBase is the parent of that anchor commit.
    //
    // `gtd: tests-green` ends a health run for anchoring purposes (without
    // this reset, a run whose green re-test chained into learning but never
    // squash-collapsed would leave its anchor in history forever, and every
    // later idle `gtd step` would re-trigger the learning/squash chain) —
    // EXCEPT the newest one while HEAD is still inside the post-green
    // learning/squash processing chain, which is that run's own green marker:
    // the chain's remaining hops (learning draft, squash) still need the
    // base. `learning-applied` counts as in-chain only while squash is
    // enabled — with squash off it is the chain's final rest, after which the
    // run is fully processed.
    let healthFixBase: string | undefined
    if (config.squash || config.learning) {
      const inHealthProcessingChain =
        (headParsedForSquash.kind === "routing" &&
          (headParsedForSquash.phase === "tests-green" ||
            headParsedForSquash.phase === "learning" ||
            headParsedForSquash.phase === "await-learning-review" ||
            headParsedForSquash.phase === "learning-apply" ||
            headParsedForSquash.phase === "squashing" ||
            (headParsedForSquash.phase === "learning-applied" && config.squash))) ||
        (headParsedForSquash.kind === "turn" &&
          SQUASH_OR_LEARNING_TURN_GATES.has(headParsedForSquash.gate))
      let lastTestsGreenIdx = -1
      for (let i = 0; i < commitEvents.length; i++) {
        if (commitEvents[i]!.isTestsGreen) lastTestsGreenIdx = i
      }
      const ignoredTestsGreenIdx = inHealthProcessingChain ? lastTestsGreenIdx : -1
      const isHealthEntryTurn = (c: CommitEvent): boolean =>
        isInteractiveActor(c.turnActor ?? "") && c.turnGate === "health-fixing"
      let anchorIdx = -1
      for (let i = 0; i < commitEvents.length; i++) {
        const c = commitEvents[i]!
        if (c.isPackageStart || c.removedErrors || (c.isTestsGreen && i !== ignoredTestsGreenIdx)) {
          anchorIdx = -1
          continue
        }
        if (anchorIdx === -1 && (c.isHealthCheck || isHealthEntryTurn(c))) anchorIdx = i
      }
      if (anchorIdx !== -1) {
        const anchorHash = history[anchorIdx]!.hash
        const healthBase = yield* git
          .resolveRef(`${anchorHash}~1`)
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
      todoExists,
      todoCommitted,
      architectureExists,
      architectureCommitted,
      planExists,
      planCommitted,
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
      reviewDeletedOnly,
      ...(grillingDocErrors.length > 0 ? { grillingDocErrors } : {}),
      ...(reviewDocErrors.length > 0 ? { reviewDocErrors } : {}),
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
      decisionLog,
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

/** The `gtd questions` CLI command's result shape — the file it read (if any) plus the parsed doc. */
export type OpenQuestionsResult = { file: string | null } & ReturnType<typeof parseOpenQuestions>

/**
 * Reads and parses whichever of `.gtd/TODO.md` / `.gtd/ARCHITECTURE.md` is
 * present (the two never coexist) for the `gtd questions` CLI command. Pure
 * read — no dirty-tree check, no mutation; reports whatever is on disk right
 * now, well-formed or not.
 */
export const readOpenQuestionsDoc = (): Effect.Effect<
  OpenQuestionsResult,
  Error,
  FileSystem.FileSystem | Cwd
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const { root } = yield* Cwd
    const resolve = (p: string) => join(root, p)

    const todoExists = yield* fs.exists(resolve(TODO_FILE))
    const architectureExists = yield* fs.exists(resolve(ARCHITECTURE_FILE))
    const file = todoExists ? TODO_FILE : architectureExists ? ARCHITECTURE_FILE : null
    if (file === null) return { file, questions: [], errors: [] }

    const content = yield* fs.readFileString(resolve(file))
    return { file, ...parseOpenQuestions(content) }
  })

/** The `gtd changesets` CLI command's result shape — the file it read (if any) plus the parsed doc. */
export type ReviewDocResult = { file: string | null } & ReturnType<typeof parseReviewDoc>

/**
 * Reads and parses `.gtd/REVIEW.md`, if present, for the `gtd changesets` CLI
 * command. Pure read — no dirty-tree check, no mutation; reports whatever is
 * on disk right now, well-formed or not.
 */
export const readReviewDoc = (): Effect.Effect<
  ReviewDocResult,
  Error,
  FileSystem.FileSystem | Cwd
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const { root } = yield* Cwd
    const resolve = (p: string) => join(root, p)

    const present = yield* fs.exists(resolve(REVIEW_FILE))
    if (!present) return { file: null, changesets: [], errors: [] }

    const content = yield* fs.readFileString(resolve(REVIEW_FILE))
    return { file: REVIEW_FILE, ...parseReviewDoc(content) }
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
 * A short scaffold banner prefixed to `.gtd/ARCHITECTURE.md` when it is
 * seeded from the converged `.gtd/TODO.md` (the grilling→architecting
 * hand-off) — mirrors `SQUASH_TEMPLATE`'s role of orienting the NEXT turn's
 * agent rather than steering the machine (file content never steers).
 */
const ARCHITECTURE_SEED_BANNER =
  "<!-- gtd: seeded from the converged product plan (.gtd/TODO.md); decide the technical/architectural questions below. -->\n\n"

/**
 * Banner prepended to `.gtd/ARCHITECTURE.md` when it is seeded from a
 * hand-written `.gtd/PLAN.md` (the direct-to-decompose entry) — same
 * orientation role as `ARCHITECTURE_SEED_BANNER`, one phase later: the plan
 * is final, the next turn decomposes it.
 */
const ARCHITECTURE_PLAN_SEED_BANNER =
  "<!-- gtd: seeded from the final plan (.gtd/PLAN.md); decompose into ordered work packages. -->\n\n"

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
      // Capture a human/agent turn: format the pending TODO.md/
      // ARCHITECTURE.md/PLAN.md (best-effort), then commit-all under
      // `gtd(<actor>): <gate>` (--allow-empty).
      case "captureTurn": {
        for (const file of [TODO_FILE, ARCHITECTURE_FILE, PLAN_FILE]) {
          const exists = yield* fs.exists(resolve(file))
          if (exists) {
            yield* formatFile(resolve(file)).pipe(Effect.catchAll(() => Effect.void))
          }
        }
        yield* git.commitAllWithPrefix(turnSubject(action.actor, action.gate))
        return { stop: false }
      }

      // Routing bookkeeping: delete the flagged files FIRST so their removal
      // lands in this same commit, then commit-all under `subject`.
      // `seedArchitectureFromTodo` instead reads TODO.md, writes it (with a
      // scaffold banner) as ARCHITECTURE.md, and deletes TODO.md — the
      // grilling→architecting hand-off, in this same commit.
      // `seedArchitectureFromPlan` mirrors it for the PLAN.md entry: the
      // final plan becomes ARCHITECTURE.md (the decompose prompt's input) in
      // the same commit that routes to the decompose rest.
      case "commitRouting": {
        if (action.seedArchitectureFromTodo === true) {
          const todoContent = yield* fs
            .readFileString(resolve(TODO_FILE))
            .pipe(Effect.catchAll(() => Effect.succeed("")))
          yield* ensureGtdDir
          yield* fs.writeFileString(
            resolve(ARCHITECTURE_FILE),
            ARCHITECTURE_SEED_BANNER + todoContent,
          )
          yield* fs.remove(resolve(TODO_FILE)).pipe(Effect.catchAll(() => Effect.void))
        }
        if (action.seedArchitectureFromPlan === true) {
          const planContent = yield* fs
            .readFileString(resolve(PLAN_FILE))
            .pipe(Effect.catchAll(() => Effect.succeed("")))
          yield* ensureGtdDir
          yield* fs.writeFileString(
            resolve(ARCHITECTURE_FILE),
            ARCHITECTURE_PLAN_SEED_BANNER + planContent,
          )
          yield* fs.remove(resolve(PLAN_FILE)).pipe(Effect.catchAll(() => Effect.void))
        }
        if (action.removeArchitecture === true) {
          yield* fs.remove(resolve(ARCHITECTURE_FILE)).pipe(Effect.catchAll(() => Effect.void))
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
      // `gtd: tests-green`. Red → write a fresh FEEDBACK.md (below cap) or
      // ERRORS.md (at cap) with the failure output, commit routing
      // `gtd: test-failed`.
      case "runTest": {
        yield* fs.remove(resolve(FEEDBACK_FILE)).pipe(Effect.catchAll(() => Effect.void))
        const runner = yield* TestRunner
        const result = yield* runner.run()
        if (result.exitCode === 0) {
          yield* git.commitAllWithPrefix("gtd: tests-green")
          return { stop: false }
        }
        const target = action.capReached ? ERRORS_FILE : FEEDBACK_FILE
        const config = yield* ConfigService
        const body = /\S/.test(result.output)
          ? result.output
          : emptyFailureSentinel(config.testCommand, result.exitCode)
        yield* ensureGtdDir
        yield* fs.writeFileString(resolve(target), body)
        yield* git.commitAllWithPrefix("gtd: test-failed")
        return { stop: false }
      }

      // Close package: remove the (maybe-empty / maybe-absent) FEEDBACK.md, rm
      // the first (finished) package dir (+ the now-empty `.gtd/`), commit
      // `gtd: close-package`. Tolerates an absent FEEDBACK.md (force-approve).
      case "closePackage": {
        yield* fs.remove(resolve(FEEDBACK_FILE)).pipe(Effect.catchAll(() => Effect.void))
        const packages = yield* getPackages(fs, root)
        const first = packages[0]
        if (first !== undefined) {
          yield* git.removePackageDir(`${GTD_DIR}/${first.name}`)
        }
        yield* git.commitAllWithPrefix("gtd: close-package")
        return { stop: false }
      }

      // Write the SQUASH_MSG.md template (conventional-commits skeleton) and
      // commit routing `gtd: squashing`.
      case "writeSquashTemplate": {
        yield* ensureGtdDir
        yield* fs.writeFileString(resolve(SQUASH_MSG_FILE), SQUASH_TEMPLATE)
        yield* git.commitAllWithPrefix("gtd: squashing")
        return { stop: false }
      }

      // Write the LEARNINGS.md template (a durable-lessons skeleton) and
      // commit routing `gtd: learning`.
      case "writeLearningTemplate": {
        yield* ensureGtdDir
        yield* fs.writeFileString(resolve(LEARNINGS_FILE), LEARNING_TEMPLATE)
        yield* git.commitAllWithPrefix("gtd: learning")
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
      // Green, `chainAfterGreen` → commit routing `gtd: tests-green` (the
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
            yield* git.commitAllWithPrefix("gtd: tests-green")
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

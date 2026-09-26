import { STATE_DIR, type Actor, type PendingChange, type StepDef } from "../Workflow.js"
import { steeringFormatFor, unansweredQuestions } from "../steering/index.js"
import type { RepoSnapshot } from "./RepoSnapshot.js"

/**
 * POSIX single-quote escaping for the residue paths named in a refusal
 * message — duplicated from (not imported from) `GitScript.ts`'s own
 * `shellQuote`/`pathspec`: `src/step/` importing anything from
 * `GitScript.ts` would mean the core still constructs git-facing text via
 * that module, exactly what Commit 3 exists to make impossible. This is a
 * message-formatting concern only — the refusal string is prose a human
 * reads, not a script `ScriptSurface` renders.
 */
const quotePath = (path: string): string => `'${path.replace(/'/g, "'\\''")}'`
const quotePaths = (paths: readonly string[]): string => paths.map(quotePath).join(" ")

/** A guard's verdict: `undefined` allows the step; a string is the refusal reason (the `gtd land: <guard-name>: ` prefix is added once, by `enforceStepGuards`). */
export type Refusal = string | undefined

interface StepGuard {
  readonly name: string
  /** Pure — decided from the snapshot's state alone, before anything else runs. */
  readonly appliesTo: (snapshot: RepoSnapshot) => boolean
  /** Pure — every fact a guard could need already sits on the frozen snapshot. */
  readonly check: (snapshot: RepoSnapshot) => Refusal
}

const deletesFile = (changes: readonly PendingChange[], file: string): boolean =>
  changes.some((c) => c.path === file && c.status === "D")

const isPlumbingPath = (path: string): boolean =>
  path === STATE_DIR || path.startsWith(`${STATE_DIR}/`)

const isCodePath = (path: string): boolean => !isPlumbingPath(path)

const REVIEW_MODE = "review"

/** Selects exactly the human review gate (`await-review` in the bundled template) — a human-actor state declaring `mode: review`. */
export const isHumanReviewGate = (stepDef: { actor?: Actor; mode?: string }): boolean =>
  stepDef.actor === "human" && stepDef.mode === REVIEW_MODE

const reviewDocGuard: StepGuard = {
  name: "review-doc",
  appliesTo: (s) => isHumanReviewGate(s.stepDef),
  check: (s) => {
    if (s.file === undefined) return undefined
    const fileDeleted = deletesFile(s.changes, s.file)
    return fileDeleted
      ? `${s.file} was deleted at "${s.state}" — restore it, or leave a note (or edit code) to request changes.`
      : undefined
  },
}

const NOTHING_ACTIONABLE_SENTINEL = "NOTHING ACTIONABLE"

const isRequireProgressState = (stepDef: StepDef): boolean => stepDef.requireProgress === true

const feedbackProgressGuard: StepGuard = {
  name: "feedback-progress",
  appliesTo: (s) => isRequireProgressState(s.stepDef),
  check: (s) => {
    if (s.file === undefined) return undefined
    const fileDeleted = deletesFile(s.changes, s.file)
    if (!fileDeleted) return undefined
    const hasCodeChange = s.changes.some((c) => isCodePath(c.path))
    if (hasCodeChange) return undefined
    const deletedContent = s.headFile ?? ""
    if (deletedContent.trim().startsWith(NOTHING_ACTIONABLE_SENTINEL)) return undefined
    return `${s.file} was deleted at "${s.state}" without addressing its instructions — implement the changes it lists (then delete it), don't just remove the file.`
  },
}

const QA_MODE = "qa"

const isAnswerGateState = (stepDef: StepDef): boolean => stepDef.answerGate === true

const answerCompletenessGuard: StepGuard = {
  name: "answer-completeness",
  appliesTo: (s) => isAnswerGateState(s.stepDef) && s.stepDef.mode === QA_MODE,
  check: (s) => {
    if (s.file === undefined) return undefined
    // A wholly untouched tree is the human's silence — the only stop the
    // return-lap loop can reach (package 01). Yields here, before reading
    // any question content, so a partial edit (code included) still falls
    // through to the ordinary unanswered-question refusal below.
    if (s.changes.length === 0) return undefined
    const format = steeringFormatFor(QA_MODE)
    if (format === undefined) return undefined
    const current = s.worktreeFile ?? ""
    const unanswered = unansweredQuestions(format, current)
    if (unanswered.length === 0) return undefined
    const list = unanswered
      .map((q) => `  - ${s.file}:${q.headingLine + 1}: ${q.question}`)
      .join("\n")
    return `${unanswered.length} open question(s) in ${s.file} not answered at "${s.state}" — tick exactly one option per question, or delete a question you don't want to answer. To accept the plan as-is instead, revert everything and re-run:\n${list}`
  },
}

const isRequireRevertState = (stepDef: StepDef): boolean => stepDef.requireRevert === true

const requireRevertGuard: StepGuard = {
  name: "require-revert",
  appliesTo: (s) => isRequireRevertState(s.stepDef),
  check: (s) => {
    if (s.reviewBase === "" || s.reviewBase === s.startCommit) {
      return `"${s.state}" has no identifiable review round to check (reviewBase is unset) — the revert cannot be established.`
    }
    const probe = s.revert
    if (!probe.checked) {
      return `"${s.state}" has no identifiable review round to check (reviewBase is unset) — the revert cannot be established.`
    }
    if (probe.residue.length === 0) return undefined
    const prose = probe.residue.join(", ")
    return `${prose} still differ from ${probe.base} at "${s.state}" — the revert did not take. Run \`git checkout ${probe.base} -- ${quotePaths(probe.residue)}\`, then \`gtd land\` again.`
  },
}

/** The four step-capture guards, in EVALUATION order — message precedence when two would fire is observable, so this order is the contract. */
const stepGuards: readonly StepGuard[] = [
  reviewDocGuard,
  feedbackProgressGuard,
  answerCompletenessGuard,
  requireRevertGuard,
]

/**
 * The `gtd land` capture gate, over a frozen `RepoSnapshot` — pure, no
 * Effect, no git read: every fact a guard could need already sits on
 * `snapshot`. Returns the first refusal's reason, prefixed `gtd land: ` and
 * that guard's own `name` — which guard fired is part of the returned value,
 * not only recoverable by matching prose — or `undefined` when every
 * applicable guard allows the step. A no-op for a snapshot whose resting
 * state has no `file:`, or one no guard applies to.
 */
export const enforceStepGuards = (snapshot: RepoSnapshot): Refusal => {
  const applicable = stepGuards.filter((g) => g.appliesTo(snapshot))
  if (applicable.length === 0) return undefined
  if (snapshot.file === undefined) return undefined
  for (const g of applicable) {
    const refusal = g.check(snapshot)
    if (refusal !== undefined) return `gtd land: ${g.name}: ${refusal}`
  }
  return undefined
}

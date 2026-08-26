import type { ProcessRun } from "./Edge.js"
import type { WorkflowDefinition } from "./PatternMachine.js"
import { renderStateTemplate, type TemplateContext } from "./PatternTemplates.js"

/** One human contribution the summary prompt names: the commit hash and the state it entered. */
interface HumanCommit {
  readonly hash: string
  readonly state: string
}

/**
 * `it.<name>` a `summary:` template may reference beyond the ordinary
 * `TemplateContext` set — none of the three means anything at an ordinary
 * state template, so they're additive here rather than fields on
 * `TemplateContext` itself (the same precedent `ModeCommandContext` sets with
 * `it.file`).
 */
interface SummaryContext extends TemplateContext {
  /** The process's own entry commit — its trace's first hash, deduped against `humanCommits` (never listed twice). */
  readonly entryCommit: string
  /** Every `human`-authored commit in the process's trace, oldest to newest, minus `entryCommit` if it coincides with one. */
  readonly humanCommits: readonly HumanCommit[]
  /** The process's closing/current tip — the trace's last commit. */
  readonly processTip: string
}

/**
 * Every `human`-authored commit in `run.trace`, oldest to newest, minus
 * `entryHash` — derived generically off the invoking actor `computeProcessRun`
 * already parsed onto each `TraceEntry`, never by naming a state.
 */
const humanCommitsOf = (run: ProcessRun, entryHash: string): readonly HumanCommit[] =>
  run.trace
    .filter((entry) => entry.actor === "human" && entry.hash !== entryHash)
    .map((entry) => ({ hash: entry.hash, state: entry.state }))

/**
 * Build `SummaryContext` for `run` and render `def.summary` against it — pure,
 * touching no git and no filesystem (`base` already carries a resolved
 * `read`/`vars`/`processCost`, built by the caller against real git). Returns
 * `undefined` when the workflow declares no `summary:` or `run.trace` is
 * empty — both refusal conditions belong to the caller (`program.ts`), not an
 * Effect failure here.
 */
export const buildSummary = (
  def: WorkflowDefinition,
  run: ProcessRun,
  base: TemplateContext,
): string | undefined => {
  if (def.summary === undefined || run.trace.length === 0) return undefined
  const entryCommit = run.trace[0]!.hash
  const processTip = run.trace[run.trace.length - 1]!.hash
  const context: SummaryContext = {
    ...base,
    entryCommit,
    humanCommits: humanCommitsOf(run, entryCommit),
    processTip,
  }
  return renderStateTemplate(def.summary, context)
}

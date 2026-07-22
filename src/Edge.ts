import { Effect } from "effect"
import { GitService, type GitOperations } from "./Git.js"
import { ConfigService } from "./Config.js"
import {
  contentKindOf,
  parseStateSubject,
  resolveState,
  type ChangeStatus,
  type ContentKind,
  type PendingChange,
  type StateDef,
  type StateName,
  type StepDecision,
  type WorkflowDefinition,
} from "./PatternMachine.js"
import { renderStateTemplate, type TemplateContext } from "./PatternTemplates.js"

/**
 * The v3 Effect edge (see `docs/design/pattern-machine-plan.md`, "Phase 3:
 * default workflow re-authoring + CLI"). Everything git/filesystem-shaped
 * lives here — `program.ts` calls this module and never touches `GitService`
 * or `PatternMachine`'s pure functions directly.
 *
 * Compared to v2's `Events.ts`/`Machine.ts` split, v3's edge is a single
 * gather → decide → perform hop with NO fixpoint loop: the pattern machine's
 * `on` edges are direct one-hop transitions (no routing/bookkeeping chain to
 * drive to a fixpoint), so one `gtd step <actor>` invocation performs AT MOST
 * one commit (or one squash). A caller that wants several transitions issues
 * several invocations.
 */

// git's empty-tree object — the diff/reset base when a process (or the whole
// repo) has no earlier commit to compare against.
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

const subjectOf = (message: string): string => (message.split("\n")[0] ?? "").trim()

/** Collapse an arbitrary git status letter to the pattern grammar's closed `A|M|D` set (mirrors the plan's decision 5 — only those three are meaningful statuses). */
const normalizeStatus = (raw: string): ChangeStatus => (raw === "A" ? "A" : raw === "D" ? "D" : "M")

// ── Resolving the current rest ──────────────────────────────────────────────

/** The currently-rested state, its definition, and its declared actor (never a commit state — see `resolveState`'s docs). */
export interface ResolvedRest {
  readonly def: WorkflowDefinition
  readonly state: StateName
  readonly stateDef: StateDef
  readonly actor: string
}

/** Resolve HEAD's subject against the active workflow definition (the bundled default, or a compiled `.gtdrc` `workflow:` key). */
export const resolveRest = (): Effect.Effect<ResolvedRest, Error, GitService | ConfigService> =>
  Effect.gen(function* () {
    const git = yield* GitService
    const config = yield* ConfigService
    const def = config.workflow
    const hasCommits = yield* git.hasCommits()
    const headSubject = hasCommits ? yield* git.lastCommitSubject() : ""
    const state = resolveState(def, headSubject)
    const stateDef = def.states[state]!
    // `resolveState` never rests at a commit state (it excludes them
    // explicitly) — this is a defensive check against a programmer error,
    // not a real runtime path.
    if (stateDef.actor === undefined) {
      return yield* Effect.fail(
        new Error(`gtd: resolved at commit state "${state}" — a process never rests there`),
      )
    }
    return { def, state, stateDef, actor: stateDef.actor }
  })

// ── Pending changes ──────────────────────────────────────────────────────────

/** The working tree's pending changes vs HEAD, as the pattern grammar's `{status, path}[]`. */
export const pendingChanges = (
  git: GitOperations,
): Effect.Effect<readonly PendingChange[], Error> =>
  git
    .changedPaths()
    .pipe(
      Effect.map((entries) =>
        entries.map((e) => ({ status: normalizeStatus(e.status), path: e.path })),
      ),
    )

// ── The current process run ──────────────────────────────────────────────────

/** The contiguous run of `gtd(actor): state` commits ending at HEAD. */
export interface ProcessRun {
  /** The run's first commit's hash, or HEAD's own hash when the run is empty (no turn has landed yet this process). */
  readonly startHash: string
  /** The parent of the run's first commit — `EMPTY_TREE` when the run covers the whole history. The squash reset target. */
  readonly startParentHash: string
  /** State names entered so far this process, oldest→newest (empty when no turn has landed yet). */
  readonly trace: readonly StateName[]
}

/**
 * Walk first-parent history backward from HEAD while each commit's subject
 * parses as `gtd(actor): state` (a v3 workflow commit); the first
 * non-matching commit (a boundary: an old squash result, legacy history, the
 * repo's own initial commit) is the run's start parent.
 */
export const computeProcessRun = (git: GitOperations): Effect.Effect<ProcessRun, Error> =>
  Effect.gen(function* () {
    const hasCommits = yield* git.hasCommits()
    if (!hasCommits) return { startHash: "", startParentHash: EMPTY_TREE, trace: [] }

    const history = yield* git.commitHistory() // oldest -> newest, full first-parent history
    let i = history.length - 1
    while (i >= 0 && parseStateSubject(subjectOf(history[i]!.message)) !== undefined) i--
    const startIdx = i + 1
    const trace = history.slice(startIdx).map((h) => parseStateSubject(subjectOf(h.message))!.state)
    const startParentHash = i >= 0 ? history[i]!.hash : EMPTY_TREE
    const startHash =
      startIdx < history.length ? history[startIdx]!.hash : history[history.length - 1]!.hash
    return { startHash, startParentHash, trace }
  })

// ── Template context ─────────────────────────────────────────────────────────

/** Build the `PatternTemplates.TemplateContext` for rendering `state`'s content at the resolved rest. */
export const buildTemplateContext = (
  git: GitOperations,
  read: (path: string) => string,
  state: StateName,
  actor: string,
  run: ProcessRun,
  vars: unknown,
): Effect.Effect<TemplateContext, Error> =>
  Effect.gen(function* () {
    const hasCommits = yield* git.hasCommits()
    const currentCommit = hasCommits ? yield* git.resolveRef("HEAD") : ""
    const previousCommit = hasCommits
      ? yield* git
          .resolveRef("HEAD~1")
          .pipe(Effect.catchAll(() => Effect.succeed(run.startParentHash)))
      : ""
    const committedDiff = yield* git
      .diffRef(run.startParentHash)
      .pipe(Effect.catchAll(() => Effect.succeed("")))
    const pendingDiff = yield* git.diffHead().pipe(Effect.catchAll(() => Effect.succeed("")))
    const processDiff = [committedDiff, pendingDiff].filter((d) => d.trim().length > 0).join("\n\n")
    const lastDiff =
      run.trace.length > 0
        ? yield* git.commitDiff(currentCommit).pipe(Effect.catchAll(() => Effect.succeed("")))
        : ""
    return {
      startCommit: run.startHash,
      currentCommit,
      previousCommit,
      state,
      actor,
      processDiff,
      lastDiff,
      read,
      config: vars,
    }
  })

// ── Rendering the resolved rest's content ────────────────────────────────────

export interface RenderedRest {
  readonly state: StateName
  readonly actor: string
  readonly kind: ContentKind
  readonly content: string
}

/** Render the resolved rest's declared content (script/prompt/message — never `commit`, since `resolveRest` never rests at a commit state). */
export const renderRest = (
  rest: ResolvedRest,
  context: TemplateContext,
): Effect.Effect<RenderedRest, Error> =>
  Effect.try({
    try: () => {
      const kind = contentKindOf(rest.stateDef)
      if (kind === undefined) {
        throw new Error(`state "${rest.state}" declares no content — invalid definition`)
      }
      const template =
        rest.stateDef.script ??
        rest.stateDef.prompt ??
        rest.stateDef.message ??
        rest.stateDef.commit!
      const content = renderStateTemplate(template, context)
      return { state: rest.state, actor: rest.actor, kind, content }
    },
    catch: (e) => (e instanceof Error ? e : new Error(String(e))),
  })

// ── Executing a step decision ────────────────────────────────────────────────

/** A step's outcome, for the CLI to report. */
export type StepOutcome =
  | { readonly kind: "commit"; readonly subject: string }
  | { readonly kind: "squash"; readonly subject: string }
  | { readonly kind: "noop"; readonly state: StateName }

/** The two `StepDecision` kinds that actually perform IO — the caller (program.ts) handles `"refusal"` itself (different exit codes/messages per reason) before ever reaching this function, and a `"noop"` short-circuits here with no IO. */
export type ExecutableDecision = Extract<StepDecision, { kind: "commit" | "squash" | "noop" }>

/**
 * Execute a `PatternMachine.step` decision: a `"commit"` decision stages and
 * commits everything pending under the decided subject; a `"squash"`
 * decision renders the commit-state template against the PENDING tree — a
 * render failure REFUSES the step, touching nothing — then soft-resets to
 * the process's start parent, writes ONE commit with the rendered message
 * (via `commitAsIs`, so the still-uncommitted template file is excluded), and
 * discards everything left pending (the template file included). A `"noop"`
 * performs no IO.
 */
export const executeDecision = (
  git: GitOperations,
  run: ProcessRun,
  decision: ExecutableDecision,
  context: TemplateContext,
): Effect.Effect<StepOutcome, Error> =>
  Effect.gen(function* () {
    switch (decision.kind) {
      case "commit": {
        yield* git.commitAllWithPrefix(decision.subject)
        return { kind: "commit", subject: decision.subject }
      }
      case "squash": {
        const message = yield* Effect.try({
          try: () => renderStateTemplate(decision.template, context),
          catch: (e) =>
            new Error(
              `gtd: rendering the "${decision.state}" commit template failed — nothing was committed: ${
                e instanceof Error ? e.message : String(e)
              }`,
            ),
        })
        yield* git.softResetTo(run.startParentHash)
        yield* git.commitAsIs(message)
        yield* git.discardPending()
        return { kind: "squash", subject: subjectOf(message) }
      }
      case "noop":
        return { kind: "noop", state: decision.state }
    }
  })

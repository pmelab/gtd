import { join } from "node:path"
import { FileSystem } from "@effect/platform"
import { Effect, Either, Option, Runtime } from "effect"
import type { ArtifactOut, Command, Needs } from "./Cli.js"
import { Narrator } from "./Commentary.js"
import { configPresentAt, ConfigService } from "./Config.js"
import { renderInitScaffold } from "./workflows/templates.js"
import { Cwd } from "./Cwd.js"
import { EnvVars } from "./EnvVars.js"
import { RepoFiles } from "./RepoFiles.js"
import { CommandRunner } from "./CommandRunner.js"
import { resolveSession } from "./Sessions.js"
import { GitService, type GitOperations } from "./Git.js"
import {
  collapsesToInitialState,
  contextAt,
  currentRest,
  currentRun,
  planEntry,
  planStep,
  renderDecision,
  renderRest,
  restAt,
  stalledAt,
  UNATTRIBUTED_MODEL,
  type ExecutableDecision,
  type ModelCost,
  type Rest,
  type RenderedRest,
  type RestRequirements,
} from "./Edge.js"
import {
  buildCloseWindowScript,
  buildOpenWindowScript,
  decideCloseWindow,
  decideOpenWindow,
  REVIEW_HEAD_REF,
  type OpenWindowDecision,
} from "./ReviewWindow.js"
import { HISTORY_REF, readRetainedHistory, restorability } from "./RetainedHistory.js"
import { startLspServer } from "./Lsp.js"
import {
  buildCurrentStateModel,
  buildVizModel,
  openInBrowser,
  startVizServer,
  type CurrentStateModel,
  type VizModel,
} from "./Visualize.js"
import { deletesFile, enforceStepGuards } from "./StepGuards.js"
import { unansweredQuestions } from "./OpenQuestions.js"
import { builtInModeNames, seededValidateCommand, steeringFormatFor } from "./SteeringFormats.js"
import type { SteeringFinding } from "./SteeringFormat.js"
import { resolveSteeringMode, renderSteeringCommands, unknownModeMessage } from "./SteeringMode.js"
import {
  contentKindOf,
  initialStateOf,
  matchesPattern,
  parsePattern,
  type ContentKind,
  type OnEdge,
  type PendingChange,
  type StateMode,
  type StateName,
  type WorkflowDefinition,
} from "./PatternMachine.js"
import {
  beatDocument,
  beatKindOf,
  stallDiagnosis,
  type BeatKind,
  type NextMatch,
  type StatusChange,
} from "./Beat.js"
import { EXIT_OK, ownerCodeOf, restExitCode } from "./ExitCodes.js"
import { renderModeCommand, renderStateTemplate, type TemplateContext } from "./PatternTemplates.js"
import { deleteRef, hardResetTo, mixedResetTo, updateRef } from "./GitScript.js"
import { combinedScript, emitScripts, type EmitPreconditions, type EmitStep } from "./Emit.js"
import {
  abandonedOutcome,
  abandonNoopOutcome,
  noopText,
  noteOutcome,
  restoredOutcome,
} from "./OutcomeScript.js"
import { loopLogPath } from "./WorktreeState.js"
import { renderBriefing } from "./Install.js"

export type CommandRequirements =
  | GitService
  | FileSystem.FileSystem
  | ConfigService
  | Cwd
  | RepoFiles
  | CommandRunner
  | EnvVars
  | Narrator

/**
 * `gtd lsp`: start the LSP server for `.gtd/` steering files over stdio. Its
 * `needs: "none"` (see `Cli.ts`'s `needsOf`) means it skips the repo-root
 * guard and the review-window bracket entirely — the server needs no git/
 * config/workflow dependency at all (it's keyed on file name, not workflow
 * state; see `src/Lsp.ts`'s module doc). `--json` and extra arguments are
 * already rejected by `Cli.ts` before a `Command` value ever reaches here.
 */
const runLspCommand = (): Effect.Effect<void, Error> => startLspServer()

/**
 * `gtd install`: print the driver-building briefing (`src/Install.ts`'s
 * `renderBriefing()`) — a complete, self-contained explanation of how to
 * build a gtd driver in any shell or runtime, emitted by the binary
 * itself so it is always exactly as current as the gtd that prints it.
 * Writes nothing: "install" means installing knowledge into the calling
 * agent's context. Its `needs: "none"` (see `Cli.ts`'s `needsOf`, same as
 * `gtd lsp`) means it skips the repo-root guard entirely — it resolves no
 * workflow state and reads no config, so it runs from any directory, in or
 * out of a repository. `--json` and extra arguments are already rejected by
 * `Cli.ts` before a `Command` value ever reaches here — `--json` is gtd
 * status's own surface alone now, so `install` prints plain text only.
 */
const runInstallCommand = (out: ArtifactOut): Effect.Effect<void> =>
  Effect.sync(() => {
    const briefing = renderBriefing()
    out.write(briefing.endsWith("\n") ? briefing : briefing + "\n")
  })

/**
 * `gtd init`: scaffold a MINIMAL `.gtdrc.json` seeding the default variables a
 * fresh project is most likely to change — the test command (`vars.testCommand`)
 * and a ready-to-edit Prettier formatting suggestion (`modes:`). It writes NO
 * `workflow:` key: gtd ships the unified workflow as its built-in default and
 * runs it whenever none is configured (see `src/Config.ts`), so there is
 * nothing to scaffold there — a project customizes the machine itself only by
 * adding a `workflow:` key. Its arity (none) is enforced by `Cli.ts` before a
 * `Command` value ever reaches here. Its standalone `needs: "fs"` (see
 * `Cli.ts`'s `needsOf`) means `runCommand` skips the shared repo-root guard/
 * review-window bracket — it runs its own, more permissive location check
 * instead (`assertInitLocation`, which also allows a directory outside any
 * repository) since it writes `.gtdrc.json` at the root and refuses to
 * clobber an existing config. The file is left UNCOMMITTED, so the message
 * warns to commit it before the first `gtd land` (an uncommitted config
 * counts as a pending change the initial state's `* **` edge would otherwise
 * capture).
 */
const runInitCommand = (
  out: ArtifactOut,
): Effect.Effect<void, Error, GitService | FileSystem.FileSystem | Cwd> =>
  Effect.gen(function* () {
    const git = yield* GitService
    const fs = yield* FileSystem.FileSystem
    const inRepo = yield* assertInitLocation(git, fs)
    const { root } = yield* Cwd
    if (yield* configPresentAt(root)) {
      return yield* Effect.fail(
        new Error("gtd init: a gtd config already exists — remove it before re-initializing"),
      )
    }
    const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)))
    const scaffold = renderInitScaffold()
    yield* fs
      .writeFileString(join(root, ".gtdrc.json"), scaffold.config)
      .pipe(Effect.mapError(toError))
    const wrote =
      `Wrote .gtdrc.json seeding the default variables (the test command) and a\n` +
      `Prettier formatting suggestion. gtd runs its built-in workflow by default — add\n` +
      `a workflow: key only if you want to customize the machine itself.\n\n`
    const nextSteps = inRepo
      ? `Review and commit it before starting: an uncommitted .gtdrc.json counts as a\n` +
        `pending change, so the initial state would capture it on the first landing. Once\n` +
        `committed, run \`gtd land\` to begin.\n`
      : `This directory is not a git repository, so there is nothing to commit here. The\n` +
        `config applies to any gtd repository nested below it — gtd discovers it by\n` +
        `walking up from the repository root. Run \`gtd land\` from such a repo to\n` +
        `begin.\n`
    out.write(wrote + nextSteps)
  })

/** `planLanding`'s result — a preview of what `gtd land` WOULD do, plus the `required`/`optional` bash the external driver runs to actually do it (see the module doc comment: `land` is a pure read/emitter, never a git write itself). */
interface LandResult {
  readonly state: string
  readonly subject: string | null
  readonly cost: number | null
  readonly model: string | null
  readonly required: string
  readonly optional: string
  /**
   * True for either of the two terminal shapes a landing can settle into: a
   * no-op at a `script` rest (`Edge.ts`'s `noOpSettles`), or a decision that
   * collapses back to the workflow's initial state retaining nothing
   * (`Edge.ts`'s `collapsesToInitialState` — a green re-entry rewound like
   * `gtd abandon` instead of committed). Nothing owed, but stdout still
   * carries a script a piping driver must run — see `exitCode`.
   */
  readonly settled: boolean
  /** `gtd land`'s own exit code — see `postLandExitCode`'s doc comment. */
  readonly exitCode: number
}

/**
 * `gtd land`'s exit code, computed from the POST-land rest — never the
 * resolved one `runLandCommand` started from — in precedence order:
 *
 * 1. `settled` (either terminal shape above) → `EXIT_OK`, replacing the old
 *    exit 3.
 * 2. Otherwise the state landing WILL rest at: a commit decision's own
 *    target (`decision.to`, never a commit state — entering one squashes
 *    instead), or the workflow's initial state for a squash decision (a
 *    squash's rendered subject doesn't parse back into any declared state,
 *    so `resolveState`'s unrecognized-subject rule resolves it there).
 * 3. That state being the initial state → `EXIT_OK`; the process completed.
 * 4. Otherwise `ownerCodeOf` of that state's content kind.
 *
 * The post-land tree is clean by construction (the required script commits
 * everything, and an optional review-window re-open leaves files untracked
 * but byte-identical), so this never computes a `dirty`/`stalled` beat kind
 * itself — see `restBeatKind` for the rest of the vocabulary this reuses.
 *
 * Known, bounded imprecision: a clean-tree land at a `prompt` rest writes an
 * empty attempt and reports `EXIT_AGENT_TURN`, while the FOLLOWING `gtd
 * status` reports `stalled` and `EXIT_HUMAN_TURN` — two different rests, not
 * a bug (see README).
 */
const postLandExitCode = (rest: Rest, targetState: StateName, settled: boolean): number => {
  if (settled) return EXIT_OK
  if (targetState === initialStateOf(rest.def)) return EXIT_OK
  const targetKind = contentKindOf(rest.def.states[targetState]!) as Exclude<ContentKind, "commit">
  return ownerCodeOf(targetKind)
}

// git's empty-tree object — the abandon command's first-commit guard uses
// this to recognize a process that starts at the repository's very first
// commit (no earlier commit to rewind to). Copied here (rather than imported)
// exactly like `Edge.ts`/`ReviewWindow.ts` each keep their own copy — see
// their doc comments on the same tradeoff.
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

/** The `EmitPreconditions` every script this file assembles asserts against: the resolved HEAD hash the snapshot driving it was taken at. */
const headPreconditions = (currentCommit: string): EmitPreconditions => ({
  expectedHead: currentCommit,
})

/**
 * The resting state's own steering-mode commands, embedded ahead of the
 * commit — the step script now carries its own format/validate pair instead
 * of gtd running it in process (see `src/StepGuards.ts`'s shrunk registry).
 * Empty for a state declaring no `file:`+`mode:` pair; an unknown mode name
 * is a refusal, exactly as it was when gtd ran the commands itself.
 *
 * Also empty when the step DELETES that file (`deletesFile`), or when the
 * file is simply ABSENT from the working tree (never written at all — the
 * step's diff touched something else entirely). A deletion is a legitimate
 * outcome at some states — `build.review.deciding`'s sign-off diff is a bare
 * REVIEW.md deletion — and either way (deleted or never created) there is
 * nothing left to format or validate. Emitting the mode's `format:` anyway
 * made the step UNLANDABLE for any formatter that treats a missing path as an
 * error (`prettier --write` exits non-zero with "No files matching the
 * pattern were found"): it is the first command in a `set -euo pipefail`
 * script, so it aborted the whole thing — window close, commit and all —
 * before anything could land, and a driver saw only a non-zero exit.
 */
const steeringModeSteps = (
  rest: Rest,
): Effect.Effect<readonly EmitStep[], Error, CommandRequirements> =>
  Effect.gen(function* () {
    const file = rest.hints.file
    const mode = rest.stateDef.mode
    if (file === undefined || mode === undefined) return []
    if (deletesFile(rest.changes, file)) return []
    const files = yield* RepoFiles
    if (files.working(file) === undefined) return []
    const resolved = resolveSteeringMode(rest.def, mode)
    if (resolved === undefined) {
      return yield* Effect.fail(new Error(unknownModeMessage(rest.def, rest.state, mode)))
    }
    const commands = yield* renderSteeringCommands(resolved, file, rest.context)
    return commands.map((command): EmitStep => ({ kind: "command", command }))
  })

/**
 * The `optional` half: re-open the review checkout window when the step lands
 * at a `reviewWindow: true` state, `""` otherwise. Takes the already-decided
 * `OpenWindowDecision` (`planLanding` computes it via `decideOpenWindow` and
 * narrates it before calling this) rather than deciding itself — narration
 * belongs at the caller who already has an `Effect`/`Narrator` in scope, not
 * inside `ReviewWindow.ts`'s pure decision function.
 *
 * `"HEAD"` is deliberately the literal string, not a resolved hash — git
 * resolves it at the moment this script runs, which is after the required
 * script has already landed the new commit (see `ReviewWindow.ts`'s
 * `decideOpenWindow` doc comment). For the same reason it carries no
 * `expectedHead` precondition: the HEAD it will see is a hash that does not
 * exist yet at decide time (see `EmitPreconditions`).
 */
const openWindowScript = (decision: OpenWindowDecision): string => {
  if (!decision.shouldOpen) return ""
  return emitScripts(
    {},
    [],
    [
      {
        kind: "gitWrite",
        command: buildOpenWindowScript({ base: decision.base, head: decision.head }),
      },
    ],
  ).optional
}

/**
 * `decideOpenWindow`'s result, narrated at the one caller with an `Effect`/
 * `Narrator` in scope — split out of `planLanding` so that function's own
 * complexity stays low; `decideOpenWindow` itself stays pure (see
 * `ReviewWindow.ts`'s own doc comment on the pure/edge split).
 */
const decideAndNarrateOpenWindow = (
  rest: Rest,
  targetState: string,
): Effect.Effect<OpenWindowDecision, never, Narrator> =>
  Effect.gen(function* () {
    const decision = decideOpenWindow(rest.def, targetState, rest.run, "HEAD")
    yield* (yield* Narrator).narrate(
      decision.shouldOpen
        ? `review-window: open (base ${decision.base.slice(0, 7)})`
        : "review-window: no-op",
    )
    return decision
  })

/** True for a `"commit"` decision that is an ATTEMPT (`PatternMachine.StepCommit.attempt`) — the one flag both `enforceStepGuards` and `buildRequiredScript` bypass their own steps for (see each call site). */
const isAttemptDecision = (decision: ExecutableDecision): boolean =>
  decision.kind === "commit" && decision.attempt === true

/**
 * The subject the required script WILL produce. A `"commit"` decision's is
 * fully deterministic already; a `"squash"` decision's is only known once its
 * template is rendered. Unreachable-on-failure: `renderDecision` already
 * rendered the same template and refused the command if it threw, so this
 * second render can never be the first to fail.
 */
const previewSubject = (
  decision: ExecutableDecision,
  rest: Rest,
): Effect.Effect<string | null, never> =>
  decision.kind === "commit"
    ? Effect.succeed(decision.subject)
    : Effect.try(() =>
        renderStateTemplate(decision.template, rest.context).split("\n")[0]!.trim(),
      ).pipe(Effect.catchAll(() => Effect.succeed(null)))

/**
 * The `required` half: everything that decides what lands in git, in order —
 * the review-window CLOSE (when one is open), the resting state's own
 * steering-mode format/validate commands, then the commit/squash steps
 * themselves. The steering-mode step is SKIPPED for an attempt commit
 * (decision 6): there is nothing to format/validate in an empty diff, and a
 * `format:` command running ahead of the commit could dirty the tree and
 * turn an "empty" attempt non-empty, breaking the derivation `stalledAt`
 * relies on (`Edge.ts`). It is skipped for a step that DELETES the state's
 * own `file:` too — see `steeringModeSteps`. The review-window close still
 * runs regardless — committing with a window open would land the attempt on
 * the review base.
 */
const buildRequiredScript = (
  rest: Rest,
  decision: ExecutableDecision,
  cost: number | undefined,
  model: string | undefined,
): Effect.Effect<string, Error, CommandRequirements> =>
  Effect.gen(function* () {
    const git = yield* GitService
    // Read-only: decides whether a review window is currently open and, when
    // so, that it's safe to close (the same guards `closeReviewWindow` used to
    // run) — a genuine refusal, exactly like the old `closeReviewWindow`
    // failing, propagates as-is.
    const closeDecision = yield* decideCloseWindow
    yield* (yield* Narrator).narrate(
      closeDecision.shouldClose ? "review-window: close" : "review-window: no-op",
    )
    // A squash renders its commit template at the TARGET commit state with
    // this step's own `--cost`/`--model` folded in (`contextAt`) — not against
    // `rest.context`, which is pinned to the resting state and carries
    // `cost: 0`, so `it.processCost` would omit the squashing turn itself.
    // `rest.actor` — the state's own declared actor — is who landing always
    // authenticates as (see `Edge.ts`'s `planStep`).
    const commitContext =
      decision.kind === "commit"
        ? rest.context
        : yield* contextAt(rest, decision.state, rest.actor, cost, model)
    const isAttempt = isAttemptDecision(decision)
    const steps: EmitStep[] = [
      ...(closeDecision.shouldClose
        ? [{ kind: "gitWrite" as const, command: buildCloseWindowScript(closeDecision.refs) }]
        : []),
      ...(isAttempt ? [] : yield* steeringModeSteps(rest)),
      // A render failure (a squash template that fails against the pending
      // tree) REFUSES the whole command — with the git write moved into the
      // emitted script, this emitting path is the only place that failure can
      // still be reported, and "nothing was committed" has to reach the caller
      // as a non-zero exit rather than as a silently empty script.
      ...(yield* renderDecision(git, rest, decision, commitContext, cost, model)),
    ]
    return emitScripts(headPreconditions(rest.context.currentCommit), steps).required
  })

/** `gtd land`'s own flags, threaded as one bag rather than growing `planLanding`/`runLandCommand`'s positional list. */
interface LandOptions {
  readonly cost?: number
  readonly model?: string
}

/**
 * Decide the one resulting transition (commit or squash) for `gtd land` —
 * WITHOUT performing it. `currentRest` → `planStep` decides, authenticating
 * as `rest.actor` (the resolved rest's own declared actor — landing derives
 * who acts, it never takes an actor argument); the step-capture guards
 * (`src/StepGuards.ts`) then refuse before anything is emitted. The decision
 * is assembled by hand into a
 * `required` script (the review-window CLOSE, when one is open; the resting
 * state's steering-mode format/validate commands, when it declares
 * `file:`+`mode:`; then the commit/squash steps themselves, via
 * `renderDecision`) and an `optional` one (the review-window OPEN, when the
 * target declares `reviewWindow: true`) — see the "Review-window management"
 * recipe this mirrors. Refusals fail the Effect with a formatted message; a
 * no-op returns `subject: null` and empty scripts (exit zero, nothing to
 * run).
 *
 * `plan.scripts` (built by `Edge.ts` itself) is NOT reused here: its baked-in
 * precondition uses `rest.context.currentCommit`, the LITERAL git HEAD at
 * decide time — which, while a review window is open, is the window's BASE,
 * not the real head — and it contains no window close/open steps at all. This
 * function builds its own required/optional pair to sidestep that trap.
 */
const planLanding = (
  opts: LandOptions = {},
): Effect.Effect<LandResult, Error, CommandRequirements> =>
  Effect.gen(function* () {
    const rest = yield* currentRest
    const plan = yield* planStep(rest, opts)

    if (plan.kind === "refusal") {
      return yield* Effect.fail(new Error(plan.message))
    }
    if (plan.kind === "noop") {
      // A no-op still prints its own outcome ("nothing to do at …") via the
      // emitted script. Nothing changed, so the post-land rest IS the
      // resolved one — `plan.state` (same as `rest.state`) feeds
      // `postLandExitCode` directly.
      return {
        state: plan.state,
        subject: null,
        cost: null,
        model: null,
        required: emitScripts({}, [{ kind: "outcome", command: noteOutcome(noopText(plan.state)) }])
          .required,
        optional: "",
        settled: plan.settled,
        exitCode: postLandExitCode(rest, plan.state, plan.settled),
      }
    }

    // `StepPlan.decision`'s declared type is the full `StepDecision` union
    // (Edge.ts never narrows it to match its own sibling `kind` field) — this
    // re-narrows it to `ExecutableDecision`, which is always true in practice
    // since `plan.kind` is already known to be `"commit" | "squash"` here.
    const decision = plan.decision
    if (decision.kind !== "commit" && decision.kind !== "squash") {
      return yield* Effect.fail(
        new Error(
          `gtd: internal error — plan kind "${plan.kind}" but decision kind "${decision.kind}"`,
        ),
      )
    }

    // Step-capture guards (edge, not engine — see src/StepGuards.ts): the
    // review-doc, feedback-progress, answer-completeness and require-revert
    // guards, in registry order, each able to refuse before anything is
    // emitted. `file` is the rest's already-rendered `file:` hint — rendered
    // once when the snapshot was built, not re-rendered per guard.
    yield* enforceStepGuards({
      rest,
      context: rest.context,
      file: rest.hints.file,
      changes: rest.changes,
      windowHead: rest.windowHead,
      kind: decision.kind,
      attempt: isAttemptDecision(decision),
    })

    const targetState = decision.kind === "commit" ? decision.to : decision.state
    // The state landing will actually REST at, for the exit code alone
    // (`postLandExitCode`) — distinct from `targetState` above, which names
    // the squash's own commit-state key (what `reviewWindow:` is declared
    // on), not where the process resumes: a squash's rendered subject never
    // parses back into a declared state, so it always resolves to the
    // workflow's initial state (see `postLandExitCode`'s doc comment).
    const restingState = decision.kind === "commit" ? decision.to : initialStateOf(rest.def)
    const settled = yield* collapsesToInitialState(rest, decision)
    const openDecision = yield* decideAndNarrateOpenWindow(rest, targetState)
    return {
      state: rest.state,
      subject: yield* previewSubject(decision, rest),
      cost: opts.cost ?? null,
      model: opts.model ?? null,
      required: yield* buildRequiredScript(rest, decision, opts.cost, opts.model),
      optional: openWindowScript(openDecision),
      settled,
      exitCode: postLandExitCode(rest, restingState, settled),
    }
  })

/**
 * `gtd land [--cost=<n>] [--model=<name>]`: land whatever the tree now shows
 * at the currently resolved rest — authenticated as the rest's own actor,
 * never a caller-supplied one — recording `--cost`/`--model` as a `Gtd-Cost:`
 * trailer. `--entry <state>` no longer nests inside this handler — `Cli.ts`'s
 * `--entry` selector resolves that combination to its own `"entry"` command
 * kind (see `runEntryCommand`) before `runCommand` ever dispatches here, so a
 * `land` `Command` is always the ordinary pattern-matched landing.
 *
 * Prints ONLY the combined script (`Emit.ts`'s `combinedScript`) — its own
 * outcome rendering, including a genuine no-op's "nothing to do at …" note and
 * the initial-state collapse's `COLLAPSED_TEXT` note, is already baked in (see
 * `renderDecision`'s collapse branch). `required`/`optional` never reach the
 * caller separately any more — `--json` was land's only other consumer of
 * them, and it no longer exists (see AGENTS.md's "one structured surface"
 * decision).
 *
 * Returns `result.exitCode` — see `postLandExitCode`'s doc comment for the
 * whole precedence order, including the settled shapes that now report
 * `EXIT_OK` where they used to report the old exit 3.
 */
const runLandCommand = (
  opts: LandOptions,
  out: ArtifactOut,
): Effect.Effect<number, Error, CommandRequirements> =>
  Effect.gen(function* () {
    const result = yield* planLanding(opts)
    out.write(combinedScript(result.required, result.optional))
    return result.exitCode
  })

/**
 * `gtd --entry <state> [--var <name>=<value> ...]` (`actor` always `"human"`
 * — see `Cli.ts`'s `--entry` selector): start a brand NEW process at `<state>`
 * — any declared, non-commit state (see `PatternMachine.enterableStates`) —
 * replacing the two former named commands `gtd review <commitish>`/`gtd fix`
 * with one generic mechanism. Writes an ordinary turn commit
 * (`gtd(<actor>): <state>`) carrying zero or more `Gtd-Var: <name>=<value>`
 * trailers (`withEntryTrailers`) for each `--var` override, plus — when
 * `<state>` declares a string `reviewBase:` — a `Gtd-Review-Base:` trailer
 * pinning the new process's diff base (rendered from that template against
 * the merged `it.vars`, resolved to a commit, and checked sane). Unlike the
 * old commands (which required a clean tree and used `commitAsIs`), this
 * commits via `commitAllWithPrefix` — capturing whatever the working tree
 * carries at the moment of entry, exactly like an ordinary `gtd land`
 * capture, rather than demanding a clean tree first.
 *
 * Any failure below is a plain refusal: nothing is written. Checked in order:
 *
 * 1. The machine must currently rest at the workflow's INITIAL state — a
 *    plain non-gtd branch (the normal case) resolves there via the
 *    inert-subject rule (see `resolveState`); a process already underway
 *    refuses.
 * 2. `<state>` must be one of `enterableStates(rest.def)` — every declared,
 *    non-commit state, NOT narrowed to whatever declared `entry: true` (that
 *    narrower set only seeds the workflow's own `entries.manual` reachability
 *    roots — this command lets an operator enter any of them).
 * 3. Every `--var` name must already be declared by the workflow's own
 *    `vars:` or the top-level `.gtdrc` `vars:` — an undeclared name is a
 *    usage error, not a silently-ignored override.
 * 4. When `<state>` declares a string `reviewBase:`, that template must
 *    render to a NON-BLANK commitish that resolves to a commit, is an
 *    ancestor of HEAD, and differs from HEAD.
 */
const runEntryCommand = (
  actor: string,
  entryState: string,
  varOverrides: Record<string, string>,
  out: ArtifactOut,
  commandLabel: string,
): Effect.Effect<void, Error, CommandRequirements> =>
  Effect.gen(function* () {
    const rest = yield* currentRest
    const plan = yield* planEntry(rest, actor, {
      state: entryState,
      commandLabel,
      vars: varOverrides,
    })
    if (plan.kind === "refusal") {
      return yield* Effect.fail(new Error(plan.message))
    }
    // `plan.scripts` is safe to reuse verbatim here (unlike `planLanding`'s own
    // build): an entry always lands fresh at a brand-new process's first
    // state, which can never have an open review window and — per
    // `enterableStates`/the bundled template — declares no `file:`/`mode:` of
    // its own to validate ahead of the commit (that gate applies to the NEXT
    // step away from the entered state, once its actor has produced
    // something, not to entering it).
    out.write(combinedScript(plan.scripts.required, plan.scripts.optional))
  })

/**
 * `gtd abandon`: end the process currently underway WITHOUT completing it,
 * returning the machine to the workflow's initial state — the recovery path out
 * of a process nobody is going to finish (`runEntryCommand`'s "already
 * underway" refusal names it: "finish it, or run `gtd abandon`, before entering"
 * — and so does `resolveRest`'s refusal when HEAD names a state a workflow
 * change has since removed).
 *
 * NOTHING is discarded. The shared bracket in `runCommand` has already closed
 * any open review checkout window (so HEAD is the real head), and abandon then
 * `git reset --mixed`es HEAD to the commit the process started from
 * (`computeProcessRun`'s `startParentHash` — the same boundary a squash resets
 * to). Every turn commit the process wrote is dropped, and everything they
 * carried — the code, the `.gtd/` steering files — stays in the working tree as
 * uncommitted changes for the human to keep, re-commit, or discard with
 * ordinary git.
 *
 * Deliberately reads the current state off `computeProcessRun`'s OWN trace
 * (its last entry, oldest→newest) rather than `resolveRest` — `resolveRest`
 * refuses when HEAD names a state the CURRENT workflow no longer declares
 * (the escape hatch THIS command is), so routing through it here would make
 * the one command that must still work in that exact situation refuse right
 * alongside everything else. `computeProcessRun`'s boundary walk only ever
 * compares state NAMES (never a declaration lookup), so it resolves a
 * renamed-away trace exactly as well as an ordinary one.
 *
 * Idempotent: resting at the initial state (a plain non-gtd branch, or a
 * just-squashed process) is a no-op SUCCESS, not a refusal — a recovery command
 * that fails when there is nothing to recover is a worse tool. The one refusal
 * is a process whose first commit is the repository's own root commit: there is
 * no earlier commit to rewind to.
 *
 * The read-side refusal/no-op checks above stay direct `GitService` reads (the
 * documented exception, `AGENTS.md`) — abandon must still work when a `Rest`
 * would refuse. The actual mutation (retaining history, then the mixed reset)
 * is no longer PERFORMED here: it's emitted as a `required` bash script for
 * the external driver to run, built from `src/GitScript.ts`'s pure
 * `updateRef`/`mixedResetTo` — narrowing the exception further still.
 */
const runAbandonCommand = (out: ArtifactOut): Effect.Effect<void, Error, CommandRequirements> =>
  Effect.gen(function* () {
    const git = yield* GitService
    const config = yield* (yield* ConfigService).load
    const def = config.workflow
    const initial = initialStateOf(def)
    const run = yield* currentRun
    if (run.trace.length === 0) {
      const required = emitScripts({}, [
        { kind: "outcome", command: abandonNoopOutcome(initial) },
      ]).required
      out.write(combinedScript(required, ""))
      return
    }
    const restState = run.trace[run.trace.length - 1]!.state

    if (run.startParentHash === EMPTY_TREE) {
      return yield* Effect.fail(
        new Error(
          `gtd abandon: the process underway (resting at "${restState}") starts at the ` +
            "repository's first commit — there is no earlier commit to rewind to",
        ),
      )
    }

    // An open review checkout window has rewound real HEAD to the review
    // base, so the reviewed branch tip — the thing abandon must retain and
    // rewind FROM — is the window's saved head, not `HEAD`. Closing it is the
    // required script's first step, exactly as the deleted review-window
    // bracket used to do before the command ran.
    const closeDecision = yield* decideCloseWindow
    const tip = closeDecision.shouldClose
      ? closeDecision.refs.headHash
      : yield* git.resolveRef("HEAD")

    const steps: EmitStep[] = [
      ...(closeDecision.shouldClose
        ? [
            {
              kind: "gitWrite" as const,
              command: buildCloseWindowScript(closeDecision.refs),
            },
          ]
        : []),
      { kind: "gitWrite", command: updateRef(HISTORY_REF, tip) },
      { kind: "gitWrite", command: mixedResetTo(run.startParentHash) },
      { kind: "outcome", command: abandonedOutcome(restState, run.startParentHash, initial) },
    ]
    // The precondition is real HEAD (the rewound one, while a window is open)
    // — that is what `git rev-parse HEAD` will actually report when the
    // script runs, before its own close step moves it.
    const required = emitScripts(headPreconditions(yield* git.resolveRef("HEAD")), steps).required
    out.write(combinedScript(required, ""))
  })

/**
 * `gtd restore`: hard-reset HEAD back to the pre-squash tip a squash or
 * `gtd abandon` retained (`RetainedHistory.ts`'s `HISTORY_REF`), undoing
 * either. Unlike `gtd abandon` (which rewinds a process still underway),
 * restore reaches BACK past a completed squash — or re-applies an abandon's
 * own retained tip — to bring the turn-by-turn history back.
 *
 * Guarded by `restorability` so it never discards work it didn't create:
 * refuses on a dirty working tree, when there is no retained history, and
 * when HEAD has advanced past the retained tip with commits that would be
 * lost by resetting. Those checks stay direct `GitService` reads (same
 * documented exception as `gtd abandon`); the mutation itself (the hard
 * reset, then clearing the retained-history ref) is emitted as a `required`
 * script instead of performed here.
 */
const runRestoreCommand = (out: ArtifactOut): Effect.Effect<void, Error, CommandRequirements> =>
  Effect.gen(function* () {
    const git = yield* GitService

    // Reading `rest.changes` off `currentRest` (rather than `pendingChanges`
    // directly) means the renamed-state refusal now wins over the dirty-tree
    // message when both apply — restore already refused on a renamed state
    // before this change (it resolved a rest too), so only which of the two
    // refusals surfaces changes.
    const before = yield* currentRest
    if (before.changes.length > 0) {
      return yield* Effect.fail(
        new Error(
          "gtd restore: refuses on a dirty working tree — commit, stash, or discard your changes first.",
        ),
      )
    }

    const retained = yield* readRetainedHistory(git)
    if (Option.isNone(retained)) {
      return yield* Effect.fail(new Error("gtd restore: no retained history to restore."))
    }
    const tip = retained.value

    const headHash = yield* git.resolveRef("HEAD")
    const headMessage = yield* git.lastCommitMessage()
    const check = yield* restorability(git, headHash, headMessage, tip)
    if (!check.ok) {
      return yield* Effect.fail(
        new Error(
          `gtd restore: ${check.reason} — HEAD ${headHash.slice(0, 7)} is ahead of the ` +
            `retained tip ${tip.slice(0, 7)}.`,
        ),
      )
    }

    // A preview of the resulting state — resolved at `tip` directly rather
    // than after an actual reset, since none has happened yet.
    const after = yield* restAt(tip)

    const steps: EmitStep[] = [
      { kind: "gitWrite", command: hardResetTo(tip) },
      { kind: "gitWrite", command: deleteRef(HISTORY_REF) },
      { kind: "outcome", command: restoredOutcome(tip, after.state) },
    ]
    const required = emitScripts(headPreconditions(headHash), steps).required
    out.write(combinedScript(required, ""))
  })

/**
 * The mode's own resolved VALIDATE command, rendered against `file` — the
 * command `selfValidateInstruction` names. Resolution mirrors
 * `renderSteeringCommands`'s own layering (`src/SteeringMode.ts`) but picks
 * out the validate half alone: a declared `validate:` command (or, for
 * `qa`/`review`, `PatternConfig.ts`'s own seeded `gtd check <mode> '<file>'`
 * default — every compiled definition carries ONE of the two) renders as the
 * LAST command `renderSteeringCommands` would emit (format, if any, always
 * comes first); a mode resolving to a `"builtin"` validator (no shell command
 * at all — only reachable when `resolveSteeringMode` is asked about a mode
 * outside the active definition's own compiled `modes:`, since a real
 * definition always seeds one) or to no mode at all names the leaf
 * `gtd check <mode> '<file>'` invocation directly instead
 * (`seededValidateCommand`), so there is always something concrete to name.
 */
const resolveSelfValidateCommand = (
  def: WorkflowDefinition,
  mode: StateMode,
  file: string,
  context: TemplateContext,
): Effect.Effect<string, Error> =>
  Effect.gen(function* () {
    const resolved = resolveSteeringMode(def, mode)
    if (resolved?.validate?.kind === "command") {
      const rendered = yield* renderSteeringCommands(resolved, file, context)
      const validateCommand = rendered[rendered.length - 1]
      if (validateCommand !== undefined) return validateCommand
    }
    return yield* Effect.try({
      try: () => renderModeCommand(seededValidateCommand(mode), { ...context, file }),
      catch: (e) => (e instanceof Error ? e : new Error(String(e))),
    })
  })

/**
 * The self-validation instruction gtd APPENDS to a `prompt` rest that declares
 * both `file:` and `mode:` — i.e. a state whose actor hands over a steering
 * file some command validates. Appended ONLY to plain `gtd next` output (for a
 * human or a simple driver who reads the prompt and hands it to an agent, so
 * the agent self-validates); withheld from `gtd next --json`, where the
 * driving loop instead runs `gtd validate` after the turn and re-prompts on
 * findings (see the README's minimal driver, and `fixPromptInstruction` below
 * — its driver-side counterpart). This is advisory: `gtd land` embeds that same
 * command ahead of its own commit and REFUSES a turn whose steering file is
 * invalid (see `planLanding`), so a malformed file is never captured whether
 * or not this instruction was followed.
 */
const selfValidateInstruction = (command: string, file: string): string =>
  `\nBefore finishing your turn, run \`${command}\` — it checks ${file} — and fix ` +
  `every violation it reports until it exits cleanly. Do not finish while it ` +
  `still reports violations.\n`

/**
 * The driver-side counterpart of `selfValidateInstruction` above — the same
 * gate, expressed for a loop that RUNS the validate script itself and
 * re-prompts the same agent session on a non-zero exit, rather than for an
 * agent that self-validates before finishing. Wrapped onto the emitted
 * validate script's last command via `Emit.ts`'s `onFailure` (see
 * `runValidateCommand`), so a driver's fix re-prompt is exactly this text
 * plus the script's own captured findings — never hand-composed in bash.
 */
const fixPromptInstruction = (file: string): string =>
  `Your last turn does not pass its own validation script. Fix these format violations in ${file}, then finish:`

/** True when a rendered rest is a `prompt` turn that hands over a validatable steering file (`file:`+`mode:` both declared). */
const emitsValidatablePrompt = (rendered: RenderedRest): boolean =>
  rendered.kind === "prompt" && rendered.file !== undefined && rendered.mode !== undefined

/**
 * Resolve the resting state's own steering-file validate script — the SAME
 * script both `gtd validate --json` (`runValidateCommand`, its thin caller
 * now) and `gtd next --json`'s embedded `validate` field emit, from one
 * shared resolver so the two surfaces can't drift. `undefined` = nothing to
 * validate: no `file:`+`mode:` declared, or the declared file is absent from
 * the working tree. An unknown `mode:` FAILS this Effect (exactly as
 * `runValidateCommand` always has) — `runNextCommand` is the one caller that
 * degrades that failure to omitting `validate`, mirroring how the plain-text
 * self-validation instruction already degrades on the same failure.
 */
const resolveValidateScript = (
  rest: Rest,
): Effect.Effect<
  { readonly file: string; readonly mode: StateMode; readonly script: string } | undefined,
  Error,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const file = rest.hints.file
    const mode = rest.stateDef.mode
    if (file === undefined || mode === undefined) return undefined

    const fs = yield* FileSystem.FileSystem
    const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)))
    const present = yield* fs.exists(file).pipe(Effect.mapError(toError))
    if (!present) return undefined

    const resolved = resolveSteeringMode(rest.def, mode)
    if (resolved === undefined) {
      return yield* Effect.fail(new Error(unknownModeMessage(rest.def, rest.state, mode)))
    }
    const commands = yield* renderSteeringCommands(resolved, file, rest.context)
    const lastIndex = commands.length - 1
    const steps: EmitStep[] = commands.map(
      (command, index): EmitStep => ({
        kind: "command",
        command,
        ...(index === lastIndex && resolved.validate?.kind === "command"
          ? { onFailure: fixPromptInstruction(file) }
          : {}),
      }),
    )
    const script = emitScripts(headPreconditions(rest.context.currentCommit), steps).required
    return { file, mode, script }
  })

/** `gtd next`'s plain-text output: the rendered content (newline-terminated), plus the self-validation instruction (naming `selfValidateCommand`, when resolved) when the rest is a validatable prompt. */
const nextPlainOutput = (
  rendered: RenderedRest,
  selfValidateCommand: string | undefined,
): string => {
  const base = rendered.content.endsWith("\n") ? rendered.content : rendered.content + "\n"
  return emitsValidatablePrompt(rendered) && selfValidateCommand !== undefined
    ? base + selfValidateInstruction(selfValidateCommand, rendered.file!)
    : base
}

/**
 * The driver-facing `BeatKind` for a currently-resolved rest — `Beat.ts`'s
 * `beatKindOf` fed the rest's own content kind, dirty-tree test, and
 * `stalledAt` verdict. The ONE computation `gtd status --json`'s beat document
 * (`gatherStatusView`, below), `next`/`status`'s own exit code, and `land`'s
 * "known imprecision" doc comment all point back to — so the three surfaces
 * can never independently drift on what a given rest's kind is.
 */
const restBeatKind = (rest: Rest): BeatKind =>
  beatKindOf({
    contentKind: contentKindOf(rest.stateDef) as Exclude<ContentKind, "commit">,
    dirty: rest.changes.length > 0,
    stalled: stalledAt(rest),
  })

/**
 * `0` from `next`/`status` means exactly one thing: the machine is IDLE —
 * resting at the workflow's initial state with a clean tree. Get this wrong
 * in either direction and a driver loop breaks in a way no unit test sees:
 * map clean idle to 20 and a driver that just landed a squash immediately
 * starts a fresh process; map a non-initial clean `message` gate to 0 and a
 * driver stops at every human gate instead of reporting it (see
 * `ExitCodes.ts`'s `restExitCode`, which this feeds).
 */
const restIsIdle = (rest: Rest): boolean =>
  rest.state === initialStateOf(rest.def) && rest.changes.length === 0

/** `next`/`status`'s own exit code — `ExitCodes.ts`'s `restExitCode` fed this rest's beat kind and idleness, never its state name. */
const restExitCodeOf = (rest: Rest): number => restExitCode(restBeatKind(rest), restIsIdle(rest))

/**
 * `gtd next`: pure emitter of the resolved rest's rendered content — no
 * mutation at all, plain text only (the structured beat document moved to
 * `gtd status --json` — see `gatherStatusView`, below, and AGENTS.md's "one
 * structured surface" decision). Nothing is written, so a peek and a
 * would-be dispatch are the same call — there is no separate claiming form.
 *
 * Returns the same `restExitCodeOf` every branch below resolves against — the
 * caller (`dispatchCommand`) uses it as the process exit code.
 */
const runNextCommand = (out: ArtifactOut): Effect.Effect<number, Error, CommandRequirements> =>
  Effect.gen(function* () {
    const rest = yield* currentRest
    const rendered = yield* renderRest(rest)
    const exitCode = restExitCodeOf(rest)
    // The plain rendering surfaces a stall the same way the beat document
    // does — a human peeking at a stalled rest must see the diagnosis, not
    // the prompt that already went nowhere.
    if (rendered.kind === "prompt" && rest.changes.length === 0 && stalledAt(rest)) {
      out.write(stallDiagnosis(rendered.state, rendered.actor))
      return exitCode
    }
    // Advisory only (see `selfValidateInstruction`'s doc comment) — a render
    // failure here must not fail `gtd next` itself, so it degrades to omitting
    // the instruction rather than propagating.
    const selfValidateCommand = emitsValidatablePrompt(rendered)
      ? yield* resolveSelfValidateCommand(
          rest.def,
          rendered.mode!,
          rendered.file!,
          rest.context,
        ).pipe(Effect.catchAll(() => Effect.succeed(undefined)))
      : undefined
    out.write(nextPlainOutput(rendered, selfValidateCommand))
    return exitCode
  })

/**
 * `gtd validate`: emit the script that would format (in place) then validate
 * the steering file the resolved rest declares (`file:` rendered, `mode:`
 * selecting how) — the SAME commands `gtd land`'s capture guard now embeds
 * ahead of its own commit (see `planLanding`), rendered here for a human or
 * agent to run directly. gtd itself reads no file and executes nothing: a
 * state with no `file:`/`mode:` (or, like the bundled `idle`, a `file:` with
 * no `mode:` — a mode-less sketch has no format to run), or a file absent
 * from the working tree, has nothing to validate (prints "nothing to
 * validate", exit 0 either way) — the verdict now lives in the emitted
 * script's own future exit code, not this command's, so this never fails on a
 * bad file. `RepoFiles`/`FileSystem` is used only to check the file's
 * PRESENCE, never to read or judge its content. When the resolved mode's
 * validate half is a `command` (never a `"builtin"` validator, which renders
 * no shell command at all), the LAST rendered command carries `onFailure:
 * fixPromptInstruction(file)` (`Emit.ts`'s `failurePromptWrapper`) — so a
 * non-zero exit from the script prints the COMPLETE ready-to-send fix prompt
 * (instruction + findings) rather than bare findings, letting a driver treat
 * the script's captured output as opaque prompt text (see the README's
 * minimal driver).
 */
const runValidateCommand = (out: ArtifactOut): Effect.Effect<void, Error, CommandRequirements> =>
  Effect.gen(function* () {
    const rest = yield* currentRest
    const resolved = yield* resolveValidateScript(rest)
    out.write(
      resolved !== undefined && resolved.script.length > 0
        ? `${resolved.script}\n`
        : `nothing to validate at "${rest.state}"\n`,
    )
  })

/**
 * `gtd check <mode> <file>`: read `<file>` and run the BUILT-IN steering
 * format named `<mode>`'s pure parser over its contents, printing each
 * finding one per line and exiting non-zero when there are any. Unlike `gtd
 * validate` (which resolves the currently resting state's own `file:`/`mode:`
 * and formats before validating), this resolves NO workflow state and reads
 * NO config — both `mode` and `file` are given explicitly, so it needs only
 * `FileSystem.FileSystem` and runs from any directory. This is what a
 * workflow's seeded `validate:` command (`SteeringFormats.ts`'s
 * `seededValidateCommand`) invokes as a leaf step; it does no formatting
 * in-place — an emitted script has no template context to format against.
 *
 * An absent file mirrors `gtd validate`'s own absent-file behavior: exit 0,
 * no output in plain mode, `{valid: true, errors: []}` under `--json`. A
 * clean parse is the same shape — both written through `out`, the buffered
 * `ArtifactOut` `Cli.ts` flushes once the command succeeds. A non-clean parse
 * writes NOTHING through `out`: the whole all-or-nothing point of that buffer
 * is that a failing command's stdout stays byte-empty, so the findings
 * instead ride the FAILING Effect's own message (one per line, joined) —
 * `Cli.ts`'s shared `report`/`renderFailure` machinery puts that on stderr
 * (plain text always; also folded into the `--json` envelope's `prompt`
 * field), the same single path every other refusal already goes through.
 *
 * `--open-questions` (`openQuestions: true`) replaces this whole
 * structural-findings path with `runOpenQuestionsCheckCommand`, below — but
 * only after the SAME unknown-mode validation runs (a typo'd mode must still
 * fail loudly, not silently pass an answered-looking document), and only for
 * `mode === "qa"` (the only mode the open-questions predicate means anything
 * for; `<mode>` stays a required positional because the arity table always
 * takes two, but `"review"` there is a distinct, equally wrong, silent
 * mismatch this rejects explicitly rather than accepting).
 */
/** One `SteeringFinding` printed the way plain-mode `gtd check`/`gtd validate` show it: `<file>:<line+1>: <message>` for a positioned finding (1-based, editors and humans both count from 1), bare `<message>` for a positionless one. */
const formatFinding = (file: string, finding: SteeringFinding): string =>
  finding.line !== undefined ? `${file}:${finding.line + 1}: ${finding.message}` : finding.message

const runCheckCommand = (
  mode: string,
  file: string,
  openQuestions: boolean,
): Effect.Effect<void, Error, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const format = steeringFormatFor(mode)
    if (format === undefined) {
      return yield* Effect.fail(
        new Error(
          `gtd check: unknown mode "${mode}" — known modes: ${builtInModeNames().join(", ")}`,
        ),
      )
    }

    if (openQuestions) {
      if (mode !== "qa") {
        return yield* Effect.fail(
          new Error(`gtd check: --open-questions only applies to mode "qa" — got "${mode}"`),
        )
      }
      return yield* runOpenQuestionsCheckCommand(file)
    }

    const fs = yield* FileSystem.FileSystem
    const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)))
    const present = yield* fs.exists(file).pipe(Effect.mapError(toError))
    const errors = present
      ? format
          .validate(yield* fs.readFileString(file).pipe(Effect.mapError(toError)))
          .map((finding) => formatFinding(file, finding))
      : []

    if (errors.length === 0) return

    return yield* Effect.fail(
      new Error(
        `gtd check: ${file} is not valid under mode "${mode}" (${errors.length} finding(s)):\n` +
          errors.join("\n"),
      ),
    )
  })

/**
 * `gtd check <mode> <file> --open-questions`: read `<file>` and run
 * `OpenQuestions.ts`'s `unansweredQuestions` — the SAME predicate
 * `StepGuards.ts`'s answer-completeness guard enforces at land — printing one
 * unanswered question per line and exiting non-zero when any remain. Sharing
 * the one function makes a workflow's own gate script (this) and the land-time
 * guard (`answerCompletenessGuard`) two views of the same decision: no
 * reachable state can skip the gate while a land would still be refused, or
 * enter the gate while every land would already pass.
 *
 * A missing or unreadable file is a non-zero exit carrying a message, mirrored
 * from `gtd check`'s general "stop and show the human" convention — unlike the
 * structural path above, which treats an absent file as "nothing to report".
 * Writes nothing on success (mirroring `runCheckCommand`'s own silent
 * success); on failure each unanswered question is folded into the failing
 * Effect's own message instead, which `Cli.ts`'s shared `report`/`renderFailure`
 * puts on stderr.
 */
const runOpenQuestionsCheckCommand = (
  file: string,
): Effect.Effect<void, Error, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)))
    const present = yield* fs.exists(file).pipe(Effect.mapError(toError))
    if (!present) {
      return yield* Effect.fail(new Error(`gtd check: ${file} does not exist`))
    }
    const content = yield* fs.readFileString(file).pipe(Effect.mapError(toError))

    const errors = unansweredQuestions(content).map((q) => q.question)
    if (errors.length === 0) return

    return yield* Effect.fail(
      new Error(
        `gtd check: ${errors.length} open question(s) unanswered in ${file}:\n` + errors.join("\n"),
      ),
    )
  })

/** Which declared `on` pattern (if any) each pending change matches — the pure computation `gtd status` reports (both plain and `--json`). `onEdges` is ALREADY RENDERED against `it.vars` (`renderOnEdges`) — the reported pattern is the one a real `gtd land` would match against. */
const computeStatusChanges = (
  onEdges: readonly OnEdge[],
  changes: readonly PendingChange[],
): readonly StatusChange[] =>
  changes.map((change) => {
    const matchedRow = onEdges.find(([patternStr]) => {
      const parsed = parsePattern(patternStr)
      return parsed !== undefined && matchesPattern(parsed, [change])
    })
    return { status: change.status, path: change.path, pattern: matchedRow?.[0] ?? null }
  })

/**
 * First declared `on` edge (in declaration order) whose pattern matches the
 * WHOLE pending change list — mirroring `PatternMachine.step`'s own
 * first-match-wins semantics (`matchOn`) exactly, unlike `computeStatusChanges`
 * above which matches each change independently. `null` when no edge matches,
 * covering both a clean tree with no declared `C` row and a dirty tree
 * matching none of the declared patterns.
 *
 * This reports the DECLARED route only: a capped `retry` target may redirect
 * elsewhere at real step time (`applyRetry` in `PatternMachine.ts`), which
 * this does not apply — same pre-retry, pure-over-already-fetched-inputs
 * contract as `computeStatusChanges`.
 */
export const computeNextMatch = (
  onEdges: readonly OnEdge[],
  changes: readonly PendingChange[],
): NextMatch | null => {
  for (const [pattern, target, , action] of onEdges) {
    const parsed = parsePattern(pattern)
    if (parsed !== undefined && matchesPattern(parsed, changes)) return { action, pattern, target }
  }
  return null
}

/**
 * True when the per-model breakdown adds information beyond the `Cost:` total:
 * more than one model, or a single model that carries an actual `--model` tag
 * (a lone `unspecified` bucket just restates the total, so it's suppressed).
 */
const breakdownIsInformative = (byModel: readonly ModelCost[]): boolean =>
  byModel.length > 1 || (byModel.length === 1 && byModel[0]!.model !== UNATTRIBUTED_MODEL)

/** The plain-text `Cost:` line(s) for `gtd status` — empty when nothing recorded, plus an indented per-model split when informative. */
const costStatusLines = (cost: number, byModel: readonly ModelCost[]): string[] => {
  if (cost <= 0) return []
  const lines = [`Cost: ${cost}`]
  if (breakdownIsInformative(byModel)) {
    for (const m of byModel) lines.push(`  ${m.model}: ${m.cost}`)
  }
  return lines
}

/** Builds `{[key]: value}` for each entry whose value isn't `undefined` — the shared "omit absent optional fields" shape `writeStatusPlain` uses. */
const definedFields = (
  entries: readonly (readonly [string, unknown])[],
): Record<string, unknown> => {
  const result: Record<string, unknown> = {}
  for (const [key, value] of entries) if (value !== undefined) result[key] = value
  return result
}

/** `gtd status`'s `Next:` line — the plain-text counterpart to `Beat.ts`'s `nextField`. */
const nextStatusLine = (next: NextMatch | null): string =>
  next === null
    ? "Next: (no match — nothing would happen)"
    : `Next: ${next.action ?? next.pattern} → ${next.target}`

/** `gtd status`'s `Pending:` block — `(clean)` when nothing is pending, else one indented line per change. */
const pendingStatusLines = (statusChanges: readonly StatusChange[]): string[] =>
  statusChanges.length === 0
    ? ["Pending: (clean)"]
    : [
        "Pending:",
        ...statusChanges.map((c) => `  ${c.status} ${c.path} -> ${c.pattern ?? "(no match)"}`),
      ]

/** `gtd status`'s plain-text emission — `State:`/`Awaits:`/`Label:`/`Model:`/`Memory:`/`File:`/`Mode:`/`Cost:`/`Pending:`/`Next:` lines. Untouched by the `--json` merge (see AGENTS.md) — this is the one rendering `gtd status --json` does NOT absorb. */
const writeStatusPlain = (
  out: ArtifactOut,
  rest: Rest,
  statusChanges: readonly StatusChange[],
  next: NextMatch | null,
  model: string | undefined,
  memory: string | undefined,
  label: string | undefined,
  file: string | undefined,
  cost: number,
  costByModel: readonly ModelCost[],
): void => {
  const optional = definedFields([
    ["Label", label],
    ["Model", model],
    ["Memory", memory],
    ["File", file],
    ["Mode", rest.stateDef.mode],
  ])
  const lines = [
    `State: ${rest.state}`,
    `Awaits: ${rest.actor}`,
    ...Object.entries(optional).map(([key, value]) => `${key}: ${value}`),
    ...costStatusLines(cost, costByModel),
    ...pendingStatusLines(statusChanges),
    nextStatusLine(next),
  ]
  out.write(lines.join("\n") + "\n")
}

/**
 * Everything `gtd status --json`'s beat document needs beyond the resolved
 * rest itself — the SAME `kind`/session/validate-script/log-path gathering
 * `gtd next --json` used to do on its own, now the one place both `gtd
 * status`'s plain and JSON renderings read from, so the two can never
 * describe different rests (see AGENTS.md's "status --json" decision).
 */
interface StatusView {
  readonly kind: BeatKind
  readonly log: string
  readonly session?: { readonly id: string; readonly resume: boolean }
  readonly validate?: string
}

const gatherStatusView = (
  rest: Rest,
  rendered: RenderedRest,
): Effect.Effect<StatusView, Error, CommandRequirements> =>
  Effect.gen(function* () {
    const kind = restBeatKind(rest)
    const session =
      kind === "prompt" ? resolveSession(rendered.memory, rendered.memoryResumed) : undefined
    const resolvedValidate =
      kind === "prompt"
        ? yield* resolveValidateScript(rest).pipe(Effect.catchAll(() => Effect.succeed(undefined)))
        : undefined
    const validate =
      resolvedValidate !== undefined && resolvedValidate.script.length > 0
        ? resolvedValidate.script
        : undefined
    return {
      kind,
      log: yield* loopLogPath,
      ...(session !== undefined
        ? { session: { id: session.sessionId, resume: session.resume } }
        : {}),
      ...(validate !== undefined ? { validate } : {}),
    }
  })

/**
 * `gtd status`: pure dry-run reporter — the resolved state/actor, and which
 * declared pattern (if any) each pending change matches. `--json` emits the
 * one structured surface gtd has: `Beat.ts`'s `beatDocument`, absorbing what
 * used to be `gtd next --json`'s beat fields (`kind`/`content`/`session`/
 * `model`/`validate`/`log`) alongside `changes`/`next`/`cost`/`costByModel`.
 * Returns the same `restExitCodeOf` `runNextCommand` derives for the same
 * rest — see `restBeatKind`'s doc comment.
 */
const runStatusCommand = (
  json: boolean,
  out: ArtifactOut,
): Effect.Effect<number, Error, CommandRequirements> =>
  Effect.gen(function* () {
    const rest = yield* currentRest
    const rendered = yield* renderRest(rest)
    const view = yield* gatherStatusView(rest, rendered)
    const statusChanges = computeStatusChanges(rest.on, rest.changes)
    const narrator = yield* Narrator
    for (const change of statusChanges) {
      yield* narrator.narrate(
        `pending: ${change.status} ${change.path} -> ${change.pattern ?? "(no match)"}`,
      )
    }
    const next = computeNextMatch(rest.on, rest.changes)
    if (json) {
      out.write(
        beatDocument({
          rendered,
          kind: view.kind,
          log: view.log,
          ...(view.session !== undefined ? { session: view.session } : {}),
          ...(view.validate !== undefined ? { validate: view.validate } : {}),
          changes: statusChanges,
          next,
          cost: rest.context.processCost,
          costByModel: rest.context.processCostByModel,
        }),
      )
    } else {
      writeStatusPlain(
        out,
        rest,
        statusChanges,
        next,
        rest.hints.model,
        rest.memory,
        rest.hints.label,
        rest.hints.file,
        rest.context.processCost,
        rest.context.processCostByModel,
      )
    }
    return restExitCodeOf(rest)
  })

/**
 * Best-effort resolution of the currently-rested state for the viewer's
 * `/state.json` route: prefers the review checkout window's saved head
 * (`REVIEW_HEAD_REF`) over HEAD itself, since `gtd visualize` is dispatched
 * BEFORE the review-window bracket and a request landing mid-window would
 * otherwise read a HEAD that's been temporarily rewound (see
 * `src/ReviewWindow.ts`). Any failure (not a repo, no commits, resolves to
 * the initial state with no process underway) is swallowed to `null` — the
 * browser just hides the panel.
 */
const computeCurrentState = (
  model: VizModel,
): Effect.Effect<CurrentStateModel, Error, RestRequirements> =>
  Effect.gen(function* () {
    const git: GitOperations = yield* GitService
    const reviewHead = yield* git.readRefOption(REVIEW_HEAD_REF)
    const rest = yield* restAt(Option.getOrUndefined(reviewHead))
    const group = model.states.find((s) => s.name === rest.state)?.group
    return buildCurrentStateModel(rest, rest.changes, rest.on, group)
  })

/**
 * `gtd visualize`: serve an interactive diagram of the ACTIVE workflow on a
 * local HTTP server (see `src/Visualize.ts`). Its standalone `needs:
 * "config"` (see `Cli.ts`'s `needsOf`) means it skips the repo-root guard and
 * review-window bracket — it reads the config but never touches git, HEAD, or
 * the review window ITSELF (though its `/state.json` route best-effort reads
 * git state per request, see `computeCurrentState`). `--port`/`--no-open` are
 * already parsed by `Cli.ts`. The running-server line below (`gtd visualize
 * running at ${url} …`) is now the ONLY machine-readable way to learn which
 * port `--port 0` picked — `--json` no longer exists here (see AGENTS.md).
 */
const runVisualizeCommand = (
  port: number,
  open: boolean,
  out: ArtifactOut,
): Effect.Effect<void, Error, RestRequirements> =>
  Effect.gen(function* () {
    const config = yield* (yield* ConfigService).load
    const model = buildVizModel(
      config.workflow,
      config.machineTree,
      {
        ...config.workflowVars,
        ...config.rcVars,
      },
      config.stateScopes,
    )

    const runtime = yield* Effect.runtime<RestRequirements>()
    const resolveCurrent = () =>
      Runtime.runPromise(runtime)(computeCurrentState(model).pipe(Effect.either)).then((result) => {
        if (Either.isLeft(result)) {
          // `runCli`'s one flush-on-success never fires for this blocking
          // command (it's only reached on Ctrl-C, via the interrupted-only
          // path that skips flush entirely) — this diagnostic flushes itself,
          // exactly like the URL line below.
          out.write(`gtd visualize: current-state panel unavailable — ${result.left.message}\n`)
          out.flush()
          return null
        }
        return result.right
      })

    const { server, url } = yield* Effect.tryPromise({
      try: () => startVizServer(model, port, "127.0.0.1", resolveCurrent),
      catch: (e) =>
        new Error(
          `gtd visualize: could not start server: ${e instanceof Error ? e.message : String(e)}`,
        ),
    })
    out.write(`gtd visualize running at ${url} — Ctrl-C to stop\n`)
    // The one command that must flush before it returns: it blocks on
    // `Effect.never` next, so `runCli`'s flush-on-success would never fire
    // and the URL would never reach stdout.
    out.flush()
    if (open) openInBrowser(url)
    // Block until the process is interrupted (Ctrl-C); always close the server.
    yield* Effect.never.pipe(Effect.ensuring(Effect.sync(() => server.close())))
  })

/**
 * Everything gtd derives — the workflow definition, pending changes, process
 * history — is resolved against the process cwd, so running from anywhere
 * but the repository root would silently mis-derive state. Refuses with a
 * clear error instead. (Fails fast outside a repository too:
 * `--show-toplevel` errors there.) Real paths are compared so symlinked cwds
 * (e.g. macOS /tmp → /private/tmp) match.
 */
const assertRunningFromRepoRoot = (
  git: GitOperations,
  fs: FileSystem.FileSystem,
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const topLevel = yield* git.topLevel()
    const topReal = yield* fs.realPath(topLevel)
    const cwdReal = yield* fs.realPath(process.cwd())
    if (topReal !== cwdReal) {
      return yield* Effect.fail(
        new Error(
          `gtd must be run from the repository root (${topLevel}); ` +
            `the current directory is ${process.cwd()}`,
        ),
      )
    }
  })

/**
 * A command that derives workflow state needs not just a repository root
 * (`assertRunningFromRepoRoot`) but at least one commit to derive that state
 * FROM — a commitless repository has no HEAD to resolve a `Rest` at, and the
 * sketch lookup that later depends on a resolvable base commit would otherwise
 * fail silently, well past the point where a script has already been emitted.
 * `git.hasCommits()` is already on the `GitOperations` port and already
 * contract-tested against both the real-git and in-memory tiers
 * (`src/testing/GitTiers.ts`'s `hasCommits` group) — this is a single read of
 * it, plus the failure.
 */
const assertRepositoryHasCommits = (git: GitOperations): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const hasCommits = yield* git.hasCommits()
    if (!hasCommits) {
      return yield* Effect.fail(
        new Error(
          "gtd requires a repository with at least one commit — make an initial commit, then run gtd again",
        ),
      )
    }
  })

/**
 * `gtd init` writes only a `.gtdrc.json` (+ prompt files) — it derives no state,
 * so unlike the state commands it need not sit in a git repository at all. It
 * may run EITHER at a repository root OR in a directory outside any repository —
 * the latter scaffolds a shared config a nested repo picks up by walking up the
 * cwd→home chain. The one
 * placement it must refuse is a repository SUBDIRECTORY: gtd runs from the repo
 * root and discovers config by walking UP, so a config written below the root
 * would silently never be found. Returns whether cwd is inside a repository (at
 * its root), so the caller can tailor the "commit before starting" guidance —
 * there is nothing to commit outside a repo.
 */
const assertInitLocation = (
  git: GitOperations,
  fs: FileSystem.FileSystem,
): Effect.Effect<boolean, Error> =>
  Effect.gen(function* () {
    const topLevel = yield* Effect.either(git.topLevel())
    // `topLevel` fails only outside a git repository — there, init is allowed.
    if (topLevel._tag === "Left") return false
    const topReal = yield* fs.realPath(topLevel.right)
    const cwdReal = yield* fs.realPath(process.cwd())
    if (topReal !== cwdReal) {
      return yield* Effect.fail(
        new Error(
          `gtd init must be run from the repository root (${topLevel.right}) or from a ` +
            `directory outside any git repository; the current directory is a repository ` +
            `subdirectory: ${process.cwd()}`,
        ),
      )
    }
    return true
  })

/**
 * What a command kind needs before it may run — re-exported from `Cli.ts` (see
 * its `Needs` type doc comment). Defined HERE, not in `Cli.ts`: this
 * dispatcher (`runCommand`, below) is `needsOf`'s only runtime caller, and
 * `Cli.ts` already has a real (value) dependency on this module for
 * `runCommand` itself — a value import running the other way would make the
 * two modules circular.
 *
 * `"state"` means the kind derives workflow state, so it needs a repository
 * root AND at least one commit to derive that state from — both guards run in
 * `runCommand`, below, before dispatch.
 */
export const needsOf = (kind: Command["kind"]): Needs => {
  switch (kind) {
    case "lsp":
    case "install":
      return "none"
    case "init":
    case "check":
      return "fs"
    case "visualize":
      return "config"
    default:
      return "state"
  }
}

/** The five kinds that never touch the repo-root guard / review-window bracket — pinned so a new standalone kind can't be added silently. */
export const standaloneKinds = (): readonly Command["kind"][] => [
  "lsp",
  "init",
  "visualize",
  "check",
  "install",
]

/** Dispatches to the named `run*Command` handler for every `Command.kind` EXCEPT `"land"`, `"next"` and `"status"` (the three kinds whose own resolved rest decides the exit code — see `dispatchCommand`) — the counterpart of `Cli.ts`'s `parseArgv`, which has already validated every field a handler receives. None of these kinds ever carries `--json`: `Cli.ts`'s flag scope pins it to `"status"` alone, so no handler here takes a `json` parameter any more. */
// fallow-ignore-next-line complexity
const dispatchVoidCommand = (
  command: Exclude<Command, { kind: "land" | "next" | "status" }>,
  out: ArtifactOut,
): Effect.Effect<void, Error, CommandRequirements> => {
  switch (command.kind) {
    case "lsp":
      return runLspCommand()
    case "init":
      return runInitCommand(out)
    case "visualize":
      return runVisualizeCommand(command.port, command.open, out)
    case "entry":
      return runEntryCommand(command.actor, command.state, command.vars, out, command.label)
    case "abandon":
      return runAbandonCommand(out)
    case "restore":
      return runRestoreCommand(out)
    case "validate":
      return runValidateCommand(out)
    case "check":
      return runCheckCommand(command.mode, command.file, command.openQuestions ?? false)
    case "install":
      return runInstallCommand(out)
  }
}

/**
 * Dispatches every `Command` to its exit code. `"land"`, `"next"` and
 * `"status"` each derive theirs from the resolved rest (`ExitCodes.ts`'s
 * `restExitCode`/`ownerCodeOf` — see each handler's own doc comment); every
 * other kind always succeeds at `EXIT_OK` (`dispatchVoidCommand`, piped
 * through `Effect.as`). Splitting the exhaustive switch out to
 * `dispatchVoidCommand` keeps this function's own branching to the kinds that
 * actually vary. `json` reaches only `runStatusCommand` — `Cli.ts` guarantees
 * it is `false` for every other kind (the flag's whole scope is `"status"`),
 * so no other handler needs to see it.
 */
const dispatchCommand = (
  command: Command,
  json: boolean,
  out: ArtifactOut,
): Effect.Effect<number, Error, CommandRequirements> => {
  switch (command.kind) {
    case "land":
      return runLandCommand(
        {
          ...(command.cost !== undefined ? { cost: command.cost } : {}),
          ...(command.model !== undefined ? { model: command.model } : {}),
        },
        out,
      )
    case "next":
      return runNextCommand(out)
    case "status":
      return runStatusCommand(json, out)
    default:
      return dispatchVoidCommand(command, out).pipe(Effect.as(EXIT_OK))
  }
}

/**
 * The one entry point `Cli.ts`'s `runCli` calls for a resolved `Command`:
 * dispatches to the matching `run*Command` handler (see `dispatchCommand`),
 * wrapped in the repo-root-and-commit guard exactly when
 * `needsOf(command.kind) === "state"` — `lsp`/`init`/`visualize`/`check` (the
 * `standaloneKinds`) run bare. `Cli.ts` has already validated every field on
 * `command` (arity, flag scope, decoding), so nothing here re-parses argv.
 * Returns the exit code `Cli.ts`'s `runCli` should use — `EXIT_OK` for every
 * command except `land`/`next`/`status`, each of which derives its own from
 * the resolved (or, for `land`, post-land) rest (see `ExitCodes.ts`).
 *
 * The guard is two checks, in order: `assertRunningFromRepoRoot` (running from
 * the wrong directory is the more fundamental misuse, and its message is about
 * WHERE you are), then `assertRepositoryHasCommits` (a repository with no
 * commits has no HEAD to derive workflow state from). Both run before
 * `dispatch`, so a refusal writes nothing and emits no script by construction.
 *
 * No review-window close/open bracket runs here any more: every state-command
 * handler (see `planLanding`) now decides for itself, off `ReviewWindow.ts`'s
 * pure `decideCloseWindow`/`decideOpenWindow`, whether a close/open belongs in
 * the script it emits — there is no in-process HEAD to rewind ahead of time
 * (gtd itself no longer writes git for a state command at all).
 */
export const runCommand = (
  command: Command,
  json: boolean,
  out: ArtifactOut,
): Effect.Effect<number, Error, CommandRequirements> => {
  const dispatch = dispatchCommand(command, json, out)
  if (needsOf(command.kind) !== "state") return dispatch
  return Effect.gen(function* () {
    const git = yield* GitService
    const fs = yield* FileSystem.FileSystem
    yield* assertRunningFromRepoRoot(git, fs)
    yield* assertRepositoryHasCommits(git)
    return yield* dispatch
  })
}

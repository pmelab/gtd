import { join } from "node:path"
import { tmpdir } from "node:os"
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
  type ExecutableDecision,
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
import {
  resolveSteeringMode,
  renderSteeringCommands,
  steeringCapabilities,
  unknownModeMessage,
  type ResolvedMode,
} from "./SteeringMode.js"
import { buildModeContradictionCheck, modeContradictionSkipNotice } from "./ModeContradiction.js"
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
  beatFields,
  beatKindOf,
  landFields,
  renderBeatJson,
  renderBeatPlain,
  renderBeatSh,
  renderLandJson,
  renderLandSh,
  type BeatFields,
  type BeatKind,
  type NextMatch,
  type StatusChange,
} from "./Beat.js"
import { renderModeCommand, renderStateTemplate, type TemplateContext } from "./PatternTemplates.js"
import { deleteRef, hardResetTo, mixedResetTo, updateRef } from "./GitScript.js"
import {
  combinedScript,
  emitScripts,
  fileExistsGuard,
  type EmitPreconditions,
  type EmitStep,
} from "./Emit.js"
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
 * next's own surface alone now, so `install` prints plain text only.
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

/**
 * `planLanding`'s result — a preview of what `gtd land` WOULD do, plus the
 * combined `script` the external driver runs to actually do it (see the
 * module doc comment: `land` is a pure read/emitter, never a git write
 * itself). `script` is `Emit.ts`'s `combinedScript(required, optional)`,
 * computed ONCE here — plain `gtd land`'s stdout and `--sh`'s `gtd_script`
 * both read this one field, so byte-identity between them is
 * unrepresentable-otherwise rather than a test to keep green.
 */
interface LandResult {
  readonly state: StateName
  readonly subject: string | null
  readonly cost: number | null
  readonly model: string | null
  readonly script: string
  /**
   * True for either of the two terminal shapes a landing can settle into: a
   * no-op at a `script` rest (`Edge.ts`'s `noOpSettles`), or a decision that
   * collapses back to the workflow's initial state retaining nothing
   * (`Edge.ts`'s `collapsesToInitialState` — a green re-entry rewound like
   * `gtd abandon` instead of committed). Nothing owed, but stdout still
   * carries a script a piping driver must run — see `exitCode`.
   */
  readonly settled: boolean
  /**
   * Whether `state` — the state landing rests at once this script runs — is
   * the workflow's initial state.
   */
  readonly idle: boolean
}

/**
 * Exactly one trailing newline — duplicated from `Cli.ts`'s own
 * `normalizeTrailingNewline` rather than imported: `Cli.ts` already has a
 * real, one-directional value dependency on this module (for `runCommand`),
 * so a value import running the other way would make the two modules
 * circular (see this module's own import comment on `Cli.ts`). `Cli.ts`'s
 * `bufferedArtifactOut` already normalizes whatever plain `gtd land` writes
 * at flush time, but a landing's own `script` is ALSO embedded verbatim
 * inside the `--json`/`--sh` documents (`Beat.ts`'s `landFields`) — never
 * re-normalized at THEIR tail, since more fields follow it there — so
 * `LandResult.script` must already carry its own single trailing newline for
 * `gtd_script` to stay byte-identical to plain `gtd land`'s (separately
 * normalized) stdout.
 */
const normalizeScriptNewline = (script: string): string =>
  script.length === 0 ? script : `${script.replace(/\n+$/, "")}\n`

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
    // The LAST command carries `onFailure: fixPromptInstruction(file)` when the
    // validator is a command — the same wrapper `resolveValidateScript`'s own
    // script uses — so a failing validate INSIDE this landing step's script
    // prints the routable fix prompt instead of bare findings (package 2's
    // Requirement A: the one path that fired on the stuck worktree used to
    // print thirteen raw findings a driver can't route).
    return yield* renderSteeringModeCommandSteps(resolved, file, rest.context)
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
      // resolved one — `plan.state` (same as `rest.state`).
      const required = emitScripts({}, [
        { kind: "outcome", command: noteOutcome(noopText(plan.state)) },
      ]).required
      return {
        state: plan.state,
        subject: null,
        cost: null,
        model: null,
        script: normalizeScriptNewline(combinedScript(required, "")),
        settled: plan.settled,
        idle: plan.state === initialStateOf(rest.def),
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
    // The state landing will actually REST at — distinct from `targetState`
    // above, which names the squash's own commit-state key (what
    // `reviewWindow:` is declared on), not where the process resumes: a
    // squash's rendered subject never parses back into a declared state, so
    // it always resolves to the workflow's initial state.
    const restingState = decision.kind === "commit" ? decision.to : initialStateOf(rest.def)
    const settled = yield* collapsesToInitialState(rest, decision)
    const openDecision = yield* decideAndNarrateOpenWindow(rest, targetState)
    const required = yield* buildRequiredScript(rest, decision, opts.cost, opts.model)
    return {
      state: restingState,
      subject: yield* previewSubject(decision, rest),
      cost: opts.cost ?? null,
      model: opts.model ?? null,
      script: normalizeScriptNewline(combinedScript(required, openWindowScript(openDecision))),
      settled,
      idle: restingState === initialStateOf(rest.def),
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
 * Three encodings, all reading from the one `LandResult` `planLanding`
 * returns (`Beat.ts`'s `landFields`, mirroring `gtd next`'s own
 * plain/`--json`/`--sh` split). Plain (the default) writes `result.script`
 * verbatim — byte-identical to today, so `gtd land | sh` keeps working; its
 * own outcome rendering, including a genuine no-op's "nothing to do at …"
 * note and the initial-state collapse's `COLLAPSED_TEXT` note, is already
 * baked into that script (see `renderDecision`'s collapse branch). `--json`/
 * `--sh` emit `script` as one field alongside `settled`/`idle`/`state`/
 * `subject`/`cost`/`model` — nothing derived beyond `LandResult`'s own
 * fields.
 *
 * Exit code is uniform now: `EXIT_OK` on any successful landing, whatever
 * `settled`/`idle` say — see `Cli.ts`'s `runCli`, which supplies it. Whose
 * turn is next lives entirely in the FOLLOWING `gtd next --json`'s own
 * `kind` field.
 */
const runLandCommand = (
  opts: LandOptions,
  json: boolean,
  sh: boolean,
  out: ArtifactOut,
): Effect.Effect<void, Error, CommandRequirements> =>
  Effect.gen(function* () {
    const result = yield* planLanding(opts)
    if (json) {
      out.write(renderLandJson(landFields(result)))
    } else if (sh) {
      out.write(renderLandSh(landFields(result)))
    } else {
      out.write(result.script)
    }
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
 * The driver-side counterpart of `Beat.ts`'s `selfValidateInstruction` — the
 * same gate, expressed for a loop that RUNS the validate script itself and
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
 * Render `resolved`'s format:/validate: commands as `EmitStep[]`, wrapping
 * the LAST one with `onFailure: fixPromptInstruction(file)` when the
 * validator is a command — shared by `resolveValidateScript`'s own script
 * (`gtd validate`/`gtd next --json`'s embedded `.validate`) and
 * `steeringModeSteps`' landing-time one, so the two can never drift on which
 * command gets the routable fix prompt (package 2's Requirement A: before
 * this, `steeringModeSteps` carried no `onFailure` at all, so a failing
 * landing-time validate printed thirteen raw findings a driver couldn't
 * route).
 */
const renderSteeringModeCommandSteps = (
  resolved: ResolvedMode,
  file: string,
  context: TemplateContext,
): Effect.Effect<readonly EmitStep[], Error> =>
  Effect.gen(function* () {
    const commands = yield* renderSteeringCommands(resolved, file, context)
    const lastIndex = commands.length - 1
    return commands.map(
      (command, index): EmitStep => ({
        kind: "command",
        command,
        ...(index === lastIndex && resolved.validate?.kind === "command"
          ? { onFailure: fixPromptInstruction(file) }
          : {}),
      }),
    )
  })

/**
 * The scratch directory a contradiction round-trip's sample is written
 * under: `EnvVars.all["TMPDIR"]` when set and non-empty, `node:os`'s
 * `tmpdir()` otherwise — never a `/tmp` literal or `mktemp`
 * (`tests/tooling/no-tmp-assumption.test.ts` scans `src/` for both). Reading
 * `EnvVars` first is what makes the emitted script deterministic in unit
 * tests, which inject a fixed `TMPDIR`.
 */
const scratchDir = (envVars: {
  readonly all: Readonly<Record<string, string | undefined>>
}): string => {
  const configured = envVars.all["TMPDIR"]
  return configured !== undefined && configured.length > 0 ? configured : tmpdir()
}

/**
 * `<scratchDir>/gtd-mode-sample-<mode>-<pid>.md` — an absolute literal baked
 * in at EMIT time (never re-derived by a shell variable at run time: a
 * `format:` template like `npx oxfmt --write '<%= it.file %>'` renders
 * `it.file` inside single quotes, which no shell expands, so `mktemp`/
 * `${TMPDIR:-/tmp}` forms would never actually resolve). `<pid>` is
 * `process.pid`, so two concurrent `gtd` processes never collide. The `.md`
 * suffix is load-bearing — without it a formatter may refuse the file
 * outright (a raw `format:` failure, not the contradiction finding this
 * exists to produce).
 */
const scratchSamplePath = (
  envVars: { readonly all: Readonly<Record<string, string | undefined>> },
  mode: StateMode,
): string => join(scratchDir(envVars), `gtd-mode-sample-${mode}-${process.pid}.md`)

/**
 * The contradiction round-trip/skip-notice tier for `resolved`'s `mode:`,
 * read off `steeringCapabilities` — no new resolution vocabulary (see
 * `src/SteeringMode.ts`). `formatCommand` absent means nothing to round-trip
 * (no formatter, no contradiction to find): empty. Otherwise, three cases —
 * a LIVE built-in validator (covers `qa`/`review` under gtd's seeded
 * `gtd check <mode> '<file>'` validator, and the `builtin` validator kind)
 * runs the round-trip against that format's own canonical sample
 * (`SteeringFormat.sample`); an EXTERNAL validator (a genuine user
 * `validate:` override, or any command-validated non-built-in mode) prints a
 * one-line skip notice instead — coverage is the two built-in modes only, and
 * silence would read as a clean bill of health; a format-only mode with
 * neither (no in-process parser at all) has nothing to round-trip either:
 * empty, same as no formatter.
 *
 * Emitted BEFORE `Emit.ts`'s `fileExistsGuard` in the caller's step list —
 * that is the whole reason to use a bundled sample rather than the real file:
 * it keeps the check alive at a first-write beat where the real steering file
 * does not exist yet (see the package's own "How" section).
 */
const modeContradictionSteps = (
  resolved: ResolvedMode,
  mode: StateMode,
  context: TemplateContext,
): Effect.Effect<readonly EmitStep[], Error, EnvVars> =>
  Effect.gen(function* () {
    if (resolved.formatCommand === undefined) return []
    const capabilities = steeringCapabilities(resolved)
    if (capabilities.format !== undefined && capabilities.liveValidate !== undefined) {
      const envVars = yield* EnvVars
      const samplePath = scratchSamplePath(envVars, mode)
      const formatCommand = yield* Effect.try({
        try: () => renderModeCommand(resolved.formatCommand!, { ...context, file: samplePath }),
        catch: (e) =>
          new Error(
            `mode "${mode}": "format" command failed to render — ${
              e instanceof Error ? e.message : String(e)
            }`,
          ),
      })
      const block = buildModeContradictionCheck({
        mode,
        samplePath,
        sample: capabilities.format.sample,
        formatCommand,
      })
      return [{ kind: "command", command: block }]
    }
    if (capabilities.externalValidate === true) {
      return [{ kind: "command", command: modeContradictionSkipNotice(mode) }]
    }
    return []
  })

/**
 * Resolve the resting state's own steering-file validate script — the SAME
 * script both `gtd validate --json` (`runValidateCommand`, its thin caller
 * now) and `gtd next --json`'s embedded `validate` field emit, from one
 * shared resolver so the two surfaces can't drift. `undefined` = nothing to
 * validate at all: no `file:`+`mode:` declared. An unknown `mode:` FAILS this
 * Effect (exactly as `runValidateCommand` always has) — `runNextCommand` is
 * the one caller that degrades that failure to omitting `validate`,
 * mirroring how the plain-text self-validation instruction already degrades
 * on the same failure.
 *
 * The declared file's PRESENCE is no longer checked here in TS-land: a
 * missing file used to short-circuit this whole function to `undefined`,
 * which withheld the repair loop at exactly the first-write beat that needs
 * it (every `while [ -n "$gtd_validate" ]` driver loop only fires when this
 * field is non-empty — see the package's own doc comment). Existence is
 * instead evaluated INSIDE the emitted script itself, via `Emit.ts`'s
 * `fileExistsGuard`, once it is knowable (after the turn) — an `EmitStep`
 * list is always produced when `file:`+`mode:` are both declared, even for a
 * file that turns out absent; that script's own `[ -f <file> ] || exit 0`
 * then exits 0 with nothing to do, preserving the "a turn that legitimately
 * wrote nothing burns no fix turns" property. The contradiction round-trip
 * (`modeContradictionSteps`) is emitted BEFORE that guard, so it still runs
 * at that same first-write beat, ahead of it.
 */
const resolveValidateScript = (
  rest: Rest,
): Effect.Effect<
  { readonly file: string; readonly mode: StateMode; readonly script: string } | undefined,
  Error,
  EnvVars
> =>
  Effect.gen(function* () {
    const file = rest.hints.file
    const mode = rest.stateDef.mode
    if (file === undefined || mode === undefined) return undefined

    const resolved = resolveSteeringMode(rest.def, mode)
    if (resolved === undefined) {
      return yield* Effect.fail(new Error(unknownModeMessage(rest.def, rest.state, mode)))
    }

    const steps: EmitStep[] = [
      ...(yield* modeContradictionSteps(resolved, mode, rest.context)),
      { kind: "command", command: fileExistsGuard(file) },
      ...(yield* renderSteeringModeCommandSteps(resolved, file, rest.context)),
    ]
    const script = emitScripts(headPreconditions(rest.context.currentCommit), steps).required
    return { file, mode, script }
  })

/**
 * The driver-facing `BeatKind` for a currently-resolved rest — `Beat.ts`'s
 * `beatKindOf` fed the rest's own content kind, dirty-tree test, and
 * `stalledAt` verdict. The ONE computation `gtd next`'s beat document
 * (`gatherBeatFields`, below) reads — so a driver's `kind` field can never
 * drift from what `gatherBeatFields` itself assembled.
 */
const restBeatKind = (rest: Rest): BeatKind =>
  beatKindOf({
    contentKind: contentKindOf(rest.stateDef) as Exclude<ContentKind, "commit">,
    dirty: rest.changes.length > 0,
    stalled: stalledAt(rest),
  })

/**
 * `idle` from `next`'s beat document means exactly one thing: the machine is
 * resting at the workflow's initial state with a clean tree — the one shape
 * that means the process is genuinely done. This is a plain field on the
 * beat document now (`BeatFields.idle`), never the process exit code, which
 * is uniformly `EXIT_OK` on any successful `gtd next`.
 */
const restIsIdle = (rest: Rest): boolean =>
  rest.state === initialStateOf(rest.def) && rest.changes.length === 0

/**
 * `gtd next`: pure emitter of the resolved rest's beat, in three encodings —
 * `--json`/`--sh` (`Beat.ts`'s `renderBeatJson`/`renderBeatSh`) and plain
 * (`renderBeatPlain`, the default). No mutation at all: nothing is written,
 * so a peek and a would-be dispatch are the same call — there is no separate
 * claiming form.
 *
 * `json`/`sh` are mutually exclusive by construction (`Cli.ts`'s `parseArgv`
 * refuses both present before this ever runs), so at most one is `true`.
 *
 * Exit code is `EXIT_OK` unconditionally (see `Cli.ts`'s `runCli`) — whose
 * turn is next lives entirely in the beat document's own `kind` field, never
 * in the process exit code.
 */
const runNextCommand = (
  json: boolean,
  sh: boolean,
  out: ArtifactOut,
): Effect.Effect<void, Error, CommandRequirements> =>
  Effect.gen(function* () {
    const rest = yield* currentRest
    const rendered = yield* renderRest(rest)
    const fields = yield* gatherBeatFields(rest, rendered)
    const narrator = yield* Narrator
    for (const change of fields.changes) {
      yield* narrator.narrate(
        `pending: ${change.status} ${change.path} -> ${change.pattern ?? "(no match)"}`,
      )
    }
    if (json) {
      out.write(renderBeatJson(fields))
    } else if (sh) {
      out.write(renderBeatSh(fields))
    } else {
      // Advisory only (see `Beat.ts`'s `renderBeatPlain` doc comment) — a
      // render failure here must not fail `gtd next` itself, so it degrades
      // to omitting the instruction rather than propagating.
      const selfValidateCommand = emitsValidatablePrompt(rendered)
        ? yield* resolveSelfValidateCommand(
            rest.def,
            rendered.mode!,
            rendered.file!,
            rest.context,
          ).pipe(Effect.catchAll(() => Effect.succeed(undefined)))
        : undefined
      out.write(renderBeatPlain(fields, selfValidateCommand))
    }
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

/** Which declared `on` pattern (if any) each pending change matches — the pure computation `gtd next` reports (plain, `--json` and `--sh` alike). `onEdges` is ALREADY RENDERED against `it.vars` (`renderOnEdges`) — the reported pattern is the one a real `gtd land` would match against. */
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
 * Everything one beat needs beyond the resolved rest itself — the SAME
 * `kind`/`idle`/session/validate-script/log-path/`changes`/`next` gathering
 * `gtd next` reads from for all three of its encodings, so plain/`--json`/
 * `--sh` can never describe different rests for the same beat (see
 * AGENTS.md's "one structured surface" decision).
 */
const gatherBeatFields = (
  rest: Rest,
  rendered: RenderedRest,
): Effect.Effect<BeatFields, Error, CommandRequirements> =>
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
    const log = yield* loopLogPath
    return beatFields({
      rendered,
      kind,
      idle: restIsIdle(rest),
      log,
      ...(session !== undefined
        ? { session: { id: session.sessionId, resume: session.resume } }
        : {}),
      ...(validate !== undefined ? { validate } : {}),
      changes: computeStatusChanges(rest.on, rest.changes),
      next: computeNextMatch(rest.on, rest.changes),
      cost: rest.context.processCost,
      costByModel: rest.context.processCostByModel,
    })
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

/**
 * Dispatches to the named `run*Command` handler for every `Command.kind` —
 * the counterpart of `Cli.ts`'s `parseArgv`, which has already validated
 * every field a handler receives. `json`/`sh` reach `runLandCommand`/
 * `runNextCommand` alone — `Cli.ts`'s flag scopes guarantee both are `false`
 * for every other kind, so no other handler needs to see them. A command
 * choosing its own exit code is unrepresentable: every branch returns
 * `Effect<void>`, and `Cli.ts`'s `runCli` supplies `EXIT_OK` once, after
 * this Effect succeeds — the same move that keeps `--version`/`--help` out
 * of the `Command` union.
 */
// fallow-ignore-next-line complexity
const dispatchVoidCommand = (
  command: Command,
  json: boolean,
  sh: boolean,
  out: ArtifactOut,
): Effect.Effect<void, Error, CommandRequirements> => {
  switch (command.kind) {
    case "lsp":
      return runLspCommand()
    case "init":
      return runInitCommand(out)
    case "visualize":
      return runVisualizeCommand(command.port, command.open, out)
    case "land":
      return runLandCommand(
        {
          ...(command.cost !== undefined ? { cost: command.cost } : {}),
          ...(command.model !== undefined ? { model: command.model } : {}),
        },
        json,
        sh,
        out,
      )
    case "entry":
      return runEntryCommand(command.actor, command.state, command.vars, out, command.label)
    case "abandon":
      return runAbandonCommand(out)
    case "restore":
      return runRestoreCommand(out)
    case "next":
      return runNextCommand(json, sh, out)
    case "validate":
      return runValidateCommand(out)
    case "check":
      return runCheckCommand(command.mode, command.file, command.openQuestions ?? false)
    case "install":
      return runInstallCommand(out)
  }
}

/**
 * The one entry point `Cli.ts`'s `runCli` calls for a resolved `Command`:
 * dispatches to the matching `run*Command` handler (see
 * `dispatchVoidCommand`), wrapped in the repo-root-and-commit guard exactly
 * when `needsOf(command.kind) === "state"` — `lsp`/`init`/`visualize`/`check`
 * (the `standaloneKinds`) run bare. `Cli.ts` has already validated every
 * field on `command` (arity, flag scope, decoding), so nothing here
 * re-parses argv. Returns nothing: every command exits `EXIT_OK` on success
 * now, uniformly — `Cli.ts`'s `runCli` supplies it once, after this Effect
 * succeeds; whose turn is next lives in `gtd next --json`'s own `kind`
 * field, never in the process exit code.
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
  sh: boolean,
  out: ArtifactOut,
): Effect.Effect<void, Error, CommandRequirements> => {
  const dispatch = dispatchVoidCommand(command, json, sh, out)
  if (needsOf(command.kind) !== "state") return dispatch
  return Effect.gen(function* () {
    const git = yield* GitService
    const fs = yield* FileSystem.FileSystem
    yield* assertRunningFromRepoRoot(git, fs)
    yield* assertRepositoryHasCommits(git)
    yield* dispatch
  })
}

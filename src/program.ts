import { join } from "node:path"
import { FileSystem } from "@effect/platform"
import { Effect, Either, Option, Runtime } from "effect"
import type { Command, Needs } from "./Cli.js"
import { configPresentAt, ConfigService } from "./Config.js"
import { renderInitScaffold } from "./workflows/templates.js"
import { Cwd } from "./Cwd.js"
import { EnvVars } from "./EnvVars.js"
import { WorktreeReader } from "./WorktreeReader.js"
import { GitService, type GitOperations } from "./Git.js"
import {
  buildTemplateContext,
  computeProcessRun,
  executeDecision,
  memoryKeyFor,
  pendingChanges,
  renderFile,
  renderLabel,
  renderModel,
  renderOnEdges,
  renderRest,
  resolveRest,
  resolveVars,
  retainsNothing,
  toTemplateEdges,
  UNATTRIBUTED_MODEL,
  withRenderedOn,
  withEntryTrailers,
  type ExecutableDecision,
  type ModelCost,
  type ProcessRun,
  type RenderedRest,
  type ResolvedRest,
} from "./Edge.js"
import {
  closeReviewWindow,
  openReviewWindow,
  reviewBaseHash,
  REVIEW_HEAD_REF,
} from "./ReviewWindow.js"
import {
  clearRetainedHistory,
  readRetainedHistory,
  restorability,
  retainHistory,
} from "./RetainedHistory.js"
import { startLspServer } from "./Lsp.js"
import {
  buildCurrentStateModel,
  buildVizModel,
  openInBrowser,
  startVizServer,
  type CurrentStateModel,
  type VizModel,
} from "./Visualize.js"
import {
  formatAndValidateSteeringFile,
  resolveSteeringMode,
  unknownModeMessage,
} from "./SteeringMode.js"
import {
  enterableStates,
  entryBaseTemplateOf,
  initialStateOf,
  isAnswerGateState,
  isRequireProgressState,
  isReviewWindowState,
  matchesPattern,
  parsePattern,
  parseStateSubject,
  stateSubject,
  step,
  type OnEdge,
  type PendingChange,
  type StepRefusal,
} from "./PatternMachine.js"
import { parseOpenQuestions } from "./OpenQuestions.js"
import { renderStateTemplate, varsOnlyContext, type TemplateContext } from "./PatternTemplates.js"

export type CommandRequirements =
  | GitService
  | FileSystem.FileSystem
  | ConfigService
  | Cwd
  | WorktreeReader
  | EnvVars

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
 * warns to commit it before the first `gtd step` (an uncommitted config
 * counts as a pending change the initial state's `* **` edge would otherwise
 * capture).
 */
const runInitCommand = (
  json: boolean,
  write: (chunk: string) => void,
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
    if (json) {
      write(JSON.stringify({ written: ".gtdrc.json", inRepo }) + "\n")
    } else {
      const wrote =
        `Wrote .gtdrc.json seeding the default variables (the test command) and a\n` +
        `Prettier formatting suggestion. gtd runs its built-in workflow by default — add\n` +
        `a workflow: key only if you want to customize the machine itself.\n\n`
      const nextSteps = inRepo
        ? `Review and commit it before starting: an uncommitted .gtdrc.json counts as a\n` +
          `pending change, so the initial state would capture it on the first step. Once\n` +
          `committed, run \`gtd step human\` to begin.\n`
        : `This directory is not a git repository, so there is nothing to commit here. The\n` +
          `config applies to any gtd repository nested below it — gtd discovers it by\n` +
          `walking up from the repository root. Run \`gtd step human\` from such a repo to\n` +
          `begin.\n`
      write(wrote + nextSteps)
    }
  })

/** Render a state's `on` edges against `vars` (see `renderOnEdges`), surfacing a malformed pattern template as a plain command error, exactly like a content render failure. */
const renderOnEdgesOrFail = (
  onEdges: readonly OnEdge[] | undefined,
  vars: Record<string, string>,
): Effect.Effect<readonly OnEdge[], Error> =>
  Effect.try({
    try: () => renderOnEdges(onEdges, vars),
    catch: (e) => (e instanceof Error ? e : new Error(String(e))),
  })

/**
 * Resolve HEAD's rest, the current process run, and the template context for
 * rendering that rest's OWN state/actor — the common prefix shared by `gtd
 * next` and `gtd status` (each fetches `git` itself first, since
 * `gtd status` also needs it for `pendingChanges`; `stepAsActor`'s squash
 * path renders a DIFFERENT state, so it builds its own context inline
 * instead of sharing this helper). `renderedOn` is the resting state's `on`
 * edges already rendered against `it.vars` (`renderOnEdges`) — `next`/`status`
 * reuse it instead of re-rendering the same patterns themselves. `memory` is
 * the COMPUTED memory key (`memoryKeyFor`, package 05/06) for this rest —
 * `undefined` for a non-`prompt` rest or when no scope resolves — computed
 * once here (against the loaded config's `stateScopes`) rather than by each
 * caller separately.
 */
const resolveRestContext = (
  git: GitOperations,
): Effect.Effect<
  {
    readonly rest: ResolvedRest
    readonly run: ProcessRun
    readonly context: TemplateContext
    readonly renderedOn: readonly OnEdge[]
    readonly memory: string | undefined
  },
  Error,
  GitService | ConfigService | WorktreeReader | EnvVars
> =>
  Effect.gen(function* () {
    const config = yield* (yield* ConfigService).load
    const worktree = yield* WorktreeReader
    const envVars = yield* EnvVars
    const rest = yield* resolveRest()
    const run = yield* computeProcessRun(git, rest.def)
    const vars = resolveVars(config.workflowVars, config.rcVars, run.entryVars, envVars.all)
    const renderedOn = yield* renderOnEdgesOrFail(rest.stateDef.on, vars)
    const reviewBase = yield* reviewBaseHash(git, rest.def, run)
    const context = yield* buildTemplateContext(
      git,
      worktree.read,
      rest.state,
      rest.actor,
      run,
      vars,
      renderedOn,
      0,
      undefined,
      reviewBase,
    )
    const memory = memoryKeyFor(config.stateScopes, rest, run)
    return { rest, run, context, renderedOn, memory }
  })

/** The user-facing message for a `step` refusal — out-of-turn names the awaited actor, no-match names every declared pattern. */
const formatStepRefusal = (invoker: string, refusal: StepRefusal): string =>
  refusal.reason === "out-of-turn"
    ? `gtd step ${invoker}: out of turn — "${refusal.state}" awaits ${refusal.awaits}`
    : `gtd step ${invoker}: no declared pattern matches the pending changes at "${refusal.state}" — declared patterns: ${
        refusal.patterns.length > 0 ? refusal.patterns.join(", ") : "(none)"
      }`

/**
 * Authenticate `invoker` against the resolved rest and perform the one
 * resulting transition (commit or squash) for `gtd step`.
 * Refusals fail the Effect with a formatted message; a no-op returns
 * `subject: null` rather than failing (exit zero, per the plan's "clean
 * no-op exits zero").
 */
const stepAsActor = (
  invoker: string,
  cost?: number,
  model?: string,
): Effect.Effect<
  {
    readonly state: string
    readonly subject: string | null
    readonly cost: number | null
    readonly model: string | null
  },
  Error,
  CommandRequirements
> =>
  // fallow-ignore-next-line complexity
  Effect.gen(function* () {
    const git = yield* GitService
    const config = yield* (yield* ConfigService).load
    const worktree = yield* WorktreeReader
    const envVars = yield* EnvVars
    const rest = yield* resolveRest()
    const run = yield* computeProcessRun(git, rest.def)
    const changes = yield* pendingChanges(git)
    const vars = resolveVars(config.workflowVars, config.rcVars, run.entryVars, envVars.all)
    const renderedOn = yield* renderOnEdgesOrFail(rest.stateDef.on, vars)
    const decision = step(withRenderedOn(rest.def, rest.state, renderedOn), rest.state, invoker, {
      changes,
      // `StepPayload.processTrace` stays `readonly StateName[]` — the pure
      // engine's retry-entry counting (`applyRetry`) only ever compares state
      // NAMES, never commit hashes, so widening it to carry `TraceEntry`s
      // (added to `ProcessRun.trace` for `memoryKeyFor`, package 05/06) would
      // just churn every `step` test that builds a payload for data the
      // engine never reads.
      processTrace: run.trace.map((entry) => entry.state),
    })

    if (decision.kind === "refusal") {
      return yield* Effect.fail(new Error(formatStepRefusal(invoker, decision)))
    }

    if (decision.kind === "noop") {
      return { state: decision.state, subject: null, cost: null, model: null }
    }

    const executable: ExecutableDecision = decision
    const renderedState = decision.kind === "squash" ? decision.state : rest.state
    const renderedStateOn =
      renderedState === rest.state
        ? renderedOn
        : yield* renderOnEdgesOrFail(rest.def.states[renderedState]?.on, vars)
    const reviewBase = yield* reviewBaseHash(git, rest.def, run)
    const context = yield* buildTemplateContext(
      git,
      worktree.read,
      renderedState,
      invoker,
      run,
      vars,
      renderedStateOn,
      cost ?? 0,
      model,
      reviewBase,
    )
    // Steering-file gate: before capturing a normal turn, format the rest
    // state's steering file in place and validate it — so whoever just acted
    // (a producing agent OR a human editing at a gate) hands the next rest a
    // tidy, well-formed file. Invalid content refuses the step (see the helper,
    // which no-ops for a squash and when there is nothing to validate).
    yield* enforceSteeringGate(worktree.read, invoker, rest, context, decision.kind)
    // Review sign-off gate (edge): refuse a deleted review doc or an unfinished
    // review with no comment before either can commit (see the helper).
    yield* enforceReviewSignoffGate(worktree.read, invoker, rest, context, changes, decision.kind)
    // Feedback-progress gate (edge): at a `requireProgress` state, refuse a
    // work-free turn that just deletes the instructions file (the "captured
    // then silently discarded" bug), exempting a NOTHING ACTIONABLE sentinel.
    yield* enforceFeedbackProgressGate(invoker, rest, context, changes, decision.kind)
    // Answer-completeness gate (edge): at an `answerGate` qa state, refuse a
    // human step while any open question is not answered (exactly one tick each)
    // — the advanced flow's product-answer/technical-answer gates.
    yield* enforceAnswerCompletenessGate(worktree.read, invoker, rest, context, decision.kind)
    if (decision.kind === "commit") {
      const target = parseStateSubject(decision.subject)?.state
      if (
        target === initialStateOf(rest.def) &&
        run.startParentHash !== EMPTY_TREE &&
        (yield* retainsNothing(git, run, changes))
      ) {
        // A process that returns to its initial state having kept nothing (a
        // green `gtd --entry fix-precheck`: an empty entry commit + a green
        // check that changed nothing) leaves no useful history — mixed-reset
        // past its commits like `gtd abandon` rather than committing a
        // `→ idle` turn, so a
        // no-op probe never dirties the log. Pure engine is oblivious; this is
        // an edge concern like the review window and the steering gate.
        const tip = yield* git.resolveRef("HEAD")
        yield* retainHistory(git, tip, run.startParentHash)
        yield* git.mixedResetTo(run.startParentHash)
        return { state: target, subject: null, cost: null, model: null }
      }
    }
    const outcome = yield* executeDecision(git, run, executable, context, cost, model)
    return {
      state: rest.state,
      subject: outcome.kind === "noop" ? null : outcome.subject,
      cost: cost ?? null,
      model: model ?? null,
    }
  })

/** Renders `stepAsActor`'s result for `gtd step`. */
const reportStepResult = (
  result: {
    readonly state: string
    readonly subject: string | null
    readonly cost: number | null
    readonly model: string | null
  },
  json: boolean,
  write: (chunk: string) => void,
): void => {
  if (json) {
    write(
      JSON.stringify({
        state: result.state,
        subject: result.subject,
        ...(result.cost !== null ? { cost: result.cost } : {}),
        ...(result.model !== null ? { model: result.model } : {}),
      }) + "\n",
    )
  } else {
    write(
      result.subject !== null
        ? `committed: ${result.subject}\n`
        : `nothing to do at "${result.state}"\n`,
    )
  }
}

/**
 * `gtd step <actor> [--cost=<n>] [--model=<name>]`: authenticate as `<actor>`
 * and perform the one resulting transition, recording `--cost`/`--model` as a
 * `Gtd-Cost:` trailer. `--entry <state>` no longer nests inside this handler —
 * `Cli.ts`'s `--entry` selector resolves that combination to its own
 * `"entry"` command kind (see `runEntryCommand`) before `runCommand` ever
 * dispatches here, so a `step` `Command` is always the ordinary pattern-
 * matched step.
 */
const runStepCommand = (
  actor: string,
  cost: number | undefined,
  model: string | undefined,
  json: boolean,
  write: (chunk: string) => void,
): Effect.Effect<void, Error, CommandRequirements> =>
  Effect.gen(function* () {
    const result = yield* stepAsActor(actor, cost, model)
    reportStepResult(result, json, write)
  })

/**
 * `gtd step <actor> --entry <state> [--var <name>=<value> ...]` (or its
 * subcommand-less short form `gtd --entry <state> ...`, `actor` defaulting to
 * `human` there — see `Cli.ts`'s `--entry` selector): start a brand NEW process at `<state>`
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
 * carries at the moment of entry, exactly like an ordinary `gtd step`
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
  json: boolean,
  write: (chunk: string) => void,
  commandLabel: string,
): Effect.Effect<void, Error, GitService | ConfigService | EnvVars> =>
  // fallow-ignore-next-line complexity
  Effect.gen(function* () {
    const git = yield* GitService
    const config = yield* (yield* ConfigService).load
    const envVars = yield* EnvVars
    const rest = yield* resolveRest()
    if (rest.state !== initialStateOf(rest.def)) {
      return yield* Effect.fail(
        new Error(
          `${commandLabel}: a process is already underway (resting at "${rest.state}") — finish it, or run \`gtd abandon\`, before entering`,
        ),
      )
    }

    const enterable = enterableStates(rest.def)
    if (!enterable.includes(entryState)) {
      return yield* Effect.fail(
        new Error(
          `${commandLabel}: "${entryState}" is not an enterable state — enterable states:\n${enterable
            .map((s) => `  ${s}`)
            .join("\n")}`,
        ),
      )
    }

    const declaredNames = Object.keys({ ...config.workflowVars, ...config.rcVars })
    const undeclared = Object.keys(varOverrides).filter((name) => !declaredNames.includes(name))
    if (undeclared.length > 0) {
      return yield* Effect.fail(
        new Error(
          `${commandLabel}: --var name(s) not declared by this workflow: ${undeclared.join(
            ", ",
          )} — declared: ${declaredNames.length > 0 ? declaredNames.join(", ") : "(none)"}`,
        ),
      )
    }

    const vars = resolveVars(config.workflowVars, config.rcVars, varOverrides, envVars.all)

    let base: string | undefined
    const baseTemplate = entryBaseTemplateOf(rest.def, entryState)
    if (baseTemplate !== undefined) {
      const rendered = yield* Effect.try({
        try: () => renderStateTemplate(baseTemplate, varsOnlyContext(vars, entryState)),
        catch: (e) => new Error(`${commandLabel}: ${e instanceof Error ? e.message : String(e)}`),
      })
      if (rendered.trim() === "") {
        const refs = Array.from(
          new Set(Array.from(baseTemplate.matchAll(/it\.vars\.(\w+)/g)).map((m) => m[1]!)),
        )
        return yield* Effect.fail(
          new Error(
            `${commandLabel}: "${entryState}"'s reviewBase template rendered blank — template: ${JSON.stringify(
              baseTemplate,
            )}; it.vars references: ${
              refs.length > 0 ? refs.map((r) => `it.vars.${r}`).join(", ") : "(none found)"
            }`,
          ),
        )
      }
      const resolvedBase = yield* git
        .resolveRef(rendered)
        .pipe(
          Effect.mapError(
            () => new Error(`${commandLabel}: "${rendered}" does not resolve to a commit`),
          ),
        )
      const isBaseAncestor = yield* git.isAncestor(resolvedBase, "HEAD")
      if (!isBaseAncestor) {
        return yield* Effect.fail(
          new Error(`${commandLabel}: "${rendered}" is not an ancestor of HEAD`),
        )
      }
      const headHash = yield* git.resolveRef("HEAD")
      if (resolvedBase === headHash) {
        return yield* Effect.fail(
          new Error(`${commandLabel}: "${rendered}" is HEAD — nothing to review`),
        )
      }
      base = resolvedBase
    }

    const subject = stateSubject(actor, entryState)
    yield* git.commitAllWithPrefix(
      withEntryTrailers(subject, { ...(base !== undefined ? { base } : {}), vars: varOverrides }),
    )
    if (json) {
      write(JSON.stringify({ state: entryState, subject }) + "\n")
    } else {
      write(`committed: ${subject}\n`)
    }
  })

// git's empty-tree object — `computeProcessRun`'s `startParentHash` when the
// process covers the whole history, so there is no earlier commit to rewind to.
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

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
 */
const runAbandonCommand = (
  json: boolean,
  write: (chunk: string) => void,
): Effect.Effect<void, Error, GitService | ConfigService> =>
  Effect.gen(function* () {
    const git = yield* GitService
    const config = yield* (yield* ConfigService).load
    const def = config.workflow
    const initial = initialStateOf(def)
    const run = yield* computeProcessRun(git, def)
    if (run.trace.length === 0) {
      if (json) {
        write(JSON.stringify({ state: initial, abandoned: false }) + "\n")
      } else {
        write(`no gtd process is underway (resting at "${initial}") — nothing to abandon\n`)
      }
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

    const tip = yield* git.resolveRef("HEAD")
    yield* retainHistory(git, tip, run.startParentHash)

    yield* git.mixedResetTo(run.startParentHash)
    const subject = yield* git.lastCommitSubject()
    if (json) {
      write(
        JSON.stringify({
          state: initial,
          abandoned: true,
          from: restState,
          head: run.startParentHash,
        }) + "\n",
      )
    } else {
      write(
        `abandoned the process resting at "${restState}" — HEAD is back at ` +
          `${run.startParentHash.slice(0, 7)} ("${subject}"), resting at "${initial}".\n` +
          `Everything the process produced is kept as uncommitted changes (\`git status\`); ` +
          `discard them with \`git checkout -- . && git clean -fd .gtd\` for a clean tree.\n`,
      )
    }
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
 * lost by resetting.
 */
const runRestoreCommand = (
  json: boolean,
  write: (chunk: string) => void,
): Effect.Effect<void, Error, GitService | ConfigService> =>
  Effect.gen(function* () {
    const git = yield* GitService

    const changes = yield* pendingChanges(git)
    if (changes.length > 0) {
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

    const before = yield* resolveRest()
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

    yield* git.hardResetTo(tip)
    yield* clearRetainedHistory(git)

    const after = yield* resolveRest()
    const subject = yield* git.lastCommitSubject()

    if (json) {
      write(
        JSON.stringify({ state: after.state, restored: true, to: tip, from: before.state }) + "\n",
      )
    } else {
      write(
        `restored the retained history — HEAD is back at ${tip.slice(0, 7)} ("${subject}"), ` +
          `resting at "${after.state}". Resume with the loop, or \`git reset\` to any earlier ` +
          `turn to restart from there.\n`,
      )
    }
  })

/**
 * The self-validation instruction gtd APPENDS to a `prompt` rest that declares
 * both `file:` and `mode:` — i.e. a state whose actor hands over a steering
 * file `gtd validate` formats and checks. Appended ONLY to plain `gtd next`
 * output (for a human or a simple driver who reads the prompt and hands it to
 * an agent, so the agent self-validates); withheld from `gtd next --json`,
 * where the driving loop instead runs `gtd validate` after the turn and
 * re-prompts on findings (see the `bin/gtd` loop driver). This is
 * advisory: `gtd step` runs the same format-and-validate gate and REFUSES a
 * turn whose steering file is invalid (see `stepAsActor`), so a malformed file
 * is never captured whether or not this instruction was followed.
 */
const selfValidateInstruction = (file: string): string =>
  `\nBefore finishing your turn, run \`gtd validate\` — it formats and checks ` +
  `${file} — and fix every violation it reports until it exits cleanly. Do not ` +
  `finish while it still reports violations.\n`

/** True when a rendered rest is a `prompt` turn that hands over a validatable steering file (`file:`+`mode:` both declared). */
const emitsValidatablePrompt = (rendered: RenderedRest): boolean =>
  rendered.kind === "prompt" && rendered.file !== undefined && rendered.mode !== undefined

/** `gtd next [--json]`: pure emitter of the resolved rest's rendered content (no mutation). */
/** `gtd next --json`'s single-line object — omitting each optional key (never `null`-valued) when its source is unset, exactly like `gtd status --json`. */
const nextJsonOutput = (rendered: RenderedRest): string =>
  JSON.stringify({
    state: rendered.state,
    actor: rendered.actor,
    kind: rendered.kind,
    content: rendered.content,
    ...(rendered.model !== undefined ? { model: rendered.model } : {}),
    ...(rendered.memory !== undefined ? { memory: rendered.memory } : {}),
    ...(rendered.label !== undefined ? { label: rendered.label } : {}),
    ...(rendered.file !== undefined ? { file: rendered.file } : {}),
    ...(rendered.mode !== undefined ? { mode: rendered.mode } : {}),
    ...(rendered.edges.length > 0 ? { edges: rendered.edges } : {}),
  }) + "\n"

/** `gtd next`'s plain-text output: the rendered content (newline-terminated), plus the self-validation instruction when the rest is a validatable prompt (see `emitsValidatablePrompt`). */
const nextPlainOutput = (rendered: RenderedRest): string => {
  const base = rendered.content.endsWith("\n") ? rendered.content : rendered.content + "\n"
  return emitsValidatablePrompt(rendered) ? base + selfValidateInstruction(rendered.file!) : base
}

const runNextCommand = (
  json: boolean,
  write: (chunk: string) => void,
): Effect.Effect<void, Error, GitService | ConfigService | WorktreeReader | EnvVars> =>
  Effect.gen(function* () {
    const git = yield* GitService
    const { rest, context, memory } = yield* resolveRestContext(git)
    const rendered = yield* renderRest(rest, context, memory)
    write(json ? nextJsonOutput(rendered) : nextPlainOutput(rendered))
  })

/** Format the resolved state's steering file (in place) then validate it. */
interface SteeringCheck {
  /** The rendered `file:` path, or `undefined` when the state declares no `file:`/`mode:`. */
  readonly file: string | undefined
  /** True when a steering file was actually present and got formatted + validated (false when the state declares none, or the file is absent — a deletion). */
  readonly present: boolean
  /** The parser findings (empty when `present` is false). */
  readonly errors: readonly string[]
}

/**
 * Format the resolved rest's steering file in place, then validate its
 * formatted contents. When the state declares both `file:` and `mode:` and
 * that file exists in the working tree, the mode's format-then-validate pair
 * runs over it — each half resolved independently from the `modes:` map and
 * gtd's built-in `qa`/`review` validators beneath it (see
 * `src/SteeringMode.ts`). `present` is false — and nothing is
 * formatted or validated — when the state declares no steering file, or the
 * file is absent (e.g. `building` deleted `.gtd/TODO.md`, or a human deleted
 * `.gtd/REVIEW.md` to approve), so those flows pass cleanly. Shared by
 * `gtd validate` and the `gtd step` capture gate, so both format and check the
 * SAME way — an agent's fresh draft and a human's edit are treated alike.
 */
const formatAndCheckSteeringFile = (
  worktreeRead: (path: string) => string,
  rest: ResolvedRest,
  context: TemplateContext,
): Effect.Effect<SteeringCheck, Error, FileSystem.FileSystem | Cwd> =>
  Effect.gen(function* () {
    const file = yield* renderFile(rest.stateDef, context)
    const mode = rest.stateDef.mode
    if (file === undefined || mode === undefined) return { file, present: false, errors: [] }
    const fs = yield* FileSystem.FileSystem
    if (!(yield* fs.exists(file))) return { file, present: false, errors: [] }
    const resolved = resolveSteeringMode(rest.def, mode)
    if (resolved === undefined) {
      // `validateDefinition` rejects an unresolvable `mode:` at load time, so
      // this is a defensive branch, not a reachable config path.
      return yield* Effect.fail(new Error(unknownModeMessage(rest.def, rest.state, mode)))
    }
    const { root } = yield* Cwd
    const errors = yield* formatAndValidateSteeringFile(
      resolved,
      file,
      () => worktreeRead(file),
      context,
      root,
    )
    return { file, present: true, errors }
  })

/**
 * The `gtd step` capture gate: format + validate the rest state's steering file
 * (see `formatAndCheckSteeringFile`) and FAIL with the findings when it is
 * invalid, so a malformed steering file — an agent's draft or a human's edit —
 * is never committed. A no-op when there is nothing to validate.
 */
const enforceSteeringGate = (
  worktreeRead: (path: string) => string,
  invoker: string,
  rest: ResolvedRest,
  context: TemplateContext,
  kind: ExecutableDecision["kind"],
): Effect.Effect<void, Error, FileSystem.FileSystem | Cwd> =>
  Effect.gen(function* () {
    // Only a normal commit captures the rest state's steering file; a squash
    // discards it, and a no-op writes nothing.
    if (kind !== "commit") return
    const gate = yield* formatAndCheckSteeringFile(worktreeRead, rest, context)
    if (gate.errors.length > 0) {
      return yield* Effect.fail(
        new Error(
          `gtd step ${invoker}: ${gate.file} is not valid at "${rest.state}" — fix these before stepping:\n${gate.errors
            .map((e) => `  - ${e}`)
            .join("\n")}`,
        ),
      )
    }
  })

/** The `mode:` name of gtd's built-in REVIEW.md checkbox validator — the only mode the sign-off gate below understands. */
const REVIEW_MODE = "review"

/** Normalize every markdown checkbox to a single placeholder so a pure `[ ]`→`[x]` tick is invisible to a text comparison; any surviving difference is a human note. */
const normalizeCheckboxes = (content: string): string => content.replace(/\[[ xX]\]/g, "[_]")

/** The verdict of the pure `classifyReviewSignoff` — `allow` lets the step commit, `refuse` fails it with `reason`. */
export type ReviewSignoffVerdict =
  | { readonly kind: "allow" }
  | { readonly kind: "refuse"; readonly reason: string }

/**
 * The PURE core of the review sign-off gate (see `enforceReviewSignoffGate`).
 * Given the agent's `original` review doc, the reviewer's `current` copy,
 * whether a non-`.gtd/` file changed this step (`hasCodeChange`), and whether
 * the doc was deleted (`reviewDocDeleted`), decide whether the step may commit.
 * A comment — a code edit, or a note (the doc differs beyond a `[ ]`→`[x]` tick)
 * — is always allowed (it becomes a feedback round). Two dead ends refuse: a
 * deleted doc, and an all-tick-flip step that still leaves a box unticked with
 * no comment (an unfinished review). Kept separate from the Effect so it is
 * directly unit-tested (see program.test.ts).
 */
export const classifyReviewSignoff = (input: {
  readonly file: string
  readonly stateName: string
  readonly invoker: string
  readonly reviewDocDeleted: boolean
  readonly hasCodeChange: boolean
  readonly original: string
  readonly current: string
}): ReviewSignoffVerdict => {
  if (input.reviewDocDeleted) {
    return {
      kind: "refuse",
      reason: `gtd step ${input.invoker}: ${input.file} was deleted at "${input.stateName}" — restore it and tick the boxes to sign off, or leave a note (or edit code) to request changes.`,
    }
  }
  // A comment — a code edit, or a note (doc differs beyond a checkbox flip) — is
  // a feedback round; let it commit.
  if (input.hasCodeChange) return { kind: "allow" }
  if (normalizeCheckboxes(input.original) !== normalizeCheckboxes(input.current)) {
    return { kind: "allow" }
  }
  // Only checkbox flips, no comment: a sign-off needs EVERY box ticked.
  const unticked = input.current.match(/^[ \t]*-[ \t]*\[[ \t]*\]/gm)?.length ?? 0
  if (unticked > 0) {
    return {
      kind: "refuse",
      reason: `gtd step ${input.invoker}: ${unticked} review item(s) still unticked and no comment at "${input.stateName}" — finish reviewing (tick every box), or leave a note (or edit code) to request a change.`,
    }
  }
  return { kind: "allow" }
}

/**
 * The review sign-off gate (edge, not engine — like the review window it lives
 * at `src/program.ts`, and the pure `PatternMachine.step` never sees it). At a
 * review gate (a `reviewWindow: true` state with `mode: review`, i.e. the
 * unified template's `await-review`), the ROUTING is uniform — every human step
 * goes to `review-deciding`, which decides sign-off vs. feedback from the step's
 * content. But two content-shaped dead ends a file-pattern edge can't
 * distinguish must never commit, so this gate gathers the step's shape and hands
 * it to the pure `classifyReviewSignoff` BEFORE `executeDecision`, failing on a
 * `refuse` verdict. A no-op when the state is not a review gate, or the decision
 * is a squash/no-op.
 */
const enforceReviewSignoffGate = (
  worktreeRead: (path: string) => string,
  invoker: string,
  rest: ResolvedRest,
  context: TemplateContext,
  changes: readonly PendingChange[],
  kind: ExecutableDecision["kind"],
): Effect.Effect<void, Error, FileSystem.FileSystem | Cwd | GitService> =>
  Effect.gen(function* () {
    if (kind !== "commit") return
    if (!isReviewWindowState(rest.def, rest.state) || rest.stateDef.mode !== REVIEW_MODE) return
    const file = yield* renderFile(rest.stateDef, context)
    if (file === undefined) return

    const git = yield* GitService
    const original = yield* git
      .readFileAtRef("HEAD", file)
      .pipe(Effect.catchAll(() => Effect.succeed("")))
    const current = yield* Effect.try(() => worktreeRead(file)).pipe(
      Effect.catchAll(() => Effect.succeed("")),
    )
    const verdict = classifyReviewSignoff({
      file,
      stateName: rest.state,
      invoker,
      reviewDocDeleted: changes.some((c) => c.path === file && c.status === "D"),
      hasCodeChange: changes.some((c) => !c.path.startsWith(".gtd/")),
      original,
      current,
    })
    if (verdict.kind === "refuse") return yield* Effect.fail(new Error(verdict.reason))
  })

/** The one-line marker `feedback-collecting` writes when a review round left nothing actionable — the ONLY content that lets a `requireProgress` state's instructions file be deleted without a code change (see `classifyFeedbackProgress`). */
const NOTHING_ACTIONABLE_SENTINEL = "NOTHING ACTIONABLE"

/**
 * The PURE core of the feedback-progress gate (see `enforceFeedbackProgressGate`).
 * At a `requireProgress` state the `file` is an instruction list the agent must
 * ADDRESS, then delete. Refuse a turn that deletes the file while touching no
 * code (`hasCodeChange` false) — the "review feedback captured then silently
 * discarded" bug. Two escapes ALLOW the step: the file isn't being deleted (the
 * agent left work, or the list, in place), or there IS a code change alongside
 * (real work was done). The one delete-with-no-code exception is a
 * `NOTHING ACTIONABLE` sentinel (`deletedContent`): a legitimately
 * non-actionable round makes no code change by design. Kept separate from the
 * Effect so it is directly unit-tested (see program.test.ts).
 */
export const classifyFeedbackProgress = (input: {
  readonly file: string
  readonly stateName: string
  readonly invoker: string
  readonly changes: readonly PendingChange[]
  readonly deletedContent: string
}): ReviewSignoffVerdict => {
  const fileDeleted = input.changes.some((c) => c.path === input.file && c.status === "D")
  if (!fileDeleted) return { kind: "allow" }
  const hasCodeChange = input.changes.some((c) => !c.path.startsWith(".gtd/"))
  if (hasCodeChange) return { kind: "allow" }
  if (input.deletedContent.trim().startsWith(NOTHING_ACTIONABLE_SENTINEL)) return { kind: "allow" }
  return {
    kind: "refuse",
    reason: `gtd step ${input.invoker}: ${input.file} was deleted at "${input.stateName}" without addressing its instructions — implement the changes it lists (then delete it), don't just remove the file.`,
  }
}

/**
 * The feedback-progress gate (edge, like the sign-off gate above). At a
 * `requireProgress: true` state (the unified template's `feedback-building`), a
 * turn that just deletes the instructions file without doing the work it lists
 * is refused BEFORE it can commit — the pure `classifyFeedbackProgress` decides.
 * A no-op when the state is not a `requireProgress` state or the decision is a
 * squash/no-op. The committed (pre-deletion) file content — read once here —
 * feeds the sentinel exemption.
 */
const enforceFeedbackProgressGate = (
  invoker: string,
  rest: ResolvedRest,
  context: TemplateContext,
  changes: readonly PendingChange[],
  kind: ExecutableDecision["kind"],
): Effect.Effect<void, Error, FileSystem.FileSystem | Cwd | GitService> =>
  Effect.gen(function* () {
    if (kind !== "commit") return
    if (!isRequireProgressState(rest.def, rest.state)) return
    const file = yield* renderFile(rest.stateDef, context)
    if (file === undefined) return
    const git = yield* GitService
    const deletedContent = yield* git
      .readFileAtRef("HEAD", file)
      .pipe(Effect.catchAll(() => Effect.succeed("")))
    const verdict = classifyFeedbackProgress({
      file,
      stateName: rest.state,
      invoker,
      changes,
      deletedContent,
    })
    if (verdict.kind === "refuse") return yield* Effect.fail(new Error(verdict.reason))
  })

/** The `mode:` name of gtd's built-in open-questions checkbox format — the only mode the answer-completeness gate below acts on. */
const QA_MODE = "qa"

/** The verdict of the pure `classifyAnswerCompleteness` — `allow` lets the step commit, `refuse` fails it with `reason`. */
export type AnswerCompletenessVerdict =
  | { readonly kind: "allow" }
  | { readonly kind: "refuse"; readonly reason: string }

/**
 * The PURE core of the answer-completeness gate (see
 * `enforceAnswerCompletenessGate`). Parses the working-tree `content` of a
 * `qa`-mode file and refuses when any OPEN question is not answered — EXACTLY
 * ONE checkbox ticked, and (for a ticked free-text slot) non-empty text (see
 * `OpenQuestions.answered`). An open question with NO checkbox options is also
 * unanswered — a decision can't have been made on it. Zero remaining open
 * questions (the section was deleted, or the agent surfaced none) allows the
 * step: that is BOTH the tick-then-loop path and the clean advance / accept-all
 * escape. Kept separate from the Effect so it is directly unit-tested (see
 * program.test.ts).
 */
export const classifyAnswerCompleteness = (input: {
  readonly file: string
  readonly stateName: string
  readonly invoker: string
  readonly content: string
}): AnswerCompletenessVerdict => {
  const open = parseOpenQuestions(input.content).questions.filter((q) => q.status === "open")
  const unanswered = open.filter((q) => !q.answered)
  if (unanswered.length === 0) return { kind: "allow" }
  const list = unanswered.map((q) => `  - ${q.question}`).join("\n")
  return {
    kind: "refuse",
    reason: `gtd step ${input.invoker}: ${unanswered.length} open question(s) in ${input.file} not answered at "${input.stateName}" — tick exactly one option per question (or delete a question you don't want to answer, or delete the whole "## Open Questions" section to accept the plan as-is):\n${list}`,
  }
}

/**
 * The answer-completeness gate (edge, like the sign-off gate above). At an
 * `answerGate: true` state with `mode: qa` (the unified template's
 * `product-answer`/`technical-answer`), a human step is refused unless
 * every open question in the file is answered — the pure
 * `classifyAnswerCompleteness` decides over the WORKING-TREE contents. A no-op
 * when the state is not an answer gate (so the agent's own authoring step, which
 * writes all-unticked options, is never gated), the mode isn't `qa`, or the
 * decision is a squash/no-op.
 */
const enforceAnswerCompletenessGate = (
  worktreeRead: (path: string) => string,
  invoker: string,
  rest: ResolvedRest,
  context: TemplateContext,
  kind: ExecutableDecision["kind"],
): Effect.Effect<void, Error, FileSystem.FileSystem | Cwd | GitService> =>
  Effect.gen(function* () {
    if (kind !== "commit") return
    if (!isAnswerGateState(rest.def, rest.state) || rest.stateDef.mode !== QA_MODE) return
    const file = yield* renderFile(rest.stateDef, context)
    if (file === undefined) return
    const current = yield* Effect.try(() => worktreeRead(file)).pipe(
      Effect.catchAll(() => Effect.succeed("")),
    )
    const verdict = classifyAnswerCompleteness({
      file,
      stateName: rest.state,
      invoker,
      content: current,
    })
    if (verdict.kind === "refuse") return yield* Effect.fail(new Error(verdict.reason))
  })

/**
 * `gtd validate [--json]`: format (in place) then validate the steering file
 * the resolved rest declares (`file:` rendered, `mode:` selecting how), over
 * its WORKING-TREE contents. A state with no `file:`/`mode:`, or an absent
 * file, has nothing to validate (exit 0). A clean verdict exits 0; violations
 * FAIL the Effect with the findings (one per line), so the process exits
 * non-zero — the signal a producing agent (or the driver) loops on until the
 * file is valid. A built-in mode reuses the canonical `OpenQuestions`/
 * `ReviewDoc` parsers (the same the LSP publishes), so there is one source of
 * truth per format and no bash port; any `modes:`-declared command runs
 * instead (or, for `format:`, in addition).
 */
const runValidateCommand = (
  json: boolean,
  write: (chunk: string) => void,
): Effect.Effect<void, Error, CommandRequirements> =>
  Effect.gen(function* () {
    const git = yield* GitService
    const worktree = yield* WorktreeReader
    const { rest, context } = yield* resolveRestContext(git)
    const { file, present, errors } = yield* formatAndCheckSteeringFile(
      worktree.read,
      rest,
      context,
    )
    if (!present) {
      if (json) write(JSON.stringify({ state: rest.state, valid: true, errors: [] }) + "\n")
      else write(`nothing to validate at "${rest.state}"\n`)
      return
    }
    if (errors.length === 0) {
      if (json) {
        write(
          JSON.stringify({
            state: rest.state,
            file,
            mode: rest.stateDef.mode,
            valid: true,
            errors: [],
          }) + "\n",
        )
      } else {
        write(`${file}: valid\n`)
      }
      return
    }
    return yield* Effect.fail(
      new Error(`${file} is not valid:\n${errors.map((e) => `  - ${e}`).join("\n")}`),
    )
  })

/** One pending change's status/path plus whichever declared `on` pattern (if any) matches it, for `gtd status`. */
interface StatusChange {
  readonly status: string
  readonly path: string
  readonly pattern: string | null
}

/** Which declared `on` pattern (if any) each pending change matches — the pure computation `gtd status` reports (both plain and `--json`). `onEdges` is ALREADY RENDERED against `it.vars` (`renderOnEdges`) — the reported pattern is the one a real `gtd step` would match against. */
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

/** The first declared `on` edge that WOULD fire for `gtd next`/`gtd step` right now, for `gtd status` to preview. */
interface NextMatch {
  readonly action: string | undefined
  readonly pattern: string
  readonly target: string
}

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

/** Builds `{[key]: value}` for each entry whose value isn't `undefined` — the shared "omit absent optional fields" shape behind both `writeStatusJson` and `writeStatusPlain`. */
const definedFields = (
  entries: readonly (readonly [string, unknown])[],
): Record<string, unknown> => {
  const result: Record<string, unknown> = {}
  for (const [key, value] of entries) if (value !== undefined) result[key] = value
  return result
}

/** `gtd status --json`'s `next` key — `null` on no match, else the matched edge's pattern/target plus its `action` when declared. */
const nextField = (
  next: NextMatch | null,
): { action?: string; pattern: string; target: string } | null =>
  next === null
    ? null
    : { ...definedFields([["action", next.action]]), pattern: next.pattern, target: next.target }

/** `gtd status`'s `Next:` line — the plain-text counterpart to `nextField`. */
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

/** `gtd status --json`'s emission — `{state, actor, changes, next, model?, memory?, label?, file?, mode?, cost?, costByModel?, edges?}`. `renderedOn` is the resting state's `on` edges already rendered against `it.vars` (`renderOnEdges`), so the emitted `edges[].pattern` carries the same rendered path as `changes[].pattern`. `next` is ALWAYS present (an object, or `null` on no match) — the headline conclusion, never omit-vs-null, same as `changes`. */
const writeStatusJson = (
  write: (chunk: string) => void,
  rest: ResolvedRest,
  statusChanges: readonly StatusChange[],
  renderedOn: readonly OnEdge[],
  next: NextMatch | null,
  model: string | undefined,
  memory: string | undefined,
  label: string | undefined,
  file: string | undefined,
  cost: number,
  costByModel: readonly ModelCost[],
): void => {
  const edges = toTemplateEdges(renderedOn)
  const hasCost = cost > 0
  write(
    JSON.stringify({
      state: rest.state,
      actor: rest.actor,
      changes: statusChanges,
      next: nextField(next),
      ...definedFields([
        ["model", model],
        ["memory", memory],
        ["label", label],
        ["file", file],
        ["mode", rest.stateDef.mode],
        ["cost", hasCost ? cost : undefined],
        ["costByModel", hasCost ? costByModel : undefined],
        ["edges", edges.length > 0 ? edges : undefined],
      ]),
    }) + "\n",
  )
}

/** `gtd status`'s plain-text emission — `State:`/`Awaits:`/`Label:`/`Model:`/`Memory:`/`File:`/`Mode:`/`Cost:`/`Pending:`/`Next:` lines. */
const writeStatusPlain = (
  write: (chunk: string) => void,
  rest: ResolvedRest,
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
  write(lines.join("\n") + "\n")
}

/** `gtd status`: pure dry-run reporter — the resolved state/actor, and which declared pattern (if any) each pending change matches. */
const runStatusCommand = (
  json: boolean,
  write: (chunk: string) => void,
): Effect.Effect<void, Error, GitService | ConfigService | WorktreeReader | EnvVars> =>
  Effect.gen(function* () {
    const git: GitOperations = yield* GitService
    const { rest, context, renderedOn, memory } = yield* resolveRestContext(git)
    const changes = yield* pendingChanges(git)
    const model = yield* renderModel(rest.stateDef, context)
    const label = yield* renderLabel(rest.stateDef, context)
    const file = yield* renderFile(rest.stateDef, context)
    const statusChanges = computeStatusChanges(renderedOn, changes)
    const next = computeNextMatch(renderedOn, changes)
    if (json) {
      writeStatusJson(
        write,
        rest,
        statusChanges,
        renderedOn,
        next,
        model,
        memory,
        label,
        file,
        context.processCost,
        context.processCostByModel,
      )
    } else {
      writeStatusPlain(
        write,
        rest,
        statusChanges,
        next,
        model,
        memory,
        label,
        file,
        context.processCost,
        context.processCostByModel,
      )
    }
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
): Effect.Effect<CurrentStateModel, Error, GitService | ConfigService | EnvVars> =>
  Effect.gen(function* () {
    const git: GitOperations = yield* GitService
    const config = yield* (yield* ConfigService).load
    const envVars = yield* EnvVars
    const reviewHead = yield* git.readRefOption(REVIEW_HEAD_REF)
    const currentRest = yield* resolveRest(Option.getOrUndefined(reviewHead))
    const run = yield* computeProcessRun(git, currentRest.def)
    const changes = yield* pendingChanges(git)
    const vars = resolveVars(config.workflowVars, config.rcVars, run.entryVars, envVars.all)
    const renderedOn = yield* renderOnEdgesOrFail(currentRest.stateDef.on, vars)
    const group = model.states.find((s) => s.name === currentRest.state)?.group
    return buildCurrentStateModel(currentRest, changes, renderedOn, group)
  })

/**
 * `gtd visualize`: serve an interactive diagram of the ACTIVE workflow on a
 * local HTTP server (see `src/Visualize.ts`). Its standalone `needs:
 * "config"` (see `Cli.ts`'s `needsOf`) means it skips the repo-root guard and
 * review-window bracket — it reads the config but never touches git, HEAD, or
 * the review window ITSELF (though its `/state.json` route best-effort reads
 * git state per request, see `computeCurrentState`). `--port`/`--no-open` are
 * already parsed by `Cli.ts`. `--json` prints the model and exits without
 * starting a server (the testable path; live state is a server-only concern,
 * so `--json`'s shape is unchanged).
 */
const runVisualizeCommand = (
  port: number,
  open: boolean,
  json: boolean,
  write: (chunk: string) => void,
): Effect.Effect<void, Error, GitService | ConfigService | EnvVars> =>
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

    if (json) {
      write(JSON.stringify(model, null, 2) + "\n")
      return
    }

    const runtime = yield* Effect.runtime<GitService | ConfigService | EnvVars>()
    const resolveCurrent = () =>
      Runtime.runPromise(runtime)(computeCurrentState(model).pipe(Effect.either)).then(
        Either.getOrNull,
      )

    const { server, url } = yield* Effect.tryPromise({
      try: () => startVizServer(model, port, "127.0.0.1", resolveCurrent),
      catch: (e) =>
        new Error(
          `gtd visualize: could not start server: ${e instanceof Error ? e.message : String(e)}`,
        ),
    })
    write(`gtd visualize running at ${url} — Ctrl-C to stop\n`)
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
 */
export const needsOf = (kind: Command["kind"]): Needs => {
  switch (kind) {
    case "lsp":
      return "none"
    case "init":
      return "fs"
    case "visualize":
      return "config"
    default:
      return "state"
  }
}

/** The three kinds that never touch the repo-root guard / review-window bracket — pinned so a new standalone kind can't be added silently. */
export const standaloneKinds = (): readonly Command["kind"][] => ["lsp", "init", "visualize"]

/** Dispatches to the named `run*Command` handler for every `Command.kind` — the counterpart of `Cli.ts`'s `parseArgv`, which has already validated every field a handler receives. */
// fallow-ignore-next-line complexity
const dispatchCommand = (
  command: Command,
  json: boolean,
  write: (chunk: string) => void,
): Effect.Effect<void, Error, CommandRequirements> => {
  switch (command.kind) {
    case "lsp":
      return runLspCommand()
    case "init":
      return runInitCommand(json, write)
    case "visualize":
      return runVisualizeCommand(command.port, command.open, json, write)
    case "step":
      return runStepCommand(command.actor, command.cost, command.model, json, write)
    case "entry":
      return runEntryCommand(command.actor, command.state, command.vars, json, write, command.label)
    case "abandon":
      return runAbandonCommand(json, write)
    case "restore":
      return runRestoreCommand(json, write)
    case "next":
      return runNextCommand(json, write)
    case "status":
      return runStatusCommand(json, write)
    case "validate":
      return runValidateCommand(json, write)
  }
}

/**
 * Runs `command` inside the bracket every state-touching command shares: the
 * repo-root guard, then close-any-open-review-window before the command sees
 * HEAD, then re-arm it afterward whether `command` succeeded or refused (see
 * `closeReviewWindow`/`openReviewWindow`).
 */
const runInReviewWindowBracket = (
  git: GitOperations,
  fs: FileSystem.FileSystem,
  command: Effect.Effect<void, Error, CommandRequirements>,
): Effect.Effect<void, Error, CommandRequirements> =>
  Effect.gen(function* () {
    yield* assertRunningFromRepoRoot(git, fs)
    // Restore the real HEAD before anything reads or mutates workflow state:
    // while a review checkout window is open (see src/ReviewWindow.ts), HEAD is
    // rewound to the review base, so the pure machine would otherwise resolve
    // against the wrong commit. Keyed on the ref alone — a no-op when no window
    // is open.
    //
    // Second, independent reason this must come BEFORE the subcommand runs:
    // the computed memory key (`memoryKeyFor`, package 05/06) is derived from
    // `ProcessRun.trace`, which is walked back from HEAD — while the window is
    // open, HEAD is rewound and the trace truncated, which would silently
    // resolve the wrong `entryIndex` (and so the wrong commit-anchored token)
    // rather than failing loudly.
    yield* closeReviewWindow

    // Re-arm the window after the subcommand — on success AND on refusal/error,
    // and after read-only commands too (every command opts into window
    // management), so the editor's diff view stays consistent no matter which
    // command the loop last ran. The subcommand's own error takes priority; a
    // re-arm failure only surfaces when the subcommand itself succeeded.
    const outcome = yield* Effect.either(command)
    const rearm = yield* Effect.either(openReviewWindow)
    if (Either.isLeft(outcome)) return yield* Effect.fail(outcome.left)
    if (Either.isLeft(rearm)) return yield* Effect.fail(rearm.left)
  })

/**
 * The one entry point `Cli.ts`'s `runCli` calls for a resolved `Command`:
 * dispatches to the matching `run*Command` handler (see `dispatchCommand`),
 * wrapped in the repo-root guard + review-window bracket exactly when
 * `needsOf(command.kind) === "state"` — `lsp`/`init`/`visualize` (the
 * `standaloneKinds`) run bare. `Cli.ts` has already validated every field on
 * `command` (arity, flag scope, decoding), so nothing here re-parses argv.
 */
export const runCommand = (
  command: Command,
  json: boolean,
  write: (chunk: string) => void,
): Effect.Effect<void, Error, CommandRequirements> => {
  const dispatch = dispatchCommand(command, json, write)
  if (needsOf(command.kind) !== "state") return dispatch
  return Effect.gen(function* () {
    const git = yield* GitService
    const fs = yield* FileSystem.FileSystem
    yield* runInReviewWindowBracket(git, fs, dispatch)
  })
}

import { join } from "node:path"
import { tmpdir } from "node:os"
import { FileSystem } from "@effect/platform"
import { Effect, Either, Option, Runtime } from "effect"
import type { ArtifactOut, Command, JsonMode, Needs } from "./Cli.js"
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
  currentRest,
  currentRun,
  planEntry,
  planStep,
  renderDecision,
  renderRest,
  restAt,
  reviewBaseFor,
  stalledAt,
  summaryRun,
  summaryTemplateContext,
  type ExecutableDecision,
  type Rest,
  type RenderedRest,
  type RestRequirements,
} from "./Edge.js"
import { buildSummary } from "./Summary.js"
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
import { enforceStepGuards } from "./StepGuards.js"
import { unansweredQuestions } from "./OpenQuestions.js"
import { clearFilePointerTicks } from "./ReviewDoc.js"
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
  noopText,
  renderBeatJson,
  renderBeatPlain,
  renderLandJson,
  renderLandPlain,
  type BeatFields,
  type BeatKind,
  type LandFields,
  type NextMatch,
  type StatusChange,
} from "./Beat.js"
import { renderModeCommand, type TemplateContext } from "./PatternTemplates.js"
import { deleteRef, hardResetTo, mixedResetTo, updateRef } from "./GitScript.js"
import { combinedScript, emitScripts, fileExistsGuard, type EmitStep } from "./Emit.js"
import {
  abandonedOutcome,
  abandonNoopOutcome,
  noteOutcome,
  restoredOutcome,
} from "./OutcomeScript.js"
import { loopLogPath } from "./WorktreeState.js"
import { renderBriefing } from "./Install.js"
import { selectPath } from "./Select.js"

/**
 * A command-level failure that should exit like a CLI usage error (2), not a
 * generic runtime failure (1) — currently only the `--json=<unknown-path>`
 * selector case.
 */
export class SelectorUsageError extends Error {}

/**
 * The `--json=<path>` select branch, shared by `runNextCommand` and
 * `runLandCommand` so the two never drift on the unknown-selector message: a
 * `value` writes its text plus exactly one trailing newline, `absent` writes
 * nothing (the caller's normal success path continues), and `unknown` fails
 * with `SelectorUsageError` (mapped to `EXIT_USAGE_ERROR` by `Cli.ts`'s
 * `report`).
 */
const writeSelection = (
  out: ArtifactOut,
  fields: BeatFields | LandFields,
  path: string,
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const selection = selectPath(fields, path)
    if (selection.kind === "value") {
      out.write(`${selection.text}\n`)
    } else if (selection.kind === "unknown") {
      return yield* Effect.fail(
        new SelectorUsageError(
          `gtd: unknown --json selector "${selection.path}" — see \`gtd --help\``,
        ),
      )
    }
  })

export type CommandRequirements =
  | GitService
  | FileSystem.FileSystem
  | ConfigService
  | Cwd
  | RepoFiles
  | CommandRunner
  | EnvVars
  | Narrator

/** `needs: "none"` skips the repo-root guard — the server is keyed on file name, not workflow state. */
const runLspCommand = (): Effect.Effect<void, Error> => startLspServer()

/** Emitted by the binary itself (`src/Install.ts`'s `renderBriefing()`) so it's always current. Writes nothing else; runs from any directory since it resolves no workflow state. */
const runInstallCommand = (out: ArtifactOut): Effect.Effect<void> =>
  Effect.sync(() => {
    const briefing = renderBriefing()
    out.write(briefing.endsWith("\n") ? briefing : briefing + "\n")
  })

/**
 * `gtd init`: scaffold a minimal `.gtdrc.json` seeding `vars.testCommand` and
 * a Prettier formatting suggestion — no `workflow:` key, since gtd's built-in
 * default runs whenever none is configured. Uses its own, more permissive
 * location check (`assertInitLocation`, which also allows a directory outside
 * any repository) rather than the shared repo-root guard, since it writes
 * `.gtdrc.json` at the root and refuses to clobber an existing config. The
 * file is left uncommitted, so the message warns to commit it before the
 * first `gtd land` (an uncommitted config would otherwise be captured as a
 * pending change by the initial state's own edge).
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
 * `planLanding`'s result — a preview of what `gtd land` would do, plus the
 * combined `script` the driver runs to do it. `script` is
 * `combinedScript(required, optional)`, computed once here so plain
 * `gtd land`'s stdout and `--json`'s `script` field stay byte-identical.
 */
interface LandResult {
  readonly state: StateName
  readonly subject: string | null
  readonly cost: number | null
  readonly model: string | null
  readonly script: string
  /** True for the one terminal shape: a no-op at a `script` rest. */
  readonly settled: boolean
  readonly idle: boolean
}

/**
 * Exactly one trailing newline — duplicated from `Cli.ts`'s own
 * `normalizeTrailingNewline` rather than imported, to avoid a circular value
 * dependency (`Cli.ts` already depends on this module). `LandResult.script`
 * must carry its own trailing newline because it's embedded verbatim inside
 * the `--json` document, never re-normalized at its tail.
 */
const normalizeScriptNewline = (script: string): string =>
  script.length === 0 ? script : `${script.replace(/\n+$/, "")}\n`

// git's empty-tree object — recognizes a process starting at the repository's
// very first commit (no earlier commit to rewind to).
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

/** True for a `"commit"` decision that is an ATTEMPT (`PatternMachine.StepCommit.attempt`) — the one flag `enforceStepGuards` bypasses its own steps for (see its call site). */
const isAttemptDecision = (decision: ExecutableDecision): boolean =>
  decision.kind === "commit" && decision.attempt === true

/** The subject the required script will produce. */
const previewSubject = (decision: ExecutableDecision): Effect.Effect<string | null, never> =>
  Effect.succeed(decision.subject)

/**
 * The `required` half: the HEAD assertion plus the commit steps, nothing
 * else. The steering-file format/validate pair is no longer part of the
 * landing script — that's a driver contract now (`gtd next --json`'s
 * `validate` field), not a gtd guarantee (see `resolveSelfValidateCommand`).
 */
const buildRequiredScript = (
  rest: Rest,
  decision: ExecutableDecision,
  cost: number | undefined,
  model: string | undefined,
): Effect.Effect<string, Error, CommandRequirements> =>
  Effect.succeed(emitScripts(renderDecision(rest, decision, cost, model)).required)

/** `gtd land`'s own flags, threaded as one bag rather than growing `planLanding`/`runLandCommand`'s positional list. */
interface LandOptions {
  readonly cost?: number
  readonly model?: string
}

/**
 * Decide the one resulting transition (a commit) for `gtd land`
 * without performing it, authenticating as `rest.actor`. Refusals fail the
 * Effect with a formatted message; a no-op returns `subject: null` and empty
 * scripts.
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
      const required = emitScripts([
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

    // Always true here since plan.kind is already known to be commit.
    const decision = plan.decision
    if (decision.kind !== "commit") {
      return yield* Effect.fail(
        new Error(
          `gtd: internal error — plan kind "${plan.kind}" but decision kind "${decision.kind}"`,
        ),
      )
    }

    yield* enforceStepGuards({
      rest,
      context: rest.context,
      file: rest.hints.file,
      changes: rest.changes,
      kind: decision.kind,
      attempt: isAttemptDecision(decision),
    })

    const restingState = decision.to
    const required = yield* buildRequiredScript(rest, decision, opts.cost, opts.model)
    return {
      state: restingState,
      subject: yield* previewSubject(decision),
      cost: opts.cost ?? null,
      model: opts.model ?? null,
      script: normalizeScriptNewline(combinedScript(required, "")),
      settled: false,
      idle: restingState === initialStateOf(rest.def),
    }
  })

/**
 * `gtd summary`: print the prompt for an agent to write the process HEAD
 * closes or sits inside its own closing message. Writes nothing — no git, no
 * state transition, no file. Refuses (throws, mapped to the runtime-error
 * exit code) on either of the two conditions `src/Summary.ts`'s
 * `buildSummary` folds into one `undefined`: the workflow declares no
 * `summary:` template, or the resolved run has no commits to name.
 */
const runSummaryCommand = (out: ArtifactOut): Effect.Effect<void, Error, CommandRequirements> =>
  Effect.gen(function* () {
    const config = yield* (yield* ConfigService).load
    const run = yield* summaryRun
    const context = yield* summaryTemplateContext(run)
    const rendered = buildSummary(config.workflow, run, context)
    if (rendered === undefined) {
      return yield* Effect.fail(
        new Error(
          `gtd summary: refused — either this workflow declares no "summary:" template, or ` +
            `there is no finished/in-flight process to summarize at HEAD`,
        ),
      )
    }
    out.write(rendered.endsWith("\n") ? rendered : rendered + "\n")
  })

/**
 * `gtd base`: print the review anchor hash — `reviewBaseFor(rest.def,
 * rest.run)` — bare and newline-terminated, so an external tool (a diff, a
 * PR tool, another agent) can be pointed at the range under review. Shaped
 * exactly like `runSummaryCommand`: one `Rest` resolved, nothing written — no
 * git, no state transition, no session identity. Refuses (mapped to the
 * runtime-error exit code) when the resolved run has no commits to name —
 * the only case where the hash would name a range that corresponds to no
 * review, exactly the way `runSummaryCommand` refuses on an empty trace.
 */
const runBaseCommand = (out: ArtifactOut): Effect.Effect<void, Error, CommandRequirements> =>
  Effect.gen(function* () {
    const rest = yield* currentRest
    if (rest.run.trace.length === 0) {
      return yield* Effect.fail(new Error("gtd base: refused — no process is underway at HEAD"))
    }
    const base = reviewBaseFor(rest.def, rest.run)
    out.write(`${base}\n`)
  })

/**
 * `gtd land [--cost=<n>] [--model=<name>]`: land whatever the tree shows at
 * the currently resolved rest, authenticated as the rest's own actor.
 * Plain output is `renderLandPlain`'s prose — the commit subject plus a
 * pointer at `--json=script`, or the no-op note when nothing landed — never
 * the script itself; `--json` emits `script` (byte-identical to before)
 * alongside `settled`/`idle`/`state`/`subject`/`cost`/`model`, so it stays
 * the machine path a driver pipes to `sh`. Exit code is uniformly `EXIT_OK`
 * on success — whose turn is next lives in the following `gtd next --json`'s
 * `kind` field.
 */
const runLandCommand = (
  opts: LandOptions,
  json: JsonMode,
  out: ArtifactOut,
): Effect.Effect<void, Error, CommandRequirements> =>
  Effect.gen(function* () {
    const result = yield* planLanding(opts)
    const built = landFields(result)
    if (json.kind === "document") {
      out.write(renderLandJson(built))
    } else if (json.kind === "select") {
      yield* writeSelection(out, built, json.path)
    } else {
      out.write(renderLandPlain(built))
    }
  })

/**
 * `gtd --entry <state> [--var <name>=<value> ...]` (`actor` always `"human"`):
 * start a brand new process at `<state>` — any declared state.
 * Writes an ordinary turn commit carrying zero or more `Gtd-Var:` trailers,
 * plus a `Gtd-Review-Base:` trailer when `<state>` declares a `reviewBase:`.
 * Commits via `commitAllWithPrefix` — capturing whatever the working tree
 * carries at entry, like an ordinary `gtd land` capture, rather than
 * demanding a clean tree.
 *
 * Refused when: the machine isn't resting at the workflow's initial state;
 * `<state>` isn't one of `enterableStates(rest.def)`; a `--var` name isn't
 * declared by the workflow's or `.gtdrc`'s `vars:`; or `<state>`'s
 * `reviewBase:` template doesn't render to a commitish that's an ancestor of
 * (and differs from) HEAD.
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
    // Safe to reuse plan.scripts verbatim here (unlike planLanding): an entry
    // always lands fresh at a brand-new process's first state, which never
    // has a file:/mode: of its own to validate ahead of the commit.
    out.write(combinedScript(plan.scripts.required, plan.scripts.optional))
  })

/**
 * `gtd abandon`: end the process currently underway without completing it,
 * returning the machine to the workflow's initial state — the recovery path
 * out of a process nobody is going to finish.
 *
 * Nothing is discarded: it `git reset --mixed`es HEAD to the commit the
 * process started from, dropping every turn commit while leaving everything
 * they carried in the working tree as uncommitted changes.
 *
 * Reads the current state off `computeProcessRun`'s own trace rather than
 * `resolveRest`, which refuses when HEAD names a state the current workflow
 * no longer declares — exactly the situation this command must still work in.
 *
 * Idempotent: resting at the initial state is a no-op success, not a
 * refusal. The one refusal is a process whose first commit is the
 * repository's own root commit — there's no earlier commit to rewind to.
 *
 * The read-side checks stay direct `GitService` reads (the documented
 * exception) since abandon must work even when a `Rest` would refuse; the
 * mutation itself is emitted as a `required` bash script for the driver to
 * run.
 */
const runAbandonCommand = (out: ArtifactOut): Effect.Effect<void, Error, CommandRequirements> =>
  Effect.gen(function* () {
    const git = yield* GitService
    const config = yield* (yield* ConfigService).load
    const def = config.workflow
    const initial = initialStateOf(def)
    const run = yield* currentRun
    if (run.trace.length === 0) {
      const required = emitScripts([
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

    const tip = yield* git.resolveRef("HEAD")

    const steps: EmitStep[] = [
      { kind: "gitWrite", command: updateRef(HISTORY_REF, tip) },
      { kind: "gitWrite", command: mixedResetTo(run.startParentHash) },
      { kind: "outcome", command: abandonedOutcome(restState, run.startParentHash, initial) },
    ]
    const required = emitScripts(steps).required
    out.write(combinedScript(required, ""))
  })

/**
 * `gtd restore`: hard-reset HEAD back to the tip `gtd abandon` retained.
 *
 * Guarded by `restorability` so it never discards work it didn't create:
 * refuses on a dirty working tree, no retained history, or HEAD having
 * advanced past the retained tip with commits that would be lost.
 */
const runRestoreCommand = (out: ArtifactOut): Effect.Effect<void, Error, CommandRequirements> =>
  Effect.gen(function* () {
    const git = yield* GitService

    // Reading rest.changes off currentRest (not pendingChanges directly)
    // means the renamed-state refusal wins over the dirty-tree message when
    // both apply.
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
    const check = yield* restorability(git, headHash, tip)
    if (!check.ok) {
      return yield* Effect.fail(
        new Error(
          `gtd restore: ${check.reason} — HEAD ${headHash.slice(0, 7)} is ahead of the ` +
            `retained tip ${tip.slice(0, 7)}.`,
        ),
      )
    }

    // A preview of the resulting state, resolved at tip directly since no reset has happened yet.
    const after = yield* restAt(tip)

    const steps: EmitStep[] = [
      { kind: "gitWrite", command: hardResetTo(tip) },
      { kind: "gitWrite", command: deleteRef(HISTORY_REF) },
      { kind: "outcome", command: restoredOutcome(tip, after.state) },
    ]
    const required = emitScripts(steps).required
    out.write(combinedScript(required, ""))
  })

/**
 * The mode's own resolved validate command, rendered against `file`: a
 * declared `validate:` command renders as the last command
 * `renderSteeringCommands` would emit (format, if any, comes first); a
 * `"builtin"` validator or no mode at all names the leaf
 * `gtd check <mode> '<file>'` invocation instead, so there's always something
 * concrete to name.
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

/** The driver-side counterpart of `Beat.ts`'s `selfValidateInstruction` — for a loop that runs the validate script and re-prompts on a non-zero exit, rather than an agent that self-validates before finishing. */
const fixPromptInstruction = (file: string): string =>
  `Your last turn does not pass its own validation script. Fix these format violations in ${file}, then finish:`

const emitsValidatablePrompt = (rendered: RenderedRest): boolean =>
  rendered.kind === "prompt" && rendered.file !== undefined && rendered.mode !== undefined

/**
 * Render `resolved`'s format:/validate: commands as `EmitStep[]`, wrapping
 * the last one with `onFailure: fixPromptInstruction(file)` when the
 * validator is a command — `resolveValidateScript`'s own helper, split out
 * so its render logic isn't inlined into that function's body.
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
 * under: `EnvVars.all["TMPDIR"]` when set, `node:os`'s `tmpdir()` otherwise —
 * never a `/tmp` literal or `mktemp` (`tests/tooling/no-tmp-assumption.test.ts`
 * scans for both). Reading `EnvVars` first keeps the emitted script
 * deterministic in unit tests, which inject a fixed `TMPDIR`.
 */
const scratchDir = (envVars: {
  readonly all: Readonly<Record<string, string | undefined>>
}): string => {
  const configured = envVars.all["TMPDIR"]
  return configured !== undefined && configured.length > 0 ? configured : tmpdir()
}

/**
 * `<scratchDir>/gtd-mode-sample-<mode>-<pid>.md` — an absolute literal baked
 * in at emit time, never a shell variable (a `format:` template renders
 * `it.file` inside single quotes, which no shell expands). `<pid>` avoids
 * collisions between concurrent `gtd` processes. The `.md` suffix is
 * load-bearing — without it a formatter may refuse the file outright.
 */
const scratchSamplePath = (
  envVars: { readonly all: Readonly<Record<string, string | undefined>> },
  mode: StateMode,
): string => join(scratchDir(envVars), `gtd-mode-sample-${mode}-${process.pid}.md`)

/**
 * The contradiction round-trip/skip-notice steps for `resolved`'s `mode:`.
 * `formatCommand` absent means nothing to round-trip: empty. Otherwise: a
 * live built-in validator runs the round-trip against that format's own
 * canonical sample; an external validator prints a one-line skip notice
 * instead, since silence there would read as a clean bill of health; a
 * format-only mode with neither has nothing to round-trip either.
 *
 * Emitted before `Emit.ts`'s `fileExistsGuard` — using a bundled sample
 * rather than the real file keeps the check alive at a first-write beat
 * where the real steering file doesn't exist yet.
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
 * Resolve the resting state's own steering-file validate script — shared by
 * `gtd validate --json` and `gtd next --json`'s embedded `validate` field so
 * the two surfaces can't drift. `undefined` = nothing to validate: no
 * `file:`+`mode:` declared. An unknown `mode:` fails this Effect;
 * `runNextCommand` is the one caller that degrades that to omitting
 * `validate`.
 *
 * The declared file's presence is checked inside the emitted script itself
 * (`fileExistsGuard`), not here, since it's only knowable after the turn —
 * so a turn that legitimately wrote nothing exits 0 with nothing to do
 * rather than burning a fix turn. The contradiction round-trip is emitted
 * before that guard, so it still runs at that same first-write beat.
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
    const script = emitScripts(steps).required
    return { file, mode, script }
  })

/** The driver-facing `BeatKind` for a currently-resolved rest, the one computation `gatherBeatFields` reads — so a driver's `kind` field can never drift from what it assembled. */
const restBeatKind = (rest: Rest): BeatKind =>
  beatKindOf({
    contentKind: contentKindOf(rest.stateDef) as Exclude<ContentKind, "commit">,
    dirty: rest.changes.length > 0,
    stalled: stalledAt(rest),
  })

/** `idle` means exactly one thing: the machine rests at the workflow's initial state with a clean tree — the process is genuinely done. */
const restIsIdle = (rest: Rest): boolean =>
  rest.state === initialStateOf(rest.def) && rest.changes.length === 0

/**
 * `gtd next`: pure emitter of the resolved rest's beat, in two encodings —
 * `--json` and plain (the default). No mutation: nothing is written,
 * so a peek and a would-be dispatch are the same call. Exit code is
 * `EXIT_OK` unconditionally — whose turn is next lives in the beat
 * document's own `kind` field, never the exit code.
 */
const runNextCommand = (
  json: JsonMode,
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
    if (json.kind === "document") {
      out.write(renderBeatJson(fields))
    } else if (json.kind === "select") {
      yield* writeSelection(out, fields, json.path)
    } else {
      // Advisory only — a render failure here must not fail gtd next
      // itself, so it degrades to omitting the instruction.
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
 * `gtd validate`: emit the script that would format then validate the
 * resolved rest's declared steering file — the same commands `gtd land`'s
 * capture guard embeds ahead of its own commit, rendered here to run
 * directly. gtd itself reads no file and executes nothing: a state with no
 * `file:`/`mode:`, or a file absent from the working tree, has nothing to
 * validate (exit 0 either way) — the verdict lives in the emitted script's
 * own future exit code. When the validator is a command, the last rendered
 * command carries `onFailure: fixPromptInstruction(file)`, so a non-zero
 * exit prints the complete fix prompt rather than bare findings.
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
 * `file:line:col: message` — the shape editors and grep-style tools already
 * jump on. The column comes from `range.start`, 0-based stored, 1-based
 * printed like `line`. A finding with a `line` but no `range` prints
 * `file:line: message` instead (no built-in format produces that shape any
 * more — a range always carries a column — but the flat, optional
 * `SteeringFinding` shape still allows it, for a future format). A
 * positionless finding prints its bare message.
 */
export const formatFinding = (file: string, finding: SteeringFinding): string => {
  if (finding.line === undefined) return finding.message
  const col = finding.range !== undefined ? `:${finding.range.start.character + 1}` : ""
  return `${file}:${finding.line + 1}${col}: ${finding.message}`
}

/**
 * `gtd check <mode> <file>`: read `<file>` and run the built-in steering
 * format named `<mode>`'s pure parser over its contents, printing each
 * finding one per line and exiting non-zero when there are any. Resolves no
 * workflow state and reads no config — both `mode` and `file` are given
 * explicitly. This is what a workflow's seeded `validate:` command invokes
 * as a leaf step; it does no formatting in-place.
 *
 * An absent file mirrors `gtd validate`'s absent-file behavior: exit 0. A
 * non-clean parse writes nothing through `out` — the findings instead ride
 * the failing Effect's own message, so `Cli.ts`'s shared refusal path
 * reports them on stderr.
 *
 * `--open-questions` replaces this structural-findings path with
 * `runOpenQuestionsCheckCommand`, below, but only after the same
 * unknown-mode validation runs, and only for `mode === "qa"` (the only mode
 * the open-questions predicate applies to).
 */
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
 * `OpenQuestions.ts`'s `unansweredQuestions` — the same predicate
 * `StepGuards.ts`'s answer-completeness guard enforces at land — printing one
 * unanswered question per line and exiting non-zero when any remain. Sharing
 * the one function keeps the gate script and the land-time guard in sync.
 *
 * A missing or unreadable file is a non-zero exit, unlike the structural
 * path above, which treats an absent file as "nothing to report".
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

/**
 * `gtd uncheck <file>`: read `<file>`, apply `clearFilePointerTicks`, and
 * write the result back only when the bytes actually changed — an untouched
 * file is never rewritten, so its mtime never moves. Resolves no workflow
 * state and reads no config — standalone, runnable from any directory with
 * `<file>` given explicitly, shaped exactly like `gtd check <mode> <file>`.
 *
 * Takes no `<mode>` argument, and must never grow one: this command means
 * review-mode file pointers and nothing else — `gtd check <mode> <file>`
 * already handles `qa`-mode's answered-question boxes, which this command
 * must never touch. A missing file writes nothing and exits 0, mirroring
 * `gtd check`'s absent-file behavior.
 */
const runUncheckCommand = (file: string): Effect.Effect<void, Error, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)))
    const present = yield* fs.exists(file).pipe(Effect.mapError(toError))
    if (!present) return

    const content = yield* fs.readFileString(file).pipe(Effect.mapError(toError))
    const cleared = clearFilePointerTicks(content)
    if (cleared === content) return

    yield* fs.writeFileString(file, cleared).pipe(Effect.mapError(toError))
  })

/** Which declared `on` pattern (if any) each pending change matches. `onEdges` must already be rendered against `it.vars`, so the reported pattern is the one a real `gtd land` would match against. */
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
 * First declared `on` edge whose pattern matches the whole pending change
 * list, mirroring `PatternMachine.step`'s first-match-wins semantics —
 * unlike `computeStatusChanges` above, which matches each change
 * independently. `null` when no edge matches. Reports the declared route
 * only: a capped `retry` target may redirect elsewhere at real step time,
 * which this doesn't apply.
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

/** Everything one beat needs beyond the resolved rest itself, gathered once so plain/`--json` can never describe different rests for the same beat. */
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
 * `/state.json` route. Any failure is swallowed to `null` — the browser just
 * hides the panel.
 */
const computeCurrentState = (
  model: VizModel,
): Effect.Effect<CurrentStateModel, Error, RestRequirements> =>
  Effect.gen(function* () {
    const rest = yield* restAt(undefined)
    const group = model.states.find((s) => s.name === rest.state)?.group
    return buildCurrentStateModel(rest, rest.changes, rest.on, group)
  })

/**
 * `gtd visualize`: serve an interactive diagram of the active workflow on a
 * local HTTP server. `needs: "config"` skips the repo-root guard — it reads
 * config but never touches git/HEAD itself (its `/state.json` route
 * best-effort reads git state per request). The running-server line below is
 * the only way to learn which port `--port 0` picked.
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
          // This blocking command never reaches runCli's flush-on-success,
          // so this diagnostic flushes itself, like the URL line below.
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
    // Must flush before blocking on Effect.never, or runCli's flush-on-success never fires.
    out.flush()
    if (open) openInBrowser(url)
    yield* Effect.never.pipe(Effect.ensuring(Effect.sync(() => server.close())))
  })

/**
 * Everything gtd derives is resolved against the process cwd, so running
 * from anywhere but the repository root would silently mis-derive state.
 * Refuses with a clear error instead. Real paths are compared so symlinked
 * cwds (e.g. macOS /tmp → /private/tmp) match.
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

/** A command that derives workflow state needs at least one commit too — a commitless repository has no HEAD to resolve a `Rest` at. */
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
 * `gtd init` may run either at a repository root or in a directory outside
 * any repository — the latter scaffolds a shared config a nested repo picks
 * up by walking up the cwd→home chain. The one placement it must refuse is a
 * repository subdirectory, since config discovery only walks up. Returns
 * whether cwd is inside a repository, so the caller can tailor the
 * "commit before starting" guidance.
 */
const assertInitLocation = (
  git: GitOperations,
  fs: FileSystem.FileSystem,
): Effect.Effect<boolean, Error> =>
  Effect.gen(function* () {
    const topLevel = yield* Effect.either(git.topLevel())
    // topLevel fails only outside a git repository — there, init is allowed.
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
 * What a command kind needs before it may run. Defined here, not in
 * `Cli.ts`, to avoid a circular value dependency (`Cli.ts` already depends
 * on this module for `runCommand`). `"state"` means the kind derives
 * workflow state, so it needs a repository root and at least one commit —
 * both guards run in `runCommand` before dispatch.
 */
export const needsOf = (kind: Command["kind"]): Needs => {
  switch (kind) {
    case "lsp":
    case "install":
      return "none"
    case "init":
    case "check":
    case "uncheck":
      return "fs"
    case "visualize":
      return "config"
    default:
      return "state"
  }
}

/** The six kinds that never touch the repo-root guard — pinned so a new standalone kind can't be added silently. */
export const standaloneKinds = (): readonly Command["kind"][] => [
  "lsp",
  "init",
  "visualize",
  "check",
  "uncheck",
  "install",
]

/**
 * Dispatches to the named `run*Command` handler for every `Command.kind` —
 * the counterpart of `Cli.ts`'s `parseArgv`, which has already validated
 * every field a handler receives. A command choosing its own exit code is
 * unrepresentable: every branch returns `Effect<void>`, and `Cli.ts`'s
 * `runCli` supplies `EXIT_OK` once, after this Effect succeeds.
 */
// fallow-ignore-next-line complexity
const dispatchVoidCommand = (
  command: Command,
  json: JsonMode,
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
        out,
      )
    case "entry":
      return runEntryCommand(command.actor, command.state, command.vars, out, command.label)
    case "abandon":
      return runAbandonCommand(out)
    case "restore":
      return runRestoreCommand(out)
    case "next":
      return runNextCommand(json, out)
    case "validate":
      return runValidateCommand(out)
    case "check":
      return runCheckCommand(command.mode, command.file, command.openQuestions ?? false)
    case "uncheck":
      return runUncheckCommand(command.file)
    case "install":
      return runInstallCommand(out)
    case "summary":
      return runSummaryCommand(out)
    case "base":
      return runBaseCommand(out)
  }
}

/**
 * The one entry point `Cli.ts`'s `runCli` calls for a resolved `Command`:
 * dispatches to the matching `run*Command` handler, wrapped in the
 * repo-root-and-commit guard exactly when `needsOf(command.kind) === "state"`
 * (the `standaloneKinds` run bare). Both guard checks run before `dispatch`,
 * so a refusal writes nothing and emits no script by construction.
 */
export const runCommand = (
  command: Command,
  json: JsonMode,
  out: ArtifactOut,
): Effect.Effect<void, Error, CommandRequirements> => {
  const dispatch = dispatchVoidCommand(command, json, out)
  if (needsOf(command.kind) !== "state") return dispatch
  return Effect.gen(function* () {
    const git = yield* GitService
    const fs = yield* FileSystem.FileSystem
    yield* assertRunningFromRepoRoot(git, fs)
    yield* assertRepositoryHasCommits(git)
    // One extra load here, own to this block, just to read `.warnings` ahead
    // of `dispatch`'s own (unrelated) load(s) — `ConfigService.load` isn't
    // memoized, and `Config.ts`'s pipeline narrates one "config: layer ..."
    // line per level on EVERY call, so a second bare load under --verbose
    // would double that output. Silence narration on this one call only (a
    // scoped Narrator override, never touching the outer context `dispatch`
    // runs under) — this load exists purely to surface `.warnings`, not to
    // narrate again.
    const narrator = yield* Narrator
    const config = yield* (yield* ConfigService).load.pipe(
      Effect.provideService(Narrator, { narrate: () => Effect.void, warn: () => Effect.void }),
    )
    for (const warning of config.warnings) yield* narrator.warn(`gtd: warning: ${warning}`)
    yield* dispatch
  })
}

import { createRequire } from "node:module"
import { join } from "node:path"
import { FileSystem } from "@effect/platform"
import { Effect, Either, Option, Runtime } from "effect"
import { configPresentAt, ConfigService } from "./Config.js"
import { renderInitScaffold } from "./workflows/templates.js"
import { Cwd } from "./Cwd.js"
import { EnvVars } from "./EnvVars.js"
import { RepoFiles } from "./RepoFiles.js"
import { CommandRunner } from "./CommandRunner.js"
import { GitService, type GitOperations } from "./Git.js"
import {
  currentRest,
  currentRun,
  planEntry,
  planStep,
  renderRest,
  restAt,
  UNATTRIBUTED_MODEL,
  type ModelCost,
  type Rest,
  type RenderedRest,
  type RestRequirements,
} from "./Edge.js"
import { closeReviewWindow, openReviewWindow, REVIEW_HEAD_REF } from "./ReviewWindow.js"
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
import { enforceStepGuards, checkSteeringFile } from "./StepGuards.js"
import {
  initialStateOf,
  matchesPattern,
  parsePattern,
  type OnEdge,
  type PendingChange,
} from "./PatternMachine.js"
import { type TemplateEdge } from "./PatternTemplates.js"

const _require = createRequire(import.meta.url)
const GTD_VERSION: string = (_require("../package.json") as { version: string }).version

const HELP_TEXT = `Usage: gtd [command] [options]

Commands:
  (no command), loop
                   Launch the loop driver (bin/gtd), which repeatedly drives
                   an agent through gtd next/gtd step calls until the
                   workflow rests at a human gate (a non-autonomous state)
                   or settles. A bare gtd invocation and gtd loop both
                   launch it identically
  init             Scaffold a minimal .gtdrc.json for this repo, seeding the
                   default variables you are most likely to change (the test
                   command) and a Prettier formatting suggestion. gtd runs its
                   built-in workflow by default, so no workflow is written —
                   add a workflow: key only to customize the machine itself.
                   Takes no argument. Run once per repo; refuses if a gtd
                   config already exists. Leaves the file uncommitted for you
                   to review and commit
  step <actor>     Authenticate as <actor>, match the resolved rest's
                   declared patterns against the pending changes, and commit
                   (or squash) the one resulting transition. Pass
                   --cost=<n> (optionally --model=<name>) to record the
                   just-finished invocation's token cost and model on the
                   turn commit (summed into it.processCost/processCostByModel).
                   Pass --entry <state> to start a brand NEW process at
                   <state> instead — any declared, non-commit state (e.g.
                   review-gate.check or fix-precheck on the bundled unified
                   template) — with repeatable --var <name>=<value> supplying
                   that new process's fixed it.vars overrides
  (no command) --entry <state>
                   Short form of 'step human --entry <state>' — starts a new
                   process authenticated as human, e.g.
                   'gtd --entry review-gate.check'
  abandon          End the process currently underway without completing it:
                   close any open review checkout window, then rewind HEAD to
                   the commit the process started from, keeping everything it
                   produced as uncommitted changes. A no-op when no process is
                   underway
  restore          Hard-reset HEAD back to the pre-squash tip retained by the
                   last squash/abandon (refs/worktree/gtd/history), undoing a
                   squash or bringing back an abandoned process's turns.
                   Refuses on a dirty working tree, when there is no retained
                   history, or when HEAD has advanced past the squash with
                   commits that would be lost
  next             Print the resolved rest's rendered script/prompt/message
                   (no mutation)
  status           Print the resolved rest's state/actor and which declared
                   pattern (if any) each pending change matches (no mutation)
  validate         Format and validate the steering file the resolved rest
                   declares, with its mode's commands (its file:/mode:);
                   exits non-zero with the findings when it is invalid
  lsp              Start the LSP server for .gtd/ steering files (stdio)
  visualize        Serve an interactive diagram of the active workflow on a
                   local web server (--port <n>, --no-open; --json prints the
                   model and exits)
  version          Print version and exit
  help             Print this help and exit

Options:
  --json           Output structured JSON instead of plain text
  --port=<n>       (gtd visualize only) port to serve on (default: a free port)
  --no-open        (gtd visualize only) do not open the browser
  --cost=<n>       (gtd step only) record the invocation's token cost
  --model=<name>   (gtd step only, with --cost) tag that cost's model
  --entry <state>  (gtd step, or with no command at all) start a brand new
                   process at <state> — any declared, non-commit state —
                   instead of stepping the one currently resting. Not
                   combinable with --cost/--model (an entry is not a metered
                   agent turn)
  --var <name>=<value>
                   (with --entry; repeatable) supply a fixed it.vars
                   override for the new process; the name must already be
                   declared by the workflow's own vars: or the .gtdrc vars:
  --version, -v    Print version and exit
  --help, -h       Print this help and exit
`

/**
 * Marks an error as already reported inside the `--json` error envelope, so
 * the composition root (main.ts) doesn't emit a second envelope for it.
 * Errors that fail BEFORE `makeProgram` runs — e.g. a config-validation
 * failure at layer construction — carry no mark, and main.ts writes the
 * envelope for them instead.
 */
const ENVELOPED = Symbol.for("gtd/enveloped")
const markEnveloped = (error: Error): Error => Object.assign(error, { [ENVELOPED]: true as const })
export const isEnveloped = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as Record<symbol, unknown>)[ENVELOPED] === true

/**
 * The stderr line for a CLI error (see `main.ts`): a `gtd: ` prefix UNLESS the
 * message already carries one. Most gtd errors are authored with a
 * `gtd:`/`gtd <cmd>:` prefix of their own (e.g. `gtd init: …`,
 * `gtd: unknown option …`), so a blind prepend produced a doubled
 * `gtd: gtd: …`.
 */
export const cliErrorLine = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error)
  return /^gtd[: ]/.test(message) ? message : `gtd: ${message}`
}

/** Every port `makeProgram` needs — `src/testing/Layers.ts`'s `testLayers` must satisfy exactly this, so a new port lands as a `tsc` error in one place instead of silently under-providing the test double. */
export type ProgramRequirements =
  | GitService
  | FileSystem.FileSystem
  | ConfigService
  | Cwd
  | RepoFiles
  | CommandRunner
  | EnvVars

/**
 * Every value `flag` carries in `argv`, in BOTH `--flag=value` and `--flag
 * value` (space-separated) forms, plus every argv INDEX consumed producing
 * them — the flag token itself, and (for the space-separated form) the next
 * token too. A trailing bare occurrence (`flag` as the very last argv token,
 * with no following value) still consumes its own index but contributes an
 * EMPTY STRING to `values` — indistinguishable from an explicit `flag=`, and
 * deliberately so: both are "no value given" and a caller that cares (see
 * `parseEntryFlags`) rejects an empty value with its own message. Repeatable
 * flags (`--var`) collect one entry per occurrence, in argv order. Shared by
 * the positional-extraction fix below (`commandArgs`, and the top-level
 * `positional` lookup in `makeProgram`) and by `parseEntryFlags`'s own
 * `--entry`/`--var` parsing, so both agree on exactly which indices a flag's
 * value occupies.
 */
export const takeFlagValues = (
  argv: readonly string[],
  flag: string,
): { readonly values: string[]; readonly consumed: Set<number> } => {
  const values: string[] = []
  const consumed = new Set<number>()
  const eqPrefix = `${flag}=`
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === flag) {
      consumed.add(i)
      if (i + 1 < argv.length) {
        values.push(argv[i + 1]!)
        consumed.add(i + 1)
      } else {
        values.push("")
      }
    } else if (arg.startsWith(eqPrefix)) {
      consumed.add(i)
      values.push(arg.slice(eqPrefix.length))
    }
  }
  return { values, consumed }
}

const ENTRY_FLAG = "--entry"
const VAR_FLAG = "--var"

/**
 * The absolute argv indices `takeFlagValues` reports as consumed for
 * `--entry`/`--var`, merged — the set both `commandArgs` and the top-level
 * `positional` lookup in `makeProgram` must SKIP so a flag's value (e.g.
 * `--entry review-gate.check`, which carries no `--` prefix of its own) is
 * never mistaken for a stray extra positional argument.
 */
const flagConsumedIndices = (argv: readonly string[]): Set<number> => {
  const consumed = new Set<number>()
  for (const i of takeFlagValues(argv, ENTRY_FLAG).consumed) consumed.add(i)
  for (const i of takeFlagValues(argv, VAR_FLAG).consumed) consumed.add(i)
  return consumed
}

/** Non-flag positional arguments past the subcommand name (argv[3..]), skipping any index `flagConsumedIndices` reports as an `--entry`/`--var` value (which carries no `--` prefix of its own and would otherwise read as a stray extra positional — see `takeFlagValues`). */
const commandArgs = (argv: readonly string[]): string[] => {
  const consumed = flagConsumedIndices(argv)
  return argv
    .map((a, i) => ({ a, i }))
    .slice(3)
    .filter(({ a, i }) => a.length > 0 && !a.startsWith("--") && !consumed.has(i))
    .map(({ a }) => a)
}

const COST_FLAG = "--cost="

/**
 * Parse the optional `--cost=<n>` flag (only `gtd step` accepts it — see
 * `makeProgram`). `<n>` is the token cost of the invocation that produced the
 * pending changes, recorded as a `Gtd-Cost:` trailer on the turn commit. Must
 * be a non-negative finite number; a bare `--cost` (no `=`) or a non-numeric/
 * negative value is a usage error. Returns `undefined` when the flag is absent.
 */
const parseCostFlag = (argv: readonly string[]): Effect.Effect<number | undefined, Error> => {
  if (argv.slice(2).includes("--cost")) {
    return Effect.fail(new Error("gtd: --cost requires a value — use --cost=<number>"))
  }
  const flag = argv.slice(2).find((a) => a.startsWith(COST_FLAG))
  if (flag === undefined) return Effect.succeed(undefined)
  const raw = flag.slice(COST_FLAG.length)
  const n = Number(raw)
  if (raw.trim() === "" || !Number.isFinite(n) || n < 0) {
    return Effect.fail(new Error(`gtd: --cost must be a non-negative number — got "${raw}"`))
  }
  return Effect.succeed(n)
}

const MODEL_FLAG = "--model="

/**
 * Parse the optional `--model=<name>` flag (only `gtd step`, and only
 * alongside `--cost` — see `makeProgram`). `<name>` tags the recorded cost
 * with the model the invocation ran on, appended to the `Gtd-Cost:` trailer
 * and grouped in `it.processCostByModel`. Must be non-empty and single-line
 * (it rides on one trailer line); a bare `--model` (no `=`) or an empty/
 * multiline value is a usage error. Returns `undefined` when the flag is absent.
 */
const parseModelFlag = (argv: readonly string[]): Effect.Effect<string | undefined, Error> => {
  if (argv.slice(2).includes("--model")) {
    return Effect.fail(new Error("gtd: --model requires a value — use --model=<name>"))
  }
  const flag = argv.slice(2).find((a) => a.startsWith(MODEL_FLAG))
  if (flag === undefined) return Effect.succeed(undefined)
  const raw = flag.slice(MODEL_FLAG.length)
  if (raw.trim() === "" || /[\r\n]/.test(raw)) {
    return Effect.fail(new Error("gtd: --model must be a non-empty, single-line value"))
  }
  return Effect.succeed(raw)
}

/**
 * Parse and validate the `--cost`/`--model` step flags together. Both are
 * orthogonal to `--json` but only meaningful to `gtd step` — rejected on any
 * other command rather than silently ignored (same discipline as `--json` on
 * `next`) — and `--model` requires `--cost` (a model tag with no token count
 * records nothing to sum).
 */
const parseStepFlags = (
  argv: readonly string[],
  positional: string | undefined,
): Effect.Effect<
  { readonly cost: number | undefined; readonly model: string | undefined },
  Error
> =>
  Effect.gen(function* () {
    const cost = yield* parseCostFlag(argv)
    const model = yield* parseModelFlag(argv)
    if (cost !== undefined && positional !== "step") {
      return yield* Effect.fail(new Error("gtd: --cost is only valid for `gtd step`"))
    }
    if (model !== undefined && positional !== "step") {
      return yield* Effect.fail(new Error("gtd: --model is only valid for `gtd step`"))
    }
    if (model !== undefined && cost === undefined) {
      return yield* Effect.fail(
        new Error(
          "gtd: --model requires --cost — it tags the recorded cost with the model that ran",
        ),
      )
    }
    return { cost, model }
  })

/**
 * Parse the `--entry <state>`/`--entry=<state>` flag and the repeatable
 * `--var <name>=<value>`/`--var=<name>=<value>` flag together (see
 * `takeFlagValues`) — mirrors `parseStepFlags`'s shape/Effect style. `--entry`
 * names the state a brand-new process should START at (see
 * `runEntryCommand`), reached via `gtd step <actor> --entry <state>` or the
 * subcommand-less short form `gtd --entry <state>` — so, like `--cost`/
 * `--model`, it is rejected outright on any OTHER command rather than
 * silently ignored. `--var` supplies that new process's fixed `it.vars`
 * overrides, and only means anything alongside `--entry`.
 *
 * - At most one `--entry` occurrence — a second is a usage error (not
 *   last-wins).
 * - A bare `--entry` with no following value is a usage error (mirrors
 *   `parseCostFlag`'s bare-`--cost` handling).
 * - Each `--var` value must be `<name>=<value>` with a non-empty name and a
 *   single-line value (mirrors `parseModelFlag`'s multiline-rejection idiom);
 *   a duplicate `--var` NAME is a usage error (no silent last-wins).
 * - `--var` present with no `--entry` is a usage error.
 *
 * Deliberately does NOT reject `--cost`/`--model` alongside `--entry` — that
 * combination check lives where `--cost`/`--model` are already validated
 * (see `makeProgram`).
 */
export const parseEntryFlags = (
  argv: readonly string[],
  positional: string | undefined,
): Effect.Effect<
  { readonly entry: string | undefined; readonly vars: Record<string, string> },
  Error
> =>
  // fallow-ignore-next-line complexity
  Effect.gen(function* () {
    const entryValues = takeFlagValues(argv, ENTRY_FLAG).values
    if (entryValues.length > 1) {
      return yield* Effect.fail(new Error("gtd: --entry may be given at most once"))
    }
    const entryRaw = entryValues[0]
    if (entryRaw === "") {
      return yield* Effect.fail(
        new Error("gtd: --entry requires a value — use --entry=<state> or --entry <state>"),
      )
    }
    const entry = entryRaw
    if (entry !== undefined && positional !== "step" && positional !== undefined) {
      return yield* Effect.fail(
        new Error(
          "gtd: --entry is only valid for `gtd step` or the bare `gtd --entry <state>` form",
        ),
      )
    }

    const vars: Record<string, string> = {}
    const seenNames = new Set<string>()
    for (const raw of takeFlagValues(argv, VAR_FLAG).values) {
      const eq = raw.indexOf("=")
      if (eq <= 0) {
        return yield* Effect.fail(
          new Error(`gtd: --var must be <name>=<value> with a non-empty name — got "${raw}"`),
        )
      }
      const name = raw.slice(0, eq)
      const value = raw.slice(eq + 1)
      if (/[\r\n]/.test(value)) {
        return yield* Effect.fail(new Error(`gtd: --var ${name} must be a single-line value`))
      }
      if (seenNames.has(name)) {
        return yield* Effect.fail(new Error(`gtd: --var ${name} specified more than once`))
      }
      seenNames.add(name)
      vars[name] = value
    }
    if (entry === undefined && Object.keys(vars).length > 0) {
      return yield* Effect.fail(new Error("gtd: --var requires --entry"))
    }

    return { entry, vars }
  })

/** Rejects extra positional arguments for a subcommand that takes none (`status`, `run`). */
const rejectExtraArgs = (command: string, argv: readonly string[]): Effect.Effect<void, Error> => {
  const args = commandArgs(argv)
  if (args.length > 0) {
    return Effect.fail(
      new Error(`gtd ${command}: too many arguments — expected none, got: ${args.join(", ")}`),
    )
  }
  return Effect.void
}

/**
 * `gtd lsp`: start the LSP server for `.gtd/` steering files over stdio.
 * Rejects `--json` (not a state command) and extra positional arguments
 * (takes none). Dispatched BEFORE the known-subcommand guard and the repo-root
 * guard — since the server needs no git/config/workflow dependency at all
 * (it's keyed on file name, not workflow state; see `src/Lsp.ts`'s module doc).
 */
const runLspCommand = (argv: readonly string[], json: boolean): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    if (json) {
      return yield* Effect.fail(new Error("gtd lsp does not accept --json"))
    }
    yield* rejectExtraArgs("lsp", argv)
    yield* startLspServer()
  })

/**
 * `gtd init`: scaffold a MINIMAL `.gtdrc.json` seeding the default variables a
 * fresh project is most likely to change — the test command (`vars.testCommand`)
 * and a ready-to-edit Prettier formatting suggestion (`modes:`). It writes NO
 * `workflow:` key: gtd ships the unified workflow as its built-in default and
 * runs it whenever none is configured (see `src/Config.ts`), so there is
 * nothing to scaffold there — a project customizes the machine itself only by
 * adding a `workflow:` key. Takes NO argument. Dispatched like `lsp` — BEFORE
 * the closeReviewWindow/dispatch/openReviewWindow block — because it needs no
 * `ConfigService` and no review window. It still runs the repo-root guard (it
 * writes `.gtdrc.json` at the root) and refuses to clobber an existing config.
 * The file is left UNCOMMITTED, so the message warns to commit it before the
 * first `gtd step` (an uncommitted config counts as a pending change the
 * initial state's `* **` edge would otherwise capture).
 */
const runInitCommand = (
  argv: readonly string[],
  json: boolean,
  write: (chunk: string) => void,
): Effect.Effect<void, Error, GitService | FileSystem.FileSystem | Cwd> =>
  Effect.gen(function* () {
    const args = commandArgs(argv)
    if (args.length > 0) {
      return yield* Effect.fail(
        new Error(`gtd init: too many arguments — init takes no argument, got: ${args.join(", ")}`),
      )
    }
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

/**
 * Authenticate `invoker` against the currently resolved rest and perform the
 * one resulting transition (commit or squash) for `gtd step`. `currentRest` →
 * `planStep` decides; the four capture gates sit between the plan and
 * `plan.perform` (nothing has written git yet), then `perform` runs. Refusals
 * fail the Effect with a formatted message; a no-op/reset returns `subject:
 * null` rather than failing (exit zero, per the plan's "clean no-op exits
 * zero").
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
  ProgramRequirements
> =>
  Effect.gen(function* () {
    const rest = yield* currentRest
    const plan = yield* planStep(rest, invoker, {
      ...(cost !== undefined ? { cost } : {}),
      ...(model !== undefined ? { model } : {}),
    })

    if (plan.kind === "refusal") {
      return yield* Effect.fail(new Error(plan.message))
    }
    if (plan.kind === "noop") {
      return { state: plan.state, subject: null, cost: null, model: null }
    }

    // Step-capture guards (edge, not engine — see src/StepGuards.ts): the
    // steering-file, review-signoff, feedback-progress and answer-completeness
    // guards, in registry order, each able to refuse before anything commits.
    // They sit between the plan and `plan.perform`, so nothing has written git
    // yet. `file` is the rest's already-rendered `file:` hint — rendered once
    // when the snapshot was built, not re-rendered per guard.
    yield* enforceStepGuards({
      rest,
      context: rest.context,
      file: rest.hints.file,
      changes: rest.changes,
      invoker,
      kind: plan.kind,
    })

    const outcome = yield* plan.perform
    if (outcome.kind === "reset" || outcome.kind === "noop") {
      return { state: outcome.state, subject: null, cost: null, model: null }
    }
    return { state: rest.state, subject: outcome.subject, cost: cost ?? null, model: model ?? null }
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
 * `Gtd-Cost:` trailer. When `--entry <state>` is present, the actor argument
 * is still required (it names who authors the entry commit) but the ordinary
 * pattern-matched step never runs — dispatches to `runEntryCommand` instead
 * (see `makeProgram`'s parsing of `--entry`/`--var`, and its sibling
 * subcommand-less short form).
 */
const runStepCommand = (
  argv: readonly string[],
  json: boolean,
  write: (chunk: string) => void,
  cost: number | undefined,
  model: string | undefined,
  entryFlags: { readonly entry: string | undefined; readonly vars: Record<string, string> },
): Effect.Effect<void, Error, ProgramRequirements> =>
  Effect.gen(function* () {
    const args = commandArgs(argv)
    if (args.length === 0) {
      return yield* Effect.fail(new Error("gtd step: missing actor argument"))
    }
    if (args.length > 1) {
      return yield* Effect.fail(
        new Error(`gtd step: too many arguments — expected one actor, got: ${args.join(", ")}`),
      )
    }
    const actor = args[0]!
    if (entryFlags.entry !== undefined) {
      return yield* runEntryCommand(
        actor,
        entryFlags.entry,
        entryFlags.vars,
        json,
        write,
        `gtd step ${actor} --entry ${entryFlags.entry}`,
      )
    }
    const result = yield* stepAsActor(actor, cost, model)
    reportStepResult(result, json, write)
  })

/**
 * `gtd step <actor> --entry <state> [--var <name>=<value> ...]` (or its
 * subcommand-less short form `gtd --entry <state> ...`, `actor` defaulting to
 * `human` there — see `makeProgram`): start a brand NEW process at `<state>`
 * — any declared, non-commit state — via `Edge.ts`'s `planEntry`, which owns
 * every refusal (already-underway, not-enterable, undeclared `--var`, a bad
 * `reviewBase:` template) and the entry commit's trailers. This command is
 * just: resolve the current rest, plan the entry, perform it, report it.
 */
const runEntryCommand = (
  actor: string,
  entryState: string,
  varOverrides: Record<string, string>,
  json: boolean,
  write: (chunk: string) => void,
  commandLabel: string,
): Effect.Effect<void, Error, ProgramRequirements> =>
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
    yield* plan.perform
    if (json) {
      write(JSON.stringify({ state: plan.state, subject: plan.subject }) + "\n")
    } else {
      write(`committed: ${plan.subject}\n`)
    }
  })

// git's empty-tree object — `ProcessRun.startParentHash` when the process
// covers the whole history, so there is no earlier commit to rewind to.
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

/**
 * `gtd abandon`: end the process currently underway WITHOUT completing it,
 * returning the machine to the workflow's initial state — the recovery path out
 * of a process nobody is going to finish (`runEntryCommand`'s "already
 * underway" refusal names it: "finish it, or run `gtd abandon`, before entering"
 * — and so does `resolveRest`'s refusal when HEAD names a state a workflow
 * change has since removed).
 *
 * NOTHING is discarded. The shared bracket in `makeProgram` has already closed
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
  argv: readonly string[],
  json: boolean,
  write: (chunk: string) => void,
): Effect.Effect<void, Error, ProgramRequirements> =>
  Effect.gen(function* () {
    yield* rejectExtraArgs("abandon", argv)

    const git = yield* GitService
    const config = yield* (yield* ConfigService).load
    const def = config.workflow
    const initial = initialStateOf(def)
    const run = yield* currentRun
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
  argv: readonly string[],
  json: boolean,
  write: (chunk: string) => void,
): Effect.Effect<void, Error, ProgramRequirements> =>
  Effect.gen(function* () {
    yield* rejectExtraArgs("restore", argv)

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

    yield* git.hardResetTo(tip)
    yield* clearRetainedHistory(git)

    const after = yield* currentRest
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
): Effect.Effect<void, Error, ProgramRequirements> =>
  Effect.gen(function* () {
    const rendered = yield* renderRest(yield* currentRest)
    write(json ? nextJsonOutput(rendered) : nextPlainOutput(rendered))
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
  argv: readonly string[],
  json: boolean,
  write: (chunk: string) => void,
): Effect.Effect<void, Error, ProgramRequirements> =>
  Effect.gen(function* () {
    yield* rejectExtraArgs("validate", argv)
    const rest = yield* currentRest
    const { file, present, errors } = yield* checkSteeringFile(rest, rest.context, rest.hints.file)
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

/** `gtd status --json`'s emission — `{state, actor, changes, next, model?, memory?, label?, file?, mode?, cost?, costByModel?, edges?}`. `edges` is `rest.context.edges` — the resting state's `on` edges already rendered against `it.vars`, so the emitted `edges[].pattern` carries the same rendered path as `changes[].pattern`. `next` is ALWAYS present (an object, or `null` on no match) — the headline conclusion, never omit-vs-null, same as `changes`. */
const writeStatusJson = (
  write: (chunk: string) => void,
  rest: Rest,
  statusChanges: readonly StatusChange[],
  edges: readonly TemplateEdge[],
  next: NextMatch | null,
  model: string | undefined,
  memory: string | undefined,
  label: string | undefined,
  file: string | undefined,
  cost: number,
  costByModel: readonly ModelCost[],
): void => {
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
  write(lines.join("\n") + "\n")
}

/** `gtd status`: pure dry-run reporter — the resolved state/actor, and which declared pattern (if any) each pending change matches. */
const runStatusCommand = (
  argv: readonly string[],
  json: boolean,
  write: (chunk: string) => void,
): Effect.Effect<void, Error, ProgramRequirements> =>
  Effect.gen(function* () {
    yield* rejectExtraArgs("status", argv)
    const rest = yield* currentRest
    const statusChanges = computeStatusChanges(rest.on, rest.changes)
    const next = computeNextMatch(rest.on, rest.changes)
    if (json) {
      writeStatusJson(
        write,
        rest,
        statusChanges,
        rest.context.edges,
        next,
        rest.hints.model,
        rest.memory,
        rest.hints.label,
        rest.hints.file,
        rest.context.processCost,
        rest.context.processCostByModel,
      )
    } else {
      writeStatusPlain(
        write,
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
  })

interface VisualizeOptions {
  readonly port: number
  readonly open: boolean
}

/** Parse a `--port` value: an integer 0–65535, or `undefined` if invalid/absent. */
const parsePort = (value: string | undefined): number | undefined => {
  const n = Number(value)
  return value !== undefined && Number.isInteger(n) && n >= 0 && n <= 65535 ? n : undefined
}

/** Resolve a `--port`/`--port=<n>` argument to its raw value + the index consumed, or `null` if `arg` is not a port option. */
const portArgValue = (
  arg: string,
  rest: readonly string[],
  i: number,
): { value: string | undefined; nextIndex: number } | null => {
  if (arg === "--port") return { value: rest[i + 1], nextIndex: i + 1 }
  if (arg.startsWith("--port=")) return { value: arg.slice("--port=".length), nextIndex: i }
  return null
}

/**
 * Parse `gtd visualize`'s own options from the argv tail (the subcommand token
 * already dropped): `--port <n>`/`--port=<n>`, `--no-open`, and a passthrough
 * `--json`. Returns the options, or an `{ error }` message for an invalid port,
 * an unknown `--` option, or an unexpected positional.
 */
const parseVisualizeOptions = (rest: readonly string[]): VisualizeOptions | { error: string } => {
  let port = 0
  let open = true
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!
    const portArg = portArgValue(arg, rest, i)
    if (portArg !== null) {
      const parsed = parsePort(portArg.value)
      if (parsed === undefined)
        return {
          error: `gtd visualize: --port must be an integer 0–65535 (got '${portArg.value ?? ""}')`,
        }
      port = parsed
      i = portArg.nextIndex
      continue
    }
    if (arg === "--json") continue
    if (arg === "--no-open") open = false
    else if (arg.startsWith("--"))
      return { error: `gtd: unknown option '${arg}' — see \`gtd --help\`` }
    else return { error: `gtd visualize: unexpected argument '${arg}'` }
  }
  return { port, open }
}

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
 * local HTTP server (see `src/Visualize.ts`). Dispatched early (like `lsp`/
 * `init`) — it reads the config but never touches git, HEAD, or the review
 * window ITSELF (though its `/state.json` route best-effort reads git state
 * per request, see `computeCurrentState`) — and parses its OWN options
 * (`--port`, `--no-open`), since the global unknown-option check does not
 * know them. `--json` prints the model and exits without starting a server
 * (the testable path; live state is a server-only concern, so `--json`'s
 * shape is unchanged).
 */
const runVisualizeCommand = (
  argv: readonly string[],
  json: boolean,
  write: (chunk: string) => void,
): Effect.Effect<void, Error, RestRequirements> =>
  Effect.gen(function* () {
    const tokens = argv.slice(2)
    const subIdx = tokens.indexOf("visualize")
    const rest = subIdx >= 0 ? [...tokens.slice(0, subIdx), ...tokens.slice(subIdx + 1)] : tokens
    const opts = parseVisualizeOptions(rest)
    if ("error" in opts) return yield* Effect.fail(new Error(opts.error))

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

    const runtime = yield* Effect.runtime<RestRequirements>()
    const resolveCurrent = () =>
      Runtime.runPromise(runtime)(computeCurrentState(model).pipe(Effect.either)).then((result) => {
        if (Either.isLeft(result)) {
          write(`gtd visualize: current-state panel unavailable — ${result.left.message}\n`)
          return null
        }
        return result.right
      })

    const { server, url } = yield* Effect.tryPromise({
      try: () => startVizServer(model, opts.port, "127.0.0.1", resolveCurrent),
      catch: (e) =>
        new Error(
          `gtd visualize: could not start server: ${e instanceof Error ? e.message : String(e)}`,
        ),
    })
    write(`gtd visualize running at ${url} — Ctrl-C to stop\n`)
    if (opts.open) openInBrowser(url)
    // Block until the process is interrupted (Ctrl-C); always close the server.
    yield* Effect.never.pipe(Effect.ensuring(Effect.sync(() => server.close())))
  })

const KNOWN_SUBCOMMANDS = ["step", "abandon", "restore", "next", "status", "validate"] as const
type KnownSubcommand = (typeof KNOWN_SUBCOMMANDS)[number]

/**
 * The two named commands the generic `--entry` mechanism replaced (see
 * `runEntryCommand`) — no fallback, so `gtd review`/`gtd fix` must fail with a
 * message pointing at the replacement rather than the generic "unknown
 * command" (see `requireKnownSubcommand`). Illustrated with the bundled
 * unified template's own entry-flagged state names (`review-gate.check`/
 * `fix-precheck`) since gtd itself has no opinion on any workflow's state
 * names — a custom workflow names its own.
 */
const REMOVED_SUBCOMMANDS: Record<string, string> = {
  review:
    "gtd: `gtd review <commitish>` is gone — this workflow's own state names " +
    "aren't known to gtd; run `gtd step <actor> --entry <review-state> " +
    "--var <name>=<value> ...` instead (e.g. " +
    "`gtd step human --entry review-gate.check` for the bundled unified template)",
  fix:
    "gtd: `gtd fix` is gone — this workflow's own state names aren't known to " +
    "gtd; run `gtd step <actor> --entry <fix-state>` instead (e.g. " +
    "`gtd step human --entry fix-precheck` for the bundled unified template)",
}

/**
 * `--version`/`-v`/`version` or `--help`/`-h`/`help`: short-circuits before any
 * git or state work, so it works outside a repo too. The bare `version`/`help`
 * subcommands are equivalent to their flag forms. Exported so main.ts can run
 * the same check synchronously BEFORE the Effect runtime builds any layer —
 * layer construction must never observe a version/help invocation.
 */
export const runVersionOrHelp = (
  argv: readonly string[],
  write: (chunk: string) => void,
): boolean => {
  const positional = argv.slice(2).find((a) => !a.startsWith("--"))
  if (argv.includes("--version") || argv.includes("-v") || positional === "version") {
    write(GTD_VERSION + "\n")
    return true
  }
  if (argv.includes("--help") || argv.includes("-h") || positional === "help") {
    write(HELP_TEXT)
    return true
  }
  return false
}

/**
 * Rejects a bare `gtd` invocation or an unrecognized subcommand. Returns the
 * subcommand narrowed to `KnownSubcommand` once past this guard.
 */
const requireKnownSubcommand = (
  sub: string | undefined,
  json: boolean,
  write: (chunk: string) => void,
): Effect.Effect<KnownSubcommand, Error> => {
  if (sub === undefined) {
    if (!json) write(HELP_TEXT)
    return Effect.fail(new Error("gtd: missing command — see usage above (`gtd --help`)"))
  }
  const removedMessage = REMOVED_SUBCOMMANDS[sub]
  if (removedMessage !== undefined) {
    return Effect.fail(new Error(removedMessage))
  }
  if (!(KNOWN_SUBCOMMANDS as readonly string[]).includes(sub)) {
    return Effect.fail(new Error(`unknown command '${sub}'`))
  }
  return Effect.succeed(sub as KnownSubcommand)
}

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

/** Dispatches to the named `run*Command` handler for every known subcommand. `entryFlags` is only consulted by `step` (see `runStepCommand`) — every other subcommand ignores it, since `--entry`/`--var` are meaningless anywhere else (`parseEntryFlags` already rejects that combination before dispatch is reached). */
const dispatchKnownSubcommand = (
  sub: KnownSubcommand,
  argv: readonly string[],
  json: boolean,
  write: (chunk: string) => void,
  cost: number | undefined,
  model: string | undefined,
  entryFlags: { readonly entry: string | undefined; readonly vars: Record<string, string> },
): Effect.Effect<void, Error, ProgramRequirements> => {
  switch (sub) {
    case "step":
      return runStepCommand(argv, json, write, cost, model, entryFlags)
    case "abandon":
      return runAbandonCommand(argv, json, write)
    case "restore":
      return runRestoreCommand(argv, json, write)
    case "next":
      return runNextCommand(json, write)
    case "status":
      return runStatusCommand(argv, json, write)
    case "validate":
      return runValidateCommand(argv, json, write)
  }
}

/**
 * Runs `command` inside the bracket every state-touching subcommand shares:
 * the repo-root guard, then close-any-open-review-window before the command
 * sees HEAD, then re-arm it afterward whether `command` succeeded or refused
 * (see `closeReviewWindow`/`openReviewWindow`). Shared by the normal
 * known-subcommand dispatch and the subcommand-less `gtd --entry <state>`
 * short form in `makeProgram`, so both open/close the window identically.
 */
const runInReviewWindowBracket = (
  git: GitOperations,
  fs: FileSystem.FileSystem,
  command: Effect.Effect<void, Error, ProgramRequirements>,
): Effect.Effect<void, Error, ProgramRequirements> =>
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
 * Options for the exported `makeProgram` factory.
 * Defaults to `process.argv` and `process.stdout.write` so production wiring is
 * unchanged.
 */
export interface RunOptions {
  /** argv array (e.g. `["node", "gtd.js", "step", "agent"]`). Defaults to `process.argv`. */
  argv?: string[]
  /** Sink for stdout output. Defaults to `process.stdout.write.bind(process.stdout)`. */
  write?: (chunk: string) => void
}

/**
 * Factory that returns the gtd driver Effect with the given I/O options.
 *
 * The returned Effect requires `GitService | FileSystem.FileSystem |
 * ConfigService | Cwd | RepoFiles | CommandRunner | EnvVars`. Production code calls
 * this with no arguments; the test world supplies an in-memory layer set and
 * captures stdout via the `write` callback.
 *
 * v3 command surface: `step <actor>` / `next` / `status` / `validate` (see
 * `src/Edge.ts`), plus `lsp` and `init` — both dispatched before the
 * config-reading path since neither needs to touch the config. `step
 * <actor> --entry <state>` (and its subcommand-less short form `gtd --entry
 * <state>`, actor defaulting to `human`) starts a brand-new process at any
 * declared, non-commit state — the generic mechanism that replaced the old
 * named `review`/`fix` commands (see `runEntryCommand`; `gtd review`/`gtd
 * fix` now fail with a message pointing at the replacement, `REMOVED_SUBCOMMANDS`).
 * Bare `gtd` with no `--entry` present, or an unknown subcommand, is a usage
 * error. Shared setup (argv parsing, the repo-root guard) lives here; each
 * subcommand's own logic is a named `run*Command` function above.
 */
export function makeProgram(
  opts: RunOptions = {},
): Effect.Effect<void, Error, ProgramRequirements> {
  const argv = opts.argv ?? process.argv
  const write = opts.write ?? ((chunk: string) => process.stdout.write(chunk))
  const json = argv.includes("--json")
  // Skip any index `--entry`/`--var` consumed as a VALUE (e.g. `--entry
  // review-gate.check`'s `review-gate.check`, which carries no `--` prefix of
  // its own) — otherwise it reads as a stray extra positional (see
  // `takeFlagValues`/`flagConsumedIndices`).
  const consumedFlagIndices = flagConsumedIndices(argv)
  const positional = argv
    .map((a, i) => ({ a, i }))
    .slice(2)
    .find(({ a, i }) => !a.startsWith("--") && !consumedFlagIndices.has(i))?.a

  // fallow-ignore-next-line complexity
  return Effect.gen(function* () {
    if (runVersionOrHelp(argv, write)) return

    // `visualize` is dispatched BEFORE the global option check (like lsp/init):
    // it reads config but touches no git/HEAD/review-window, and it owns
    // `--port`/`--no-open`, which the global check does not know.
    if (positional === "visualize") {
      return yield* runVisualizeCommand(argv, json, write)
    }

    // Reject unknown `--` options up front: a typo like `--jsn` must not
    // silently degrade to plain-text mode. `--json`, `--cost=<n>`, `--entry`,
    // and `--var` are the only long options; `--version`/`--help` (and their
    // short forms) short-circuited above. A bare `--cost`/`--entry` (no `=`,
    // no space-separated value) is left for `parseCostFlag`/`parseEntryFlags`
    // to reject with a value-specific message.
    const unknownOption = argv.slice(2).find(
      // fallow-ignore-next-line complexity
      (a) =>
        a.startsWith("--") &&
        a !== "--json" &&
        a !== "--cost" &&
        a !== "--model" &&
        a !== ENTRY_FLAG &&
        a !== VAR_FLAG &&
        !a.startsWith(COST_FLAG) &&
        !a.startsWith(MODEL_FLAG) &&
        !a.startsWith(`${ENTRY_FLAG}=`) &&
        !a.startsWith(`${VAR_FLAG}=`),
    )
    if (unknownOption !== undefined) {
      return yield* Effect.fail(
        new Error(`gtd: unknown option '${unknownOption}' — see \`gtd --help\``),
      )
    }

    // `--cost`/`--model` record the just-finished invocation's token cost and
    // model as a `Gtd-Cost:` trailer on the turn commit (see `parseStepFlags`).
    const { cost, model } = yield* parseStepFlags(argv, positional)
    // `--entry`/`--var` start a brand-new process at a declared state instead
    // of stepping the resting one (see `parseEntryFlags`/`runEntryCommand`).
    const entryFlags = yield* parseEntryFlags(argv, positional)
    if (entryFlags.entry !== undefined && (cost !== undefined || model !== undefined)) {
      return yield* Effect.fail(
        new Error(
          "gtd: --cost/--model cannot be combined with --entry — an entry is not a metered agent turn",
        ),
      )
    }

    if (positional === "lsp") {
      return yield* runLspCommand(argv, json)
    }

    if (positional === "init") {
      return yield* runInitCommand(argv, json, write)
    }

    if (positional === undefined && entryFlags.entry !== undefined) {
      // The subcommand-less short form: `gtd --entry <state> [--var ...]`,
      // equivalent to `gtd step human --entry <state> ...`.
      const git = yield* GitService
      const fs = yield* FileSystem.FileSystem
      return yield* runInReviewWindowBracket(
        git,
        fs,
        runEntryCommand(
          "human",
          entryFlags.entry,
          entryFlags.vars,
          json,
          write,
          `gtd --entry ${entryFlags.entry}`,
        ),
      )
    }

    const sub = yield* requireKnownSubcommand(positional, json, write)

    const git = yield* GitService
    const fs = yield* FileSystem.FileSystem
    yield* runInReviewWindowBracket(
      git,
      fs,
      dispatchKnownSubcommand(sub, argv, json, write, cost, model, entryFlags),
    )
  }).pipe(
    json
      ? Effect.catchAll((error) =>
          Effect.sync(() =>
            write(JSON.stringify({ state: "error", prompt: error.message }) + "\n"),
          ).pipe(Effect.zipRight(Effect.fail(markEnveloped(error)))),
        )
      : (x) => x,
  )
}

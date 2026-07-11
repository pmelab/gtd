import { createRequire } from "node:module"
import { FileSystem } from "@effect/platform"
import { Effect } from "effect"
import { ConfigInit, ConfigService } from "./Config.js"
import { Cwd } from "./Cwd.js"
import { gatherEvents, perform, reviewAgainst } from "./Events.js"
import * as Format from "./Format.js"
import { GitService, type GitOperations } from "./Git.js"
import { predictTurn, resolve, type EdgeAction, type GtdEvent, type Result } from "./Machine.js"
import { buildPrompt } from "./Prompt.js"
import { reviewingSubject } from "./Subjects.js"
import { describeEdgeAction, describeStatus } from "./State.js"
import { TestRunner } from "./TestRunner.js"

const _require = createRequire(import.meta.url)
const GTD_VERSION: string = (_require("../package.json") as { version: string }).version

const HELP_TEXT = `Usage: gtd [command] [options]

Commands:
  step             Advance the workflow as the human actor (to fixpoint)
  step-agent       Advance the workflow as the agent actor (to fixpoint)
  next             Print the prompt for whichever actor is awaited (no mutation)
  status           Predict the next commit and state from the working tree (no mutation)
  review <target>  Anchor an ad-hoc human review against a git ref or branch
  format <file>    Format a markdown file in place

Options:
  --json           Output structured JSON instead of plain text
  --verbose        Show verbose output (thinking deltas, tool events)
  --debug          Show debug-level internal information
  --version, -v    Print version and exit
  --help, -h       Print this help and exit
`

/**
 * Defensive bound on the fixpoint chain `runStep` drives. Each iteration that
 * performs an `edgeAction` must make progress (a commit / file write that
 * changes what `gatherEvents` sees), so a correct machine reaches fixpoint
 * (no `edgeAction`) in a handful of hops. Exceeding this is a machine/edge bug
 * — fail loudly rather than spin forever.
 */
const MAX_EDGE_HOPS = 100

/**
 * Options for the exported `makeProgram` factory.
 * Defaults to `process.argv` and `process.stdout.write` so production wiring is
 * unchanged.
 */
export interface RunOptions {
  /** argv array (e.g. `["node", "gtd.js", "format", "file.md"]`). Defaults to `process.argv`. */
  argv?: string[]
  /** Sink for stdout output. Defaults to `process.stdout.write.bind(process.stdout)`. */
  write?: (chunk: string) => void
}

type ProgramRequirements =
  | GitService
  | FileSystem.FileSystem
  | TestRunner
  | ConfigService
  | ConfigInit
  | Cwd

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

type RunStepResult = {
  readonly state: string
  readonly actions: readonly string[]
  readonly commits: readonly string[]
}

/**
 * Builds `runStep`'s return value once the fixpoint loop has decided to stop:
 * the resolved state, the actions performed so far, and every commit
 * authored since `preHead` (oldest→newest, subject line only). Every stopping
 * branch in the loop below reaches the same shape, differing only in why it
 * stopped.
 */
const stopRunStep = (
  git: GitOperations,
  preHead: string | undefined,
  state: string,
  actions: readonly string[],
): Effect.Effect<RunStepResult, Error, never> =>
  Effect.gen(function* () {
    const commits = yield* git.commitHistory(preHead)
    return { state, actions, commits: commits.map((c) => c.message.split("\n")[0] ?? "") }
  })

/** Mutable bookkeeping `runStep`'s loop carries across hops, read by the stop-condition checks below. */
interface RunStepLoopState {
  readonly performedAny: boolean
  /**
   * Set once this invocation captures the agentic-review turn (records the
   * reviewer's actual verdict). Used below: if the VERY NEXT hop wants to
   * capture ANOTHER fresh turn (findings → fixing), that is a second
   * judgment call and must wait for its own invocation. An approval (empty
   * FEEDBACK.md) doesn't hit this: its next hop is mid-chain `closePackage`,
   * not a captureTurn, so it is untouched by this guard and keeps chaining.
   */
  readonly justCapturedAgenticReviewTurn: boolean
  /**
   * The gate of the most recent captureTurn this invocation performed, if
   * any. Distinguishes two ways of reaching `gtd: tests green` mid-chain:
   * from a FRESH build (gate "building") — the ordinary, fully-automatable
   * fast path, which may continue straight through a force-approve close in
   * the same invocation — versus from a FIX round (gate "fixing") — which
   * always needs its own separate "did the fix actually work" checkpoint
   * before anything else happens, even under force-approve.
   */
  readonly lastCapturedGate: string | undefined
}

/**
 * `gtd: tests green` reached mid-invocation is a stopping point UNLESS this
 * is the ordinary fully-automatable fast path: a fresh BUILD (gate
 * "building") whose green result got force-approved straight to
 * `closePackage` in the same chain. Two distinct guards:
 *  - If it resolves to a genuine REST (a fresh `gtd(agent): agentic-review`
 *    capture is needed — agenticReview is on and the threshold hasn't
 *    force-approved), that's always its own turn: stop regardless of how we
 *    got here.
 *  - If it resolves to a force-approved `closePackage` mid-chain, that may
 *    continue ONLY when we got here via "building"; a `gtd: tests green`
 *    reached via a FIX round (gate "fixing") always needs its own separate
 *    "did the fix actually work" checkpoint first, even under force-approve.
 * Every other rest/mid-chain this loop reaches mid-invocation (package-done →
 * building the next package, awaiting-review → the review turn, etc.) is
 * unaffected by this guard.
 */
const isTestsGreenCheckpoint = (
  result: Result,
  headThisHop: string | undefined,
  loop: RunStepLoopState,
): boolean =>
  loop.performedAny &&
  headThisHop === "gtd: tests green" &&
  (result.state === "agentic-review" || loop.lastCapturedGate === "fixing")

/**
 * A second fresh turn capture right after the agentic-review turn (findings
 * recorded → the resolver wants a NEW `gtd(agent): fixing` capture) is a
 * second judgment call in one invocation — stop and let a fresh
 * `gtd step-agent` do the actual fixing.
 */
const isSecondJudgmentCallAfterAgenticReview = (result: Result, loop: RunStepLoopState): boolean =>
  loop.justCapturedAgenticReviewTurn && result.edgeAction?.kind === "captureTurn"

/**
 * An EMPTY fresh turn capture (nothing dirty to record yet) reached past hop
 * 1 — i.e. arrived at via mid-chain bookkeeping earlier in THIS invocation
 * (`gtd(agent): grilled` → `gtd: planning` landing with no package code
 * written yet; or `gtd: package done` → a fresh review turn with no
 * REVIEW.md authored yet), not as the very first thing this call saw — is a
 * fixpoint: there is nothing more for this invocation to meaningfully
 * decide, so stop rather than author a placeholder turn commit and drive it
 * further. A hop-1 empty capture (this invocation's very first action) is
 * unaffected — that's how an out-of-band recovery re-capture (config fixed
 * after an operational failure, code already committed by an earlier
 * invocation) still proceeds to re-test.
 */
const isStaleEmptyTurnCapture = (
  result: Result,
  resolveEvent: GtdEvent | undefined,
  loop: RunStepLoopState,
): boolean =>
  loop.performedAny &&
  result.edgeAction?.kind === "captureTurn" &&
  resolveEvent?.type === "RESOLVE" &&
  resolveEvent.payload.workingTreeClean

/**
 * True when this hop is one of `runStep`'s documented "this invocation's job
 * is done even though the machine could keep chaining" checkpoints above.
 * (The other stopping point — no `edgeAction` left to perform, a genuine
 * fixpoint — is checked by the caller, which needs the narrowed type.)
 */
const shouldStopRunStepLoop = (
  result: Result,
  resolveEvent: GtdEvent | undefined,
  headThisHop: string | undefined,
  loop: RunStepLoopState,
): boolean =>
  isTestsGreenCheckpoint(result, headThisHop, loop) ||
  isSecondJudgmentCallAfterAgenticReview(result, loop) ||
  isStaleEmptyTurnCapture(result, resolveEvent, loop)

/** Folds one performed `captureTurn` edge action (if any) into the next hop's `RunStepLoopState`. */
const advanceRunStepLoop = (
  loop: RunStepLoopState,
  performedAction: EdgeAction,
): RunStepLoopState => ({
  performedAny: true,
  justCapturedAgenticReviewTurn:
    performedAction.kind === "captureTurn" && performedAction.gate === "agentic-review",
  lastCapturedGate:
    performedAction.kind === "captureTurn" ? performedAction.gate : loop.lastCapturedGate,
})

/** One hop's outcome: either the loop is done (with the final state), or it continues with the folded loop state. */
type RunStepHopOutcome =
  | { readonly kind: "stop"; readonly state: string }
  | { readonly kind: "continue"; readonly loop: RunStepLoopState }

/**
 * Runs exactly one gather → resolve → (perform) hop of `runStep`'s fixpoint
 * loop, mutating `actions` in place with any performed edge action's
 * description, and returns whether the loop should stop here (with the
 * resolved state) or continue with the folded loop state.
 *
 * Refusals only fail on the very first hop: past that, a refusal result is
 * how the loop notices the chain has handed the turn to the OTHER actor (a
 * human step's grilling-accept chain lands on the agent-awaited grilled rest;
 * an agent step's review chain lands on the human-awaited await-review rest).
 * The work already performed is legitimate — the refusal carries no
 * `edgeAction`, so the loop simply stops at that state instead of erroring.
 */
const runStepHop = (
  invoker: "human" | "agent",
  loop: RunStepLoopState,
  actions: string[],
): Effect.Effect<RunStepHopOutcome, Error, ProgramRequirements> =>
  Effect.gen(function* () {
    const events = yield* gatherEvents(invoker)
    const result = yield* Effect.try({
      try: () => resolve(events),
      catch: (e) => (e instanceof Error ? e : new Error(String(e))),
    })

    if (result.refusal !== undefined && !loop.performedAny) {
      return yield* Effect.fail(new Error(result.refusal))
    }

    const resolveEvent = events.find((e) => e.type === "RESOLVE")
    const headThisHop =
      resolveEvent?.type === "RESOLVE" ? resolveEvent.payload.lastCommitSubject : undefined

    if (
      result.edgeAction === undefined ||
      shouldStopRunStepLoop(result, resolveEvent, headThisHop, loop)
    ) {
      return { kind: "stop", state: result.state }
    }

    const edgeAction = result.edgeAction

    actions.push(describeEdgeAction(edgeAction))
    const { stop } = yield* perform(edgeAction)
    const nextLoop = advanceRunStepLoop(loop, edgeAction)
    return stop ? { kind: "stop", state: result.state } : { kind: "continue", loop: nextLoop }
  })

/**
 * Drives the fixpoint loop for `gtd step` / `gtd step-agent`: gather → resolve
 * → (perform the returned `edgeAction`) → repeat until `resolve` returns no
 * `edgeAction` (fixpoint) or the resolver reports a `refusal` (out-of-turn
 * step-agent invocation). See `runStepHop` for the per-hop logic and
 * `RunStepLoopState`'s field docs for what carries across hops.
 *
 * Returns the ordered list of authored commit subjects (oldest→newest) and the
 * human-readable descriptions of every edge action performed, plus the final
 * resolved state.
 */
const runStep = (
  invoker: "human" | "agent",
): Effect.Effect<RunStepResult, Error, ProgramRequirements> =>
  Effect.gen(function* () {
    const git = yield* GitService
    const preHead = yield* git
      .hasCommits()
      .pipe(
        Effect.flatMap((hasCommits) =>
          hasCommits ? git.resolveRef("HEAD") : Effect.succeed(undefined),
        ),
      )

    const actions: string[] = []
    let hops = 0
    let loop: RunStepLoopState = {
      performedAny: false,
      justCapturedAgenticReviewTurn: false,
      lastCapturedGate: undefined,
    }

    while (true) {
      hops += 1
      if (hops > MAX_EDGE_HOPS) {
        return yield* Effect.fail(
          new Error(`edge loop exceeded ${MAX_EDGE_HOPS} hops without reaching fixpoint`),
        )
      }

      const outcome = yield* runStepHop(invoker, loop, actions)
      if (outcome.kind === "stop") {
        return yield* stopRunStep(git, preHead, outcome.state, actions)
      }
      loop = outcome.loop
    }
  })

/** Non-flag positional arguments past the subcommand name (argv[3..]). */
const commandArgs = (argv: readonly string[]): string[] =>
  argv.slice(3).filter((a) => a.length > 0 && !a.startsWith("--"))

/** `gtd format <file>`: reformat a markdown file in place. Rejects `--json` (not a v2 state command). */
const runFormatCommand = (
  argv: readonly string[],
  json: boolean,
): Effect.Effect<void, Error, ProgramRequirements> =>
  Effect.gen(function* () {
    if (json) {
      return yield* Effect.fail(new Error("gtd format does not accept --json"))
    }
    const args = commandArgs(argv)
    if (args.length === 0) {
      return yield* Effect.fail(new Error("gtd format: missing file path argument"))
    }
    if (args.length > 1) {
      return yield* Effect.fail(
        new Error(`gtd format: too many arguments — expected one path, got: ${args.join(", ")}`),
      )
    }
    yield* Format.formatFile(args[0]!)
  })

/** `gtd step` / `gtd step-agent`: drive the fixpoint loop and report what it did. */
const runStepCommand = (
  sub: "step" | "step-agent",
  json: boolean,
  write: (chunk: string) => void,
): Effect.Effect<void, Error, ProgramRequirements> =>
  Effect.gen(function* () {
    const invoker = sub === "step" ? ("human" as const) : ("agent" as const)
    const { state, actions, commits } = yield* runStep(invoker)
    if (json) {
      write(JSON.stringify({ state, actions, commits }) + "\n")
    } else {
      for (const subject of commits) {
        write(`committed: ${subject}\n`)
      }
      write(`state: ${state}\n`)
    }
  })

/** `gtd next`: pure prompt emitter for whichever actor is awaited (no mutation). */
const runNextCommand = (
  git: GitOperations,
  config: ConfigService["Type"],
  json: boolean,
  write: (chunk: string) => void,
): Effect.Effect<void, Error, ProgramRequirements> =>
  Effect.gen(function* () {
    const status = yield* git.statusPorcelain()
    if (status.trim().length > 0) {
      return yield* Effect.fail(
        new Error(
          "gtd next: working tree is dirty — run `gtd status` to inspect it, then advance with `gtd step` or `gtd step-agent` (whichever actor is awaited)",
        ),
      )
    }
    const events = yield* gatherEvents("none")
    const result = yield* Effect.try({
      try: () => resolve(events),
      catch: (e) => (e instanceof Error ? e : new Error(String(e))),
    })
    if (result.pending) {
      // Mid-chain bookkeeping is invoker-agnostic (`applyTurnTaking` hands the
      // edge action to either actor's step), so `actor` names whose chain it
      // is — a loop driver keys on it: "agent" means proceed (another
      // `step-agent` round), "human" means halt. The plain message points at
      // the natural resuming command for that actor.
      if (json) {
        write(
          JSON.stringify({
            state: result.state,
            actor: result.actor,
            pending: true,
            prompt: null,
          }) + "\n",
        )
      } else {
        write(
          result.actor === "agent"
            ? "mid-chain checkpoint — run `gtd step-agent` to continue, then run `gtd next` again\n"
            : "mid-chain checkpoint — run `gtd step` to continue\n",
        )
      }
      return
    }
    const builtPrompt = buildPrompt(result, config.resolveModel, json ? "json" : "plain")
    if (json) {
      write(
        JSON.stringify({
          state: result.state,
          actor: result.actor,
          pending: false,
          prompt: builtPrompt,
        }) + "\n",
      )
    } else {
      write(builtPrompt)
    }
  })

/** `gtd status`: pure dry-run predictor of the next commit and state (no mutation). */
const runStatusCommand = (
  argv: readonly string[],
  json: boolean,
  write: (chunk: string) => void,
): Effect.Effect<void, Error, ProgramRequirements> =>
  Effect.gen(function* () {
    const args = commandArgs(argv)
    if (args.length > 0) {
      return yield* Effect.fail(
        new Error(`gtd status: too many arguments — expected none, got: ${args.join(", ")}`),
      )
    }
    const events = yield* gatherEvents("none")
    const prediction = yield* Effect.try({
      try: () => predictTurn(events),
      catch: (e) => (e instanceof Error ? e : new Error(String(e))),
    })
    const summary = describeStatus(prediction)
    if (json) {
      write(JSON.stringify(summary) + "\n")
    } else {
      write(
        [
          `State: ${summary.state}`,
          `Awaits: ${summary.actor}`,
          `Predicted commit: ${summary.predictedCommit ?? "(none)"}`,
          `Predicted state: ${summary.predictedState}`,
        ].join("\n") + "\n",
      )
    }
  })

/** `gtd review <target>`: pure mutator that anchors an ad-hoc human review commit. */
const runReviewCommand = (
  argv: readonly string[],
  git: GitOperations,
  json: boolean,
  write: (chunk: string) => void,
): Effect.Effect<void, Error, ProgramRequirements> =>
  Effect.gen(function* () {
    const args = commandArgs(argv)
    if (args.length === 0) {
      return yield* Effect.fail(new Error("gtd review: missing target argument"))
    }
    if (args.length > 1) {
      return yield* Effect.fail(
        new Error(`gtd review: too many arguments — expected one target, got: ${args.join(", ")}`),
      )
    }
    const target = args[0]!
    const status = yield* git.statusPorcelain()
    if (status.trim().length > 0) {
      return yield* Effect.fail(
        new Error("gtd review: working tree is dirty — commit or stash before reviewing"),
      )
    }
    const reviewResult = yield* reviewAgainst(target).pipe(
      Effect.catchAll((error) =>
        Effect.fail(new Error(`gtd review: cannot resolve ref '${target}': ${error.message}`)),
      ),
    )
    if (reviewResult === undefined) {
      return yield* Effect.fail(
        new Error(`gtd review: nothing to review (${target} diff is empty after filtering)`),
      )
    }
    const { reviewBase } = reviewResult
    yield* git.commitAllWithPrefix(reviewingSubject(reviewBase))
    if (json) {
      write(JSON.stringify({ state: "review", reviewBase, pending: false, prompt: null }) + "\n")
    } else {
      write(`anchored review at ${reviewBase} — run \`gtd next\` to get the review prompt\n`)
    }
  })

const KNOWN_SUBCOMMANDS = ["step", "step-agent", "next", "status", "review"] as const
type KnownSubcommand = (typeof KNOWN_SUBCOMMANDS)[number]

/**
 * `--version`/`-v` or `--help`/`-h`: short-circuits before any git or state
 * work, so it works outside a repo too. Exported so main.ts can run the same
 * check synchronously BEFORE the Effect runtime builds any layer — layer
 * construction must never observe a version/help invocation.
 */
export const runVersionOrHelp = (
  argv: readonly string[],
  write: (chunk: string) => void,
): boolean => {
  if (argv.includes("--version") || argv.includes("-v")) {
    write(GTD_VERSION + "\n")
    return true
  }
  if (argv.includes("--help") || argv.includes("-h")) {
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
  if (!(KNOWN_SUBCOMMANDS as readonly string[]).includes(sub)) {
    return Effect.fail(new Error(`unknown command '${sub}'`))
  }
  return Effect.succeed(sub as KnownSubcommand)
}

/**
 * Everything gtd derives — steering files, diffs, pathspecs — is resolved
 * against the process cwd, so running from anywhere but the repository root
 * would silently mis-derive state. Refuses with a clear error instead. (Fails
 * fast outside a repository too: `--show-toplevel` errors there.) Real paths
 * are compared so symlinked cwds (e.g. macOS /tmp → /private/tmp) match.
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

/** Dispatches to the named `run*Command` handler for every subcommand but `format` (handled by the caller). */
const dispatchKnownSubcommand = (
  sub: KnownSubcommand,
  argv: readonly string[],
  git: GitOperations,
  config: ConfigService["Type"],
  json: boolean,
  write: (chunk: string) => void,
): Effect.Effect<void, Error, ProgramRequirements> => {
  switch (sub) {
    case "step":
    case "step-agent":
      return runStepCommand(sub, json, write)
    case "next":
      return runNextCommand(git, config, json, write)
    case "status":
      return runStatusCommand(argv, json, write)
    case "review":
      return runReviewCommand(argv, git, json, write)
  }
}

/**
 * Factory that returns the gtd driver Effect with the given I/O options.
 *
 * The returned Effect requires `GitService | FileSystem.FileSystem | TestRunner | ConfigService | Cwd`.
 * Production code calls this with no arguments; the test world supplies an
 * in-memory layer set and captures stdout via the `write` callback.
 *
 * v2 command surface: `step` / `step-agent` (mutators, drive to fixpoint),
 * `next` (pure prompt emitter), `status` (pure dry-run predictor),
 * `review <target>` (pure mutator: anchors a review commit), `format <file>`
 * (unchanged from v1). Bare `gtd` or an unknown subcommand is a usage error.
 * Shared setup (argv parsing, the repo-root guard) lives here; each
 * subcommand's own logic is a named `run*Command` function above.
 */
export function makeProgram(
  opts: RunOptions = {},
): Effect.Effect<void, Error, ProgramRequirements> {
  const argv = opts.argv ?? process.argv
  const write = opts.write ?? ((chunk: string) => process.stdout.write(chunk))
  const json = argv.includes("--json")
  const positional = argv.slice(2).find((a) => !a.startsWith("--"))

  return Effect.gen(function* () {
    if (runVersionOrHelp(argv, write)) return

    if (positional === "format") {
      return yield* runFormatCommand(argv, json)
    }

    const sub = yield* requireKnownSubcommand(positional, json, write)

    const git = yield* GitService
    const fs = yield* FileSystem.FileSystem
    yield* assertRunningFromRepoRoot(git, fs)
    // Auto-init runs here and ONLY here: past the version/help short-circuit,
    // the format branch, the known-subcommand guard, and the repo-root guard —
    // a refused or rejected invocation must never mutate the repository.
    yield* (yield* ConfigInit).ensure
    const config = yield* ConfigService

    yield* dispatchKnownSubcommand(sub, argv, git, config, json, write)
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

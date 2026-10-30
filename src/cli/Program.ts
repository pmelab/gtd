import { Effect, Option, Schema } from "effect"
import {
  GtdError,
  GtdUsageError,
  Narrator,
  GitService,
  Host,
  Workspace,
  type GitOperations,
  type HostOps,
  HISTORY_REF,
  readRetainedHistory,
  restorability,
  loopLogPath,
} from "../platform/index.js"
import {
  WORKFLOW_MODULE,
  ConfigDiscovery,
  EngineCore,
  pin,
  refuseLegacyRc,
  ConfigService,
  formatDiagnostic,
  seededValidateCommand,
  type PendingChange,
  type StateMode,
  type StateName,
  type WorkflowDefinition,
} from "../workflow/index.js"
import type { Door } from "../flows/index.js"
import {
  resolveSession,
  beatDocument,
  beatKindOf,
  demandOf,
  landFields,
  noopText,
  renderBeatJson,
  DEMAND_BRIEFING,
  renderBeatPlain,
  renderLandJson,
  renderLandPlain,
  statusOf,
  type BeatDocument,
  type BeatKind,
  type NextMatch,
  type StatusChange,
  selectPath,
  EXIT_OK,
} from "../wire/index.js"
import {
  currentRest,
  startRefusal,
  currentRun,
  renderRest,
  restAt,
  previewLanding,
  noProcessUnderway,
  restIsIdle,
  reviewBaseFor,
  snapshotFromRest,
  stalledAt,
  summaryFor,
  summaryRun,
  type RenderedRest,
} from "../edge/index.js"
import { planStart, planStep as planStepPure, type JudgeVerdict } from "../step/index.js"
import {
  BUILT_IN_MODE_NAMES,
  steeringFormatFor,
  openThreads,
  parseCodeThreads,
  unansweredQuestions,
  formatFinding,
  type SteeringFormat,
} from "../steering/internal.js"
import {
  resolveMode,
  validateScriptFor,
  deleteRef,
  hardResetTo,
  mixedResetTo,
  ScriptSurface,
  updateRef,
  type RunnableScript,
  combinedScript,
  commandForFile,
  emitScripts,
  type EmitStep,
  abandonedOutcome,
  abandonNoopOutcome,
  restoredOutcome,
} from "../emit/index.js"
import { GTD_VERSION, renderBriefing, WORKFLOWS_REPO } from "../install/index.js"
import { ToolCommands, type SelfGtd } from "./ToolCommands.js"
import {
  normalizeScriptNewline,
  SelectorUsageError,
  writeJson,
  writeScript,
  writeSelection,
  type ArtifactOut,
  type CommandRequirements,
  type JsonMode,
  type SuccessExit,
} from "./Output.js"
export {
  SelectorUsageError,
  type ArtifactOut,
  type CommandRequirements,
  type JsonMode,
  type SuccessExit,
} from "./Output.js"
import { runStraysCommand } from "./Strays.js"
import { runHistoryFetchCommand, runHistoryListCommand, runHistoryShowCommand } from "./History.js"
import { runHistoryJudgesCommand } from "./Judges.js"
import { runHistoryMetricsCommand } from "./Metrics.js"

/**
 * `Edge.ts`'s `Rest` is module-private (`.gtd/packages/05-step-core.md`
 * Commit 4) — every command here still needs its shape, so this derives the
 * SAME type structurally off `currentRest`'s own success type rather than
 * importing the name.
 */
type Rest = Effect.Success<typeof currentRest>

export type Command =
  | { readonly kind: "lsp" }
  | {
      readonly kind: "ui"
      // `host`/`port` stay optional/undefined-when-absent: a resolved bind address/port is
      // `ui: { host?, port? }` config-file values merged in downstream
      // (`src/ui/Server.ts`), which the argv parser never
      // reads — an absent flag here must not shadow a configured value with
      // a parser-invented default.
      readonly host?: string
      readonly port?: number
      readonly selfSigned: boolean
      readonly dev: boolean
    }
  | {
      readonly kind: "land"
      readonly cost?: number
      readonly model?: string
    }
  | {
      readonly kind: "start"
      /** A door or a workflow; absent lists both. */
      readonly name?: string
      readonly args: readonly string[]
      readonly vars: Readonly<Record<string, string>>
    }
  | { readonly kind: "abandon" }
  | { readonly kind: "restore" }
  | { readonly kind: "next" }
  | { readonly kind: "validate" }
  | {
      readonly kind: "check"
      /** Absent only for the bare `gtd check --open-threads` form. */
      readonly mode?: string
      readonly file?: string
      readonly openQuestions?: boolean
      readonly openThreads?: boolean
    }
  | { readonly kind: "uncheck"; readonly file: string }
  | { readonly kind: "guide" }
  | { readonly kind: "bundle" }
  | { readonly kind: "summary" }
  | { readonly kind: "base" }
  | { readonly kind: "judge" }
  | { readonly kind: "judgeAnswer" }
  | { readonly kind: "historyList" }
  | { readonly kind: "historyShow"; readonly ref: string }
  | { readonly kind: "historyMetrics"; readonly refs: readonly string[] }
  | {
      readonly kind: "historyJudges"
      readonly refs: readonly string[]
      readonly vars: Readonly<Record<string, string>>
      readonly jsonl: boolean
    }
  | { readonly kind: "historyFetch"; readonly remote: string }
  | {
      readonly kind: "strays"
      /** Each side of `<base>..<tip>`; an empty side is `HEAD`, as git reads it. */
      readonly base: string
      readonly tip: string
      readonly globs: readonly string[]
    }
  | {
      readonly kind: "judgeRun"
      readonly provider?: "fixed" | "jev" | "llm"
      readonly answers?: string
      readonly model?: string
    }

/**
 * What a command kind needs before it may run. `pure`/`removed` never reach
 * `io.layers()` at all (they resolve to `output`/`usage` plans). `state`
 * marks the six kinds sharing the repo-root guard and the at-least-one-commit
 * guard — a repository with no commits has no HEAD to derive workflow state
 * from.
 */
export type Needs = "pure" | "removed" | "none" | "fs" | "state"

const selfGtd = (): SelfGtd => {
  const script = process.argv[1]
  return script === undefined ? ["gtd"] : [process.execPath, script]
}

/** `needs: "none"` skips the repo-root guard — the server is keyed on file name, not workflow state. */
const runLspCommand = (): Effect.Effect<void, Error, ToolCommands> =>
  Effect.flatMap(ToolCommands, (tools) => tools.lsp(selfGtd()))

/**
 * Prints the briefing, emitted by the binary itself so it's always current.
 * gtd ships no workflow, so where no `gtd.config.ts` governs it says where to
 * get one; it writes nothing.
 */
const runGuideCommand = (
  out: ArtifactOut,
): Effect.Effect<void, Error, GitService | Host | ConfigDiscovery | Narrator> =>
  Effect.gen(function* () {
    const briefing = renderBriefing()
    out.write(briefing.endsWith("\n") ? briefing : briefing + "\n")
    const host = yield* Host
    const topLevel = yield* Effect.result((yield* GitService).topLevel())
    if (topLevel._tag === "Failure") return
    if ((yield* host.realPath(topLevel.success)) !== (yield* host.realPath(host.root))) return
    if ((yield* (yield* ConfigDiscovery).workflowModule(host.root, host.home)) !== undefined) return
    yield* (yield* Narrator).warn(
      `gtd guide: no ${WORKFLOW_MODULE} governs here, and gtd ships no workflow — get one from ${WORKFLOWS_REPO} or write your own (step 2 of the briefing above)`,
    )
  })

/** Loads the workflow first, so a pin is never made of one gtd would refuse. */
const runBundleCommand = (
  out: ArtifactOut,
): Effect.Effect<
  void,
  Error,
  ConfigService | ConfigDiscovery | EngineCore | Host | Narrator | Workspace
> =>
  Effect.gen(function* () {
    yield* (yield* ConfigService).load
    const host = yield* Host
    const module = yield* (yield* ConfigDiscovery).workflowModule(host.root, host.home)
    // Inside a pin, load read the pinned workflow, not a config on disk.
    if (module === undefined) {
      return yield* Effect.fail(new GtdError(`gtd bundle: no ${WORKFLOW_MODULE} here or above`))
    }
    out.write(yield* pin(module, host.root, GTD_VERSION))
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
 * `combinedScript`, narrowed to accept only an already-guarded
 * `RunnableScript` for `required` — the one boundary `ScriptSurface`'s brand
 * exists to protect: `gtd land`/`gtd start`'s emitted script. Every OTHER
 * `combinedScript` call (`abandon`/`restore`/steering validate, below) builds
 * from `emitScripts` directly and keeps the unbranded signature — those
 * paths land no guard-gated git write for a brand to protect.
 */
const landingScript = (required: RunnableScript): string => combinedScript(required, "")

// git's empty-tree object — recognizes a process starting at the repository's
// very first commit (no earlier commit to rewind to).
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

/**
 * `gtd land`'s own flags, threaded as one bag rather than growing
 * `planLanding`/`runLandCommand`'s positional list. `judge` is `gtd judge
 * answer`'s own extra: `planLanding({ judge })` is the ONE landing path both
 * commands share — `runJudgeAnswerCommand` supplies verdicts, plain
 * `gtd land` never does.
 */
interface LandOptions {
  readonly cost?: number
  readonly model?: string
  readonly judge?: readonly JudgeVerdict[]
}

/** Decides `gtd land`'s one transition without performing it. Refusals fail the Effect; a no-op returns `subject: null` and empty scripts. */
const planLanding = (
  opts: LandOptions = {},
  current?: Rest,
): Effect.Effect<LandResult, Error, CommandRequirements> =>
  Effect.gen(function* () {
    const rest = current ?? (yield* currentRest)
    const snapshot = yield* snapshotFromRest(rest, opts.judge)
    const outcome = planStepPure(snapshot, opts)

    if (outcome.kind === "refusal") {
      return yield* Effect.fail(new Error(outcome.message))
    }
    if (outcome.kind === "noop") {
      const required = ScriptSurface.render([
        { kind: "outcome", outcome: { kind: "note", text: noopText(outcome.state) } },
      ])
      return {
        state: outcome.state,
        subject: null,
        cost: null,
        model: null,
        script: normalizeScriptNewline(landingScript(required)),
        settled: outcome.settled,
        idle: outcome.state === rest.def.initial,
      }
    }

    const required = ScriptSurface.render(outcome.steps)
    return {
      state: outcome.to,
      subject: outcome.subject,
      cost: opts.cost ?? null,
      model: opts.model ?? null,
      script: normalizeScriptNewline(landingScript(required)),
      settled: false,
      idle: outcome.to === rest.def.initial,
    }
  })

/**
 * `gtd summary`: print the prompt for an agent to write the process HEAD
 * closes or sits inside its own closing message. Writes nothing — no git, no
 * state transition, no file. Refuses (throws, mapped to the runtime-error
 * exit code) when the workflow declares no `summary` prompt, or the resolved
 * run has no commits to name.
 */
const runSummaryCommand = (out: ArtifactOut): Effect.Effect<void, Error, CommandRequirements> =>
  Effect.gen(function* () {
    const run = yield* summaryRun
    const { prompt } = yield* summaryFor(run)
    if (prompt === undefined) {
      return yield* Effect.fail(
        new Error(
          `gtd summary: refused — either this workflow declares no "summary:" template, or ` +
            `there is no finished/in-flight process to summarize at HEAD`,
        ),
      )
    }
    out.write(prompt.endsWith("\n") ? prompt : prompt + "\n")
  })

/** Prints the review anchor hash bare, so an external tool can be pointed at the range under review. Nothing is written. Refuses when the run has no commits, where the hash would name a range with no review. */
const runBaseCommand = (out: ArtifactOut): Effect.Effect<void, Error, CommandRequirements> =>
  Effect.gen(function* () {
    const rest = yield* currentRest
    if (rest.run.trace.length === 0) {
      return yield* Effect.fail(new Error("gtd base: refused — no process is underway at HEAD"))
    }
    const base = reviewBaseFor(rest)
    out.write(`${base}\n`)
  })

/** A read-only peek at the pending judgment — the same document `gtd next --json` carries. Refuses when the rest is not a judge step. `--json`'s three shapes match `gtd next`/`gtd land`. */
const runJudgeCommand = (
  json: JsonMode,
  out: ArtifactOut,
): Effect.Effect<void, Error, CommandRequirements> =>
  Effect.gen(function* () {
    const rest = yield* currentRest
    const rendered = yield* renderRest(rest)
    if (rendered.judge === undefined) {
      return yield* Effect.fail(
        new Error(`gtd judge: refused — the resolved rest ("${rest.state}") declares no "judge:"`),
      )
    }
    const document = rendered.judge.endsWith("\n") ? rendered.judge : `${rendered.judge}\n`
    if (json.kind === "select") {
      const parsed = yield* Effect.try({
        try: () => JSON.parse(rendered.judge!) as unknown,
        catch: () =>
          new SelectorUsageError(
            'gtd judge: the resolved rest\'s "judge:" template did not render valid JSON',
          ),
      })
      const selection = selectPath(parsed, json.path)
      if (selection.kind === "value") {
        out.write(`${selection.text}\n`)
      } else if (selection.kind === "unknown") {
        return yield* Effect.fail(
          new SelectorUsageError(
            `gtd: unknown --json selector "${selection.path}" — see \`gtd --help\``,
          ),
        )
      }
      return
    }
    out.write(document)
  })

/** `gtd judge`'s own rendered document shape — only the `id` of each question is read here, to build the verdict's own Effect Schema. */
interface JudgeQuestion {
  readonly id: string
}
interface JudgeDocument {
  readonly questions: readonly JudgeQuestion[]
}

const parseJudgeDocument = (rendered: string): Effect.Effect<JudgeDocument, Error> =>
  Effect.try({
    try: () => JSON.parse(rendered) as JudgeDocument,
    catch: () =>
      new Error(
        'gtd judge answer: the resolved rest\'s "judge:" template did not render valid JSON',
      ),
  })

/**
 * The first stdin-consuming command outside `src/lsp/Lsp.ts` (which reads LSP's
 * own length-prefixed frames off `process.stdin`, not a one-shot read) —
 * reads stdin to completion and decodes it as UTF-8 text, no framing.
 */
const readStdin = (): Effect.Effect<string, Error> =>
  Effect.tryPromise({
    try: async () => {
      const chunks: Buffer[] = []
      for await (const chunk of process.stdin as AsyncIterable<Buffer>) {
        chunks.push(chunk)
      }
      return Buffer.concat(chunks).toString("utf8")
    },
    catch: (e) => (e instanceof Error ? e : new Error(String(e))),
  })

/** A stdin that is no judgment is the caller's mistake, a usage error like `gtd judge answer`'s. */
const judgmentShape = (input: string): Effect.Effect<void, GtdUsageError> => {
  let doc: unknown
  try {
    doc = JSON.parse(input)
  } catch {
    return Effect.fail(new GtdUsageError("gtd judge run: stdin is not valid JSON"))
  }
  const questions = (doc as { questions?: unknown } | null)?.questions
  return Array.isArray(questions)
    ? Effect.void
    : Effect.fail(new GtdUsageError('gtd judge run: stdin has no "questions" array'))
}

/** Stdout is written once, after the answerer resolves — a rejection leaves it empty. */
const runJudgeRunCommand = (
  command: Extract<Command, { kind: "judgeRun" }>,
  out: ArtifactOut,
): Effect.Effect<void, Error, Host | Narrator | ConfigDiscovery | ToolCommands> =>
  Effect.gen(function* () {
    const host = yield* Host
    const tools = yield* ToolCommands
    yield* refuseLegacyRc
    const input = yield* readStdin()
    yield* judgmentShape(input)
    const verdict = yield* Effect.tryPromise({
      try: () =>
        tools.judge({
          provider: command.provider,
          answers: command.answers,
          model: command.model,
          cwd: host.scratchDir,
          env: host.env,
          input,
        }),
      catch: (e) => (e instanceof Error ? e : new Error(String(e))),
    })
    out.write(verdict)
  })

/** A verdict's own `answer` shape covers every `judge:` primitive (`noul` → boolean, `choice` → string, `score` → number) without gtd itself interpreting which one applies — that's a driver/judge-model concern, not this decode's. */
const VerdictAnswer = Schema.Union([Schema.String, Schema.Number, Schema.Boolean])

/**
 * One `gtd judge answer` verdict entry per pending question, `{ id, answer,
 * p }` — `id` constrained to the pending state's OWN question ids (never a
 * bare string), so a verdict naming a question this rest never asked fails
 * to decode rather than silently being ignored. `ids.length === 0` (a
 * `judge:` that rendered no questions) constrains `id` to `Schema.Never`,
 * accepting only the empty array — there is nothing to answer.
 */
const verdictSchemaFor = (ids: readonly string[]) =>
  Schema.Array(
    Schema.Struct({
      id: ids.length > 0 ? Schema.Literals(ids) : Schema.Never,
      answer: VerdictAnswer,
      // Bounded [0, 1] — every OTHER bound in the routes: matching path fails
      // CLOSED (a non-finite rendered minP/maxP never matches); an
      // unvalidated p wouldn't: a driver bug or a miscalibrated model
      // sending p > 1 would clear every minP a workflow declares,
      // unconditionally forcing the judged route on a live gate.
      p: Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
    }),
  )

/**
 * Decodes a verdict off stdin against the pending judgment's question ids,
 * then lands through the SAME `planLanding` path `gtd land` uses, so the two
 * can never drift on the script contract, `settled`/`idle`, or the
 * `Gtd-Judge:` trailer. `--json` emits the same `LandFields`.
 */
const runJudgeAnswerCommand = (
  json: JsonMode,
  out: ArtifactOut,
): Effect.Effect<void, Error, CommandRequirements> =>
  Effect.gen(function* () {
    const rest = yield* currentRest
    const rendered = yield* renderRest(rest)
    if (rendered.judge === undefined) {
      return yield* Effect.fail(
        new Error(
          `gtd judge answer: refused — the resolved rest ("${rest.state}") declares no "judge:"`,
        ),
      )
    }
    const document = yield* parseJudgeDocument(rendered.judge)
    const ids = document.questions.map((q) => q.id)

    const raw = yield* readStdin()
    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw) as unknown,
      catch: () => new SelectorUsageError("gtd judge answer: stdin is not valid JSON"),
    })
    const verdict = yield* Schema.decodeUnknownEffect(verdictSchemaFor(ids))(parsed).pipe(
      Effect.mapError(
        (e) =>
          new SelectorUsageError(
            `gtd judge answer: the verdict on stdin does not match the pending questions — ${e.message}`,
          ),
      ),
    )

    const result = yield* planLanding({ judge: verdict }, rest)
    const built = landFields(result)
    if (json.kind === "document") {
      out.write(renderLandJson(built))
    } else if (json.kind === "select") {
      yield* writeSelection(out, built, json.path)
    } else {
      out.write(renderLandPlain(built, "judge answer"))
    }
  })

/**
 * Lands whatever the tree shows at the resolved rest. Plain output is prose
 * and never the script; `--json` carries it, so that stays the machine path a
 * driver pipes to `sh`. Exit code is uniformly `EXIT_OK` on success — whose
 * turn is next lives in the following `gtd next --json`'s `kind`.
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
 * Starts a brand new process on `<workflow>`, always as `"human"`. Captures
 * whatever the working tree carries at the start, like an ordinary land,
 * rather than demanding a clean tree.
 *
 * An unknown name is a usage error. Refused when a process is already
 * underway, the workflow reaches no step, a `--var` name is undeclared, or
 * `base` renders to something that is not an ancestor of (and differs from)
 * HEAD.
 */
const startWorkflow = (
  workflow: string,
  varOverrides: Record<string, string>,
  json: JsonMode,
  out: ArtifactOut,
  commandLabel: string,
): Effect.Effect<void, Error, CommandRequirements> =>
  Effect.gen(function* () {
    const config = yield* (yield* ConfigService).load
    const resolved = config.workflowNamed(workflow)
    if (resolved === undefined) {
      const startable =
        config.workflowNames.length > 0
          ? `startable: ${config.workflowNames.join(", ")}`
          : "this config exports no workflow besides its default, which an ordinary start runs"
      return yield* Effect.fail(
        new GtdUsageError(`${commandLabel}: unknown workflow "${workflow}" — ${startable}`),
      )
    }
    const rest = yield* restAt(undefined, varOverrides)
    const started = yield* startRefusal(rest, resolved, varOverrides)
    const plan = yield* planStart(
      {
        state: rest.state,
        idle: noProcessUnderway(rest),
      },
      "human",
      {
        workflow: resolved,
        first: started,
        commandLabel,
        vars: varOverrides,
        config: rest.config,
      },
    )
    if (plan.kind === "refusal") {
      return yield* Effect.fail(new Error(plan.message))
    }
    yield* writeScript(
      json,
      out,
      listingCommitted(landingScript(ScriptSurface.render(plan.steps)), rest.changes),
    )
  })

/**
 * A start commits the whole tree (`git add -A`), so its script says up front
 * which paths that is. Comment lines only: control characters are masked so a
 * path can never end the comment and become a command.
 */
const listingCommitted = (script: string, changes: readonly PendingChange[]): string => {
  if (changes.length === 0) return script
  const listing = [
    "# commits every change in the working tree (git add -A):",
    ...changes.map((change) => `#   ${change.status} ${change.path.replace(/\p{Cc}/gu, "?")}`),
  ].join("\n")
  const at = script.indexOf("\n\n")
  return at === -1 ? script : `${script.slice(0, at)}\n\n${listing}${script.slice(at)}`
}

const doorSynopsis = (name: string, door: Door): string =>
  [
    name,
    ...(door.args ?? []).map((arg) => (arg.optional === true ? `[${arg.name}]` : `<${arg.name}>`)),
  ].join(" ")

/** A door's start: its args mapped to process settings, `extra` (`--var`) pinned on top. */
const startThroughDoor = (
  name: string,
  door: Door,
  args: readonly string[],
  extra: Readonly<Record<string, string>>,
  json: JsonMode,
  out: ArtifactOut,
): Effect.Effect<void, Error, CommandRequirements> =>
  Effect.gen(function* () {
    const label = `gtd start ${name}`
    const declared = door.args ?? []
    const required = declared.filter((arg) => arg.optional !== true).length
    if (args.length < required || args.length > declared.length) {
      return yield* Effect.fail(
        new GtdUsageError(
          `${label}: ${args.length < required ? "missing" : "too many"} arguments — usage: gtd start ${doorSynopsis(name, door)}`,
        ),
      )
    }
    const named: Record<string, string | undefined> = {}
    declared.forEach((arg, i) => {
      named[arg.name] = args[i]
    })
    const vars = yield* Effect.try({
      try: () => door.vars?.(named) ?? {},
      catch: (e) => new Error(`${label}: ${e instanceof Error ? e.message : String(e)}`),
    })
    yield* startWorkflow(door.workflow, { ...vars, ...extra }, json, out, label)
  })

/**
 * `gtd start <name> [args…]`: a door when `<name>` is one — so a door shadows
 * the workflow it shares a name with — else a workflow, which takes no args.
 * No name lists both.
 */
const runStartCommand = (
  command: Extract<Command, { kind: "start" }>,
  json: JsonMode,
  out: ArtifactOut,
): Effect.Effect<void, Error, CommandRequirements> =>
  Effect.gen(function* () {
    const { name, args, vars } = command
    if (name === undefined) return yield* runStartListCommand(json, out)
    const label = `gtd start ${name}`
    const config = yield* (yield* ConfigService).load
    const door = config.doors.get(name)
    if (door !== undefined) {
      return yield* startThroughDoor(name, door, args, vars, json, out)
    }
    if (config.workflowNamed(name) === undefined) {
      return yield* Effect.fail(
        new GtdUsageError(
          `${label}: no workflow or door is named "${name}" — run \`gtd start\` to list them`,
        ),
      )
    }
    if (args.length > 0) {
      return yield* Effect.fail(
        new GtdUsageError(
          `${label}: too many arguments — a workflow takes none, only --var <name>=<value>; got: ${args.join(", ")}`,
        ),
      )
    }
    yield* startWorkflow(name, { ...vars }, json, out, label)
  })

/**
 * Bare `gtd start`: every workflow startable by name, then every door — plain
 * lines, or one JSON array. A workflow a door shadows is left out: its name
 * opens the door.
 */
const runStartListCommand = (
  json: JsonMode,
  out: ArtifactOut,
): Effect.Effect<void, Error, CommandRequirements> =>
  Effect.gen(function* () {
    const config = yield* (yield* ConfigService).load
    const workflows = [...config.workflowNames].filter((name) => !config.doors.has(name)).sort()
    const doors = [...config.doors]
    const document = [
      ...workflows.map((name) => ({ kind: "workflow", name })),
      ...doors.map(([name, door]) => ({
        kind: "door",
        name,
        workflow: door.workflow,
        args: (door.args ?? []).map((arg) => ({ name: arg.name, optional: arg.optional === true })),
      })),
    ]
    if (yield* writeJson(json, out, document)) return
    if (document.length === 0) {
      yield* (yield* Narrator).warn(
        "gtd start: this config exports no workflow besides its default, which an ordinary start runs, and no door",
      )
    }
    out.write(
      [
        ...workflows.map((name) => `workflow ${name}\n`),
        ...doors.map(([n, d]) => `door ${doorSynopsis(n, d)} → ${d.workflow}\n`),
      ].join(""),
    )
  })

/**
 * Ends the process underway without completing it. Nothing is discarded: a
 * `git reset --mixed` to the process's start commit leaves every turn
 * commit's content in the working tree.
 *
 * Reads state off the trace rather than `resolveRest`, which refuses when HEAD
 * names a state the current workflow no longer declares — exactly the
 * situation this command must still work in, and why the read-side checks
 * stay direct `GitService` reads.
 *
 * Idempotent at the initial state. The one refusal is a process whose first
 * commit is the repository's root commit: nothing earlier to rewind to.
 */
const runAbandonCommand = (
  json: JsonMode,
  out: ArtifactOut,
): Effect.Effect<void, Error, CommandRequirements> =>
  Effect.gen(function* () {
    const git = yield* GitService
    const config = yield* (yield* ConfigService).load
    const def = config.workflow
    const initial = def.initial
    const run = yield* currentRun
    if (run.trace.length === 0) {
      const required = emitScripts([
        { kind: "outcome", command: abandonNoopOutcome(initial) },
      ]).required
      return yield* writeScript(json, out, combinedScript(required, ""))
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
    yield* writeScript(json, out, combinedScript(required, ""))
  })

/**
 * `gtd restore`: hard-reset HEAD back to the tip `gtd abandon` retained.
 *
 * Guarded by `restorability` so it never discards work it didn't create:
 * refuses on a dirty working tree, no retained history, or HEAD having
 * advanced past the retained tip with commits that would be lost.
 */
const runRestoreCommand = (
  json: JsonMode,
  out: ArtifactOut,
): Effect.Effect<void, Error, CommandRequirements> =>
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
    yield* writeScript(json, out, combinedScript(required, ""))
  })

/**
 * The mode's own validate command for `file`: a declared `validate:` command
 * verbatim; a `"builtin"` validator or no mode at all names the leaf
 * `gtd check <mode>` invocation instead, so there's always something concrete
 * to name.
 */
const selfValidateCommand = (
  def: WorkflowDefinition,
  state: string,
  mode: StateMode,
  file: string,
): string => {
  const resolved = resolveMode(def, state, mode)
  const validate = resolved.kind === "resolved" ? resolved.validate : undefined
  const command = validate?.kind === "command" ? validate.command : seededValidateCommand(mode)
  return commandForFile(command, file)
}

const emitsValidatablePrompt = (rendered: RenderedRest): boolean =>
  rendered.kind === "prompt" && rendered.file !== undefined && rendered.mode !== undefined

/**
 * Shared by `gtd validate --json` and `gtd next --json`'s `validate` field so
 * the two can't drift. `undefined` means no `file:`+`mode:` declared.
 *
 * The file's presence is checked inside the emitted SCRIPT, not here: it is
 * only knowable after the turn, so a turn that legitimately wrote nothing
 * exits 0 rather than burning a fix turn. The contradiction round-trip is
 * emitted before that guard, so it still runs at the first-write beat.
 */
const resolveValidateScript = (
  rest: Rest,
): Effect.Effect<
  { readonly file: string; readonly mode: StateMode; readonly script: string } | undefined,
  Error,
  Host
> =>
  Effect.gen(function* () {
    const file = rest.hints.file
    const mode = rest.stepDef.mode
    if (file === undefined || mode === undefined) return undefined

    const resolved = resolveMode(rest.def, rest.state, mode)
    if (resolved.kind === "unknown") {
      return yield* Effect.fail(new Error(resolved.message))
    }

    const { script } = yield* validateScriptFor(resolved, file)
    return { file, mode, script }
  })

/** The driver-facing `BeatKind` for a currently-resolved rest, the one computation `gatherBeatDocument` reads — so a driver's `kind` field can never drift from what it assembled. */
const restBeatKind = (rest: Rest): BeatKind =>
  beatKindOf({
    contentKind: rest.stepDef.kind,
    dirty: rest.changes.length > 0,
    stalled: stalledAt(rest),
  })

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
    const fields = yield* gatherBeatDocument(rest, rendered)
    const narrator = yield* Narrator
    for (const change of fields.changes) {
      yield* narrator.narrate(`pending: ${change.status} ${change.path}`)
    }
    if (json.kind === "document") {
      out.write(renderBeatJson(fields))
    } else if (json.kind === "select") {
      yield* writeSelection(out, fields, json.path)
    } else {
      const validateCommand = emitsValidatablePrompt(rendered)
        ? selfValidateCommand(rest.def, rest.state, rendered.mode!, rendered.file!)
        : undefined
      if (DEMAND_BRIEFING[fields.kind].suppressHeader) {
        // A prompt's stdout is the agent's input, so its header goes to stderr;
        // rendered as a header-showing kind to reuse the one header layout.
        const shown = renderBeatPlain({ ...fields, kind: "message" })
        yield* narrator.warn(shown.slice(0, shown.indexOf("\n\n")))
      }
      out.write(renderBeatPlain(fields, validateCommand))
    }
  })

/** Emits the format-then-validate script for the driver to run; reads no file and executes nothing itself. The verdict lives in that script's future exit code, which prints the complete fix prompt rather than bare findings. */
const runValidateCommand = (
  json: JsonMode,
  out: ArtifactOut,
): Effect.Effect<void, Error, CommandRequirements> =>
  Effect.gen(function* () {
    const rest = yield* currentRest
    const script = (yield* resolveValidateScript(rest))?.script ?? ""
    yield* writeScript(
      json,
      out,
      script,
      script.length > 0 ? `${script}\n` : `nothing to validate at "${rest.state}"\n`,
    )
  })

/**
 * Runs `<mode>`'s parser over `<file>`, exiting non-zero on any finding.
 * Resolves no workflow state and reads no config — this is what a seeded
 * `validate:` command invokes as a leaf step, and it formats nothing.
 *
 * An unknown mode is a usage error; an absent file is a refusal (the emitted
 * validate script guards on the file's presence before it calls this).
 * Findings ride the failing Effect's message, so the shared refusal path
 * reports them on stderr.
 */
const runCheckCommand = (
  mode: string,
  file: string,
  openQuestions: boolean,
  openThreadsFlag: boolean,
): Effect.Effect<void, Error, Workspace> =>
  Effect.gen(function* () {
    const format = steeringFormatFor(mode)
    if (format === undefined) {
      return yield* Effect.fail(
        new GtdUsageError(
          `gtd check: unknown mode "${mode}" — known modes: ${BUILT_IN_MODE_NAMES.join(", ")}`,
        ),
      )
    }

    if (openThreadsFlag) {
      if (openQuestions) {
        return yield* Effect.fail(
          new Error("gtd check: --open-threads and --open-questions are mutually exclusive"),
        )
      }
      if (format.openThreads === undefined) {
        const accepted = BUILT_IN_MODE_NAMES.filter(
          (name) => steeringFormatFor(name)?.openThreads !== undefined,
        )
        return yield* Effect.fail(
          new Error(
            `gtd check: --open-threads only applies to modes ${accepted.join(", ")} — got "${mode}"`,
          ),
        )
      }
      return yield* runOpenThreadsCheckCommand(format, file)
    }

    if (openQuestions) {
      if (mode !== "qa") {
        return yield* Effect.fail(
          new Error(`gtd check: --open-questions only applies to mode "qa" — got "${mode}"`),
        )
      }
      return yield* runOpenQuestionsCheckCommand(format, file)
    }

    const content = yield* existingFile(file)
    const errors = format.validate(content).map((finding) => formatFinding(file, finding))

    if (errors.length === 0) return

    return yield* Effect.fail(
      new Error(
        `gtd check: ${file} is not valid under mode "${mode}" (${errors.length} finding(s)):\n` +
          errors.join("\n"),
      ),
    )
  })

const existingFile = (file: string): Effect.Effect<string, Error, Workspace> =>
  Effect.flatMap(Workspace, (workspace) => {
    const content = workspace.atPath(file)
    return content === undefined
      ? Effect.fail(new Error(`gtd check: no such file: ${file}`))
      : Effect.succeed(content)
  })

/**
 * The bare `gtd check --open-threads`: code-comment threads in the files the
 * current process changed. The one `check` form that reads process state; no
 * process underway is silence, not an error.
 */
const runCodeThreadsCheckCommand = (): Effect.Effect<void, Error, CommandRequirements> =>
  Effect.gen(function* () {
    const rest = yield* currentRest
    if (rest.run.trace.length === 0) return
    const git = yield* GitService
    const workspace = yield* Workspace
    const changed = yield* git.changedPaths(rest.run.diffBase)
    const lines = changed
      .filter((c) => c.status !== "D")
      .flatMap(({ path }) => {
        const { threads, findings } = parseCodeThreads(path, workspace.atPath(path) ?? "")
        return [
          ...threads
            .filter((t) => t.waitingOn === "human")
            .map((t) => `${path}:${t.line + 1}: ${t.entries[0]!.text}`),
          ...findings.map((f) => `${path}:${(f.line ?? 0) + 1}: ${f.message}`),
        ]
      })
    if (lines.length === 0) return
    return yield* Effect.fail(new Error(lines.join("\n")))
  })

/** Prints one `file:line: [^name]: <first H entry>` line per open thread. */
const runOpenThreadsCheckCommand = (
  format: SteeringFormat,
  file: string,
): Effect.Effect<void, Error, Workspace> =>
  Effect.gen(function* () {
    const content = yield* existingFile(file)
    const errors = openThreads(format, content).map(
      (t) => `${file}:${t.line + 1}: [^${t.name}]: ${t.firstMe}`,
    )
    if (errors.length === 0) return

    return yield* Effect.fail(
      new Error(`gtd check: ${errors.length} open thread(s) in ${file}:\n` + errors.join("\n")),
    )
  })

/**
 * Runs the SAME `unansweredQuestions` predicate a flow's `openQuestions()`
 * reads, so the gate script and the flow's own check stay in sync.
 */
const runOpenQuestionsCheckCommand = (
  format: SteeringFormat,
  file: string,
): Effect.Effect<void, Error, Workspace> =>
  Effect.gen(function* () {
    const content = yield* existingFile(file)
    const errors = unansweredQuestions(format, content).map(
      (q) => `${file}:${q.headingLine + 1}: ${q.question}`,
    )
    if (errors.length === 0) return

    return yield* Effect.fail(
      new Error(
        `gtd check: ${errors.length} open question(s) unanswered in ${file}:\n` + errors.join("\n"),
      ),
    )
  })

/**
 * Clears the `review` format's ticks in `<file>`, writing back only when the
 * bytes changed so an untouched file's mtime never moves. Standalone: no
 * workflow state, no config.
 *
 * Takes no `<mode>` argument and must never grow one — this means review
 * pointers and nothing else, and must never touch `qa`'s answer boxes.
 */
const runUncheckCommand = (file: string): Effect.Effect<void, Error, Workspace> =>
  Effect.gen(function* () {
    // `gtd uncheck` means review-mode file pointers, hardcoded — never the
    // qa format, whose answer boxes it must never touch.
    const format = steeringFormatFor("review")
    if (format === undefined) return

    const workspace = yield* Workspace
    const content = workspace.atPath(file)
    if (content === undefined) return

    const cleared = format.clearTicks(content)
    if (cleared === content) return

    yield* workspace.writeAtPath(file, cleared)
  })

/** The pending changes, as the beat reports them. */
const computeStatusChanges = (changes: readonly PendingChange[]): readonly StatusChange[] =>
  changes.map((change) => ({ status: change.status, path: change.path }))

/** The step the pending change would land the process at. */
const computeNextMatch = (rest: Rest): Effect.Effect<NextMatch | null> =>
  Effect.map(
    rest.changes.length === 0 ? Effect.succeed(undefined) : previewLanding(rest),
    (target) => (target === undefined ? null : { target }),
  )

/** Everything one beat needs beyond the resolved rest itself, gathered once so plain/`--json` can never describe different rests for the same beat — built as `wire`'s `Demand` (what to do) and `BeatStatus` (what no driver branches on), then flattened by `beatDocument` into the one wire-shaped object plain/`--json` both render from. */
const gatherBeatDocument = (
  rest: Rest,
  rendered: RenderedRest,
): Effect.Effect<BeatDocument, Error, CommandRequirements> =>
  Effect.gen(function* () {
    const kind = restBeatKind(rest)
    const session =
      kind === "prompt" ? resolveSession(rendered.memory, rendered.memoryResumed) : undefined
    const resolvedValidate =
      kind === "prompt"
        ? yield* resolveValidateScript(rest).pipe(Effect.catch(() => Effect.succeed(undefined)))
        : undefined
    const validate =
      resolvedValidate !== undefined && resolvedValidate.script.length > 0
        ? resolvedValidate.script
        : undefined
    const log = yield* loopLogPath
    const demand = demandOf({
      rendered,
      kind,
      ...(session !== undefined
        ? { session: { id: session.sessionId, resume: session.resume } }
        : {}),
      ...(validate !== undefined ? { validate } : {}),
    })
    const status = statusOf({
      rendered,
      idle: restIsIdle(rest),
      initial: noProcessUnderway(rest),
      workflow: rest.workflowName,
      log,
      changes: computeStatusChanges(rest.changes),
      next: yield* computeNextMatch(rest),
      cost: rest.cost.total,
      costByModel: rest.cost.byModel,
      approvals: rest.run.approvals,
    })
    return beatDocument(demand, status)
  })

/**
 * `gtd ui`: loads `ui:` config and hands it, alongside the parsed flags, to
 * the ui tool. `needs: "state"` (see `needsOf` above) means this shares the
 * repo-root/at-least-one-commit guard with every other workflow-state
 * command — `gtd ui` operates on the invoking directory's own worktree,
 * never a configured list of roots.
 */
const runUiCliCommand = (
  command: Extract<Command, { kind: "ui" }>,
  out: ArtifactOut,
): Effect.Effect<void, Error, CommandRequirements> =>
  Effect.gen(function* () {
    const config = yield* (yield* ConfigService).load
    const { root } = yield* Host
    yield* (yield* ToolCommands).ui(
      {
        flags: {
          ...(command.host !== undefined ? { host: command.host } : {}),
          ...(command.port !== undefined ? { port: command.port } : {}),
          selfSigned: command.selfSigned,
          dev: command.dev,
        },
        config: config.ui,
        root,
      },
      out,
    )
  })

/**
 * Everything gtd derives is resolved against the process cwd, so running
 * from anywhere but the repository root would silently mis-derive state.
 * Refuses with a clear error instead. Real paths are compared so symlinked
 * cwds (e.g. macOS /tmp → /private/tmp) match.
 */
const assertRunningFromRepoRoot = (git: GitOperations, host: HostOps): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const topLevel = yield* git
      .topLevel()
      .pipe(
        Effect.mapError((e) =>
          /not a git repository/.test(e.message)
            ? new Error("gtd: not a git repository — run gtd inside one (`git init` makes one)")
            : e,
        ),
      )
    const topReal = yield* host.realPath(topLevel)
    const cwdReal = yield* host.realPath(host.root)
    if (topReal !== cwdReal) {
      return yield* Effect.fail(
        new Error(
          `gtd: run gtd from the repository root — cd ${shellWord(topLevel)} ` +
            `(the current directory is ${host.root})`,
        ),
      )
    }
  })

const shellWord = (path: string): string =>
  /^[\w@%+=:,./-]+$/.test(path) ? path : `'${path.replace(/'/g, "'\\''")}'`

/** A command that derives workflow state needs at least one commit too — a commitless repository has no HEAD to resolve a `Rest` at. */
const assertRepositoryHasCommits = (git: GitOperations): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const hasCommits = yield* git.hasCommits()
    if (!hasCommits) {
      return yield* Effect.fail(
        new Error(
          "gtd: the repository has no commits yet — make an initial commit, then run gtd again",
        ),
      )
    }
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
    case "guide":
    case "judgeRun":
    case "strays":
      return "none"
    case "check":
    case "uncheck":
      return "fs"
    default:
      return "state"
  }
}

/** The kinds that never touch the repo-root guard — pinned so a new standalone kind can't be added silently. */
export const standaloneKinds = (): readonly Command["kind"][] => [
  "lsp",
  "check",
  "uncheck",
  "guide",
  "judgeRun",
  "strays",
]

/**
 * Dispatches to the named `run*Command` handler for every `Command.kind` —
 * the counterpart of `Cli.ts`'s `parseArgv`, which has already validated
 * every field a handler receives. Only `strays` chooses its exit code; every
 * other branch returns `Effect<void>` and resolves to `EXIT_OK`.
 */
const dispatchCommand = (
  command: Command,
  json: JsonMode,
  out: ArtifactOut,
): Effect.Effect<SuccessExit, Error, CommandRequirements> => {
  if (command.kind === "strays") return runStraysCommand(command, json, out)
  return Effect.as(dispatchVoidCommand(command, json, out), EXIT_OK)
}

// fallow-ignore-next-line complexity
const dispatchVoidCommand = (
  command: Exclude<Command, { kind: "strays" }>,
  json: JsonMode,
  out: ArtifactOut,
): Effect.Effect<void, Error, CommandRequirements> => {
  switch (command.kind) {
    case "lsp":
      return runLspCommand()
    case "ui":
      return runUiCliCommand(command, out)
    case "land":
      return runLandCommand(
        {
          ...(command.cost !== undefined ? { cost: command.cost } : {}),
          ...(command.model !== undefined ? { model: command.model } : {}),
        },
        json,
        out,
      )
    case "start":
      return runStartCommand(command, json, out)
    case "abandon":
      return runAbandonCommand(json, out)
    case "restore":
      return runRestoreCommand(json, out)
    case "next":
      return runNextCommand(json, out)
    case "validate":
      return runValidateCommand(json, out)
    case "check":
      if (command.mode === undefined || command.file === undefined) {
        return runCodeThreadsCheckCommand()
      }
      return runCheckCommand(
        command.mode,
        command.file,
        command.openQuestions ?? false,
        command.openThreads ?? false,
      )
    case "uncheck":
      return runUncheckCommand(command.file)
    case "guide":
      return runGuideCommand(out)
    case "bundle":
      return runBundleCommand(out)
    case "summary":
      return runSummaryCommand(out)
    case "base":
      return runBaseCommand(out)
    case "judge":
      return runJudgeCommand(json, out)
    case "judgeAnswer":
      return runJudgeAnswerCommand(json, out)
    case "judgeRun":
      return runJudgeRunCommand(command, out)
    case "historyList":
      return runHistoryListCommand(json, out)
    case "historyShow":
      return runHistoryShowCommand(command.ref, json, out)
    case "historyMetrics":
      return runHistoryMetricsCommand(command.refs, json, out)
    case "historyJudges":
      return runHistoryJudgesCommand(command.refs, command.vars, command.jsonl, json, out)
    case "historyFetch":
      return runHistoryFetchCommand(command.remote, json, out)
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
): Effect.Effect<SuccessExit, Error, CommandRequirements> => {
  const dispatch = dispatchCommand(command, json, out)
  if (needsOf(command.kind) !== "state") return dispatch
  return Effect.gen(function* () {
    const git = yield* GitService
    const host = yield* Host
    yield* assertRunningFromRepoRoot(git, host)
    yield* assertRepositoryHasCommits(git)
    // One extra load here, own to this block, just to read `.warnings` ahead
    // of `dispatch`'s own (unrelated) load(s) — `ConfigService.load` isn't
    // memoized, and `load` (`src/workflow/load.ts`) narrates a "config: module ..."
    // line on EVERY call, so a second bare load under --verbose
    // would double that output. Silence narration on this one call only (a
    // scoped Narrator override, never touching the outer context `dispatch`
    // runs under) — this load exists purely to surface `.warnings`, not to
    // narrate again.
    const narrator = yield* Narrator
    const config = yield* (yield* ConfigService).load.pipe(
      Effect.provideService(Narrator, { narrate: () => Effect.void, warn: () => Effect.void }),
    )
    for (const warning of config.warnings) {
      yield* narrator.warn(`gtd: warning: ${formatDiagnostic(warning)}`)
    }
    return yield* dispatch
  })
}

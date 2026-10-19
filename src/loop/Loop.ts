import { resolve } from "node:path"
import { Effect, Either } from "effect"
import { DEFAULT_CONTEXT_LIMIT, contextWindowFor, type ContextLimit } from "../wire/index.js"
import { agentCli, type SessionFlag, type TurnResult } from "./Agent.js"
import { decodeBeat, decodeLand, type Beat } from "./Documents.js"
import { LoopHost, type Exit } from "./Host.js"
import { resolveModel, resolveSettings, settingsPath, type LoopSettings } from "./Settings.js"

export interface LoopOptions {
  /** How to run THIS gtd — the loop never drives a different version than the one it ships with. */
  readonly gtd: readonly [string, ...string[]]
}

// The retry cap on a failing steering-file validation is the driver's own.
const MAX_VALIDATION_FIXES = 3
const FAILURE_LINES = 40

interface Ctx {
  readonly host: typeof LoopHost.Service
  readonly settings: LoopSettings
  readonly root: string
  readonly gtd: LoopOptions["gtd"]
  readonly log: string
}

type Outcome =
  | "stop"
  | { readonly cost: number; readonly model: string | undefined; readonly landing?: string }
const LAND: Outcome = { cost: 0, model: undefined }

const fromEither = <A>(either: Either.Either<A, string>): Effect.Effect<A, Error> =>
  Effect.mapError(either, (message) => new Error(message))

const paint = (host: Ctx["host"], sgr: string, text: string): string =>
  host.color ? `\x1b[${sgr}m${text}\x1b[0m` : text

const firstLines = (text: string): string =>
  text.trimEnd().split("\n").slice(0, FAILURE_LINES).join("\n")

const loadSettings = Effect.gen(function* () {
  const host = yield* LoopHost
  const path = settingsPath(host.env)
  const text = path === undefined ? undefined : yield* host.readFile(path)
  return yield* fromEither(
    resolveSettings(
      host.env,
      path !== undefined && text !== undefined ? { path, text } : undefined,
    ),
  )
})

const gitRoot = Effect.gen(function* () {
  const host = yield* LoopHost
  const exit = yield* host.spawn({
    command: "git",
    args: ["rev-parse", "--show-toplevel"],
    output: "capture",
  })
  if (exit.code !== 0) return yield* Effect.fail(new Error("not inside a git repository"))
  return exit.stdout.trim()
})

const gtd = (
  ctx: Omit<Ctx, "log">,
  args: readonly string[],
  stdin?: string,
): Effect.Effect<string, Error> =>
  Effect.flatMap(
    ctx.host.spawn({
      command: ctx.gtd[0],
      args: [...ctx.gtd.slice(1), ...args],
      cwd: ctx.root,
      ...(stdin === undefined ? {} : { stdin }),
      output: "capture",
    }),
    (exit) =>
      exit.code === 0
        ? Effect.succeed(exit.stdout)
        : Effect.fail(
            new Error(
              `\`gtd ${args.join(" ")}\` failed (exit ${exit.code})\n${exit.stderr.trimEnd()}`,
            ),
          ),
  )

const readBeat = (ctx: Omit<Ctx, "log">): Effect.Effect<Beat, Error> =>
  Effect.flatMap(gtd(ctx, ["next", "--json"]), (stdout) => fromEither(decodeBeat(stdout)))

const clock = (): string => new Date().toTimeString().slice(0, 8)

const header = (ctx: Ctx, beat: number, doc: Beat): Effect.Effect<void> =>
  Effect.gen(function* () {
    const time = clock()
    yield* ctx.host.appendLog(
      ctx.log,
      `\n─── beat #${beat}  ${time}  ${doc.kind}: ${doc.state} ───\n`,
    )
    const state = paint(ctx.host, doc.idle ? "32" : "33", doc.state)
    yield* ctx.host.say(
      `\n${paint(ctx.host, "1;36", `─── beat #${beat}  ${time}  ${doc.kind}:`)} ${state} ${paint(ctx.host, "1;36", "───")}\n`,
    )
  })

const rest = (ctx: Ctx, sgr: string, headline: string): Effect.Effect<void> =>
  ctx.host.say(`\n${paint(ctx.host, `1;${sgr}`, `● ${headline}`)}\n`)

const agentFailed = (ctx: Ctx, exit: Exit, result: TurnResult): Effect.Effect<void> =>
  ctx.host.say(
    [
      `\n${paint(ctx.host, "1;31", `✘ agent turn failed (exit ${exit.code})`)}`,
      ...(exit.stderr.trim() === "" ? [] : [firstLines(exit.stderr)]),
      ...(result.text.trim() === "" ? [] : [firstLines(result.text)]),
    ].join("\n") + "\n",
  )

const quote = (arg: string): string => `'${arg.replaceAll("'", "'\\''")}'`

// The hook stops the turn from inside; reading the stream for the same hard
// limit is the loop's own stop, for when no hook fired (hooks disabled, one
// long reply with no tool call).
const contextGuard = (ctx: Ctx, doc: Beat, model: string | undefined) => {
  const limit: ContextLimit = { ...DEFAULT_CONTEXT_LIMIT, ...doc.context }
  const window = ctx.settings.contextWindow ?? contextWindowFor(model)
  const hook = [...ctx.gtd, "context-hook"]
    .concat([
      "--soft",
      String(limit.soft),
      "--hard",
      String(limit.hard),
      "--window",
      String(window),
    ])
    .map(quote)
    .join(" ")
  return { limit, window, hook }
}

// The prompt goes over stdin, never argv: it embeds a full diff, and argv is
// capped (~1 MB on macOS, 4 KB guaranteed). A turn that backgrounds a shell
// command would land while that command is still writing the tree. A turn
// stopped at its context limit fails the beat outright: retrying it, or
// fixing its validation, would only run into the same limit.
const agentTurn =
  (ctx: Ctx, doc: Beat, model: string | undefined) =>
  (prompt: string, sessionFlag: SessionFlag): Effect.Effect<TurnResult, Error> =>
    Effect.gen(function* () {
      const cli = agentCli(ctx.settings.agent)
      const guard = contextGuard(ctx, doc, model)
      const tokensOf = cli.contextTokens
      const exit = yield* ctx.host.spawn({
        command: cli.command,
        args: cli.args({
          sessionFlag,
          sessionId: doc.session?.id ?? "",
          model,
          system: doc.system,
          hook: guard.hook,
        }),
        cwd: ctx.root,
        stdin: prompt,
        env: { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1" },
        output: "capture",
        ...(tokensOf === undefined
          ? {}
          : { stopAt: (line) => (tokensOf(line) ?? 0) >= guard.limit.hard * guard.window }),
      })
      const result = cli.read(exit)
      yield* ctx.host.appendLog(ctx.log, `${exit.stderr}${result.text}\n`)
      if (result.contextLimit) {
        return yield* Effect.fail(
          new Error(
            `context limit: the agent turn at "${doc.state}" was stopped at its context limit (hard ${Math.round(guard.limit.hard * 100)}% of ${guard.window} tokens) — nothing landed; see ${ctx.log}`,
          ),
        )
      }
      if (!result.ok) yield* agentFailed(ctx, exit, result)
      return result
    })

// `resume` is a hint: the session id is derived, never stored, so a crashed
// prior turn or an expired agent session recovers through the other flag.
const sessionFlags = (doc: Beat): readonly [SessionFlag, SessionFlag] =>
  doc.session?.resume === true ? ["--resume", "--session-id"] : ["--session-id", "--resume"]

const validateOnce = (ctx: Ctx, script: string): Effect.Effect<Exit, Error> =>
  ctx.host.spawn({
    command: "sh",
    args: ["-c", 'sh -c "$1" 2>&1', "sh", script],
    cwd: ctx.root,
    output: "capture",
  })

const promptBeat = (ctx: Ctx, doc: Beat): Effect.Effect<Outcome, Error> =>
  Effect.gen(function* () {
    if (doc.session === undefined) {
      return yield* Effect.fail(new Error(`prompt beat at "${doc.state}" carries no session`))
    }
    const model = resolveModel(ctx.settings, doc.model)
    const turn = agentTurn(ctx, doc, model)
    let cost = 0
    const run = (prompt: string, flag: SessionFlag) =>
      Effect.map(turn(prompt, flag), (result) => {
        // A failed turn was still paid for.
        cost += result.cost
        return result.ok
      })
    // Plain `gtd next` at a prompt rest is the bare step plus its
    // self-validation instruction — what the agent reads.
    const content = yield* gtd(ctx, ["next"])
    const [first, second] = sessionFlags(doc)
    if (!(yield* run(content, first)) && !(yield* run(content, second))) {
      return yield* Effect.fail(new Error("agent turn failed on both session flags"))
    }
    for (let fixes = 0; doc.validate !== undefined && doc.validate !== "";) {
      const check = yield* validateOnce(ctx, doc.validate)
      if (check.code === 0) break
      yield* ctx.host.appendLog(ctx.log, check.stdout)
      if (++fixes > MAX_VALIDATION_FIXES) {
        yield* ctx.host.say(check.stdout)
        return yield* Effect.fail(
          new Error(`validation still failing after ${MAX_VALIDATION_FIXES} fixes`),
        )
      }
      // The validation output IS the fix prompt, verbatim.
      if (!(yield* run(check.stdout, "--resume"))) {
        return yield* Effect.fail(new Error("agent turn failed while fixing validation"))
      }
    }
    return { cost, model }
  })

const runScript = (ctx: Ctx, content: string): Effect.Effect<Outcome, Error> =>
  Effect.as(
    ctx.host.spawn({
      command: "sh",
      args: ["-c", content],
      cwd: ctx.root,
      output: { log: ctx.log },
    }),
    LAND,
  )

// A rest the human owns is ONE line on the terminal; its prose goes to the log.
const stop = (ctx: Ctx, sgr: string, headline: string, prose: string): Effect.Effect<Outcome> =>
  Effect.as(Effect.zipRight(ctx.host.appendLog(ctx.log, prose), rest(ctx, sgr, headline)), "stop")

// A judge gate is answered by `gtd judge run`, whose own configuration picks
// the provider, and planned by `gtd judge answer` (a pure read, like `gtd
// land`). Any failure of either leaves the gate to the human, which routes
// the workflow its cautious way: a judge gate never fails toward less work.
const judgeGate = (ctx: Ctx, doc: Beat): Effect.Effect<string | undefined> =>
  gtd(ctx, ["judge", "run"], doc.judge).pipe(
    Effect.flatMap((verdict) => gtd(ctx, ["judge", "answer", "--json"], verdict)),
    Effect.tap(() => ctx.host.say(`  ${paint(ctx.host, "2", "⚖ judged")}\n`)),
    Effect.catchAll((error) =>
      Effect.as(ctx.host.appendLog(ctx.log, `${error.message}\n`), undefined),
    ),
  )

// The opening beat is the human's even at a clean gate: they re-ran the loop
// resting there, so landing it is their decision — an `acceptClean` gate
// advances, any other gate lands a harmless no-op and prints on the next beat.
// A judge gate is the exception: landing it unanswered takes the conservative
// default, which must never happen unseen, so an unanswered one always stops.
// `judged` is the state the previous beat answered: resting there again means
// the verdict moved nothing, so the human gets it rather than a second bill.
const messageBeat = (
  ctx: Ctx,
  beat: number,
  doc: Beat,
  judged: string | undefined,
): Effect.Effect<Outcome> =>
  Effect.gen(function* () {
    const isJudge = doc.judge !== undefined && doc.judge !== ""
    const landing = isJudge && judged !== doc.state ? yield* judgeGate(ctx, doc) : undefined
    if (landing !== undefined) return { ...LAND, landing }
    if (beat === 1 && !isJudge) return LAND
    const label = doc.label === undefined ? "" : ` (${doc.label})`
    return yield* stop(ctx, "33", `your turn — ${doc.state}${label}`, doc.content)
  })

const kindBeat = (
  ctx: Ctx,
  beat: number,
  doc: Beat,
  judged: string | undefined,
): Effect.Effect<Outcome, Error> => {
  switch (doc.kind) {
    case "stalled":
      return Effect.zipRight(
        ctx.host.appendLog(ctx.log, doc.content),
        Effect.fail(new Error(doc.content.trimEnd())),
      )
    case "message":
      return messageBeat(ctx, beat, doc, judged)
    case "capture":
      return Effect.succeed(LAND)
    case "script":
      return runScript(ctx, doc.content)
    case "prompt":
      return promptBeat(ctx, doc)
    default:
      return Effect.fail(new Error(`unknown beat kind "${doc.kind}"`))
  }
}

// `idle` past the opening beat is where an ordinary process ends.
const runBeat = (
  ctx: Ctx,
  beat: number,
  doc: Beat,
  judged: string | undefined,
): Effect.Effect<Outcome, Error> =>
  beat > 1 && doc.idle
    ? Effect.flatMap(gtd(ctx, ["next"]), (message) =>
        stop(ctx, "32", `done — ${doc.state}`, message),
      )
    : kindBeat(ctx, beat, doc, judged)

const costFlags = (outcome: Exclude<Outcome, "stop">): readonly string[] =>
  outcome.cost > 0
    ? [
        `--cost=${outcome.cost.toFixed(6)}`,
        ...(outcome.model === undefined ? [] : [`--model=${outcome.model}`]),
      ]
    : []

// Every field is read in one document BEFORE the script runs: the script
// moves the tree, and a read taken afterwards would plan something else.
const land = (ctx: Ctx, outcome: Exclude<Outcome, "stop">): Effect.Effect<boolean, Error> =>
  Effect.gen(function* () {
    // A judged beat was planned by `gtd judge answer` already, and ran no agent turn to bill.
    const landed = outcome.landing ?? (yield* gtd(ctx, ["land", "--json", ...costFlags(outcome)]))
    const doc = yield* fromEither(decodeLand(landed))
    const exit = yield* ctx.host.spawn({
      command: "sh",
      args: [],
      cwd: ctx.root,
      stdin: doc.script,
      output: { log: ctx.log },
    })
    if (exit.code !== 0) {
      return yield* Effect.fail(
        new Error(`the landing script failed (exit ${exit.code}) — see ${ctx.log}`),
      )
    }
    if (doc.subject !== null) yield* ctx.host.say(`  ${paint(ctx.host, "2", `↳ ${doc.subject}`)}\n`)
    if (!doc.settled) return false
    yield* ctx.host.say(`${paint(ctx.host, "32", "✔ settled — nothing owed")}\n`)
    if (doc.idle) {
      const message = yield* gtd(ctx, ["next"])
      yield* ctx.host.appendLog(ctx.log, message)
      yield* ctx.host.say(message)
    }
    return true
  })

/**
 * Advance beats until gtd rests on a human: read the beat document, run what
 * it demands, land the result. Succeeds at a human gate, at idle, and when a
 * landing settles; fails on a stall and on anything that broke.
 */
export const runLoop = (options: LoopOptions): Effect.Effect<void, Error, LoopHost> =>
  Effect.gen(function* () {
    const host = yield* LoopHost
    const settings = yield* loadSettings
    const root = yield* gitRoot
    const base = { host, settings, root, gtd: options.gtd }
    let doc = yield* readBeat(base)
    // gtd names the log relative to the root it ran in, not to where the loop started.
    const ctx: Ctx = { ...base, log: resolve(root, doc.log) }
    // gtd never truncates the log; a run starts it fresh.
    yield* host.resetLog(ctx.log)
    let judged: string | undefined
    for (let beat = 1; ; beat++) {
      if (beat > 1) doc = yield* readBeat(ctx)
      yield* header(ctx, beat, doc)
      const outcome = yield* runBeat(ctx, beat, doc, judged)
      if (outcome === "stop" || (yield* land(ctx, outcome))) return
      judged = outcome.landing === undefined ? undefined : doc.state
    }
  })

import { Effect } from "effect"
import { PassThrough } from "node:stream"
import { runCli } from "../cli/index.js"
import { EXIT_OK, type BeatDocument } from "../wire/index.js"
import {
  applyEmittedScript,
  applyFlowScript,
  InMemRepo,
  makeCapturingCliIo,
  type CapturedCliResult,
  type CommandTable,
} from "../twins/index.js"
import { importsFrom } from "./imports.js"

/**
 * The repository's `gtd.config.ts`: its source, or the module itself. A module
 * is handed to the engine through a global registry, so its functions run in
 * this process against the same `@pmelab/gtd/flows` runtime the engine
 * installs its context into.
 */
export type WorkflowModule = string | Readonly<Record<string, unknown>>

/**
 * What a command a step's script runs does in memory. `run` matches the command
 * as the script spells it, exactly or by a pattern; the first match wins.
 */
export interface CannedCommand {
  readonly run: string | RegExp
  /** Defaults to 0. */
  readonly exit?: number
  readonly output?: string
  /** What the command does to the tree, e.g. a formatter's rewrite. */
  readonly effect?: (repo: TestRepo) => void
}

export interface TestRepoOptions {
  readonly workflow: WorkflowModule
  /** The commands a step's script may run. A command none matches fails the script. */
  readonly commands?: readonly CannedCommand[]
  /** Committed alongside the config, before any process starts. */
  readonly files?: Readonly<Record<string, string>>
  /** The environment gtd sees; the real `process.env` is never read, except ambient `GTD_FLAG_*` (explicit env wins). */
  readonly env?: Readonly<Record<string, string>>
  /**
   * Modules a config given as source imports by specifier, e.g.
   * `{ "#workflow": await import("./index.ts") }`: its `import`/`export … from
   * "#workflow"` reads the module the test imported.
   */
  readonly modules?: Readonly<Record<string, Readonly<Record<string, unknown>>>>
  /** `false` keeps the runner's `GTD_FLAG_*` out too, so gtd sees `env` alone. Defaults to `true`. */
  readonly ambientFlags?: boolean
}

/** One answer of a {@link Verdict}. */
export interface VerdictEntry {
  readonly id: string
  readonly answer: boolean | string | number
  readonly p: number
}

/** A judge step's verdict, as {@link verdict} builds it; an actor may return it in place of a JSON string. */
export interface Verdict {
  readonly answers: readonly VerdictEntry[]
}

/** What a scripted actor does at the step it is registered for, before the beat lands. */
export type ScriptedActor = (
  beat: BeatDocument,
  repo: TestRepo,
) => void | string | Verdict | Promise<void | string | Verdict>

/**
 * Scripted actors, keyed by full step name. At a judge step the actor returns
 * the verdict, which is answered through `gtd judge answer`; anywhere else it
 * edits the tree and the beat is landed.
 */
export type Actors = Readonly<Record<string, ScriptedActor>>

export interface DriveOptions {
  /** Fail instead of looping forever on a workflow that never rests. */
  readonly maxBeats?: number
  /**
   * Defaults to `true`: fail on an actor whose step no drive of this
   * repository has reached, a check step without an actor, a human step whose
   * actor changes nothing (the drive would repeat it), and an actor returning a
   * verdict anywhere but at a judge step. `false` lets each of them pass.
   */
  readonly strict?: boolean
  /**
   * `"pass"`: a strict drive skips only its check for actors no drive has
   * reached, for a harness that checks that once at its own end, as the
   * gherkin world does at scenario end.
   */
  readonly unreachedActors?: "fail" | "pass"
  /** `"run"`: a check step without an actor runs its own script, as `runsItsScript` would. */
  readonly checks?: "run"
}

/** A commit, as `TestRepo.commits` lists it. */
export interface TestCommit {
  readonly hash: string
  readonly subject: string
  /** The full message: subject, body and trailers. */
  readonly message: string
  /** The trailers of the message's last paragraph, each key's values in order. */
  readonly trailers: Readonly<Record<string, readonly string[]>>
}

export interface RunScriptOptions {
  /** Tried before the repository's own canned commands, for this run only. */
  readonly commands?: readonly CannedCommand[]
}

export interface TestRepo {
  /** Adds a command a step's script may run, after those `testRepo` was given. */
  command(command: CannedCommand): void
  /** Sets (or, with `undefined`, unsets) a variable gtd sees from the next call on. */
  setEnv(name: string, value: string | undefined): void
  /** Creates branch `name` at `ref` (HEAD by default). Outside a process only. */
  branch(name: string, ref?: string): void
  /** Checks branch `name` out; refuses with uncommitted changes. Outside a process only. */
  checkout(name: string): void
  /** Points ref `name` (`refs/remotes/origin/main`, `refs/tags/v1`) at `ref` (HEAD by default). Outside a process only. */
  ref(name: string, ref?: string): void
  branchName(): string
  read(path: string): string | undefined
  write(path: string, content: string): void
  remove(path: string): void
  /** Every pending change committed with `message`, outside any process. */
  commit(message: string): void
  /** `path` as committed at `ref`. */
  show(ref: string, path: string): string | undefined
  /**
   * A step's script, run against the tree. Only the file operations the flows
   * script helpers emit are understood; anything else (a test suite, a git
   * write) throws, and the step needs an actor that stands in for it.
   */
  runScript(script: string, options?: RunScriptOptions): void
  /** One in-process invocation; nothing it prints is run. */
  gtd(...args: string[]): Promise<CapturedCliResult>
  /** `gtd start <name> [...args]`, its script applied: a door of that name, or else the workflow. */
  start(name: string, ...args: string[]): Promise<CapturedCliResult>
  /** The same as {@link TestRepo.start}. */
  door(name: string, ...args: string[]): Promise<CapturedCliResult>
  land(): Promise<CapturedCliResult>
  next(): Promise<BeatDocument>
  /**
   * Beat by beat, like a driver: a capture lands, a step with an actor runs it
   * and lands, and the first step without one is where the process rests —
   * returned for the test to inspect. A stall rests too. An agent turn's
   * steering file is formatted and validated before it lands, as a driver
   * does; a file that fails validation fails the drive.
   */
  drive(actors?: Actors, options?: DriveOptions): Promise<BeatDocument>
  /** Oldest first. */
  subjects(): readonly string[]
  /** Every commit's full message, subject and trailers, oldest first. */
  messages(): readonly string[]
  /** Every commit's full hash, oldest first. */
  hashes(): readonly string[]
  /** Every commit, oldest first. */
  commits(): readonly TestCommit[]
}

const REGISTRY = Symbol.for("@pmelab/gtd/testkit:modules")
type Registry = Map<string, Readonly<Record<string, unknown>>>
const registry = (): Registry => {
  const global = globalThis as { [REGISTRY]?: Registry }
  return (global[REGISTRY] ??= new Map())
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/
let registered = 0

const lookup = (key: string): string =>
  `globalThis[Symbol.for(${JSON.stringify(REGISTRY.description)})].get(${JSON.stringify(key)})`

/** A config whose exports are module `id`'s, read off the registry when the engine loads it. */
const moduleSource = (id: string, module: Readonly<Record<string, unknown>>): string => {
  const lines = [`const m = ${lookup(id)}`]
  for (const name of Object.keys(module)) {
    if (name === "default") lines.push(`export default m.default`)
    else if (IDENTIFIER.test(name)) lines.push(`export const ${name} = m[${JSON.stringify(name)}]`)
    else throw new Error(`testkit: export name "${name}" is not an identifier`)
  }
  return `${lines.join("\n")}\n`
}

/** An actor that runs the step's own script, for steps whose script `runScript` understands. */
export const runsItsScript: ScriptedActor = (beat, repo) => repo.runScript(beat.content)

/**
 * A judge's verdict, keyed by question id: `verdict({ ready: true })`, or with
 * a confidence, `verdict({ ready: { answer: true, p: 0.6 } })`. `p` defaults to 0.9.
 */
export const verdict = (
  answers: Readonly<
    Record<
      string,
      VerdictEntry["answer"] | { readonly answer: VerdictEntry["answer"]; readonly p?: number }
    >
  >,
): Verdict => ({
  answers: Object.entries(answers).map(([id, entry]) =>
    typeof entry === "object"
      ? { id, answer: entry.answer, p: entry.p ?? 0.9 }
      : { id, answer: entry, p: 0.9 },
  ),
})

/** `actor`, at a visit whose beat content contains `text`; any other visit changes nothing. */
export const whenPrompted =
  (text: string, actor: ScriptedActor): ScriptedActor =>
  (beat, repo) =>
    beat.content.includes(text) ? actor(beat, repo) : undefined

/** Each actor in order, at every visit; the first verdict any of them returns is the result. */
export const inTurn =
  (actors: readonly ScriptedActor[]): ScriptedActor =>
  async (beat, repo) => {
    let result: string | Verdict | undefined
    for (const actor of actors) {
      const returned = await actor(beat, repo)
      if (result === undefined && returned !== undefined) result = returned as string | Verdict
    }
    return result
  }

/** At a judge step, `answer` when the pending questions (as `gtd judge` prints them) contain `text`. */
export const verdictWhen =
  (text: string, answer: string | Verdict): ScriptedActor =>
  async (_, repo) => {
    const { stdout } = await repo.gtd("judge")
    return stdout.includes(text) ? answer : undefined
  }

const isVerdict = (value: unknown): value is Verdict =>
  typeof value === "object" &&
  value !== null &&
  Array.isArray((value as { answers?: unknown }).answers)

const TRAILER = /^([A-Za-z0-9][A-Za-z0-9-]*): ?(.*)$/

const trailersOf = (message: string): Record<string, string[]> => {
  const paragraphs = message.trimEnd().split(/\n\s*\n/)
  const last = paragraphs.length > 1 ? paragraphs.at(-1)!.split("\n") : []
  const trailers: Record<string, string[]> = {}
  if (last.length === 0 || !last.every((line) => TRAILER.test(line))) return trailers
  for (const line of last) {
    const [, key, value] = TRAILER.exec(line)!
    ;(trailers[key!] ??= []).push(value!)
  }
  return trailers
}

const words = (text: string): string[] =>
  [...text.matchAll(/'((?:[^']|'\\'')*)'/g)].map((m) => m[1]!.replaceAll("'\\''", "'"))

const fileOf = (repo: InMemRepo, path: string, what: string): string => {
  const content = repo.readFile(path)
  if (content === undefined) throw new Error(`testkit: ${what}: ${path} does not exist`)
  return content
}

// `InMemRepo.pathsUnder("")` is the whole tree, where a real `rm -- ''` removes nothing.
const nonEmpty = (paths: string[]): string[] => {
  if (paths.includes("")) throw new Error("testkit: rm: refusing an empty path")
  return paths
}

/** The lines `runScript` understands, each with what it does to the tree. */
const LINES: ReadonlyArray<readonly [RegExp, (repo: InMemRepo, words: string[]) => void]> = [
  [/^$|^#!|^set [-+]e$|^mkdir -p /, () => undefined],
  [
    /^rm -rf -- /,
    (repo, paths) => {
      for (const path of nonEmpty(paths))
        for (const file of repo.pathsUnder(path)) repo.deleteFile(file)
    },
  ],
  [
    /^rm -f -- /,
    (repo, paths) => {
      for (const path of paths) if (repo.readFile(path) !== undefined) repo.deleteFile(path)
    },
  ],
  [
    /^mv -- '.*' '.*'$/,
    (repo, [from, to]) => {
      const content = fileOf(repo, from!, "mv")
      repo.deleteFile(from!)
      repo.writeFile(to!, content)
    },
  ],
  [
    /^git show '.*' > '.*'$/,
    (repo, [source, dest]) => {
      const at = source!.indexOf(":")
      const content = repo.fileAtRef(source!.slice(0, at), source!.slice(at + 1))
      if (content === null) throw new Error(`testkit: git show: ${source} does not exist`)
      repo.writeFile(dest!, content)
    },
  ],
]

const knownLine = (line: string) => LINES.find(([pattern]) => pattern.test(line))

const cannotRun = (error: string): Error =>
  new Error(
    `testkit: cannot run script in memory — add a canned command for it, or give the step an actor\n${error}`,
  )

// A script with a line `LINES` lacks goes to the contract-tested recognizers
// whole, minus the git builders: they would apply a commit/reset/update-ref in
// memory, so any git-mutating block is refused whatever its spelling.
const runLines = (repo: InMemRepo, commands: CommandTable, script: string): void => {
  const lines = script.split("\n").map((line) => line.trim())
  const known = lines.map(knownLine)
  if (known.every(Boolean)) {
    known.forEach((k, i) => k![1](repo, words(lines[i]!)))
    return
  }
  const applied = applyEmittedScript(repo, commands, script, { git: false })
  if (!applied.ok) throw cannotRun(applied.error ?? "")
}

const failed = (what: string, result: CapturedCliResult): Error =>
  new Error(`${what} exited ${result.exitCode}\n${result.stderr}${result.stdout}`)

const ANSWER: Readonly<Record<string, string>> = {
  noul: "true",
  choice: '"<option>"',
  score: "0.5",
}

/** The verdict a judge beat's questions take, as a template to copy. */
const expectedVerdict = (doc: BeatDocument): string => {
  let questions: readonly { id: string; primitive: string }[] = []
  try {
    questions = (JSON.parse(doc.judge ?? "") as { questions: typeof questions }).questions
  } catch {
    // An unreadable judge document leaves the template without entries.
  }
  const entries = questions.map(
    ({ id, primitive }) =>
      `{ "id": ${JSON.stringify(id)}, "answer": ${ANSWER[primitive] ?? '"<answer>"'}, "p": 0.9 }`,
  )
  return [
    "expected a JSON array, one entry per question — answer a boolean for a noul, a string for a choice, a number for a score; p between 0 and 1:",
    `[${entries.join(", ")}]`,
  ].join("\n")
}

const quoted = (names: readonly string[]): string => names.map((name) => `"${name}"`).join(", ")

/** Who acts at `doc`: its scripted actor, or a check's own script under `checks: "run"`. A stall has none. */
const actorAt = (
  doc: BeatDocument,
  actors: Actors,
  checks: DriveOptions["checks"],
): { readonly scripted: boolean; readonly actor: ScriptedActor | undefined } => {
  if (doc.kind === "stalled") return { scripted: false, actor: undefined }
  if (Object.hasOwn(actors, doc.state)) return { scripted: true, actor: actors[doc.state] }
  const runs = checks === "run" && doc.actor === "check"
  return { scripted: false, actor: runs ? runsItsScript : undefined }
}

/** A strict drive's rest: refused at an unscripted check step, or with an actor no drive reached. */
const strictRest = (
  doc: BeatDocument,
  actors: Actors,
  reached: ReadonlySet<string> | undefined,
): BeatDocument => {
  if (doc.kind !== "stalled" && doc.actor === "check") {
    throw new Error(
      `strict drive: check step "${doc.state}" has no actor — script it, or drive with checks: "run"`,
    )
  }
  const never =
    reached === undefined ? [] : Object.keys(actors).filter((step) => !reached.has(step))
  if (never.length > 0) {
    throw new Error(
      `strict drive: the process rests at "${doc.state}", and never reached the actors for ${quoted(never)} — script a step only for the drive that reaches it`,
    )
  }
  return doc
}

const refuseVerdict = (doc: BeatDocument, returned: unknown): void => {
  if (doc.actor !== "judge" && returned !== undefined) {
    throw new Error(
      `strict drive: the actor for ${doc.actor} step "${doc.state}" returned a verdict; only a judge step takes one`,
    )
  }
}

const refuseNothingLanded = (doc: BeatDocument, nothing: boolean): void => {
  if (doc.actor === "human" && nothing) {
    throw new Error(
      `strict drive: the actor for human step "${doc.state}" changed nothing, so nothing landed and the drive would repeat the step`,
    )
  }
}

export const testRepo = (options: TestRepoOptions): TestRepo => {
  const repo = new InMemRepo()
  const env: Record<string, string | undefined> = { ...options.env }
  const { workflow } = options
  const id = `module-${++registered}`
  const modules = Object.entries(options.modules ?? {})
  const moduleKey = (specifier: string): string => `${id}:${specifier}`
  repo.writeFile(
    "gtd.config.ts",
    typeof workflow !== "string"
      ? moduleSource(id, workflow)
      : modules.length === 0
        ? workflow
        : importsFrom(workflow, options.modules!, (specifier) => lookup(moduleKey(specifier))),
  )
  for (const [path, content] of Object.entries(options.files ?? {})) repo.writeFile(path, content)
  repo.seedCommit("chore: initial commit")

  const canned = [...(options.commands ?? [])]
  const table = (first: readonly CannedCommand[] = []): CommandTable => ({
    get: (command) => {
      const hit = [...first, ...canned].find(({ run }) =>
        typeof run === "string" ? run === command : run.test(command),
      )
      if (hit === undefined) return undefined
      const { exit = 0, output = "", effect } = hit
      return { kind: "exit", status: exit, output, effect: () => effect?.(self) }
    },
  })
  const commands = table()

  // An `undefined` entry masks the ambient flag the in-memory host would add.
  const seenEnv = (): Readonly<Record<string, string | undefined>> =>
    options.ambientFlags === false
      ? {
          ...Object.fromEntries(
            Object.keys(process.env)
              .filter((name) => name.startsWith("GTD_FLAG_"))
              .map((name) => [name, undefined]),
          ),
          ...env,
        }
      : env

  // The modules are registered only while gtd runs, so nothing outlives the
  // call that loads them and no test can reach another's module.
  const gtd = async (...args: string[]): Promise<CapturedCliResult> => {
    const { io, result } = makeCapturingCliIo(repo, seenEnv())
    if (typeof workflow !== "string") registry().set(id, workflow)
    for (const [specifier, module] of modules) registry().set(moduleKey(specifier), module)
    try {
      await Effect.runPromise(runCli(["node", "gtd", ...args], io))
    } finally {
      registry().delete(id)
      for (const [specifier] of modules) registry().delete(moduleKey(specifier))
    }
    return result()
  }

  // `gtd judge answer` reads its verdict off stdin, so it is swapped for the call.
  const withStdin = async <T>(stdin: string, fn: () => Promise<T>): Promise<T> => {
    const saved = Object.getOwnPropertyDescriptor(process, "stdin")
    const fake = new PassThrough()
    Object.defineProperty(process, "stdin", { value: fake, configurable: true })
    fake.end(stdin)
    try {
      return await fn()
    } finally {
      if (saved) Object.defineProperty(process, "stdin", saved)
    }
  }

  const apply = (what: string, script: string): void => {
    if (script.length === 0) return
    const applied = applyEmittedScript(repo, commands, script)
    if (!applied.ok) throw new Error(`${what}: its script failed — ${applied.error ?? ""}`)
  }

  /** Runs a write command, then the script its `--json=script` twin prints. */
  const runWrite = async (
    args: readonly string[],
    stdin?: string,
    refused: (error: Error) => Error = (error) => error,
  ): Promise<CapturedCliResult> => {
    const call = (...extra: string[]) =>
      stdin === undefined ? gtd(...args, ...extra) : withStdin(stdin, () => gtd(...args, ...extra))
    const reported = await call()
    if (reported.exitCode !== EXIT_OK) throw refused(failed(`gtd ${args.join(" ")}`, reported))
    const script = await call("--json=script")
    apply(`gtd ${args.join(" ")}`, script.stdout)
    return reported
  }

  // A start prints its script plainly.
  const begin = async (args: readonly string[]): Promise<CapturedCliResult> => {
    const result = await gtd(...args)
    if (result.exitCode !== EXIT_OK) throw failed(`gtd ${args.join(" ")}`, result)
    apply(`gtd ${args.join(" ")}`, result.stdout)
    return result
  }

  const next = async (): Promise<BeatDocument> => {
    const result = await gtd("next", "--json")
    if (result.exitCode !== EXIT_OK) throw failed("gtd next --json", result)
    return JSON.parse(result.stdout) as BeatDocument
  }

  /** Lands what an actor did: a judge's verdict answered, anything else validated and landed. */
  const act = async (doc: BeatDocument, returned: unknown): Promise<void> => {
    if (doc.actor !== "judge") {
      if (doc.validate !== undefined) apply(`validating ${doc.file ?? doc.state}`, doc.validate)
      await runWrite(["land"])
      return
    }
    const actor = `the actor for judge step "${doc.state}"`
    if (returned === undefined) {
      throw new Error(`${actor} returned no verdict\n${expectedVerdict(doc)}`)
    }
    const sent = isVerdict(returned) ? JSON.stringify(returned.answers) : returned
    if (typeof sent !== "string") {
      throw new Error(
        `${actor} returned ${Array.isArray(sent) ? "an array" : typeof sent === "object" ? "an object" : `a ${typeof sent}`}, not a JSON string — JSON.stringify it\n${expectedVerdict(doc)}`,
      )
    }
    await runWrite(
      ["judge", "answer"],
      sent,
      (error) =>
        new Error(
          `${actor} sent a verdict gtd refused:\n${sent}\n${expectedVerdict(doc)}\n${error.message}`,
        ),
    )
  }

  // Across drives, so a later drive need not revisit a step an earlier one passed.
  const reached = new Set<string>()

  /** One beat of a drive: the beat it rests at, or `undefined` to read the next. */
  const beat = async (
    doc: BeatDocument,
    actors: Actors,
    { strict = true, checks, unreachedActors = "fail" }: DriveOptions,
  ): Promise<BeatDocument | undefined> => {
    if (doc.kind === "capture") {
      await runWrite(["land"])
      return undefined
    }
    const { scripted, actor } = actorAt(doc, actors, checks)
    if (actor === undefined)
      return strict
        ? strictRest(doc, actors, unreachedActors === "fail" ? reached : undefined)
        : doc
    if (scripted) reached.add(doc.state)
    const returned = await actor(doc, self)
    if (strict) refuseVerdict(doc, returned)
    const before = repo.commitHistory().length
    await act(doc, returned)
    if (strict) refuseNothingLanded(doc, repo.commitHistory().length === before)
    return undefined
  }

  const self: TestRepo = {
    command: (command) => {
      canned.push(command)
    },
    setEnv: (name, value) => {
      if (value === undefined) delete env[name]
      else env[name] = value
    },
    branch: (name, ref = "HEAD") => repo.createBranch(name, ref),
    checkout: (name) => repo.checkoutBranch(name),
    ref: (name, ref = "HEAD") => {
      if (!name.startsWith("refs/")) throw new Error(`testkit: ref "${name}" must start with refs/`)
      const hash = repo.resolveRef(ref)
      if (hash === null) throw new Error(`testkit: ref "${ref}" resolves to no commit`)
      repo.updateRef(name, hash)
    },
    branchName: () => repo.branchName(),
    read: (path) => repo.readFile(path),
    write: (path, content) => repo.writeFile(path, content),
    remove: (path) => repo.deleteFile(path),
    commit: (message) => repo.seedCommit(message),
    show: (ref, path) => repo.fileAtRef(ref, path) ?? undefined,
    runScript: (script, { commands: first = [] } = {}) => {
      const scriptCommands = first.length === 0 ? commands : table(first)
      const flow = applyFlowScript(repo, scriptCommands, script)
      if (flow === undefined) runLines(repo, scriptCommands, script)
      else if (!flow.ok) throw new Error(`testkit: ${flow.error ?? ""}`)
    },
    gtd,
    start: (name, ...args) => begin(["start", name, ...args]),
    door: (name, ...args) => begin(["start", name, ...args]),
    land: () => runWrite(["land"]),
    next,
    drive: async (actors = {}, options = {}) => {
      const { maxBeats = 50 } = options
      const passed: string[] = []
      for (let n = 0; n < maxBeats; n++) {
        const doc = await next()
        passed.push(doc.state)
        const rest = await beat(doc, actors, options)
        if (rest !== undefined) return rest
      }
      throw new Error(
        `the process did not rest within ${maxBeats} beats; it passed through:\n${passed.join(" → ")}`,
      )
    },
    subjects: () => repo.commitHistory().map(({ message }) => message.split("\n")[0] ?? ""),
    messages: () => repo.commitHistory().map(({ message }) => message),
    hashes: () => repo.commitHistory().map(({ hash }) => hash),
    commits: () =>
      repo.commitHistory().map(({ hash, message }) => ({
        hash,
        subject: message.split("\n")[0] ?? "",
        message,
        trailers: trailersOf(message),
      })),
  }
  return self
}

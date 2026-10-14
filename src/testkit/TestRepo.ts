import { Effect } from "effect"
import { PassThrough } from "node:stream"
import { runCli } from "../cli/index.js"
import { EXIT_OK, type BeatDocument } from "../wire/index.js"
import { makeCapturingCliIo, type CapturedCliResult } from "./cliIo.js"
import { applyEmittedScript } from "./EmittedScriptRecognizer.js"
import { applyFlowScript } from "./FlowScripts.js"
import { InMemRepo } from "./InMemRepo.js"

/**
 * The repository's `gtd.config.ts`: its source, or the module itself. A module
 * is handed to the engine through a global registry, so its functions run in
 * this process against the same `@pmelab/gtd/flows` runtime the engine
 * installs its context into.
 */
export type WorkflowModule = string | Readonly<Record<string, unknown>>

export interface TestRepoOptions {
  readonly workflow: WorkflowModule
  /** Committed alongside the config, before any process starts. */
  readonly files?: Readonly<Record<string, string>>
  /** The environment gtd sees; the real `process.env` is never read. */
  readonly env?: Readonly<Record<string, string>>
}

/** What a scripted actor does at the step it is registered for, before the beat lands. */
export type Actor = (beat: BeatDocument, repo: TestRepo) => void | string | Promise<void | string>

/**
 * Scripted actors, keyed by full step name. At a judge step the actor returns
 * the verdict, which is answered through `gtd judge answer`; anywhere else it
 * edits the tree and the beat is landed.
 */
export type Actors = Readonly<Record<string, Actor>>

export interface DriveOptions {
  /** Fail instead of looping forever on a workflow that never rests. */
  readonly maxBeats?: number
}

export interface TestRepo {
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
  runScript(script: string): void
  /** One in-process invocation; nothing it prints is run. */
  gtd(...args: string[]): Promise<CapturedCliResult>
  /** `gtd --workflow <name> [...args]`, its script applied. */
  start(workflow: string, ...args: string[]): Promise<CapturedCliResult>
  /** `gtd door <name> [...args]`, its script applied. */
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
}

const REGISTRY = Symbol.for("@pmelab/gtd/testkit:modules")
type Registry = Map<string, Readonly<Record<string, unknown>>>
const registry = (): Registry => {
  const global = globalThis as { [REGISTRY]?: Registry }
  return (global[REGISTRY] ??= new Map())
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/
let registered = 0

/** A config whose exports are module `id`'s, read off the registry when the engine loads it. */
const moduleSource = (id: string, module: Readonly<Record<string, unknown>>): string => {
  const lines = [
    `const m = globalThis[Symbol.for(${JSON.stringify(REGISTRY.description)})].get(${JSON.stringify(id)})`,
  ]
  for (const name of Object.keys(module)) {
    if (name === "default") lines.push(`export default m.default`)
    else if (IDENTIFIER.test(name)) lines.push(`export const ${name} = m[${JSON.stringify(name)}]`)
    else throw new Error(`testkit: export name "${name}" is not an identifier`)
  }
  return `${lines.join("\n")}\n`
}

/** An actor that runs the step's own script, for steps whose script `runScript` understands. */
export const runsItsScript: Actor = (beat, repo) => repo.runScript(beat.content)

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

const runLine = (repo: InMemRepo, line: string): void => {
  const known = LINES.find(([pattern]) => pattern.test(line))
  if (known === undefined) {
    throw new Error(`testkit: cannot run \`${line}\` in memory — give the step an actor instead`)
  }
  known[1](repo, words(line))
}

const failed = (what: string, result: CapturedCliResult): Error =>
  new Error(`${what} exited ${result.exitCode}\n${result.stderr}${result.stdout}`)

export const testRepo = (options: TestRepoOptions): TestRepo => {
  const repo = new InMemRepo()
  const env = { ...options.env }
  const { workflow } = options
  const id = `module-${++registered}`
  repo.writeFile(
    "gtd.config.ts",
    typeof workflow === "string" ? workflow : moduleSource(id, workflow),
  )
  for (const [path, content] of Object.entries(options.files ?? {})) repo.writeFile(path, content)
  repo.commitAllWithPrefix("chore: initial commit")

  // The module is registered only while gtd runs, so nothing outlives the
  // call that loads it and no test can reach another's module.
  const gtd = async (...args: string[]): Promise<CapturedCliResult> => {
    const { io, result } = makeCapturingCliIo(repo, env)
    if (typeof workflow !== "string") registry().set(id, workflow)
    try {
      await Effect.runPromise(runCli(["node", "gtd", ...args], io))
    } finally {
      registry().delete(id)
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
    const applied = applyEmittedScript(repo, new Map(), script)
    if (!applied.ok) throw new Error(`${what}: its script failed — ${applied.error ?? ""}`)
  }

  /** Runs a write command, then the script its `--json=script` twin prints. */
  const runWrite = async (args: readonly string[], stdin?: string): Promise<CapturedCliResult> => {
    const call = (...extra: string[]) =>
      stdin === undefined ? gtd(...args, ...extra) : withStdin(stdin, () => gtd(...args, ...extra))
    const reported = await call()
    if (reported.exitCode !== EXIT_OK) throw failed(`gtd ${args.join(" ")}`, reported)
    const script = await call("--json=script")
    apply(`gtd ${args.join(" ")}`, script.stdout)
    return reported
  }

  // A start prints its script plainly; it has no `--json=script` twin.
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
  const act = async (doc: BeatDocument, verdict: void | string): Promise<void> => {
    if (doc.actor !== "judge") {
      if (doc.validate !== undefined) apply(`validating ${doc.file ?? doc.state}`, doc.validate)
      await runWrite(["land"])
      return
    }
    if (typeof verdict !== "string") {
      throw new Error(`the actor for judge step "${doc.state}" returned no verdict`)
    }
    await runWrite(["judge", "answer"], verdict)
  }

  const self: TestRepo = {
    read: (path) => repo.readFile(path),
    write: (path, content) => repo.writeFile(path, content),
    remove: (path) => repo.deleteFile(path),
    commit: (message) => repo.commitAllWithPrefix(message),
    show: (ref, path) => repo.fileAtRef(ref, path) ?? undefined,
    runScript: (script) => {
      const flow = applyFlowScript(repo, new Map(), script)
      if (flow === undefined) for (const line of script.split("\n")) runLine(repo, line.trim())
      else if (!flow.ok) throw new Error(`testkit: ${flow.error ?? ""}`)
    },
    gtd,
    start: (workflow, ...args) => begin(["--workflow", workflow, ...args]),
    door: (name, ...args) => begin(["door", name, ...args]),
    land: () => runWrite(["land"]),
    next,
    drive: async (actors = {}, { maxBeats = 50 } = {}) => {
      for (let beat = 0; beat < maxBeats; beat++) {
        const doc = await next()
        if (doc.kind === "stalled") return doc
        if (doc.kind === "capture") {
          await runWrite(["land"])
          continue
        }
        const actor = actors[doc.state]
        if (actor === undefined) return doc
        await act(doc, await actor(doc, self))
      }
      throw new Error(`the process did not rest within ${maxBeats} beats`)
    },
    subjects: () => repo.commitHistory().map(({ message }) => message.split("\n")[0] ?? ""),
  }
  return self
}

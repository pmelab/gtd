import { Effect, Layer } from "effect"
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { runCli } from "../../../src/cli/index.js"
import { GtdError, GtdUsageError, NodeServices } from "../../../src/platform/index.js"
import {
  driverPanes,
  runWorkspaceCommand,
  stateDirectory,
  SupervisorHost,
  type ProjectView,
} from "../../../src/supervisor/index.js"
import {
  InMemRepo,
  inMemoryTerminal,
  inMemoryWorktrees,
  makeCapturingCliIo,
  type CapturedCliResult,
} from "../../../src/twins/index.js"
import {
  UiUsageError,
  type SpawnOutcome,
  type UiHandler,
  type UiHostOps,
} from "../../../src/ui/index.js"
import { fakeTailnet, inMemoryUiLayers, TAILNET_OWNER, TAILNET_PEER } from "./ui-host.js"

type ToolWorkspace = NonNullable<NonNullable<Parameters<typeof makeCapturingCliIo>[2]>["workspace"]>

/** What a worktree with no scripted `gtd next` answer reports: a process that has ended. */
const IDLE_NEXT = JSON.stringify({ kind: "capture", actor: "human", idle: true, label: "Idle" })

interface Run {
  readonly abort: AbortController
  readonly done: Promise<CapturedCliResult>
  url?: string
}

/**
 * A workspace on disk (its `gtd.workspace.ts`, a state home) with `gtd
 * workspace` run in-process against twins: the worktrees adapter, `gtd next`
 * answered from a table, the fake tailnet and an in-memory listener.
 */
export class WorkspaceBench {
  readonly root = realpathSync(mkdtempSync(join(tmpdir(), "gtd-workspace-")))
  readonly stateHome = mkdtempSync(join(tmpdir(), "gtd-workspace-state-"))
  readonly worktrees = inMemoryWorktrees()
  readonly terminal = inMemoryTerminal()
  /** Panes that an earlier supervisor opened, before the scenario's first one. */
  readonly seeded = new Set<string>()
  private readonly answers = new Map<string, SpawnOutcome>()
  private readonly tailnet = fakeTailnet()
  private readonly runs: Run[] = []
  private handler: UiHandler | undefined
  private listening: (() => void) | undefined
  lastRun: CapturedCliResult | undefined
  lastStatus: number | undefined
  lastSignal: { code: number | null; signal: NodeJS.Signals | null } | undefined

  writeFile(rel: string, content: string): void {
    const path = join(this.root, rel)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content.endsWith("\n") ? content : `${content}\n`)
  }

  /** `<project>/<branch>` to the worktree's path. */
  async pathOf(ref: string): Promise<string> {
    const [project, branch] = ref.split("/") as [string, string]
    const found = (await this.worktrees.adapter.list(project)).find((w) => w.branch === branch)
    if (found === undefined) throw new Error(`no worktree ${ref}`)
    return found.path
  }

  /** A driver pane that an earlier supervisor started in the worktree, still running. */
  async seedDriver(ref: string): Promise<void> {
    const [project] = ref.split("/") as [string]
    const path = await this.pathOf(ref)
    const handle = await this.terminal.adapter.run(project, path, ["drive"], {})
    this.seeded.add(handle)
    driverPanes(stateDirectory(this.stateHome, this.root)).set(path, handle)
  }

  /** A worktree's path to `<project>/<branch>`. */
  async refOf(path: string): Promise<string> {
    for (const project of await this.worktrees.adapter.projects()) {
      const found = (await this.worktrees.adapter.list(project.id)).find((w) => w.path === path)
      if (found !== undefined) return `${project.id}/${found.branch}`
    }
    throw new Error(`no worktree at ${path}`)
  }

  /** The handle of the newest pane opened in the worktree. */
  async paneOf(ref: string): Promise<string> {
    const path = await this.pathOf(ref)
    const pane = this.terminal
      .panes()
      .filter((p) => p.worktree === path)
      .at(-1)
    if (pane === undefined) throw new Error(`no pane in ${ref}`)
    return pane.handle
  }

  answer(path: string, outcome: SpawnOutcome): void {
    this.answers.set(path, outcome)
  }

  /** The supervisor in memory: the real command, on the twins. */
  private tool(): ToolWorkspace {
    const serveRecords = new Map()
    const uiHost: UiHostOps = {
      run: async () => ({ status: 127, stdout: "", stderr: "no shell in memory" }),
      headSha: async () => undefined,
      readLocalGtdVersion: async () => undefined,
      readFile: async () => ({ kind: "absent" }),
      writeFile: async () => {},
      networkInterfaces: () => ({}),
      serveRecords: {
        read: (port) => serveRecords.get(port),
        write: (port, record) => void serveRecords.set(port, record),
        delete: (port) => void serveRecords.delete(port),
      },
      isPidAlive: (pid) => pid === process.pid,
      scratch: (body) => body("/inmem-scratch", () => ""),
    }
    const host = Layer.succeed(SupervisorHost, {
      next: async (path) => this.answers.get(path) ?? { status: 0, stdout: IDLE_NEXT, stderr: "" },
      defaultWorktrees: () => this.worktrees.adapter,
      defaultTerminal: () => this.terminal.adapter,
      isPidAlive: (pid) => pid === process.pid,
    })
    const ui = inMemoryUiLayers(uiHost, this.tailnet, new Map(), (handler) => {
      this.handler = handler
      this.listening?.()
    })
    return (request, out) =>
      runWorkspaceCommand(request, out).pipe(
        Effect.provide(Layer.mergeAll(ui, host)),
        Effect.provide(NodeServices.layer),
        Effect.mapError((error) =>
          error instanceof UiUsageError
            ? new GtdUsageError(error.message, error.detail)
            : new GtdError(error.message, error.detail),
        ),
      )
  }

  /** Starts `gtd workspace` and returns once it serves or has exited. */
  async start(...args: string[]): Promise<void> {
    const abort = new AbortController()
    const { io, result } = makeCapturingCliIo(
      new InMemRepo(),
      { XDG_STATE_HOME: this.stateHome },
      { workspace: this.tool() },
      "",
      this.root,
    )
    const serving = new Promise<"serving">((resolve) => {
      this.listening = () => resolve("serving")
    })
    const done = Effect.runPromise(runCli(["node", "gtd.js", "workspace", ...args], io), {
      signal: abort.signal,
    })
      .catch(() => {})
      .then(result)
    const run: Run = { abort, done }
    this.runs.push(run)
    const outcome = await Promise.race([serving, done])
    if (outcome !== "serving") {
      this.lastRun = outcome
      return
    }
    // The URL is printed right after the listener binds.
    await delay(0)
    run.url = result().stdout.trim()
  }

  /** The URL the first supervisor printed. */
  get firstUrl(): string | undefined {
    return this.runs[0]?.url
  }

  async stopAll(): Promise<void> {
    const runs = this.runs.splice(0)
    for (const run of runs) run.abort.abort()
    await Promise.all(runs.map((run) => run.done))
    this.handler = undefined
  }

  async request(path: string, login = TAILNET_OWNER): Promise<Response> {
    if (this.handler === undefined) throw new Error("gtd workspace is not serving")
    const response = await this.handler(
      new Request(`http://inmem${path}`, {
        headers: { "tailscale-user-login": login, "sec-fetch-site": "same-origin" },
      }),
      () => {},
      TAILNET_PEER,
    )
    this.lastStatus = response.status
    return response
  }

  async projects(): Promise<readonly ProjectView[]> {
    const response = await this.request("/trpc/projects")
    const body = (await response.json()) as { result: { data: readonly ProjectView[] } }
    return body.result.data
  }

  lockExists(): boolean {
    return existsSync(join(stateDirectory(this.stateHome, this.root), "lock"))
  }

  /** A real `gtd workspace --http`, spawned from the workspace root, sent `signal` once it serves. */
  async spawnAndSignal(
    gtdBin: string,
    env: NodeJS.ProcessEnv,
    signal: NodeJS.Signals,
  ): Promise<void> {
    const child = spawn(process.execPath, [gtdBin, "workspace", "--http", "--port", "0"], {
      cwd: this.root,
      env: { ...env, XDG_STATE_HOME: this.stateHome },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let output = ""
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")))
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")))
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
      child.once("exit", (code, died) => resolve({ code, signal: died })),
    )
    for (let i = 0; i < 600 && !output.includes("http://"); i++) await delay(50)
    if (!output.includes("http://")) {
      child.kill("SIGKILL")
      throw new Error(`gtd workspace never printed its URL: ${output}`)
    }
    child.kill(signal)
    this.lastSignal = await exited
  }

  async dispose(): Promise<void> {
    await this.stopAll()
    rmSync(this.root, { recursive: true, force: true })
    rmSync(this.stateHome, { recursive: true, force: true })
  }
}

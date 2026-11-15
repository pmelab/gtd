import { Effect, Layer } from "effect"
import { spawn } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { runCli } from "../../../src/cli/index.js"
import { GtdError, GtdUsageError, NodeServices } from "../../../src/platform/index.js"
import {
  driverPanes,
  runWorkspaceCommand,
  stateDirectory,
  SupervisorClock,
  SupervisorHost,
  UserlandTools,
  type FeedView,
  type ProjectView,
} from "../../../src/supervisor/index.js"
import {
  InMemRepo,
  inMemoryTerminal,
  inMemoryWorktrees,
  makeCapturingCliIo,
  type CapturedCliResult,
} from "../../../src/twins/index.js"
import { createTRPCClient, httpLink } from "@trpc/client"
import {
  UiUsageError,
  type AppRouter,
  type SpawnOutcome,
  type UiHandler,
  type UiHostOps,
} from "../../../src/ui/index.js"
import type { ExecResult, InboxItem } from "../../../src/workspace/index.js"
import { fakeTailnet, inMemoryUiLayers, TAILNET_OWNER, TAILNET_PEER } from "./ui-host.js"

type ToolWorkspace = NonNullable<NonNullable<Parameters<typeof makeCapturingCliIo>[2]>["workspace"]>

/** What a worktree with no scripted `gtd next` answer reports: a process that has ended. */
const IDLE_NEXT = JSON.stringify({ kind: "capture", actor: "human", idle: true, label: "Idle" })

/**
 * The supervisor's clock, moved by hand. A task runs when it is scheduled and
 * at each due time `advance` passes; `settled` waits for every run to end.
 */
class ManualClock {
  now = Date.parse("2026-01-01T00:00:00Z")
  private readonly tasks = new Set<{ ms: number; due: number; task: () => Promise<void> }>()
  private readonly running = new Set<Promise<void>>()

  every = (ms: number, task: () => Promise<void>): (() => void) => {
    const entry = { ms, due: this.now + ms, task }
    this.tasks.add(entry)
    this.run(task)
    return () => void this.tasks.delete(entry)
  }

  private run(task: () => Promise<void>): void {
    const running: Promise<void> = task().finally(() => this.running.delete(running))
    this.running.add(running)
  }

  async settled(): Promise<void> {
    while (this.running.size > 0) await Promise.allSettled(this.running)
  }

  async advance(ms: number): Promise<void> {
    const end = this.now + ms
    for (;;) {
      const next = [...this.tasks].filter((t) => t.due <= end).sort((a, b) => a.due - b.due)[0]
      if (next === undefined) break
      this.now = next.due
      next.due += next.ms
      this.run(next.task)
      await this.settled()
    }
    this.now = end
  }
}

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
  /** The worktree of each `gtd next` the supervisor ran, in order. */
  readonly nextRuns: string[] = []
  /** Files inside worktrees, by absolute path. */
  readonly files = new Map<string, string>()
  /** A feed's `ctx.exec` answers, by argv joined with spaces. */
  readonly commands = new Map<string, ExecResult>()
  readonly clock = new ManualClock()
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

  private nextIn(path: string): SpawnOutcome {
    return this.answers.get(path) ?? { status: 0, stdout: IDLE_NEXT, stderr: "" }
  }

  private async headOf(path: string): Promise<string | undefined> {
    for (const { id } of await this.worktrees.adapter.projects()) {
      const found = (await this.worktrees.adapter.list(id)).find((w) => w.path === path)
      if (found !== undefined) return found.head
    }
    return undefined
  }

  /** The supervisor in memory: the real command, on the twins. */
  private tool(): ToolWorkspace {
    const serveRecords = new Map()
    // A gate page reads its worktree through `gtd next` and git; git answers
    // nothing in memory, which a gate page reads as unknown.
    const uiHost: UiHostOps = {
      run: async (cwd, command) =>
        command === "gtd next --json"
          ? this.nextIn(cwd)
          : { status: 127, stdout: "", stderr: "no shell in memory" },
      headSha: async (path) => this.headOf(path),
      readLocalGtdVersion: async () => undefined,
      readFile: async (path) => {
        const content = this.files.get(path)
        return content === undefined ? { kind: "absent" } : { kind: "content", content }
      },
      writeFile: async (path, content) => void this.files.set(path, content),
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
      next: async (path) => {
        this.nextRuns.push(path)
        return this.nextIn(path)
      },
      defaultWorktrees: () => this.worktrees.adapter,
      defaultTerminal: () => this.terminal.adapter,
      isPidAlive: (pid) => pid === process.pid,
    })
    const tools = Layer.succeed(UserlandTools, {
      exec: async (argv) => {
        const answer = this.commands.get(argv.join(" "))
        if (answer === undefined) throw new Error(`no answer scripted for ${argv.join(" ")}`)
        return answer
      },
      fetch: async () => {
        throw new Error("no fetch scripted")
      },
    })
    const clock = Layer.succeed(SupervisorClock, {
      now: () => this.clock.now,
      every: this.clock.every,
    })
    const ui = inMemoryUiLayers(uiHost, this.tailnet, new Map(), (handler) => {
      this.handler = handler
      this.listening?.()
    })
    return (request, out) =>
      runWorkspaceCommand(request, out).pipe(
        Effect.provide(Layer.mergeAll(ui, host, tools, clock)),
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
    // The URL is printed right after the listener binds; the first polls follow.
    await delay(0)
    run.url = result().stdout.split("\n")[0]!.trim()
    await this.clock.settled()
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

  /** A request as a browser of `login` sends it through tailscale serve: same-origin unless `init` says otherwise. */
  async request(path: string, login = TAILNET_OWNER, init: RequestInit = {}): Promise<Response> {
    if (this.handler === undefined) throw new Error("gtd workspace is not serving")
    const headers = new Headers(init.headers)
    if (!headers.has("sec-fetch-site")) headers.set("sec-fetch-site", "same-origin")
    headers.set("tailscale-user-login", login)
    const response = await this.handler(
      new Request(`http://inmem${path}`, { ...init, headers }),
      () => {},
      TAILNET_PEER,
    )
    this.lastStatus = response.status
    return response
  }

  /** A tRPC client of the gate page at `gate`, talking to it as the page's own script does. */
  gateClient(gate: string) {
    return createTRPCClient<AppRouter>({
      links: [
        httpLink({
          url: `http://inmem${gate}/trpc`,
          fetch: (input, init) => {
            const url = new URL(input instanceof Request ? input.url : String(input))
            return this.request(
              `${url.pathname}${url.search}`,
              TAILNET_OWNER,
              (init ?? {}) as RequestInit,
            )
          },
        }),
      ],
    })
  }

  async post(path: string, body: unknown): Promise<Response> {
    if (this.handler === undefined) throw new Error("gtd workspace is not serving")
    const response = await this.handler(
      new Request(`http://inmem${path}`, {
        method: "POST",
        headers: {
          "tailscale-user-login": TAILNET_OWNER,
          "sec-fetch-site": "same-origin",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
      () => {},
      TAILNET_PEER,
    )
    this.lastStatus = response.status
    return response
  }

  async inbox(): Promise<{ items: readonly InboxItem[]; feeds: readonly FeedView[] }> {
    const response = await this.request("/trpc/inbox")
    const body = (await response.json()) as {
      result: { data: { items: readonly InboxItem[]; feeds: readonly FeedView[] } }
    }
    return body.result.data
  }

  /** Every entry directly in the workspace root. */
  rootEntries(): string[] {
    return readdirSync(this.root).sort()
  }

  deleteState(): void {
    rmSync(stateDirectory(this.stateHome, this.root), { recursive: true, force: true })
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

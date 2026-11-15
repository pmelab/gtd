import { Effect, Layer } from "effect"
import { spawn } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  statSync,
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
  runControlCommand,
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
  inMemoryActions,
  inMemoryClock,
  inMemoryNotifications,
  inMemoryServices,
  inMemoryTerminal,
  inMemoryWorktrees,
  settle,
  makeCapturingCliIo,
  type CapturedCliResult,
  type InMemoryPane,
} from "../../../src/twins/index.js"
import { createTRPCClient, httpLink } from "@trpc/client"
import {
  UiUsageError,
  type AppRouter,
  type SpawnOutcome,
  type UiHandler,
  type UiHostOps,
} from "../../../src/ui/index.js"
import type {
  ExecResult,
  InboxItem,
  ServicesAdapter,
  TerminalAdapter,
  WorktreesAdapter,
} from "../../../src/workspace/index.js"
import { fakeTailnet, inMemoryUiLayers, TAILNET_OWNER, TAILNET_PEER } from "./ui-host.js"

type ToolWorkspace = NonNullable<NonNullable<Parameters<typeof makeCapturingCliIo>[2]>["workspace"]>

/** A pane gtd opened for an action, not for a driver. */
const isActionPane = (pane: InMemoryPane): boolean => "GTD_WORKSPACE_STATUS" in pane.env

/** What a worktree with no scripted `gtd next` answer reports: a process that has ended. */
const IDLE_NEXT = JSON.stringify({
  kind: "capture",
  actor: "human",
  idle: true,
  label: "Idle",
})

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
  readonly output: () => string
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
  terminal = inMemoryTerminal()
  /** The person's login shell. */
  loginShell = "/bin/sh"
  readonly actions = inMemoryActions()
  /** Panes that an earlier supervisor opened, before the scenario's first one. */
  readonly seeded = new Set<string>()
  /** The timers of `SupervisorHost.after`. */
  readonly clock = inMemoryClock()
  /** Whether the default worktrees adapter offers a watch. */
  watching = true
  readonly services = inMemoryServices()
  readonly notifications = inMemoryNotifications()
  /** The changing calls the supervisor made to the worktrees, services and terminal adapters, in order. */
  readonly calls: { call: string; worktree: string }[] = []
  private readonly answers = new Map<string, SpawnOutcome>()
  /** The worktree of each `gtd next` the supervisor ran, in order. */
  readonly nextRuns: string[] = []
  /** Worktrees where `gtd next` waits for `release`, with what releases each waiting run. */
  private readonly held = new Map<string, (() => void)[]>()
  private readonly running = new Set<string>()
  /** Worktrees where two `gtd next` ran at once. */
  readonly overlapped = new Set<string>()
  /** Files inside worktrees, by absolute path. */
  readonly files = new Map<string, string>()
  /** What the supervisor runs when a watched file changes, by path; each returns once that change is handled. */
  private readonly fileWatches = new Map<string, Set<() => Promise<void>>>()
  /** Each driver one-shot the supervisor ran, in order. */
  readonly oneShots: { readonly worktree: string; readonly argv: readonly string[] }[] = []
  /** Worktrees whose driver refuses every one-shot, with its stderr. */
  readonly refusing = new Map<string, string>()
  /** Worktrees whose driver never answers a one-shot, as if it never listened. */
  readonly silent = new Set<string>()
  /** A feed's `ctx.exec` answers, by argv joined with spaces. */
  readonly commands = new Map<string, ExecResult>()
  /** The feeds' clock. */
  readonly feedClock = new ManualClock()
  private readonly tailnet = fakeTailnet()
  private readonly runs: Run[] = []
  private handler: UiHandler | undefined
  private listening: (() => void) | undefined
  lastRun: CapturedCliResult | undefined
  lastStatus: number | undefined
  lastSignal: { code: number | null; signal: NodeJS.Signals | null } | undefined
  /** The last `gtd workspace proceed|retry` run beside the supervisor. */
  lastCommand: CapturedCliResult | undefined

  /** Rewrites a file in the workspace root as an editor does, and waits until the supervisor has handled it. */
  async changeFile(rel: string, content: string): Promise<void> {
    this.writeFile(rel, content)
    const watches = this.fileWatches.get(join(this.root, rel)) ?? []
    await Promise.all([...watches].map((changed) => changed()))
    await this.feedClock.settled()
  }

  writeFile(rel: string, content: string): void {
    const path = join(this.root, rel)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content.endsWith("\n") ? content : `${content}\n`)
  }

  /** `<project>/<branch>` to the worktree's path. */
  async pathOf(ref: string): Promise<string> {
    const slash = ref.indexOf("/")
    const [project, branch] = [ref.slice(0, slash), ref.slice(slash + 1)]
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

  /** The handle of the newest driver pane opened in the worktree. */
  async paneOf(ref: string): Promise<string> {
    return this.newestPane(ref, (pane) => !isActionPane(pane) && !this.isShellPane(pane))
  }

  /** A pane the Terminal tab opened: it runs the login shell. */
  isShellPane(pane: InMemoryPane): boolean {
    return pane.argv.length === 1 && pane.argv[0] === this.loginShell
  }

  /** The handle of the newest shell pane opened in the worktree. */
  async shellPaneOf(ref: string): Promise<string> {
    return this.newestPane(ref, (pane) => this.isShellPane(pane))
  }

  /** The handle of the newest action pane opened in the worktree. */
  async actionPaneOf(ref: string): Promise<string> {
    return this.newestPane(ref, isActionPane)
  }

  private async newestPane(ref: string, kind: (pane: InMemoryPane) => boolean): Promise<string> {
    const path = await this.pathOf(ref)
    const pane = this.terminal
      .panes()
      .filter((p) => p.worktree === path && kind(p))
      .at(-1)
    if (pane === undefined) throw new Error(`no pane in ${ref}`)
    return pane.handle
  }

  private loggedWorktrees(): WorktreesAdapter {
    const adapter = this.worktrees.adapter
    return {
      ...adapter,
      create: async (project, branch, base) => {
        const path = await adapter.create!(project, branch, base)
        this.calls.push({ call: "worktrees.create", worktree: `${project}/${branch}` })
        return path
      },
      remove: async (project, path, options) => {
        this.calls.push({
          call: options.force ? "worktrees.remove (force)" : "worktrees.remove",
          worktree: await this.refOf(path),
        })
        await adapter.remove!(project, path, options)
      },
    }
  }

  private loggedServices(): ServicesAdapter {
    const adapter = this.services.adapter
    const logged =
      (call: string, op: (project: string, path: string) => Promise<void>) =>
      async (project: string, path: string) => {
        this.calls.push({ call, worktree: await this.refOf(path) })
        await op(project, path)
      }
    return {
      ...adapter,
      up: logged("services.up", adapter.up),
      down: logged("services.down", adapter.down),
    }
  }

  private loggedTerminal(): TerminalAdapter {
    const adapter = this.terminal.adapter
    return {
      ...adapter,
      close: async (handle) => {
        const pane = this.terminal.panes().find((p) => p.handle === handle)
        this.calls.push({ call: "terminal.close", worktree: await this.refOf(pane!.worktree) })
        await adapter.close(handle)
      },
    }
  }

  answer(path: string, outcome: SpawnOutcome): void {
    this.answers.set(path, outcome)
  }

  hold(path: string): void {
    this.held.set(path, [])
  }

  /** Lets the held `gtd next` runs in `path` answer, and no longer holds new ones. */
  async release(path: string): Promise<void> {
    const waiting = this.held.get(path) ?? []
    this.held.delete(path)
    for (const resume of waiting) resume()
    await settle()
  }

  private async runNext(path: string): Promise<SpawnOutcome> {
    this.nextRuns.push(path)
    if (this.running.has(path)) this.overlapped.add(path)
    this.running.add(path)
    const waiting = this.held.get(path)
    if (waiting !== undefined) await new Promise<void>((resume) => waiting.push(resume))
    this.running.delete(path)
    return this.nextIn(path)
  }

  /** Whether a driver runs in the worktree's newest pane and answers one-shots. */
  private async driverListens(worktree: string): Promise<boolean> {
    const pane = this.terminal
      .panes()
      .filter((p) => p.worktree === worktree)
      .at(-1)
    if (pane === undefined || this.silent.has(worktree)) return false
    return (await this.terminal.adapter.status(pane.handle))?.alive === true
  }

  /** A driver one-shot: answered while the driver listens, else exit 2. */
  private async oneShot(argv: readonly string[], worktree: string): Promise<ExecResult> {
    this.oneShots.push({ worktree, argv })
    if (!(await this.driverListens(worktree))) {
      return { status: 2, stdout: "", stderr: "no driver runs\n" }
    }
    const refusal = this.refusing.get(worktree)
    return { status: refusal === undefined ? 0 : 1, stdout: "", stderr: refusal ?? "" }
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
      next: (path) => this.runNext(path),
      defaultWorktrees: () => {
        const { watch, ...adapter } = this.loggedWorktrees()
        return this.watching ? { ...adapter, watch: watch! } : adapter
      },
      defaultTerminal: () => this.loggedTerminal(),
      defaultServices: () => this.loggedServices(),
      defaultActions: () => this.actions.adapter,
      defaultNotifications: () => this.notifications.adapter,
      isPidAlive: (pid) => pid === process.pid,
      after: this.clock.after,
      watchFile: (path, changed) => {
        const watches = this.fileWatches.get(path) ?? new Set()
        this.fileWatches.set(path, watches)
        watches.add(changed)
        return () => void watches.delete(changed)
      },
      oneShot: (argv, worktree) => this.oneShot(argv, worktree),
      loginShell: this.loginShell,
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
      now: () => this.feedClock.now,
      every: this.feedClock.every,
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

  /** Runs `gtd <args>` from the workspace root, as a script beside the supervisor does. */
  async command(args: readonly string[]): Promise<void> {
    const { io, result } = makeCapturingCliIo(
      new InMemRepo(),
      { XDG_STATE_HOME: this.stateHome },
      {
        workspaceControl: (request) =>
          runControlCommand(request).pipe(
            Effect.mapError((error) => new GtdError(error.message, error.detail)),
          ),
      },
      "",
      this.root,
    )
    await Effect.runPromise(runCli(["node", "gtd.js", ...args], io)).catch(() => {})
    this.lastCommand = result()
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
    const run: Run = { abort, done, output: () => result().stdout }
    this.runs.push(run)
    const outcome = await Promise.race([serving, done])
    if (outcome !== "serving") {
      this.lastRun = outcome
      return
    }
    // The URL is printed right after the listener binds; the first polls follow.
    await delay(0)
    run.url = result().stdout.split("\n")[0]!.trim()
    await this.feedClock.settled()
  }

  /** What the latest supervisor printed so far. */
  get output(): string {
    return this.runs.at(-1)?.output() ?? ""
  }

  /** What the supervisors that were stopped printed. */
  private stoppedOutput = ""

  /** What every supervisor of the scenario printed, in order. */
  get allOutput(): string {
    return this.stoppedOutput + this.runs.map((run) => run.output()).join("")
  }

  /** The URL the first supervisor printed. */
  get firstUrl(): string | undefined {
    return this.runs[0]?.url
  }

  async stopAll(): Promise<void> {
    const runs = this.runs.splice(0)
    for (const run of runs) run.abort.abort()
    await Promise.all(runs.map((run) => run.done))
    this.stoppedOutput += runs.map((run) => run.output()).join("")
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

  /** Moves both supervisor clocks on by `ms`. */
  async advance(ms: number): Promise<void> {
    await this.feedClock.advance(ms)
    await this.clock.advance(ms)
  }

  /** A tRPC call of the dashboard's API, as the dashboard's script sends it. */
  async call(procedure: string, input: unknown, kind: "query" | "mutation"): Promise<unknown> {
    const response =
      kind === "query"
        ? await this.request(
            `/trpc/${procedure}?input=${encodeURIComponent(JSON.stringify(input))}`,
          )
        : await this.post(`/trpc/${procedure}`, input)
    const body = (await response.json()) as { result?: { data: unknown }; error?: unknown }
    return body.result?.data ?? body.error
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

  async inbox(): Promise<{
    items: readonly InboxItem[]
    feeds: readonly FeedView[]
    drives: { inUse: number; max?: number }
  }> {
    const response = await this.request("/trpc/inbox")
    const body = (await response.json()) as {
      result: {
        data: {
          items: readonly InboxItem[]
          feeds: readonly FeedView[]
          drives: { inUse: number; max?: number }
        }
      }
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
    const body = (await response.json()) as {
      result: { data: readonly ProjectView[] }
    }
    return body.result.data
  }

  async banners(): Promise<readonly { kind: string; message: string }[]> {
    const response = await this.request("/trpc/banners")
    const body = (await response.json()) as {
      result: { data: readonly { kind: string; message: string }[] }
    }
    return body.result.data
  }

  lockExists(): boolean {
    return existsSync(join(stateDirectory(this.stateHome, this.root), "lock"))
  }

  /**
   * A real `gtd workspace --http`, spawned from the workspace root, sent
   * `signal` once it serves and `whileServing` has ended.
   */
  async spawnAndSignal(
    gtdBin: string,
    env: NodeJS.ProcessEnv,
    signal: NodeJS.Signals,
    whileServing: () => Promise<void> = async () => {},
  ): Promise<void> {
    const child = spawn(process.execPath, [gtdBin, "workspace", "--http", "--port", "0"], {
      cwd: this.root,
      env: { ...env, XDG_STATE_HOME: this.stateHome },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let output = ""
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")))
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")))
    const exited = new Promise<{
      code: number | null
      signal: NodeJS.Signals | null
    }>((resolve) => child.once("exit", (code, died) => resolve({ code, signal: died })))
    for (let i = 0; i < 600 && !output.includes("http://"); i++) await delay(50)
    if (!output.includes("http://")) {
      child.kill("SIGKILL")
      throw new Error(`gtd workspace never printed its URL: ${output}`)
    }
    await whileServing()
    child.kill(signal)
    this.lastSignal = await exited
  }

  /** The mode bits of the supervisor's socket. */
  socketMode(): number {
    return statSync(join(stateDirectory(this.stateHome, this.root), "socket")).mode & 0o777
  }

  /** A real `gtd <args>`, spawned from the workspace root, until it ends. */
  spawnGtd(
    gtdBin: string,
    env: NodeJS.ProcessEnv,
    args: readonly string[],
  ): Promise<CapturedCliResult> {
    const child = spawn(process.execPath, [gtdBin, ...args], {
      cwd: this.root,
      env: { ...env, XDG_STATE_HOME: this.stateHome },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")))
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")))
    return new Promise((resolve) =>
      child.once("close", (code) =>
        resolve({ stdout, stdoutBytes: Buffer.from(stdout), stderr, exitCode: code ?? -1 }),
      ),
    )
  }

  async dispose(): Promise<void> {
    await this.stopAll()
    rmSync(this.root, { recursive: true, force: true })
    rmSync(this.stateHome, { recursive: true, force: true })
  }
}
